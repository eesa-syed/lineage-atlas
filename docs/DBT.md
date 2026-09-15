# Importing a dbt project

Lineage Atlas reads a dbt project's `manifest.json` directly. One command turns
your models, sources, seeds, snapshots and exposures into a pipeline you can
search, trace and document. There's no YAML to write and no plugin to install.

- [1. Generate the files](#1-generate-the-files)
- [2. Import](#2-import)
- [What you get](#what-you-get)
- [What is not imported](#what-is-not-imported)
- [Re-importing after changes](#re-importing-after-changes)

---

## 1. Generate the files

From your dbt project folder:

```bash
dbt docs generate
```

This writes two files into `target/`:

| File | Needed? | What Atlas takes from it |
|---|---|---|
| `target/manifest.json` | **Required** | Every model, source, seed, snapshot and exposure; dependencies; descriptions, tags, owners, tests and documented columns |
| `target/catalog.json` | Recommended | The real type of **every** column, including the ones not documented in YAML |

`dbt docs generate` has to query your warehouse to build the catalog. If you
can't do that, `dbt parse` writes the manifest alone without connecting to
anything. Only columns documented in YAML will appear on each table, but the
graph is complete either way.

## 2. Import

**From the command line:**

```bash
lineage-atlas import target/manifest.json --catalog target/catalog.json
```

**From the app:** open the pipeline switcher, choose *Import from file…*, and
select `manifest.json`, or select `manifest.json` and `catalog.json` together.

**To review the result before importing it,** write it out as an `.atlas.json`
file instead:

```bash
lineage-atlas from-dbt target/manifest.json jaffle-shop.atlas.json --catalog target/catalog.json
lineage-atlas import jaffle-shop.atlas.json
```

From a source checkout, the same commands are `npm run import -- …` and
`npm run from-dbt -- …`. Relative paths resolve from the folder you run them in.

Every import reports what it read and what it skipped:

```text
Imported "jaffle_shop" as jaffle_shop — 25 codes, 23 edges (from a dbt manifest).
  converted dbt 1.12.4 project "jaffle_shop": 13 models, 6 seeds, 6 sources, 23 column tests, column types from catalog.json
  repaired  Skipped 4 tests not tied to a single column (singular and model-level tests have no column to sit on).
  repaired  Skipped 23 metrics, 6 semantic models, 3 saved queries, 3 unit tests: they do not read or write data, so they are not steps in the graph.
```

That is [dbt-labs/jaffle-shop](https://github.com/dbt-labs/jaffle-shop) on
dbt 1.12. Every edge in the result matches dbt's own `parent_map`.

## What you get

| dbt | Lineage Atlas |
|---|---|
| Model, seed, snapshot | A **code**, laid out left to right by dependency depth |
| Source table | A code named `source_name.table`, tagged `source` |
| Exposure | A code tagged `exposure` and its type (`dashboard`, `ml`…), with its URL as an output |
| `depends_on` | The **edges**, plus an input on each code naming what it reads |
| The relation a node builds | An **asset** named `schema.table` (the database is added only when two relations would otherwise share a name) |
| A source over a table a seed or model builds (e.g. seeds loading `raw.*`) | **One** asset, produced by the seed or model; the source reads it and sits between builder and consumers |
| Model folder (`models/staging/…`) | The **main tag**, so each layer gets its own colour |
| Language, dbt `tags`, package, `access: public` | Further tags |
| `description` | The code's and the asset's description |
| `meta.owner`, or the owner of the node's dbt **group** | Owner |
| `original_file_path` | An input tagged `file` (or `seed`), so every code links to its source file |
| Documented columns, and every column in `catalog.json` | Asset columns, in warehouse order, with types and descriptions |
| Generic tests on a column (`unique`, `not_null`, `accepted_values`, `relationships`, package tests) | That column's tests, e.g. `dbt_utils.expression_is_true` |
| `not_null` test or constraint | Column marked non-nullable |
| `relationships` test, or a `foreign_key` constraint | Column marked **FK** |
| `primary_key` constraint | Column marked **PK** |

Some mappings are deliberate choices:

- **Primary keys come only from declared constraints.** A `unique` + `not_null`
  pair usually means a primary key, but not always, and a wrong PK badge would
  be believed. Add a `primary_key` constraint in dbt, or mark the key in Atlas
  after importing.
- **One table, one asset.** When a seed or model builds a table that a source
  also declares (common when seeds stand in for raw data, as in dbt's
  jaffle-shop), that table becomes a single asset with the seed or model as its
  producer. The source reads it, so lineage runs seed → source → staging, and
  descriptions and columns from both are merged.
- **Ephemeral models** become codes and keep their edges, but get no asset,
  because they never build a table.
- **SQL is never copied.** A logic flow is prose (see
  [FILE_FORMAT.md §6](FILE_FORMAT.md#6-what-the-format-deliberately-does-not-carry)),
  so each imported code starts with an empty one plus a link to its `.sql` file.
  Writing the *why* behind a model is the documentation dbt doesn't already have.
- **Dates** are set to the manifest's `generated_at`, and *last edit by* is
  `dbt`, so a later edit in Atlas is easy to tell apart from what came from the
  project.

## What is not imported

| dbt | Why |
|---|---|
| Singular and model-level tests | They have no single column to attach to. Each import reports the count. |
| Analyses, operations, macros | They don't build data. |
| Metrics, semantic models, saved queries, unit tests | They describe or check data rather than read and write it. Each import reports the count. |
| Disabled nodes | dbt leaves them out of the graph too. |
| Source freshness, run results | Atlas documents pipelines. It doesn't monitor them. |

Nodes from installed packages are imported and tagged with the package name, so
you can filter them out with one click.

## Re-importing after changes

**Import creates a new pipeline by default.** It never merges, so notes you've
written in Atlas are never lost to a re-import. To pick up changes from your dbt
project, import again, then delete the old pipeline once you've carried over
anything you wrote in it.

If you haven't written anything in Atlas yet — you are still iterating on the
project itself — `lineage-atlas import target/manifest.json --replace <pipelineId>`
swaps that pipeline's contents for the new manifest's and keeps its id. It
replaces everything, including any logic flows written in the app.

A merge mode that keeps hand-written logic flows while updating the structure
underneath would be a welcome contribution.
