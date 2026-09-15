/**
 * Canvas positions for codes that arrive without any. Coordinates carry no
 * documentation value, so nobody writing a bundle — a person, a converter, an
 * agent — should have to compute them, and every code piling up at the origin
 * makes a graph unreadable.
 */

export const COLUMN_WIDTH = 300;
export const ROW_HEIGHT = 240;
export const MARGIN = 40;

interface Placeable {
  id: string;
  name: string;
  tags?: string[];
  x?: number;
  y?: number;
}

/**
 * Left-to-right by depth — each code one column right of its deepest parent —
 * then each column ordered by where its parents sit, which keeps most arrows
 * short and roughly horizontal. Not a crossing minimiser; a readable start that
 * a person can drag from.
 *
 * Only `codes` are moved. Depth is still measured along every edge given, so a
 * code placed here lands to the right of a parent that already had a position.
 * `top` shifts the whole block down, to clear codes that were placed by hand.
 */
export function layeredLayout<T extends Placeable>(
  codes: T[],
  edges: { source: string; target: string }[],
  top = MARGIN,
): void {
  const parents = new Map<string, string[]>();
  for (const e of edges) parents.set(e.target, [...(parents.get(e.target) ?? []), e.source]);

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0; // a cycle; readBundle drops the edge that closes it
    visiting.add(id);
    const d = Math.max(-1, ...(parents.get(id) ?? []).map(depthOf)) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };

  const columns = new Map<number, T[]>();
  for (const code of codes) {
    const d = depthOf(code.id);
    columns.set(d, [...(columns.get(d) ?? []), code]);
  }

  const row = new Map<string, number>();
  for (const d of [...columns.keys()].sort((a, b) => a - b)) {
    const column = columns.get(d)!;
    const weight = (code: T) => {
      const ps = (parents.get(code.id) ?? []).filter((p) => row.has(p));
      return ps.length ? ps.reduce((sum, p) => sum + row.get(p)!, 0) / ps.length : Number.POSITIVE_INFINITY;
    };
    column
      .sort((a, b) => weight(a) - weight(b) || (a.tags?.[0] ?? '').localeCompare(b.tags?.[0] ?? '') || a.name.localeCompare(b.name))
      .forEach((code, i) => {
        row.set(code.id, i);
        code.x = MARGIN + d * COLUMN_WIDTH;
        code.y = top + i * ROW_HEIGHT;
      });
  }
}
