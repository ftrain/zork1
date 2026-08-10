/* Zork I in the browser, with the map reading over the interpreter's shoulder.
 *
 * Three pieces:
 *
 *   makeGlk()   a minimal Glk implementation. ZVM talks to the outside world
 *               through Glk; the real one draws a whole terminal. This one
 *               collects the text and hands over a line of input, which is
 *               all a map needs.
 *
 *   Peek        reads the Z-machine's object table and globals directly out
 *               of VM memory: which room you are in (by object number, not by
 *               name, so the maze maps correctly), what is lying there, what
 *               you are carrying, and the score.
 *
 *   Engine      drives the two together and returns the same snapshot shape
 *               the map already knows how to draw.
 *
 * ZVM is ifvms.js by Dannii Willis, MIT licensed, vendored in vendor/.
 */
window.ZorkEngine = (function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Glk, reduced to what ZVM actually calls.
   * ------------------------------------------------------------------ */

  function makeGlk() {
    var main = null, current = null;

    function RefBox() { this.value = 0; }
    RefBox.prototype.get_value = function () { return this.value; };
    RefBox.prototype.set_value = function (v) { this.value = v; };

    function RefStruct() { this.fields = []; }
    RefStruct.prototype.push_field = function (v) { this.fields.push(v); };
    RefStruct.prototype.set_field = function (i, v) { this.fields[i] = v; };
    RefStruct.prototype.get_field = function (i) { return this.fields[i]; };

    function Win(type) { this.type = type; this.str = { win: this }; }

    var glk = {
      out: [],           // text printed to the main window
      lineRequest: null, // {win, buffer} while the game waits for a command
      charRequest: null,
      quit: false,
      error: null,

      RefBox: RefBox,
      RefStruct: RefStruct,

      // Only the text buffer window is the game's prose; the text grid
      // window is the status line, which the map already shows better.
      write: function (str, text) {
        if (str && str.win && str.win.type === 3) glk.out.push(text);
      },

      glk_window_open: function (parent, method, size, wintype) {
        var w = new Win(wintype);
        if (wintype === 3 && !main) { main = w; current = w; }
        return w;
      },
      glk_window_close: function () {},
      glk_window_get_parent: function () { return null; },
      glk_window_get_stream: function (win) { return win ? win.str : null; },
      glk_window_get_size: function (win, width, height) {
        if (width) width.set_value(80);
        if (height) height.set_value(24);
      },
      glk_window_clear: function () {},
      glk_window_move_cursor: function () {},
      glk_window_set_arrangement: function () {},
      glk_window_iterate: function () { return 0; },
      glk_set_window: function (win) { current = win; },

      glk_put_jstring: function (text) {
        glk.write(current ? current.str : null, text);
      },
      glk_put_jstring_stream: function (str, text) { glk.write(str, text); },
      glk_put_char_stream_uni: function (str, ch) {
        glk.write(str, String.fromCharCode(ch));
      },
      glk_put_buffer_stream: function (str, buf) {
        glk.write(str, String.fromCharCode.apply(null, buf));
      },

      glk_request_line_event_uni: function (win, buffer) {
        glk.lineRequest = { win: win, buffer: buffer };
      },
      glk_request_char_event_uni: function (win) { glk.charRequest = win; },
      glk_select: function () {},
      update: function () {},
      glk_exit: function () { glk.quit = true; },
      fatal_error: function (e) { glk.error = e; },

      // Styling, colour and the save/restore file machinery are all things
      // this map has no use for. Saying "not supported" is a complete answer.
      glk_gestalt: function () { return 0; },
      glk_set_style: function () {},
      glk_stylehint_set: function () {},
      glk_stylehint_clear: function () {},
      garglk_set_zcolors_stream: function () {},
      garglk_set_reversevideo: function () {},
      garglk_set_reversevideo_stream: function () {},
      glk_stream_iterate: function () { return 0; },
      glk_stream_close: function () {},
      glk_stream_open_file: function () { return null; },
      glk_stream_open_file_uni: function () { return null; },
      glk_get_line_stream_uni: function () { return 0; },
      glk_get_char_stream_uni: function () { return -1; },
      glk_get_buffer_stream: function () { return 0; },
      glk_fileref_create_by_prompt: function () { return null; },
      glk_fileref_destroy: function () {},
      save_allstate: function () { return {}; },
      restore_allstate: function () {}
    };
    return glk;
  }

  /* ------------------------------------------------------------------ *
   * Reading the Z-machine's own world model out of memory.
   * Version 3 layout throughout: 31 property defaults, 9 bytes per object.
   * ------------------------------------------------------------------ */

  var A0 = "abcdefghijklmnopqrstuvwxyz";
  var A1 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var A2 = " \n0123456789.,!?_#'\"/\\-:()";
  var ATTR_TAKEABLE = 17;   // Infocom's convention, as zwalker documents
  var PLAYER_NAMES = ["cretin", "adventurer", "protagonist", "player", "yourself"];

  function Peek(vm) { this.vm = vm; this.player = null; }

  Peek.prototype.b = function (a) { return this.vm.m.getUint8(a); };
  Peek.prototype.w = function (a) { return this.vm.m.getUint16(a); };

  Peek.prototype.objAddr = function (n) {
    if (n < 1 || n > 255) return 0;
    return this.w(0x0A) + 62 + (n - 1) * 9;
  };
  Peek.prototype.parent = function (n) { return this.b(this.objAddr(n) + 4); };
  Peek.prototype.sibling = function (n) { return this.b(this.objAddr(n) + 5); };
  Peek.prototype.child = function (n) { return this.b(this.objAddr(n) + 6); };
  Peek.prototype.attr = function (n, a) {
    return (this.b(this.objAddr(n) + (a >> 3)) >> (7 - (a & 7))) & 1;
  };

  Peek.prototype.name = function (n) {
    var addr = this.objAddr(n);
    if (!addr) return "";
    var props = this.w(addr + 7);
    if (!props || !this.b(props)) return "";
    return this.zstring(props + 1);
  };

  // Z-string decoding: 5-bit characters, three to a word, high bit ends it.
  Peek.prototype.zstring = function (addr) {
    var out = "", zc = [], word, i;
    for (i = 0; i < 400; i++) {
      word = this.w(addr + i * 2);
      zc.push((word >> 10) & 0x1F, (word >> 5) & 0x1F, word & 0x1F);
      if (word & 0x8000) break;
    }
    var alpha = 0, k = 0;
    while (k < zc.length) {
      var c = zc[k++];
      if (c === 0) { out += " "; alpha = 0; continue; }
      if (c === 1 || c === 2 || c === 3) {
        // Abbreviation: the next character indexes one of three banks.
        var next = zc[k++];
        var entry = this.w(this.w(0x18) + ((c - 1) * 32 + next) * 2);
        out += this.zstring(entry * 2);
        alpha = 0;
        continue;
      }
      if (c === 4) { alpha = 1; continue; }
      if (c === 5) { alpha = 2; continue; }
      if (alpha === 2 && c === 6) {
        // Ten-bit ZSCII, split across the next two characters.
        out += String.fromCharCode((zc[k] << 5) | zc[k + 1]);
        k += 2;
        alpha = 0;
        continue;
      }
      out += (alpha === 0 ? A0 : alpha === 1 ? A1 : A2).charAt(c - 6);
      alpha = 0;
    }
    return out;
  };

  Peek.prototype.room = function () { return this.w(this.w(0x0C)); };
  Peek.prototype.score = function () {
    var v = this.w(this.w(0x0C) + 2);          // global 17
    return v > 32767 ? v - 65536 : v;
  };
  Peek.prototype.turns = function () { return this.w(this.w(0x0C) + 4); };

  Peek.prototype.contents = function (n) {
    var out = [], c = this.child(n), guard = 0;
    while (c && guard++ < 200) {
      out.push({ id: c, name: this.name(c), takeable: !!this.attr(c, ATTR_TAKEABLE) });
      c = this.sibling(c);
    }
    return out;
  };

  Peek.prototype.playerObject = function () {
    if (this.player !== null) return this.player;
    for (var n = 1; n < 256; n++) {
      var name = this.name(n).toLowerCase();
      if (name && PLAYER_NAMES.some(function (p) { return name.indexOf(p) >= 0; })) {
        return (this.player = n);
      }
    }
    return (this.player = 0);
  };

  /* ------------------------------------------------------------------ *
   * The engine the map talks to.
   * ------------------------------------------------------------------ */

  // Output that means the move did not happen, so the direction is recorded
  // as a wall instead of inventing an edge.
  var BLOCKED = /can't go that way|is closed|You cannot|only dumb|too narrow|impossible/i;

  function bytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function Engine(story) {
    this.story = story;
    this.session = 0;
    this.boot();
  }

  Engine.prototype.boot = function () {
    this.glk = makeGlk();
    this.vm = new window.ZVM();
    this.vm.prepare(this.story.slice(0), { Glk: this.glk });
    this.vm.start();
    this.peek = new Peek(this.vm);
    this.descs = {};
    this.undoStack = [];
    this.moves = 0;
    this.session++;
    this.settle();
    var out = this.drain();
    this.banner = out;
    this.descs[this.peek.room()] = describe(out, this.peek.name(this.peek.room()));
    return out;
  };

  // Run the VM forward until it is waiting for a typed command, answering
  // any keypress prompts along the way so nothing can wedge.
  Engine.prototype.settle = function () {
    var guard = 0;
    while (!this.vm.quit && !this.glk.lineRequest && guard++ < 40) {
      if (this.glk.charRequest) {
        this.glk.charRequest = null;
        this.event([2, null, 13, 0]);
        continue;
      }
      if (this.vm.glk_blocking_call) { this.vm.resume(null); continue; }
      break;
    }
  };

  Engine.prototype.event = function (fields) {
    this.vm.glk_event = new this.glk.RefStruct();
    for (var i = 0; i < fields.length; i++) this.vm.glk_event.push_field(fields[i]);
    this.vm.resume();
  };

  Engine.prototype.drain = function () {
    var text = this.glk.out.join("");
    this.glk.out = [];
    return text;
  };

  Engine.prototype.command = function (text) {
    if (this.vm.quit || !this.glk.lineRequest) return this.snapshot("The game is over.");
    var before = this.peek.room();
    this.undoStack.push({
      quetzal: this.vm.save_file(this.vm.pc, 1),
      moves: this.moves
    });
    if (this.undoStack.length > 60) this.undoStack.shift();

    var req = this.glk.lineRequest;
    this.glk.lineRequest = null;
    var n = Math.min(text.length, req.buffer.length);
    for (var i = 0; i < n; i++) req.buffer[i] = text.charCodeAt(i);
    this.event([3, req.win, n, 0]);
    this.settle();

    var out = this.drain();
    this.moves++;
    var after = this.peek.room();
    if (after !== before && !this.descs[after]) {
      this.descs[after] = describe(out, this.peek.name(after));
    }
    var snap = this.snapshot(out);
    snap.from = before;
    snap.moved = after !== before;
    snap.blocked = after === before && BLOCKED.test(out);
    return snap;
  };

  // Rewinding is a restore, not a replay. The snapshot was taken while the
  // game sat waiting for a command, and the pending read outlives the
  // restore: the interpreter keeps the same input buffer and resumes at the
  // same instruction. So the line request must be left armed, and the VM
  // must not be run — the next command drives it forward as usual.
  Engine.prototype.undo = function () {
    if (!this.undoStack.length || this.vm.quit || !this.glk.lineRequest) {
      return this.snapshot("Nothing to undo.");
    }
    var prev = this.undoStack.pop();
    if (!this.vm.restore_file(prev.quetzal, 1)) {
      return this.snapshot("The interpreter would not rewind that far.");
    }
    this.moves = prev.moves;
    this.drain();
    return this.snapshot("Undone.");
  };

  Engine.prototype.restart = function () { return this.snapshot(this.boot()); };

  Engine.prototype.snapshot = function (output) {
    var room = this.peek.room();
    var player = this.peek.playerObject();
    var self = this;
    return {
      session: this.session,
      id: room,
      name: this.peek.name(room) || "Somewhere",
      desc: this.descs[room] || "",
      objects: this.peek.contents(room).filter(function (o) {
        return o.id !== player && o.name;
      }),
      inventory: player ? this.peek.contents(player).filter(function (o) {
        return o.name;
      }) : [],
      score: this.peek.score(),
      turns: this.peek.turns(),
      moves: this.moves,
      output: String(output || "").trim(),
      canUndo: this.undoStack.length > 0,
      over: !!this.vm.quit
    };
  };

  // The game prints the room name on its own line and then the description.
  // Cutting at the name also strips the copyright banner off the very first
  // room, which otherwise arrives glued to the front of West of House.
  function describe(output, roomName) {
    var text = String(output || "").replace(/\n?>\s*$/, "").trim();
    var lines = text.split("\n").map(function (l) { return l.trim(); });
    var start = 0;
    for (var i = 0; i < lines.length; i++) {
      if (roomName && lines[i] === roomName.trim()) start = i + 1;
    }
    if (!start && lines.length > 1) start = 1;
    return lines.slice(start).filter(Boolean).join(" ");
  }

  return {
    create: function () {
      if (!window.ZVM || !window.ZORK_STORY) return null;
      return new Engine(bytes(window.ZORK_STORY));
    }
  };
})();
