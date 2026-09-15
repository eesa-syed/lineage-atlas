/**
 * Share pipelines from the terminal:
 *   npm run pipelines                                 list every pipeline
 *   npm run export -- warehouse                       writes ./<name>.atlas.json
 *   npm run export -- warehouse out.json
 *   npm run validate -- out.json [--relink]           check a file, write nothing
 *   npm run import -- out.json ["New name"] [--relink] [--replace <pipelineId>]
 *   npm run import -- target/manifest.json            a dbt project, read directly
 *   npm run from-dbt -- target/manifest.json [out.atlas.json] [--catalog target/catalog.json]
 *   npm run summary -- warehouse                      the topology as a plain adjacency list
 *   npm run scan -- ./jobs [draft.atlas.json]         a draft bundle from source files
 *   npm run status                                    is an Atlas running, and where
 *   npm run install-skill -- [--project] [--link]     put the Claude Code skill where Claude looks
 *
 * `validate` is the one to reach for in CI or from a script: it runs the same
 * gate the importer runs and exits non-zero if the file would be refused.
 *
 * Only the commands that need the database load it. Opening it creates and
 * migrates the file, which `status`, `scan`, `install-skill` and `version`
 * have no business doing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_TITLE, APP_VERSION, BUNDLE_VERSION, MIN_BUNDLE_VERSION } from './version.js';

const [command, ...rawArgs] = process.argv.slice(2);

/**
 * Pulls `--name value` and bare `--name` flags out of the arguments, leaving the
 * operands. Anything after a flag that takes a value is that value.
 */
const VALUE_FLAGS = new Set(['--catalog', '--replace', '--name', '--port']);
const BOOLEAN_FLAGS = new Set(['--relink', '--project', '--link', '--force']);
const flags = new Map<string, string | true>();
const args: string[] = [];
for (let i = 0; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i];
  if (VALUE_FLAGS.has(arg)) {
    const value = rawArgs[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value.`);
    flags.set(arg, value);
    i += 1;
  } else if (BOOLEAN_FLAGS.has(arg)) {
    flags.set(arg, true);
  } else if (arg.startsWith('--')) {
    fail(`Unknown option: ${arg}`);
  } else {
    args.push(arg);
  }
}
const valueOf = (flag: string) => (typeof flags.get(flag) === 'string' ? (flags.get(flag) as string) : undefined);

/**
 * Where a relative path on the command line is relative *to*. `npm run import
 * -- file.json` from a checkout runs this inside `server/`, which is not where
 * the person typed it; npm records that directory as `INIT_CWD`. Only trusted
 * when npm is running this workspace's own script, so an unrelated npm script
 * that `cd`s somewhere and calls `lineage-atlas` still resolves against its cwd.
 */
const callerDir = process.env.npm_package_name === 'server' && process.env.INIT_CWD ? process.env.INIT_CWD : process.cwd();
const fromCaller = (file: string) => resolve(callerDir, file);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Reads and parses a file, turning both failure modes into one clear message. */
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(fromCaller(file), 'utf8'));
  } catch (err) {
    if (err instanceof SyntaxError) fail(`${file} is not valid JSON: ${err.message}`);
    fail(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function readCatalog(): Record<string, any> | undefined {
  const file = valueOf('--catalog');
  return file ? (readJson(file) as Record<string, any>) : undefined;
}

function reportNotes(upgrades: string[], warnings: string[], converted?: string, notes: string[] = []): void {
  if (converted) console.log(`  converted ${converted}`);
  for (const note of upgrades) console.log(`  upgraded  ${note}`);
  for (const note of notes) console.log(`  filled in ${note}`);
  for (const note of warnings) console.log(`  repaired  ${note}`);
}

async function main(): Promise<void> {
  switch (command) {
    case 'version': {
      const { describeInstalledSkills } = await import('./skill.js');
      console.log(`${APP_TITLE} ${APP_VERSION}`);
      console.log(`file format ${BUNDLE_VERSION} (reads ${MIN_BUNDLE_VERSION} and up)`);
      for (const line of describeInstalledSkills(callerDir)) console.log(line);
      return;
    }

    case 'status': {
      const { status } = await import('./status.js');
      const port = valueOf('--port');
      process.exitCode = await status(port ? [Number(port)] : undefined);
      return;
    }

    case 'install-skill': {
      const { installSkill } = await import('./skill.js');
      try {
        console.log(installSkill({ project: flags.has('--project'), link: flags.has('--link'), force: flags.has('--force'), cwd: callerDir }));
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    case 'scan': {
      const dir = args[0] ?? fail('Usage: scan <dir> [outfile] [--name "Pipeline name"]');
      const { scanDirectory } = await import('./scan.js');
      const { bundleFilename } = await import('./bundle-name.js');
      const { bundle, summary, notes } = scanDirectory(fromCaller(dir), valueOf('--name'));
      const out = fromCaller(args[1] ?? bundleFilename(bundle));
      writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
      console.log(`Wrote a draft of ${bundle.counts.codes} codes and ${bundle.counts.assets} assets to ${out}.`);
      console.log(`  scanned   ${summary}`);
      for (const note of notes) console.log(`  note      ${note}`);
      console.log(`Next: lineage-atlas validate ${args[1] ?? out} --relink, then import it with --relink.`);
      return;
    }
  }

  // Everything below reads or writes the database.
  const { BundleError, bundleFilename, exportPipeline, importBundle, readBundle } = await import('./bundle.js');
  const { convertDbtManifest, isDbtManifest } = await import('./dbt.js');
  const { ConflictError, getGraphSummary, getPipeline, listPipelines } = await import('./repo.js');

  try {
    switch (command) {
      case 'list': {
        const pipelines = listPipelines();
        if (!pipelines.length) fail('No pipelines yet.');
        for (const p of pipelines) {
          console.log(`${p.id.padEnd(24)} ${String(p.codeCount).padStart(4)} codes  ${String(p.edgeCount).padStart(4)} edges  ${p.name}`);
        }
        break;
      }

      case 'summary': {
        const graphId = args[0] ?? fail('Usage: summary <pipeline-id>');
        const pipeline = getPipeline(graphId) ?? fail(`No pipeline "${graphId}". Run \`lineage-atlas list\` for the ids.`);
        const { codes, edges } = getGraphSummary(graphId);
        const nameOf = new Map(codes.map((c) => [c.id, c.name]));
        const children = new Map<string, string[]>();
        for (const [source, target] of edges) children.set(source, [...(children.get(source) ?? []), nameOf.get(target) ?? target]);
        console.log(`${pipeline.name} (${graphId}) — ${codes.length} codes, ${edges.length} edges`);
        for (const code of codes) {
          const tags = code.tags.length ? ` [${code.tags.join(', ')}]` : '';
          const status = code.status === 'inactive' ? ' (inactive)' : '';
          const next = children.get(code.id);
          console.log(`${code.name}${tags}${status}${next ? ` -> ${next.join(', ')}` : ''}`);
        }
        break;
      }

      case 'export': {
        const graphId = args[0] ?? fail('Usage: export <pipeline-id> [outfile]');
        const bundle = exportPipeline(graphId);
        const out = fromCaller(args[1] ?? bundleFilename(bundle));
        writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
        console.log(`Exported ${bundle.counts.codes} codes and ${bundle.counts.edges} edges to ${out} (format ${bundle.formatVersion}).`);
        break;
      }

      case 'validate': {
        const file = args[0] ?? fail('Usage: validate <file.atlas.json> [--relink]');
        const { bundle, sourceVersion, upgrades, warnings, notes, converted } = readBundle(readJson(file), {
          catalog: readCatalog(),
          relink: flags.has('--relink'),
        });
        console.log(
          `OK  "${bundle.pipeline.name}" — ${bundle.counts.codes} codes, ${bundle.counts.edges} edges, ${bundle.counts.assets} assets` +
            ` · format ${sourceVersion}${sourceVersion === BUNDLE_VERSION ? ' (current)' : ` → ${BUNDLE_VERSION}`}` +
            ` · written by ${bundle.generator?.name ?? 'unknown'} ${bundle.generator?.version ?? ''}`.trimEnd(),
        );
        reportNotes(upgrades, warnings, converted, notes);
        break;
      }

      case 'import': {
        const file = args[0] ?? fail('Usage: import <file.atlas.json | manifest.json> [new name] [--relink] [--replace <pipeline-id>] [--catalog catalog.json]');
        const replace = valueOf('--replace');
        const { pipeline, source, upgrades, warnings, notes, converted } = importBundle(readJson(file), args[1], {
          catalog: readCatalog(),
          relink: flags.has('--relink'),
          replace,
        });
        const from = converted ? 'from a dbt manifest' : `from format ${source.formatVersion}`;
        const verb = replace ? 'Replaced the contents of' : 'Imported';
        console.log(`${verb} "${pipeline.name}" as ${pipeline.id} — ${pipeline.codeCount} codes, ${pipeline.edgeCount} edges (${from}).`);
        reportNotes(upgrades, warnings, converted, notes);
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
        const out = fromCaller(args[1] ?? bundleFilename(bundle));
        writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
        console.log(`Wrote ${bundle.counts.codes} codes, ${bundle.counts.edges} edges and ${bundle.counts.assets} assets to ${out}.`);
        reportNotes([], [...notes, ...warnings], summary);
        break;
      }

      default:
        fail(
          'Commands: list | summary <id> | export <id> [outfile] | validate <file> | import <file> [name] | ' +
            'from-dbt <manifest.json> [outfile] | scan <dir> [outfile] | status | install-skill | version',
        );
    }
  } catch (err) {
    // A bad file is a user error, not a crash: say what is wrong, skip the stack.
    if (err instanceof BundleError) fail(`Refused: ${err.message}`);
    if (err instanceof ConflictError) fail(err.message);
    throw err;
  }
}

await main();
