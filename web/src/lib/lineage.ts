import { withinDates, type Code, type DateRange, type GraphEdge, type ProvenanceSource } from '../types';

/** Every code reachable by walking edges backwards from `id`. */
export function upstream(id: string, edges: GraphEdge[]): Set<string> {
  return walk(id, edges, 'up');
}

/** Every code reachable by walking edges forwards from `id`. */
export function downstream(id: string, edges: GraphEdge[]): Set<string> {
  return walk(id, edges, 'down');
}

function walk(id: string, edges: GraphEdge[], direction: 'up' | 'down'): Set<string> {
  const found = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    for (const edge of edges) {
      const [from, to] = direction === 'up' ? [edge.target, edge.source] : [edge.source, edge.target];
      if (from === current && !found.has(to)) {
        found.add(to);
        stack.push(to);
      }
    }
  }
  return found;
}

/** The selected code plus everything it depends on and everything depending on it. */
export function lineageSet(id: string | null, edges: GraphEdge[]): Set<string> | null {
  if (!id) return null;
  return new Set([id, ...upstream(id, edges), ...downstream(id, edges)]);
}

export interface Filters {
  query: string;
  tags: Set<string>;
  dates: DateRange;
  /** Evidence sources to keep. A code counts if it, or any of its inputs and outputs, carries one. */
  provenance: Set<ProvenanceSource>;
}

/** Every evidence source a code carries — on itself or on any declared input or output. */
export function provenanceSources(code: Code): Set<ProvenanceSource> {
  const found = new Set<ProvenanceSource>();
  for (const holder of [code, ...code.inputs, ...code.outputs]) {
    if (holder.provenance) found.add(holder.provenance.source);
  }
  return found;
}

/**
 * A code matches when it falls inside the date window, satisfies every active
 * tag filter, and the free-text query appears anywhere in its documentation —
 * including the column names of the asset it produces and the titles/bodies of
 * its logic steps (folded into `searchTerms` server-side), so searching a
 * column or a step's logic finds the model behind it.
 *
 * Cheapest test first: the date is two numbers, the haystack is a join.
 */
export function matches(code: Code, filters: Filters): boolean {
  if (!withinDates(code, filters.dates)) return false;
  if (filters.tags.size && !code.tags.some((t) => filters.tags.has(t))) return false;
  if (filters.provenance.size && ![...provenanceSources(code)].some((s) => filters.provenance.has(s))) return false;
  const q = filters.query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    code.name,
    code.description,
    code.owner,
    ...code.tags,
    ...code.inputs.map((a) => a.path),
    ...code.outputs.map((a) => a.path),
    ...code.searchTerms,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}
