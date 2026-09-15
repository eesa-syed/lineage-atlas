#!/usr/bin/env node
/**
 * The agent-facing docs must not describe a file format that no longer exists.
 *
 * An agent reads `.claude/skills/lineage-atlas/SKILL.md` and `docs/AI_AGENTS.md`
 * as instructions. When one of them still documents a field the format dropped —
 * `sampleRows` survived in SKILL.md for a whole version — the agent either stops
 * to work out which statement is true or sends a field the API ignores.
 *
 * Two checks, both driven by `docs/FILE_FORMAT.md` so nothing is listed twice:
 *
 *  1. Every backticked field in a version-history row that says "dropped" is
 *     mentioned in the agent docs only on a line that also says it was dropped
 *     or removed.
 *  2. The current format version quoted in the docs matches `BUNDLE_VERSION`.
 *
 * Runs as part of `npm run build`. Usage: node scripts/check-docs.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

const version = Number(read('server/src/version.ts').match(/export const BUNDLE_VERSION = (\d+)/)?.[1]);
const spec = read('docs/FILE_FORMAT.md');

const dropped = new Set();
for (const line of spec.split('\n')) {
  if (!/^\|\s*\**\d+\**\s*\|/.test(line)) continue;
  // Clause by clause, so "status collapsed to `active`; `sla` dropped" names only `sla`.
  for (const clause of line.split(/[;|]/)) {
    if (!/dropped/i.test(clause)) continue;
    for (const [, field] of clause.matchAll(/`([A-Za-z_]\w*)`/g)) dropped.add(field);
  }
}

const AGENT_DOCS = ['.claude/skills/lineage-atlas/SKILL.md', 'docs/AI_AGENTS.md'];
const problems = [];

for (const file of AGENT_DOCS) {
  read(file).split('\n').forEach((line, i) => {
    for (const field of dropped) {
      if (new RegExp(`\\b${field}\\b`).test(line) && !/dropped|removed/i.test(line)) {
        problems.push(`${file}:${i + 1} mentions \`${field}\`, which the file format dropped`);
      }
    }
  });
}

const quoted = [
  ['docs/FILE_FORMAT.md', /\*\*Current version:\*\* `(\d+)`/],
  ['.claude/skills/lineage-atlas/SKILL.md', /Current `formatVersion` is \*\*(\d+)\*\*/],
];
for (const [file, pattern] of quoted) {
  const found = Number(read(file).match(pattern)?.[1]);
  if (found !== version) problems.push(`${file} says the current format is ${found || '(not found)'}, but BUNDLE_VERSION is ${version}`);
}

if (problems.length) {
  console.error('check-docs: the agent docs disagree with the file format:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-docs: agent docs match file format ${version} (${dropped.size} dropped fields checked)`);
