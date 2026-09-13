import { nanoid } from 'nanoid';
import { all, get, isoTime, newEntityId, NOW, run, touch, touchAsset, tx, uniqueId } from './db.js';
import type { SchemaTable, Asset, AssetColumn, AssetLink, AssetLinkInput, AssetSchemaInput, AssetSummary, Code, CodeFlow, CodeRef, CodeStatus, FlowInput, Graph, GraphEdge, Pipeline, Stewardship, StewardshipPatch } from './types.js';

const newId = () => nanoid(12);

interface CodeRow {
  id: string; name: string; x: number; y: number; description: string;
  owner: string; status: 'active' | 'inactive';
  updated_by: string; created_at: string; updated_at: string;
}

/** The four stewardship fields, read off any row that carries them. */
function stewardship(row: { owner: string; updated_by: string; created_at: string; updated_at: string }): Stewardship {
  return {
    owner: row.owner,
    createdAt: isoTime(row.created_at),
    updatedAt: isoTime(row.updated_at),
    updatedBy: row.updated_by,
  };
}
interface AssetLinkRow {
  id: string; code_id: string; direction: 'input' | 'output';
  path: string; detail: string; asset_id: string | null; position: number;
}

/* ------------------------------------------------------------------ reads */

export function getGraph(graphId: string): Graph {
  const rows = all<CodeRow>('SELECT * FROM codes WHERE graph_id = ? ORDER BY x, y', graphId);
  const tags = all<{ code_id: string; tag: string }>(
    `SELECT t.code_id, t.tag FROM code_tags t JOIN codes c ON c.id = t.code_id
     WHERE c.graph_id = ? ORDER BY t.position, t.tag`,
    graphId,
  );
  const links = all<AssetLinkRow>(
    'SELECT a.* FROM asset_links a JOIN codes c ON c.id = a.code_id WHERE c.graph_id = ? ORDER BY a.direction, a.position',
    graphId,
  );
  const linkTags = all<{ asset_link_id: string; tag: string }>(
    `SELECT lt.asset_link_id, lt.tag FROM asset_link_tags lt
     JOIN asset_links a ON a.id = lt.asset_link_id JOIN codes c ON c.id = a.code_id
     WHERE c.graph_id = ? ORDER BY lt.position, lt.tag`,
    graphId,
  );
  const flowCounts = all<{ code_id: string; n: number }>(
    'SELECT f.code_id, count(*) AS n FROM flow_steps f JOIN codes c ON c.id = f.code_id WHERE c.graph_id = ? GROUP BY f.code_id',
    graphId,
  );
  // Column names are folded into each code's search terms so that searching for
  // a column finds the model that produces it, not only the asset page.
  const columns = all<{ code_id: string; name: string }>(`
    SELECT a.code_id AS code_id, c.name AS name
    FROM asset_columns c JOIN assets a ON a.id = c.asset_id
    WHERE a.code_id IS NOT NULL AND a.graph_id = ?
  `, graphId);
  // Logic-step titles and bodies are folded in too, so searching for what a
  // code actually does ("dedupe on order_id") finds it without opening the flow tab.
  const flowSteps = all<{ code_id: string; title: string; body: string }>(`
    SELECT f.code_id AS code_id, f.title AS title, f.body AS body
    FROM flow_steps f JOIN codes c ON c.id = f.code_id
    WHERE c.graph_id = ?
  `, graphId);

  const tagsBy = group(tags, (t) => t.code_id, (t) => t.tag);
  const linkTagsBy = group(linkTags, (t) => t.asset_link_id, (t) => t.tag);
  const colsBy = group(columns, (c) => c.code_id, (c) => c.name);
  const flowTextBy = group(flowSteps, (f) => f.code_id, (f) => `${f.title} ${f.body}`);
  const withFlow = new Set(flowCounts.filter((f) => f.n > 0).map((f) => f.code_id));
  const linksBy = group(links, (a) => a.code_id, (a) => a);

  const toAssetLink = (a: AssetLinkRow): AssetLink => ({
    id: a.id, direction: a.direction, path: a.path,
    detail: a.detail, tags: linkTagsBy.get(a.id) ?? [], assetId: a.asset_id, position: a.position,
  });

  const codes: Code[] = rows.map((r) => {
    const mine = linksBy.get(r.id) ?? [];
    const outputs = mine.filter((a) => a.direction === 'output').map(toAssetLink);
    return {
      id: r.id, name: r.name, x: r.x, y: r.y,
      description: r.description, status: r.status,
      ...stewardship(r),
      tags: tagsBy.get(r.id) ?? [],
      inputs: mine.filter((a) => a.direction === 'input').map(toAssetLink),
      outputs,
      assetId: outputs.find((a) => a.assetId)?.assetId ?? null,
      hasFlow: withFlow.has(r.id),
      searchTerms: [...(colsBy.get(r.id) ?? []), ...(flowTextBy.get(r.id) ?? [])],
    };
  });

  return {
    codes,
    edges: all<GraphEdge>(
      'SELECT e.id, e.source, e.target FROM edges e JOIN codes c ON c.id = e.source WHERE c.graph_id = ?',
      graphId,
    ),
  };
}

export function getFlow(codeId: string): CodeFlow | null {
  const code = get<CodeRow>('SELECT * FROM codes WHERE id = ?', codeId);
  if (!code) return null;
  return {
    codeId: code.id,
    name: code.name,
    steps: all<CodeFlow['steps'][number]>(
      `SELECT id, position, op, title, body
       FROM flow_steps WHERE code_id = ? ORDER BY position`,
      codeId,
    ),
  };
}

export function getAsset(assetId: string): Asset | null {
  const asset = get<{
    id: string; name: string; code_id: string | null; materialization: string; description: string;
    owner: string; updated_by: string; created_at: string; updated_at: string;
  }>('SELECT * FROM assets WHERE id = ?', assetId);
  if (!asset) return null;

  const columns = all<{
    id: string; name: string; data_type: string; key_kind: 'pk' | 'fk' | null;
    nullable: number; description: string; tests: string; position: number;
  }>(
    `SELECT id, name, data_type, key_kind, nullable, description, tests, position
     FROM asset_columns WHERE asset_id = ? ORDER BY position`,
    assetId,
  ).map<AssetColumn>((c) => ({
    id: c.id, name: c.name, dataType: c.data_type, keyKind: c.key_kind,
    nullable: !!c.nullable, description: c.description,
    tests: c.tests ? c.tests.split(',').map((t) => t.trim()).filter(Boolean) : [],
    position: c.position,
  }));

  const producer = asset.code_id
    ? get<{ id: string; name: string }>(
        'SELECT id, name FROM codes WHERE id = ?',
        asset.code_id,
      ) ?? null
    : null;

  // Anything that lists this asset as an input consumes it.
  const consumedBy = all<{ id: string; name: string }>(
    `SELECT DISTINCT c.id, c.name
     FROM asset_links a JOIN codes c ON c.id = a.code_id
     WHERE a.asset_id = ? AND a.direction = 'input'
     ORDER BY c.name`,
    assetId,
  ).map<CodeRef>((n) => ({ ...n, tags: tagsOf(n.id) }));

  const tags = producer
    ? all<{ tag: string }>('SELECT tag FROM code_tags WHERE code_id = ?', producer.id).map((t) => t.tag)
    : [];

  return {
    id: asset.id, name: asset.name, codeId: asset.code_id,
    materialization: asset.materialization, description: asset.description,
    ...stewardship(asset),
    columns,
    producedBy: producer ? { id: producer.id, name: producer.name, tags: tagsOf(producer.id) } : null,
    consumedBy,
    certified: tags.includes('certified'),
    containsPii: tags.includes('pii'),
  };
}

/**
 * Every asset in a pipeline with its full column list, for the Schema tab: one
 * call instead of one `getAsset` per table. Reuses `getAsset`, so a table here
 * and on its schema page can never disagree about producer, readers or badges.
 */
export function getSchemaTables(graphId: string): SchemaTable[] {
  const tables: SchemaTable[] = [];
  for (const { id } of all<{ id: string }>('SELECT id FROM assets WHERE graph_id = ? ORDER BY name', graphId)) {
    const asset = getAsset(id);
    if (asset) tables.push(asset);
  }
  return tables;
}

export function listTags(graphId: string): { tag: string; count: number }[] {
  return all<{ tag: string; count: number }>(
    `SELECT t.tag AS tag, count(*) AS count
     FROM code_tags t JOIN codes c ON c.id = t.code_id
     WHERE c.graph_id = ? GROUP BY t.tag ORDER BY t.tag`,
    graphId,
  );
}

/* -------------------------------------------------------------- mutations */

const STATUSES: CodeStatus[] = ['active', 'inactive'];

export interface CodePatch extends StewardshipPatch {
  name?: string;
  description?: string;
  status?: CodeStatus;
  x?: number;
  y?: number;
}

/**
 * A timestamp on its way in from a client. Accepts anything `Date` can parse —
 * an ISO string, with or without a zone — and stores it in the one form this
 * database uses. Refuses the rest rather than writing a string that will read
 * back as `Invalid Date` forever.
 */
function stamp(value: string, field: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw new ConflictError(`"${value}" is not a date that ${field} can hold.`);
  return `${at.toISOString().slice(0, 19)}Z`;
}

/**
 * Collects the automatic half of a write: `updatedAt` moves to now and
 * `updatedBy` becomes the actor — **unless the patch names either explicitly**,
 * in which case the explicit value stands for this write. Without that
 * exception, hand-editing `updatedAt` would be impossible: the very save
 * carrying the new value would stamp over it a line later.
 */
function stewardshipWrite(patch: StewardshipPatch, actor: string, fields: string[], values: (string | number)[]): void {
  if (patch.createdAt !== undefined) { fields.push('created_at = ?'); values.push(stamp(patch.createdAt, 'createdAt')); }

  if (patch.updatedAt !== undefined) { fields.push('updated_at = ?'); values.push(stamp(patch.updatedAt, 'updatedAt')); }
  else fields.push(`updated_at = ${NOW}`);

  fields.push('updated_by = ?');
  values.push(patch.updatedBy !== undefined ? patch.updatedBy.trim() : actor);
}

export function updateCode(codeId: string, patch: CodePatch, actor: string): Code | null {
  const fields: string[] = [];
  const values: (string | number)[] = [];
  const set = (column: string, value: string | number) => { fields.push(`${column} = ?`); values.push(value); };

  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw new ConflictError('A code needs a name.');
    set('name', name);
  }
  if (patch.description !== undefined) set('description', String(patch.description));
  if (patch.owner !== undefined) set('owner', String(patch.owner).trim());
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw new ConflictError(`Unknown status "${patch.status}".`);
    set('status', patch.status);
  }
  if (patch.x !== undefined) set('x', Number(patch.x));
  if (patch.y !== undefined) set('y', Number(patch.y));

  // Nothing asked for means nothing written — an empty PATCH must not count as
  // an edit and move the record's dates.
  const asked = fields.length > 0 || patch.createdAt !== undefined || patch.updatedAt !== undefined || patch.updatedBy !== undefined;
  if (!asked) return findCode(codeId);

  stewardshipWrite(patch, actor, fields, values);
  run(`UPDATE codes SET ${fields.join(', ')} WHERE id = ?`, ...values, codeId);
  return findCode(codeId);
}

/**
 * What a write moved, for the responses that hand back something smaller than
 * a whole `Code` — the tag routes. Without it a client has no way to learn the
 * new `updatedAt`/`updatedBy` short of reloading the graph, and the panel it
 * just edited would go on showing the previous editor.
 */
export function stewardshipOf(codeId: string): { updatedAt: string; updatedBy: string } {
  const row = get<{ updated_at: string; updated_by: string }>(
    'SELECT updated_at, updated_by FROM codes WHERE id = ?',
    codeId,
  );
  return { updatedAt: isoTime(row?.updated_at), updatedBy: row?.updated_by ?? '' };
}

export function normaliseTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\-.]/g, '');
}

export function addTag(codeId: string, tag: string, actor: string): string[] {
  const clean = normaliseTag(tag);
  if (clean) {
    const next = (get<{ n: number | null }>('SELECT max(position) AS n FROM code_tags WHERE code_id = ?', codeId)?.n ?? -1) + 1;
    run('INSERT OR IGNORE INTO code_tags (code_id, tag, position) VALUES (?, ?, ?)', codeId, clean, next);
    touch(codeId, actor);
  }
  return tagsOf(codeId);
}

/** Promotes a tag to first, which is what decides the code's colour and badge. */
export function setPrimaryTag(codeId: string, tag: string, actor: string): string[] {
  const lowest = get<{ n: number | null }>('SELECT min(position) AS n FROM code_tags WHERE code_id = ?', codeId)?.n ?? 0;
  run('UPDATE code_tags SET position = ? WHERE code_id = ? AND tag = ?', lowest - 1, codeId, tag);
  touch(codeId, actor);
  return tagsOf(codeId);
}

export function removeTag(codeId: string, tag: string, actor: string): string[] {
  run('DELETE FROM code_tags WHERE code_id = ? AND tag = ?', codeId, tag);
  touch(codeId, actor);
  return tagsOf(codeId);
}

export class ConflictError extends Error {}

export function addEdge(source: string, target: string, actor: string): GraphEdge {
  if (source === target) throw new ConflictError('A code cannot depend on itself.');
  const from = get<{ graph_id: string }>('SELECT graph_id FROM codes WHERE id = ?', source);
  const to = get<{ graph_id: string }>('SELECT graph_id FROM codes WHERE id = ?', target);
  if (!from || !to) throw new ConflictError('Both codes must exist.');
  if (from.graph_id !== to.graph_id) throw new ConflictError('Codes in different pipelines cannot be connected.');
  if (get('SELECT id FROM edges WHERE source = ? AND target = ?', source, target)) {
    throw new ConflictError('That edge already exists.');
  }
  if (createsCycle(source, target)) {
    throw new ConflictError('That edge would create a cycle — the graph must stay acyclic.');
  }
  const edge: GraphEdge = { id: newId(), source, target };
  run('INSERT INTO edges (id, source, target) VALUES (?, ?, ?)', edge.id, edge.source, edge.target);
  // A hand-drawn arrow is an edit to what both codes claim about their
  // dependencies, so both records record who drew it. Edges inferred from
  // asset links are not stamped here: the declaration that implied them
  // already stamped the code that made it.
  touch(source, actor);
  touch(target, actor);
  return edge;
}

export function removeEdge(edgeId: string, actor: string): void {
  const edge = get<{ source: string; target: string }>('SELECT source, target FROM edges WHERE id = ?', edgeId);
  run('DELETE FROM edges WHERE id = ?', edgeId);
  if (edge) {
    touch(edge.source, actor);
    touch(edge.target, actor);
  }
}

/** Walking forward from `target` must never reach `source`, or the graph stops being a DAG. */
function createsCycle(source: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const row of all<{ target: string }>('SELECT target FROM edges WHERE source = ?', current)) {
      stack.push(row.target);
    }
  }
  return false;
}

export function duplicateCode(codeId: string, withInputs: boolean, actor: string): Code | null {
  const original = get<CodeRow>('SELECT id, name FROM codes WHERE id = ?', codeId);
  if (!original) return null;

  // The copy is its own row with its own id; only the name carries the "_copy"
  // marker, counting up until it is free in this pipeline.
  let suffix = 1;
  let copyName = `${original.name}_copy`;
  while (get('SELECT id FROM codes WHERE graph_id = (SELECT graph_id FROM codes WHERE id = ?) AND name = ?', codeId, copyName)) {
    suffix += 1;
    copyName = `${original.name}_copy_${suffix}`;
  }
  const copyId = newEntityId('codes');

  tx(() => {
    // The copy inherits the original's owner but not its dates: it is a new
    // record, created now, by whoever pressed duplicate.
    run(
      `INSERT INTO codes (id, graph_id, name, x, y, description, owner, status, updated_by)
       SELECT ?, graph_id, ?, x + 40, y + 134, description, owner, status, ?
       FROM codes WHERE id = ?`,
      copyId, copyName, actor, codeId,
    );

    run('INSERT INTO code_tags (code_id, tag, position) SELECT ?, tag, position FROM code_tags WHERE code_id = ?', copyId, codeId);
    // A copy is a draft until someone reviews it — that is what the tag records.
    run(
      "INSERT OR IGNORE INTO code_tags (code_id, tag, position) SELECT ?, 'draft', coalesce(max(position), -1) + 1 FROM code_tags WHERE code_id = ?",
      copyId, copyId,
    );

    // Asset links are copied, but the copy does not claim ownership of the
    // original's asset — two codes producing one table would be a lie.
    run(
      `INSERT INTO asset_links (id, code_id, direction, path, detail, asset_id, position)
       SELECT lower(hex(randomblob(6))), ?, direction, path, detail,
              CASE WHEN direction = 'input' THEN asset_id ELSE NULL END, position
       FROM asset_links WHERE code_id = ?`,
      copyId, codeId,
    );
    run(
      `INSERT INTO asset_link_tags (asset_link_id, tag, position)
       SELECT new_link.id, lt.tag, lt.position
       FROM asset_links old_link
       JOIN asset_links new_link
         ON new_link.code_id = ? AND new_link.direction = old_link.direction
        AND new_link.position = old_link.position AND new_link.path = old_link.path
       JOIN asset_link_tags lt ON lt.asset_link_id = old_link.id
       WHERE old_link.code_id = ?`,
      copyId, codeId,
    );

    run(
      `INSERT INTO flow_steps (id, code_id, position, op, title, body)
       SELECT lower(hex(randomblob(6))), ?, position, op, title, body
       FROM flow_steps WHERE code_id = ?`,
      copyId, codeId,
    );

    if (withInputs) {
      run(
        `INSERT OR IGNORE INTO edges (id, source, target)
         SELECT lower(hex(randomblob(6))), source, ? FROM edges WHERE target = ?`,
        copyId, codeId,
      );
    }
  });

  return findCode(copyId);
}

export function createCode(
  graphId: string,
  input: { name: string; tags?: string[]; x: number; y: number; description?: string; owner?: string },
  actor: string,
): Code | null {
  const codeId = newEntityId('codes');
  const tags = (input.tags ?? []).map(normaliseTag).filter(Boolean);
  tx(() => {
    run(
      `INSERT INTO codes (id, graph_id, name, x, y, description, owner, status, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      codeId, graphId, input.name.trim(), input.x, input.y, input.description ?? '', input.owner ?? '', actor,
    );
    // Order is meaningful — the first tag the user picked becomes the primary.
    const chosen = tags.length ? tags : ['draft'];
    chosen.forEach((tag, i) => {
      run('INSERT OR IGNORE INTO code_tags (code_id, tag, position) VALUES (?, ?, ?)', codeId, tag, i);
    });
  });
  return findCode(codeId);
}

export function deleteCode(codeId: string): void {
  run('DELETE FROM codes WHERE id = ?', codeId);
}

/* ----------------------------------------------------------------- helpers */

function findCode(codeId: string): Code | null {
  const owner = get<{ graph_id: string }>('SELECT graph_id FROM codes WHERE id = ?', codeId);
  return owner ? getGraph(owner.graph_id).codes.find((n) => n.id === codeId) ?? null : null;
}

/** The pipeline a code belongs to — the client needs it to route after a mutation. */
export function graphIdOfCode(codeId: string): string | null {
  return get<{ graph_id: string }>('SELECT graph_id FROM codes WHERE id = ?', codeId)?.graph_id ?? null;
}

function tagsOf(codeId: string): string[] {
  return all<{ tag: string }>('SELECT tag FROM code_tags WHERE code_id = ? ORDER BY position, tag', codeId).map((t) => t.tag);
}

function group<T, V>(rows: T[], key: (row: T) => string, value: (row: T) => V): Map<string, V[]> {
  const out = new Map<string, V[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k) ?? [];
    list.push(value(row));
    out.set(k, list);
  }
  return out;
}

/* -------------------------------------------------------------- pipelines */

export function listPipelines(): Pipeline[] {
  return all<Pipeline>(`
    SELECT g.id, g.name, g.description,
           (SELECT count(*) FROM codes c WHERE c.graph_id = g.id) AS codeCount,
           (SELECT count(*) FROM edges e JOIN codes c ON c.id = e.source WHERE c.graph_id = g.id) AS edgeCount,
           g.created_at AS createdAt, g.updated_at AS updatedAt
    FROM graphs g ORDER BY g.created_at
  `).map((p) => ({ ...p, createdAt: isoTime(p.createdAt), updatedAt: isoTime(p.updatedAt) }));
}

export function getPipeline(graphId: string): Pipeline | null {
  return listPipelines().find((p) => p.id === graphId) ?? null;
}

export function createPipeline(name: string, description = ''): Pipeline {
  const trimmed = name.trim();
  if (!trimmed) throw new ConflictError('A pipeline needs a name.');
  const graphId = uniqueId('graphs', trimmed);
  run('INSERT INTO graphs (id, name, description) VALUES (?, ?, ?)', graphId, trimmed, description);
  return getPipeline(graphId)!;
}

export function updatePipeline(graphId: string, patch: { name?: string; description?: string }): Pipeline | null {
  const fields: string[] = [];
  const values: (string | number)[] = [];
  if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name.trim()); }
  if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
  if (fields.length) {
    run(`UPDATE graphs SET ${fields.join(', ')}, updated_at = ${NOW} WHERE id = ?`, ...values, graphId);
  }
  return getPipeline(graphId);
}

export function deletePipeline(graphId: string): void {
  if (listPipelines().length <= 1) throw new ConflictError('The last pipeline cannot be deleted.');
  // Codes cascade, and their tags, asset links, edges and flow steps cascade in turn.
  run('DELETE FROM graphs WHERE id = ?', graphId);
}

export function touchPipeline(graphId: string): void {
  run(`UPDATE graphs SET updated_at = ${NOW} WHERE id = ?`, graphId);
}

/* ---------------------------------------------------------------- assets */

/**
 * An asset link that opts into being "documented" is identified by its path
 * as the asset's name, and the asset record is created on demand. This is
 * what makes a freshly typed output immediately openable as a schema page
 * instead of sitting there unlinked.
 *
 * An `output` claims production of the asset; an `input` only references it.
 */
function resolveAsset(codeId: string, name: string, direction: 'input' | 'output', actor: string): string {
  const code = get<{ graph_id: string; owner: string }>('SELECT graph_id, owner FROM codes WHERE id = ?', codeId);
  if (!code?.graph_id) throw new ConflictError('That code does not exist.');

  const clean = name.trim();
  const existing = get<{ id: string; code_id: string | null }>(
    'SELECT id, code_id FROM assets WHERE graph_id = ? AND name = ?',
    code.graph_id, clean,
  );

  if (existing) {
    // The first code to declare it as an output becomes its producer — and,
    // since nobody had claimed the table before, the owner of record too.
    if (direction === 'output' && !existing.code_id) {
      run(
        `UPDATE assets SET code_id = ?, owner = CASE WHEN owner = '' THEN ? ELSE owner END,
                           updated_at = ${NOW}, updated_by = ? WHERE id = ?`,
        codeId, code.owner, actor, existing.id,
      );
    }
    return existing.id;
  }

  // An asset that comes into being as the output of a code starts out
  // answerable to whoever is answerable for that code.
  const assetId = newEntityId('assets');
  run(
    'INSERT INTO assets (id, graph_id, name, code_id, materialization, description, owner, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    assetId, code.graph_id, clean, direction === 'output' ? codeId : null, 'table', '',
    direction === 'output' ? code.owner : '', actor,
  );
  return assetId;
}

/**
 * Draws the edges implied by data flow: whoever produces an asset feeds
 * everyone who consumes it. Edges that would close a cycle are skipped rather
 * than failing the write — the declaration is still correct, only the arrow is
 * omitted. Returns how many edges were created.
 */
export function linkEdgesForAsset(assetId: string): number {
  const asset = get<{ code_id: string | null }>('SELECT code_id FROM assets WHERE id = ?', assetId);
  const producer = asset?.code_id;
  if (!producer) return 0;

  let created = 0;
  const consumers = all<{ code_id: string }>(
    "SELECT DISTINCT code_id FROM asset_links WHERE asset_id = ? AND direction = 'input'",
    assetId,
  );
  for (const { code_id: consumer } of consumers) {
    if (consumer === producer) continue;
    if (get('SELECT id FROM edges WHERE source = ? AND target = ?', producer, consumer)) continue;
    if (createsCycle(producer, consumer)) continue;
    run('INSERT OR IGNORE INTO edges (id, source, target) VALUES (?, ?, ?)', newId(), producer, consumer);
    created += 1;
  }
  return created;
}

export interface AssetLinkResult {
  code: Code | null;
  assetId: string | null;
  edgesCreated: number;
}

function setAssetLinkTags(assetLinkId: string, tags: string[]): void {
  run('DELETE FROM asset_link_tags WHERE asset_link_id = ?', assetLinkId);
  tags.map(normaliseTag).filter(Boolean).forEach((tag, i) => {
    run('INSERT OR IGNORE INTO asset_link_tags (asset_link_id, tag, position) VALUES (?, ?, ?)', assetLinkId, tag, i);
  });
}

export function addAssetLink(codeId: string, input: AssetLinkInput, actor: string): AssetLinkResult {
  if (!input.path?.trim()) throw new ConflictError('An input or output needs a path.');
  const path = input.path.trim();

  const assetId = input.documented ? resolveAsset(codeId, path, input.direction, actor) : null;
  const next =
    (get<{ n: number | null }>('SELECT max(position) AS n FROM asset_links WHERE code_id = ? AND direction = ?', codeId, input.direction)?.n ?? -1) + 1;
  const linkId = newId();
  run(
    'INSERT INTO asset_links (id, code_id, direction, path, detail, asset_id, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    linkId, codeId, input.direction, path, input.detail ?? '', assetId, next,
  );
  setAssetLinkTags(linkId, input.tags ?? []);
  touch(codeId, actor);

  return {
    code: findCode(codeId),
    assetId,
    edgesCreated: assetId ? linkEdgesForAsset(assetId) : 0,
  };
}

export function updateAssetLink(assetLinkId: string, patch: Partial<AssetLinkInput>, actor: string): AssetLinkResult | null {
  const existing = get<{ code_id: string; path: string; direction: 'input' | 'output'; asset_id: string | null }>(
    'SELECT code_id, path, direction, asset_id FROM asset_links WHERE id = ?',
    assetLinkId,
  );
  if (!existing) return null;

  const path = (patch.path ?? existing.path).trim();
  const direction = patch.direction ?? existing.direction;
  const documented = patch.documented ?? !!existing.asset_id;
  const assetId = documented ? resolveAsset(existing.code_id, path, direction, actor) : null;

  const fields: string[] = ['path = ?', 'direction = ?', 'asset_id = ?'];
  const values: (string | number | null)[] = [path, direction, assetId];
  if (patch.detail !== undefined) { fields.push('detail = ?'); values.push(patch.detail); }
  run(`UPDATE asset_links SET ${fields.join(', ')} WHERE id = ?`, ...values, assetLinkId);

  if (patch.tags !== undefined) setAssetLinkTags(assetLinkId, patch.tags);

  touch(existing.code_id, actor);
  return {
    code: findCode(existing.code_id),
    assetId,
    edgesCreated: assetId ? linkEdgesForAsset(assetId) : 0,
  };
}

/** Re-derives every edge implied by the pipeline's declared inputs and outputs. */
export function relinkPipeline(graphId: string): number {
  const assets = all<{ id: string }>('SELECT id FROM assets WHERE graph_id = ?', graphId);
  return assets.reduce((total, d) => total + linkEdgesForAsset(d.id), 0);
}

/** Replaces an asset's documented schema wholesale, like saveFlow does for logic. */
export function saveAssetSchema(assetId: string, input: AssetSchemaInput, actor: string): Asset | null {
  const existing = get<{ graph_id: string; name: string }>('SELECT graph_id, name FROM assets WHERE id = ?', assetId);
  if (!existing) return null;

  tx(() => {
    // Everything optional is left alone when omitted: a client that does not
    // offer a field must not silently blank it.
    const fields = ['materialization = ?', 'description = ?'];
    const values: (string | number)[] = [input.materialization || 'table', input.description ?? ''];

    if (input.name !== undefined) renameAsset(assetId, existing, input.name, fields, values, actor);
    if (input.owner !== undefined) { fields.push('owner = ?'); values.push(input.owner.trim()); }
    stewardshipWrite(input, actor, fields, values);

    run(`UPDATE assets SET ${fields.join(', ')} WHERE id = ?`, ...values, assetId);
    run('DELETE FROM asset_columns WHERE asset_id = ?', assetId);
    input.columns.forEach((column, i) => {
      if (!column.name?.trim()) return;
      run(
        `INSERT INTO asset_columns (id, asset_id, name, data_type, key_kind, nullable, description, tests, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(), assetId, column.name.trim(), column.dataType?.trim() || 'varchar',
        column.keyKind === 'pk' || column.keyKind === 'fk' ? column.keyKind : null,
        column.nullable ? 1 : 0, column.description ?? '',
        (column.tests ?? []).map((t) => t.trim()).filter(Boolean).join(', '), i,
      );
    });

  });

  return getAsset(assetId);
}

/**
 * Renames an asset, and carries every declaration that named it.
 *
 * A link stores both an `asset_id` and the `path` it was written as, and the
 * path is what the code's page displays — leave it behind and a code claims to
 * write `analytics.orders` while the schema page it opens is called something
 * else. Worse, `resolveAsset` matches an incoming path against asset *names*,
 * so the next time anyone re-saved that link the old name would resolve to
 * nothing and quietly create a second, empty asset beside the real one.
 *
 * The codes holding those links are touched too: what they declare changed,
 * even though nobody opened them.
 */
function renameAsset(
  assetId: string,
  existing: { graph_id: string; name: string },
  requested: string,
  fields: string[],
  values: (string | number)[],
  actor: string,
): void {
  const name = requested.trim();
  if (!name) throw new ConflictError('An asset needs a name.');
  if (name === existing.name) return;
  if (get('SELECT id FROM assets WHERE graph_id = ? AND name = ? AND id <> ?', existing.graph_id, name, assetId)) {
    throw new ConflictError(`This pipeline already documents an asset called ${name}.`);
  }

  fields.push('name = ?');
  values.push(name);

  for (const link of all<{ code_id: string }>('SELECT DISTINCT code_id FROM asset_links WHERE asset_id = ?', assetId)) {
    touch(link.code_id, actor);
  }
  run('UPDATE asset_links SET path = ? WHERE asset_id = ?', name, assetId);
}

export function deleteAssetLink(assetLinkId: string, actor: string): Code | null {
  const existing = get<{ code_id: string }>('SELECT code_id FROM asset_links WHERE id = ?', assetLinkId);
  if (!existing) return null;
  run('DELETE FROM asset_links WHERE id = ?', assetLinkId);
  touch(existing.code_id, actor);
  return findCode(existing.code_id);
}

/** Assets a code's asset links can be linked to — everything in its pipeline. */
export function assetsInGraphOfCode(codeId: string): { id: string; name: string }[] {
  const code = get<{ graph_id: string }>('SELECT graph_id FROM codes WHERE id = ?', codeId);
  if (!code) return [];
  return all<{ id: string; name: string }>('SELECT id, name FROM assets WHERE graph_id = ? ORDER BY name', code.graph_id);
}

/* ------------------------------------------------------------------- flow */

/**
 * Replaces a code's logic steps wholesale. Steps are positional and small, so
 * rewriting the set is simpler — and less racy — than diffing individual rows.
 */
export function saveFlow(codeId: string, input: FlowInput, actor: string): CodeFlow | null {
  if (!get('SELECT id FROM codes WHERE id = ?', codeId)) return null;

  tx(() => {
    touch(codeId, actor);
    run('DELETE FROM flow_steps WHERE code_id = ?', codeId);
    input.steps.forEach((step, i) => {
      run(
        'INSERT INTO flow_steps (id, code_id, position, op, title, body) VALUES (?, ?, ?, ?, ?, ?)',
        newId(), codeId, i, step.op ?? '', step.title || `Step ${i + 1}`, step.body ?? '',
      );
    });
  });

  return getFlow(codeId);
}

/* --------------------------------------------------------------- catalogue */

export function listAssets(graphId: string): AssetSummary[] {
  const rows = all<{
    id: string; name: string; materialization: string; description: string; code_id: string | null;
    owner: string; updated_by: string; created_at: string; updated_at: string;
    columnCount: number; consumerCount: number; testedColumns: number;
  }>(
    `SELECT a.id, a.name, a.materialization, a.description, a.code_id,
            a.owner, a.updated_by, a.created_at, a.updated_at,
            (SELECT count(*) FROM asset_columns c WHERE c.asset_id = a.id) AS columnCount,
            (SELECT count(DISTINCT l.code_id) FROM asset_links l
               WHERE l.asset_id = a.id AND l.direction = 'input') AS consumerCount,
            (SELECT count(*) FROM asset_columns c
               WHERE c.asset_id = a.id AND c.tests <> '') AS testedColumns
     FROM assets a WHERE a.graph_id = ? ORDER BY a.name`,
    graphId,
  );

  return rows.map((d) => {
    const producer = d.code_id ? get<{ id: string; name: string }>('SELECT id, name FROM codes WHERE id = ?', d.code_id) : undefined;
    return {
      id: d.id,
      name: d.name,
      materialization: d.materialization,
      description: d.description,
      ...stewardship(d),
      producedBy: producer ? { id: producer.id, name: producer.name, tags: tagsOf(producer.id) } : null,
      columnCount: d.columnCount,
      consumerCount: d.consumerCount,
      testedColumns: d.testedColumns,
    };
  });
}

export function createAsset(
  graphId: string,
  input: { name: string; materialization?: string; description?: string; producerCodeId?: string | null; owner?: string },
  actor: string,
): AssetSummary {
  const name = input.name.trim();
  if (!name) throw new ConflictError('An asset needs a name.');
  if (get('SELECT id FROM assets WHERE graph_id = ? AND name = ?', graphId, name)) {
    throw new ConflictError(`This pipeline already documents an asset called ${name}.`);
  }

  // With no owner given, an asset created against a producer inherits that
  // code's owner rather than starting out unattributed.
  const inherited = input.producerCodeId
    ? get<{ owner: string }>('SELECT owner FROM codes WHERE id = ?', input.producerCodeId)?.owner ?? ''
    : '';

  const assetId = newEntityId('assets');
  run(
    `INSERT INTO assets (id, graph_id, name, code_id, materialization, description, owner, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    assetId, graphId, name, input.producerCodeId ?? null, input.materialization?.trim() || 'table',
    input.description ?? '', input.owner?.trim() || inherited, actor,
  );

  // An asset created with a producer immediately implies its outgoing links.
  if (input.producerCodeId) linkEdgesForAsset(assetId);

  return listAssets(graphId).find((d) => d.id === assetId)!;
}

export function deleteAsset(assetId: string): void {
  // Asset links survive; they simply stop pointing at a schema page.
  run('DELETE FROM assets WHERE id = ?', assetId);
}
