/**
 * `lineage-atlas status`: is an Atlas running, where, and on which database —
 * answered without starting anything or opening a database file.
 *
 * Deliberately imports nothing that touches SQLite. `cli.ts` opens (and
 * migrates) the database the moment it loads; a status check that did that
 * would create a database as a side effect of asking whether one is in use.
 */
import type { VersionInfo } from './types.js';

const FIRST_PORT = 5174;
/** An installed copy walks up to ten ports from 5174 when they are busy. */
const SCAN = 10;

/** What answers `/api/version` on `port`, if it is a Lineage Atlas. */
export async function probeAtlas(port: number, host = '127.0.0.1'): Promise<(VersionInfo & { port: number }) | null> {
  try {
    const res = await fetch(`http://${host}:${port}/api/version`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    const info = (await res.json()) as Partial<VersionInfo>;
    return info?.name === 'lineage-atlas' ? ({ ...(info as VersionInfo), port }) : null;
  } catch {
    return null;
  }
}

export async function status(ports?: number[]): Promise<number> {
  const pinned = process.env.ATLAS_PORT ? Number(process.env.ATLAS_PORT) : null;
  const candidates = ports ?? (pinned ? [pinned] : Array.from({ length: SCAN }, (_, i) => FIRST_PORT + i));
  const host = process.env.ATLAS_HOST && process.env.ATLAS_HOST !== '0.0.0.0' ? process.env.ATLAS_HOST : '127.0.0.1';

  const found = (await Promise.all(candidates.map((p) => probeAtlas(p, host)))).filter(Boolean) as (VersionInfo & { port: number })[];
  if (!found.length) {
    console.log(`Not running: no Lineage Atlas answered on ${candidates.length === 1 ? `port ${candidates[0]}` : `ports ${candidates[0]}–${candidates.at(-1)}`}.`);
    return 1;
  }
  for (const atlas of found) {
    console.log(
      `Running: Lineage Atlas ${atlas.version} on http://localhost:${atlas.port}` +
        ` · file format ${atlas.bundleVersion}` +
        (atlas.db ? ` · db ${atlas.db}` : ' · db unknown (older build)'),
    );
  }
  return 0;
}
