import { nanoid } from 'nanoid';
import { all, get, isoTime, newEntityId, NOW, run, tx, uniqueId } from './db.js';
import { ConflictError, getPipeline } from './repo.js';
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  MIN_BUNDLE_VERSION,
  generator,
} from './version.js';
import type {
  AtlasBundle,
  BundleAsset,
  BundleCode,
  BundleGenerator,
  BundleReadResult,
  CodeStatus,
  Direction,
  ImportResult,
  Pipeline,
} from './types.js';

const newId = () => nanoid(12);
const STATUSES: CodeStatus[] = ['active', 'inactive'];
const DIRECTIONS: Direction[] = ['input', 'output'];

/** Accepts anything a bundle might carry for status — including a pre-simplification
 * fresh/stale/failing value — and normalises it to the current active/inactive. */
function normaliseStatus(status: unknown): CodeStatus {
  if (status === 'active' || status === 'inactive') return status;
  return status === 'fresh' ? 'active' : 'inactive';
}

/* ---------------------------------------------------------------- export */

export function exportPipeline(graphId: string): AtlasBundle {
  const pipeline = getPipeline(graphId);
  if (!pipeline) throw new ConflictError('That pipeline does not exist.');

  const codeRows = all<{
    id: string; name: string; x: number; y: number; description: string;
    owner: string; status: CodeStatus;
    updated_by: string; created_at: string; updated_at: string;
  }>('SELECT * FROM codes WHERE graph_id = ? ORDER BY x, y', graphId);

  const codes: BundleCode[] = codeRows.map((n) => ({
    id: n.id,
    name: n.name,
    x: n.x,
    y: n.y,
    description: n.description,
    owner: n.owner,
    status: n.status,
    createdAt: isoTime(n.created_at),
    updatedAt: isoTime(n.updated_at),
    updatedBy: n.updated_by,
    tags: all<{ tag: string }>('SELECT tag FROM code_tags WHERE code_id = ? ORDER BY position, tag', n.id).map((t) => t.tag),
    steps: all('SELECT position, op, title, body FROM flow_steps WHERE code_id = ? ORDER BY position', n.id),
    assetLinks: all<{ id: string; direction: Direction; path: string; detail: string; asset_id: string | null; position: number }>(
      'SELECT id, direction, path, detail, asset_id, position FROM asset_links WHERE code_id = ? ORDER BY direction, position',
      n.id,
    ).map((a) => ({
      direction: a.direction,
      path: a.path,
      detail: a.detail,
      tags: all<{ tag: string }>('SELECT tag FROM asset_link_tags WHERE asset_link_id = ? ORDER BY position, tag', a.id).map((t) => t.tag),
      assetRef: a.asset_id,
      position: a.position,
    })),
  }));

  const assets: BundleAsset[] = all<{
    id: string; name: string; code_id: string | null; materialization: string; description: string;
    owner: string; updated_by: string; created_at: string; updated_at: string;
  }>(
    'SELECT * FROM assets WHERE graph_id = ? ORDER BY name',
    graphId,
  ).map((d) => ({
    id: d.id,
    name: d.name,
    materialization: d.materialization,
    description: d.description,
    owner: d.owner,
    createdAt: isoTime(d.created_at),
    updatedAt: isoTime(d.updated_at),
    updatedBy: d.updated_by,
    producedBy: d.code_id,
    columns: all<{ name: string; data_type: string; key_kind: 'pk' | 'fk' | null; nullable: number; description: string; tests: string; position: number }>(
      'SELECT name, data_type, key_kind, nullable, description, tests, position FROM asset_columns WHERE asset_id = ? ORDER BY position',
      d.id,
    ).map((c) => ({
      name: c.name,
      dataType: c.data_type,
      keyKind: c.key_kind,
      nullable: !!c.nullable,
      description: c.description,
      tests: c.tests ? c.tests.split(',').map((t) => t.trim()).filter(Boolean) : [],
      position: c.position,
    })),
  }));

  const edges = all<{ source: string; target: string }>(
    'SELECT e.source, e.target FROM edges e JOIN codes c ON c.id = e.source WHERE c.graph_id = ?',
    graphId,
  );

  return {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_VERSION,
    generator: generator(),
    exportedAt: new Date().toISOString(),
    counts: { codes: codes.length, edges: edges.length, assets: assets.length },
    pipeline: { name: pipeline.name, description: pipeline.description },
    codes,
    edges,
    assets,
  };
}

/** `analytics-warehouse-2026-09-08.atlas.json` */
export function bundleFilename(bundle: AtlasBundle): string {
  const slug = bundle.pipeline.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pipeline';
  return `${slug}-${bundle.exportedAt.slice(0, 10)}.atlas.json`;
}

/* ---------------------------------------------------------------- import */

export class BundleError extends Error {}

/* ------------------------------------------------- format upgrade ladder */

/**
 * One step per format version, applied in order from the file's own version up
 * to `BUNDLE_VERSION`. Each step takes the shape version N wrote and returns the
 * shape version N+1 reads — nothing skips ahead, so adding a version means
 * adding exactly one entry here and never touching the others.
 *
 * Steps 1 through 4 mirror, one for one, the database migrations in `db.ts`: a
 * file and a database that started life at the same version land in the same
 * place.
 *
 * A step is free to drop data the current format has no home for. That is what
 * a version bump is for, and every drop is reported back to the user as an
 * upgrade note rather than happening silently.
 */
interface UpgradeStep {
  /** Reported to the user, verbatim, when the step runs. */
  readonly note: string;
  readonly apply: (bundle: any) => any;
}

const UPGRADES: Record<number, UpgradeStep> = {
  1: {
    note: 'nodes/datasets/artifacts renamed to codes/assets/assetLinks; each input/output kind became its main tag',
    apply: (b) => ({
      ...b,
      formatVersion: 2,
      codes: (b.nodes ?? []).map((node: any) => {
        const { artifacts, ...rest } = node;
        return {
          ...rest,
          steps: node.steps ?? [],
          assetLinks: (artifacts ?? []).map((artifact: any) => ({
            direction: artifact.direction,
            path: artifact.path,
            detail: artifact.detail,
            // `dataset` was the default kind and carried no meaning worth a tag.
            tags: artifact.kind && artifact.kind !== 'dataset' ? [artifact.kind] : [],
            assetRef: artifact.datasetRef ?? null,
            position: artifact.position,
          })),
        };
      }),
      assets: b.datasets ?? [],
      nodes: undefined,
      datasets: undefined,
    }),
  },
  2: {
    note: 'fresh/stale/failing status collapsed to active/inactive; the freeform sla field dropped',
    apply: (b) => ({
      ...b,
      formatVersion: 3,
      codes: (b.codes ?? []).map(({ sla, ...code }: any) => ({ ...code, status: normaliseStatus(code.status) })),
    }),
  },
  3: {
    note: 'rowCount and freshness dropped, since nothing ever computed or refreshed them',
    apply: (b) => ({
      ...b,
      formatVersion: 4,
      codes: (b.codes ?? []).map(({ rowCount, freshness, ...code }: any) => code),
    }),
  },
  4: {
    note: 'captured source and per-step line ranges dropped; a logic flow is now only its prose steps',
    apply: (b) => ({
      ...b,
      formatVersion: 5,
      codes: (b.codes ?? []).map(({ source, ...code }: any) => ({
        ...code,
        steps: (code.steps ?? []).map(({ lineFrom, lineTo, ...step }: any) => step),
      })),
    }),
  },
  5: {
    note: 'generator and counts added to the envelope; provenance recorded as pre-1.0',
    apply: (b) => ({
      ...b,
      formatVersion: 6,
      generator: b.generator ?? { name: 'unknown', version: 'pre-1.0' },
      counts: {
        codes: (b.codes ?? []).length,
        edges: (b.edges ?? []).length,
        assets: (b.assets ?? []).length,
      },
    }),
  },
  7: {
    note: 'sample rows dropped from every asset — nothing refreshed them, and they were the one part of an export that could carry real customer data',
    apply: (b) => ({
      ...b,
      formatVersion: 8,
      assets: (b.assets ?? []).map(({ sampleRows, ...asset }: any) => asset),
    }),
  },
  6: {
    note: 'createdAt, updatedAt and updatedBy added to every code and asset, and owner added to assets; older files are dated from when they were exported, with no editor named',
    apply: (b) => {
      // The export time is the only date such a file carries, and it is a true
      // upper bound: everything in it existed by then. Better a date that is
      // honestly too late than a field left blank or filled with today.
      const dated = typeof b.exportedAt === 'string' && b.exportedAt ? b.exportedAt : new Date().toISOString();
      const stamp = (record: any, owner: string) => ({
        owner,
        ...record,
        createdAt: record.createdAt ?? dated,
        updatedAt: record.updatedAt ?? dated,
        updatedBy: record.updatedBy ?? '',
      });
      const codes = (b.codes ?? []).map((code: any) => stamp(code, code.owner ?? ''));
      // An asset had no owner of its own before this version; the code that
      // produces it did, and that is who was answerable for it all along.
      const ownerOf = new Map<string, string>(codes.map((c: any) => [c.id, c.owner]));
      return {
        ...b,
        formatVersion: 7,
        codes,
        assets: (b.assets ?? []).map((asset: any) => stamp(asset, ownerOf.get(asset.producedBy) ?? '')),
      };
    },
  },
};

/** Walks a bundle up the ladder to the current format, collecting one note per step. */
function upgradeBundle(input: any): { bundle: AtlasBundle; upgrades: string[] } {
  let bundle = input;
  const upgrades: string[] = [];
  while (bundle.formatVersion < BUNDLE_VERSION) {
    const from: number = bundle.formatVersion;
    const step = UPGRADES[from];
    // Unreachable while every version below the current one has a rung, which is
    // exactly what the ladder is for. A missing rung must still not corrupt.
    if (!step) {
      throw new BundleError(`No upgrade path from format version ${from}. Re-export the pipeline from the Atlas that wrote this file.`);
    }
    bundle = step.apply(bundle);
    upgrades.push(`v${from} to v${from + 1}: ${step.note}`);
  }
  return { bundle: bundle as AtlasBundle, upgrades };
}

/* -------------------------------------------------------------- validate */

/** Can `from` already reach `to` along the edges accepted so far? */
function reaches(from: string, to: string, adjacency: Map<string, string[]>): boolean {
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const at = stack.pop()!;
    if (at === to) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    stack.push(...(adjacency.get(at) ?? []));
  }
  return false;
}

/**
 * Reads a file into the shape this build understands: gates the envelope,
 * upgrades it, then checks the contents.
 *
 * Two classes of problem, deliberately kept apart:
 *
 *  - **Errors** throw `BundleError` and nothing is written. These are things
 *    that make the file meaningless: wrong format, a version from the future, a
 *    missing pipeline name, an edge pointing at a code that is not there.
 *  - **Warnings** are returned alongside a repaired bundle. These are things a
 *    hand-edited or foreign-tool file gets wrong in ways with an obvious, safe
 *    reading: a dangling asset reference, a duplicate edge, an edge that would
 *    close a cycle. The import still lands whole and the user is told what
 *    changed.
 *
 * The cycle check matters most. The graph is acyclic by construction everywhere
 * else in the app, and a file is the one way an edge could ever arrive without
 * passing `repo.addEdge`. Cycle-forming edges are dropped here with a warning,
 * matching how inferred links already behave, so a foreign file with one bad
 * arrow still imports instead of being refused outright.
 */
export function readBundle(input: unknown): BundleReadResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BundleError('That file is not a JSON object.');
  }
  const raw = input as Record<string, any>;

  if (raw.format !== BUNDLE_FORMAT) {
    throw new BundleError(`That file is not a Lineage Atlas pipeline export (expected format "${BUNDLE_FORMAT}").`);
  }
  const sourceVersion = raw.formatVersion;
  if (typeof sourceVersion !== 'number' || !Number.isInteger(sourceVersion) || sourceVersion < 1) {
    throw new BundleError('That file does not declare a valid formatVersion.');
  }
  if (sourceVersion > BUNDLE_VERSION) {
    throw new BundleError(
      `This file was written by a newer version of Atlas (format ${sourceVersion}; this build reads ${BUNDLE_VERSION}). Upgrade Atlas and try again.`,
    );
  }
  if (sourceVersion < MIN_BUNDLE_VERSION) {
    throw new BundleError(
      `Format ${sourceVersion} is no longer supported (this build reads ${MIN_BUNDLE_VERSION} and up).`,
    );
  }

  const { bundle, upgrades } = upgradeBundle(raw);
  const warnings: string[] = [];

  if (!Array.isArray(bundle.codes) || !Array.isArray(bundle.edges) || !Array.isArray(bundle.assets)) {
    throw new BundleError('The file is missing its codes, edges or assets.');
  }
  if (!bundle.pipeline?.name) throw new BundleError('The file does not name its pipeline.');

  /* codes */
  const codeIds = new Set<string>();
  for (const code of bundle.codes) {
    if (!code.id || !code.name) throw new BundleError('Every code needs an id and a name.');
    if (codeIds.has(code.id)) throw new BundleError(`Duplicate code id in the file: ${code.id}`);
    codeIds.add(code.id);
    if (code.status && !STATUSES.includes(code.status)) {
      throw new BundleError(`Unknown status "${code.status}" on ${code.name}.`);
    }
    for (const link of code.assetLinks ?? []) {
      if (!DIRECTIONS.includes(link.direction)) {
        throw new BundleError(`An input/output on ${code.name} has an unknown direction "${link.direction}".`);
      }
    }
  }

  /* assets */
  const assetIds = new Set<string>();
  for (const asset of bundle.assets) {
    if (!asset.id || !asset.name) throw new BundleError('Every asset needs an id and a name.');
    if (assetIds.has(asset.id)) throw new BundleError(`Duplicate asset id in the file: ${asset.id}`);
    assetIds.add(asset.id);
    if (asset.producedBy && !codeIds.has(asset.producedBy)) {
      warnings.push(`Asset "${asset.name}" names a producer that is not in the file; it will import without one.`);
      asset.producedBy = null;
    }
  }

  /* asset links point at assets in the same file */
  for (const code of bundle.codes) {
    for (const link of code.assetLinks ?? []) {
      if (link.assetRef && !assetIds.has(link.assetRef)) {
        warnings.push(`"${code.name}" points at asset "${link.assetRef}", which is not in the file; that input/output imports without a schema.`);
        link.assetRef = null;
      }
    }
  }

  /* edges: every endpoint must exist, and the result must stay acyclic */
  const adjacency = new Map<string, string[]>();
  const kept: { source: string; target: string }[] = [];
  const seenPairs = new Set<string>();
  for (const edge of bundle.edges) {
    if (!codeIds.has(edge.source) || !codeIds.has(edge.target)) {
      throw new BundleError('An edge refers to a code that is not in the file.');
    }
    if (edge.source === edge.target) {
      warnings.push(`Skipped a link from "${edge.source}" to itself.`);
      continue;
    }
    const pair = `${edge.source} ${edge.target}`;
    if (seenPairs.has(pair)) {
      warnings.push(`Skipped a duplicate link ${edge.source} to ${edge.target}.`);
      continue;
    }
    if (reaches(edge.target, edge.source, adjacency)) {
      warnings.push(`Skipped link ${edge.source} to ${edge.target}: it would close a cycle, and the graph is kept acyclic.`);
      continue;
    }
    seenPairs.add(pair);
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    kept.push({ source: edge.source, target: edge.target });
  }
  bundle.edges = kept;

  /* counts are a courtesy, not a contract: say so rather than refusing */
  const actual = { codes: bundle.codes.length, edges: bundle.edges.length, assets: bundle.assets.length };
  const declared = bundle.counts;
  if (
    sourceVersion === BUNDLE_VERSION &&
    declared &&
    (declared.codes !== actual.codes || declared.assets !== actual.assets)
  ) {
    warnings.push(
      `The file declares ${declared.codes} codes and ${declared.assets} assets but holds ${actual.codes} and ${actual.assets}. Importing what is actually there.`,
    );
  }
  bundle.counts = actual;

  return { bundle, sourceVersion, upgrades, warnings };
}

/**
 * Shorthand for callers that only want the bundle and are content for repairs to
 * be silent. Prefer `readBundle` anywhere the notes can be shown to a person.
 */
export function validateBundle(input: unknown): AtlasBundle {
  return readBundle(input).bundle;
}

/**
 * Writes a bundle in as a brand-new pipeline. Ids are remapped on the way in,
 * so importing the same file twice gives two independent pipelines rather than
 * a collision, which is what makes a bundle safe to pass around.
 *
 * Everything below runs in one transaction, after `readBundle` has already had
 * the final say on the contents: an import lands whole or not at all.
 */
export function importBundle(input: unknown, nameOverride?: string): ImportResult {
  const { bundle, sourceVersion, upgrades, warnings } = readBundle(input);

  const pipeline = tx(() => {
    const graphId = uniqueId('graphs', nameOverride?.trim() || bundle.pipeline.name);
    run(
      'INSERT INTO graphs (id, name, description) VALUES (?, ?, ?)',
      graphId,
      (nameOverride?.trim() || bundle.pipeline.name).trim(),
      bundle.pipeline.description ?? '',
    );

    const codeIds = new Map<string, string>();
    for (const code of bundle.codes) {
      const id = newEntityId('codes');
      codeIds.set(code.id, id);
      // Stewardship travels with the record. An imported pipeline is a new
      // pipeline, but *when it was documented and by whom* is content, not a
      // database key: keeping it is what makes `export → import → export`
      // lossless in everything but ids. A file that names neither is dated now.
      run(
        `INSERT INTO codes (id, graph_id, name, x, y, description, owner, status, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, coalesce(?, ${NOW}), coalesce(?, ${NOW}))`,
        id, graphId, code.name, code.x ?? 0, code.y ?? 0,
        code.description ?? '', code.owner ?? '', normaliseStatus(code.status),
        code.updatedBy ?? '', code.createdAt || null, code.updatedAt || null,
      );
      // Tag order is meaningful, so it survives the round trip.
      (code.tags ?? []).forEach((tag, i) => {
        run('INSERT OR IGNORE INTO code_tags (code_id, tag, position) VALUES (?, ?, ?)', id, tag, i);
      });
      for (const step of code.steps ?? []) {
        run(
          'INSERT INTO flow_steps (id, code_id, position, op, title, body) VALUES (?, ?, ?, ?, ?, ?)',
          newId(), id, step.position, step.op ?? '', step.title, step.body ?? '',
        );
      }
    }

    // Assets before asset links, so a link can always resolve its target.
    const assetIds = new Map<string, string>();
    for (const asset of bundle.assets) {
      const id = newEntityId('assets');
      assetIds.set(asset.id, id);
      run(
        `INSERT INTO assets (id, graph_id, name, code_id, materialization, description, owner, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, coalesce(?, ${NOW}), coalesce(?, ${NOW}))`,
        id, graphId, asset.name,
        asset.producedBy ? codeIds.get(asset.producedBy) ?? null : null,
        asset.materialization ?? 'table', asset.description ?? '',
        asset.owner ?? '', asset.updatedBy ?? '', asset.createdAt || null, asset.updatedAt || null,
      );
      for (const column of asset.columns ?? []) {
        run(
          `INSERT INTO asset_columns (id, asset_id, name, data_type, key_kind, nullable, description, tests, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          newId(), id, column.name, column.dataType,
          column.keyKind === 'pk' || column.keyKind === 'fk' ? column.keyKind : null,
          column.nullable ? 1 : 0, column.description ?? '',
          (column.tests ?? []).join(', '), column.position ?? 0,
        );
      }
    }

    for (const code of bundle.codes) {
      const codeId = codeIds.get(code.id)!;
      for (const link of code.assetLinks ?? []) {
        const linkId = newId();
        run(
          'INSERT INTO asset_links (id, code_id, direction, path, detail, asset_id, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
          linkId, codeId, link.direction, link.path, link.detail ?? '',
          link.assetRef ? assetIds.get(link.assetRef) ?? null : null,
          link.position ?? 0,
        );
        (link.tags ?? []).forEach((tag, i) => {
          run('INSERT OR IGNORE INTO asset_link_tags (asset_link_id, tag, position) VALUES (?, ?, ?)', linkId, tag, i);
        });
      }
    }

    // `readBundle` has already dropped self-loops, duplicates and any edge that
    // would close a cycle, so what is left is safe to insert as it stands.
    for (const edge of bundle.edges) {
      run(
        'INSERT OR IGNORE INTO edges (id, source, target) VALUES (?, ?, ?)',
        newId(), codeIds.get(edge.source)!, codeIds.get(edge.target)!,
      );
    }

    const created = get<Pipeline>(
      `SELECT id, name, description,
              (SELECT count(*) FROM codes c WHERE c.graph_id = g.id) AS codeCount,
              (SELECT count(*) FROM edges e JOIN codes c ON c.id = e.source WHERE c.graph_id = g.id) AS edgeCount,
              created_at AS createdAt, updated_at AS updatedAt
       FROM graphs g WHERE id = ?`,
      graphId,
    )!;
    return { ...created, createdAt: isoTime(created.createdAt), updatedAt: isoTime(created.updatedAt) };
  });

  const from: BundleGenerator = bundle.generator ?? { name: 'unknown', version: 'pre-1.0' };
  return {
    pipeline,
    source: { formatVersion: sourceVersion, generator: from, exportedAt: bundle.exportedAt ?? '' },
    upgrades,
    warnings,
  };
}
