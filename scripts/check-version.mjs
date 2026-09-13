#!/usr/bin/env node
/**
 * One version, four places. `server/src/version.ts` is the source of truth —
 * it is what the API reports and what every exported file is stamped with —
 * and the three package.json files have to agree with it.
 *
 * Runs as the first step of `npm run build`, so a release can never ship
 * claiming one version in its files and another in its manifest.
 *
 * Usage: node scripts/check-version.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const source = readFileSync(join(root, 'server/src/version.ts'), 'utf8');
const match = source.match(/export const APP_VERSION = '([^']+)'/);
if (!match) {
  console.error('check-version: could not find APP_VERSION in server/src/version.ts');
  process.exit(1);
}
const expected = match[1];

const manifests = ['package.json', 'server/package.json', 'web/package.json'];
const mismatched = manifests
  .map((file) => ({ file, version: JSON.parse(readFileSync(join(root, file), 'utf8')).version }))
  .filter((m) => m.version !== expected);

if (mismatched.length) {
  console.error(`check-version: APP_VERSION is ${expected}, but:`);
  for (const m of mismatched) console.error(`  ${m.file} says ${m.version}`);
  console.error('Set them all to the same value and try again.');
  process.exit(1);
}

console.log(`check-version: ${expected} everywhere.`);
