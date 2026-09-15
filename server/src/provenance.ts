import { PROVENANCE_SOURCES, type Provenance, type ProvenanceSource } from './types.js';

/**
 * Reads a provenance value from a file or a request body.
 *
 * `undefined` means the caller said nothing about it; `null` means "clear it".
 * Anything else must be `{source, ref?}` with a known `source` — an unknown one
 * is reported as `invalid` rather than guessed at, so the caller decides whether
 * that is a repair (a file) or a refusal (an API write).
 */
export function readProvenance(value: unknown): { provenance: Provenance | null | undefined; invalid?: string } {
  if (value === undefined) return { provenance: undefined };
  if (value === null) return { provenance: null };
  const raw = value as { source?: unknown; ref?: unknown };
  const source = typeof raw?.source === 'string' ? raw.source.trim().toLowerCase() : '';
  if (!PROVENANCE_SOURCES.includes(source as ProvenanceSource)) {
    return {
      provenance: null,
      invalid: `provenance source must be one of ${PROVENANCE_SOURCES.join(', ')} (got ${JSON.stringify(raw?.source ?? value)})`,
    };
  }
  return { provenance: { source: source as ProvenanceSource, ref: typeof raw.ref === 'string' ? raw.ref.trim() : '' } };
}

/** A row's two provenance columns, as the API shape. Empty source means unknown. */
export function provenanceOf(row: { provenance_source?: string; provenance_ref?: string }): Provenance | null {
  return row.provenance_source
    ? { source: row.provenance_source as ProvenanceSource, ref: row.provenance_ref ?? '' }
    : null;
}

/**
 * A path with its placeholder segments — `<id>`, `{run_id}`, `${date}` — folded
 * to one token, so `s3://b/<id>/out.json` and `s3://b/{run_id}/out.json` compare
 * equal. Used only to *warn* about near-misses: two spellings of a template may
 * well be two different things, so nothing is ever merged on this basis.
 */
export function templateKey(path: string): string {
  return path.trim().replace(/\$\{[^}]*\}|\{[^}]*\}|<[^>]*>/g, '{*}');
}

export function hasPlaceholder(path: string): boolean {
  return templateKey(path) !== path.trim();
}
