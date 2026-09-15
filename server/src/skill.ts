/**
 * `lineage-atlas install-skill`: puts the Claude Code skill where Claude Code
 * looks for it, so it works in *your* project rather than only inside an Atlas
 * checkout.
 *
 * Every installed copy carries a stamp naming the Atlas version it came from,
 * which is what lets `lineage-atlas version` say that a copy is stale — a
 * hand-copied skill otherwise drifts silently from the API it describes.
 *
 * No database access here, on purpose: see `status.ts`.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from './version.js';

const here = dirname(fileURLToPath(import.meta.url));

/** The skill as shipped — the same relative path from `src/` and from `dist/`. */
export const SKILL_SOURCE = resolve(here, '../../.claude/skills/lineage-atlas');
const STAMP = '.atlas-version';

export function skillTargets(cwd = process.cwd()): { personal: string; project: string } {
  return {
    personal: join(homedir(), '.claude', 'skills', 'lineage-atlas'),
    project: join(cwd, '.claude', 'skills', 'lineage-atlas'),
  };
}

/** The Atlas version an installed copy was stamped with; `null` if none is there, `'unknown'` if it is unstamped. */
export function installedSkillVersion(dir: string): string | null {
  if (!existsSync(join(dir, 'SKILL.md'))) return null;
  // A symlink always tracks the source, so it is never stale.
  if (lstatSync(dir).isSymbolicLink()) return `${APP_VERSION} (linked)`;
  try {
    return readFileSync(join(dir, STAMP), 'utf8').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface InstallOptions {
  project?: boolean;
  link?: boolean;
  force?: boolean;
  cwd?: string;
}

export function installSkill(options: InstallOptions = {}): string {
  if (!existsSync(join(SKILL_SOURCE, 'SKILL.md'))) {
    throw new Error(`The skill is not in this build (looked in ${SKILL_SOURCE}).`);
  }
  const target = options.project ? skillTargets(options.cwd).project : skillTargets(options.cwd).personal;
  if (resolve(target) === SKILL_SOURCE) return `${target} is this checkout's own skill; nothing to do.`;

  const existing = existsSync(target) || isDanglingLink(target);
  if (existing) {
    // Only a copy this command wrote (stamped, or a link) is replaced without
    // asking: an unstamped directory may be someone's own edited skill.
    const version = installedSkillVersion(target);
    if (version === 'unknown' && !options.force) {
      throw new Error(`${target} already exists and was not installed by lineage-atlas. Re-run with --force to replace it.`);
    }
    rmSync(target, { recursive: true, force: true });
  }

  mkdirSync(dirname(target), { recursive: true });
  if (options.link) {
    symlinkSync(SKILL_SOURCE, target, 'dir');
    return `Linked ${target} → ${SKILL_SOURCE}. It follows this install; re-run after moving it.`;
  }
  cpSync(SKILL_SOURCE, target, { recursive: true });
  writeFileSync(join(target, STAMP), `${APP_VERSION}\n`, 'utf8');
  return `${existing ? 'Updated' : 'Installed'} the skill (Atlas ${APP_VERSION}) at ${target}.`;
}

function isDanglingLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** One line per place a skill is installed, for `lineage-atlas version`. */
export function describeInstalledSkills(cwd = process.cwd()): string[] {
  const lines: string[] = [];
  for (const [label, dir] of Object.entries(skillTargets(cwd))) {
    if (resolve(dir) === SKILL_SOURCE) continue;
    const version = installedSkillVersion(dir);
    if (!version) continue;
    const current = version.startsWith(APP_VERSION);
    lines.push(`skill (${label}) ${version} at ${dir}${current ? '' : ` — stale, run \`lineage-atlas install-skill${label === 'project' ? ' --project' : ''}\``}`);
  }
  return lines;
}
