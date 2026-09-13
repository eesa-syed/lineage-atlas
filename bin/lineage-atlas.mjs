#!/usr/bin/env node
/**
 * The installed entry point: one command in front of the two things this
 * package can do — serve the app, or move pipelines around as files.
 *
 * Both halves already exist and both read their own configuration from the
 * environment, so this file only routes and translates flags. No arguments
 * means "serve", because that is what someone typing `npx lineage-atlas`
 * wants; every file command is passed through to the CLI untouched.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const server = (file) => import(resolve(here, '../server/dist', file));

/** Everything `server/src/cli.ts` answers to. */
const FILE_COMMANDS = new Set(['list', 'export', 'import', 'validate', 'from-dbt', 'version']);

const HELP = `lineage-atlas — search a column, see where it comes from and everything it feeds

Usage
  lineage-atlas                       start the app and open it in a browser
  lineage-atlas serve [options]       the same, without opening a browser first
  lineage-atlas list                  list pipelines with their code and edge counts
  lineage-atlas export <id> [file]    write a pipeline to an .atlas.json file
  lineage-atlas validate <file>       check a file without importing it
  lineage-atlas import <file> [name]  read an .atlas.json file in as a new pipeline
                                      — or a dbt target/manifest.json, directly
  lineage-atlas from-dbt <manifest.json> [file]
                                      convert a dbt project to an .atlas.json file
  lineage-atlas version               print the app and file-format versions

Options
  --db <file>     database file to open (any command)
  --port <n>      port to listen on; serve only (default: 5174, or the next free)
  --no-open       do not open a browser; serve only
  --catalog <file>  dbt catalog.json for column types; import, validate, from-dbt

Environment
  ATLAS_PORT      same as --port          ATLAS_DB       same as --db
  ATLAS_NO_OPEN   same as --no-open
  ATLAS_HOST      interface to listen on (default 127.0.0.1 — this machine only)
  ATLAS_ALLOWED_HOSTS  comma-separated host names to accept besides localhost

The database lives in your user data directory unless --db or ATLAS_DB says
otherwise; run \`lineage-atlas serve\` once and its path is printed on startup.`;

const argv = process.argv.slice(2);
const [command, ...rest] = argv;
const isServe = !command || command === 'serve' || command === 'start';

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(HELP);
} else if (command === '--version' || command === '-v') {
  process.argv = [process.argv[0], process.argv[1], 'version'];
  await server('cli.js');
} else if (FILE_COMMANDS.has(command)) {
  process.argv = [process.argv[0], process.argv[1], command, ...takeDbFlag(rest)];
  await server('cli.js');
} else if (isServe || command.startsWith('-')) {
  // `serve --port 3000` and a bare `--port 3000` mean the same thing.
  applyServeFlags(isServe && command ? rest : argv);
  await server('index.js');
} else {
  console.error(`Unknown command: ${command}\n`);
  console.error(HELP);
  process.exit(1);
}

/**
 * Pulls `--db <file>` out of a file command's arguments, leaving the operands
 * the CLI expects. Without this the flag would be read as an operand — a
 * `--db` in the outfile position quietly produces a file called `--db` — so
 * any other unrecognised flag is refused here rather than written to disk.
 */
function takeDbFlag(args) {
  const operands = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--db') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error('--db needs a value.');
        process.exit(1);
      }
      process.env.ATLAS_DB = resolve(value);
      i += 1;
    } else if (arg === '--catalog') {
      // Passed through: the CLI resolves it, alongside the file it belongs to.
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error('--catalog needs a value.');
        process.exit(1);
      }
      operands.push(arg, value);
      i += 1;
    } else if (arg.startsWith('--')) {
      console.error(`Unknown option: ${arg}\n`);
      console.error(HELP);
      process.exit(1);
    } else {
      operands.push(arg);
    }
  }
  return operands;
}

/**
 * Turns the serve flags into the environment variables the server already
 * reads, so there is exactly one place that decides what each setting means.
 */
function applyServeFlags(flags) {
  // An explicit `serve` is someone scripting this, not someone watching it.
  if (command === 'serve' || command === 'start') process.env.ATLAS_NO_OPEN ??= '1';

  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    const value = () => {
      const next = flags[i + 1];
      if (next === undefined || next.startsWith('-')) {
        console.error(`${flag} needs a value.`);
        process.exit(1);
      }
      i += 1;
      return next;
    };

    if (flag === '--port' || flag === '-p') process.env.ATLAS_PORT = value();
    else if (flag === '--db') process.env.ATLAS_DB = resolve(value());
    else if (flag === '--no-open') process.env.ATLAS_NO_OPEN = '1';
    else if (flag === '--open') delete process.env.ATLAS_NO_OPEN;
    else {
      console.error(`Unknown option: ${flag}\n`);
      console.error(HELP);
      process.exit(1);
    }
  }
}
