/**
 * Where an install keeps its files.
 *
 * Two very different situations have to be told apart:
 *
 *  - **A checkout.** `npm run dev` / `npm start` from the repo. The database
 *    belongs at `data/atlas.db` next to the source, where it always was —
 *    disposable, seeded, and gitignored.
 *  - **An install.** `npx lineage-atlas`, or a global install. The package
 *    lives somewhere inside a cache or `node_modules`, which npm is free to
 *    wipe on the next upgrade. Writing a database there would silently lose
 *    someone's work, so it goes in the OS's per-user data directory instead.
 *
 * The published package ships `dist` only, so the presence of `../src` is what
 * separates the two — true when running from source *and* from a built
 * checkout, false once installed.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** True when running out of a repository rather than an installed package. */
export const isCheckout = existsSync(resolve(here, '../src/index.ts'));

/** The per-user data directory this platform expects an app to write to. */
export function appDataDir(): string {
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'lineage-atlas');
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'lineage-atlas');
  }
  return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'lineage-atlas');
}

/**
 * The database file to open. `ATLAS_DB` always wins — it is how you keep more
 * than one atlas, or point an install at a checkout's database.
 */
export function defaultDbPath(): string {
  if (process.env.ATLAS_DB) {
    // Relative to where the command was typed, not to `server/`, when npm is
    // running one of this workspace's scripts (see `callerDir` in cli.ts).
    const base = process.env.npm_package_name === 'server' && process.env.INIT_CWD ? process.env.INIT_CWD : process.cwd();
    return resolve(base, process.env.ATLAS_DB);
  }
  return isCheckout ? resolve(here, '../../data/atlas.db') : join(appDataDir(), 'atlas.db');
}
