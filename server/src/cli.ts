/**
 * Share pipelines from the terminal:
 *   npm run pipelines                                 list every pipeline
 *   npm run export -- warehouse                       writes ./<name>.atlas.json
 *   npm run export -- warehouse out.json
 *   npm run validate -- out.json                      check a file, write nothing
 *   npm run import -- out.json ["New name"]
 *
 * `validate` is the one to reach for in CI or from a script: it runs the same
 * gate the importer runs and exits non-zero if the file would be refused.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BundleError, bundleFilename, exportPipeline, importBundle, readBundle } from './bundle.js';
import { listPipelines } from './repo.js';
import { APP_TITLE, APP_VERSION, BUNDLE_VERSION, MIN_BUNDLE_VERSION } from './version.js';

const [command, ...args] = process.argv.slice(2);

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

function reportNotes(upgrades: string[], warnings: string[]): void {
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
      const { bundle, sourceVersion, upgrades, warnings } = readBundle(readJson(file));
      console.log(
        `OK  "${bundle.pipeline.name}" — ${bundle.counts.codes} codes, ${bundle.counts.edges} edges, ${bundle.counts.assets} assets` +
          ` · format ${sourceVersion}${sourceVersion === BUNDLE_VERSION ? ' (current)' : ` → ${BUNDLE_VERSION}`}` +
          ` · written by ${bundle.generator.name} ${bundle.generator.version}`,
      );
      reportNotes(upgrades, warnings);
      break;
    }

    case 'import': {
      const file = args[0] ?? fail('Usage: import <file.atlas.json> [new name]');
      const { pipeline, source, upgrades, warnings } = importBundle(readJson(file), args[1]);
      console.log(`Imported "${pipeline.name}" as ${pipeline.id} — ${pipeline.codeCount} codes, ${pipeline.edgeCount} edges (from format ${source.formatVersion}).`);
      reportNotes(upgrades, warnings);
      break;
    }

    default:
      fail('Commands: list | export <id> [outfile] | validate <file> | import <file> [name] | version');
  }
} catch (err) {
  // A bad file is a user error, not a crash: say what is wrong, skip the stack.
  if (err instanceof BundleError) fail(`Refused: ${err.message}`);
  throw err;
}
