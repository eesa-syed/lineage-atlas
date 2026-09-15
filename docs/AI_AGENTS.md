# Working with Lineage Atlas from an AI agent

Atlas is designed so that a person and an agent can work on the same pipeline
without a translation layer. This is the agent's side of that: the API surface,
the workflows worth automating, and the rules that keep an agent from quietly
degrading a graph a human relies on.

There is a ready-made Claude Code skill at
[`.claude/skills/lineage-atlas/SKILL.md`](../.claude/skills/lineage-atlas/SKILL.md).
Point your agent at it and it will follow what is below. It only activates when
Claude Code runs inside an Atlas checkout; to use it from your own project,
`lineage-atlas install-skill` copies it to `~/.claude/skills/` (`--project` for
`./.claude/skills/`, `--link` to symlink instead), and `lineage-atlas version`
tells you when an installed copy has gone stale.

---

## Why a graph is a good substrate for an agent

Reading a repository, an agent has to infer the dependency structure from
imports, SQL text and orchestrator config — expensively, and differently every
time. In Atlas the structure is already explicit:

- dependencies are edges, so traversal is a graph walk, not a re-derivation;
- the graph is acyclic, so every walk terminates;
- every node carries a written description of what it is *for*, which no amount
  of static analysis recovers;
- the whole pipeline fits in one JSON file, so a full picture costs one read.

An agent that would otherwise spend its context reconstructing the shape of a
system gets it for free, and spends the context on the actual question.

## The interface

Three ways in, same model behind all of them.

**1. The REST API** — for reading and changing a live Atlas. Base
`http://localhost:5174/api` — but for an *installed* Atlas treat `5174` as a
default, not a guarantee: with `ATLAS_PORT` unset it takes the next free port
when `5174` is busy and prints where it landed. Read that line rather than
assuming, and remember the converse — if a health check answers on a port you
did not start, you may be talking to somebody else's atlas. `lineage-atlas status`
answers "is one running, on which port, with which database" without starting
anything.

**2. The `.atlas.json` file** — for authoring a whole pipeline offline, or moving
one between installations. Spec: [FILE_FORMAT.md](FILE_FORMAT.md).

One process serves one SQLite database and every pipeline in it, and the startup
line prints which file: `data/atlas.db` in a checkout, the per-user data
directory for an installed copy, or whatever `ATLAS_DB` says. Two Atlases on one
machine are two separate databases — a pipeline imported into one is invisible
to the other.

**3. The CLI** — `lineage-atlas status`, `list`, `summary`, `export`, `validate`,
`import`, `scan` when Atlas is installed; `npm run pipelines`, `npm run export -- …` and so on from a
checkout. Both reach the same code. `validate` exits non-zero on a file that
would be refused, which makes it a CI gate.

### Start here

```bash
curl -s localhost:5174/api/version
```

```json
{ "name": "lineage-atlas", "version": "1.0.0", "bundleFormat": "lineage-atlas.pipeline",
  "bundleVersion": 9, "minBundleVersion": 1, "node": "26.8.1",
  "user": "priya", "db": "/Users/priya/Library/Application Support/lineage-atlas/atlas.db" }
```

Read this first. `bundleVersion` is the format an export will be written as;
`minBundleVersion` is how far back an import can reach. Do not hard-code either.

### Endpoints an agent actually needs

| Purpose | Call |
|---|---|
| What am I talking to | `GET /api/version` |
| Is it up at all | `GET /api/health` |
| List pipelines | `GET /api/pipelines` |
| Create a pipeline | `POST /api/pipelines` `{name, description?}` — the response `id` is the `?graph=` for everything else |
| Rename or describe a pipeline | `PATCH /api/pipelines/:id` `{name?, description?}` |
| **The shape, cheaply** | `GET /api/graph?graph=<id>&view=summary` — `{codes:[{id,name,tags,status}], edges:[[source,target]]}` only. Start here |
| The whole graph in one read | `GET /api/graph?graph=<id>` — every description, input, output and search term |
| A code's logic flow | `GET /api/codes/:id/flow` |
| An asset's full schema + lineage | `GET /api/assets/:id` |
| The asset catalogue | `GET /api/assets?graph=<id>` |
| **Every table with its columns, in one read** | `GET /api/schema?graph=<id>` — what the Schema tab draws; pair it with `GET /api/graph` to follow a column across tables |
| Create an asset with no producer yet | `POST /api/assets?graph=<id>` `{name, materialization?, description?, producerCodeId?, owner?}` — with a producer and no owner, it inherits that code's |
| Create a code | `POST /api/codes?graph=<id>` `{name, tags?, x?, y?, description?, owner?}` |
| Edit a code | `PATCH /api/codes/:id` `{name?, description?, owner?, status?, x?, y?, provenance?, createdAt?, updatedAt?, updatedBy?}` — see **Setting the dates by hand** and **Record the evidence** |
| Copy a code | `POST /api/codes/:id/duplicate` `{withInputs?}` |
| **Declare an input/output** | `POST /api/codes/:id/asset-links` `{direction, path, detail?, tags?, documented?, provenance?}` |
| Edit one input/output | `PATCH /api/asset-links/:id` — same fields, each optional |
| Assets a code could link to | `GET /api/codes/:id/linkable-assets` |
| Tag a code | `POST /api/codes/:id/tags` `{tag}` — returns the full list |
| Make a tag the main one | `POST /api/codes/:id/tags/:tag/primary` — first tag drives colour and badge |
| Untag | `DELETE /api/codes/:id/tags/:tag` |
| Write a logic flow | `PUT /api/codes/:id/flow` `{steps:[{op,title,body}]}` (replaces wholesale) |
| Write a schema | `PUT /api/assets/:id/schema` `{materialization, description, columns, name?, owner?, createdAt?, updatedAt?, updatedBy?}` — `materialization`, `description` and `columns` replace wholesale; every optional field is left alone when omitted. `name` renames the asset **and every declared path that pointed at it**. |
| Draw an edge by hand | `POST /api/edges` `{source, target}` |
| Remove a hand-drawn edge | `DELETE /api/edges/:id` — an edge inferred from asset links comes straight back on the next relink; fix the declaration instead |
| Re-derive every edge | `POST /api/pipelines/:id/relink` |
| **Check a file, write nothing** | `POST /api/pipelines/validate` `{bundle, relink?}` |
| Import a file as a new pipeline | `POST /api/pipelines/import` `{bundle, name?, relink?}` |
| Re-import over a pipeline, keeping its id | `POST /api/pipelines/import` `{bundle, replace: <id>, relink?}` |
| Export a pipeline | `GET /api/pipelines/:id/export` |

Tags are normalised on the way in — lowercased, spaces to underscores,
punctuation dropped — so `"Agent Drafted"` is stored and addressed as
`agent_drafted`.

### Say who you are

Send `X-Atlas-User` on every write:

```bash
curl -X PATCH localhost:5174/api/codes/stg_orders \
  -H 'Content-Type: application/json' \
  -H 'X-Atlas-User: schema-drift-bot' \
  -d '{"description":"Now also drops test orders."}'
```

Every code and every asset records `owner`, `createdAt`, `updatedAt` and
`updatedBy`, and the last of those is filled from that header. Without it the
server falls back to `ATLAS_USER` or the operating-system user — so an unlabelled
agent's edits are indistinguishable from the human's, in the one field a person
would consult to work out where a strange description came from. Pick a name and
keep it stable.

It is attribution, not authentication: nothing verifies the header and no route
is gated on it. `owner` is a different field and yours to set deliberately — it
names the team answerable for the thing, and an agent should generally leave it
alone rather than claiming a model for itself.

### Setting the dates by hand

`createdAt`, `updatedAt` and `updatedBy` are recorded automatically *and*
writable, with one rule: **an explicit value wins for the write that carries
it, and the next ordinary edit resumes stamping.** So a backfill can date what
it imports to when the thing was really written —

```bash
curl -X PATCH localhost:5174/api/codes/<id> \
  -H 'Content-Type: application/json' \
  -d '{"createdAt":"2024-03-01T09:00:00Z","updatedBy":"dbt-exporter"}'
```

— and any later edit moves `updatedAt` back to now, because from that point on
it is once again the truth about the documentation. Send only the fields you
mean to pin: an omitted `updatedAt` is stamped for you, which is almost always
what you want. Anything `Date` cannot parse is refused with `409`, not stored.

A `PATCH` with an empty body is not an edit and moves nothing.

### Record the evidence

A code and every declared input or output can say **why** it is believed:

```bash
curl -X PATCH localhost:5174/api/asset-links/<id> \
  -H 'Content-Type: application/json' -H 'X-Atlas-User: claude-agent' \
  -d '{"provenance":{"source":"inferred","ref":"jobs/route.py:88 — path built at runtime"}}'
```

`source` is `doc`, `code`, `inferred` or `human`; `ref` is where. `null` clears
it, and an unknown source is refused with `409`. The inspector shows it and the
filter panel has a chip per source, so a reviewer can pull up everything
inferred in one click — which is exactly the review an agent's work needs. Tags
still carry workflow state (`agent_drafted`); provenance is the evidence.

Errors are always `{"error": "message"}`. `400` bad input · `404` not found ·
`409` a business rule said no (cycle, duplicate, cross-pipeline) · `422` the file
is not acceptable · `500` a bug worth reporting.

`GET /api/graph?view=summary` is the first read: ids, names, tags, status and
edges, and nothing else — enough for any question about shape, at a fraction of
the size. `GET /api/graph` without it returns every code with its tags, inputs,
outputs, `provenance`, `hasFlow`, and `searchTerms` (the column names and flow
text folded in server-side), plus every edge. Fetch that when the question is
about content — a column name, a description — not by default.

### The one call that does the most work

```bash
curl -X POST localhost:5174/api/codes/stg_orders/asset-links \
  -H 'Content-Type: application/json' \
  -d '{"direction":"output","path":"analytics.stg_orders","documented":true}'
```

`documented: true` finds or creates the asset by name, makes this code its
producer if it has none, **and draws an edge to every code that already lists
that asset as an input**. The response carries `edgesCreated`, so you know how
much of the graph just changed:

```json
{ "code": { … }, "assetId": "analytics_stg_orders", "edgesCreated": 3 }
```

Declaring inputs and outputs is how you build the graph. Reach for
`POST /api/edges` only for a flow that no asset name can express.

## Workflows

### Trace a column to its source

1. `GET /api/graph?graph=<id>` once.
2. Find candidates: the column name is already in each code's `searchTerms`.
3. Walk `edges` backwards from that code, collecting sources (for any further
   walks, `?view=summary` is all you need). The graph is
   acyclic, so this terminates.
4. `GET /api/codes/:id/flow` on each hop for the prose explanation of what
   happened to the value there.

### Impact analysis before a change

Walk `edges` **forwards** from the code in question for the transitive downstream
set (`GET /api/graph?graph=<id>&view=summary`, or `lineage-atlas summary <id>`), then `GET /api/assets/:id` on what it produces — `consumedBy` names every
code that reads it. Report the affected codes with their `owner` fields; those
are the people to tell.

### Check before building

Before proposing a new table, `GET /api/assets?graph=<id>` and look for one that
already carries the data. This is the cheapest possible answer to the most
expensive recurring mistake, and it is one call.

### Document an undocumented pipeline

The high-value, high-risk one. Do it in this order:

0. **Not dbt?** `lineage-atlas scan <dir> draft.atlas.json` drafts the inventory —
   one code per source file, candidate inputs and outputs from S3 URIs, SQL,
   DynamoDB and pandas/Spark calls — so you verify candidates instead of reading
   every file to find them. Every link it writes is `unverified` with
   `provenance.source: inferred`; confirm each against the line it points at.
1. Create a pipeline, then one code per real step, tagged by what it is.
2. For each code, declare its inputs and outputs with `documented: true`.
   **Stop here and look at the graph.** The edges are now inferred; if the shape
   is wrong, the declarations are wrong, and everything after this compounds the
   error.
3. Only then write logic flows and schemas.

Write the structure first and the prose second. Structure is checkable; prose is
not.

### Author offline, import once

For a large pipeline, build one `.atlas.json` (see
[FILE_FORMAT.md §8](FILE_FORMAT.md#8-writing-a-producer)) rather than making
hundreds of API calls. Write the short form: leave out coordinates, positions,
`assetRef`, `producedBy` and edges, and let the import fill them in. Then:

```bash
lineage-atlas validate pipeline.atlas.json --relink   # exits 1 if it would be refused
lineage-atlas import   pipeline.atlas.json "Reviewed name" --relink

# edit, then re-import over the same pipeline instead of creating a copy
lineage-atlas import   pipeline.atlas.json --relink --replace <pipelineId>

# from a checkout, the same steps (relative paths are fine)
npm run validate -- pipeline.atlas.json --relink
npm run import   -- pipeline.atlas.json "Reviewed name" --relink
```

`--relink` derives each edge from an asset's producer to its readers. For a
shared-state table many codes write — a run registry, a log sink — set
`"producedBy": null` so it stays documented without wiring every writer to
every reader.

Validate before importing, always, and **read the output**. `warnings` is where
you find out that three of your edges were dropped as cycles — a silent success
that is really a partial failure. `filled in` lines are not problems; they say
what was resolved or derived for you.

## Rules for an agent working in someone's graph

The graph is a human artefact that people make decisions from. A confidently
wrong entry is worse than a missing one, because it will be believed.

**Do not invent structure.** A declared input is a claim that this code reads
that table. If you inferred it from a filename rather than reading the logic,
record `provenance: {source: "inferred", ref: …}` on it — and tag the code
`unverified` if the whole step is a guess. Never let a guess look like a fact.

**Write what the code is for, not what it says.** The value of a logic flow is
the intent — why this join, why this filter. A prose restatement of SQL an agent
could re-read at any time is noise that costs a human time to skip.

**Whole-document writes replace.** `PUT .../flow` and `PUT .../schema` replace
their target wholesale. Read the current value, merge your change into it, and
write the result. A partial `PUT` is data loss, and there is no undo.

**Respect the refusals.** A `409` on an edge means it would create a cycle,
duplicate an existing edge, or cross pipelines. Do not route around it — a cycle
is nearly always a mis-declared input worth reporting to the human instead.

**Destructive calls need a person.** `DELETE` on a code, an asset or a pipeline
cascades, and nothing here has version history. Propose deletions; let a human
confirm them. The one deletion that is usually yours to make is an edge you drew
yourself by hand and got wrong — and even then, if the edge was *inferred* from
an asset link, deleting it fixes nothing: the next relink re-derives it. Correct
the declaration that produced it.

**Leave a trail.** Tag what you touched (`agent_drafted`, `needs_review`) with
`POST /api/codes/:id/tags`. Tags are free-form and become filter chips
immediately, so a human can review exactly
your changes and nothing else. This is what makes an agent's work reviewable
rather than something that has to be trusted wholesale.

**Say what you did not do.** "I documented 14 of 18 codes; the four Spark jobs in
`ingest/` were unreadable without the cluster config" is a useful report. Silent
partial coverage looks identical to complete coverage in a graph.

## Deciding together

The intended shape of a session is not "the agent fills in the graph". It is:

- the agent proposes structure — codes, declared inputs and outputs, drafted
  prose — tagged as a draft;
- the human sees it *in context*, on the canvas, next to everything it connects
  to, which is where a wrong edge is obvious and a wrong paragraph is not;
- the human corrects the shape, promotes the tag, and the graph is now something
  both of them believe.

The graph is the shared artefact. An agent is much easier to argue with when you
can both point at the same picture.
