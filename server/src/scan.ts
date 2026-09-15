/**
 * `lineage-atlas scan <dir>`: a **draft** inventory of a pipeline that is not a
 * dbt project — Lambdas, Glue jobs, Airflow tasks, plain Python and SQL.
 *
 * It proposes; it never documents. One code per source file with recognisable
 * I/O, and one candidate input or output per path found by simple patterns —
 * S3/GCS URIs, bucket and key constants, SQL `FROM`/`JOIN`/`INSERT INTO`,
 * DynamoDB table names, pandas and Spark readers and writers. Every link is
 * tagged `unverified` and carries `provenance: inferred` pointing at the line it
 * came from, so nothing a scan writes can be mistaken for a checked fact.
 *
 * The output is a short-form bundle on purpose: no positions, no `assetRef`,
 * no `producedBy`, no edges. Import it with `--relink` and Atlas fills those in
 * from the declarations — which is exactly the part a person then reviews.
 *
 * No database access here, on purpose: see `status.ts`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { APP_VERSION, BUNDLE_FORMAT, BUNDLE_VERSION } from './version.js';
import type { AtlasBundle, BundleAsset, BundleCode, Direction } from './types.js';

const LANGUAGES: Record<string, string> = {
  '.py': 'python', '.sql': 'sql', '.scala': 'scala', '.java': 'java',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.ts': 'typescript', '.sh': 'shell',
};
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.venv', 'venv', 'env', '__pycache__', '.tox', '.mypy_cache',
  '.pytest_cache', 'site-packages', 'dist', 'build', 'target', '.idea', '.vscode', 'test', 'tests', '__tests__',
]);
const TEST_FILE = /(^test_|_test\.|\.test\.|\.spec\.)/;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 5000;

interface Found {
  direction: Direction;
  path: string;
  kind: string;
  line: number;
  /** True when nothing on the line said which way the data moves. */
  unsure?: boolean;
}

/* ------------------------------------------------------------- patterns */

const URI = /\b(?:s3a?|gs|abfss?|hdfs):\/\/[^\s'"`),;\]]+/g;
const WRITE_WORDS = /put_object|upload|\.write|write_|to_csv|to_parquet|to_json|\.save|saveastable|insertinto|dump|copy_to|\bdest|\btarget|\bsink|\boutput/i;
const READ_WORDS = /get_object|download|\.read|read_|\bload|\bopen\(|\bsource|\binput|\bscan|select_object/i;

const SQL_READ = /\b(?:FROM|JOIN)\s+([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*){0,2})/gi;
const SQL_WRITE = /\b(?:INSERT\s+(?:INTO|OVERWRITE(?:\s+TABLE)?)|CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)(?:\s+IF\s+NOT\s+EXISTS)?|MERGE\s+INTO|COPY\s+INTO|UNLOAD\s+TO)\s+([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*){0,2})/gi;
const SQL_CTE = /\b([A-Za-z_]\w*)\s+AS\s*\(/gi;
const NOT_TABLES = new Set(['select', 'lateral', 'unnest', 'dual', 'values', 'table', 'the', 'a', 'an', 'where', 'if', 'exists', 'temporary', 'temp']);

const DYNAMO = /(?:\.Table\(\s*|TableName\s*=\s*)['"]([^'"]+)['"]/g;
const BUCKET_KEY = /Bucket\s*=\s*[rbf]?['"]([^'"]+)['"][^\n]*?Key\s*=\s*[rbf]?['"]([^'"]+)['"]/;
const PANDAS_READ = /\b(?:read_(?:csv|parquet|json|excel|feather|orc|table)|spark\.table|\.load)\(\s*[rbf]?['"]([^'"]+)['"]/g;
const PANDAS_WRITE = /\b(?:to_(?:csv|parquet|json|excel|feather|orc)|saveAsTable|insertInto|\.save)\(\s*[rbf]?['"]([^'"]+)['"]/g;

function scanText(text: string, language: string): Found[] {
  const found: Found[] = [];
  const lines = text.split(/\r?\n/);
  const ctes = new Set<string>();
  for (const m of text.matchAll(SQL_CTE)) ctes.add(m[1].toLowerCase());

  lines.forEach((line, i) => {
    const n = i + 1;
    const trimmed = line.trim();
    if (!trimmed || /^(#|--|\/\/)/.test(trimmed)) return;

    for (const m of line.matchAll(URI)) {
      const path = m[0].replace(/[.'"]+$/, '');
      const write = WRITE_WORDS.test(line);
      const read = READ_WORDS.test(line);
      found.push({ direction: write && !read ? 'output' : 'input', path, kind: path.split(':')[0], line: n, unsure: write === read });
    }

    const bk = line.match(BUCKET_KEY);
    if (bk) {
      const write = /put_object|upload/i.test(line);
      found.push({ direction: write ? 'output' : 'input', path: `s3://${bk[1]}/${bk[2]}`, kind: 's3', line: n, unsure: !write && !/get_object|download/i.test(line) });
    }

    for (const m of line.matchAll(DYNAMO)) {
      const write = /put_item|update_item|delete_item|batch_writer|batch_write_item/i.test(line);
      const read = /get_item|\.query\(|\.scan\(|batch_get_item/i.test(line);
      found.push({ direction: write ? 'output' : 'input', path: m[1], kind: 'dynamodb', line: n, unsure: write === read });
    }
    for (const m of line.matchAll(PANDAS_READ)) found.push({ direction: 'input', path: m[1], kind: 'file', line: n });
    for (const m of line.matchAll(PANDAS_WRITE)) found.push({ direction: 'output', path: m[1], kind: 'file', line: n });

    // SQL: in a .sql file every line counts; elsewhere only a line that looks
    // like a query, so Python's `from x import y` is not read as a table.
    const sqlish = language === 'sql' || /\bselect\b|\binsert\b|\bmerge\b|\bcreate\s+(or\s+replace\s+)?(table|view)\b/i.test(line);
    if (!sqlish || (language === 'python' && /^(from|import)\s/.test(trimmed))) return;
    const writes = new Set<string>();
    for (const m of line.matchAll(SQL_WRITE)) {
      writes.add(m[1].toLowerCase());
      found.push({ direction: 'output', path: m[1], kind: 'table', line: n });
    }
    for (const m of line.matchAll(SQL_READ)) {
      const name = m[1].toLowerCase();
      if (NOT_TABLES.has(name) || ctes.has(name) || writes.has(name) || /^\d/.test(name)) continue;
      found.push({ direction: 'input', path: m[1], kind: 'table', line: n });
    }
  });
  return found;
}

/* ----------------------------------------------------------------- walk */

function walk(root: string, notes: string[]): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) return;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) visit(join(dir, entry.name));
      } else if (entry.isFile() && LANGUAGES[extname(entry.name)] && !TEST_FILE.test(entry.name)) {
        files.push(join(dir, entry.name));
      }
    }
  };
  visit(root);
  if (files.length >= MAX_FILES) notes.push(`Stopped after ${MAX_FILES} files; scan a narrower directory for the rest.`);
  return files.sort();
}

export interface ScanResult {
  bundle: AtlasBundle;
  summary: string;
  notes: string[];
}

export function scanDirectory(dir: string, name?: string): ScanResult {
  const root = resolve(dir);
  if (!statSync(root).isDirectory()) throw new Error(`${dir} is not a directory.`);
  const notes: string[] = [];
  const files = walk(root, notes);
  const now = new Date().toISOString();

  const codes: BundleCode[] = [];
  const outputs = new Map<string, string>(); // path → kind
  let quiet = 0;

  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/');
    if (statSync(file).size > MAX_FILE_BYTES) {
      notes.push(`Skipped ${rel}: larger than 1 MB.`);
      continue;
    }
    const language = LANGUAGES[extname(file)];
    const found = scanText(readFileSync(file, 'utf8'), language);
    if (!found.length) {
      quiet += 1;
      continue;
    }

    // One link per path and direction; the first line it appeared on is the reference.
    const links = new Map<string, Found>();
    for (const f of found) {
      const key = `${f.direction} ${f.path}`;
      if (!links.has(key)) links.set(key, f);
    }
    for (const f of links.values()) if (f.direction === 'output') outputs.set(f.path, f.kind);

    codes.push({
      id: rel,
      name: rel.replace(/\.[^./]+$/, ''),
      description: '',
      tags: [language, 'scanned'],
      steps: [],
      updatedBy: 'lineage-atlas scan',
      provenance: { source: 'inferred', ref: `lineage-atlas scan of ${rel}` },
      assetLinks: [...links.values()].map((f) => ({
        direction: f.direction,
        path: f.path,
        detail: f.unsure ? `found at ${rel}:${f.line} — direction guessed` : `found at ${rel}:${f.line}`,
        tags: [f.kind, 'unverified'],
        provenance: { source: 'inferred', ref: `${rel}:${f.line}` },
      })),
    } as unknown as BundleCode);
  }

  // Only a path something writes becomes a documented asset: a read with no
  // writer in this directory is an external source, and stays a plain path.
  const assets = [...outputs].map(([path, kind]) => ({
    id: `asset:${path}`,
    name: path,
    materialization: kind === 'table' ? 'table' : 'file',
    description: '',
    owner: '',
    columns: [],
  })) as unknown as BundleAsset[];

  if (quiet) notes.push(`${quiet} source file${quiet === 1 ? '' : 's'} had no recognisable I/O and ${quiet === 1 ? 'was' : 'were'} left out.`);
  notes.push('Every input and output is a guess: tagged unverified, with provenance pointing at the line. Import with --relink, then review.');

  const bundle = {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_VERSION,
    generator: { name: 'lineage-atlas scan', version: APP_VERSION },
    exportedAt: now,
    counts: { codes: codes.length, edges: 0, assets: assets.length },
    pipeline: {
      name: name?.trim() || basename(root),
      description: `Draft inventory scanned from ${basename(root)}/ — every input and output is inferred and unverified.`,
    },
    codes,
    edges: [],
    assets,
  } as AtlasBundle;

  const linkCount = codes.reduce((n, c) => n + c.assetLinks.length, 0);
  return {
    bundle,
    summary: `scanned ${files.length} files: ${codes.length} codes, ${linkCount} candidate inputs/outputs, ${assets.length} written paths`,
    notes,
  };
}
