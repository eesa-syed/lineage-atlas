---
name: lineage-atlas
description: Read, trace and document data pipelines in Lineage Atlas — a DAG of codes (pipeline steps) and assets (tables with schemas) exposed over a REST API and a self-contained .atlas.json file. Use when asked to trace a column or table to its source, do impact analysis before changing a model, check whether data already exists somewhere, document an undocumented pipeline, or read/write/validate an .atlas.json file. Also covers running Atlas itself — starting it, which port and which database it is using, and where its data lives.
---

# Lineage Atlas

A DAG documentation explorer for data pipelines. Use it to answer "where does
this come from", "what breaks if I change this", and "does this table already
exist" without reading a repository, and to write down what you learn where a
human will find it.

## Model, in one paragraph

A **code** is one pipeline step (source table, SQL model, Python job, mart,
check). It declares **asset links**: what it reads (`input`) and writes
(`output`). When one code outputs `analytics.orders` and another lists it as an
input, the **edge** between them is drawn automatically — you almost never draw
arrows, you declare I/O and the topology follows. An **asset** is a documented
table: columns, keys, tests, samples, and both directions of its lineage. A
**pipeline** is one isolated graph. **Tags** are the only classification; the
first tag is the main one. The graph is always **acyclic**.

## Before anything else

```bash
curl -s localhost:5174/api/version
```

Confirms Atlas is running and reports `bundleVersion` (the file format it
writes) and `minBundleVersion` (the oldest it reads). Never hard-code these —
they are the whole point of the call. If it fails, nothing is serving that port:
see **Operating it**.

## Operating it

| Need | Do |
|---|---|
| Start it | `npm run build && npm start` or `npm run dev` (checkout); `lineage-atlas` if the command is installed. Not on npm yet, so `npx lineage-atlas` fails |
| Start it without a browser | `lineage-atlas serve`, or `ATLAS_NO_OPEN=1` |
| Is it alive | `GET /api/health` → `{ ok, version }` |
| Point it at a different database | `lineage-atlas --db <file>`, or `ATLAS_DB=<file>` |
| Pin the port | `lineage-atlas --port <n>`, or `ATLAS_PORT=<n>` |

**`5174` is a default, not a promise.** For an *installed* Atlas with
`ATLAS_PORT` unset, a busy `5174` makes it take the next free port and print
where it landed — so read the startup line rather than assuming, and treat a
health check answering on a port you did not start as possibly someone else's
atlas. A *checkout* is always `5174` (it refuses to start otherwise), with the
dev web app on `5173` proxying `/api` to it.

**Know which database you are talking to.** One Atlas process serves one SQLite
file, and every pipeline in it. The startup line prints the path; a *checkout*
uses `data/atlas.db`, an *installed* copy uses the per-user data directory
(`~/Library/Application Support/lineage-atlas/` on macOS, `$XDG_DATA_HOME` on
Linux, `%APPDATA%` on Windows). They are different databases, so a pipeline you
imported into one is invisible to the other. `ATLAS_DB` overrides both.

Do not stop or restart a server you did not start — someone is probably looking
at it. Nothing here needs a restart anyway: every change is written to SQLite
immediately.

## Reading

**One call gets the whole topology.** Do this before anything else:

```bash
curl -s "localhost:5174/api/graph?graph=<pipelineId>"
```

Returns every code with `tags`, `inputs`, `outputs`, `owner`, `status`,
`hasFlow` and `searchTerms`, plus every `edge`. `searchTerms` already contains
the column names of the asset each code produces and the text of its logic-flow
steps — so a column name can be matched against it directly, with no extra
calls.

Then, as needed:

| Want | Call |
|---|---|
| Pipelines and their ids | `GET /api/pipelines` |
| A code's prose logic flow | `GET /api/codes/:id/flow` |
| An asset: columns, tests, producer, `consumedBy` | `GET /api/assets/:id` |
| The catalogue (does this exist?) | `GET /api/assets?graph=<id>` |
| Every table with its columns, one call | `GET /api/schema?graph=<id>` |
| Assets a code could link to, id + name only | `GET /api/codes/:id/linkable-assets` |

**Trace a column back:** find the code whose `searchTerms` hold the column, then
walk `edges` backwards (`target → source`) to the sources. Acyclic, so it
terminates. `GET /api/codes/:id/flow` at each hop explains what happened to the
value there.

**Impact analysis:** walk `edges` forwards from the code, then
`GET /api/assets/:id` on what it produces — `consumedBy` names every consumer.
Report affected codes *with their `owner`*; those are the people to tell.

**Does it already exist:** `GET /api/assets?graph=<id>` before proposing any new
table. One call, and it prevents the most expensive recurring mistake there is.

## Writing

Structure first, prose second. Structure is checkable; prose is not.

```bash
# 1. a code
curl -X POST "localhost:5174/api/codes?graph=<pipelineId>" \
  -H 'Content-Type: application/json' \
  -d '{"name":"stg_orders","tags":["sql","staging"],"description":"…","owner":"…"}'

# 2. what it reads and writes — this is what builds the graph
curl -X POST localhost:5174/api/codes/stg_orders/asset-links \
  -H 'Content-Type: application/json' \
  -d '{"direction":"output","path":"analytics.stg_orders","documented":true}'
```

`documented: true` finds or creates the asset, makes this code its producer if it
has none, and draws an edge to every code already reading it. The response's
`edgesCreated` tells you how much of the graph moved. Use `POST /api/edges`
`{source,target}` only for a flow no asset name can express.

Needs its own pipeline first? `POST /api/pipelines` `{name, description}` —
the response's `id` is the `?graph=` for everything above. Everything belongs to
exactly one pipeline and nothing crosses between them.

**Editing what is already there** — `PATCH /api/codes/:id` with any of `name`,
`description`, `owner`, `status` (`active` | `inactive`), `x`, `y`. Only the
keys you send change, so unlike the two PUTs below this is safe to use for one
field at a time. It is the call for documenting existing codes: most of the work
in a real pipeline is filling in `description` and `owner`, not creating rows.
`PATCH /api/asset-links/:id` likewise edits one declared input or output.

Then the documentation:

- `PUT /api/codes/:id/flow` `{steps:[{op,title,body}]}`
- `PUT /api/assets/:id/schema` `{materialization, description, columns, sampleRows}`

**Both replace their target wholesale.** GET the current value, merge, PUT the
result. A partial PUT is data loss and there is no undo.

**Tags** are how a human filters for your work afterwards, so the rule below
about tagging what you touched needs these:

```bash
curl -X POST localhost:5174/api/codes/stg_orders/tags \
  -H 'Content-Type: application/json' -d '{"tag":"agent_drafted"}'

curl -X POST   localhost:5174/api/codes/stg_orders/tags/agent_drafted/primary
curl -X DELETE localhost:5174/api/codes/stg_orders/tags/agent_drafted
```

Each returns the code's full tag list. Tags are normalised on the way in —
lowercased, spaces to underscores, punctuation dropped — so `"Agent Drafted"`
comes back as `agent_drafted`, which is the spelling to use when removing or
promoting it. The **first** tag decides the code's colour and badge on the
canvas, so `…/primary` is a visual change a human will notice; promoting your
own bookkeeping tag over a meaningful one is rude.

When documenting a whole pipeline: create the codes, declare every input and
output, **then stop and check the inferred edges**. If the shape is wrong the
declarations are wrong, and writing prose on top of a wrong graph compounds it.
`POST /api/pipelines/:id/relink` re-derives every edge at once.

## Files

One pipeline is one self-contained `.atlas.json`. For a large pipeline, author
the file and import it once rather than making hundreds of calls. The format is
below; `docs/FILE_FORMAT.md` is the normative spec if anything here is unclear.

### The `.atlas.json` format

Current `formatVersion` is **8** — but confirm with `GET /api/version`
(`bundleVersion`) and write that number. A file newer than the running build is
refused outright.

```json
{
  "format": "lineage-atlas.pipeline",
  "formatVersion": 8,
  "generator": { "name": "claude-agent", "version": "0.1.0" },
  "exportedAt": "2026-09-13T00:00:00.000Z",
  "counts": { "codes": 2, "edges": 1, "assets": 1 },
  "pipeline": { "name": "Orders mini", "description": "Two-step example" },
  "codes": [
    {
      "id": "c_stg_orders",
      "name": "stg_orders",
      "x": 0, "y": 0,
      "description": "Types and deduplicates raw Shopify orders.",
      "owner": "Analytics Eng",
      "status": "active",
      "createdAt": "2026-09-13T00:00:00.000Z",
      "updatedAt": "2026-09-13T00:00:00.000Z",
      "updatedBy": "claude-agent",
      "tags": ["sql", "staging", "agent_drafted"],
      "steps": [
        { "position": 0, "op": "read",   "title": "Read the raw source",     "body": "Landed Shopify payload, unfiltered." },
        { "position": 1, "op": "dedupe", "title": "Keep the latest version", "body": "Shopify re-sends an order on every update, so keep the newest row per id." }
      ],
      "assetLinks": [
        { "direction": "input",  "path": "raw.shopify_orders",   "detail": "source table",      "tags": [], "assetRef": null,           "position": 0 },
        { "direction": "output", "path": "analytics.stg_orders", "detail": "one row per order", "tags": [], "assetRef": "a_stg_orders", "position": 0 }
      ]
    },
    {
      "id": "c_fct_orders",
      "name": "fct_orders",
      "x": 320, "y": 0,
      "description": "Certified order fact.",
      "owner": "Analytics Eng",
      "status": "active",
      "tags": ["sql", "mart", "agent_drafted"],
      "steps": [],
      "assetLinks": [
        { "direction": "input", "path": "analytics.stg_orders", "detail": "", "tags": [], "assetRef": "a_stg_orders", "position": 0 }
      ]
    }
  ],
  "edges": [
    { "source": "c_stg_orders", "target": "c_fct_orders" }
  ],
  "assets": [
    {
      "id": "a_stg_orders",
      "name": "analytics.stg_orders",
      "materialization": "view",
      "description": "Deduplicated orders.",
      "owner": "Analytics Eng",
      "producedBy": "c_stg_orders",
      "columns": [
        { "name": "order_id",   "dataType": "varchar",   "keyKind": "pk", "nullable": false, "description": "Shopify order id", "tests": ["not_null", "unique"], "position": 0 },
        { "name": "ordered_at", "dataType": "timestamp", "keyKind": null, "nullable": false, "description": "UTC",              "tests": [],                     "position": 1 }
      ]
    }
  ]
}
```

That file validates cleanly as written. Field by field:

**Envelope** — all required.

| Field | Rule |
|---|---|
| `format` | Exactly `"lineage-atlas.pipeline"`. Anything else is refused. |
| `formatVersion` | Positive integer, ≤ the server's `bundleVersion`. |
| `generator` | `{name, version}` — name yourself, not `lineage-atlas`. |
| `exportedAt` | ISO-8601 string. |
| `counts` | `{codes, edges, assets}`. A courtesy: a mismatch is a warning and the arrays win, but keep it right. |
| `pipeline` | `{name, description}`. `name` must be non-empty. |
| `codes`, `edges`, `assets` | Arrays, all three present even when empty. |

**`codes[]`**

| Field | Type | Rule |
|---|---|---|
| `id` | string | **Required**, unique in the file. File-local handle, remapped on import — any stable string works. |
| `name` | string | **Required.** |
| `x`, `y` | number | Canvas position, default `0`. Space columns ~320 apart left→right by depth, or every code piles up at the origin. |
| `description`, `owner` | string | Default `""`. |
| `status` | `"active"` \| `"inactive"` | Default `"inactive"`. **Any other value refuses the file.** |
| `createdAt`, `updatedAt` | ISO-8601 | Optional; omitted means "the moment of import". |
| `updatedBy` | string | Optional attribution. |
| `tags` | string[] | Ordered. `tags[0]` is the main tag (colour + badge) — make it meaningful (`sql`, `mart`), not `agent_drafted`. |
| `steps` | `{position, op, title, body}[]` | The prose logic flow. Prose only — **never paste source code**. |
| `assetLinks` | array | What the code reads and writes (below). |

**`codes[].assetLinks[]`**

| Field | Type | Rule |
|---|---|---|
| `direction` | `"input"` \| `"output"` | **Required.** Any other value refuses the file. |
| `path` | string | Table name, S3 URI, file path. Use the *same spelling* on both ends of a flow. |
| `detail` | string | Free text. Say `"inferred from filename"` here when you are not sure. |
| `tags` | string[] | Optional, e.g. `["file"]`, `["seed"]`. |
| `assetRef` | string \| null | An `assets[].id` in this file, or `null` for an undocumented path. |
| `position` | number | Order within its direction. |

**`assets[]`**

| Field | Type | Rule |
|---|---|---|
| `id` | string | **Required**, unique in the file. |
| `name` | string | **Required.** Must match the `path` codes use for it. |
| `materialization` | string | Free text: `table`, `view`, `incremental`… Default `"table"`. |
| `description`, `owner` | string | Plus optional `createdAt`/`updatedAt`/`updatedBy`, as on codes. |
| `producedBy` | string \| null | The `codes[].id` that outputs it. |
| `columns[]` | array | `{name, dataType, keyKind, nullable, description, tests, position}`. `keyKind` is `"pk"`, `"fk"` or `null`; `tests` is always a string array. |

No `sampleRows` (dropped in format 8), no row data, no credentials, no
connection strings — the file is meant to be safe to hand around.

**`edges[]`** — `{source, target}`, both `codes[].id` values in this file.

> **Import does not infer edges.** Unlike the API's `asset-links` call, an
> imported file gets exactly the `edges` it lists — a file with `"edges": []`
> lands as disconnected boxes. Either write every edge yourself (derive them:
> for each output path, an edge to every code with that path as input), or
> import with empty edges and then run `POST /api/pipelines/:id/relink`, which
> derives them from the declarations and returns `edgesCreated`.

**Refused (nothing written, HTTP `422` / CLI exit `1`):** wrong `format`; bad or
too-new `formatVersion`; a missing array; empty `pipeline.name`; a code or asset
without `id`/`name`; duplicate ids; unknown `status` or `direction`; an edge end
that is not a code in the file.

**Imported with warnings (read them):** `assetRef` or `producedBy` pointing at
nothing (the link/asset loses it); self-edges and duplicate edges (skipped);
**an edge that would close a cycle (skipped)**; `counts` not matching.

### Moving files

```bash
lineage-atlas export   <pipelineId> out.atlas.json
lineage-atlas validate out.atlas.json   # writes nothing; exits 1 if it would be refused
lineage-atlas import   out.atlas.json "Name"

# from a checkout, the same three commands
npm run export   -- <pipelineId> out.atlas.json
npm run validate -- out.atlas.json
npm run import   -- out.atlas.json "Name"
```

**Always validate before importing, and read the output.** `upgraded` lines say
the file came from an older format and what it lost; `repaired` lines say
something was dropped — a dangling reference, or an edge skipped because it would
close a cycle. An import that "succeeded" with three dropped edges is a partial
failure that looks like a success.

The same three moves exist over HTTP, for when you can reach the API but not the
machine's shell:

| CLI | HTTP |
|---|---|
| `export <id> [file]` | `GET /api/pipelines/:id/export` — the bundle as the body, with the filename in `Content-Disposition` |
| `validate <file>` | `POST /api/pipelines/validate` — the bundle as the request body; writes nothing |
| `import <file> ["Name"]` | `POST /api/pipelines/import` `{bundle, name}` |

`validate` answers `200` with `{ok, pipeline, counts, source, upgrades,
warnings}` or `422` with `{error}`; the `422` text is the reason, and it is
usually specific enough to fix the file.

Ids inside a file are local to it and remapped on import, so importing is always
safe and always creates a *new* pipeline. It never merges or overwrites.

## Rules

- **Never invent structure.** A declared input claims this code reads that table.
  If you inferred it from a filename rather than the logic, say so in `detail` or
  tag the code `unverified`. A confident wrong entry is worse than a missing one,
  because a human will believe it.
- **Write intent, not a restatement.** A logic flow should say *why* this join,
  *why* this filter. Prose that just narrates the SQL is noise.
- **Respect a `409`.** It means the edge would create a cycle, duplicate an
  existing one, or cross pipelines. Do not route around it — a cycle almost
  always means a mis-declared input. Report it. The other two failures worth
  recognising: `404` means the id or pipeline does not exist (check `?graph=`
  before assuming the row is gone), and `422` means a bundle was refused, with
  the reason in `error`. Every failure returns `{error}` as JSON.
- **Do not delete.** `DELETE` cascades and there is no history. Propose it; let
  the human confirm.
- **Tag what you touched** (`agent_drafted`, `needs_review`). Tags become filter
  chips immediately, so the human can review exactly your changes.
- **Report what you skipped.** Partial coverage looks identical to full coverage
  in a graph unless you say otherwise.

## Deeper reference

- `docs/CONCEPTS.md` — the model and why it is shaped this way
- `docs/FILE_FORMAT.md` — the normative `.atlas.json` spec
- `docs/AI_AGENTS.md` — the long form of this skill

Working on Atlas *itself* rather than through it? That is a different job, and
this skill is not it: `PROJECT_DOCUMENTATION.md` is the codebase tour —
repository layout (§3), architecture and process model (§4), the data model
(§5), every backend module (§6), every route with its request and response
shapes (§7), the frontend (§9). `CONTRIBUTING.md` §"Where things live" maps a
change you want to make onto the file to open.
