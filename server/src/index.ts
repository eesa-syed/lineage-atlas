import express, { type Request, type Response, type NextFunction } from 'express';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTOR_HEADER, resolveActor } from './actor.js';
import { DB_PATH, DEFAULT_GRAPH_ID, NO_SEED } from './db.js';
import { isCheckout } from './paths.js';
import { probeAtlas } from './status.js';
import { HOST, checkHost, checkOrigin, securityHeaders } from './security.js';
import { seed } from './seed.js';
import * as repo from './repo.js';
import { ConflictError } from './repo.js';
import { BundleError, bundleFilename, exportPipeline, importBundle, readBundle } from './bundle.js';
import { APP_NAME, APP_TITLE, APP_VERSION, BUNDLE_FORMAT, BUNDLE_VERSION, MIN_BUNDLE_VERSION } from './version.js';
import type { VersionInfo } from './types.js';

if (!NO_SEED) seed(); // no-op once the database has content

const app = express();
app.disable('x-powered-by');
// No CORS: the app is same-origin (built, or proxied by Vite), so no other site
// needs to read this API. See `security.ts` for what these guard against.
app.use(securityHeaders, checkHost, checkOrigin);

/**
 * How big a `.atlas.json` upload may be. A bundle is a whole pipeline in one
 * body — every code, every prose flow, every column — so it is one or two
 * orders of magnitude larger than anything else this API accepts, and it gets
 * its own limit rather than dragging every other route up with it.
 *
 * The cap exists because the body is buffered whole, decoded to a string and
 * then `JSON.parse`d: peak memory is several times the file size, and a body
 * large enough to exhaust the heap takes the server down with it. A 413 is
 * recoverable and says what to do instead; an out-of-memory crash is neither.
 * `ATLAS_MAX_IMPORT` moves it for anyone who knows their machine can take it.
 */
export const MAX_IMPORT = process.env.ATLAS_MAX_IMPORT?.trim() || '128mb';

// Registered before the general parser so these two routes see the large limit;
// body-parser marks a request it has read, so the parser below then skips it.
app.post(['/api/pipelines/import', '/api/pipelines/validate'], express.json({ limit: MAX_IMPORT }));

// Everything else: prose descriptions and logic flows, generous but not a bundle.
app.use(express.json({ limit: '25mb' }));

const wrap = (fn: (req: Request, res: Response) => void) => (req: Request, res: Response, next: NextFunction) => {
  try { fn(req, res); } catch (err) { next(err); }
};
const notFound = (res: Response, what: string) => res.status(404).json({ error: `${what} not found` });

/** Which pipeline a request is about: `?graph=` if given, else the seeded one. */
const graphOf = (req: Request) => String(req.query.graph ?? DEFAULT_GRAPH_ID);

/** `?relink=1`, `?relink=true`, or `relink: true` in a JSON envelope. */
const flag = (value: unknown) => value === true || ['1', 'true', 'yes'].includes(String(value ?? '').toLowerCase());

/**
 * Who to credit for a write. `X-Atlas-User` if the caller says, otherwise the
 * machine's own name — never empty, so `updatedBy` always answers. Attribution
 * only: nothing verifies it, and no route is gated on it. See `actor.ts`.
 */
const actorOf = (req: Request) => resolveActor(req.header(ACTOR_HEADER));

app.get('/api/health', (_req, res) => res.json({ ok: true, version: APP_VERSION }));

/**
 * What this server is and which files it will accept. A client, a CI job or an
 * agent reads this first: `bundleVersion` says what an export will be written
 * as, and `minBundleVersion` says how far back an import can reach.
 */
app.get('/api/version', (_req, res) => {
  const info: VersionInfo = {
    name: APP_NAME,
    version: APP_VERSION,
    bundleFormat: BUNDLE_FORMAT,
    bundleVersion: BUNDLE_VERSION,
    minBundleVersion: MIN_BUNDLE_VERSION,
    node: process.versions.node,
    user: resolveActor(),
    db: DB_PATH,
  };
  res.json(info);
});

/* ------------------------------------------------------------- pipelines */

app.get('/api/pipelines', wrap((_req, res) => res.json(repo.listPipelines())));

app.post('/api/pipelines', wrap((req, res) => {
  const { name, description } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  res.status(201).json(repo.createPipeline(String(name), String(description ?? '')));
}));

app.patch('/api/pipelines/:id', wrap((req, res) => {
  const pipeline = repo.updatePipeline(req.params.id, req.body ?? {});
  return pipeline ? res.json(pipeline) : notFound(res, 'Pipeline');
}));

app.delete('/api/pipelines/:id', wrap((req, res) => {
  repo.deletePipeline(req.params.id);
  res.status(204).end();
}));

/* -------------------------------------------------------- share as a file */

app.get('/api/pipelines/:id/export', wrap((req, res) => {
  const bundle = exportPipeline(req.params.id);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${bundleFilename(bundle)}"`);
  res.send(JSON.stringify(bundle, null, 2));
}));

/**
 * Checks a file without writing anything: same gate the import runs, so a CI
 * job or an agent can find out whether a bundle would land, what it would be
 * upgraded from, and what would be repaired, before committing to it.
 */
app.post('/api/pipelines/validate', wrap((req, res) => {
  const { bundle, catalog, relink } = req.body ?? {};
  const { bundle: read, sourceVersion, upgrades, warnings, notes, converted } = readBundle(bundle ?? req.body, {
    catalog,
    relink: flag(relink ?? req.query.relink),
  });
  res.json({
    ok: true,
    pipeline: read.pipeline,
    counts: read.counts,
    source: { formatVersion: sourceVersion, generator: read.generator, exportedAt: read.exportedAt },
    upgrades,
    warnings,
    notes,
    ...(converted ? { converted } : {}),
  });
}));

/**
 * Accepts either the bundle on its own as the body, or the older
 * `{ bundle, name }` envelope. A bare bundle is what the app sends: it can hand
 * the file's own text straight to `fetch` without parsing and re-serialising a
 * pipeline-sized object in the browser first. The name for the new pipeline
 * then travels as `?name=`.
 *
 * A dbt `manifest.json` is accepted in place of a bundle, and the envelope may
 * carry its `catalog.json` as `catalog` for column types (see `dbt.ts`).
 *
 * `relink` derives edges from the declarations; `replace=<pipelineId>` swaps
 * that pipeline's contents in place, keeping its id. Both may come as query
 * parameters or envelope fields.
 */
app.post('/api/pipelines/import', wrap((req, res) => {
  const { bundle, name, catalog, relink, replace } = req.body ?? {};
  const chosen = name ?? req.query.name;
  const target = replace ?? req.query.replace;
  const result = importBundle(bundle ?? req.body, chosen ? String(chosen) : undefined, {
    catalog,
    relink: flag(relink ?? req.query.relink),
    replace: target ? String(target) : undefined,
  });
  res.status(result.replaced ? 200 : 201).json(result);
}));

/* ----------------------------------------------------------------- graph */

/**
 * `?view=summary` answers with ids, names, tags, status and `[source, target]`
 * edges only — a fraction of the size, and enough for any question about shape.
 */
app.get('/api/graph', wrap((req, res) => {
  const graphId = graphOf(req);
  if (!repo.getPipeline(graphId)) return notFound(res, 'Pipeline');
  if (req.query.view === 'summary') return res.json(repo.getGraphSummary(graphId));
  res.json({ ...repo.getGraph(graphId), tags: repo.listTags(graphId), pipelineId: graphId });
}));

app.post('/api/codes', wrap((req, res) => {
  const { name, tags, x, y, description, owner } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const graphId = graphOf(req);
  if (!repo.getPipeline(graphId)) return notFound(res, 'Pipeline');
  res.status(201).json(
    repo.createCode(
      graphId,
      {
        name,
        tags: Array.isArray(tags) ? tags.map(String) : [],
        x: Number(x) || 0,
        y: Number(y) || 0,
        description,
        owner,
      },
      actorOf(req),
    ),
  );
}));

app.patch('/api/codes/:id', wrap((req, res) => {
  const code = repo.updateCode(req.params.id, req.body ?? {}, actorOf(req));
  return code ? res.json(code) : notFound(res, 'Code');
}));

app.delete('/api/codes/:id', wrap((req, res) => {
  repo.deleteCode(req.params.id);
  res.status(204).end();
}));

app.post('/api/codes/:id/duplicate', wrap((req, res) => {
  const copy = repo.duplicateCode(req.params.id, Boolean(req.body?.withInputs), actorOf(req));
  return copy ? res.status(201).json(copy) : notFound(res, 'Code');
}));

app.post('/api/codes/:id/tags', wrap((req, res) => {
  const tag = String(req.body?.tag ?? '');
  if (!tag.trim()) return res.status(400).json({ error: 'tag is required' });
  res.json({ tags: repo.addTag(req.params.id, tag, actorOf(req)), ...repo.stewardshipOf(req.params.id) });
}));

app.delete('/api/codes/:id/tags/:tag', wrap((req, res) => {
  res.json({ tags: repo.removeTag(req.params.id, req.params.tag, actorOf(req)), ...repo.stewardshipOf(req.params.id) });
}));

app.post('/api/codes/:id/tags/:tag/primary', wrap((req, res) => {
  res.json({ tags: repo.setPrimaryTag(req.params.id, req.params.tag, actorOf(req)), ...repo.stewardshipOf(req.params.id) });
}));

app.get('/api/codes/:id/flow', wrap((req, res) => {
  const flow = repo.getFlow(req.params.id);
  return flow ? res.json(flow) : notFound(res, 'Code');
}));

app.put('/api/codes/:id/flow', wrap((req, res) => {
  const { steps } = req.body ?? {};
  const flow = repo.saveFlow(
    req.params.id,
    { steps: Array.isArray(steps) ? steps : [] },
    actorOf(req),
  );
  return flow ? res.json(flow) : notFound(res, 'Code');
}));

/* ------------------------------------------------------ inputs & outputs */

app.get('/api/codes/:id/linkable-assets', wrap((req, res) => {
  res.json(repo.assetsInGraphOfCode(req.params.id));
}));

app.post('/api/codes/:id/asset-links', wrap((req, res) => {
  const { direction, path, detail, tags, documented, provenance } = req.body ?? {};
  const result = repo.addAssetLink(
    req.params.id,
    {
      direction: direction === 'output' ? 'output' : 'input',
      path: String(path ?? ''),
      detail: String(detail ?? ''),
      tags: Array.isArray(tags) ? tags.map(String) : [],
      documented: Boolean(documented),
      provenance,
    },
    actorOf(req),
  );
  return result.code ? res.status(201).json(result) : notFound(res, 'Code');
}));

app.patch('/api/asset-links/:id', wrap((req, res) => {
  const result = repo.updateAssetLink(req.params.id, req.body ?? {}, actorOf(req));
  return result ? res.json(result) : notFound(res, 'Input or output');
}));

app.delete('/api/asset-links/:id', wrap((req, res) => {
  const code = repo.deleteAssetLink(req.params.id, actorOf(req));
  return code ? res.json({ code, assetId: null, edgesCreated: 0 }) : notFound(res, 'Input or output');
}));

/* ----------------------------------------------------------------- assets */

app.get('/api/assets', wrap((req, res) => {
  const graphId = graphOf(req);
  if (!repo.getPipeline(graphId)) return notFound(res, 'Pipeline');
  res.json(repo.listAssets(graphId));
}));

/** Every table in the pipeline with its columns: what the Schema tab draws. */
app.get('/api/schema', wrap((req, res) => {
  const graphId = graphOf(req);
  if (!repo.getPipeline(graphId)) return notFound(res, 'Pipeline');
  res.json(repo.getSchemaTables(graphId));
}));

app.post('/api/assets', wrap((req, res) => {
  const graphId = graphOf(req);
  if (!repo.getPipeline(graphId)) return notFound(res, 'Pipeline');
  const { name, materialization, description, producerCodeId, owner } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  res.status(201).json(
    repo.createAsset(
      graphId,
      {
        name: String(name),
        materialization: materialization ? String(materialization) : undefined,
        description: description ? String(description) : undefined,
        producerCodeId: producerCodeId ? String(producerCodeId) : null,
        owner: owner ? String(owner) : undefined,
      },
      actorOf(req),
    ),
  );
}));

app.delete('/api/assets/:id', wrap((req, res) => {
  repo.deleteAsset(decodeURIComponent(req.params.id));
  res.status(204).end();
}));

app.put('/api/assets/:id/schema', wrap((req, res) => {
  const { materialization, description, name, owner, createdAt, updatedAt, updatedBy, columns } = req.body ?? {};
  // Absent means "leave it"; only a supplied value is written. `name` renames
  // the asset and every declared path that pointed at it.
  const optional = (value: unknown) => (value === undefined ? undefined : String(value));
  const asset = repo.saveAssetSchema(
    decodeURIComponent(req.params.id),
    {
      materialization: String(materialization ?? 'table'),
      description: String(description ?? ''),
      name: optional(name),
      owner: optional(owner),
      createdAt: optional(createdAt),
      updatedAt: optional(updatedAt),
      updatedBy: optional(updatedBy),
      columns: Array.isArray(columns) ? columns : [],
    },
    actorOf(req),
  );
  return asset ? res.json(asset) : notFound(res, 'Asset');
}));

app.post('/api/pipelines/:id/relink', wrap((req, res) => {
  if (!repo.getPipeline(req.params.id)) return notFound(res, 'Pipeline');
  res.json({ edgesCreated: repo.relinkPipeline(req.params.id) });
}));

app.post('/api/edges', wrap((req, res) => {
  const { source, target } = req.body ?? {};
  if (!source || !target) return res.status(400).json({ error: 'source and target are required' });
  res.status(201).json(repo.addEdge(source, target, actorOf(req)));
}));

app.delete('/api/edges/:id', wrap((req, res) => {
  repo.removeEdge(req.params.id, actorOf(req));
  res.status(204).end();
}));

app.get('/api/assets/:id', wrap((req, res) => {
  const asset = repo.getAsset(decodeURIComponent(req.params.id));
  return asset ? res.json(asset) : notFound(res, 'Asset');
}));

/**
 * Once the web app has been built, the API serves it too — so `npm run build &&
 * npm start` is a single process on a single port, with no CORS and no second
 * server. In development Vite serves it instead and proxies /api here.
 */
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    // Unmatched API paths must still 404 as JSON, so hand them to the 404 below.
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(join(webDist, 'index.html'));
  });
}

/**
 * An unmatched API path answers as JSON, like every other failure in this file:
 * Express's own 404 is an HTML page, which a client parsing the body as JSON
 * hits as a syntax error rather than a usable `{ error }`. Mounted rather than
 * routed so every verb is covered, and outside the `webDist` block because an
 * API-only run (no web build) has no fallthrough handler at all.
 */
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ConflictError) return res.status(409).json({ error: err.message });
  if (err instanceof BundleError) return res.status(422).json({ error: err.message });

  // body-parser's own failures, which used to fall through as a bare 500 whose
  // message ("request entity too large") named neither the limit nor the way out.
  const bodyError = err as { type?: string; length?: number };
  if (bodyError?.type === 'entity.too.large') {
    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
    return res.status(413).json({
      error:
        `That file is ${bodyError.length ? mb(bodyError.length) : 'larger'} — over the ${MAX_IMPORT} an upload may be. ` +
        'Import it from the command line instead: `lineage-atlas import <file>` reads the file directly, with no upload and no limit. ' +
        'Or raise ATLAS_MAX_IMPORT and restart the server.',
    });
  }
  if (bodyError?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'That file is not valid JSON.' });
  }

  // The detail (SQL, file paths) goes to the log, not to whoever sent the request.
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error — see the server log for details.' });
});

/* ------------------------------------------------------------- listening */

/**
 * Deliberately not `PORT`: some dev harnesses inject that for the web server,
 * and the API would then steal the port Vite is meant to bind.
 *
 * Whether a busy port is fatal depends on who is asking:
 *
 *  - `ATLAS_PORT` set — that port or nothing. A script told to use 5174 should
 *    fail loudly rather than quietly answer somewhere else.
 *  - **A checkout** — 5174 or nothing, for the same reason: `web/vite.config.ts`
 *    proxies `/api` to 5174 by name, so an API that quietly moved to 5175 would
 *    leave the dev web app talking to whatever *else* is on 5174. Failing here
 *    is the whole point.
 *  - **An installed copy** — walk to the next free port. Nothing proxies to it
 *    by number, someone is watching the startup line, and a second atlas (or a
 *    stale process) should not block a start.
 */
const FIRST_PORT = 5174;
const pinned = process.env.ATLAS_PORT ? Number(process.env.ATLAS_PORT) : null;
const candidates =
  pinned !== null || isCheckout
    ? [pinned ?? FIRST_PORT]
    : [...Array.from({ length: 10 }, (_, i) => FIRST_PORT + i), 0];

/**
 * Opening a browser is right for someone who just typed `npx lineage-atlas`
 * and wrong for a container, a CI job or a service manager. A TTY is the
 * closest thing to "a person is watching"; `ATLAS_NO_OPEN` settles it either
 * way, and the URL is always printed regardless.
 */
function shouldOpenBrowser(): boolean {
  return !process.env.ATLAS_NO_OPEN && process.stdout.isTTY === true;
}

function openBrowser(url: string): void {
  const opener: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  // Detached so the app is neither held open by the browser nor killed with it.
  const child = spawn(opener[0], opener[1], { stdio: 'ignore', detached: true });
  child.on('error', () => {}); // headless box, or no opener installed
  child.unref();
}

function announce(port: number): void {
  const servingUi = existsSync(webDist);
  const what = servingUi ? APP_TITLE : `${APP_TITLE} API`;
  const url = `http://localhost:${port}`;
  console.log(`${what} ${APP_VERSION} (file format ${BUNDLE_VERSION}) on ${url}`);
  console.log(`Data: ${DB_PATH}`);
  if (servingUi && shouldOpenBrowser()) openBrowser(url);
}

/**
 * Names what is holding a busy port, in one line. The line that matters has to
 * come first and stand alone: run through npm, it is followed by a screenful of
 * `npm error` noise, and the tail of that is all an agent or a CI log shows.
 */
async function describeBusy(port: number): Promise<string> {
  const atlas = await probeAtlas(port);
  if (!atlas) return `Port ${port} is already in use by another program`;
  const db = atlas.db ? `, db ${atlas.db}` : '';
  return `Port ${port} is already in use by Lineage Atlas ${atlas.version}${db} (it answered /api/version)`;
}

function listen(index: number): void {
  const port = candidates[index];
  const server = app.listen(port, HOST);
  server.once('listening', () => announce((server.address() as AddressInfo).port));
  server.once('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EADDRINUSE') {
      console.error(err);
      process.exit(1);
    }
    void describeBusy(port).then((busy) => {
      if (index + 1 < candidates.length) {
        if (port) console.log(`${busy}; trying ${candidates[index + 1] || 'any free port'}.`);
        return listen(index + 1);
      }
      console.error(
        `${busy}. Not starting.\n` +
          (busy.includes('Lineage Atlas')
            ? `  It is probably already running — use it, or run \`lineage-atlas status\`. Pick a different ATLAS_PORT (or --port) to start a second one.`
            : '  Set ATLAS_PORT (or --port) to choose another port.'),
      );
      process.exit(1);
    });
  });
}

listen(0);
