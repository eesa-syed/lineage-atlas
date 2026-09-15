/**
 * Every version number Lineage Atlas publishes, in one place.
 *
 * Three separate things are versioned, and they move independently:
 *
 *  - `APP_VERSION`   the release (semver). Cosmetic to the data; it only ever
 *                    tells you which build wrote a file or answered a request.
 *  - `BUNDLE_VERSION` the `.atlas.json` *format*. An integer, bumped only when
 *                    the shape on disk changes, with an upgrade step written in
 *                    `bundle.ts` for every bump. Never reused, never skipped.
 *  - `MIN_BUNDLE_VERSION` the oldest format still readable. Raising this is a
 *                    breaking change and belongs in a major release.
 *
 * `APP_VERSION` must match the `version` field of every package.json in the
 * workspace; `npm run check:version` enforces it and runs as part of `build`.
 */

export const APP_NAME = 'lineage-atlas';
export const APP_TITLE = 'Lineage Atlas';
export const APP_VERSION = '1.0.1';

/** The `format` discriminator every bundle carries. Never changes — a rename
 * would make every file in the wild unreadable rather than upgradeable. */
export const BUNDLE_FORMAT = 'lineage-atlas.pipeline';

/** Current on-disk format. Bump ⇒ add an upgrade step in `bundle.ts`. */
export const BUNDLE_VERSION = 9;

/** Oldest format this build can still read and upgrade. */
export const MIN_BUNDLE_VERSION = 1;

export const BUNDLE_EXTENSION = '.atlas.json';

/** Stamped into every export so a file always says what wrote it. */
export function generator(): { name: string; version: string } {
  return { name: APP_NAME, version: APP_VERSION };
}
