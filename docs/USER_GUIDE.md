# User guide

Everything you can do in the Lineage Atlas UI, and the reasoning behind the
parts that behave in ways you might not expect. For installing and running it,
see the [README](../README.md#installation).

- [Pipelines](#pipelines)
- [Codes, tags, inputs and outputs](#codes-tags-inputs-and-outputs)
- [Assets and schemas](#assets-and-schemas)
- [The Schema tab](#the-schema-tab)
- [Logic flows](#logic-flows)
- [Connecting, selecting, duplicating](#connecting-selecting-duplicating)
- [Keyboard](#keyboard)
- [Notes on the design](#notes-on-the-design)

---

## Pipelines

An Atlas holds any number of independent pipelines, each with its own codes,
edges, tags and assets. The switcher is the pipeline name in the top bar; it
also holds *New empty pipeline*, *Import*, *Export*, *Rename* and *Delete*.
Pipelines are sealed off from each other: an edge between pipelines is refused,
and two pipelines may hold assets with the same name without colliding.

## Codes, tags, inputs and outputs

**Add codes** with **＋ Code** on the canvas toolbar — name it, pick or invent its
tags, and it lands where you're looking.

**Tag.** Tags are normalised (`Needs Review` → `needs_review`) and immediately
become filter chips in the rail. One tag is the **main tag**: it names the code on
the canvas and decides its colour. Change it with the *Main tag* dropdown, or
hover any other tag and click *make main*.

**Edit inputs and outputs.** Each is a path, an optional detail, and its own tags.
`+ add` in the inspector to record one, `edit` to change it, `×` to remove it. The
**▤ I/O** toolbar toggle collapses them to counts when the graph gets busy.

**Documented assets are picked or created by name.** Check *Documented asset* on
an input or output to link it to a schema page — the form lists the pipeline's
existing assets with their column counts and producers; type to filter, click to
fill. The line underneath says which way it will go: *links to an existing asset*
(with its coverage, and a warning if another code already produces it) or *not in
the catalogue yet, this will create it*. Declaring an asset as an **output** makes
that code its producer; as an **input** it only references it.

**Links are inferred from data flow** as you type, and *Rebuild links from inputs
& outputs* re-derives a whole pipeline at once. An inferred edge that would close
a cycle is skipped rather than failing the write: the declaration is still
recorded, only the arrow is omitted.

## Assets and schemas

**The asset catalogue** is the rail's second tab: every asset with its producer,
column count, tested-column count and consumer count, with anything undocumented
flagged *no schema yet* and a running count at the top. Click a row for its
schema, `◎` to jump to its producer, `+ new asset` to add one no code has named.

**Document a schema** — *Add schema* / *Edit schema* on any asset page: the
materialization and description, then columns with type, PK/FK/nullable,
description and tests.

## The Schema tab

The Schema tab shows every documented asset in the pipeline as a table: its
columns, types, PK/FK badges and a dot per column for test coverage (filled means
a test guards it, hollow means nothing does). Tables are shown as they are, with
no links between them, grouped under their schema (`analytics`, `raw`, ...).
Assets with no schema yet appear dashed, which makes the gaps hard to miss.

Each table also names the codes either side of it: *produced by* the code that
writes it, *consumed by* the codes that read it. Click any of those names to jump
to that code on the Flow tab.

- **Search** (`/` jumps into it) matches table names and descriptions, the codes
  that write and read them, and every column's name and description, so searching
  a code's name finds every table it touches. Tables that don't match dim, matching
  columns are marked, the view frames the matches as you type, and the box counts
  them. `Enter` centres the next match, `Shift+Enter` the previous one, `Esc`
  clears. It is the quick answer to "does this data already exist?"
- **Columns: Auto / All / Keys / Names** sets how much of each table shows. *Auto*
  follows the zoom: every column up close, keys when pulled back, names at a
  distance. A column matching the search always stays visible.
- Double-click a table to open its schema page, which is also where an
  undocumented one gets its columns. Drag tables to rearrange them; positions are
  remembered per pipeline in this browser, and *Re-layout* puts them back.

## Logic flows

**Write the logic flow** — *Edit logic flow* on a code's logic tab: an operation,
a title and a prose explanation per step, added and reordered freely.

**Read** — double-click a code (or `Enter`) for its logic flow; click any
documented asset for its schema. Both open as closable tabs after the two fixed
views, *Flow* and *Schema*, and lineage chips on a schema page jump back to the
code on the canvas.

## Connecting, selecting, duplicating

**Connect** — three ways, all the same edge: drag from a code's right handle to
another's left handle; *Connect forward* (toolbar, inspector, context menu, or
`C`) then click the target; or, with a code selected, click `⇢` on any rail row.
Edges that would duplicate an existing one, point a code at itself, or **create a
cycle** are rejected with an explanation.

**Remove a link** — click any edge; a bar names both ends and offers *remove
link*. `Delete` / `Backspace` does the same, `Esc` cancels.

**Select several** — `Shift`+click adds or removes a code, as in most canvas
tools, and `Shift`+drag on empty canvas selects everything inside the box. `⌘`+click
also toggles (`Ctrl`+click off a Mac; on a Mac `Ctrl`+click is right-click and
opens the code's menu). It is the same selection the rail's checkboxes build, where
`Shift`+click selects a range instead. While several are picked the canvas toolbar
gains *+ tag all* and *connect to…* (one target), and dragging any picked code
moves the whole group. The highlight stays until you click something else or press
`Esc`, which makes it handy for pointing at a group during a demo. On the Schema
tab the same gestures pick tables; tables have no tags, so there the selection is
a highlight only.

**Duplicate** — `D` copies a code, `⇧D` also inherits its upstream edges. Copies
are tagged `draft` and deliberately do not claim the original's produced asset,
since two codes producing one table would be a lie.

## Keyboard

| Key | Action |
| --- | --- |
| `/` | Focus search (on the Schema tab, its table and column search) |
| `V` / `C` | Select mode / connect from the selected code |
| `D` / `⇧D` | Duplicate / duplicate with upstream edges |
| `Enter` | Open the selected code's logic flow |
| `Esc` | Cancel a pending connection, close the menu, clear a multi-selection; on the Schema tab, clear the selection, then the search |
| `Delete` / `Backspace` | Remove the picked edge |
| `Shift` + click | Add or remove a code from the selection — a table, on the Schema tab. `⌘` + click does the same (`Ctrl` + click off a Mac) |
| `Shift` + drag | Box-select everything inside, on either canvas |

## Notes on the design

Colour on the canvas is **information**, not decoration, on three separate
channels: the main tag colours the code, status is its own dot (active /
inactive), and the single accent (signal orange) means one thing only —
selection and the active lineage path. If you re-theme this, keep the three
distinct. Every colour is declared in `web/src/styles/tokens.css`; nothing else
defines one.

The inspector is only mounted when a code is selected. With nothing selected it
has nothing to say, so its column collapses and the canvas takes the width back —
deliberate, not a missing empty state.

Its **Metadata** panel edits a code's name, owner and status, plus the three
stewardship fields — created, updated, last edit by. An asset's are on its
schema page under *Edit schema*, alongside its name. The dates are recorded for
you and writable by hand, and one rule reconciles the two: **what you type wins
for that save, and the next ordinary edit resumes stamping.** So a record can be
backdated to when it was really written, and `updated` goes back to meaning
"when this page last changed" the moment anyone changes it. Renaming an asset
carries every input and output that named it, so no code is left declaring a
table that no longer exists.

The code list is flat by default and groups on demand — **Group by** offers main
tag, owner or status, and the asset catalogue offers producer's main tag, owner,
materialization or producer. Sections are whatever the chosen field actually
contains, so there is no fixed vocabulary to conform to. The choice is
remembered per browser.

**Filter by date** narrows either list to records created or updated inside a
window, with `last 7d`, `last 30d` and `90d+ ago` as one-click windows — the
last of those being the stale end of the catalogue, everything nobody has
touched in three months. Like the search box and the tag chips, the window is
shared between the Codes and Assets tabs, and it dims the canvas too: "show me
what has not been looked at since June" is a shape on the graph, not just a
list.

Light, dark and a system default; the toggle is in the top bar.
