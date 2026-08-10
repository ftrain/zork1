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
