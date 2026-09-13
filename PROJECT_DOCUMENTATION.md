# Lineage Atlas — Project Documentation

Generated from a full read-through of the codebase. This is the technical
companion to [README.md](README.md), which is the user-facing guide — this
document goes one level deeper: architecture, data model, every API route,
every module's responsibility, and the internal conventions that aren't
obvious from using the app.

---

## 1. What it is

Lineage Atlas is a **DAG documentation explorer for data pipelines**. Each
node in the graph is a "code" — a source table, a SQL model, a Python job, a
mart, a quality check, anything that reads and/or writes data. The graph
records:

- what each code reads and writes (its **inputs** and **outputs**, called
  *asset links*),
- who owns it and whether it's active,
- a **logic flow** — prose steps describing what it does internally (no
  source code is ever captured or stored),
- and, for any input/output that names a **documented asset**, a full
  **schema** page (columns, types, keys, tests, sample rows, and both
  directions of lineage).

Edges between codes are **inferred from data flow**: if code A outputs
`analytics.orders` and code B lists `analytics.orders` as an input, the
A → B edge is drawn automatically. The graph is kept strictly acyclic — an
edge that would close a cycle is rejected (or silently skipped, for inferred
edges).

The app supports multiple independent **pipelines** in one installation
(a warehouse, a marketing graph, an ML pipeline, …), each fully isolated,
and pipelines can be shared as single self-contained `.atlas.json` files.

Three things carry a version, and they move independently — §15 covers the
policy in full:

| | Where | What it means |
|---|---|---|
| App version | `APP_VERSION` in `server/src/version.ts` | The release. Currently **1.0.0**. |
| File format | `BUNDLE_VERSION`, same file | The `.atlas.json` shape. Currently **6**. |
| Minimum readable | `MIN_BUNDLE_VERSION`, same file | Oldest format still importable. Currently **1**. |

For the conceptual case behind the design — why edges are derived rather than
drawn, why the DAG is strict, and how this differs from a diagramming tool or a
wiki — see [docs/CONCEPTS.md](docs/CONCEPTS.md). The normative file-format spec
is [docs/FILE_FORMAT.md](docs/FILE_FORMAT.md); the agent-facing guide is
[docs/AI_AGENTS.md](docs/AI_AGENTS.md).

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Backend runtime | Node.js 24+ (tested on 26) | ESM (`type: module`); 24 is the first release with `node:sqlite` unflagged |
| Backend framework | Express 4 | Thin REST layer over `repo.ts` |
| Database | `node:sqlite` (`DatabaseSync`) | Node's **built-in** SQLite — no native build step, no `better-sqlite3` |
| Backend language | TypeScript, compiled with `tsc` | Dev loop uses `tsx watch` |
| ID generation | `nanoid` — opaque prefixed ids (via `newEntityId`) for codes/assets, `nanoid(12)` for every other row; human-readable slug ids (via `uniqueId`) for graphs only | |
| Frontend framework | React 18 + TypeScript | |
| Bundler/dev server | Vite 6 | Proxies `/api` to the Express server in dev |
| Graph rendering | `@xyflow/react` (React Flow v12) | Canvas, nodes, edges, minimap, handles |
| State management | Zustand 5 | One global store (`web/src/state/store.ts`), no React context/redux |
| Styling | Plain CSS, token-driven (`web/src/styles/tokens.css` + `app.css`) | Light/dark/system theme |
| Package management | npm workspaces (`server`, `web`) | Root scripts fan out via `-w` |
| Distribution | npm package with a `bin` (`npx lineage-atlas`) | Ships `server/dist` + `web/dist` prebuilt, so an install compiles nothing; ~190 kB packed |

---

## 3. Repository layout

```
Project tracker/
├── package.json              root workspace scripts (dev/build/seed/export/validate/import/typecheck);
│                              also the published package: `bin`, `files`, runtime deps, `prepublishOnly`
├── package-lock.json
├── README.md                  user-facing guide (positioning, features, shortcuts, design notes)
├── LICENSE                    MIT
├── CHANGELOG.md               release history; format history lives in docs/FILE_FORMAT.md
├── CONTRIBUTING.md            setup, conventions, changing the file format, release steps
├── PROJECT_DOCUMENTATION.md   this document
├── bad.json                   stray/unrelated file — not referenced anywhere in the app (see §11)
├── docs/
│   ├── CONCEPTS.md             the model, and the argument for its shape
│   ├── FILE_FORMAT.md          normative .atlas.json spec — the interchange contract
│   └── AI_AGENTS.md            API surface, workflows and rules for agents
├── bin/
│   └── lineage-atlas.mjs       the installed command (§6.8): serves the app, or forwards to the file CLI
├── scripts/
│   └── check-version.mjs       fails the build if APP_VERSION and the package.json files disagree
├── .claude/
│   ├── launch.json             dev-server launch config for the Claude Code preview tool
│   └── skills/lineage-atlas/SKILL.md   the agent skill (condensed docs/AI_AGENTS.md)
├── data/
│   └── atlas.db, .db-shm, .db-wal   SQLite database + WAL files, created on first run, gitignored
│                                    (a *checkout* only — an installed copy writes to the user data dir, §6.2b)
│
├── server/                    Express + node:sqlite API — the "backend" workspace
│   ├── package.json
│   ├── tsconfig.json
│   ├── dist/                  compiled JS output (npm run build -w server)
│   └── src/
│       ├── version.ts          APP_VERSION / BUNDLE_VERSION / MIN_BUNDLE_VERSION — single source of truth
│       ├── paths.ts            checkout vs. installed, and the per-user data directory
│       ├── db.ts              schema DDL, connection, migrations, tiny query helpers (all/get/run/tx)
│       ├── types.ts            every shared TypeScript type + the .atlas.json bundle format + legacy v1 shape
│       ├── repo.ts             all reads and mutations: graph, codes, tags, edges, assets, asset links, flows, pipelines
│       ├── bundle.ts           .atlas.json export, the format upgrade ladder, validation, import
│       ├── cli.ts              `list | export | validate | import | version` from the terminal
│       ├── index.ts            Express app: routes, error handling, static hosting of the built web app
│       ├── seed.ts             seeds (or force-reseeds) the demo "warehouse" pipeline
│       ├── seed-data.ts        the demo pipeline's raw data: 18 codes, their inputs/outputs, asset schemas
│       └── seed-flows.ts       the demo pipeline's logic-flow steps, keyed by code id
│
└── web/                        React + TypeScript + Vite + React Flow — the "frontend" workspace
    ├── package.json
    ├── tsconfig.json / tsconfig.tsbuildinfo
    ├── vite.config.ts          dev server on :5173, proxies /api → :5174
    ├── index.html
    ├── dist/                   built static assets (served by the API once present)
    └── src/
        ├── main.tsx             ReactDOM root
        ├── App.tsx              shell: boot/error states, keyboard shortcuts, pane layout
        ├── types.ts             frontend mirror of server types + tag-colour + status-colour helpers
        ├── api/
        │   └── client.ts        typed fetch wrapper — one function per REST endpoint
        ├── state/
        │   └── store.ts         the entire app state: data, selection, UI mode, tabs, toasts, every mutation
        ├── lib/
        │   ├── lineage.ts       pure graph helpers: upstream/downstream walk, lineage set, search matching
        │   └── schemaGraph.ts   Schema tab helpers: grid layout grouped by schema, table search (link helpers kept, unused)
        ├── components/
        │   ├── TopBar.tsx           logo, pipeline switcher slot, theme toggle, shortcut hint, user chip
        │   ├── PipelineMenu.tsx     pipeline switcher: list, new, rename, delete, import, export, relink
        │   ├── SearchRail.tsx       left rail: Codes/Assets tabs, search, tag filters, grouping, bulk actions
        │   ├── BulkActions.tsx      tag-all / connect-to actions for a multi-selection (rail and canvas)
        │   ├── AssetList.tsx        the Assets tab of the rail — the asset catalogue
        │   ├── GraphCanvas.tsx      the React Flow canvas: toolbar, panels, node/edge interaction, minimap
        │   ├── DagCode.tsx          the custom React Flow node — one code's card
        │   ├── SchemaCanvas.tsx     the Schema tab's React Flow canvas: tables grouped by schema, search, density
        │   ├── AssetTable.tsx       the Schema tab's custom node — one table with its columns
        │   ├── Inspector.tsx        right-hand panel for the selected code: description, tags, I/O, metadata, actions
        │   ├── AssetLinkEditor.tsx  add/edit/remove one code's inputs or outputs (used inside Inspector)
        │   ├── NewCodeForm.tsx      inline form for creating a new code at a canvas position
        │   ├── ContextMenu.tsx      right-click menu for a code
        │   ├── TabStrip.tsx         tabs across the top of the stage (Flow + Schema views, then opened flow/schema docs)
        │   ├── StatusBar.tsx        bottom bar: counts, selection, mode, hints
        │   └── ToastView.tsx        transient notification banner
        ├── panes/
        │   ├── FlowPane.tsx         read view of a code's logic flow (steps + reads/writes)
        │   ├── FlowEditor.tsx       edit view for the logic flow (reorderable steps)
        │   ├── SchemaPane.tsx       read view of an asset's schema (columns, samples, lineage)
        │   └── SchemaEditor.tsx     edit view for an asset's schema (columns table)
        └── styles/
            ├── tokens.css           every colour/spacing/typography token — the only place colour is defined
            └── app.css              everything else, built from tokens
```

---

## 4. Architecture

### 4.1 Process model

- **Dev mode** (`npm run dev`): two processes run concurrently (via
  `concurrently`) — `tsx watch src/index.ts` for the API on port `5174`,
  and `vite` for the web app on port `5173`. Vite proxies any `/api/*`
  request to `5174` (see `web/vite.config.ts`), so the browser only ever
  talks to one origin and CORS never comes into play in dev.
- **Production / single-process mode** (`npm run build && npm start`): the
  server checks whether `web/dist` exists (built by Vite) and, if so, serves
  it as static files and falls back to `index.html` for any non-`/api` path
  (SPA routing). The whole app is then one Express process on one port
  (`ATLAS_PORT`, else `5174`).
- **Installed mode** (`npx lineage-atlas`): the same single process as above,
  started through `bin/lineage-atlas.mjs` (§6.8) rather than an npm script. The
  package ships `server/dist` and `web/dist` prebuilt, so there is nothing to
  compile at install time and `web/dist` is always present — an installed copy
  therefore always serves the UI, never the API alone.
- The API binds `ATLAS_PORT`, deliberately **not** `PORT` — some dev harnesses
  (this session's own, in fact — see the memory note about the preview harness
  hijacking `PORT=5173`) inject `PORT` for the web server, and the API must not
  steal it. Whether a busy port is fatal then depends on who is asking:
  - `ATLAS_PORT` **set** — that port or nothing. A script told to use `5174`
    should fail rather than quietly answer elsewhere.
  - **A checkout**, `ATLAS_PORT` unset — `5174` or nothing, for the same
    reason: `web/vite.config.ts` proxies `/api` to `5174` *by number*, so an
    API that quietly moved to `5175` would leave the dev web app talking to
    whatever else is on `5174`. Failing loudly is the point.
  - **An installed copy**, `ATLAS_PORT` unset — walk `5174 → 5183`, then an
    ephemeral port, and print where it landed. Nothing proxies to it by
    number, someone is watching the output, and a stale process should not
    block a start.

  So for an installed copy **`5174` is a default, not a guarantee**: anything
  automating that API should read the startup line rather than assume.

### 4.2 Data flow

```
Browser (React + Zustand)
   │  fetch('/api/...')
   ▼
Express routes (server/src/index.ts)
   │  calls into
   ▼
repo.ts / bundle.ts            (business logic + validation)
   │  SQL via db.ts helpers (all/get/run/tx)
   ▼
node:sqlite (DatabaseSync)  →  data/atlas.db (WAL mode)
```

There is no ORM. Every query is hand-written SQL using three tiny generic
helpers (`all<T>`, `get<T>`, `run`) plus a `tx()` wrapper for transactions.
All mutating operations that touch more than one table are wrapped in `tx()`
so partial writes roll back on error.

### 4.3 Frontend state

All application state lives in a single Zustand store
(`web/src/state/store.ts`) — there is no React Context and no per-component
local server-state cache (aside from a few component-local drafts for
in-progress edits, e.g. `Inspector`'s `descDraft`). The store owns:

- the loaded pipelines list and the active pipeline id,
- the current pipeline's codes, edges, tag counts, and asset catalogue,
- UI/interaction state: selection, multi-selection, canvas mode
  (`select`/`connect`), context menu, open tabs, toasts,
- every mutating action, each of which calls `api.*`, then reconciles local
  state (optimistically for a few actions like `moveCode`/`removeEdge`,
  otherwise from the server's response) and pushes a toast.

Two bits of state persist in `localStorage` across reloads:
- `atlas-session` — the last active pipeline id and selected code id, so a
  refresh reopens where you left off instead of resetting to the seeded
  default.
- `atlas-group-by` / `atlas-asset-group-by` / `atlas-card-detail` /
  `atlas-theme` — UI preferences (grouping, card density, theme).

All of these reads/writes are wrapped in `try/catch` so a browser that
refuses storage (private mode, quota) degrades to "works for this session
only" rather than crashing.

---

## 5. Data model

### 5.1 Conceptual model

```
Pipeline (graph)
 ├── has many → Code
 │                ├── has ordered tags (first = "main tag": names + colours it)
 │                ├── has many → AssetLink (direction: input | output)
 │                │                 ├── has ordered tags (first = "main tag" of the link)
 │                │                 └── optionally resolves to → Asset  (when "documented")
 │                └── has many → FlowStep (ordered; the "logic flow")
 │
 ├── has many → Asset (the catalogue)
 │                ├── optionally produced by → Code   (the first code to declare it as an output)
 │                ├── has many → AssetColumn (ordered; pk/fk/nullable/description/tests)
 │                └── has many → AssetSample (ordered rows, JSON-encoded)
 │
 └── has many → Edge (source Code → target Code; UNIQUE(source,target); DAG-enforced)
```

Key relationships worth calling out:

- **An asset's producer is "first output wins."** The first code that
  declares a given asset name as an *output* becomes its `code_id`. Later
  codes can still declare the same asset as an output (the UI warns about
  this) but do not become the producer.
- **Edges are inferred, not authored directly**, in the normal flow: every
  time an asset link is added/edited and resolves to a documented asset,
  `linkEdgesForAsset` draws an edge from that asset's producer to every code
  that lists it as an input — provided the edge doesn't already exist and
  wouldn't create a cycle. Edges can also be created directly via drag-and-
  drop / `POST /api/edges`, which run the same cycle/duplicate checks.
- **Inferred links are additive.** Deleting an asset link does not retract
  an edge it once implied; the edge is only removed by acting on it directly
  on the canvas (or, for the whole pipeline, `deleteAssetLink` never deletes
  edges — only the link row).
- **A code's `assetId`** (surfaced to the frontend) is simply "the first
  output link that resolves to a documented asset," used to let the context
  menu jump straight to that code's own product schema.

### 5.2 SQLite schema (current, `server/src/db.ts`)

| Table | Columns | Notes |
|---|---|---|
| `graphs` | `id` PK, `name`, `description`, `created_at`, `updated_at` | One row per pipeline |
| `codes` | `id` PK, `graph_id` FK→graphs (CASCADE), `name`, `x`, `y`, `description`, `owner`, `status` (`active`\|`inactive`, CHECK), `created_at`, `updated_at` | Canvas position lives here |
| `code_tags` | `code_id` FK→codes (CASCADE), `tag`, `position` — PK (code_id, tag) | Order = importance; position 0 is the main tag |
| `edges` | `id` PK, `source` FK→codes (CASCADE), `target` FK→codes (CASCADE), UNIQUE(source, target) | |
| `assets` | `id` PK, `graph_id` FK→graphs (CASCADE), `name`, `code_id` FK→codes (SET NULL), `materialization`, `description` | `code_id` = producer |
| `asset_columns` | `id` PK, `asset_id` FK→assets (CASCADE), `name`, `data_type`, `key_kind` (`pk`\|`fk`\|NULL, CHECK), `nullable`, `description`, `tests` (comma-joined string), `position` | |
| `asset_samples` | `id` PK, `asset_id` FK→assets (CASCADE), `position`, `values_json` (JSON array of strings) | One row per sample row |
| `asset_links` | `id` PK, `code_id` FK→codes (CASCADE), `direction` (`input`\|`output`, CHECK), `path`, `detail`, `asset_id` FK→assets (SET NULL), `position` | The input/output declarations |
| `asset_link_tags` | `asset_link_id` FK→asset_links (CASCADE), `tag`, `position` — PK (asset_link_id, tag) | Position 0 = the link's main tag |
| `flow_steps` | `id` PK, `code_id` FK→codes (CASCADE), `position`, `op`, `title`, `body` | The logic flow, no source captured |

Indexes exist on every foreign key column used in a WHERE/JOIN
(`idx_codes_graph`, `idx_code_tags_tag`, `idx_edges_source/target`,
`idx_assets_graph`, `idx_asset_columns_asset`, `idx_asset_links_code`,
`idx_asset_link_tags_tag`, `idx_flow_code`).

`db.ts` also exposes:
- `all<T>(sql, ...params)`, `get<T>(sql, ...params)`, `run(sql, ...params)` —
  thin wrappers over `db.prepare(...).all/get/run`, positional params only
  (node:sqlite is stricter than `better-sqlite3` about named params).
- `tx<T>(fn)` — `BEGIN` / run `fn()` / `COMMIT`, or `ROLLBACK` and rethrow.
- `newEntityId(table)` — a fresh opaque id for a `codes` or `assets` row:
  `code_`/`asset_` plus `nanoid(10)`, retried until free. Names are labels
  people edit and two pipelines may document assets of the same name, so an
  id is never derived from one.
- `uniqueId(table, base)` — slugifies `base` (lowercase, non-alnum → `_`)
  and appends `_2`, `_3`, … until the id is free in `table`. Now used for
  `graphs` alone — a pipeline is the one id a person types, in `?graph=`
  (row ids elsewhere use `nanoid(12)`).
- `touch(codeId)` — bumps a code's `updated_at`.
- `isEmpty()` — used by `seed()` to decide whether to seed on boot.

### 5.3 Migration history (all idempotent, run on every boot via `migrate()`)

The schema evolved through several vocabulary/shape changes; each migration
is guarded so it's a no-op on an already-migrated (or brand-new) database:

1. **Seed the default pipeline row** (`warehouse` / "Analytics warehouse") if
   `graphs` has no such row yet.
2. **`renameToCodesAndAssets`** (guarded on table `nodes` still existing) —
   the original schema called codes "nodes" and assets "datasets," and each
   input/output ("artifact") had a fixed `kind` enum
   (`dataset`\|`file`\|`seed`\|`doc`\|`connector`). This migration renames
   every table and column to the current vocabulary, and folds each
   artifact's old `kind` into its new asset link's **first tag** — so
   `kind: 'file'` becomes the tag `file`, etc. SQLite can't retarget a
   foreign key in place, so this rebuilds every affected table inside one
   transaction with `PRAGMA foreign_keys = OFF`.
3. **`simplifyStatus`** (guarded on `codes.sla` existing) — collapses the
   original three-way freshness status (`fresh`\|`stale`\|`failing`) plus a
   freeform `sla` field down to `active`\|`inactive`. `fresh` → `active`;
   both `stale` and `failing` → `inactive` (a lossy mapping — "still working
   as of its last run" is the line drawn between them).
4. **`dropRowCountAndFreshness`** (guarded on `codes.row_count` existing) —
   drops two free-text fields (`row_count`, `freshness`) that nothing in the
   app ever computed or refreshed.
5. **`dropFlowSource`** (guarded on `codes.source_lang` existing) — drops the
   captured source (`source_lang`/`source_path`/`source_code`) a logic flow
   used to carry, and the `line_from`/`line_to` range each step pointed
   into it. A flow is now just its ordered steps.

This same normalization logic is mirrored in `bundle.ts`'s
`upgradeLegacyBundle`/`normaliseStatus`, so a `.atlas.json` file exported
before these changes (`formatVersion: 1`) can still be imported — see §8.

---

## 6. Backend module reference

### 6.1 `server/src/types.ts`

The single source of truth for shared shapes, later mirrored (by hand) in
`web/src/types.ts`. Notable types:

- `Code`, `AssetLink`, `GraphEdge`, `Graph` — the live graph shape returned
  by `GET /api/graph`.
- `CodeFlow`, `FlowStep`, `FlowInput` — the logic flow read/write shapes.
- `Asset`, `AssetSummary`, `AssetColumn`, `AssetSchemaInput`,
  `AssetLinkInput`, `CodeRef` — the asset/catalogue/schema shapes.
- `Pipeline` — a pipeline's list-row shape (with `codeCount`/`edgeCount`).
- `AtlasBundle`, `BundleCode`, `BundleAsset`, `BundleGenerator`,
  `BundleCounts` — the `.atlas.json` export/import envelope (current format
  version **6**). The version constants themselves live in `version.ts` and are
  re-exported here, so existing `from './types.js'` imports still work.
- `BundleReadResult` — what `readBundle` returns: the bundle, the version it was
  found at, the upgrade steps applied, and any non-fatal repairs.
- `ImportResult` — what an import reports back: the pipeline **plus** its
  provenance (`source.formatVersion`, `source.generator`), so a pipeline that
  arrived as a file can still say where it came from.
- `VersionInfo` — the `GET /api/version` payload.
- `LegacyBundleV1`, `LegacyCodeStatus` — the pre-rename bundle shape
  (`nodes`/`datasets`/`artifacts`, three-way status), kept as documentation of
  what rung 1 of the upgrade ladder consumes.

### 6.1b `server/src/version.ts`

Nine lines of constants and one function, and the single source of truth for
every version the app publishes: `APP_NAME` / `APP_TITLE` / `APP_VERSION`,
`BUNDLE_FORMAT` / `BUNDLE_VERSION` / `MIN_BUNDLE_VERSION`, `BUNDLE_EXTENSION`,
and `generator()` (stamped into every export). `scripts/check-version.mjs`
asserts `APP_VERSION` matches all three `package.json` files, and runs as the
first step of `npm run build` — so a release cannot ship claiming one version in
its files and another in its manifest.

### 6.2 `server/src/db.ts`

Covered in §5.2/§5.3 above — connection setup, DDL, migrations, and the
`all`/`get`/`run`/`tx`/`uniqueId`/`touch`/`isEmpty` helpers everything else
is built on. The one thing it does not decide for itself is *which file* to
open: `DB_PATH` comes from `paths.ts`.

### 6.2b `server/src/paths.ts`

Answers one question — where does this install keep its database? — and it has
two very different answers:

- **A checkout** (`npm run dev`, `npm start`) uses `data/atlas.db`, next to the
  source, where it is seeded, disposable and gitignored.
- **An installed copy** (`npx lineage-atlas`, or a global install) uses the
  platform's per-user data directory: `~/Library/Application Support/
  lineage-atlas/` on macOS, `$XDG_DATA_HOME` (else `~/.local/share`) on Linux,
  `%APPDATA%` on Windows. It must not be the package directory: that lives
  inside an npm cache or `node_modules`, which the next upgrade is free to
  delete, and a documentation tool that loses your documentation on upgrade is
  worse than no tool.

The two are told apart by `isCheckout`, which tests for `../src` next to the
running module. The published package ships `dist` only, so that path exists
when running from source *and* from a built checkout, and is gone once
installed — no environment variable, install flag or heuristic about the
current directory is involved.

`ATLAS_DB` overrides both, always. That is how you keep more than one atlas,
point an installed copy at a checkout's data, or put the database somewhere
backed up.

### 6.3 `server/src/repo.ts`

The entire business logic layer. No file in the backend talks to SQL
directly except this one (and `bundle.ts`/`db.ts`/`seed.ts`, which are the
other three places that legitimately need raw access). Grouped by concern:

**Reads**
- `getGraph(graphId)` — the whole graph in one shot: codes (with tags,
  inputs/outputs, `hasFlow`, and `searchTerms`), plus edges. `searchTerms`
  is built by folding in the **names of columns of the asset this code
  produces** and the **titles+bodies of its logic-flow steps**, so a search
  for a column name or "what a step actually does" finds the code without
  opening its docs. Codes are ordered by `(x, y)` — top-left to bottom-right,
  a stable and meaningful default order for the rail.
- `getFlow(codeId)` — a code's ordered logic steps.
- `getAsset(assetId)` — a full asset: columns, sample rows, producer,
  every consuming code (`consumedBy`, derived from `asset_links WHERE
  direction='input'`), and two derived booleans, `certified`/`containsPii`,
  computed from whether the **producer's tags** include `certified`/`pii`
  (an asset has no tags of its own — it inherits these two from its
  producing code).
- `listTags(graphId)` — tag → count, for the rail's filter chips.
- `listAssets(graphId)` / `listPipelines()` / `getPipeline(graphId)` —
  summary rows for the catalogue and the pipeline switcher.
- `assetsInGraphOfCode(codeId)` — every asset in a code's own pipeline,
  used to populate the "pick an existing asset" suggestions in the asset
  link editor.

**Code mutations**
- `createCode(graphId, input)` — generates an opaque id (`newEntityId`),
  defaults to the `draft` tag if none given, inserts in a transaction.
- `updateCode(codeId, patch)` — whitelist-patches `name | description |
  owner | status | x | y` (only the fields present in `patch` are touched).
- `deleteCode(codeId)` — relies entirely on `ON DELETE CASCADE` to clean up
  tags, asset links, and flow steps.
- `duplicateCode(codeId, withInputs)` — copies the code (offset +40/+134 on
  the canvas), its tags plus a forced `draft` tag, its asset links (but an
  output link's `asset_id` is dropped on the copy — **the copy never claims
  the original's produced asset**, since two producers of one table would be
  a lie), and its flow steps. If `withInputs`, also copies every edge that
  targeted the original so the copy inherits the same upstream dependencies.
- `addTag` / `removeTag` / `setPrimaryTag` / `normaliseTag` — tag CRUD.
  `normaliseTag` lowercases, replaces whitespace runs with `_`, and strips
  anything outside `[a-z0-9_.-]`. `setPrimaryTag` reassigns `position` to
  one less than the current minimum, which is a cheap way to move a tag to
  the front without renumbering everything else.

**Edges**
- `addEdge(source, target)` — validates: not self-referential, both codes
  exist, same pipeline, not already present, and (via `createsCycle`, a
  simple DFS from `target` looking for `source`) not cycle-forming. Throws
  `ConflictError` (→ HTTP 409) otherwise.
- `removeEdge(edgeId)`.
- `relinkPipeline(graphId)` — re-runs `linkEdgesForAsset` for every asset in
  the pipeline; used by "Rebuild links from inputs & outputs."

**Assets & asset links**
- `resolveAsset(codeId, name, direction)` — the core of "documented asset"
  linking: finds-or-creates an asset by name within the code's pipeline; if
  the link is an `output` and the asset has no producer yet, this code
  becomes the producer.
- `linkEdgesForAsset(assetId)` — draws an edge from the asset's producer to
  every distinct code that lists it as an input, skipping self-loops,
  duplicates, and cycle-forming edges (silently — the declaration is still
  recorded even if the arrow is skipped). Returns the count created, which
  the frontend uses to decide whether to notify "linked N codes by data
  flow" and whether to force a full graph reload.
- `addAssetLink` / `updateAssetLink` / `deleteAssetLink` — CRUD for one
  input/output row on a code, each returning `{ code, assetId,
  edgesCreated }` so the frontend can react to newly-inferred edges.
- `createAsset` / `deleteAsset` — catalogue-level create ("+ new asset,"
  rejects a duplicate name in the same pipeline) and delete (asset links
  survive deletion; they just stop resolving to a schema page).
- `saveAssetSchema(assetId, input)` — replaces an asset's materialization,
  description, columns, and sample rows **wholesale** in one transaction
  (delete-then-reinsert, like `saveFlow` does for logic steps) — simpler and
  less racy than diffing individual rows for something edited as a whole
  form.

**Pipelines**
- `listPipelines` / `getPipeline` / `createPipeline` / `updatePipeline` /
  `deletePipeline` / `touchPipeline`. `deletePipeline` refuses to delete the
  last remaining pipeline (`ConflictError`); everything else cascades.

**Internal helpers**
- `findCode(codeId)` — re-reads a single code through `getGraph`, used after
  any mutation to return the up-to-date `Code` shape.
- `graphIdOfCode(codeId)`, `tagsOf(codeId)`, `group(rows, key, value)` (a
  tiny array→Map grouping utility used throughout `getGraph`/`getAsset`).

### 6.4 `server/src/bundle.ts` — the `.atlas.json` format

See §8 for the file format itself and [docs/FILE_FORMAT.md](docs/FILE_FORMAT.md)
for the normative spec; this section covers the module.

**Export**

- `exportPipeline(graphId)` -> `AtlasBundle` — walks the pipeline's codes (with
  tags, flow steps, and asset links), assets (with columns and sample rows), and
  edges, and assembles the versioned envelope: `format` / `formatVersion` /
  `generator` / `exportedAt` / `counts` / `pipeline` / `codes` / `edges` /
  `assets`. All ids in the output are the **live database ids**; remapping to
  bundle-local ids happens on import, not export.
- `bundleFilename(bundle)` — `<slugified-pipeline-name>-<yyyy-mm-dd>.atlas.json`.

**The upgrade ladder**

`UPGRADES` is a `Record<number, UpgradeStep>` with **one rung per format
version**, keyed by the version it upgrades *from*. Each rung carries an
`apply` function and a `note` written to be read by a human. `upgradeBundle`
loops from the file's own `formatVersion` up to `BUNDLE_VERSION`, applying one
rung at a time and collecting one note per step — so nothing ever jumps versions,
and adding a format means adding exactly one entry and touching nothing else.

| Rung | Turns | Into | What it does |
|---|---|---|---|
| `1` | v1 | v2 | `nodes`/`datasets`/`artifacts` -> `codes`/`assets`/`assetLinks`; each artifact's `kind` becomes its link's main tag (`dataset` was the default and yields no tag) |
| `2` | v2 | v3 | `fresh`/`stale`/`failing` -> `active`/`inactive` via `normaliseStatus`; drops `sla` |
| `3` | v3 | v4 | drops `rowCount` and `freshness` |
| `4` | v4 | v5 | drops the captured `source` and each step's `lineFrom`/`lineTo` |
| `5` | v5 | v6 | adds `generator` (`unknown` / `pre-1.0` when the file cannot say) and computes `counts` |

Rungs 1 through 4 mirror the database migrations in §5.3 one for one, so a file
and a database that started at the same version land in the same place. This
replaces the old single-shot `upgradeLegacyBundle`, which special-cased v1 and
treated 2 through 5 as already current.

**Reading and validating**

- `readBundle(input)` -> `BundleReadResult` — the gatekeeper for every import,
  and the whole of `POST /api/pipelines/validate`. In order: reject a non-object;
  require `format === 'lineage-atlas.pipeline'`; require `formatVersion` to be a
  positive integer within `[MIN_BUNDLE_VERSION, BUNDLE_VERSION]` (a **newer** file
  is refused rather than guessed at); run the upgrade ladder; then check the
  contents.

  It draws a deliberate line between two classes of problem:

  - **Errors** throw `BundleError` (-> HTTP 422) and nothing is written: missing
    `pipeline.name`; a code without an id or name; a duplicate code or asset id;
    an unknown `status`; an unknown asset-link `direction`; an edge whose
    endpoint is not a code in the file.
  - **Warnings** are returned alongside a *repaired* bundle, and the import still
    lands whole: a dangling `assetRef` (nulled), a `producedBy` naming a code not
    in the file (nulled), a self-loop, a duplicate edge, an edge that would close
    a cycle, and `counts` that disagree with the actual arrays (the arrays win).

  The cycle check is the one that matters most. Everywhere else the graph is
  acyclic by construction — `repo.addEdge` refuses a cycle, `linkEdgesForAsset`
  skips one — and **a file was previously the one way an edge could enter the
  graph without passing either check**. `readBundle` now accepts edges one at a
  time against the set already accepted, using a small local `reaches()` DFS, and
  drops any that would close a loop. Dropping rather than refusing matches how
  inferred links already behave, so a foreign file with one bad arrow still
  imports and the user is told exactly which arrow did not survive.

- `validateBundle(input)` -> `AtlasBundle` — a thin wrapper returning just the
  bundle, kept for callers that do not surface the notes.

**Import**

- `importBundle(input, nameOverride?)` -> `ImportResult` — runs `readBundle`
  first, then, in one transaction: creates a `graphs` row (name from
  `nameOverride` or the bundle's own, either way through `uniqueId` so a
  re-import never collides); inserts codes, remapping bundle-local ids to fresh
  db ids in a `Map`, with their tags and flow steps; then assets (remapped the
  same way, `producedBy` resolved through the code map) with their columns and
  sample rows; then asset links (resolved through **both** maps); then edges
  (resolved through the code map). Because `readBundle` has already removed
  self-loops, duplicates and cycle-formers, what reaches the insert is safe.

  Returns the pipeline plus its provenance — the source `formatVersion`, the
  `generator` that wrote the file, the upgrade notes and the warnings — which is
  what the UI toast, the browser console and the CLI all report.

  **An import either lands whole or not at all**, and **always creates a new
  pipeline** — there is no merge-into-existing mode.

### 6.5 `server/src/cli.ts`

A thin terminal wrapper over `repo.listPipelines` / `bundle.exportPipeline` /
`bundle.readBundle` / `bundle.importBundle` — five subcommands:

```
tsx src/cli.ts version                       # → app version + the format range it reads
tsx src/cli.ts list                          # → table of id / codes / edges / name
tsx src/cli.ts export <pipeline-id> [file]   # → writes .atlas.json (pretty-printed, trailing newline)
tsx src/cli.ts validate <file>               # → checks a file, writes nothing, exits 1 if refused
tsx src/cli.ts import <file> [new-name]      # → creates a new pipeline from the file
```

Exposed at the root as `npm run pipelines`, `npm run export -- <id> [file]`,
`npm run validate -- <file>`, `npm run import -- <file> ["Name"]`.

Two things make this usable from a script or a CI job rather than only by hand:

- **`validate` is the import gate with the write removed.** It runs the same
  `readBundle` the importer runs, prints the pipeline name, counts, source format
  and generator, then one `upgraded` line per ladder step and one `repaired` line
  per warning. It exits `0` if the file would import and `1` if it would be
  refused.
- **A bad file is a user error, not a crash.** The whole switch is wrapped so a
  `BundleError` prints `Refused: <message>` and exits `1`, with no stack trace;
  `readJson` does the same for a file that is missing or not valid JSON. Anything
  else still throws, because anything else is a bug.

### 6.6 `server/src/index.ts` — the Express app

- Calls `seed()` once at startup (no-op if the database already has
  content).
- Serves **`GET /api/version`** (`VersionInfo`: app name and version, the bundle
  format and version it writes, the oldest it reads, and the Node version) — the
  first call any client or agent should make, so nothing has to hard-code a
  version. `GET /api/health` reports `{ ok, version }`.
- Serves **`POST /api/pipelines/validate`**, which runs `readBundle` and returns
  the pipeline header, counts, source provenance, upgrade notes and warnings
  **without writing anything** — the same gate the importer runs, usable as a
  pre-flight check from CI or an agent.
- `cors()` is enabled globally (there is no auth at all — see §11).
- **Two JSON body limits.** `POST /api/pipelines/import` and
  `/api/pipelines/validate` get `MAX_IMPORT` (default **128 MB**, overridable
  with `ATLAS_MAX_IMPORT`); every other route keeps **25 MB**. A bundle is a
  whole pipeline in one body, so it is one or two orders of magnitude larger
  than anything else the API accepts. The large parser is registered *before*
  the general one — body-parser flags a request it has read, so the general
  parser then skips it. The cap is deliberate rather than absent: the body is
  buffered whole, decoded to a string and `JSON.parse`d, so peak memory is
  several times the file size, and a 413 that names the CLI is a better
  outcome than an out-of-memory crash. Over the limit ⇒ **413** with the
  file's size, the limit and the way out; malformed JSON ⇒ **400**.
- `wrap(fn)` — a tiny helper that lets every route handler be a plain
  (possibly throwing) function; it forwards thrown errors to Express's
  error middleware instead of requiring `try/catch` in every handler.
- `graphOf(req)` — resolves which pipeline a request is about from
  `?graph=<id>`, defaulting to `DEFAULT_GRAPH_ID` (`'warehouse'`).
- A catch-all error handler at the bottom maps `ConflictError` → 409,
  `BundleError` → 422, body-parser's `entity.too.large` → 413 and
  `entity.parse.failed` → 400, anything else → 500 (logged to
  `console.error`).
- After all API routes, if `web/dist` exists it's mounted as static files
  with an SPA fallback (`app.get('*', ...)`) that passes unmatched `/api/*`
  paths straight through rather than serving `index.html` for them.
- Immediately after that, `app.use('/api', ...)` answers anything still
  unmatched with `404 {error}`. It is *mounted* rather than routed so every
  verb is covered, and it sits outside the `web/dist` block because an
  API-only run has no SPA fallback to pass through in the first place.
  Without it Express's own HTML 404 would reach a client parsing the body as
  JSON, which is a syntax error rather than a usable message.
- Listening is a small ladder rather than a single `listen()` call. With
  `ATLAS_PORT` set — or in a checkout, where Vite's proxy names `5174` — there
  is exactly one candidate and `EADDRINUSE` exits 1 with a message naming the
  variable. For an installed copy the candidates are `5174` through `5183` and
  then `0` (let the OS choose), each tried in turn on `EADDRINUSE`, so the last
  candidate cannot fail that way and the ladder always terminates. Any other
  listen error is fatal immediately.
- On success it logs two lines: `Lineage Atlas 1.0.0 (file format 6) on
  http://localhost:<port>` — or "Lineage Atlas API" if the built web app is not
  present — and `Data: <path>`, the database actually opened (§6.2b). Both
  matter because neither the port nor the path is fixed any more.
- If the UI is being served and stdout is a TTY, it opens the URL in the
  default browser (`open` / `start` / `xdg-open`, spawned detached so the app
  neither holds it open nor dies with it; a spawn failure is ignored — the URL
  is printed regardless). The TTY test is the closest available proxy for "a
  person is watching": containers, CI and service managers get no browser.
  `ATLAS_NO_OPEN` settles it explicitly either way.

### 6.7 `server/src/seed.ts`, `seed-data.ts`, `seed-flows.ts`

- `seed({ force })` — if the database is non-empty and `force` is falsy,
  does nothing (this is what makes it safe to call unconditionally on every
  boot). With `force: true` (used by `npm run seed`), it deletes only the
  **seeded pipeline's** codes and assets (imported pipelines are untouched)
  and reloads them from `seed-data.ts`/`seed-flows.ts`.
- `seed-data.ts` — `CODES`, `EDGES`, `ASSET_DOCS`: the demo "Analytics
  warehouse" pipeline — 18 codes across staging/marts/checks, their
  positions, descriptions, owners, statuses, tags, and their input/output
  declarations (using the **old** `kind` vocabulary — `dataset`/`file`/
  `seed`/`doc`/`connector` — which `seed.ts` folds into tags the same way
  the migration does), plus full column/sample-row documentation for the
  asset-backed outputs.
- `seed-flows.ts` — `FLOWS`: the ordered logic-flow steps for a subset of
  those codes, keyed by code id.
- Running `seed.ts` directly with `--force` (`npm run seed`) reseeds and
  prints the resulting code count.

### 6.8 `bin/lineage-atlas.mjs` — the installed command

The `bin` entry of the published package, and the only file that exists purely
because the app is distributable. It is a router, not a third implementation:

- No arguments (or a leading flag) means **serve** — what someone typing
  `npx lineage-atlas` wants. An explicit `serve` does the same but defaults to
  *not* opening a browser, on the theory that anyone typing the subcommand is
  scripting it.
- `list`, `export`, `validate`, `import` and `version` are forwarded to
  `server/dist/cli.js` (§6.5), which parses `process.argv` itself.
- `--db <file>`, `--port <n>` and `--no-open` are translated into `ATLAS_DB`,
  `ATLAS_PORT` and `ATLAS_NO_OPEN` before the real entry point is imported, so
  every setting keeps exactly one definition — the one the server already had.
  `--db` is accepted on the file commands too, and is stripped from the
  arguments before they reach the CLI; any *other* `--flag` there is refused
  rather than passed through, because the CLI would read it as an operand and
  an unrecognised flag in the outfile position silently writes a file named
  after the flag.
- `--help` prints the usage; an unknown command prints it to stderr and exits
  1.

---

## 7. REST API reference

All routes are mounted under `/api`. Body is JSON; most GETs and mutations
that are pipeline-scoped take `?graph=<pipelineId>` (defaulting to
`warehouse`). Errors are always `{ "error": "message" }` with a matching
status code (`400` bad input, `404` not found, `409` conflict/business-rule
violation, `422` invalid bundle, `500` unexpected).

### Health

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ ok: true, version }` |
| GET | `/api/version` | `VersionInfo` — app version, `bundleFormat`, `bundleVersion`, `minBundleVersion`, Node version. Read this before hard-coding anything. |

### Pipelines

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/pipelines` | — | List all pipelines with counts |
| POST | `/api/pipelines` | `{ name, description? }` | 400 if no name |
| PATCH | `/api/pipelines/:id` | `{ name?, description? }` | 404 if missing |
| DELETE | `/api/pipelines/:id` | — | Cascades everything in it; 409 if it's the last pipeline |
| GET | `/api/pipelines/:id/export` | — | Downloads a `.atlas.json` (sets `Content-Disposition`) |
| POST | `/api/pipelines/validate` | `{ bundle }` (or the bundle itself as the whole body) | Runs the import gate and **writes nothing**: `{ ok, pipeline, counts, source, upgrades, warnings }`; 422 if it would be refused |
| POST | `/api/pipelines/import` | `{ bundle, name? }` (or the bundle itself as the whole body) | Creates a **new** pipeline. Returns `{ pipeline, source, upgrades, warnings }` — **not** a bare pipeline; 422 on an invalid/unsupported file |
| POST | `/api/pipelines/:id/relink` | — | Re-derives edges from declared inputs/outputs; `{ edgesCreated }` |

### Graph

| Method | Path | Notes |
|---|---|---|
| GET | `/api/graph?graph=<id>` | `{ codes, edges, tags, pipelineId }` — the whole pipeline in one call |

### Codes

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/codes?graph=<id>` | `{ name, tags?, x?, y?, description?, owner? }` | 400 if no name; 404 if pipeline missing |
| PATCH | `/api/codes/:id` | any of `name, description, owner, status, x, y` | 404 if missing |
| DELETE | `/api/codes/:id` | — | Cascades tags/links/flow steps |
| POST | `/api/codes/:id/duplicate` | `{ withInputs? }` | Returns the new code |
| POST | `/api/codes/:id/tags` | `{ tag }` | 400 if empty; returns `{ tags }` |
| DELETE | `/api/codes/:id/tags/:tag` | — | Returns `{ tags }` |
| POST | `/api/codes/:id/tags/:tag/primary` | — | Promotes `tag` to first; returns `{ tags }` |
| GET | `/api/codes/:id/flow` | — | `{ codeId, name, steps }` |
| PUT | `/api/codes/:id/flow` | `{ steps: [{op,title,body}] }` | Replaces the flow wholesale |
| GET | `/api/codes/:id/linkable-assets` | — | `{id,name}[]` — every asset in the code's pipeline |

### Asset links (a code's inputs/outputs)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/codes/:id/asset-links` | `{ direction, path, detail?, tags?, documented? }` | Returns `{ code, assetId, edgesCreated }` |
| PATCH | `/api/asset-links/:id` | any of `direction, path, detail, tags, documented` | Same return shape |
| DELETE | `/api/asset-links/:id` | — | Returns `{ code, assetId: null, edgesCreated: 0 }` |

### Assets (the catalogue)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/assets?graph=<id>` | — | `AssetSummary[]` |
| GET | `/api/schema?graph=<id>` | — | `SchemaTable[]`: every asset with its columns, producer, consumers and badges, sample rows left out. What the Schema tab draws, in one call instead of one `GET /api/assets/:id` per table |
| POST | `/api/assets?graph=<id>` | `{ name, materialization?, description?, producerCodeId? }` | 400 if no name; 409 on duplicate name in pipeline |
| GET | `/api/assets/:id` | — | Full `Asset` (columns, samples, producer, consumers) — `:id` is URI-encoded |
| DELETE | `/api/assets/:id` | — | Removes from catalogue; links survive as unresolved |
| PUT | `/api/assets/:id/schema` | `{ materialization, description, columns, sampleRows }` | Replaces schema wholesale |

### Edges

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/edges` | `{ source, target }` | 400 if missing either; 409 on self-loop / cross-pipeline / duplicate / cycle |
| DELETE | `/api/edges/:id` | — | |

---

## 8. The `.atlas.json` bundle format

One pipeline exports to one self-contained JSON file.
**[docs/FILE_FORMAT.md](docs/FILE_FORMAT.md) is the normative spec** — field by
field, with the error/warning catalogue and a worked example of writing a
producer. This section is the summary.

Current envelope (`formatVersion: 6`):

```json
{
  "format": "lineage-atlas.pipeline",
  "formatVersion": 6,
  "generator": { "name": "lineage-atlas", "version": "1.0.0" },
  "exportedAt": "2026-09-09T19:08:39.089Z",
  "counts": { "codes": 18, "edges": 23, "assets": 14 },
  "pipeline": { "name": "Analytics warehouse", "description": "…" },
  "codes": [
    {
      "id": "stg_orders", "name": "stg_orders", "x": 0, "y": 0,
      "description": "…", "owner": "…", "status": "active",
      "tags": ["sql", "staging"],
      "steps": [{ "position": 0, "op": "read", "title": "…", "body": "…" }],
      "assetLinks": [
        { "direction": "output", "path": "analytics.stg_orders", "detail": "…",
          "tags": ["mart"], "assetRef": "analytics_stg_orders", "position": 0 }
      ]
    }
  ],
  "edges": [{ "source": "stg_orders", "target": "fct_orders" }],
  "assets": [
    {
      "id": "analytics_stg_orders", "name": "analytics.stg_orders",
      "materialization": "table", "description": "…", "producedBy": "stg_orders",
      "columns": [{ "name": "order_id", "dataType": "varchar", "keyKind": "pk",
                     "nullable": false, "description": "…", "tests": ["not_null","unique"] }],
      "sampleRows": [["123", "…"]]
    }
  ]
}
```

The first five keys are the **envelope**, and are stable across every version of
the format: a reader can inspect them alone and decide whether it understands the
rest. `generator` and `counts` were added in format 6 — the first records what
wrote the file, so provenance survives being passed around; the second means a
large file states its own size in its first few lines, which matters when a human
or an agent is reading the head of one.

Key properties:

- **Ids are local to the file** (`BundleCode.id`, `BundleAsset.id`,
  `assetLinks[].assetRef`, `assets[].producedBy`) and are **remapped on import**
  to freshly generated database ids. This is what makes the same file safe to
  import repeatedly — each import is independent, so a file can be imported
  alongside the very pipeline it was exported from without collision.

  Verified consequence: `export -> import -> export` returns a file identical to
  the original in every respect **except its ids**. Content is lossless; ids are
  handles the receiving Atlas assigns for itself.
- **Import always creates a new pipeline.** There is no merge-into-existing mode.
- **Validated before anything is written**, and written inside one transaction:
  an import lands whole or not at all.
- **Two classes of problem, kept apart.** A file that is *meaningless* is refused
  outright (422). A file with an *obvious safe reading* — a dangling `assetRef`,
  a duplicate edge, an edge that would close a cycle — imports whole, with every
  repair reported back in `warnings`. See §6.4.
- **The DAG invariant holds through the file boundary.** Cycle-forming edges are
  dropped on read, so an imported graph is acyclic like any other.
- **Forward compatibility is refused, backward compatibility is supported.** A
  file newer than the running `BUNDLE_VERSION` is rejected with a message naming
  both versions. Anything from `MIN_BUNDLE_VERSION` (1) up is walked to the
  current format one rung at a time, and every step is reported.
- **Self-contained but not bloated.** Schemas, sample rows and full logic-flow
  text travel with the file, but a logic flow is *only* its steps — no captured
  source — which keeps a pipeline's export small enough to paste into a chat
  message, and safe to share when the repository it describes is not.

## 9. Frontend module reference

### 9.1 `web/src/types.ts`

Mirrors the server's shapes (kept in sync by hand — there's no shared
package) and adds presentation-only helpers:

- `tagColor(tag)` — five well-known tags (`source`, `sql`, `python`, `mart`,
  `test`) get fixed CSS-variable colours (`--t-source` etc.); everything
  else hashes its own name (`hash = hash*31 + charCode`, mod palette length)
  into one of 8 palette slots (`--tag-1`..`--tag-8`). This is what makes tag
  colour **stable across machines and pipelines with no stored state** — the
  same string always hashes to the same slot.
- `primaryTag(code)` — `code.tags[0]`, falling back to `'untagged'`.
- `codeColor(code)` = `tagColor(primaryTag(code))`.
- `assetLinkTag(link)` — `link.tags[0]` or `null` (a link's tags are
  optional, unlike a code's).
- `normaliseTag(tag)` — same normalization rule as the backend's
  `repo.normaliseTag` (kept duplicated so the UI can preview the cleaned-up
  tag before it round-trips to the server).
- `STATUS_COLOR` — `active` → `--good`, `inactive` → `--ink-3`.

### 9.2 `web/src/api/client.ts`

A single `request<T>(path, init)` wrapper around `fetch('/api'+path, ...)`
that: sets `Content-Type: application/json` whenever a body is present,
throws a typed `ApiError` (carrying the HTTP status) on a non-2xx response
using the server's `{error}` body when present, and returns `undefined` for
`204 No Content`. `api.*` is then one small function per endpoint in §7 —
this is the **only** place in the frontend that constructs a URL or touches
`fetch` directly. `api.exportUrl(id)` is deliberately just a URL string
(not a `fetch` call) so the browser's native download flow can read the
server's `Content-Disposition` filename. `api.version()` reads
`GET /api/version`, and `api.importPipeline()` returns the full `ImportResult`
(pipeline **plus** source provenance, upgrade notes and warnings) rather than a
bare pipeline.

### 9.3 `web/src/state/store.ts` — the Zustand store

One `useAtlas` hook exposes the entire app. Structurally:

- **Data slice**: `pipelines`, `activePipeline`, `codes`, `edges`,
  `tagCounts`, `assets`, `status` (`loading|ready|error`), `loadError`,
  `version` (the `VersionInfo` the API reports about itself).
- **Rail/view slice**: `railTab` (`codes|assets`), `groupBy`,
  `assetGroupBy` (both persisted to `localStorage`).
- **Selection/interaction slice**: `selectedId`, `focusRequest` (a counter
  bumped to trigger "recentre the canvas on the selection" without needing
  a ref), `query`, `tagFilter` (a `Set`), `mode` (`select|connect`),
  `connectFrom`, `bulkConnectFrom` (multi-source connect), `menu` (context
  menu position + target), `selectedIds`/`multiAnchorId` (bulk selection in
  the rail, independent of `selectedId`), `tabs`/`activeTab`, `toast`.
- **Actions** — every mutating user action lives here as an async method
  that: calls the appropriate `api.*`, updates local state (either from the
  server's response, or a full `load()`/`loadAssets()` refetch when the
  mutation might have side effects elsewhere — e.g. any asset-link change
  that reports `edgesCreated > 0` triggers `applyAssetLinkResult` to reload
  the whole graph, since new edges appeared server-side that the local
  patch can't reconstruct), and calls `notify(...)` to surface a toast.
  Failures fall back to a generic message via the `message(err, fallback)`
  helper, using `ApiError.message` when available.

Some actions worth calling out for their non-obvious behavior:

- `load(graphId?)` — the app's boot sequence. Fires off `api.version()` in the
  background on the first run — deliberately not awaited and with its rejection
  swallowed, since a server too old to answer is still perfectly usable and must
  not fail the boot. Then fetches pipelines, picks the
  requested pipeline if it still exists (else falls back to the first one —
  handles the case where the previously-active pipeline was deleted), loads
  its graph, and picks a `selectedId`: keeps the current selection if it's
  still valid, else prefers a code that **has a logic flow documented**
  (`hasFlow`) so a fresh load opens on something worth reading rather than
  an empty inspector.
- `moveCode(id, x, y)` — optimistic: updates local state immediately (the
  drag has already moved the node on screen) and persists in the
  background; a failure just shows a toast (no rollback — the node stays
  where it visually is, since re-snapping it after a failed save would be a
  worse experience than a rare unsaved position).
- `removeEdge(edgeId)` — optimistic with rollback: removes locally first,
  restores the previous edge list if the server call fails.
- `duplicate(id, withInputs)` — after the server responds, does a full
  `load()` (not a local patch) because a duplicate-with-inputs can create
  several new edges the client has no way to reconstruct from the response
  alone.
- `selectRange(id, order)` — Shift+click range selection: extends from
  `multiAnchorId` (or the currently selected single code) through `id`,
  using `order` (the rail's current on-screen top-to-bottom order across all
  groups) so the range matches what the user visually sees, not database
  order.
- `startBulkConnect(ids)` vs `startConnect(fromId)` — the same "connect
  forward" flow, but `bulkConnectFrom` holds an array of sources; `connectTo`
  dispatches to `bulkConnect` when a bulk connect is pending, otherwise to
  the single-source `connect`.
- `cancelConnect()` — only clears the search query if a connect was actually
  in progress, so pressing Escape while merely searching (not connecting)
  doesn't wipe the search box as a side effect.
- `importPipelineFile(file)` — parses the file client-side (so a non-JSON file
  fails fast with a clear message before ever reaching the network), posts it,
  then reports **how** it landed as well as that it landed. Every upgrade note
  and repair goes to the browser console (`console.info` / `console.warn`), and
  the toast carries the headline: the counts, plus "upgraded from format N" when
  the ladder ran, plus the single warning if there was one or "N adjustments —
  see the console" if there were several. One toast line cannot carry a list, and
  a file that imported with three edges dropped is a partial failure that would
  otherwise look exactly like a clean success.

### 9.4 `web/src/lib/lineage.ts`

Pure functions, no state, fully unit-testable in isolation:

- `walk(id, edges, direction)` — iterative DFS (explicit stack, not
  recursion) either backwards (`up`) or forwards (`down`) over the edge
  list.
- `upstream(id, edges)` / `downstream(id, edges)` — everything reachable in
  each direction.
- `lineageSet(id, edges)` — `{id} ∪ upstream ∪ downstream`, or `null` when
  nothing is selected — used to compute which nodes/edges get the "in
  lineage" highlight vs. dimmed on the canvas.
- `matches(code, filters)` — the search/filter predicate: every active tag
  filter must match `code.tags`, **and** (if a query is present) the query
  must appear somewhere in a haystack built from name, description, owner,
  tags, input/output paths, and `searchTerms` (the server-folded column
  names + flow step text — see §6.3). This single function backs both the
  rail's filtering and the canvas's dim/highlight rendering, so the two
  views can never disagree about what "matches" means.

### 9.4b `web/src/lib/schemaGraph.ts`

Pure helpers behind the Schema tab, in the same spirit as `lineage.ts`: nothing
stored, everything derived.

- `tableHeight(table, density)`: a node's rendered height at a density, from the
  same constants the CSS uses, so layout needs no DOM measurement. The two-line
  *produced by* / *consumed by* block counts towards it whenever a table has a
  code on either side.
- `schemaOf(name)`: the part of a table name before its first dot (`raw` in
  `raw.web_events`).
- `layoutGrid(tables, density)`: groups tables by schema (named schemas
  alphabetically, unqualified last), gives each group a heading and a band of up
  to four columns, and drops tables in name order into the currently shortest
  column, so mixed heights pack without ragged gaps. Heights come from the chosen
  density, `all` under *Auto*, so zooming never reshuffles tables.
- `searchTables(tables, query)`: tables matching on name, description,
  materialization, any code that writes or reads them, or any column's name or
  description, each with its matching column ids; `null` for an empty query.

The file also keeps `schemaEdges`, `layoutTables` and `traceColumn`, which derive
table-to-table data-flow edges, a layered layout over them and a by-name column
trace. **None of them is wired in**: the Schema tab deliberately shows tables
without links for now. They are pure and self-contained, so linking can return
without being rebuilt.

### 9.5 `web/src/App.tsx`

The shell. Handles:

- Boot: calls `load()` once on mount; renders a loading state, an error
  state (with retry + a hint to start the API), or the app.
- **Global keyboard shortcuts** (ignored while typing in an input/textarea/
  contenteditable, via `isTyping`):
  - `Escape` — closes the context menu, cancels any pending connect, clears
    multi-select.
  - `/` — jumps to the graph tab and focuses the search box.
  - `v` / `V` — select mode.
  - `c` / `C` — start connecting from the current selection (or enter
    connect mode with no source yet); `preventDefault`'d unconditionally
    because `startConnect` immediately moves focus to the rail's search
    input, and an un-prevented keydown would still deliver the same `c`
    keystroke into that now-focused field.
  - `d` — duplicate; `D` (i.e. Shift+d) — duplicate with inherited upstream
    edges.
  - `Enter` — opens the selected code's logic flow, but only while the graph
    tab is active.
- Layout: the graph pane (`SearchRail` + `GraphCanvas` + conditionally
  `Inspector`) stays **mounted at all times** (just `hidden` via CSS) so the
  canvas viewport/zoom survives switching to a doc tab and back; each opened
  flow/schema tab is its own pane, also kept mounted once opened. The
  `Inspector` is only rendered at all when something is selected — "nothing
  selected" is a deliberate zero-column state, not a missing empty state
  (see README §"Notes on the design").

### 9.6 Components — one-line responsibility for each

| Component | Responsibility |
|---|---|
| `TopBar.tsx` | Logo/name, the pipeline switcher (`PipelineMenu`), a keyboard-shortcut hint, and a 3-state theme toggle (`system → light → dark → …`, persisted to `localStorage`, applied as `data-theme` on `<html>`). |
| `PipelineMenu.tsx` | Dropdown: switch pipeline, create new (empty), import a `.atlas.json` file, export the current one, rebuild links, rename, delete (with a confirm-again-to-really-delete step; disabled when it's the only pipeline). |
| `SearchRail.tsx` | Left column: Codes/Assets tab switch, search box (placeholder changes in connect mode), tag filter chips, "Group by" select (none/tag/owner/status), the grouped+searchable code list with per-row bulk-select checkbox, connect-target `⇢` button, and a bulk-action bar (tag all selected / connect all selected to one target) that appears once ≥1 row is bulk-selected. Its bulk bar's actions are `BulkActions`, shared with the canvas. |
| `BulkActions.tsx` | *+ tag all* (an inline tag field; `Esc` abandons only the tag, not the selection) and *connect to…* for a set of code ids. Used by the rail's bulk bar and the canvas toolbar's selection group (`variant` picks rail or toolbar buttons), so both act on one selection the same way. |
| `AssetList.tsx` | The Assets tab: catalogue list with column/test/consumer counts, an "N undocumented" summary, "+ new asset," tag filter (matches the *producer's* tags, since an asset has none of its own), and grouping by tag/materialization/producer. |
| `GraphCanvas.tsx` | Wraps React Flow: builds nodes/edges from store state each render, computes dim/lineage/connect-source flags per node via `matches`/`lineageSet`, owns the toolbar (select/connect mode, `+ Code`, I/O detail toggle, fit-to-view, zoom readout, duplicate, connect-forward), the inline `NewCodeForm` popover, an edge-picked action banner (remove link), a connect-mode banner, an empty-pipeline hint, a top-tags legend, and the minimap. Auto-fits the view on first load and on resize, but stops once the user has manually panned — and never re-frames while its pane is hidden, nor when a pane simply reappears (0 — N is not a resize, and re-framing there would undo an inbound centring); its backdrop and minimap render only while the tab is showing and measured, since both compute their geometry from the viewport size. Multi-selection: `Shift`+click (or `⌘`/`Ctrl`+click; a Mac's `Ctrl`+click is right-click) toggles a code in the store's `selectedIds`, seeding it with the already-selected code when a selection starts; `Shift`+drag box-selects, and `onSelectionEnd` hands React Flow's selection to `selectMany`. Node `selected` follows `selectedIds` whenever it is non-empty, and meanwhile the toolbar gains a group with the count, `BulkActions` and *clear*. React Flow drags every selected node together, so `onNodeDragStop` (via its third argument) and `onSelectionDragStop` save each dragged node; `selectNodesOnDrag` is off so a drag never changes the selection behind the store's back. |
| `SchemaCanvas.tsx` | The Schema tab. Fetches `GET /api/schema` whenever the tab becomes active or the pipeline's codes change (schemas are edited in their own doc tabs, and marking an input/output as a documented asset can add a table). Shows tables as they are, with no links between them: `layoutGrid` groups them by schema under heading nodes, and any dragged position (kept in `localStorage` per pipeline) overrides it. Owns the toolbar: the search (dims non-matches, frames the matches 300 ms after typing stops, counts matching tables and columns, `Enter`/`Shift+Enter` centre the next/previous match, `Esc` clears, and `/` focuses it via `App.tsx`), the *Columns* density switch (*Auto* follows the zoom: all at ≥ 75%, keys at ≥ 45%, names below), Fit, Re-layout and a zoom readout. Draws a counts legend and the minimap. Stays mounted like the Flow pane, and fits its view only once the tab is shown, since a hidden pane cannot be measured. `Shift`+click (or `⌘`/`Ctrl`+click) toggles a table in a local pick set and `Shift`+drag box-selects; the pick is a highlight only (tables have no tags), counted in a toolbar group, and a group drag saves every moved table. A code chip on a table opens it where codes live: `setActiveTab('graph')` then `select(id, true)`, the same jump the asset's schema page makes from its lineage chips. |
| `AssetTable.tsx` | The Schema tab's nodes. `AssetTableNode`: one table as a header band (name, materialization), the derived `certified`/`contains pii` badges, ruled column rows (PK/FK badge, name, type in `--t-sql`, a filled or hollow test-coverage dot) and a footer of counts; dashed with an empty state when undocumented. Which rows show depends on density, but a column matching the search always stays. `GroupLabelNode`: the non-selectable heading over each schema's band. No handles: nothing connects on this tab. Below the columns it names the codes either side of the table — *produced by* and *consumed by*, chips coloured by each code's main tag that open it on the Flow tab. Both lines always render (each says so when empty) and neither wraps, so `tableHeight` can predict the block. |
| `DagCode.tsx` | The custom React Flow node component — one code's card: main-tag badge, status dot, name (wraps rather than truncates), description, optionally (`detailed` mode) up to 3 inputs + 3 outputs with a "+N more," and up to 2 extra tag chips. Memoized (`memo`) since the canvas can hold many of these. |
| `Inspector.tsx` | Right column for the selected code: editable description (textarea, ⌘/Ctrl+Enter to save), tag management (add/remove/promote to main, with a dedicated "Main tag" `<select>`), embeds `AssetLinkList` twice (inputs, outputs), editable owner/status metadata plus read-only upstream/downstream counts, and action buttons (open/write logic flow, connect forward, duplicate). Shows a friendly empty state (with an icon) when nothing is selected — though `App.tsx` actually unmounts it entirely in that case. |
| `AssetLinkEditor.tsx` (`AssetLinkList`) | Add/edit/remove one input or output on a code: path, free-text detail, ordered tags, and a "Documented asset" checkbox that — when checked — fetches the pipeline's known assets, shows live autocomplete suggestions, and a one-line resolution preview ("links to an existing asset — N columns" / "not in the catalogue yet, this will create it" / "already produced by X" warning). |
| `NewCodeForm.tsx` | Inline popover for creating a code at a specific canvas position: name, tag chips (most-used tags first, up to 12 suggested), free-typed new tag. |
| `ContextMenu.tsx` | Right-click menu for a code: open logic flow, open asset schema (if it has one), connect forward, duplicate / duplicate with inputs, focus lineage (select + recentre), delete. |
| `TabStrip.tsx` | Renders the tabs. The first two are fixed views of the pipeline, **Flow** (`graph`) and **Schema** (`tables`), each with a small glyph, no close button, and the pipeline name in its tooltip. After a firmer divider come any opened `flow:`/`schema:` document tabs, each with a coloured dot and a close `×`. |
| `StatusBar.tsx` | Bottom strip: code/edge counts, current selection name, load error (if any), current mode, a static usage hint, and — once `GET /api/version` has answered — the running build and the file format it writes (`v1.0.0 · file fmt 6`), the two numbers you need when a bundle from elsewhere will not import. Its tooltip adds the minimum readable format and the Node version. On the Schema tab it swaps the code counts, mode and connect hint for a line naming the view and its gestures. |
| `ToastView.tsx` | Renders the single active toast (info or error styling), auto-dismissing after 2.4s (info) or 3.6s (error). |

### 9.7 Panes — the "documentation" views

| Pane | Responsibility |
|---|---|
| `panes/FlowPane.tsx` | Read view of a code's logic flow: header (tag badge, name, description), metric tiles (step/input/output counts, status), the ordered step list (op badge + title + prose), and read-only Inputs/Outputs cards where a documented link is clickable (`↗`) straight into its schema tab. Toggles into `FlowEditor` for editing; saving triggers a full `load()` afterward because `hasFlow` lives on the graph payload, not the flow response. |
| `panes/FlowEditor.tsx` | Reorderable step editor: title + op + prose body per step, add/remove/move-up/move-down, save/cancel. Fully local `useState` until "Save logic flow" — no autosave. |
| `panes/SchemaPane.tsx` | Read view of an asset: header (materialization, `certified`/`contains pii` badges derived server-side), metric tiles (columns/nullable/tested/consumers), a columns table (name/type/PK·FK·nullable badge/description/tests-or-"untested"), a masked sample-rows table when samples exist, and a Lineage section (producer chip, consumer chips) — clicking either jumps back to the graph tab and selects/recentres that code. Toggles into `SchemaEditor` for editing. |
| `panes/SchemaEditor.tsx` | Materialization + description fields, plus a fully editable columns table (name, type, key-kind-or-nullable select, description, comma-separated tests, reorder/remove). Sample rows are **not editable here** — saved as-is from the loaded asset (they only ever arrive via seed or import; see README "Things deliberately left out"). |

---

## 10. Key user-facing workflows, traced end-to-end

**Creating a code and connecting it by data flow** (no manual edge-drawing
needed):
1. `＋ Code` on the canvas → `NewCodeForm` → `POST /api/codes` →
   `repo.createCode` inserts the row + tags → store does a full `load()`.
2. In the Inspector, `+ add` on Outputs, check "Documented asset," type a
   name → `POST /api/codes/:id/asset-links` with `documented: true` →
   `repo.addAssetLink` → `resolveAsset` creates (or finds) the asset and, since
   this is an output on a producer-less asset, claims production → 
   `linkEdgesForAsset` draws an edge to every existing code that already
   lists that asset as an input.
3. If `edgesCreated > 0`, the store refetches the whole graph (new edges
   can't be reconstructed from the mutation response alone) and toasts
   "linked N codes by data flow."

**Manual connect** (three equivalent entry points — toolbar `⇢ Connect`,
inspector `⇢ Connect forward`, context menu, or the `C` key — followed by
either a drag between handles, a click on a target node, or `⇢` on a rail
row): all funnel into `store.connect(source, target)` →
`POST /api/edges` → `repo.addEdge` (self-loop / cross-pipeline / duplicate /
cycle checks) → on success, the edge is appended locally and a toast fires;
on `ConflictError`, the specific message is shown and the pending connect is
cancelled.

**Duplicate with inputs** (`⇧D`, or the "Duplicate with inputs" context-menu
item): `POST /api/codes/:id/duplicate {withInputs:true}` →
`repo.duplicateCode` copies the code row (offset position), tags (+forced
`draft`), asset links (outputs lose their `asset_id` — the copy never claims
producer status), flow steps, and — because `withInputs` — every edge that
targeted the original, retargeted at the copy. The store then does a full
`load()` and reports how many upstream edges were inherited.

**Export → share → import**: `PipelineMenu` → "Export this pipeline" is a
plain `<a download>` click against `GET /api/pipelines/:id/export`, so the
browser honors the server's `Content-Disposition` filename
(`<slug>-<date>.atlas.json`) without an extra `fetch`+blob dance. On the
receiving end, "Import from file…" reads the file as text, `JSON.parse`s it
client-side (so a non-JSON file fails fast with a clear message before ever
reaching the network), and `POST /api/pipelines/import`s the parsed object —
server-side `readBundle` is still the actual gate, since the client can't trust
its own parse to imply a *valid* bundle. The response carries the file's source
format, its generator, every upgrade step and every repair; the store logs them
all to the console and folds the headline into the toast (§9.3).

**Checking a file before trusting it**: `npm run validate -- <file>` (or
`POST /api/pipelines/validate`) runs that identical gate with the write removed,
printing what the file would be upgraded from and what would be repaired, and
exiting non-zero if it would be refused. This is the intended CI check for a repo
that generates `.atlas.json`, and the intended pre-flight for an agent.

---

## 11. Notable implementation details & conventions

- **No auth, no users.** Anyone who can reach the API can read and mutate
  every pipeline. `TopBar` shows a static "SE / syedeesa" chip — decorative,
  not an authenticated session.
- **No ORM, hand-written SQL everywhere**, deliberately — the project
  comment in `db.ts` notes `node:sqlite` is stricter about named parameters
  than `better-sqlite3`, so every query binds positionally.
- **Ids are two different shapes on purpose**: human-readable slugs
  (`uniqueId`) only for `graphs`, the one id a user types (`?graph=`);
  opaque ids everywhere else — prefixed `code_…`/`asset_…` (`newEntityId`)
  for codes and assets, bare `nanoid(12)` for the purely structural rows
  (`edges`, `asset_links`, tag rows, `flow_steps`, columns, samples). Codes
  and assets moved off name-derived ids deliberately: a name is a label
  people rename, two pipelines may document assets of the same name, and an
  id is what links, edges, flows and exports point at.
- **Colour is information, not decoration** (from the README, reflected in
  code): tag colour (`tagColor`) and status colour (`STATUS_COLOR`) are
  fully separate systems, and the single accent colour (`--accent`) is
  reserved exclusively for selection/active-lineage highlighting — nothing
  else in the app uses it for styling.
- **`bad.json`** at the repo root (`{"hello":"world"}`) is not referenced
  anywhere in the server or client source — it appears to be a stray/test
  artifact left in the repo rather than part of the application. Worth
  confirming with whoever added it before assuming it's safe to delete.
- **`.claude/launch.json`** configures this repo's dev server for the
  Claude Code preview tool (`npm run dev` on port 5173) — tooling
  configuration, not part of the app itself.
- **Every mutation that can partially fail across tables runs inside
  `tx()`** — duplication, schema saves, flow saves, bundle import — so a
  thrown error mid-write rolls back cleanly rather than leaving orphaned
  rows.
- **Sample rows are import/seed-only.** There is no UI path that writes
  `asset_samples`; `saveAssetSchema` always echoes back whatever sample rows
  were already on the asset (`SchemaEditor` passes `asset.sampleRows`
  through unchanged).
- **Renaming a code has no UI**, even though `PATCH /api/codes/:id` accepts
  `name` — a known, documented gap (README, "Things deliberately left out").

---

## 12. Running the project

```bash
# installed — no checkout, no build step; everything on :5174
npx lineage-atlas
```

```bash
# day-to-day, hot reload — API on :5174, web on :5173 (proxies /api)
npm install
npm run dev
```

```bash
# single process from a checkout, no hot reload — everything on :5174
npm install
npm run build
npm start
```

| `lineage-atlas` command | Effect |
|---|---|
| *(no arguments)* | Serve the app and open it in a browser |
| `serve` | Serve it without opening a browser |
| `list` | List pipelines with code/edge counts |
| `export <id> [file]` | Write a pipeline to a `.atlas.json` |
| `validate <file>` | Check a `.atlas.json` without importing it |
| `import <file> ["Name"]` | Read a `.atlas.json` in as a new pipeline |
| `version` | Print the app and file-format versions |

Every command takes `--db <file>`; `serve` also takes `--port <n>` and
`--no-open`. Each is an alias for the environment variable of the same meaning
(§6.8), and the environment is what the server actually reads.

| Command | Effect |
|---|---|
| `npm run dev` | API + web dev servers together (`concurrently`) |
| `npm run build` | Version check, then type-check + build both workspaces |
| `npm start` | Runs the built server (serves `web/dist` if present) |
| `npm run seed` | Wipes and reloads the demo warehouse pipeline only |
| `npm run pipelines` | Lists pipelines with code/edge counts |
| `npm run export -- <id> [file]` | Writes a pipeline to a `.atlas.json` |
| `npm run validate -- <file>` | Checks a `.atlas.json` without importing it; exits non-zero if it would be refused |
| `npm run import -- <file> ["Name"]` | Reads a `.atlas.json` in as a new pipeline |
| `npm run typecheck` | Type-checks both workspaces, no emit |
| `npm run check:version` | Asserts `APP_VERSION` matches all three `package.json` files |

Environment variables:

| Variable | Effect |
|---|---|
| `ATLAS_PORT` | Pins the API port: the only port tried, and a clash exits 1. Unset ⇒ `5174` only in a checkout (a clash still exits 1), or `5174` then the next free port for an installed copy (§4.1) |
| `ATLAS_DB` | The database file. Unset ⇒ `data/atlas.db` in a checkout, the per-user data directory once installed (§6.2b) |
| `ATLAS_NO_OPEN` | Suppresses the browser on startup. Implied by an explicit `serve`, and by a non-TTY stdout |
| `ATLAS_MAX_IMPORT` | Largest `.atlas.json` an upload may be, as a body-parser size (`'256mb'`). Unset ⇒ `128mb`. Does not apply to `lineage-atlas import`, which reads the file directly and has no limit |

The startup line prints both the port and the database path in use, and neither
is fixed any more — read them rather than assuming `5174` and `data/atlas.db`.

Requires Node 24+ (tested on 26) — the first release with `node:sqlite`
unflagged; no native compiler needed since SQLite comes from Node itself.

> **Local environment note** (from prior session memory): Node 26 has been
> observed to break native addons in this environment, and a local preview
> harness hijacks `PORT=5173` for its own dev-server wiring. Neither affects
> this project directly — it has no native addons, and the API deliberately
> binds `ATLAS_PORT` rather than `PORT` for exactly this kind of conflict —
> but keep both in mind if `npm run dev` ever behaves unexpectedly in this
> particular setup.

---

## 13. Keyboard shortcuts (global, while the graph tab is active)

| Key | Action |
|---|---|
| `/` | Focus search |
| `V` | Select mode |
| `C` | Connect forward from the current selection (or enter connect mode) |
| `D` / `⇧D` | Duplicate / duplicate with inherited upstream edges |
| `Enter` | Open the selected code's logic flow |
| `Esc` | Cancel a pending connect, close menus, clear bulk selection |
| `Delete` / `Backspace` | Remove the currently picked edge (canvas) |
| `Shift` + click (or `⌘`/`Ctrl` + click) | Toggle a code in the multi-selection on the canvas; a table on the Schema tab. In the rail `Shift`+click is a range and `⌘`/`Ctrl`+click toggles |
| `Shift` + drag | Box-select on either canvas |

---

## 14. Things deliberately left out (by design, not oversight)

Carried over from the README, confirmed against the code:

- No authentication.
- No dbt/YAML importer (would need its own translator into the bundle
  shape, reusing `importBundle`).
- No merge-on-import — import always creates a new pipeline.
- Sample rows aren't editable in the UI (seed/import only).
- No rename-code UI (the API supports it; nothing calls it).
- Inferred links are additive-only — removing an asset link never retracts
  an edge it once caused; remove the edge itself on the canvas.
- `hasFlow` is purely informational — an empty flow shows an empty state,
  it isn't disabled.

---

## 15. Versioning and compatibility policy

Introduced in 1.0.0, and the reason most of §6.4 exists. Three numbers, three
different jobs, deliberately not tied together.

### 15.1 The three numbers

All three live in `server/src/version.ts`, which nothing else duplicates.

| Constant | Kind | Job |
|---|---|---|
| `APP_VERSION` | semver | Which build this is. Reported by `GET /api/version`, stamped into every export as `generator.version`, shown in the status bar. **Nothing branches on it** — it is provenance, not a feature gate. |
| `BUNDLE_VERSION` | integer | The `.atlas.json` shape. Bumped only when the shape on disk changes, never reused, never skipped. Every bump gets a rung on the upgrade ladder. |
| `MIN_BUNDLE_VERSION` | integer | The oldest format still readable. Raising it drops support for files in other people's hands, so it is a breaking change reserved for a major release. |

`scripts/check-version.mjs` asserts `APP_VERSION` matches the `version` field of
the root, `server` and `web` `package.json` files, and runs as the first step of
`npm run build`. A release cannot ship claiming one version in its files and
another in its manifest — and since the root manifest is also the published
package, the version on npm is the same number by construction. `prepublishOnly`
runs the same build, so `npm publish` cannot ship a stale `dist` either.

### 15.2 The compatibility contract

**Backward compatible, forward refusing.**

- **Older files are upgraded, visibly.** Anything from `MIN_BUNDLE_VERSION` up is
  walked to the current format one rung at a time by `upgradeBundle`, and every
  step returns a note that reaches the user. An upgrade that drops data (rungs 2
  through 4 all do) says so rather than doing it quietly.
- **Newer files are refused.** A file whose `formatVersion` exceeds this build's
  is rejected with a message naming both numbers. A tolerant reader would import
  most of it and silently discard whatever it did not recognise, which is how
  data gets mangled by a tool that reported success.
- **The envelope is permanent.** `format` and `formatVersion` are the first two
  keys and have never changed shape, so *any* reader — including a future one, or
  a foreign tool — can decide from them alone whether it understands the file.
  This is why `format` is a fixed string rather than something versioned or
  renamed.

### 15.3 Adding a format version

1. Change the shape; bump `BUNDLE_VERSION` in `server/src/version.ts`.
2. Add **exactly one** rung to `UPGRADES` in `bundle.ts`, keyed by the version it
   upgrades *from*, with a `note` written for a human to read. Never edit an
   existing rung, and never renumber: existing rungs describe files that are
   already out in the world.
3. Add a row to the version-history table in `docs/FILE_FORMAT.md` and update the
   spec body.
4. Test it: hand-write a file at the old version, then `npm run validate -- it`
   and check the reported upgrade notes are actually true.

If the change also alters the database, add the matching migration in `db.ts`.
Rungs 1 through 4 correspond one-for-one to the migrations in §5.3, and that
correspondence is worth preserving.

### 15.4 API compatibility

`GET /api/version` exists so that no client has to hard-code any of this. It
reports the app version, the format an export will be written as, and the oldest
format an import will accept.

One response shape changed in 1.0.0 and is called out in `CHANGELOG.md`:
`POST /api/pipelines/import` now returns
`{ pipeline, source, upgrades, warnings }` rather than a bare pipeline. The
pipeline moved to `.pipeline`. This was worth breaking: an import that silently
dropped three cycle-forming edges was previously indistinguishable, to any
caller, from one that landed perfectly.
