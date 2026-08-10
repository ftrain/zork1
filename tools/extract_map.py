#!/usr/bin/env python3
"""Extract the Zork I world graph from the ZIL source into JSON.

Reads 1dungeon.zil (rooms, exits, objects), 1actions.zil (room descriptions
that live inside M-LOOK handlers) and gsyntax.zil (the verb grammar) and
writes web/world.json, which the clickable map in web/index.html consumes.

The grammar matters as much as the map: it is what lets the page offer
every command as a button instead of a text box. A verb is only offered
with as many objects as the parser will actually accept for it.

Usage: python3 tools/extract_map.py
"""

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DIRS = ["NORTH", "SOUTH", "EAST", "WEST", "NE", "NW", "SE", "SW",
        "UP", "DOWN", "IN", "OUT", "LAND"]

# Exits computed by a routine at runtime. The ZIL comments and the routine
# bodies name the destinations; they are transcribed here so the graph stays
# connected instead of dead-ending on a function pointer.
PER_EXITS = {
    ("GRATING-CLEARING", "DOWN"): ("GRATING-ROOM", "if the grating is open"),
    ("LIVING-ROOM", "DOWN"): ("CELLAR", "if the trap door is open"),
    ("LIVING-ROOM", "UP"): ("KITCHEN", "up the chimney, carrying at most one item plus the lamp"),
    ("MAZE-2", "DOWN"): ("MAZE-4", "one-way diode"),
    ("MAZE-7", "DOWN"): ("DEAD-END-1", "one-way diode"),
    ("MAZE-9", "DOWN"): ("MAZE-11", "one-way diode"),
    ("MAZE-12", "DOWN"): ("MAZE-5", "one-way diode"),
}


def read(name):
    with open(os.path.join(ROOT, name), encoding="latin-1") as fh:
        return fh.read()


def forms(text, head):
    """Yield the body of each top-level <HEAD ...> form, brackets balanced."""
    out = []
    for m in re.finditer(r"<" + head + r"\s", text):
        i, depth, in_str = m.start(), 0, False
        while i < len(text):
            c = text[i]
            if in_str:
                if c == '"':
                    in_str = False
            elif c == '"':
                in_str = True
            elif c == "<":
                depth += 1
            elif c == ">":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        out.append(text[m.start():i + 1])
    return out


def props(body):
    """Split a form body into its top-level (PROP ...) property lists."""
    out = []
    i, n = 0, len(body)
    while i < n:
        if body[i] == '"':
            i += 1
            while i < n and body[i] != '"':
                i += 1
        elif body[i] == "(":
            depth, start, in_str = 0, i, False
            while i < n:
                c = body[i]
                if in_str:
                    if c == '"':
                        in_str = False
                elif c == '"':
                    in_str = True
                elif c == "(":
                    depth += 1
                elif c == ")":
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            out.append(body[start:i + 1])
        i += 1
    return out


def strings(s):
    """All double-quoted strings in s, whitespace collapsed."""
    return [re.sub(r"\s+", " ", x).strip()
            for x in re.findall(r'"((?:[^"\\]|\\.)*)"', s, re.S)]


def strip_comments(s):
    """Drop ZIL ;"..." comments so they are not mistaken for content."""
    return re.sub(r';\s*"(?:[^"\\]|\\.)*"', "", s, flags=re.S)


def pretty(name):
    return name.replace("-", " ").title()


# Commands the page handles itself, or that this interpreter cannot honour.
SKIP_VERBS = set("""SAVE RESTORE RESTART QUIT SCRIPT UNSCRIPT VERBOSE BRIEF
SUPER SUPERBRIEF VERSION DEBUG COMMAND""".split())

# Roughly the order a player reaches for them. Anything not listed still
# appears, just behind a "more verbs" tap.
COMMON_VERBS = [
    "take", "drop", "examine", "read", "open", "close", "look", "look under",
    "look behind", "look in", "turn on", "turn off", "move", "push", "pull",
    "search", "unlock", "lock", "tie", "untie", "attack", "kill", "put",
    "throw", "give", "show", "burn", "eat", "drink", "touch", "wear",
    "climb", "enter", "board", "exit", "dig", "fill", "pour", "wave",
    "turn", "wind", "ring", "knock", "count", "smell", "listen", "inventory",
    "wait", "again", "jump", "pray", "diagnose", "score",
]


COMMON_PAIRS = [
    "put in", "put on", "attack with", "kill with", "unlock with",
    "lock with", "tie to", "untie from", "throw at", "give to", "open with",
    "cut with", "burn with", "light with", "dig with", "fill with",
    "pour on", "put under", "look at with", "move with", "turn with",
    "take from", "wave at", "tell about",
]


def verb_grammar(syntax_src):
    """Parse gsyntax.zil into verb phrases grouped by how many objects.

    A SYNTAX line looks like any of:

        <SYNTAX INVENTORY = V-INVENTORY>
        <SYNTAX TAKE OBJECT (FIND TAKEBIT) (ON-GROUND) = V-TAKE>
        <SYNTAX TURN ON OBJECT (FIND ...) = V-LAMP-ON>
        <SYNTAX TIE OBJECT (HELD) TO OBJECT = V-TIE-UP>

    Words before the first OBJECT are the verb phrase ("turn on"), words
    between two OBJECTs are the preposition ("tie X to Y").
    """
    none, one, two = [], [], []
    seen = set()
    for body in forms(syntax_src, "SYNTAX"):
        head = body[1:-1].split("=")[0]
        # Drop the parenthesised parser flag groups; they constrain matching
        # but say nothing about the shape of the phrase.
        head = re.sub(r"\([^)]*\)", " ", head)
        words = head.split()[1:]
        if not words:
            continue
        verb, rest = words[0], words[1:]
        if verb in SKIP_VERBS or not re.match(r"^[A-Z][A-Z\-]*$", verb):
            continue
        phrase = [verb]
        while rest and rest[0] != "OBJECT":
            phrase.append(rest.pop(0))
        text = " ".join(phrase).lower()
        if not rest:
            add(none, seen, ("0", text), {"phrase": text})
            continue
        rest.pop(0)                       # the first OBJECT
        prep = []
        while rest and rest[0] != "OBJECT":
            prep.append(rest.pop(0))
        if not rest:
            add(one, seen, ("1", text), {"phrase": text})
        elif prep:
            # Two objects with nothing between them ("move X Y") is a shape
            # no tap sequence can express unambiguously, so it is dropped.
            p = " ".join(prep).lower()
            add(two, seen, ("2", text, p), {"phrase": text, "prep": p})
    rank = dict((v, i) for i, v in enumerate(COMMON_VERBS))
    key = lambda v: (rank.get(v["phrase"], 999), v["phrase"])
    # Two-object verbs are ranked on the whole phrase. Ranking them on the
    # verb alone floods the top of the list with "take out / take off /
    # take from" and pushes "attack with" out of sight.
    rank2 = dict((v, i) for i, v in enumerate(COMMON_PAIRS))
    key2 = lambda v: (rank2.get(v["phrase"] + " " + v["prep"], 999),
                      v["phrase"], v["prep"])
    return {"none": sorted(none, key=key),
            "one": sorted(one, key=key),
            "two": sorted(two, key=key2)}


def add(target, seen, sig, value):
    if sig not in seen:
        seen.add(sig)
        target.append(value)


def look_texts(actions_src):
    """Map ROUTINE name -> description text printed on M-LOOK."""
    out = {}
    for body in forms(actions_src, "ROUTINE"):
        m = re.match(r"<ROUTINE\s+([A-Z0-9?\-]+)", body)
        if not m:
            continue
        look = re.search(r"M-LOOK\b(.*)", body, re.S)
        if not look:
            continue
        chunk = look.group(1)
        # Stop at the next RARG comparison: that is a different hook.
        cut = re.search(r"EQUAL\?\s+\.RARG", chunk)
        if cut:
            chunk = chunk[:cut.start()]
        # Only the first TELL: later ones are conditional variants that would
        # otherwise be glued into one contradictory paragraph.
        tell = forms(strip_comments(chunk), "TELL")
        parts = strings(tell[0]) if tell else []
        if parts:
            out[m.group(1)] = " ".join(parts).strip()
    return out


def main():
    dungeon = read("1dungeon.zil")
    looks = look_texts(read("1actions.zil"))

    rooms = {}
    for body in forms(dungeon, "ROOM"):
        rid = re.match(r"<ROOM\s+([A-Z0-9?\-]+)", body).group(1)
        room = {
            "id": rid,
            "name": pretty(rid),
            "desc": "",
            "exits": [],
            "blocked": [],
            "objects": [],
            "flags": [],
            "value": 0,
            "action": None,
            "globalIds": [],
            "pseudo": [],
        }
        for p in props(body):
            head = p[1:].split(None, 1)
            key = head[0].rstrip(")")
            rest = head[1][:-1].strip() if len(head) > 1 else ""
            if key == "DESC":
                s = strings(p)
                if s:
                    room["name"] = s[0]
            elif key == "LDESC":
                s = strings(p)
                if s:
                    room["desc"] = s[0]
            elif key == "FLAGS":
                room["flags"] = rest.split()
            elif key == "VALUE":
                room["value"] = int(rest or 0)
            elif key == "ACTION":
                room["action"] = rest
            elif key == "GLOBAL":
                # Scenery the room lets you talk about without it being in
                # the room's object tree: the window, the house, the chimney.
                room["globalIds"] = rest.split()
            elif key == "PSEUDO":
                # Nouns the room fakes up, given as "WORD" ROUTINE pairs.
                room["pseudo"] = [w.lower() for w in strings(p)]
            elif key in DIRS:
                rest_nc = strip_comments(rest).strip()
                to = re.match(r"TO\s+([A-Z0-9?\-]+)(.*)", rest_nc, re.S)
                if to:
                    cond = re.sub(r"\s+", " ", to.group(2)).strip()
                    room["exits"].append({
                        "dir": key,
                        "to": to.group(1),
                        "cond": humanize_cond(cond),
                    })
                    continue
                per = re.match(r"PER\s+([A-Z0-9?\-]+)", rest_nc)
                if per:
                    dest = PER_EXITS.get((rid, key))
                    if dest:
                        room["exits"].append(
                            {"dir": key, "to": dest[0], "cond": dest[1]})
                    else:
                        room["blocked"].append(
                            {"dir": key, "msg": "The way is decided by "
                             + pretty(per.group(1)) + "."})
                    continue
                msg = strings(p)
                if msg:
                    room["blocked"].append({"dir": key, "msg": msg[0]})
        if not room["desc"] and room["action"] in looks:
            room["desc"] = looks[room["action"]]
        if not room["desc"]:
            room["desc"] = "You are in " + room["name"] + "."
        rooms[rid] = room

    # Objects sitting in rooms at game start, plus the scenery objects rooms
    # point at by name.
    names = {}
    everywhere = []
    objflags = {}
    for body in forms(dungeon, "OBJECT"):
        oid = re.match(r"<OBJECT\s+([A-Z0-9?\-]+)", body).group(1)
        loc = name = None
        flags = []
        for p in props(body):
            head = p[1:].split(None, 1)
            key = head[0].rstrip(")")
            rest = head[1][:-1].strip() if len(head) > 1 else ""
            if key == "IN" and re.fullmatch(r"[A-Z0-9?\-]+", rest or ""):
                loc = rest
            elif key == "DESC":
                s = strings(p)
                if s:
                    name = s[0]
            elif key == "FLAGS":
                flags = rest.split()
        names[oid] = name or pretty(oid).lower()
        if name and flags:
            # Keyed by printed name, which is what the interpreter reports at
            # runtime. Used to work out which attribute bit is which flag.
            objflags.setdefault(name.lower(), sorted(set(flags)))
        if loc == "GLOBAL-OBJECTS" and name:
            everywhere.append(name)
        if loc in rooms:
            rooms[loc]["objects"].append({
                "name": name or pretty(oid),
                "treasure": "TREASURE" in body.upper().split("SYNONYM")[-1][:120],
                "takeable": "TAKEBIT" in flags,
            })

    for room in rooms.values():
        room["globals"] = sorted(set(
            [names[g] for g in room.pop("globalIds") if g in names]
            + room.pop("pseudo")))

    # Drop exits pointing at rooms that do not exist (there are none today,
    # but a typo in the source should not produce a dangling click target).
    for room in rooms.values():
        room["exits"] = [e for e in room["exits"] if e["to"] in rooms]

    world = {
        "start": "WEST-OF-HOUSE",
        "rooms": [rooms[k] for k in rooms],
        "verbs": verb_grammar(read("gsyntax.zil")),
        "everywhere": sorted(set(everywhere)),
        "objectFlags": objflags,
    }
    out = os.path.join(ROOT, "web", "world.json")
    with open(out, "w") as fh:
        json.dump(world, fh, indent=1, sort_keys=True)

    # Same data as a script tag, so the map also opens straight off disk
    # without a web server (fetch() is blocked on file:// URLs).
    with open(os.path.join(ROOT, "web", "world.js"), "w") as fh:
        fh.write("window.WORLD = ")
        json.dump(world, fh, sort_keys=True)
        fh.write(";\n")

    verbs = world["verbs"]
    print("verbs: %d none, %d one-object, %d two-object" % (
        len(verbs["none"]), len(verbs["one"]), len(verbs["two"])))
    edges = sum(len(r["exits"]) for r in rooms.values())
    print("rooms: %d  exits: %d  blocked: %d  objects: %d" % (
        len(rooms), edges,
        sum(len(r["blocked"]) for r in rooms.values()),
        sum(len(r["objects"]) for r in rooms.values())))
    print("wrote " + out)


def humanize_cond(cond):
    """Turn `IF TRAP-DOOR IS OPEN` into readable prose."""
    if not cond:
        return ""
    m = re.match(r"IF\s+([A-Z0-9?\-]+)\s+IS\s+([A-Z]+)", cond)
    if m:
        return "if the %s is %s" % (pretty(m.group(1)).lower(),
                                    m.group(2).lower())
    m = re.match(r"IF\s+([A-Z0-9?\-]+)", cond)
    if m:
        return "if " + pretty(m.group(1)).lower()
    return re.sub(r"\s+", " ", cond).strip()


if __name__ == "__main__":
    main()
