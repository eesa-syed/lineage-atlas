/**
 * Reads a dbt project into Atlas: `target/manifest.json` in, an `.atlas.json`
 * bundle out.
 *
 * This is a translator and nothing more. It writes no rows itself; the bundle
 * it returns goes through `readBundle` and `importBundle` like any other file,
 * so a dbt import gets the same validation, the same acyclicity check and the
 * same all-or-nothing transaction as a hand-written one.
 *
 * What maps to what:
 *
 *  - **Codes** — every model, seed, snapshot and source table, and every
 *    exposure. Tests, macros, analyses and metrics are not steps that read and
 *    write data, so they are not codes.
 *  - **Assets** — the relation each model, seed, snapshot and source lands in,
 *    with its documented columns. Ephemeral models have no relation and so no
 *    asset; their edges are still drawn.
 *  - **Edges** — `depends_on.nodes`, written out explicitly. Import never
 *    infers edges from a file, so a bundle without them would land as boxes.
 *  - **Column tests** — every generic test attached to a column, by name.
 *    `not_null` also makes the column non-nullable; `relationships` marks it a
 *    foreign key. Primary keys come only from declared constraints: a
 *    `unique` + `not_null` pair is the usual convention, but it is a guess, and
 *    a confident wrong PK badge is worse than none.
 *
 * Deliberately not carried: `raw_code` and `compiled_code`. A logic flow is
 * prose, never source (docs/FILE_FORMAT.md §6), so imported codes start with an
 * empty one and a link to the file that holds the SQL.
 *
 * `catalog.json` (from `dbt docs generate`) is optional. When given, it fills
 * in the real type of every column, including the ones nobody documented in
 * YAML — which is usually most of them.
 */
import { layeredLayout } from './layout.js';
import { normaliseTag } from './repo.js';
import { APP_NAME, APP_VERSION, BUNDLE_FORMAT, BUNDLE_VERSION } from './version.js';
import type { AtlasBundle, BundleAsset, BundleCode } from './types.js';

/* ---------------------------------------------------------------- detect */

type Json = Record<string, any>;

/** The artifact kind from `metadata.dbt_schema_version`, e.g. `manifest`, `catalog`. */
function dbtArtifactKind(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const version = (input as Json).metadata?.dbt_schema_version;
  if (typeof version !== 'string') return null;
  // https://schemas.getdbt.com/dbt/manifest/v12.json → "manifest"
  return version.match(/\/dbt\/([a-z-_]+)\/v\d+/)?.[1] ?? null;
}

export function isDbtManifest(input: unknown): input is Json {
  return dbtArtifactKind(input) === 'manifest' && typeof (input as Json).nodes === 'object';
}

/** A dbt artifact that is *not* a manifest — worth a specific message, since
 * `catalog.json` and `run_results.json` sit right next to the right file. */
export function otherDbtArtifact(input: unknown): string | null {
  const kind = dbtArtifactKind(input);
  return kind && kind !== 'manifest' ? kind : null;
}

/* --------------------------------------------------------------- convert */

export interface DbtConversion {
  bundle: AtlasBundle;
  /** One line describing what was read, for the CLI and the import toast. */
  summary: string;
  /** Things in the project that did not make it into the pipeline, and why. */
  notes: string[];
}

/** Resource types that become codes. */
const CODE_TYPES = new Set(['model', 'seed', 'snapshot']);

export function convertDbtManifest(manifest: Json, catalog?: Json | null): DbtConversion {
  const meta = manifest.metadata ?? {};
  const project: string = meta.project_name ?? '';
  const generatedAt = isoOrNow(meta.generated_at);
  const notes: string[] = [];

  const nodes: Json[] = Object.values(manifest.nodes ?? {});
  const sources: Json[] = Object.values(manifest.sources ?? {});
  const exposures: Json[] = Object.values(manifest.exposures ?? {});
  const groups: Json = manifest.groups ?? {};
  const catalogNodes: Json = { ...(catalog?.nodes ?? {}), ...(catalog?.sources ?? {}) };

  const steps = nodes.filter((n) => CODE_TYPES.has(n.resource_type));
  const tests = nodes.filter((n) => n.resource_type === 'test');
  const members = [...steps, ...sources, ...exposures];
  const byId = new Map<string, Json>(members.map((m) => [m.unique_id, m]));

  /* ------------------------------------------------ assets: one per relation */

  // Several nodes can describe the same table. The common case: a seed or an
  // upstream model builds `raw.customers`, and a source declares that very
  // table so staging can read it. That is one asset, produced by the node that
  // builds it and merely read by the source — two assets of one name would be
  // two producers of one table, which is the lie the app refuses everywhere.
  const byRelation = new Map<string, Json[]>();
  for (const n of [...steps, ...sources]) {
    const parts = relationParts(n);
    if (!parts) continue;
    const key = parts.join('.').toLowerCase();
    byRelation.set(key, [...(byRelation.get(key) ?? []), n]);
  }
  const shortNames = new Map<string, number>();
  for (const key of byRelation.keys()) {
    const short = key.split('.').slice(-2).join('.');
    shortNames.set(short, (shortNames.get(short) ?? 0) + 1);
  }

  const assetOf = new Map<string, BundleAsset>();
  for (const [key, group] of byRelation) {
    // Builders before declarations: whatever creates the table produces it.
    const [producer, ...others] = [...group].sort((a, b) => Number(a.resource_type === 'source') - Number(b.resource_type === 'source'));
    const parts = relationParts(producer)!;
    // `schema.table` reads like the rest of the app; the database only comes
    // back when two relations in different databases would otherwise collide.
    const name = shortNames.get(key.split('.').slice(-2).join('.'))! > 1 ? parts.join('.') : parts.slice(-2).join('.');
    let columns = columnsOf(producer, catalogNodes[producer.unique_id]);
    for (const other of others) columns = mergeColumns(columns, columnsOf(other, catalogNodes[other.unique_id]));
    const asset: BundleAsset = {
      id: producer.unique_id,
      name,
      materialization: materializationOf(producer),
      description: group.map((n) => n.description).find(Boolean) ?? '',
      owner: group.map((n) => ownerOf(n, groups)).find(Boolean) ?? '',
      createdAt: generatedAt,
      updatedAt: generatedAt,
      updatedBy: 'dbt',
      producedBy: producer.unique_id,
      columns,
    };
    for (const n of group) assetOf.set(n.unique_id, asset);
  }

  /* ------------------------------------------- tests onto their columns */

  let attachedTests = 0;
  let unattachedTests = 0;
  const refIndex = new Map<string, string>();
  for (const n of steps) refIndex.set(n.name, n.unique_id);

  for (const test of tests) {
    const target = test.attached_node ?? refFromKwargs(test.test_metadata?.kwargs?.model, refIndex);
    const column: unknown = test.column_name ?? test.test_metadata?.kwargs?.column_name;
    const asset = target ? assetOf.get(target) : undefined;
    const name: string = test.test_metadata?.name ?? '';
    if (!asset || typeof column !== 'string' || !name) {
      unattachedTests += 1;
      continue;
    }
    let col = asset.columns.find((c) => sameColumn(c.name, column));
    if (!col) {
      col = { name: column, dataType: '', keyKind: null, nullable: true, description: '', tests: [], position: asset.columns.length };
      asset.columns.push(col);
    }
    const label = test.test_metadata?.namespace ? `${test.test_metadata.namespace}.${name}` : name;
    if (!col.tests.includes(label)) col.tests.push(label);
    if (name === 'not_null') col.nullable = false;
    if (name === 'relationships' && !col.keyKind) col.keyKind = 'fk';
    attachedTests += 1;
  }

  /* ----------------------------------------------------------- codes */

  const codes: BundleCode[] = [];
  const edges: { source: string; target: string }[] = [];
  const edgeSeen = new Set<string>();
  const addEdge = (source: string, target: string) => {
    const key = `${source} ${target}`;
    if (source === target || edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edges.push({ source, target });
  };

  for (const m of members) {
    const parents: string[] = (m.depends_on?.nodes ?? []).filter((id: string) => byId.has(id));
    const links: BundleCode['assetLinks'] = [];

    parents.forEach((parentId, i) => {
      const parent = byId.get(parentId)!;
      const asset = assetOf.get(parentId);
      links.push({
        direction: 'input',
        path: asset?.name ?? parent.name,
        detail: parent.resource_type === 'source' ? 'source' : parent.resource_type === 'model' && !asset ? 'ephemeral model' : 'ref',
        tags: [],
        assetRef: asset?.id ?? null,
        position: i,
      });
      addEdge(parentId, m.unique_id);
    });

    const own = assetOf.get(m.unique_id);
    // A source over a table something else in the project builds: it reads
    // that table, and sits downstream of whatever builds it.
    if (own && own.producedBy !== m.unique_id) {
      links.push({ direction: 'input', path: own.name, detail: `built by ${byId.get(own.producedBy!)?.name ?? 'dbt'}`, tags: [], assetRef: own.id, position: links.length });
      addEdge(own.producedBy!, m.unique_id);
    }

    if (m.original_file_path && m.resource_type !== 'source' && m.resource_type !== 'exposure') {
      links.push({
        direction: 'input',
        path: m.original_file_path,
        detail: m.resource_type === 'seed' ? 'seed file' : (m.language ?? 'sql'),
        tags: [m.resource_type === 'seed' ? 'seed' : 'file'],
        assetRef: null,
        position: links.length,
      });
    }

    if (own && own.producedBy === m.unique_id) {
      links.push({
        direction: 'output',
        path: own.name,
        detail: m.resource_type === 'source' && m.loader ? `loaded by ${m.loader}` : own.materialization,
        tags: [],
        assetRef: own.id,
        position: 0,
      });
    } else if (m.resource_type === 'exposure' && m.url) {
      links.push({ direction: 'output', path: m.url, detail: m.label ?? '', tags: [m.type ?? 'exposure'], assetRef: null, position: 0 });
    }

    codes.push({
      id: m.unique_id,
      name: m.resource_type === 'source' ? `${m.source_name}.${m.name}` : m.name,
      x: 0,
      y: 0,
      description: m.description ?? '',
      owner: ownerOf(m, groups),
      status: 'active',
      createdAt: generatedAt,
      updatedAt: generatedAt,
      updatedBy: 'dbt',
      tags: tagsOf(m, project),
      steps: [],
      assetLinks: links,
    });
  }

  layeredLayout(codes, edges);
  const assets = [...new Set(assetOf.values())];

  /* ------------------------------------------------------------ notes */

  if (unattachedTests) {
    notes.push(`Skipped ${plural(unattachedTests, 'test')} not tied to a single column (singular and model-level tests have no column to sit on).`);
  }
  const skipped = countBy(nodes.filter((n) => !CODE_TYPES.has(n.resource_type) && n.resource_type !== 'test'), (n) => n.resource_type);
  const extras: [string, unknown][] = [
    ['metric', manifest.metrics],
    ['semantic model', manifest.semantic_models],
    ['saved query', manifest.saved_queries],
    ['unit test', manifest.unit_tests],
  ];
  for (const [label, record] of extras) {
    const count = record && typeof record === 'object' ? Object.keys(record).length : 0;
    if (count) skipped.set(label, count);
  }
  if (skipped.size) {
    notes.push(`Skipped ${[...skipped].map(([k, v]) => plural(v, k)).join(', ')}: they do not read or write data, so they are not steps in the graph.`);
  }

  const counted = countBy(members, (m) => m.resource_type);
  const summary =
    `dbt ${meta.dbt_version ?? ''} project "${project || 'unnamed'}": ` +
    [...counted].map(([k, v]) => plural(v, k)).join(', ') +
    `, ${plural(attachedTests, 'column test')}` +
    (catalog ? ', column types from catalog.json' : '');

  return {
    bundle: {
      format: BUNDLE_FORMAT,
      formatVersion: BUNDLE_VERSION,
      generator: { name: `${APP_NAME}/dbt`, version: APP_VERSION },
      exportedAt: new Date().toISOString(),
      counts: { codes: codes.length, edges: edges.length, assets: assets.length },
      pipeline: {
        name: project || 'dbt project',
        description: `Imported from a dbt ${meta.dbt_version ?? ''} manifest generated ${generatedAt.slice(0, 10)}.`.replace('  ', ' '),
      },
      codes,
      edges,
      assets,
    },
    summary: summary.replace('dbt  ', 'dbt '),
    notes,
  };
}

/* --------------------------------------------------------------- helpers */

/** `[database, schema, table]` for anything that lands in the warehouse. */
function relationParts(n: Json): string[] | null {
  if (n.resource_type === 'model' && n.config?.materialized === 'ephemeral') return null;
  const table = n.resource_type === 'source' ? (n.identifier ?? n.name) : (n.alias ?? n.name);
  if (!table || !n.schema) return null;
  return [n.database, n.schema, table].filter((p): p is string => typeof p === 'string' && p.length > 0);
}

function materializationOf(n: Json): string {
  if (n.resource_type === 'source') return 'source';
  if (n.resource_type === 'seed') return 'seed';
  if (n.resource_type === 'snapshot') return 'snapshot';
  return n.config?.materialized ?? 'view';
}

/** `meta.owner`, else the owner of the node's dbt group, else nobody. */
function ownerOf(n: Json, groups: Json): string {
  const fromMeta = n.meta?.owner ?? n.config?.meta?.owner ?? n.source_meta?.owner;
  if (typeof fromMeta === 'string' && fromMeta) return fromMeta;
  if (n.owner && typeof n.owner === 'object') return n.owner.name ?? n.owner.email ?? '';
  const group = n.group ? groups[`group.${n.package_name}.${n.group}`] : null;
  return group?.owner?.name ?? group?.owner?.email ?? '';
}

/**
 * The main tag decides a code's colour, so it should group codes the way a
 * reader of the project already does: by the folder a model lives in
 * (`staging`, `marts`), and by kind for everything else.
 */
function tagsOf(n: Json, project: string): string[] {
  const tags: string[] = [];
  switch (n.resource_type) {
    case 'model': {
      // fqn is [package, ...folders, name]
      const folders: string[] = (n.fqn ?? []).slice(1, -1);
      tags.push(folders[0] ?? 'model', ...folders.slice(1), n.language === 'python' ? 'python' : 'sql');
      break;
    }
    case 'source':
      tags.push('source', n.source_name);
      break;
    case 'exposure':
      tags.push('exposure', n.type);
      break;
    default:
      tags.push(n.resource_type);
  }
  tags.push(...(n.tags ?? []), ...(n.config?.tags ?? []));
  if (n.package_name && project && n.package_name !== project) tags.push(n.package_name);
  if (n.access && n.access !== 'protected') tags.push(n.access);
  return [...new Set(tags.filter((t) => typeof t === 'string').map(normaliseTag).filter(Boolean))];
}

function columnsOf(n: Json, catalogEntry: Json | undefined): BundleAsset['columns'] {
  const documented: Json[] = Object.values(n.columns ?? {});
  const pk = new Set<string>();
  for (const c of n.constraints ?? []) {
    if (c.type === 'primary_key') for (const col of c.columns ?? []) pk.add(String(col).toLowerCase());
  }

  const toColumn = (c: Json, position: number, catalogType?: string): BundleAsset['columns'][number] => {
    const constraints: string[] = (c.constraints ?? []).map((k: Json) => k.type);
    const isPk = pk.has(String(c.name).toLowerCase()) || constraints.includes('primary_key');
    return {
      name: c.name,
      dataType: (c.data_type || catalogType || '').toLowerCase(),
      keyKind: isPk ? 'pk' : constraints.includes('foreign_key') ? 'fk' : null,
      nullable: !(isPk || constraints.includes('not_null')),
      description: c.description ?? '',
      tests: [],
      position,
    };
  };

  const fromCatalog = (Object.values(catalogEntry?.columns ?? {}) as Json[]).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (!fromCatalog.length) return documented.map((c, i) => toColumn(c, i));

  // Warehouse order, documented descriptions: the catalog knows every column
  // and its real type, the YAML knows what the columns mean.
  const columns = fromCatalog.map((cat, i) => {
    const doc = documented.find((d) => sameColumn(d.name, cat.name));
    return toColumn({ ...(doc ?? {}), name: doc?.name ?? String(cat.name).toLowerCase() }, i, cat.type);
  });
  for (const doc of documented) {
    if (!columns.some((c) => sameColumn(c.name, doc.name))) columns.push(toColumn(doc, columns.length));
  }
  return columns;
}

/** The same table described twice (a seed and the source over it): the first
 * description's columns, with anything only the second knows filled in. */
function mergeColumns(into: BundleAsset['columns'], from: BundleAsset['columns']): BundleAsset['columns'] {
  const merged = into.map((c) => {
    const other = from.find((o) => sameColumn(o.name, c.name));
    if (!other) return c;
    return {
      ...c,
      dataType: c.dataType || other.dataType,
      keyKind: c.keyKind ?? other.keyKind,
      nullable: c.nullable && other.nullable,
      description: c.description || other.description,
    };
  });
  for (const other of from) {
    if (!merged.some((c) => sameColumn(c.name, other.name))) merged.push({ ...other, position: merged.length });
  }
  return merged;
}

/** Warehouses disagree about case (Snowflake shouts), YAML usually does not. */
function sameColumn(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Older manifests have no `attached_node`: `{{ get_where_subquery(ref('orders')) }}` → its model. */
function refFromKwargs(model: unknown, refIndex: Map<string, string>): string | undefined {
  if (typeof model !== 'string') return undefined;
  const name = model.match(/ref\(\s*['"]([^'"]+)['"]\s*\)/)?.[1];
  return name ? refIndex.get(name) : undefined;
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function plural(n: number, word: string): string {
  if (n === 1) return `1 ${word}`;
  return `${n} ${word.endsWith('s') ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`}`;
}

function isoOrNow(value: unknown): string {
  const date = typeof value === 'string' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : new Date().toISOString();
}
