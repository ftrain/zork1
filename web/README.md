# Zork I as a clickable graph

A roguelike-style map of Zork I. No parser, no typing: you click an exit and
the map grows into the empty plane around you, one room at a time.

There are two ways to walk it.

## Atlas mode — the whole dungeon, no install

Open `web/index.html` in a browser. That is the entire setup.

The graph comes from the ZIL source in this repository, extracted by
`tools/extract_map.py`: 110 rooms, 314 exits, 38 walls with the game's own
refusal message attached, and the objects each room starts with. Because it
is read out of the source rather than played, every exit is clickable from
the start — including the ones a real game gates behind a flag, which are
labelled with their condition (`if the trap door is open`).

* click an exit, or use arrow keys / `hjkl` / `yubn`, or the number keys
* click any room you have already found to jump there
* **reveal all** lays out all 110 rooms at once — the whole dungeon as one
  object, which is the fastest way to see the shape of the thing
* progress is kept in `localStorage`; **reset** clears it

## Live mode — the same map, playing the real game

    pip install git+https://github.com/avwohl/zwalker
    python3 tools/server.py            # http://127.0.0.1:8080

Then press **play live**.

Now every click is a real command sent to `zork1.zip`, the 1983 Z-machine
release, running on [zwalker](https://github.com/avwohl/zwalker)'s
interpreter. The map is built from the game's own room object numbers, so
the twelve rooms that all say "This is part of a maze of twisty little
passages, all alike" still map as twelve distinct rooms.

Because it is the real game, the real rules apply. The trap door is under
the rug. The cellar is pitch black and something lives there. You start with
no lamp.

* the compass greys out directions the game has refused, greens the ones
  that worked, and blues the ones the ZIL source says exist but you have not
  tried yet
* objects in the room come with **take / examine / open / read** buttons
* **undo** rewinds the interpreter — useful, since exploring Zork by
  clicking is an efficient way to get eaten
* a text box is there for the handful of things buttons cannot express
  (`move rug`, `tie rope to railing`)

## Regenerating the graph

    python3 tools/extract_map.py

Reads `1dungeon.zil` for rooms, exits and objects, and `1actions.zil` for the
room descriptions that live inside `M-LOOK` handlers rather than in an
`LDESC` property. Writes `web/world.json` and `web/world.js` (the same data as
a script tag, so the map also opens straight off disk, where `fetch` is
blocked).

Seven exits in the source are computed by a routine at runtime rather than
declared (`DOWN PER TRAP-DOOR-EXIT`, the four maze diodes). Their
destinations are transcribed in the `PER_EXITS` table at the top of the
extractor so the atlas stays connected.

## Layout

The dungeon does not fit in a plane — corridors loop back on themselves and
two directions often land in the same place — so rooms are placed at their
natural compass offset, and when that cell is taken they spiral out to the
nearest free one. The edge is still drawn, so the true connection survives
however far the box slid. Vertical moves (up, down, in, out) are drawn as
dashed labelled lines, one-way passages get an arrowhead, and exits into
rooms you have not visited trail off into a dashed `?`.
