/**
 * Share pipelines from the terminal:
 *   npm run pipelines                                 list every pipeline
 *   npm run export -- warehouse                       writes ./<name>.atlas.json
 *   npm run export -- warehouse out.json
 *   npm run validate -- out.json                      check a file, write nothing
 *   npm run import -- out.json ["New name"]
 *   npm run import -- target/manifest.json            a dbt project, read directly
 *   npm run from-dbt -- target/manifest.json [out.atlas.json] [--catalog target/catalog.json]
 *
 * `validate` is the one to reach for in CI or from a script: it runs the same
 * gate the importer runs and exits non-zero if the file would be refused.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BundleError, bundleFilename, exportPipeline, importBundle, readBundle } from './bundle.js';
import { convertDbtManifest, isDbtManifest } from './dbt.js';
import { listPipelines } from './repo.js';
import { APP_TITLE, APP_VERSION, BUNDLE_VERSION, MIN_BUNDLE_VERSION } from './version.js';

const [command, ...rawArgs] = process.argv.slice(2);

/** `--catalog <file>` may appear anywhere after the command; everything else is an operand. */
const catalogAt = rawArgs.indexOf('--catalog');
const catalogFile = catalogAt === -1 ? undefined : rawArgs[catalogAt + 1];
const args = catalogAt === -1 ? rawArgs : rawArgs.filter((_, i) => i !== catalogAt && i !== catalogAt + 1);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Reads and parses a file, turning both failure modes into one clear message. */
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(resolve(file), 'utf8'));
  } catch (err) {
    if (err instanceof SyntaxError) fail(`${file} is not valid JSON: ${err.message}`);
    fail(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function readCatalog(): Record<string, any> | undefined {
  if (catalogAt === -1) return undefined;
  if (!catalogFile || catalogFile.startsWith('--')) fail('--catalog needs a file.');
  return readJson(catalogFile) as Record<string, any>;
}

function reportNotes(upgrades: string[], warnings: string[], converted?: string): void {
  if (converted) console.log(`  converted ${converted}`);
  for (const note of upgrades) console.log(`  upgraded  ${note}`);
  for (const note of warnings) console.log(`  repaired  ${note}`);
}

try {
  switch (command) {
    case 'version': {
      console.log(`${APP_TITLE} ${APP_VERSION}`);
      console.log(`file format ${BUNDLE_VERSION} (reads ${MIN_BUNDLE_VERSION} and up)`);
      break;
    }

    case 'list': {
      const pipelines = listPipelines();
      if (!pipelines.length) fail('No pipelines yet.');
      for (const p of pipelines) {
        console.log(`${p.id.padEnd(24)} ${String(p.codeCount).padStart(4)} codes  ${String(p.edgeCount).padStart(4)} edges  ${p.name}`);
      }
      break;
    }

    case 'export': {
      const graphId = args[0] ?? fail('Usage: export <pipeline-id> [outfile]');
      const bundle = exportPipeline(graphId);
      const out = resolve(args[1] ?? bundleFilename(bundle));
      writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
      console.log(`Exported ${bundle.counts.codes} codes and ${bundle.counts.edges} edges to ${out} (format ${bundle.formatVersion}).`);
      break;
    }

    case 'validate': {
      const file = args[0] ?? fail('Usage: validate <file.atlas.json>');
      const { bundle, sourceVersion, upgrades, warnings, converted } = readBundle(readJson(file), { catalog: readCatalog() });
      console.log(
        `OK  "${bundle.pipeline.name}" — ${bundle.counts.codes} codes, ${bundle.counts.edges} edges, ${bundle.counts.assets} assets` +
          ` · format ${sourceVersion}${sourceVersion === BUNDLE_VERSION ? ' (current)' : ` → ${BUNDLE_VERSION}`}` +
          ` · written by ${bundle.generator.name} ${bundle.generator.version}`,
      );
      reportNotes(upgrades, warnings, converted);
      break;
    }

    case 'import': {
      const file = args[0] ?? fail('Usage: import <file.atlas.json | manifest.json> [new name] [--catalog catalog.json]');
      const { pipeline, source, upgrades, warnings, converted } = importBundle(readJson(file), args[1], { catalog: readCatalog() });
      const from = converted ? 'from a dbt manifest' : `from format ${source.formatVersion}`;
      console.log(`Imported "${pipeline.name}" as ${pipeline.id} — ${pipeline.codeCount} codes, ${pipeline.edgeCount} edges (${from}).`);
      reportNotes(upgrades, warnings, converted);
      break;
    }

    case 'from-dbt': {
      // Writes the translation out instead of importing it, so it can be read,
      // committed, or hand-edited before anything lands in a database.
      const file = args[0] ?? fail('Usage: from-dbt <manifest.json> [outfile] [--catalog catalog.json]');
      const manifest = readJson(file);
      if (!isDbtManifest(manifest)) fail(`${file} is not a dbt manifest.json (no metadata.dbt_schema_version naming a manifest).`);
      const { bundle, summary, notes } = convertDbtManifest(manifest, readCatalog());
      const { warnings } = readBundle(bundle);
      const out = resolve(args[1] ?? bundleFilename(bundle));
      writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
      console.log(`Wrote ${bundle.counts.codes} codes, ${bundle.counts.edges} edges and ${bundle.counts.assets} assets to ${out}.`);
      reportNotes([], [...notes, ...warnings], summary);
      break;
    }

    default:
      fail('Commands: list | export <id> [outfile] | validate <file> | import <file> [name] | from-dbt <manifest.json> [outfile] | version');
  }
} catch (err) {
  // A bad file is a user error, not a crash: say what is wrong, skip the stack.
  if (err instanceof BundleError) fail(`Refused: ${err.message}`);
  throw err;
}
