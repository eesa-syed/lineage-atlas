# Changelog

Notable changes to Lineage Atlas. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows
[semantic versioning](https://semver.org/).

The **file format** (`.atlas.json`) carries its own integer version,
independent of the release version. Its history is in
[docs/FILE_FORMAT.md §5](docs/FILE_FORMAT.md#5-compatibility-policy).

## [Unreleased]

## [1.1.0] — 2026-09-15

### Changed

- The README's version badge now reads the published version from npm, so it
  can no longer fall behind; the file-format badge says 9; a new badge links to
  the Claude Code agent skill.
- Examples of `lineage-atlas status` and `/api/version` output show 1.1.0.

## [1.0.1] — 2026-09-15

### Security

- **The server listens on `127.0.0.1` only.** It used to bind every interface,
  so anyone on the same network could read and edit every pipeline. Set
  `ATLAS_HOST` (e.g. `0.0.0.0`) to serve a team deliberately, and
  `ATLAS_ALLOWED_HOSTS` to list the names it will be reached by.
- **Other websites can no longer use the API.** CORS was open to every origin,
  so any page open in the browser could read, edit or delete pipelines on
  `localhost:5174`. CORS is gone, writes carrying a foreign `Origin` are refused,
  and requests with a foreign `Host` are refused (DNS rebinding).
- Responses carry `X-Frame-Options`, a Content-Security-Policy and `nosniff`;
  500s no longer echo internal error text; `qs` pinned past three DoS advisories.

### Added

- **On npm.** `npx lineage-atlas` starts Atlas with nothing to clone or build,
  and `npm install -g lineage-atlas` keeps the command. The README leads with it.
- **A logo.** Three sources converge on a model that writes one table — the
  shape of every pipeline Atlas draws. It is the favicon, the top-bar mark, and
  the README header (`.github/assets/`: `logo-light.png`, `logo-dark.png`,
  `logo-mark.svg`, `icon.svg`, `icon.png`).
- `GET /api/version` reports `user`: the name edits without an `X-Atlas-User`
  header are attributed to.

- **Import a dbt project.** `lineage-atlas import target/manifest.json` reads
  a dbt manifest directly — no exporter, no plugin — and *Import from file…* in
  the app accepts one too. Models, seeds, snapshots, sources and exposures
  become codes; `depends_on` becomes the edges; each relation becomes an asset
  with its documented columns and the generic tests on them; owners come from
  `meta.owner` or the node's dbt group; the model folder becomes the main tag.
  Pass `--catalog target/catalog.json` (or select both files in the app) and
  every column arrives with its warehouse type. `from-dbt` writes the
  translation out as an `.atlas.json` instead of importing it. SQL is never
  copied, a table that is both built (by a seed or model) and declared as a
  source becomes one asset, and primary keys come only from declared
  constraints. Checked against dbt-labs/jaffle-shop on dbt 1.12: every edge
  matches dbt's own `parent_map` — see
  [docs/DBT.md](docs/DBT.md).
- Selecting a dbt `catalog.json` or `run_results.json` by mistake is refused
  with a message naming the file to use instead.

- **Stewardship on every code and every asset** — an **owner**, a **created**
  and an **updated** date, and the **user who made that last edit**. Codes had
  an owner and two dates the database kept privately; now all four are on both
  kinds of record, and all four are shown: in the inspector's Metadata panel for
  a code, and under the title of an asset's schema page.
  - The dates are the documentation's, not the pipeline's. `updatedAt` moves
    when a description, owner, tag, input, output, column or logic-flow step
    changes — nothing in Atlas watches a warehouse, and this is not the return
    of the `freshness` field that format version 4 removed. It answers a
    different question: *when did anyone last check that this page is true?*
  - **`X-Atlas-User`** names the editor on any write. There is still no login
    and no account: the header wins if sent, then `ATLAS_USER`, then the
    operating-system user, so the field is always filled and never claims more
    than a git author line does. Agents should set it — see
    [docs/AI_AGENTS.md](docs/AI_AGENTS.md).
  - An asset created as some code's output inherits that code's owner, which is
    who was answerable for it anyway. `PUT /api/assets/:id/schema` now takes an
    optional `owner`, and the schema editor has a field for it; omitting it
    leaves the existing owner alone.
  - **File format 7** carries all four fields on both records, and they survive
    a round trip: an import assigns new ids but keeps a record's original dates
    and editor, since otherwise every shared file would claim to have been
    written the moment it was opened. A version 6 file is dated from its own
    `exportedAt` — a true upper bound — with no editor named, and its assets
    inherit their producer's owner.
  - Every timestamp is now stored and served as ISO-8601 with its `Z`. SQLite's
    `datetime('now')` writes UTC without saying so, which any reader is free to
    take for local time; the existing pipeline `createdAt`/`updatedAt` were
    affected by this and are now unambiguous too.
- **Filter by date**, in the rail, for codes and for assets: a window on either
  stewardship date, with `last 7d`, `last 30d` and `90d+ ago` as one-click
  windows. The presets write into the same two date boxes rather than being a
  mode of their own, so what a chip did is visible and editable. The window is
  shared between the Codes and Assets tabs, exactly as the search box and the
  tag chips already are, and — since the rail's filters dim the canvas — it
  makes "nothing here has been touched since June" a shape on the graph rather
  than only a list. Bounds are whole local days, so `from` and `to` on the same
  date means that day.
- **The asset catalogue groups by owner**, alongside producer's main tag,
  materialization and producer. Asset search matches the owner too, so it is
  reachable from both directions.
- **Every stewardship field is editable in the UI**, along with the one thing
  that never was: a **name**. A code's are in the inspector's Metadata panel; an
  asset's are on its schema page under *Edit schema*.
  - Recorded *and* writable needs one rule, or the two halves fight: **an
    explicit value wins for the write that carries it, and the next ordinary
    edit resumes stamping.** Backdate a record to when it was really written and
    that sticks; edit it again afterwards and `updatedAt` goes back to meaning
    "when this page last changed", which is the only thing it can honestly mean.
    It behaves like a file's mtime — `touch -t` sets it, writing moves it back.
  - Both forms send **only the fields you actually changed**, which is what
    makes that rule invisible in practice: leave the dates alone and they stamp
    themselves, as before.
  - `PATCH /api/codes/:id` takes `createdAt`, `updatedAt` and `updatedBy`, and
    refuses a date it cannot parse with `409` rather than storing a string that
    reads back as `Invalid Date`. An empty patch is not an edit and moves
    nothing.
  - **Renaming an asset carries every declaration that named it** — the
    producer's output and every consumer's input — and touches those codes,
    since what they declare has changed. Without that a code would go on
    claiming `analytics.orders` while its schema page said otherwise, and the
    next save of that link would silently create a second, empty asset beside
    the real one. The name stays unique within its pipeline.

### Removed

- **Sample rows.** An asset documented its shape and, until now, three or four
  rows of its contents. They were wrong twice over: nothing ever refreshed them,
  so they aged into fiction exactly as `rowCount` and `freshness` did before
  them, and they were the one place an export could carry real customer data —
  which is a poor property for a file whose whole point is being safe to hand to
  someone. Gone from the schema page, the database, the API and **file format
  8**, whose upgrade step drops them from any older file with a note.

- **`npx lineage-atlas`** — the app now installs and runs as a command, with no
  checkout, no build step and nothing to compile. `bin/lineage-atlas.mjs` fronts
  the two halves that already existed: `lineage-atlas` serves the app and opens
  it, and `list` / `export` / `validate` / `import` / `version` reach the same
  CLI the npm scripts do. `--db`, `--port` and `--no-open` map onto the
  environment variables the server already read, so nothing gained a second
  source of truth.
- An installed copy keeps its database in the per-user data directory
  (`~/Library/Application Support/lineage-atlas` on macOS, `$XDG_DATA_HOME` on
  Linux, `%APPDATA%` on Windows) instead of inside `node_modules`, where the
  next upgrade would wipe it. A checkout is unchanged: still `data/atlas.db`.
- The startup line prints the database path in use.
- **The Schema tab**, a second permanent view beside the graph, which is now
  labelled *Flow*. It shows every documented asset as a table with its columns,
  types, keys and per-column test coverage, grouped by schema, with no links
  between tables. Its search matches table and column names and descriptions,
  dims everything else, frames the matches and walks them with `Enter` /
  `Shift+Enter`; `/` jumps into it. Density follows the zoom (all columns, keys,
  names) with a manual override, and undocumented assets show dashed. Nothing new
  is stored: dragged positions are a per-browser preference.
- **`GET /api/schema?graph=<id>`** — every table in a pipeline with its columns in
  one call, sample rows left out. Built on `getAsset`, so a table here can never
  disagree with its schema page.
- **Each table on the Schema tab names its codes**: *produced by* the code that
  writes it, *consumed by* the codes that read it, each a chip coloured by that
  code's main tag that opens it on the Flow tab — the same lineage the asset's
  own schema page shows. The search matches those code names too, so searching a
  code finds every table it touches. Nothing new is fetched: both already come
  back from `GET /api/schema`.
- **Select several codes on the canvas.** `Shift`+click (or `⌘`/`Ctrl`+click)
  adds or removes a code and `Shift`+drag box-selects, feeding the same selection as the rail's
  checkboxes. While several are picked the canvas toolbar offers to tag them all
  or connect them all forward, and dragging one picked code moves and saves
  the whole group. The Schema tab takes the same gestures to highlight several
  tables.

- **Short-form `.atlas.json` files.** Everything Atlas can work out may be left
  out: `position` defaults to array order; an omitted `assetRef` resolves to the
  one asset whose `name` equals the link's `path`; an omitted `producedBy`
  resolves to the one code that outputs the asset; codes with no `x`/`y` are
  laid out left→right by depth. Each is reported as a `filled in` note
  (`notes` over HTTP), separate from repairs. Explicit values, including `null`,
  are never overridden, so exported files read exactly as before.
- **`import --relink` / `validate --relink`** (HTTP `relink`) derive edges from
  declared inputs and outputs in the same transaction. An asset with
  `producedBy: null` implies no edges — the way to document shared-state tables
  (run registries, log sinks) without wiring every writer to every reader — and
  an omitted `producedBy` on an asset several codes write is left empty with a
  warning rather than guessed.
- **`import --replace <pipelineId>`** (HTTP `replace`) swaps a pipeline's
  contents for a file's in one transaction, keeping its id so `?graph=` links
  survive an edit → re-import loop. Refuses a pipeline that does not exist.
- **`--no-seed` / `ATLAS_NO_SEED=1`**: a fresh database without the demo pipeline.
- **Provenance (file format 9).** Codes and asset links take an optional
  `provenance: {source, ref}` — `doc`, `code`, `inferred` or `human`, and where.
  Editable in the inspector and the input/output form, shown on each input and
  output, and filterable with an *Evidence* chip per source. Format 8 files
  import unchanged.
- **`GET /api/graph?view=summary`** and **`lineage-atlas summary <id>`**: the
  topology only — ids, names, tags, status, `[source, target]` edges — for
  agents asking routine questions about shape.
- **`lineage-atlas status`** reports whether an Atlas is running and on which
  port, version and database, without starting anything or opening a database.
  `GET /api/version` now includes `db`.
- **`lineage-atlas install-skill [--project] [--link]`** installs the Claude Code
  skill outside the checkout; `lineage-atlas version` reports installed copies
  and flags stale ones. The npm package now ships `.claude/skills/`.
- **`lineage-atlas scan <dir>`** drafts a short-form bundle from Python, SQL and
  other source files: one code per file with recognisable I/O, candidate paths
  from S3/GCS URIs, bucket/key constants, SQL, DynamoDB tables and pandas/Spark
  calls. Every link is tagged `unverified` with `provenance: inferred` and a
  `file:line` ref.
- Validate warns when asset names, or a link path and an asset name, differ
  only in placeholder spelling (`<id>` / `{run_id}` / `${id}`). Nothing is merged.
- `npm run check:docs` (part of `build`) fails when the agent docs mention a
  field the file format dropped, or quote the wrong format version.

### Changed

- **Importing a `.atlas.json` over HTTP is no longer capped at 25 MB.** The
  import and validate routes now take their own limit — 128 MB by default,
  `ATLAS_MAX_IMPORT` to move it — while every other route keeps the 25 MB it
  had. Over the limit answers **413** naming the file's size, the limit and the
  CLI (`lineage-atlas import <file>`, which reads the file directly and has no
  limit); it used to be a bare 500 reading `request entity too large`.
  Malformed JSON answers **400** rather than 500. The app also stops parsing the
  file and re-serialising it just to upload it: it hands the text to the request
  as it read it, with the new pipeline's name in `?name=`, so a large import no
  longer holds the text, the whole object graph and a second copy of the text in
  browser memory at once. The older `{ bundle, name }` body still works.
- **Codes and assets now get opaque ids** — `code_V1StGXR8Z5`, `asset_kLm2p…` —
  instead of ids slugified from their names. A name is a label people rename,
  two pipelines may legitimately document assets of the same name, and the id is
  what asset links, edges, logic flows and exports point at: deriving one from
  the other made a rename look like an identity and forced a second
  `analytics.fct_orders` to live at `analytics_fct_orders_2`. Pipelines keep
  their readable slug ids, since a pipeline is the one id a person types (in
  `?graph=`). Rows already in a database keep the ids they have — nothing is
  rewritten, and old and new ids work side by side; re-seed (`npm run seed -w
  server -- --force`) to move the demo warehouse over.
- The Schema canvas carries only the asset cards: the fixed schema headings that
  were drawn straight onto it are gone.
- A busy port is no longer fatal **for an installed copy**: it walks up from
  `5174` to the first free port and prints where it landed, so a second atlas —
  or a stale process — never blocks a start. A checkout is unchanged and still
  exits 1, deliberately: `web/vite.config.ts` proxies `/api` to `5174` by
  number, so an API that wandered would leave the dev app talking to whatever
  else was on that port. Setting `ATLAS_PORT` pins the port in both cases.
- The first tab is labelled **Flow** rather than the pipeline's name (still in the
  top bar and the tab's tooltip), so the two views read as a pair.
- The code shortcuts (`V`, `C`, `D`, `⇧D`) do nothing on the Schema tab, which
  does not show the code they would act on, and `/` there focuses the Schema
  tab's own search instead of switching to Flow.

### Fixed

- **The skill documented `sampleRows`**, which format 8 removed, in the
  schema `PUT` body — contradicting itself a few sections later.
- **A busy port now says what holds it.** The first line names another Lineage
  Atlas (with its version and database) or "another program", instead of being
  buried under npm's error output.
- **`npm run import -- file.json` from a checkout** resolved relative paths
  against `server/`. File arguments and `ATLAS_DB` now resolve from the folder
  the command was run in.
- `lineage-atlas export <unknown id>` printed a stack trace instead of the error.
- `status`, `scan`, `install-skill` and `version` no longer open (and create) a
  database.

- **The top bar showed a hardcoded username** ("SE / syedeesa") to everyone who
  ran Atlas. It now shows the name edits from the browser are actually recorded
  under — `ATLAS_USER`, else the operating-system user — with its initials.

- The rail's "nothing matched" message was unreachable while grouping was off:
  an empty result rendered an `All codes` heading with nothing under it, which
  reads as a bug rather than as a filter. Both rails now show the empty state,
  and it distinguishes an unmatched search term from a window or a tag that
  left nothing behind.
- **Jumping to a code from another tab never arrived.** Returning to the Flow tab
  counted as a resize, so the canvas re-framed the whole graph and undid the
  centring a moment after it started: clicking a table's code chip, or an asset
  page's lineage chip, left you looking at the same view. A pane reappearing is
  now told apart from a real resize (which still re-frames), and the centring
  waits until React Flow has measured the pane.
- **A canvas no longer draws its backdrop and minimap while its tab is hidden**,
  where they computed geometry from a zero size and logged NaN attribute errors
  on every tab switch. Returning to a canvas while a jump is in flight can still
  log a few frames of them — console noise only; the view lands correctly.
- **`Shift`+drag on the Flow canvas highlighted codes nothing could act on.**
  React Flow's box selection never reached the app's selection; it now does.
- **Clicking the target of a bulk *connect to…* on the canvas** started a new
  single connect instead of completing the bulk one.
- **`Esc` in the *tag all* field** threw away the whole selection rather than
  just the half-typed tag.
- **The Flow canvas animated through NaN whenever it was hidden.** Opening a
  document tab (and now the Schema tab) shrank its pane to zero, its resize
  handler re-framed it with an animated `fitView`, and d3's zoom interpolation
  divides by the extent. It recovered a frame later, but logged NaN errors for
  the dot grid and the minimap on every switch. It now re-frames only while it is
  on screen.
- **Unmatched `/api/*` paths returned an HTML error page**, not JSON — Express's
  default 404, reached because the SPA fallthrough had nothing after it. A
  client parsing the body as JSON got a syntax error instead of the `{error}`
  every other failure in the API returns. They now answer
  `404 {"error":"No API route for <VERB> <path>"}`, for every verb, with or
  without a web build present.
- **`engines` said Node 20**, which never worked: `node:sqlite` did not exist
  before Node 22 and was behind `--experimental-sqlite` there. It now says 24,
  and the docs agree.

## [1.0.0] — 2026-09-09

First public release. The app itself is unchanged in behaviour; what this
release adds is everything needed to depend on it: a stated version, a
specified file format, a compatibility policy, and documentation for both the
humans and the agents using it.

### Added

- **`GET /api/version`** — reports the app version, the file format it writes
  (`bundleVersion`) and the oldest it reads (`minBundleVersion`). Clients and
  agents read this instead of hard-coding anything. `GET /api/health` now
  reports the version too.
- **`POST /api/pipelines/validate`** and **`npm run validate -- <file>`** — run
  the full import gate against a file and write nothing. Reports what the file
  would be upgraded from and what would be repaired; the CLI exits non-zero if
  the file would be refused, so it works as a CI check.
- **File format 6**: the envelope now carries `generator` (what wrote the file,
  and its version) and `counts` (totals, so a large file describes its own size
  in its first few lines). Provenance now survives being passed around.
- **An explicit upgrade ladder** for old files — one step per format version,
  each with a note written for a human. An upgraded file now reports exactly
  which steps ran and what each one dropped, rather than upgrading silently.
- **Cycle, self-loop and duplicate detection on import.** A file was previously
  the one way an edge could enter the graph without passing the acyclicity
  check. Offending edges are now skipped with a warning naming both ends,
  matching how inferred links already behave.
- **Import reports what happened**: `POST /api/pipelines/import` returns the
  source format version, the generator, the upgrade steps applied and any
  repairs, alongside the pipeline. Surfaced in the UI toast and browser console,
  and in the CLI.
- **Version in the status bar** — the running build and the file format it
  writes, which are the two numbers you need when a file will not import.
- `npm run check:version`, run as the first step of `npm run build`: fails the
  build if `APP_VERSION` and the three `package.json` versions disagree.
- Documentation: [docs/CONCEPTS.md](docs/CONCEPTS.md) (the model and why it is
  shaped this way), [docs/FILE_FORMAT.md](docs/FILE_FORMAT.md) (the normative
  format spec), [docs/AI_AGENTS.md](docs/AI_AGENTS.md), a Claude Code skill at
  `.claude/skills/lineage-atlas/`, `CONTRIBUTING.md` and this changelog.
- MIT `LICENSE`.

### Changed

- `POST /api/pipelines/import` now returns
  `{pipeline, source, upgrades, warnings}` rather than a bare pipeline. **This
  is a breaking API change** for anything that consumed the old shape; the
  pipeline itself is now at `.pipeline`.
- `importBundle()` returns an `ImportResult` for the same reason.
- Version constants moved to `server/src/version.ts`, the single source of truth
  for the app version, the format version and the minimum readable format.
  `server/src/types.ts` re-exports them, so existing imports still work.
- CLI errors on a malformed file now print a one-line explanation instead of a
  stack trace, and exit `1`.

### Notes for upgraders

Files written by earlier builds (format 1 through 5) import unchanged — the
upgrade ladder covers every one of them, and now tells you what it did. Files
written by 1.0.0 are format 6 and **cannot be read by earlier builds**, which
refuse them with a message rather than misreading them.
