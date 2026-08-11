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

Nothing is hidden here. The atlas is for reading the game, not playing it,
so every room lists what is in it — including things the game keeps
invisible until something reveals them, labelled as such.

Each thing is shown with what it is (*a container · looks portable but is
not · holds 10*), how the game first presents it, what it is worth, and
**what it answers to**: the verbs its `ACTION` routine handles, the
condition each one is guarded by, and the exact words it replies with.

    trap door    a door · hidden until something reveals it
      close / open   in Living Room
        "The door reluctantly opens to reveal a rickety staircase…"
        "The door swings shut and closes."
      look under     when the trap door is open
        "You see a rickety staircase descending into darkness."

Rooms get the same treatment under **what happens here** — the Cellar
tells you up front that the trap door crashes shut behind you.

This is read out of `1actions.zil` by a small ZIL reader in the extractor.
It walks each routine's `COND` clauses, taking the verbs from `<VERB? …>`,
the condition from `<EQUAL? ,HERE …>` and `<FSET? … >`, and the replies
from the `TELL` forms. The pieces of a single `TELL` are joined with an
ellipsis, because the gaps are where the game splices in an object's name
at runtime — *"You would have to get the … first"* is one message with a
hole in it, not two messages.

72 of the 120 objects have behaviour worth showing; 28 rooms do.

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
* **undo** rewinds the interpreter — useful, since exploring Zork by
  clicking is an efficient way to get eaten

## Playing it with no keyboard at all

Everything the parser accepts is reachable by tapping, which is the whole
point on a phone. Tap a thing, then tap what to do with it; if the verb
needs a second thing, tap that too. `move rug`, `open trap door`,
`attack troll with sword` are all three-tap sequences.

The verbs are not a guessed list — `tools/extract_map.py` parses the 267
SYNTAX lines in `gsyntax.zil`, the actual grammar the game was compiled
with, and groups them by how many objects each takes. A verb is only ever
offered in a shape the parser will accept. The dozen most-reached-for come
first; the other 185 are one tap further in, under **more verbs**.

Three things supply the nouns:

* what the interpreter reports in the room, minus anything still flagged
  invisible — so the trap door does not appear, or become tappable, until
  you have moved the rug
* what you are carrying, in its own section
* the scenery the ZIL source lists for that room. This one matters more
  than it sounds: the kitchen window is in no room's object tree, so
  without it there would be no way to open the window without typing —
  and no way into the house

## Knowing what a thing is

Each thing is listed with what it actually is — *a closed container*, *a
lamp, not lit*, *a weapon*, *an open container · holding leaflet* — and
with the two or three verbs that suit it. The lamp offers **turn on**, and
**turn off** once it is lit. A container offers **open**, then **look in**
once open, and whatever is inside gets its own indented row, so the leaflet
in the mailbox is a thing you take rather than a detail of the mailbox.

Weapons, tools and containers also appear as the *second* object of a
command: tapping the sword offers *attack … with sword*, and then asks who.
Without that, a weapon in your hands has nothing to say about the troll in
front of you.

This comes from the object's attribute bits, which the page reads out of VM
memory. Working out which bit means what was the interesting part, and it
was solved rather than guessed:

* `extract_map.py` emits every object's `FLAGS` from the ZIL source, keyed
  by printed name
* matching those 118 objects against the compiled object table and looking
  for the bit set on exactly the objects carrying a given flag pins
  nineteen flags outright; correlation settles five more at 99% agreement
  (not 100% — this repository's source is a snapshot that does not exactly
  match the 1983 binary)
* `ONBIT` could not be separated from `FLAMEBIT` that way, since everything
  that starts lit carries both. Lighting the brass lantern and watching bit
  19 turn on, then dousing it and watching the same bit clear, settles it

The result is in `ATTR` at the top of `engine.js`.

Objects with no telling flags — the living room rug is one, and it hides
the trap door the whole opening depends on — fall back to **move**, **look
under** and **push**, so nothing is ever a dead end offering only *examine*.

A **type instead** button is still there for a desktop keyboard. Nothing
requires it.

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

## A complete game, deterministically

**replay a win** plays Zork I from the opening to 350 out of 350 points in
499 moves, drawing the map as it goes: 82 rooms and 129 connections by the
end. Two runs produce byte-identical transcripts — 42,243 characters,
sha256 `a46db90bdbf43677…`.

Determinism in a Z-machine comes from the interpreter, not the story file.
ZVM's `RANDOM` falls back to `Math.random` only while its seed is zero and
runs a deterministic xorshift otherwise, so pinning the seed pins the whole
run — the thief's wanderings, the troll's swings, everything.

That also means a seed is not portable between interpreters. The command
list is zwalker's verified solution
([solutions/zork1_verified.json](https://github.com/avwohl/zwalker)), found
and checked against its own Python interpreter under its seed 3. Replayed
here, seed 3 dies in a trap at 10 points; seed 42 runs the same 431 commands
to 350 points in 499 moves — the same move count zwalker recorded, which is
good evidence the two interpreters agree about everything except the dice.

Finding it was a search over seeds, which is exactly how zwalker verifies
its own solutions. Of ten seeds tried, one won, two got past 300, and three
died on the way.

## A solver that has not read the walkthrough

**let it solve** turns `solver.js` loose. It knows only what the interface
knows — the room it is in by object number, what is lying there, what it is
carrying, the score, and which things the ZIL marks as treasure. It has no
walkthrough.

What makes it workable is save/restore. Every command is taken behind a
mark, so a move that kills you is rewound and struck off the list for that
room; the map never shows a room it died in and took back. A typical run
rewinds a few hundred deaths and is none the worse.

It reaches **59 out of 350** and maps a little over half the dungeon —
around 55 rooms of 110 — stopping when nothing has been gained for 400
moves. Seeds vary: 59 and 60 on two of the three tried, 40 on the third.

Its goals come out of the ZIL rather than out of luck. The source says what
is worth points and where it starts, so the extractor resolves each
treasure to a room, following container chains where it has to: the sceptre
is in the coffin, the coffin is in the Egyptian Room; the canary is in the
egg, in the nest, up a tree. Seventeen of the twenty-one treasures place
this way. The solver then routes over the source's own exit table, which
lets it walk to a room it has never seen, and records a refusal against
that edge when a gated exit turns out to be shut.

Three things it learned the hard way, each of which is a real property of
Zork rather than a coding slip:

* **The window.** It sat outside the house scoring nothing until it could
  refer to the kitchen window, which is in no room's object tree. The
  per-room `GLOBAL` list from the ZIL is what let it in.
* **The troll.** He blocks every exit from his room, so with no notion of
  attacking, the whole underground was unreachable: 24 rooms became 52 the
  moment it would swing a sword at something alive.
* **The lamp.** Groping about an unlit room means twelve fatal directions
  and nothing learned, and a routed path walks through darkness as happily
  as daylight. Lighting the lamp on entering the dark, retreating when
  there is no lamp, and dousing it in rooms the ZIL marks lit — the battery
  is finite — cut deaths from around 300 to under 80.

Routing is not the problem: it reaches End of Rainbow, Up a Tree, the Loud
Room, the maze and the Gallery, and picks up the coins and the painting.
Getting them *home* is, and that took a plan rather than a habit.

The trap door bars itself behind you, so the underground is a one-way trip.
The only way back is the chimney in the Studio, and the chimney will not
take more than one item besides the lamp. The ferry handles it: stash
everything on the Studio floor, climb with one piece, bank it, go back down
through the trap door, repeat. That is what turns treasure carried into
treasure scored — the difference between 54 and 59.

It is worth being plain that this is hand-written knowledge. The solver did
not work the ferry out; it was told. Everything above it — where treasure
is, how to route there, what to carry — comes out of the ZIL. The ferry is
the first thing here that came out of a person reading the game.

The rest of the points sit behind chains no local search will stumble on:
the bell, book and candles at Hades, the coal mine basket, the dam
controls, the thief who must be allowed to steal the egg before he can open
it. Compare **replay a win** for what the finished article looks like.

Chasing this turned up a real error in the map, from the first commit: the
`PER_EXITS` table put the chimney in the Living Room, which invented an
exit that does not exist and lost the only way back up from the dungeon.
It is in the Studio. The atlas had been wrong about that for everyone, not
just the solver.

## Regenerating the graph

    python3 tools/extract_map.py

Reads `1dungeon.zil` for rooms, exits, objects and the per-room scenery
globals, `1actions.zil` for the room descriptions that live inside `M-LOOK`
handlers rather than in an `LDESC` property, and `gsyntax.zil` for the verb
grammar. Writes `web/world.json` and `web/world.js` (the same data as a
script tag, so the map also opens straight off disk, where `fetch` is
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
