import type { AtlasBundle } from './types.js';

/** `analytics-warehouse-2026-09-08.atlas.json`. Kept apart from `bundle.ts` so a
 * command that only writes a file — `scan` — can name it without opening the database. */
export function bundleFilename(bundle: AtlasBundle): string {
  const slug = bundle.pipeline.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pipeline';
  return `${slug}-${bundle.exportedAt.slice(0, 10)}.atlas.json`;
}
