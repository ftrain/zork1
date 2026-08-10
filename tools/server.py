#!/usr/bin/env python3
"""Serve the clickable map, and optionally a live game of Zork I behind it.

The map in web/ works on its own against the graph extracted from the ZIL
source. Point it at this server instead and every click is executed by a real
Z-machine interpreter running zork1.zip, so the map is drawn from the game's
own room object numbers rather than from the source listing.

The interpreter comes from zwalker (https://github.com/avwohl/zwalker):

    pip install git+https://github.com/avwohl/zwalker

Usage:
    python3 tools/server.py [--port 8080] [--game zork1.zip]

Single player, single session, in-process. That is all this needs to be.
"""

import argparse
import json
import os
import posixpath
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript",
         ".json": "application/json", ".css": "text/css"}

# Output that means "you did not move", so the direction gets marked blocked
# instead of inventing an edge.
BLOCKED = re.compile(
    r"can't go that way|is closed|You cannot|only dumb|too narrow|impossible",
    re.I)


class Game(object):
    """One live playthrough, with an undo stack."""

    def __init__(self, path):
        from zwalker.walker import GameWalker

        self.path = path
        self.lock = threading.Lock()
        self.session = 0
        self.descs = {}
        self.undo = []
        self.moves = 0
        self.banner = ""
        self.walker = None
        self._new(GameWalker)
        self._Walker = GameWalker

    def _new(self, GameWalker):
        with open(self.path, "rb") as fh:
            data = fh.read()
        self.walker = GameWalker(data, game_file=self.path)
        self.banner = self.walker.start()
        self.descs = {}
        self.undo = []
        self.moves = 0
        self.session += 1
        vm = self.walker.vm
        self.player = safe(vm.detect_player_object, None)
        self.descs[vm.get_current_room()] = describe(
            self.banner, vm.get_current_room_name())

    def restart(self):
        with self.lock:
            self._new(self._Walker)
            return self.snapshot(self.banner)

    def command(self, cmd):
        with self.lock:
            vm = self.walker.vm
            before = vm.get_current_room()
            self.undo.append((vm.save_state(), before, self.moves))
            if len(self.undo) > 200:
                self.undo.pop(0)
            result = self.walker.try_command(cmd, skip_if_tried=False)
            self.moves += 1
            after = vm.get_current_room()
            out = result.output or ""
            if after not in self.descs and after != before:
                self.descs[after] = describe(out, vm.get_current_room_name())
            snap = self.snapshot(out)
            snap["from"] = before
            snap["moved"] = after != before
            snap["blocked"] = (after == before and bool(BLOCKED.search(out)))
            return snap

    def undo_move(self):
        with self.lock:
            if not self.undo:
                return self.snapshot("Nothing to undo.")
            state, room, moves = self.undo.pop()
            self.walker.vm.restore_state(state)
            self.walker.current_room_id = room
            self.moves = moves
            return self.snapshot("Undone.")

    def snapshot(self, output=""):
        vm = self.walker.vm
        room = vm.get_current_room()
        takeable = set(i for i, _ in safe(vm.get_takeable_objects_in_room, []))
        objects = [{"id": i, "name": n, "takeable": i in takeable}
                   for i, n in safe(vm.get_objects_in_room, [])
                   if i != self.player]
        return {
            "session": self.session,
            "id": room,
            "name": vm.get_current_room_name() or "Somewhere",
            "desc": self.descs.get(room, ""),
            "objects": objects,
            "inventory": [{"id": i, "name": n}
                          for i, n in safe(vm.get_inventory, [])],
            "score": safe(vm.get_score, 0),
            "turns": safe(vm.get_turns, 0),
            "moves": self.moves,
            "output": output.strip(),
            "canUndo": bool(self.undo),
        }


def safe(fn, default):
    try:
        return fn()
    except Exception:
        return default


def describe(output, room_name=""):
    """Pull the room description out of a room-entry transcript.

    The game prints the room name on its own line and then the description.
    Cutting at the name also strips the copyright banner off the very first
    room, which otherwise arrives glued to the front of West of House.
    """
    text = re.sub(r"\n?>\s*$", "", output.strip())
    lines = [ln.rstrip() for ln in text.split("\n")]
    start = 0
    for i, line in enumerate(lines):
        if room_name and line.strip() == room_name.strip():
            start = i + 1
    if not start and len(lines) > 1:
        start = 1
    return " ".join(x.strip() for x in lines[start:] if x.strip())


class Handler(BaseHTTPRequestHandler):
    game = None
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/state":
            if not self.game:
                return self.send_json({"error": "no game loaded"}, 503)
            return self.send_json(self.game.snapshot())
        self.serve_file(path)

    def do_POST(self):
        path = self.path.split("?")[0]
        if not self.game:
            return self.send_json({"error": "no game loaded"}, 503)
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self.send_json({"error": "bad json"}, 400)
        if path == "/api/cmd":
            cmd = str(payload.get("cmd", "")).strip()[:120]
            if not cmd:
                return self.send_json({"error": "empty command"}, 400)
            return self.send_json(self.game.command(cmd))
        if path == "/api/restart":
            return self.send_json(self.game.restart())
        if path == "/api/undo":
            return self.send_json(self.game.undo_move())
        self.send_json({"error": "not found"}, 404)

    def serve_file(self, path):
        if path == "/":
            path = "/index.html"
        # Normalize first, then join: keeps ".." from escaping web/.
        rel = posixpath.normpath(path).lstrip("/")
        full = os.path.join(WEB, rel)
        if not os.path.abspath(full).startswith(WEB) or not os.path.isfile(full):
            self.send_error(404)
            return
        with open(full, "rb") as fh:
            body = fh.read()
        ext = os.path.splitext(full)[1]
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--game", default=os.path.join(ROOT, "zork1.zip"))
    args = ap.parse_args()

    try:
        Handler.game = Game(args.game)
        print("live game: %s" % os.path.basename(args.game))
    except ImportError:
        print("zwalker not installed - serving the ZIL atlas only.")
        print("  pip install git+https://github.com/avwohl/zwalker")
    except Exception as exc:
        print("could not start the game (%s) - serving the atlas only." % exc)

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print("http://%s:%d" % (args.host, args.port))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
