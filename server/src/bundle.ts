import { nanoid } from 'nanoid';
import { all, get, isoTime, newEntityId, NOW, run, tx, uniqueId } from './db.js';
import { convertDbtManifest, isDbtManifest, otherDbtArtifact } from './dbt.js';
import { layeredLayout, MARGIN, ROW_HEIGHT } from './layout.js';
import { hasPlaceholder, provenanceOf, readProvenance, templateKey } from './provenance.js';
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
    provenance_source: string; provenance_ref: string;
  }>('SELECT * FROM codes WHERE graph_id = ? ORDER BY x, y', graphId);

  // Provenance is written only where it is known: an absent key reads as
  // "unknown", which keeps a file that never used it byte-for-byte as before.
  const withProvenance = <T extends object>(record: T, row: { provenance_source: string; provenance_ref: string }) => {
    const provenance = provenanceOf(row);
    return provenance ? { ...record, provenance } : record;
  };

  const codes: BundleCode[] = codeRows.map((n) => withProvenance({
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
    assetLinks: all<{
      id: string; direction: Direction; path: string; detail: string; asset_id: string | null; position: number;
      provenance_source: string; provenance_ref: string;
    }>(
      `SELECT id, direction, path, detail, asset_id, position, provenance_source, provenance_ref
       FROM asset_links WHERE code_id = ? ORDER BY direction, position`,
      n.id,
    ).map((a) => withProvenance({
      direction: a.direction,
      path: a.path,
      detail: a.detail,
      tags: all<{ tag: string }>('SELECT tag FROM asset_link_tags WHERE asset_link_id = ? ORDER BY position, tag', a.id).map((t) => t.tag),
      assetRef: a.asset_id,
      position: a.position,
    }, a)),
  }, n));

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

export { bundleFilename } from './bundle-name.js';

/* ---------------------------------------------------------------- import */

export class BundleError extends Error {}

export interface ReadOptions {
  /** A dbt `catalog.json`, used only when the file is a dbt manifest. */
  catalog?: Record<string, any> | null;
  /**
   * Derive edges from the declarations as well as reading the listed ones: the
   * producer of every asset feeds every code that lists it as an input. An
   * asset with `producedBy: null` implies no edges, which is how a shared-state
   * table (a run registry, a log sink) stays documented without wiring every
   * writer to every reader.
   */
  relink?: boolean;
}

export interface ImportOptions extends ReadOptions {
  /** Replace this existing pipeline's contents, keeping its id. */
  replace?: string;
}

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
  8: {
    note: 'optional provenance added to codes and inputs/outputs; an older file simply has none',
    apply: (b) => ({ ...b, formatVersion: 9 }),
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Reads a file into the shape this build understands: gates the envelope,
 * upgrades it, then checks the contents.
 *
 * Three classes of outcome, deliberately kept apart:
 *
 *  - **Errors** throw `BundleError` and nothing is written. These are things
 *    that make the file meaningless: wrong format, a version from the future, a
 *    missing pipeline name, an edge pointing at a code that is not there.
 *  - **Warnings** are returned alongside a repaired bundle. These are things a
 *    hand-edited or foreign-tool file gets wrong in ways with an obvious, safe
 *    reading: a dangling asset reference, a duplicate edge, an edge that would
 *    close a cycle. The import still lands whole and the user is told what
 *    changed.
 *  - **Notes** say what was filled in because the file left it out on purpose:
 *    positions, `assetRef` resolved by path, `producedBy` resolved from the one
 *    code that outputs an asset, coordinates laid out, edges derived. A short
 *    file is a legitimate file, and none of that is a repair.
 *
 * The cycle check matters most. The graph is acyclic by construction everywhere
 * else in the app, and a file is the one way an edge could ever arrive without
 * passing `repo.addEdge`. Cycle-forming edges are dropped here with a warning,
 * matching how inferred links already behave, so a foreign file with one bad
 * arrow still imports instead of being refused outright.
 */
export function readBundle(input: unknown, options: ReadOptions = {}): BundleReadResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BundleError('That file is not a JSON object.');
  }

  // A dbt manifest is translated into a bundle first, then held to exactly the
  // same checks as any other file. Its summary and anything it left behind are
  // reported as warnings, so every caller that already shows those shows these.
  const other = otherDbtArtifact(input);
  if (other) {
    throw new BundleError(
      `That is a dbt ${other}.json. Import target/manifest.json instead${other === 'catalog' ? ', with this catalog alongside it for column types' : ''}.`,
    );
  }
  if (isDbtManifest(input)) {
    const { bundle, summary, notes } = convertDbtManifest(input, options.catalog);
    const read = readBundle(bundle, { relink: options.relink });
    return { ...read, converted: summary, warnings: [...notes, ...read.warnings] };
  }
  if (options.catalog) throw new BundleError('--catalog only applies when importing a dbt manifest.json.');

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
  const notes: string[] = [];

  if (!Array.isArray(bundle.codes) || !Array.isArray(bundle.edges) || !Array.isArray(bundle.assets)) {
    throw new BundleError('The file is missing its codes, edges or assets.');
  }
  if (!bundle.pipeline?.name) throw new BundleError('The file does not name its pipeline.');

  /* codes */
  const codeIds = new Set<string>();
  const codeName = new Map<string, string>();
  for (const code of bundle.codes) {
    if (!code.id || !code.name) throw new BundleError('Every code needs an id and a name.');
    if (codeIds.has(code.id)) throw new BundleError(`Duplicate code id in the file: ${code.id}`);
    codeIds.add(code.id);
    codeName.set(code.id, code.name);
    if (code.status && !STATUSES.includes(code.status)) {
      throw new BundleError(`Unknown status "${code.status}" on ${code.name}.`);
    }
    for (const link of code.assetLinks ?? []) {
      if (!DIRECTIONS.includes(link.direction)) {
        throw new BundleError(`An input/output on ${code.name} has an unknown direction "${link.direction}".`);
      }
    }

    // Position is the order within an array, so an omitted one *is* the index:
    // steps by their place, links by their place within their own direction.
    (code.steps ?? []).forEach((step, i) => { step.position ??= i; });
    const seenPerDirection = { input: 0, output: 0 };
    for (const link of code.assetLinks ?? []) link.position ??= seenPerDirection[link.direction]++;

    // An unreadable provenance is dropped with a warning, not refused: the
    // claim itself is still worth importing, only the evidence note is lost.
    const checkProvenance = (holder: { provenance?: unknown }, where: string) => {
      const { provenance, invalid } = readProvenance(holder.provenance);
      if (invalid) warnings.push(`Dropped the provenance on ${where}: ${invalid}.`);
      if (provenance) holder.provenance = provenance;
      else delete holder.provenance;
    };
    checkProvenance(code, `"${code.name}"`);
    for (const link of code.assetLinks ?? []) checkProvenance(link, `"${code.name}" ${link.direction} ${link.path}`);
  }

  /* assets */
  const assetIds = new Set<string>();
  const assetsByName = new Map<string, string[]>();
  const producerOmitted = new Set<string>();
  for (const asset of bundle.assets) {
    if (!asset.id || !asset.name) throw new BundleError('Every asset needs an id and a name.');
    if (assetIds.has(asset.id)) throw new BundleError(`Duplicate asset id in the file: ${asset.id}`);
    assetIds.add(asset.id);
    assetsByName.set(asset.name.trim(), [...(assetsByName.get(asset.name.trim()) ?? []), asset.id]);
    (asset.columns ?? []).forEach((column, i) => { column.position ??= i; });
    if (asset.producedBy === undefined) producerOmitted.add(asset.id);
    if (asset.producedBy && !codeIds.has(asset.producedBy)) {
      warnings.push(`Asset "${asset.name}" names a producer that is not in the file; it will import without one.`);
      asset.producedBy = null;
    }
  }

  // Asset names that differ only in how a placeholder is spelled — `<id>` on
  // one, `{run_id}` on the other — are almost always one thing written twice,
  // and exact matching would silently keep them apart.
  const assetsByTemplate = new Map<string, string[]>();
  for (const name of assetsByName.keys()) {
    if (!hasPlaceholder(name)) continue;
    assetsByTemplate.set(templateKey(name), [...(assetsByTemplate.get(templateKey(name)) ?? []), name]);
  }
  for (const names of assetsByTemplate.values()) {
    if (names.length > 1) {
      warnings.push(`Assets ${names.map((n) => `"${n}"`).join(' and ')} differ only in placeholder spelling — if they are the same path, use one spelling.`);
    }
  }

  /* asset links point at assets in the same file */
  let resolvedRefs = 0;
  for (const code of bundle.codes) {
    for (const link of code.assetLinks ?? []) {
      if (link.assetRef === undefined) {
        // Omitted, not null: resolve by name. `null` stays a deliberate
        // "undocumented path", so exported files round-trip unchanged.
        const matches = assetsByName.get(link.path?.trim() ?? '') ?? [];
        if (matches.length === 1) {
          link.assetRef = matches[0];
          resolvedRefs += 1;
        } else {
          link.assetRef = null;
          if (matches.length > 1) {
            warnings.push(`"${code.name}" ${link.direction} ${link.path} matches ${matches.length} assets of that name; set assetRef to choose one.`);
          } else if (hasPlaceholder(link.path ?? '')) {
            const near = assetsByTemplate.get(templateKey(link.path)) ?? [];
            if (near.length) {
              warnings.push(`"${code.name}" ${link.direction} ${link.path} matches no asset, but "${near[0]}" differs only in placeholder spelling.`);
            }
          }
        }
      } else if (link.assetRef && !assetIds.has(link.assetRef)) {
        warnings.push(`"${code.name}" points at asset "${link.assetRef}", which is not in the file; that input/output imports without a schema.`);
        link.assetRef = null;
      }
    }
  }
  if (resolvedRefs) notes.push(`resolved ${plural(resolvedRefs, 'assetRef')} by matching path to asset name`);

  /* producers: omitted means "whichever code outputs it", when that is one code */
  const writers = new Map<string, Set<string>>();
  for (const code of bundle.codes) {
    for (const link of code.assetLinks ?? []) {
      if (link.direction !== 'output' || !link.assetRef) continue;
      writers.set(link.assetRef, (writers.get(link.assetRef) ?? new Set()).add(code.id));
    }
  }
  let resolvedProducers = 0;
  for (const asset of bundle.assets) {
    if (!producerOmitted.has(asset.id)) continue;
    const by = [...(writers.get(asset.id) ?? [])];
    asset.producedBy = by.length === 1 ? by[0] : null;
    if (by.length === 1) resolvedProducers += 1;
    // Several writers is the shape of shared state — a run registry, a log
    // sink. Picking one would draw edges from an arbitrary writer to every
    // reader, so none is picked and the author is told how to choose.
    if (by.length > 1) {
      warnings.push(
        `Asset "${asset.name}" is output by ${by.length} codes, so it has no producer and implies no edges. ` +
          'Set producedBy to one of them if one really owns it, or producedBy: null to say so explicitly.',
      );
    }
  }
  if (resolvedProducers) notes.push(`resolved ${plural(resolvedProducers, 'producer')} from the one code that outputs each asset`);

  /* edges: every endpoint must exist, and the result must stay acyclic */
  const adjacency = new Map<string, string[]>();
  const kept: { source: string; target: string }[] = [];
  const seenPairs = new Set<string>();
  const accept = (source: string, target: string) => {
    seenPairs.add(`${source}\u0000${target}`);
    adjacency.set(source, [...(adjacency.get(source) ?? []), target]);
    kept.push({ source, target });
  };
  for (const edge of bundle.edges) {
    if (!codeIds.has(edge.source) || !codeIds.has(edge.target)) {
      throw new BundleError('An edge refers to a code that is not in the file.');
    }
    if (edge.source === edge.target) {
      warnings.push(`Skipped a link from "${edge.source}" to itself.`);
      continue;
    }
    if (seenPairs.has(`${edge.source}\u0000${edge.target}`)) {
      warnings.push(`Skipped a duplicate link ${edge.source} to ${edge.target}.`);
      continue;
    }
    if (reaches(edge.target, edge.source, adjacency)) {
      warnings.push(`Skipped link ${edge.source} to ${edge.target}: it would close a cycle, and the graph is kept acyclic.`);
      continue;
    }
    accept(edge.source, edge.target);
  }

  // Derived after the listed edges, so a hand-written edge always wins and a
  // derived one only fills in what the file did not already say.
  if (options.relink) {
    let derived = 0;
    for (const asset of bundle.assets) {
      if (!asset.producedBy) continue;
      for (const code of bundle.codes) {
        const reads = (code.assetLinks ?? []).some((l) => l.direction === 'input' && l.assetRef === asset.id);
        if (!reads || code.id === asset.producedBy || seenPairs.has(`${asset.producedBy}\u0000${code.id}`)) continue;
        if (reaches(code.id, asset.producedBy, adjacency)) {
          warnings.push(
            `Did not derive a link from "${codeName.get(asset.producedBy)}" to "${code.name}" through ${asset.name}: it would close a cycle. ` +
              'A cycle usually means an input or output is mis-declared.',
          );
          continue;
        }
        accept(asset.producedBy, code.id);
        derived += 1;
      }
    }
    notes.push(`derived ${plural(derived, 'edge')} from declared inputs and outputs`);
  }
  bundle.edges = kept;

  /* counts are a courtesy, not a contract: say so rather than refusing */
  const actual = { codes: bundle.codes.length, edges: bundle.edges.length, assets: bundle.assets.length };
  const declared = bundle.counts;
  if (declared && (declared.codes !== actual.codes || declared.assets !== actual.assets)) {
    warnings.push(
      `The file declares ${declared.codes} codes and ${declared.assets} assets but holds ${actual.codes} and ${actual.assets}. Importing what is actually there.`,
    );
  }
  bundle.counts = actual;

  /* codes with no position at all are laid out, below any that have one */
  const unplaced = bundle.codes.filter((c) => typeof c.x !== 'number' && typeof c.y !== 'number');
  if (unplaced.length) {
    const placed = bundle.codes.filter((c) => !unplaced.includes(c));
    const top = placed.length ? Math.max(...placed.map((c) => c.y ?? 0)) + ROW_HEIGHT : MARGIN;
    layeredLayout(unplaced, bundle.edges, top);
    notes.push(`laid out ${plural(unplaced.length, 'code')} that had no x/y`);
  }

  return { bundle, sourceVersion, upgrades, warnings, notes };
}

/**
 * Shorthand for callers that only want the bundle and are content for repairs to
 * be silent. Prefer `readBundle` anywhere the notes can be shown to a person.
 */
export function validateBundle(input: unknown): AtlasBundle {
  return readBundle(input).bundle;
}

/**
 * Writes a bundle in as a brand-new pipeline — or, with `replace`, in place of
 * an existing pipeline's contents. Ids inside the file are remapped either way,
 * so importing the same file twice gives two independent pipelines rather than
 * a collision, which is what makes a bundle safe to pass around.
 *
 * `replace` keeps the pipeline's id, so bookmarks and `?graph=` links survive an
 * edit → re-import → review loop. It is not a merge: everything the pipeline
 * held is replaced by what the file holds, and there is no conflict policy
 * because there is nothing to reconcile. It refuses a pipeline that does not
 * exist rather than quietly creating one under a typo.
 *
 * Everything below runs in one transaction, after `readBundle` has already had
 * the final say on the contents: an import lands whole or not at all.
 */
export function importBundle(input: unknown, nameOverride?: string, options: ImportOptions = {}): ImportResult {
  const { bundle, sourceVersion, upgrades, warnings, notes, converted } = readBundle(input, options);
  const name = (nameOverride?.trim() || bundle.pipeline.name).trim();

  const pipeline = tx(() => {
    let graphId: string;
    if (options.replace) {
      graphId = options.replace;
      if (!get('SELECT id FROM graphs WHERE id = ?', graphId)) {
        throw new BundleError(`There is no pipeline "${graphId}" to replace. Run \`lineage-atlas list\` for the ids, or import without --replace.`);
      }
      // Codes cascade to their tags, links, flows and edges; assets to columns.
      run('DELETE FROM codes WHERE graph_id = ?', graphId);
      run('DELETE FROM assets WHERE graph_id = ?', graphId);
      run(
        `UPDATE graphs SET name = ?, description = ?, updated_at = ${NOW} WHERE id = ?`,
        name, bundle.pipeline.description ?? '', graphId,
      );
    } else {
      graphId = uniqueId('graphs', name);
      run('INSERT INTO graphs (id, name, description) VALUES (?, ?, ?)', graphId, name, bundle.pipeline.description ?? '');
    }

    const codeIds = new Map<string, string>();
    for (const code of bundle.codes) {
      const id = newEntityId('codes');
      codeIds.set(code.id, id);
      // Stewardship travels with the record. An imported pipeline is a new
      // pipeline, but *when it was documented and by whom* is content, not a
      // database key: keeping it is what makes `export → import → export`
      // lossless in everything but ids. A file that names neither is dated now.
      run(
        `INSERT INTO codes (id, graph_id, name, x, y, description, owner, status, updated_by, created_at, updated_at, provenance_source, provenance_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, coalesce(?, ${NOW}), coalesce(?, ${NOW}), ?, ?)`,
        id, graphId, code.name, code.x ?? 0, code.y ?? 0,
        code.description ?? '', code.owner ?? '', normaliseStatus(code.status),
        code.updatedBy ?? '', code.createdAt || null, code.updatedAt || null,
        code.provenance?.source ?? '', code.provenance?.ref ?? '',
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
          newId(), id, column.name, column.dataType ?? 'varchar',
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
          `INSERT INTO asset_links (id, code_id, direction, path, detail, asset_id, position, provenance_source, provenance_ref)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          linkId, codeId, link.direction, link.path, link.detail ?? '',
          link.assetRef ? assetIds.get(link.assetRef) ?? null : null,
          link.position ?? 0,
          link.provenance?.source ?? '', link.provenance?.ref ?? '',
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
    notes,
    ...(converted ? { converted } : {}),
    ...(options.replace ? { replaced: true } : {}),
  };
}
