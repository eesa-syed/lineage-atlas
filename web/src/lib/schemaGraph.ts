import type { Code, SchemaTable } from '../types';

/**
 * Pure helpers behind the Schema tab. Nothing here is stored — positions and
 * search matches are derived from the tables' own documented columns.
 */

export type Density = 'all' | 'keys' | 'name';
export type XY = { x: number; y: number };

export const TABLE_WIDTH = 264;
const HEAD = 30;
const BADGES = 24;
const ROWS_PAD = 8;
const ROW = 21;
const FOOT = 27;
const EMPTY = 64;
/** The two-line block naming the codes that write and read a table. Fixed: both
 * lines always render (each says so when empty) and neither ever wraps. */
const LINEAGE = 49;

/** How tall a table node renders at a density — matched to the node's CSS, so
 * the layout can space tables without measuring the DOM first. */
export function tableHeight(table: SchemaTable, density: Density): number {
  if (density === 'name') return HEAD + FOOT;
  const badges = table.certified || table.containsPii ? BADGES : 0;
  const lineage = table.producedBy || table.consumedBy.length ? LINEAGE : 0;
  if (table.columns.length === 0) return HEAD + badges + EMPTY + lineage + FOOT;
  let rows = table.columns.length;
  if (density === 'keys') {
    const keys = table.columns.filter((c) => c.keyKind).length;
    rows = keys + (table.columns.length > keys ? 1 : 0);
  }
  return HEAD + badges + ROWS_PAD + rows * ROW + lineage + FOOT;
}

/* ------------------------------------------------------------ grid layout */

/** The part of a table name before its first dot — `raw` in `raw.web_events` —
 * which is how warehouses already group their tables. Unqualified names share
 * an empty group. */
export function schemaOf(name: string): string {
  const dot = name.indexOf('.');
  return dot > 0 ? name.slice(0, dot) : '';
}

/** A band of tables sharing a schema. Nothing is drawn for it — the canvas
 * carries only the table cards — but the count feeds the legend. */
export interface SchemaGroup {
  id: string;
  /** Display name: the schema, or "unqualified" for names without one. */
  name: string;
  count: number;
  /** Top of the band, in canvas coordinates. */
  position: XY;
}

export interface GridLayout {
  positions: Record<string, XY>;
  groups: SchemaGroup[];
}

const GRID_COLUMNS = 4;
const GAP_X = 40;
const GAP_Y = 32;
const GROUP_GAP = 80;

/**
 * Tables as they are, with no links between them: grouped by schema, each group
 * a band of up to four columns. Tables go in name order
 * into whichever column is currently shortest, so tall and short tables pack
 * without ragged gaps, and the first row still reads alphabetically. Fully
 * deterministic, so everyone sees the same arrangement until they drag a table.
 */
export function layoutGrid(tables: SchemaTable[], density: Density): GridLayout {
  const bySchema = new Map<string, SchemaTable[]>();
  for (const table of [...tables].sort((a, b) => a.name.localeCompare(b.name))) {
    const schema = schemaOf(table.name);
    if (!bySchema.has(schema)) bySchema.set(schema, []);
    bySchema.get(schema)!.push(table);
  }
  // Named schemas alphabetically; unqualified tables last.
  const ordered = [...bySchema.entries()].sort(
    ([a], [b]) => Number(a === '') - Number(b === '') || a.localeCompare(b),
  );

  const positions: Record<string, XY> = {};
  const groups: SchemaGroup[] = [];
  let top = 0;
  for (const [schema, members] of ordered) {
    groups.push({ id: `group:${schema || '~'}`, name: schema || 'unqualified', count: members.length, position: { x: 0, y: top } });
    const columns = Math.min(GRID_COLUMNS, members.length);
    const bottoms = new Array<number>(columns).fill(top);
    for (const table of members) {
      let column = 0;
      for (let i = 1; i < columns; i += 1) if (bottoms[i] < bottoms[column]) column = i;
      positions[table.id] = { x: column * (TABLE_WIDTH + GAP_X), y: bottoms[column] };
      bottoms[column] += tableHeight(table, density) + GAP_Y;
    }
    top = Math.max(...bottoms) - GAP_Y + GROUP_GAP;
  }
  return { positions, groups };
}

/* ----------------------------------------------------------------- search */

/**
 * Tables matching a query, each with the ids of its matching columns. A table
 * matches on its own name, description, materialization, any code that writes or
 * reads it, or any column's name or description — so searching a column finds
 * every table that carries it, and searching a code finds every table it touches,
 * which is the "does this data already exist?" question.
 * Returns null for an empty query, meaning "no filter".
 */
export function searchTables(tables: SchemaTable[], query: string): Map<string, Set<string>> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const found = new Map<string, Set<string>>();
  for (const table of tables) {
    const columns = new Set(
      table.columns
        .filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
        .map((c) => c.id),
    );
    const own = [
      table.name,
      table.description,
      table.materialization,
      table.producedBy?.name ?? '',
      ...table.consumedBy.map((c) => c.name),
    ].some((s) => s.toLowerCase().includes(q));
    if (own || columns.size) found.set(table.id, columns);
  }
  return found;
}

/* ------------------------------------------------------ not wired in: links */

/*
 * Nothing below is used by the Schema tab, which shows tables as they are, with
 * no links between them. These derive table-to-table data-flow edges from what
 * codes read and write, a left-to-right layered layout over those edges, and a
 * by-name column trace along them. Kept — pure and self-contained — so linking
 * can come back without being rebuilt.
 */

/** A data-flow link between two tables: some code reads `source` and writes `target`. */
export interface SchemaEdge {
  id: string;
  source: string;
  target: string;
  /** The codes doing that work — usually one; more when two models make the same hop. */
  via: string[];
}

/** Table-level edges: a code that reads A and writes B means data moves from A to B.
 * Only links that resolve to a documented asset count. */
export function schemaEdges(codes: Code[], tableIds: ReadonlySet<string>): SchemaEdge[] {
  const byPair = new Map<string, SchemaEdge>();
  for (const code of codes) {
    const reads = new Set(code.inputs.map((l) => l.assetId).filter((id): id is string => !!id && tableIds.has(id)));
    const writes = new Set(code.outputs.map((l) => l.assetId).filter((id): id is string => !!id && tableIds.has(id)));
    for (const source of reads) {
      for (const target of writes) {
        if (source === target) continue;
        const id = `${source}->${target}`;
        const edge = byPair.get(id) ?? { id, source, target, via: [] };
        if (!edge.via.includes(code.name)) edge.via.push(code.name);
        byPair.set(id, edge);
      }
    }
  }
  return [...byPair.values()];
}

const COL_GAP = 150;
const ROW_GAP = 40;

/**
 * Layered left-to-right layout over `schemaEdges`: each table one column right
 * of the furthest table feeding it, ordered near its feeders. Table links can
 * form a cycle even though code edges never do (an inferred code edge that would
 * close one is skipped, but its declarations stay), so a stuck queue releases
 * the unplaced table with the fewest unplaced inputs instead of looping.
 */
export function layoutTables(tables: SchemaTable[], edges: SchemaEdge[], density: Density): Record<string, XY> {
  const ids = tables.map((t) => t.id).sort((a, b) => a.localeCompare(b));
  const byId = new Map(tables.map((t) => [t.id, t]));
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    if (!preds.has(edge.target) || !succs.has(edge.source)) continue;
    preds.get(edge.target)!.push(edge.source);
    succs.get(edge.source)!.push(edge.target);
  }

  const waiting = new Map(ids.map((id) => [id, preds.get(id)!.length]));
  const rank = new Map<string, number>();
  const queue = ids.filter((id) => waiting.get(id) === 0);
  while (rank.size < ids.length) {
    if (queue.length === 0) {
      const stuck = ids.filter((id) => !rank.has(id)).sort((a, b) => waiting.get(a)! - waiting.get(b)!)[0];
      queue.push(stuck);
    }
    const id = queue.shift()!;
    if (rank.has(id)) continue;
    rank.set(id, Math.max(0, ...preds.get(id)!.filter((p) => rank.has(p)).map((p) => rank.get(p)! + 1)));
    for (const next of succs.get(id)!) {
      waiting.set(next, waiting.get(next)! - 1);
      if (waiting.get(next) === 0 && !rank.has(next)) queue.push(next);
    }
  }

  const columns: string[][] = [];
  for (const id of ids) (columns[rank.get(id)!] ??= []).push(id);

  const centre = new Map<string, number>();
  const position: Record<string, XY> = {};
  const totals: number[] = [];
  columns.forEach((column, r) => {
    if (r > 0) {
      const pull = (id: string) => {
        const placed = preds.get(id)!.filter((p) => centre.has(p));
        return placed.length ? placed.reduce((sum, p) => sum + centre.get(p)!, 0) / placed.length : 1e9;
      };
      column.sort((a, b) => pull(a) - pull(b) || a.localeCompare(b));
    }
    let y = 0;
    for (const id of column) {
      const height = tableHeight(byId.get(id)!, density);
      position[id] = { x: r * (TABLE_WIDTH + COL_GAP), y };
      centre.set(id, y + height / 2);
      y += height + ROW_GAP;
    }
    totals[r] = y - ROW_GAP;
  });

  const tallest = Math.max(0, ...totals.filter((t) => t !== undefined));
  columns.forEach((column, r) => {
    const shift = (tallest - totals[r]) / 2;
    for (const id of column) position[id].y = Math.round(position[id].y + shift);
  });
  return position;
}

export interface ColumnPick {
  tableId: string;
  column: string;
}

export interface TraceEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
}

export interface ColumnTrace {
  name: string;
  /** Table id → id of the column carrying the traced name there. */
  columns: Map<string, string>;
  tables: Set<string>;
  edges: TraceEdge[];
}

/**
 * Follows a column by name along `schemaEdges`, crossing an edge only when the
 * far table carries a column of the same name — a table in between that lacks
 * it ends the trace, and so does a rename.
 */
export function traceColumn(pick: ColumnPick, tables: SchemaTable[], edges: SchemaEdge[]): ColumnTrace | null {
  const key = pick.column.toLowerCase();
  const byId = new Map(tables.map((t) => [t.id, t]));
  const columnIn = (tableId: string) => byId.get(tableId)?.columns.find((c) => c.name.toLowerCase() === key);

  const start = columnIn(pick.tableId);
  if (!start) return null;

  const columns = new Map([[pick.tableId, start.id]]);
  const traced = new Map<string, TraceEdge>();
  const queue = [pick.tableId];
  while (queue.length) {
    const at = queue.shift()!;
    for (const edge of edges) {
      if (edge.source !== at && edge.target !== at) continue;
      const other = edge.source === at ? edge.target : edge.source;
      const column = columnIn(other);
      if (!column) continue;
      if (!traced.has(edge.id)) {
        traced.set(edge.id, {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: `${columnIn(edge.source)!.id}:out`,
          targetHandle: `${columnIn(edge.target)!.id}:in`,
        });
      }
      if (!columns.has(other)) {
        columns.set(other, column.id);
        queue.push(other);
      }
    }
  }
  return { name: start.name, columns, tables: new Set(columns.keys()), edges: [...traced.values()] };
}
