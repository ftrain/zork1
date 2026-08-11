/* A solver that plays Zork I without being told the answers.
 *
 * It knows only what the interface knows: which room it is in (by object
 * number), what is lying there, what it is carrying, the score, and which
 * things the ZIL source marks as treasure. It does not know the walkthrough.
 *
 * The engine's save/restore is what makes this workable. Every command is
 * taken behind a mark, so a move that kills you is simply rewound and struck
 * off the list for that room. The solver can walk into the dark, get eaten,
 * and carry on none the worse -- which is the difference between a search
 * and a losing streak.
 *
 * The seed is pinned, so a run is reproducible: the same seed explores the
 * same dungeon and reaches the same score.
 *
 * What it is not: a planner. It has no model of the puzzles -- the exorcism
 * at Hades, the coal mine basket, the dam controls -- and cannot invent the
 * chains of actions they need. It maps the dungeon, banks the treasure it
 * can reach, and stops when nothing untried is left.
 */
window.ZorkSolver = (function () {
  "use strict";

  var DIRS = ["north", "south", "east", "west", "northeast", "northwest",
              "southeast", "southwest", "up", "down", "in", "out"];

  var REVERSE = {
    north: "south", south: "north", east: "west", west: "east",
    northeast: "southwest", southwest: "northeast",
    northwest: "southeast", southeast: "northwest",
    up: "down", down: "up", in: "out", out: "in"
  };

  var DIED = /you have died|you are dead|would you like to restart/i;
  var DARK = /pitch black|is too dark|grue/i;
  var FAILED = /can't go that way|there is a wall|only dumb|too narrow|is closed/i;
  var REFUSED = /can't|cannot|don't|doesn't|won't|not.*here|nothing/i;

  function create(engine, world, opts) {
    opts = opts || {};
    var lore = world.lore || {};

    // Scenery a room answers to without holding it. The kitchen window is
    // the whole reason this matters: it is in no room's object tree, and
    // without it there is no way into the house.
    var byName = {};
    (world.rooms || []).forEach(function (r) {
      var k = r.name.toLowerCase();
      byName[k] = byName.hasOwnProperty(k) ? null : r;
    });
    function sceneryHere() {
      var z = byName[String(cur.name || "").toLowerCase()];
      return z ? (z.globals || []) : [];
    }
    // Rooms the ZIL marks as lit need no lamp, and the lamp's battery is
    // finite: leaving it burning through a long surface wander is what
    // strands a solver in the dark later on.
    function roomIsLit() {
      var z = byName[String(cur.name || "").toLowerCase()];
      return !!(z && (z.flags || []).indexOf("ONBIT") >= 0);
    }
    /* ---- goals, read out of the source ----------------------------------
     *
     * The ZIL says what is worth points and where it starts, so the solver
     * does not have to stumble on treasure: it can be sent for it. Routing
     * is over the source's own exit table rather than the rooms walked so
     * far, which means it can plan a path through country it has never
     * seen. Exits gated on a flag look identical to open ones here, so a
     * refusal is recorded and the route recomputed around it.
     */
    var WORD = {
      NORTH: "north", SOUTH: "south", EAST: "east", WEST: "west",
      NE: "northeast", NW: "northwest", SE: "southeast", SW: "southwest",
      UP: "up", DOWN: "down", IN: "in", OUT: "out", LAND: "land"
    };
    var zil = {}, zilByName = {}, zilBlocked = {};
    (world.rooms || []).forEach(function (r) {
      zil[r.id] = r;
      var k = r.name.toLowerCase();
      zilByName[k] = zilByName.hasOwnProperty(k) ? null : r.id;
    });

    // Which source room we are standing in. Rooms sharing a name -- every
    // Maze, every Forest -- are deliberately unresolvable, so the planner
    // stays quiet there and the blind explorer takes over.
    function zilHere() {
      return zilByName[String(cur.name || "").toLowerCase()] || null;
    }

    function zilRoute(from, to) {
      if (!from || !to) return null;
      var seen = {}, q = [[from, []]];
      seen[from] = 1;
      while (q.length) {
        var it = q.shift();
        if (it[0] === to) return it[1];
        var r = zil[it[0]];
        if (!r || it[1].length > 40) continue;
        for (var i = 0; i < r.exits.length; i++) {
          var e = r.exits[i];
          if (zilBlocked[it[0] + ">" + e.dir] || seen[e.to]) continue;
          seen[e.to] = 1;
          q.push([e.to, it[1].concat([WORD[e.dir] || e.dir.toLowerCase()])]);
        }
      }
      return null;
    }

    var prizes = Object.keys(lore).map(function (n) {
      var o = lore[n];
      return { name: n, room: o.room, via: o.via || [],
               worth: (o.tvalue || 0) + (o.value || 0) };
    }).filter(function (t) { return t.worth > 0 && t.room; });

    var tries = {};          // how often a prize has been set out for
    var giveUp = {};         // treasures that would not come when called
    var goal = null;         // {name, room, path}
    var caseZil = null;      // the Living Room, in source terms

    var rooms = {};          // id -> what we know and have tried there
    var queue = [];          // commands routed but not yet sent
    var deposited = {};      // treasures already in the case
    var caseRoom = null;     // the Living Room, once seen
    var log = [];
    var sweeps = 0;
    var lastDir = null;      // how we got into the room we are standing in
    var cur = engine.snapshot("");
    var stats = { moves: 0, score: 0, rooms: 0, deaths: 0, treasures: 0,
                  done: false, why: "" };

    // The printed name is for reading; the last word of it is what the
    // parser actually has in its dictionary.
    function noun(name) {
      var w = String(name || "").trim().split(/\s+/);
      return w[w.length - 1] || name;
    }

    function isTreasure(name) {
      var o = lore[String(name || "").toLowerCase()];
      return !!(o && (o.tvalue || o.value));
    }

    function room(id) {
      if (!rooms[id]) {
        rooms[id] = { id: id, name: cur.name, exits: {}, blocked: {},
                      tried: {}, untried: DIRS.slice() };
      }
      return rooms[id];
    }

    function carried() { return (cur.inventory || []).map(function (o) { return o.name; }); }
    function here() { return (cur.objects || []).map(function (o) { return o; }); }

    function haveLamp() {
      return (cur.inventory || []).some(function (o) { return o.f && o.f.light; });
    }
    function lampLit() {
      return (cur.inventory || []).some(function (o) { return o.f && o.f.light && o.f.on; });
    }

    // Shortest route, over the connections actually walked, to any room that
    // still has something untried. This is how the solver gets unstuck
    // without teleporting: it walks back the way it came.
    function routeTo(test) {
      var start = cur.id, seen = {}, q = [[start, []]];
      seen[start] = 1;
      while (q.length) {
        var pair = q.shift(), id = pair[0], path = pair[1];
        if (path.length && test(rooms[id])) return path;
        var r = rooms[id];
        if (!r) continue;
        for (var dir in r.exits) {
          var to = r.exits[dir];
          if (seen[to]) continue;
          seen[to] = 1;
          q.push([to, path.concat([dir])]);
        }
      }
      return null;
    }

    function wants(r) {
      if (!r) return false;
      // A room abandoned for want of a lamp is worth another visit once one
      // is lit.
      if (r.needsLight && lampLit()) {
        r.needsLight = 0;
        r.untried = DIRS.filter(function (d) { return !r.exits[d]; });
      }
      return r.untried.length > 0;
    }

    // The next thing worth trying here, in order of how much it usually pays.
    function choose() {
      var r = room(cur.id);

      // In the dark, light the lamp; without one, go back the way you came.
      // Groping about in an unlit room is how a solver racks up hundreds of
      // grue deaths and learns nothing: every direction is fatal, so trying
      // them all just costs rewinds.
      if (DARK.test(cur.output || "") && !lampLit()) {
        if (haveLamp()) return "turn on lamp";
        r.needsLight = 1;
        r.untried = [];
        if (lastDir && REVERSE[lastDir]) return REVERSE[lastDir];
        var outward = Object.keys(r.exits)[0];
        if (outward) return outward;
      }

      // Daylight: save the battery.
      if (lampLit() && roomIsLit() && !DARK.test(cur.output || "")) {
        return "turn off lamp";
      }

      // Bank treasure whenever standing at the case.
      if (caseRoom === cur.id) {
        var t = carried().filter(function (n) {
          return isTreasure(n) && !deposited[n];
        });
        if (t.length) return "put " + t[0] + " in trophy case";
      }

      // Something alive is in the way. The troll blocks every exit from his
      // room until he is dealt with, so the whole underground hangs on this.
      var weapon = (cur.inventory || []).filter(function (o) {
        return o.f && o.f.weapon;
      })[0];
      var foe = here().filter(function (o) { return o.f && o.f.actor; })[0];
      if (foe && weapon) {
        r.fights = (r.fights || 0) + 0;
        if (r.fights < (opts.maxFights || 18)) {
          r.fights++;
          return "attack " + foe.name + " with " + weapon.name;
        }
      }

      // A full pack and a known case: go and cash it in rather than carry
      // the hoard around the dungeon.
      if (caseRoom !== null && caseRoom !== cur.id) {
        var load = carried().filter(function (n) {
          return isTreasure(n) && !deposited[n];
        });
        if (load.length >= (opts.hoard || 2)) {
          var trip = routeTo(function (x) { return x && x.id === caseRoom; });
          if (trip && trip.length) { queue = trip.slice(); return queue.shift(); }
        }
      }

      // Pick things up, treasure first.
      // A command is issued by noun but the object is known by its printed
      // name; check both, or the same thing is picked up forever.
      var objs = here().filter(function (o) {
        return !r.tried["take " + o.name] && !r.tried["take " + noun(o.name)];
      });
      function rank(o) {
        if (o.f && o.f.light) return 3;
        if (o.f && o.f.weapon) return 2;
        return isTreasure(o.name) ? 1 : 0;
      }
      objs.sort(function (a, b) { return rank(b) - rank(a); });
      for (var i = 0; i < objs.length; i++) {
        var o0 = objs[i], f0 = o0.f || {};
        var worthCarrying = isTreasure(o0.name) || f0.light || f0.weapon;
        if (worthCarrying && (o0.takeable || isTreasure(o0.name))) {
          return "take " + o0.name;
        }
      }
      // Open what is closed: containers hide most of the treasure.
      for (var j = 0; j < objs.length; j++) {
        var o = objs[j];
        if ((o.f && (o.f.container || o.f.door)) && !o.f.open &&
            !r.tried["open " + o.name] && !r.tried["open " + noun(o.name)]) {
          return "open " + o.name;
        }
      }
      // Scenery too -- the window in Behind House is a door with no object
      // in the room to notice.
      var scenery = sceneryHere();
      for (var k = 0; k < scenery.length; k++) {
        var s = lore[scenery[k]] || {};
        var openable = (s.flags || []).some(function (f) {
          return f === "DOORBIT" || f === "CONTBIT";
        });
        if (openable && !r.tried["open " + scenery[k]]) {
          return "open " + scenery[k];
        }
      }

      // ---- go and get what the source says is worth having ----
      var at = zilHere();
      if (at) {
        if (String(cur.name) === "Living Room") caseZil = at;

        // Arrived where a prize lives: open whatever it is inside, take it.
        if (goal && goal.room === at) {
          var target = goal;
          goal = null;
          var steps = target.via.filter(function (c) {
            return !r.tried["open " + c];
          }).map(function (c) { return "open " + c; });
          steps.push("take " + target.name);
          giveUp[target.name] = 1;      // one attempt each; the source says
          queue = steps.slice();        // where it is, not how to earn it
          return queue.shift();
        }

        var holding = carried().filter(function (n) {
          return isTreasure(n) && !deposited[n];
        });

        // Take the hoard home when it is worth the walk.
        if (caseZil && holding.length >= (opts.hoard || 2)) {
          var home = zilRoute(at, caseZil);
          if (home && home.length) {
            goal = null;
            queue = home.slice();
            return queue.shift();
          }
        }

        // Otherwise head for the best prize per step of walking.
        if (!goal) {
          var best = null;
          prizes.forEach(function (t) {
            if (deposited[t.name] || giveUp[t.name]) return;
            if (carried().indexOf(t.name) >= 0) return;
            var path = zilRoute(at, t.room);
            if (!path) return;
            var value = t.worth / (path.length + 2);
            if (!best || value > best.value) {
              best = { value: value, path: path, t: t };
            }
          });
          if (best) {
            tries[best.t.name] = (tries[best.t.name] || 0) + 1;
            if (tries[best.t.name] > (opts.maxTries || 6)) {
              giveUp[best.t.name] = 1;
              return choose();
            }
            goal = { name: best.t.name, room: best.t.room, via: best.t.via };
            if (best.path.length) {
              queue = best.path.slice();
              return queue.shift();
            }
          }
        }
      }

      if (r.untried.length) return r.untried[0];

      // Shove and peer under whatever is lying about. This is how the trap
      // door is found: the rug has no flag that hints at it, and the entire
      // underground hangs off moving it.
      for (var m = 0; m < objs.length; m++) {
        var f = objs[m].f || {};
        if (f.take || f.actor) continue;
        var nm = objs[m].name;
        if (!r.tried["move " + nm]) return "move " + nm;
        if (!r.tried["look under " + nm]) return "look under " + nm;
      }

      // Carrying a hoard and nothing to do here: go and cash it in.
      if (caseRoom !== null && carried().some(function (n) {
        return isTreasure(n) && !deposited[n];
      })) {
        var back = routeTo(function (x) { return x && x.id === caseRoom; });
        if (back && back.length) { queue = back.slice(); return queue.shift(); }
      }

      var path = routeTo(wants);
      if (path && path.length) { queue = path.slice(); return queue.shift(); }

      // Out of ideas -- but the dungeon is not what it was when those walls
      // were recorded. Opening a window or a trap door turns a refusal into
      // a doorway, so give every blocked direction another go before
      // declaring the map finished.
      if (sweeps < (opts.sweeps === undefined ? 3 : opts.sweeps)) {
        sweeps++;
        var again = false;
        Object.keys(rooms).forEach(function (id) {
          var x = rooms[id];
          Object.keys(x.blocked).forEach(function (d) {
            x.untried.push(d);
            delete x.blocked[d];
            delete x.tried[d];
            again = true;
          });
        });
        if (again) return choose();
      }
      return null;
    }

    function step() {
      if (stats.done) return false;
      if (stats.moves >= (opts.maxMoves || 4000)) {
        stats.done = true;
        stats.why = "move budget spent";
        return false;
      }

      // Darkness outranks the itinerary. A queued route walks through unlit
      // rooms as happily as lit ones, and a grue does not care that you were
      // only passing through.
      var cmd;
      if (DARK.test(cur.output || "") && !lampLit() && haveLamp()) {
        cmd = "turn on lamp";
      } else {
        cmd = queue.length ? queue.shift() : choose();
      }
      if (!cmd) {
        stats.done = true;
        stats.why = "nothing left untried that it can reach";
        return false;
      }

      var r = room(cur.id), from = cur.id, before = cur.score;
      var isMove = DIRS.indexOf(cmd) >= 0;
      if (isMove) r.untried = r.untried.filter(function (d) { return d !== cmd; });
      r.tried[cmd] = 1;

      var mark = engine.mark();
      var res = engine.command(cmd);
      stats.moves++;

      // Death is a dead end, not the end: take it back and never try that
      // move from this room again.
      if (DIED.test(res.output || "")) {
        stats.deaths++;
        if (engine.rewind(mark)) {
          if (isMove) {
            r.blocked[cmd] = 1;
            var zf = zilHere();
            if (zf && zil[zf]) {
              zil[zf].exits.forEach(function (e) {
                if ((WORD[e.dir] || "") === cmd) zilBlocked[zf + ">" + e.dir] = 1;
              });
            }
          }
          queue = [];
          goal = null;
          log.push({ cmd: cmd, note: "fatal, rewound" });
          return true;   // deliberately not reported: it did not happen
        }
      }

      cur = res;
      stats.score = res.score;

      if (res.name === "Living Room") caseRoom = res.id;
      if (isMove) {
        if (res.moved) {
          r.exits[cmd] = res.id;
          lastDir = cmd;
          room(res.id);
        } else {
          r.blocked[cmd] = 1;
          // The source lists exits that a flag may be holding shut. Record
          // the refusal against the source graph too, so the next route is
          // planned around it rather than into it again.
          var z = zilHere();
          if (z && zil[z]) {
            zil[z].exits.forEach(function (e) {
              if ((WORD[e.dir] || "") === cmd) zilBlocked[z + ">" + e.dir] = 1;
            });
          }
          queue = [];
          goal = null;
        }
      }
      // An open door is a new exit: let this room's refusals be retried.
      if (/^(open|unlock|move)\b/.test(cmd) && !REFUSED.test(res.output || "")) {
        Object.keys(r.blocked).forEach(function (d) {
          r.untried.push(d);
          delete r.blocked[d];
          delete r.tried[d];
        });
      }
      if (/^put /.test(cmd) && res.score > before) {
        deposited[cmd.replace(/^put | in trophy case$/g, "")] = 1;
        stats.treasures++;
      }

      // Only moves that stuck are reported, so a watching map never draws a
      // room the solver died in and took back.
      if (opts.onKept) opts.onKept(cmd, res, isMove ? cmd : null);
      stats.rooms = Object.keys(rooms).length;
      if (res.score > before) {
        log.push({ cmd: cmd, note: "+" + (res.score - before) });
      }
      return true;
    }

    return {
      step: step,
      stats: stats,
      log: log,
      rooms: rooms,
      current: function () { return cur; }
    };
  }

  return { create: create };
})();
