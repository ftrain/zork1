# Zork I as a clickable graph

A roguelike-style map of Zork I. No parser, no typing, no server: you click
an exit and the map grows into the empty plane around you, one room at a
time.

Open `web/index.html`. That is the whole setup — it runs the same off a
local disk as it does on GitHub Pages.

There are two ways to walk it.

## Atlas — the whole dungeon at once

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

## The game — the same map, actually playing

Press **play the game**. Every click now runs a real command in `zork1.zip`,
the 1983 release, on a Z-machine interpreter running in the page.

The map is built from the game's own room object numbers rather than from
what the game prints, so the twelve rooms that all say "This is part of a
maze of twisty little passages, all alike" map as twelve distinct rooms.

Because it is the real game, the real rules apply. The trap door is under
the rug. The cellar is pitch black and something lives there. The troll
blocks every exit until you deal with him.

* the compass greys out directions the game has refused, greens the ones
  that worked, and blues the ones the ZIL source says exist but you have not
  tried yet
* objects in the room come with **take / examine / open / read** buttons
* **undo** rewinds the interpreter — useful, since exploring Zork by
  clicking is an efficient way to get eaten
* a text box is there for the handful of things buttons cannot express
  (`move rug`, `kill troll with sword`)

## What is in here

    index.html      the map, the panel, both modes
    engine.js       Glk shim + Z-machine introspection + turn loop
    vendor/zvm.js   ifvms.js by Dannii Willis (MIT), the interpreter itself
    story.js        zork1.zip, base64, so no fetch is needed
    world.js        the graph extracted from the ZIL source
    world.json      the same graph, for anything else that wants it

`engine.js` is the interesting half. ZVM speaks Glk, which normally means a
whole terminal UI; the shim implements just enough of it to collect the
text and hand over one line of input. The map data does not come from that
text at all — `Peek` reads the Z-machine object table and globals straight
out of VM memory for the current room, its contents, your inventory and the
score. The object-number conventions (score in global 17, takeable as
attribute 17, finding the player object by name) are the ones worked out in
[zwalker](https://github.com/avwohl/zwalker), whose Python interpreter this
was first prototyped against.

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

## Publishing it

`.github/workflows/pages.yml` publishes `web/` to GitHub Pages on every push
to `master`, and can be run by hand from the Actions tab. It needs one
setting flipped once: **Settings → Pages → Build and deployment → Source →
GitHub Actions**.

If you would rather not use Actions, rename `web/` to `docs/` and point
**Settings → Pages** at the `master` branch, `/docs` folder. Every path in
the page is relative, so it works from any subdirectory.

## Layout

The dungeon does not fit in a plane — corridors loop back on themselves and
two directions often land in the same place — so rooms are placed at their
natural compass offset, and when that cell is taken they spiral out to the
nearest free one. The edge is still drawn, so the true connection survives
however far the box slid. Vertical moves (up, down, in, out) are drawn as
dashed labelled lines, one-way passages get an arrowhead, and exits into
rooms you have not visited trail off into a dashed `?`.
