import { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { defaultDbPath } from './paths.js';

/** `data/atlas.db` in a checkout, the per-user data directory once installed. */
export const DB_PATH = defaultDbPath();

mkdirSync(dirname(DB_PATH), { recursive: true });

/**
 * Node's built-in SQLite, so the project installs with no native build step.
 * Everything below binds positionally — node:sqlite is stricter about named
 * parameters than better-sqlite3, and `?` works the same everywhere.
 */
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

export type Param = string | number | bigint | null | Uint8Array;

/**
 * The SQL expression every timestamp in this database is written with.
 *
 * `strftime`, not `datetime`: SQLite's `datetime('now')` writes UTC without
 * saying so — `2026-09-12 10:33:44` — and a client reading that string is free
 * to take it for local time, which is how a record silently drifts by however
 * many hours the reader happens to sit from Greenwich. Stamping the `Z` at the
 * point of writing means what comes back out of a query is already the ISO-8601
 * the API and the file format promise, with no reformatting layer to forget.
 */
export const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

/**
 * Normalises a stored timestamp to ISO-8601 on the way out. New rows are
 * written that way already; this is for rows written before `NOW` existed, and
 * for anything hand-edited into the file since.
 */
export function isoTime(stamp: string | null | undefined): string {
  if (!stamp) return '';
  if (stamp.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(stamp)) return stamp;
  return `${stamp.replace(' ', 'T')}Z`;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]): void {
  db.prepare(sql).run(...params);
}

/** Runs `fn` in a transaction, rolling back if it throws. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS graphs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (${NOW}),
  updated_at  TEXT NOT NULL DEFAULT (${NOW})
);

-- owner and updated_by are the two halves of stewardship: the team answerable
-- for the thing, and whoever last edited what Atlas says about it. The
-- timestamps date the documentation record, never a pipeline run — see the
-- note on the assets table below.
CREATE TABLE IF NOT EXISTS codes (
  id            TEXT PRIMARY KEY,
  graph_id      TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  x             REAL NOT NULL DEFAULT 0,
  y             REAL NOT NULL DEFAULT 0,
  description   TEXT NOT NULL DEFAULT '',
  owner         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  updated_by    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (${NOW}),
  updated_at    TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS idx_codes_graph ON codes(graph_id);

CREATE TABLE IF NOT EXISTS code_tags (
  code_id  TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  tag      TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (code_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_code_tags_tag ON code_tags(tag);

CREATE TABLE IF NOT EXISTS edges (
  id      TEXT PRIMARY KEY,
  source  TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  target  TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  UNIQUE (source, target)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);

-- The same four stewardship fields the codes table carries, for the same
-- reason: an asset page is documentation someone wrote and someone maintains.
--
-- These timestamps are emphatically not freshness. created_at is when this
-- table was first documented and updated_at when its description, owner or
-- schema last changed — nothing here observes the warehouse, and versions 3
-- and 4 of the file format removed the fields that once pretended to.
CREATE TABLE IF NOT EXISTS assets (
  id              TEXT PRIMARY KEY,
  graph_id        TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  code_id         TEXT REFERENCES codes(id) ON DELETE SET NULL,
  materialization TEXT NOT NULL DEFAULT 'table',
  description     TEXT NOT NULL DEFAULT '',
  owner           TEXT NOT NULL DEFAULT '',
  updated_by      TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (${NOW}),
  updated_at      TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS idx_assets_graph ON assets(graph_id);

CREATE TABLE IF NOT EXISTS asset_columns (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  data_type   TEXT NOT NULL,
  key_kind    TEXT CHECK (key_kind IN ('pk','fk')),
  nullable    INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  tests       TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_asset_columns_asset ON asset_columns(asset_id);

CREATE TABLE IF NOT EXISTS asset_links (
  id        TEXT PRIMARY KEY,
  code_id   TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('input','output')),
  path      TEXT NOT NULL,
  detail    TEXT NOT NULL DEFAULT '',
  asset_id  TEXT REFERENCES assets(id) ON DELETE SET NULL,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_asset_links_code ON asset_links(code_id);

CREATE TABLE IF NOT EXISTS asset_link_tags (
  asset_link_id TEXT NOT NULL REFERENCES asset_links(id) ON DELETE CASCADE,
  tag           TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (asset_link_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_asset_link_tags_tag ON asset_link_tags(tag);

CREATE TABLE IF NOT EXISTS flow_steps (
  id        TEXT PRIMARY KEY,
  code_id   TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  op        TEXT NOT NULL DEFAULT '',
  title     TEXT NOT NULL,
  body      TEXT NOT NULL DEFAULT ''
);
`);

/** The pipeline that existing data belongs to, and the one seeded on a fresh install. */
export const DEFAULT_GRAPH_ID = 'warehouse';

/**
 * `ATLAS_NO_SEED=1` (or `--no-seed`): a fresh database gets no demo pipeline —
 * neither the "Analytics warehouse" row nor its contents. For an agent or a CI
 * job listing pipelines, the demo is noise. A database that already has it keeps it.
 */
export const NO_SEED = ['1', 'true', 'yes'].includes((process.env.ATLAS_NO_SEED ?? '').trim().toLowerCase());

function tableExists(table: string): boolean {
  return !!get('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', 'table', table);
}

function columnNames(table: string): Set<string> {
  return new Set(all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));
}

/**
 * Migrations. Each step is idempotent: an already-migrated database passes
 * straight through.
 */
function migrate(): void {
  if (!NO_SEED && !get('SELECT id FROM graphs WHERE id = ?', DEFAULT_GRAPH_ID)) {
    run(
      'INSERT INTO graphs (id, name, description) VALUES (?, ?, ?)',
      DEFAULT_GRAPH_ID,
      'Analytics warehouse',
      'Orders, payments and CRM data from landing through to the certified marts.',
    );
  }

  // Renames every table and column from the pre-rename vocabulary (nodes,
  // datasets, artifacts with a fixed `kind` enum) to the current one (codes,
  // assets, asset_links whose classification is just tags). Guarded on the
  // old `nodes` table still being present, so an already-migrated database —
  // or a brand-new one, which never had it — passes straight through.
  if (tableExists('nodes')) renameToCodesAndAssets();

  // Drops the freshness SLA field and collapses the three-way fresh/stale/
  // failing status into active/inactive. Guarded on `sla` still being a
  // column of `codes`, so an already-migrated database passes straight
  // through — including one that just went through the rename above.
  if (columnNames('codes').has('sla')) simplifyStatus();

  // Drops row count and freshness — free-text fields nothing ever computed
  // and no UI could keep honest. Guarded on `row_count` still being a column
  // of `codes`.
  if (columnNames('codes').has('row_count')) dropRowCountAndFreshness();

  // Drops the captured source (language/path/code) a logic flow used to carry,
  // along with the line ranges each step pointed into it — a flow is just its
  // steps now. Guarded on `source_lang` still being a column of `codes`.
  if (columnNames('codes').has('source_lang')) dropFlowSource();

  // Gives every code and every asset the same four stewardship fields — owner,
  // who last edited it, and when it was created and last changed — and moves
  // every existing timestamp to ISO-8601. Guarded on `updated_by` not yet
  // being a column of `codes`.
  if (!columnNames('codes').has('updated_by')) addStewardship();

  // Drops the sample rows an asset used to carry. Guarded on the table still
  // being there.
  if (tableExists('asset_samples')) dropSampleRows();

  // Adds the evidence behind a code or a declared input/output (file format
  // 9). Guarded on the column not existing yet.
  if (!columnNames('codes').has('provenance_source')) addProvenance();
}

/**
 * Provenance: where a claim was learned from (`doc`, `code`, `inferred`,
 * `human`) and exactly where (`DESIGN.md §14.2`). Plain `ALTER TABLE … ADD
 * COLUMN` is enough here — unlike the timestamps, the default is a constant
 * (`''`, meaning unknown), so nothing needs rebuilding.
 */
function addProvenance(): void {
  tx(() => {
    for (const table of ['codes', 'asset_links']) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN provenance_source TEXT NOT NULL DEFAULT ''`);
      db.exec(`ALTER TABLE ${table} ADD COLUMN provenance_ref TEXT NOT NULL DEFAULT ''`);
    }
  });
}

/**
 * Sample rows are gone. They were a handful of already-stringified cells kept
 * per asset, and they sat wrong in a documentation tool twice over: nothing
 * ever refreshed them, so they aged into fiction the same way `rowCount` and
 * `freshness` did before them; and they were the one place a schema page could
 * carry real customer data, which made an otherwise shareable export something
 * you had to read before sending.
 *
 * Nothing else referenced the table, so this is a plain drop.
 */
function dropSampleRows(): void {
  db.exec('DROP TABLE asset_samples');
}

/**
 * SQLite cannot rebind a foreign key's target table in place, and the old
 * `kind` enum has no equivalent column any more — its value becomes each
 * asset link's first (main) tag instead. So every table that pointed at
 * `nodes` or `datasets` is rebuilt against the new schema in one transaction.
 *
 * `dataset_samples` is dropped rather than carried: sample rows no longer
 * exist anywhere in the app, so a database arriving from this far back lands
 * directly in the world without them instead of being given a table that the
 * migration two steps down would only delete again.
 */
function renameToCodesAndAssets(): void {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');

    db.exec(`
      INSERT INTO codes (id, graph_id, name, x, y, description, owner, status, source_lang, source_path, source_code, created_at, updated_at)
      SELECT id, graph_id, name, x, y, description, owner,
             CASE status WHEN 'fresh' THEN 'active' ELSE 'inactive' END,
             source_lang, source_path, source_code, created_at, updated_at FROM nodes;

      INSERT INTO code_tags (code_id, tag, position)
      SELECT node_id, tag, position FROM node_tags;

      INSERT INTO assets (id, graph_id, name, code_id, materialization, description)
      SELECT id, graph_id, name, node_id, materialization, description FROM datasets;

      INSERT INTO asset_columns (id, asset_id, name, data_type, key_kind, nullable, description, tests, position)
      SELECT id, dataset_id, name, data_type, key_kind, nullable, description, tests, position FROM dataset_columns;

      INSERT INTO asset_links (id, code_id, direction, path, detail, asset_id, position)
      SELECT id, node_id, direction, path, detail, dataset_id, position FROM artifacts;

      INSERT INTO asset_link_tags (asset_link_id, tag, position)
      SELECT id, kind, 0 FROM artifacts;

      CREATE TABLE flow_steps_v2 (
        id        TEXT PRIMARY KEY,
        code_id   TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
        position  INTEGER NOT NULL DEFAULT 0,
        op        TEXT NOT NULL DEFAULT '',
        title     TEXT NOT NULL,
        body      TEXT NOT NULL DEFAULT '',
        line_from INTEGER NOT NULL DEFAULT 1,
        line_to   INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO flow_steps_v2 (id, code_id, position, op, title, body, line_from, line_to)
      SELECT id, node_id, position, op, title, body, line_from, line_to FROM flow_steps;

      CREATE TABLE edges_v2 (
        id      TEXT PRIMARY KEY,
        source  TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
        target  TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
        UNIQUE (source, target)
      );
      INSERT INTO edges_v2 (id, source, target) SELECT id, source, target FROM edges;

      DROP TABLE artifacts;
      DROP TABLE dataset_samples;
      DROP TABLE dataset_columns;
      DROP TABLE datasets;
      DROP TABLE node_tags;
      DROP TABLE flow_steps;
      DROP TABLE edges;
      DROP TABLE nodes;

      ALTER TABLE flow_steps_v2 RENAME TO flow_steps;
      ALTER TABLE edges_v2 RENAME TO edges;

      CREATE INDEX IF NOT EXISTS idx_flow_code ON flow_steps(code_id);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
    `);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * SQLite cannot drop a column with a CHECK constraint in place, so `codes` is
 * rebuilt without `sla`. Freshness/health is no longer three states either:
 * `fresh` becomes `active`, and `stale`/`failing` both become `inactive` —
 * there is no lossless mapping, so "still working as of its last run" is the
 * line drawn between them.
 */
function simplifyStatus(): void {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`
      CREATE TABLE codes_v3 (
        id            TEXT PRIMARY KEY,
        graph_id      TEXT REFERENCES graphs(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        x             REAL NOT NULL DEFAULT 0,
        y             REAL NOT NULL DEFAULT 0,
        description   TEXT NOT NULL DEFAULT '',
        owner         TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
        row_count     TEXT NOT NULL DEFAULT '',
        freshness     TEXT NOT NULL DEFAULT '',
        source_lang   TEXT,
        source_path   TEXT,
        source_code   TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO codes_v3 (id, graph_id, name, x, y, description, owner, status, row_count, freshness, source_lang, source_path, source_code, created_at, updated_at)
      SELECT id, graph_id, name, x, y, description, owner,
             CASE status WHEN 'fresh' THEN 'active' ELSE 'inactive' END,
             row_count, freshness, source_lang, source_path, source_code, created_at, updated_at
      FROM codes;
      DROP TABLE codes;
      ALTER TABLE codes_v3 RENAME TO codes;
      CREATE INDEX IF NOT EXISTS idx_codes_graph ON codes(graph_id);
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * Drops row count and freshness. Both were free text nothing in the app ever
 * computed or refreshed, so they only ever recorded what the seed data (or
 * whoever last typed into a now-removed field) had said once.
 */
function dropRowCountAndFreshness(): void {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`
      CREATE TABLE codes_v4 (
        id            TEXT PRIMARY KEY,
        graph_id      TEXT REFERENCES graphs(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        x             REAL NOT NULL DEFAULT 0,
        y             REAL NOT NULL DEFAULT 0,
        description   TEXT NOT NULL DEFAULT '',
        owner         TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
        source_lang   TEXT,
        source_path   TEXT,
        source_code   TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO codes_v4 (id, graph_id, name, x, y, description, owner, status, source_lang, source_path, source_code, created_at, updated_at)
      SELECT id, graph_id, name, x, y, description, owner, status, source_lang, source_path, source_code, created_at, updated_at
      FROM codes;
      DROP TABLE codes;
      ALTER TABLE codes_v4 RENAME TO codes;
      CREATE INDEX IF NOT EXISTS idx_codes_graph ON codes(graph_id);
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * Drops the source a logic flow captured (language, path, full code) and the
 * line ranges its steps pointed into that source. A flow is just its ordered
 * steps now — nothing else referenced the source, so nothing else changes.
 */
function dropFlowSource(): void {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`
      CREATE TABLE codes_v5 (
        id            TEXT PRIMARY KEY,
        graph_id      TEXT REFERENCES graphs(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        x             REAL NOT NULL DEFAULT 0,
        y             REAL NOT NULL DEFAULT 0,
        description   TEXT NOT NULL DEFAULT '',
        owner         TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO codes_v5 (id, graph_id, name, x, y, description, owner, status, created_at, updated_at)
      SELECT id, graph_id, name, x, y, description, owner, status, created_at, updated_at
      FROM codes;
      DROP TABLE codes;
      ALTER TABLE codes_v5 RENAME TO codes;
      CREATE INDEX IF NOT EXISTS idx_codes_graph ON codes(graph_id);

      CREATE TABLE flow_steps_v3 (
        id        TEXT PRIMARY KEY,
        code_id   TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
        position  INTEGER NOT NULL DEFAULT 0,
        op        TEXT NOT NULL DEFAULT '',
        title     TEXT NOT NULL,
        body      TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO flow_steps_v3 (id, code_id, position, op, title, body)
      SELECT id, code_id, position, op, title, body FROM flow_steps;
      DROP TABLE flow_steps;
      ALTER TABLE flow_steps_v3 RENAME TO flow_steps;
      CREATE INDEX IF NOT EXISTS idx_flow_code ON flow_steps(code_id);
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * Stewardship, everywhere. Before this, `codes` alone dated itself and only
 * two of its dates were ever exposed; `assets` recorded nothing at all, so an
 * asset page could not say who wrote it or when it was last true.
 *
 * Both tables are rebuilt rather than `ALTER`ed, because the timestamps need a
 * DEFAULT — a column added in place can only default to a constant, which
 * would leave every future insert stamped with whatever moment the migration
 * happened to run. `graphs` comes along for the same reason: its two dates
 * were already exposed as a pipeline's `createdAt`/`updatedAt`, in the
 * ambiguous no-timezone form that `NOW` exists to end.
 *
 * Existing rows keep their real dates, converted; a row that never had one
 * (every asset) is dated from the pipeline it belongs to rather than from now,
 * so a warehouse documented last year does not claim to have been written the
 * moment someone upgraded. `owner` on an asset is seeded from the code that
 * produces it, which is who was answerable for it all along.
 */
function addStewardship(): void {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`
      CREATE TABLE graphs_v2 (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (${NOW}),
        updated_at  TEXT NOT NULL DEFAULT (${NOW})
      );
      INSERT INTO graphs_v2 (id, name, description, created_at, updated_at)
      SELECT id, name, description,
             replace(created_at, ' ', 'T') || 'Z',
             replace(updated_at, ' ', 'T') || 'Z'
      FROM graphs;
      DROP TABLE graphs;
      ALTER TABLE graphs_v2 RENAME TO graphs;

      CREATE TABLE codes_v6 (
        id            TEXT PRIMARY KEY,
        graph_id      TEXT REFERENCES graphs(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        x             REAL NOT NULL DEFAULT 0,
        y             REAL NOT NULL DEFAULT 0,
        description   TEXT NOT NULL DEFAULT '',
        owner         TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
        updated_by    TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL DEFAULT (${NOW}),
        updated_at    TEXT NOT NULL DEFAULT (${NOW})
      );
      INSERT INTO codes_v6 (id, graph_id, name, x, y, description, owner, status, updated_by, created_at, updated_at)
      SELECT id, graph_id, name, x, y, description, owner, status, '',
             replace(created_at, ' ', 'T') || 'Z',
             replace(updated_at, ' ', 'T') || 'Z'
      FROM codes;
      DROP TABLE codes;
      ALTER TABLE codes_v6 RENAME TO codes;
      CREATE INDEX IF NOT EXISTS idx_codes_graph ON codes(graph_id);

      CREATE TABLE assets_v2 (
        id              TEXT PRIMARY KEY,
        graph_id        TEXT REFERENCES graphs(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        code_id         TEXT REFERENCES codes(id) ON DELETE SET NULL,
        materialization TEXT NOT NULL DEFAULT 'table',
        description     TEXT NOT NULL DEFAULT '',
        owner           TEXT NOT NULL DEFAULT '',
        updated_by      TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT (${NOW}),
        updated_at      TEXT NOT NULL DEFAULT (${NOW})
      );
      INSERT INTO assets_v2 (id, graph_id, name, code_id, materialization, description, owner, updated_by, created_at, updated_at)
      SELECT a.id, a.graph_id, a.name, a.code_id, a.materialization, a.description,
             coalesce((SELECT c.owner FROM codes c WHERE c.id = a.code_id), ''),
             '',
             coalesce((SELECT g.created_at FROM graphs g WHERE g.id = a.graph_id), ${NOW}),
             coalesce((SELECT g.updated_at FROM graphs g WHERE g.id = a.graph_id), ${NOW})
      FROM assets a;
      DROP TABLE assets;
      ALTER TABLE assets_v2 RENAME TO assets;
      CREATE INDEX IF NOT EXISTS idx_assets_graph ON assets(graph_id);
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

migrate();

// Deferred until after migrate(): on a database still carrying the legacy
// `flow_steps` shape, this column does not exist until the rebuild runs.
db.exec('CREATE INDEX IF NOT EXISTS idx_flow_code ON flow_steps(code_id)');

export function isEmpty(): boolean {
  return (get<{ n: number }>('SELECT count(*) AS n FROM codes')?.n ?? 0) === 0;
}

/**
 * A fresh opaque id for a code or an asset — `code_V1StGXR8Z5` — never derived
 * from the name. A name is a label people edit, and two pipelines may
 * legitimately document assets of the same name; an id is what links, edges,
 * flows and exports point at, so it has to be independent of both. The prefix
 * keeps an id self-describing in a log line or a hand-read export.
 *
 * The collision loop is a formality at this size — nanoid(10) — but a primary
 * key is not the place to assume.
 */
const ID_PREFIX = { codes: 'code', assets: 'asset' } as const;

export function newEntityId(table: keyof typeof ID_PREFIX): string {
  for (;;) {
    const candidate = `${ID_PREFIX[table]}_${nanoid(10)}`;
    if (!get(`SELECT id FROM ${table} WHERE id = ?`, candidate)) return candidate;
  }
}

/**
 * Generates an id from `base` that is not already taken in `table`. Pipelines
 * alone keep name-derived ids: a pipeline is the one thing a person types into
 * a `?graph=` query string, and it is never renamed out from under a link the
 * way a code or an asset is. Codes and assets use `newEntityId`.
 */
export function uniqueId(table: 'graphs', base: string): string {
  const slug = base.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item';
  let candidate = slug;
  let suffix = 1;
  while (get(`SELECT id FROM ${table} WHERE id = ?`, candidate)) {
    suffix += 1;
    candidate = `${slug}_${suffix}`;
  }
  return candidate;
}

/**
 * Marks a code as edited: when, and by whom. Called for the changes that do not
 * go through `updateCode` — a tag, an input, a logic flow — so that every edit
 * a person can make moves the same two fields, and `updatedAt` never lags
 * behind what the page actually says.
 */
export function touch(codeId: string, actor: string): void {
  run(`UPDATE codes SET updated_at = ${NOW}, updated_by = ? WHERE id = ?`, actor, codeId);
}

/** The same, for an asset. */
export function touchAsset(assetId: string, actor: string): void {
  run(`UPDATE assets SET updated_at = ${NOW}, updated_by = ? WHERE id = ?`, actor, assetId);
}
