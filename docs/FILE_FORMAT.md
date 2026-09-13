# The `.atlas.json` file format

**Format id:** `lineage-atlas.pipeline` · **Current version:** `8` · **Oldest readable:** `1`

One pipeline, complete, in one JSON file. This is the normative specification:
the interchange contract between two copies of Lineage Atlas, and the thing any
other tool has to write in order to be read by it.

If you only want to use the format, read §1 and §2. If you are writing a
producer or consumer of it, read all of it.

---

## 1. The envelope

Every file is a JSON object whose first five keys are the **envelope**. The
envelope is stable across all versions of the format: a reader can inspect it
alone and decide whether it understands the rest of the file.

```json
{
  "format": "lineage-atlas.pipeline",
  "formatVersion": 8,
  "generator": { "name": "lineage-atlas", "version": "1.0.0" },
  "exportedAt": "2026-09-09T19:08:39.089Z",
  "counts": { "codes": 18, "edges": 23, "assets": 14 },
  "pipeline": { "name": "Analytics warehouse", "description": "…" },
  "codes": [ … ],
  "edges": [ … ],
  "assets": [ … ]
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `format` | string | yes | Always exactly `lineage-atlas.pipeline`. A file with any other value is not this format and is refused. |
| `formatVersion` | integer ≥ 1 | yes | The **format** version, not the app version. See §5. |
| `generator` | `{name, version}` | from v6 | What wrote the file. Files older than v6 are stamped `{"name":"unknown","version":"pre-1.0"}` when upgraded. |
| `exportedAt` | ISO-8601 string | yes | When it was written. Informational; nothing keys off it. |
| `counts` | `{codes, edges, assets}` | from v6 | Totals, so a human or an agent can read the head of a large file and know its size. A **courtesy, not a contract** — see §4. |
| `pipeline` | `{name, description}` | yes | `name` must be non-empty. |
| `codes` | array | yes | §2.1 |
| `edges` | array | yes | §2.3 |
| `assets` | array | yes | §2.2 |

Three separate version numbers exist and move independently. Do not conflate
them:

- **`formatVersion`** — this document. An integer, bumped only when the shape on
  disk changes. Never reused, never skipped.
- **`generator.version`** — the app release that wrote the file (semver).
  Provenance only; no reader should branch on it.
- The **API version** at `GET /api/version`, which reports both of the above for
  a running server.

## 2. The body

### 2.1 `codes[]`

A *code* is one documented step: a source table, a SQL model, a Python job, a
mart, a quality check — anything that reads and/or writes data.

```json
{
  "id": "stg_orders",
  "name": "stg_orders",
  "x": 0, "y": 0,
  "description": "Cleans and types the raw order drop.",
  "owner": "Data Platform",
  "status": "active",
  "createdAt": "2026-02-14T10:02:11Z",
  "updatedAt": "2026-09-09T18:41:03Z",
  "updatedBy": "priya@acme.example",
  "tags": ["sql", "staging"],
  "steps": [
    { "position": 0, "op": "read", "title": "Read the landing table", "body": "…" }
  ],
  "assetLinks": [
    {
      "direction": "output",
      "path": "analytics.stg_orders",
      "detail": "one row per order",
      "tags": ["mart"],
      "assetRef": "analytics_stg_orders",
      "position": 0
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | **File-local.** Required, unique within the file. See §3. |
| `name` | string | Required. Displayed on the canvas. |
| `x`, `y` | number | Canvas position. Default `0`. |
| `description`, `owner` | string | Default `""`. `owner` is the team or person answerable for the step — see §2.4. |
| `status` | `"active"` \| `"inactive"` | Default `"inactive"`. Any other value is an error. |
| `createdAt`, `updatedAt` | ISO-8601 string | From v7. Stewardship dates — see §2.4. |
| `updatedBy` | string | From v7. Who last edited the record. Default `""`. |
| `tags` | string[] | **Ordered.** `tags[0]` is the *main tag*: it names and colours the code. Order is meaningful and survives the round trip. |
| `steps` | array | The prose *logic flow*, ordered by `position`. `op` and `body` default to `""`. **No source code is ever carried** — see §6. |
| `assetLinks` | array | What the code reads and writes. |

Each entry in `assetLinks`:

| Field | Type | Notes |
|---|---|---|
| `direction` | `"input"` \| `"output"` | Required. Any other value is an error. |
| `path` | string | What is read or written — a table name, an S3 URI, a file path. |
| `detail` | string | Free text. Default `""`. |
| `tags` | string[] | Ordered; `tags[0]` is the link's main tag. May be empty. |
| `assetRef` | string \| null | A `assets[].id` **in this same file**, when the link points at a documented asset. |
| `position` | number | Order within its direction. |

### 2.2 `assets[]`

An *asset* is a documented thing that codes read and write — the schema page
behind a name.

```json
{
  "id": "analytics_stg_orders",
  "name": "analytics.stg_orders",
  "materialization": "table",
  "description": "…",
  "owner": "Analytics Eng",
  "createdAt": "2026-02-14T10:02:11Z",
  "updatedAt": "2026-08-30T08:15:00Z",
  "updatedBy": "priya@acme.example",
  "producedBy": "stg_orders",
  "columns": [
    { "name": "order_id", "dataType": "varchar", "keyKind": "pk",
      "nullable": false, "description": "…", "tests": ["not_null", "unique"], "position": 0 }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | **File-local.** Required, unique within the file. |
| `name` | string | Required. The name codes refer to it by, e.g. `analytics.orders`. |
| `materialization` | string | Free text (`table`, `view`, `incremental`, …). Default `"table"`. |
| `owner`, `createdAt`, `updatedAt`, `updatedBy` | | From v7. The same four fields a code carries — see §2.4. |
| `producedBy` | string \| null | A `codes[].id` in this same file — the code that writes it. |
| `columns[].keyKind` | `"pk"` \| `"fk"` \| null | Anything else is coerced to `null`. |
| `columns[].tests` | string[] | Test names. Stored joined; always an array in the file. |

### 2.3 `edges[]`

```json
[{ "source": "stg_orders", "target": "fct_orders" }]
```

Both ends are `codes[].id` values from this same file. Both must exist, or the
file is refused.

**Edges are normally derived, not authored.** In the app an arrow is a
*consequence* of two declarations — one code outputs `analytics.orders`, another
lists it as an input — and is drawn automatically. They are written out
explicitly so that a file is complete on its own and does not have to be
re-derived to be read.

### 2.4 Stewardship

Every code and every asset carries the same four fields, from v7 on:

| Field | Type | Meaning |
|---|---|---|
| `owner` | string | The team or person answerable for the **thing** — the model, the table. Free text; Atlas never parses it. |
| `createdAt` | ISO-8601 string | When the **record** was first documented. |
| `updatedAt` | ISO-8601 string | When the record was last edited. |
| `updatedBy` | string | Who made that edit. |

Three things this is not, each worth stating because each is a plausible
misreading:

- **Not freshness.** `updatedAt` moves when someone edits the *documentation* —
  a description, an owner, a tag, a column, a logic flow. Nothing in Atlas
  watches a warehouse, and format versions 3 and 4 removed the fields that once
  suggested otherwise (§6). A table last loaded an hour ago and last *described*
  in February reads exactly that way here, which is the useful signal: the
  documentation is seven months stale.
- **Not identity.** `updatedBy` is attribution, like a git author line. There is
  no account behind it and nothing verifies it. A server fills it from the
  `X-Atlas-User` header, else `ATLAS_USER`, else the operating-system user.
- **Not access control.** No field in this format gates anything.

Dates round-trip. An import creates a new pipeline with new ids, but a record's
`createdAt`, `updatedAt` and `updatedBy` are content and are preserved exactly —
otherwise every shared file would claim to have been written the moment it was
opened. A producer that omits them gets the import's own clock instead.

## 3. Ids are local to the file

`codes[].id`, `assets[].id`, `assetLinks[].assetRef` and `assets[].producedBy`
are handles **within one file**. They are not database keys and carry no meaning
outside it.

On import, every one of them is remapped to a freshly generated id. This is the
property that makes a bundle safe to pass around: the same file can be imported
repeatedly, and imported alongside the very pipeline it was exported from, with
no collision. **Import always creates a new pipeline; it never merges into or
overwrites an existing one.**

The practical consequence for a round trip: `export → import → export` returns a
file that is identical to the original in every respect **except its ids**, which
are handles the second Atlas assigns for itself. Content is lossless; ids are
not preserved, by design.

## 4. Errors and warnings

The reader draws a hard line between "this file is meaningless" and "this file
has an obvious safe reading". Both classes are reported; only one stops the
import.

**Errors — nothing is written** (HTTP `422`, CLI exit `1`):

- not a JSON object, or `format` is not `lineage-atlas.pipeline`
- `formatVersion` absent, not a positive integer, newer than this build reads, or
  older than `minBundleVersion`
- `codes`, `edges` or `assets` is not an array
- `pipeline.name` is empty
- a code without an `id` or a `name`; a duplicate code id
- an unknown `status`, or an unknown asset-link `direction`
- an asset without an `id` or a `name`; a duplicate asset id
- an edge whose `source` or `target` is not a code in the file

**Warnings — the import lands whole, and the notes are reported back**:

- an `assetRef` naming an asset not in the file → the input/output imports
  without a schema
- a `producedBy` naming a code not in the file → the asset imports without a
  producer
- an edge from a code to itself → skipped
- a duplicate edge → skipped
- **an edge that would close a cycle → skipped** (see §7)
- `counts` disagreeing with the actual arrays → the arrays win, and you are told

Warnings come back on every path: in the `warnings` array of the import
response, on the toast and browser console in the UI, and under `repaired` in
the CLI.

An import is **atomic**: validation runs to completion before any write, and the
writes themselves run in one transaction. A file lands whole or not at all.

## 5. Compatibility policy

**Backward compatible, forward refusing.**

- A file **older** than the current format is upgraded in memory before it is
  read, one version at a time, up the ladder in `server/src/bundle.ts`. Every
  step is reported, so you always know what an old file was turned into and what
  it lost on the way.
- A file **newer** than the running build is refused with a message naming both
  versions. Guessing at a shape from the future is how data gets silently
  mangled.
- `minBundleVersion` is the oldest format still readable. It is `1`, and raising
  it is a breaking change reserved for a major release.

### Version history

| Version | Introduced in | Change |
|---|---|---|
| 1 | pre-1.0 | Original shape: `nodes`, `datasets`, `artifacts` (each with a fixed `kind`), three-way `fresh`/`stale`/`failing` status, `sla`. |
| 2 | pre-1.0 | Renamed to `codes`, `assets`, `assetLinks`. Each artifact's `kind` became its link's main tag. |
| 3 | pre-1.0 | Status collapsed to `active`/`inactive`; `sla` dropped. |
| 4 | pre-1.0 | `rowCount` and `freshness` dropped — nothing ever computed them. |
| 5 | pre-1.0 | Captured source and per-step line ranges dropped; a logic flow became only its prose steps. |
| 6 | 1.0.0 | `generator` and `counts` added to the envelope. |
| 7 | 1.0.0 | Stewardship: `createdAt`, `updatedAt` and `updatedBy` on every code and asset, and `owner` on assets. Older files are dated from their own `exportedAt` — a true upper bound — with no editor named, and an asset inherits the owner of the code that produces it. |
| **8** | **1.0.0** | `sampleRows` dropped from every asset. |

Steps 1 through 4 mirror the database migrations in `server/src/db.ts` one for
one, so a file and a database that started life at the same version end up in
the same place.

### Adding a version

1. Change the shape, and bump `BUNDLE_VERSION` in `server/src/version.ts`.
2. Add exactly one rung to `UPGRADES` in `server/src/bundle.ts`, keyed by the
   version it upgrades *from*, with a `note` written for a human to read.
3. Add a row to the table above.

Never edit an existing rung, and never renumber. Files written by older builds
are in other people's hands and are the reason the ladder exists.

## 6. What the format deliberately does not carry

- **No source code.** A logic flow is prose steps only. This is what keeps a
  whole pipeline small enough to paste into a chat message, and it is why an
  Atlas file is safe to share when the repository it describes is not.
- **No credentials, connection strings or environment config.** The format
  describes *what* a pipeline does, never how to connect to it.
- **No permissions and no history.** `owner` and `updatedBy` are free-text
  attribution (§2.4), not accounts: there is no auth model to serialise, nothing
  is gated on either field, and only the *latest* edit is recorded — the format
  carries no revision log.
- **No run state.** Nothing in the file is a metric or a freshness timestamp;
  versions 3 and 4 removed the last fields that pretended otherwise, and the
  stewardship dates (§2.4) describe the documentation, not the pipeline.
- **No data.** Assets carry their *shape* — columns, types, keys, tests — and
  never their contents. Sample rows were the one exception until version 8
  removed them: nothing ever refreshed them, so they aged into fiction the way
  `rowCount` did, and they were the one thing that could put real customer
  records into a file whose whole point is being safe to pass around.

## 7. The acyclicity guarantee

The graph is a **DAG**, always. Every other route into the app enforces it:
`repo.addEdge` refuses a cycle outright, and inferred links skip one silently.

A file is the one way an edge could ever arrive without passing those checks, so
the reader enforces it too. Edges are accepted one at a time against the set
already accepted, and any edge that would close a loop is dropped with a warning
naming both ends.

Dropping rather than refusing is deliberate, and matches how inferred links
already behave: a file from a foreign tool with one bad arrow still imports, and
you are told precisely which arrow did not survive.

## 8. Writing a producer

The shortest useful file is a pipeline with one code and nothing else:

```json
{
  "format": "lineage-atlas.pipeline",
  "formatVersion": 7,
  "generator": { "name": "my-dbt-exporter", "version": "0.1.0" },
  "exportedAt": "2026-09-09T00:00:00.000Z",
  "counts": { "codes": 1, "edges": 0, "assets": 0 },
  "pipeline": { "name": "From dbt", "description": "" },
  "codes": [
    { "id": "c1", "name": "stg_orders", "x": 0, "y": 0, "description": "",
      "owner": "", "status": "active", "createdAt": "2026-09-09T00:00:00.000Z",
      "updatedAt": "2026-09-09T00:00:00.000Z", "updatedBy": "my-dbt-exporter",
      "tags": ["sql"], "steps": [], "assetLinks": [] }
  ],
  "edges": [],
  "assets": []
}
```

For dbt specifically there is nothing to write: Atlas reads `manifest.json`
directly, and `server/src/dbt.ts` is a complete worked example of a producer —
see [DBT.md](DBT.md).

Then check it before you trust it — this writes nothing:

```bash
lineage-atlas validate path/to/your.atlas.json   # installed
npm run validate -- path/to/your.atlas.json      # from a checkout
```

It exits `0` if the file would import and `1` if it would be refused, printing
every upgrade and repair it would apply, which makes it usable directly as a CI
gate. The same check is available over HTTP at `POST /api/pipelines/validate`.

Three things are worth doing even though nothing forces you to:

- **Set `assetRef` and `producedBy`** wherever you can. A link with a bare `path`
  and no `assetRef` is a string; one that resolves to an asset is a node in the
  graph, and it is what lets Atlas infer the edges.
- **Write out every edge.** Import never infers edges from a file: it inserts
  exactly the `edges` listed, so a file with `"edges": []` lands as unconnected
  boxes. If your source only knows each step's inputs and outputs, either derive
  the edges yourself (for each output path, an edge to every code with that path
  as an input) or import and then call `POST /api/pipelines/:id/relink`, which
  derives them from the declarations.
- **Fill in the stewardship fields** if your source knows them — a dbt `owner`
  meta key, a file's git history. Omitting them is legal and they default to the
  import's own clock, but a whole pipeline dated "the moment it was imported"
  tells the reader nothing.

---

See also: [CONCEPTS.md](CONCEPTS.md) for the model this format serialises, and
[AI_AGENTS.md](AI_AGENTS.md) for driving Atlas from an agent.
