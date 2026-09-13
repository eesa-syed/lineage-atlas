# Contributing to Lineage Atlas

Thanks for looking. This is a small, deliberately unclever codebase — hand-written
SQL, one state store, plain CSS — and it is easier to keep it that way than to get
it back.

## Getting set up

```bash
npm install
npm run dev
```

Requires **Node 24 or newer** — the first release with `node:sqlite`
unflagged. There is no native build step (SQLite comes from
Node itself), so `npm install` needs no compiler. The app is on
<http://localhost:5173>, the API on `5174`, and a demo warehouse is seeded into
`data/atlas.db` on first run.

A checkout always keeps its database in `data/`, so working on the code never
touches the one an installed copy uses (`npx lineage-atlas`, which stores it
under your user data directory instead). `server/src/paths.ts` decides which,
and `ATLAS_DB` overrides both.

Before opening a pull request:

```bash
npm run typecheck    # both workspaces
npm run build        # includes the version check
```

## Where things live

| You want to change | Look at |
|---|---|
| The database schema, or a migration | `server/src/db.ts` |
| Any read or mutation | `server/src/repo.ts` |
| The `.atlas.json` format | `server/src/bundle.ts` + `docs/FILE_FORMAT.md` |
| An HTTP route | `server/src/index.ts` |
| Startup: port selection, opening a browser, what the first lines print | `server/src/index.ts` (bottom) |
| The installed `lineage-atlas` command, or its flags | `bin/lineage-atlas.mjs` |
| Where the database file lives | `server/src/paths.ts` |
| What the published package contains | `files` / `bin` in the root `package.json` |
| Shared types | `server/src/types.ts`, mirrored by hand in `web/src/types.ts` |
| App state or any server call from the UI | `web/src/state/store.ts` |
| A colour | `web/src/styles/tokens.css` — and nowhere else |

[PROJECT_DOCUMENTATION.md](PROJECT_DOCUMENTATION.md) is a full tour of the
codebase, module by module.

## Conventions worth knowing before you start

**No ORM.** Every query is hand-written SQL through the `all` / `get` / `run`
helpers in `db.ts`, with **positional parameters only** — `node:sqlite` is
stricter about named parameters than `better-sqlite3` was. Anything that touches
more than one table goes inside `tx()`.

**Types are mirrored by hand.** `web/src/types.ts` mirrors `server/src/types.ts`;
there is no shared package. Change one, change the other.

**Colour is information.** Three separate channels: the main tag colours a code,
status is its own dot, and the accent (signal orange) means selection and active
lineage and nothing else. Keep them distinct. Every colour is a token in
`tokens.css`.

**The graph is acyclic, on every path in.** A manual edge that would close a
cycle is refused, an inferred one is skipped, and an imported one is dropped with
a warning. If you add a fourth way for an edge to be created, it enforces this
too.

**Whole-document writes replace.** `saveFlow` and `saveAssetSchema` delete and
reinsert inside a transaction rather than diffing rows. They are edited as whole
forms, so this is simpler and less racy. Keep it that way.

## Changing the file format

The format is an interchange contract; files written by older builds are in other
people's hands. To change it:

1. Change the shape and bump `BUNDLE_VERSION` in `server/src/version.ts`.
2. Add **exactly one** rung to `UPGRADES` in `server/src/bundle.ts`, keyed by the
   version it upgrades *from*, with a `note` written for a human to read. Never
   edit an existing rung and never renumber.
3. Add a row to the version-history table in `docs/FILE_FORMAT.md`, and update
   the spec body to match.
4. Test the ladder end to end: write a file at the old version by hand, then
   `npm run validate -- old.atlas.json` and check the upgrade notes are accurate.

If the change also alters the database, add the matching migration in `db.ts`.
Steps 1 through 4 of the ladder mirror database migrations one for one, and that
correspondence is worth keeping.

Raising `MIN_BUNDLE_VERSION` drops support for old files. That is a breaking
change and belongs in a major release.

## Releasing

1. Set the new version in `server/src/version.ts` (`APP_VERSION`) **and** all
   three `package.json` files. `npm run check:version` enforces the match and
   runs as the first step of `npm run build`.
2. Add a `CHANGELOG.md` entry. Call out any change to the file format or the API
   response shapes explicitly — those are what break other people.
3. `npm run build && npm start`, and check `GET /api/version` reports what you
   expect.
4. `npm pack --dry-run` and read the file list. The published package is the
   root workspace: `bin/`, `server/dist/`, `web/dist/` and the docs, with the
   three runtime dependencies declared at the root so an install resolves them.
   Nothing in `src` ships — which is also what tells an installed copy apart
   from a checkout when it decides where to keep its database (see
   `server/src/paths.ts`), so a change to `files` that starts shipping `src`
   would quietly move everyone's data.
5. `npm publish`. `prepublishOnly` runs the full build first, so a stale `dist`
   cannot ship. Afterwards, `npx lineage-atlas@<version> version` from a
   directory that is *not* a checkout is the cheapest end-to-end check that the
   published artefact actually runs.

## Pull requests

- One concern per PR.
- Match the surrounding code: comment density, naming, and the existing idioms.
  Comments here explain *why*, not what.
- If you change behaviour a user can see, update `README.md`. If you change the
  format or the API, update the relevant file in `docs/`. If you change how the
  app is started, configured or installed, that reaches `README.md`,
  `PROJECT_DOCUMENTATION.md` §4.1/§12, and — because agents hard-code less when
  the docs say not to — `docs/AI_AGENTS.md` and the skill under `.claude/`.
- Say what you tested. There is no test suite yet; `npm run validate` against a
  hand-written fixture is a legitimate and useful way to test format changes, and
  a contribution that adds a real test suite would be very welcome.

## Reporting a bug

Include the output of `GET /api/version` (or `npm run version:show -w server`),
what you did, what happened, and what you expected. If it involves a file,
attach the output of `npm run validate -- yourfile.atlas.json` — it usually says
exactly what is wrong.

## Code of conduct

Be decent to people. Assume good faith, take criticism about code as being about
code, and leave the project friendlier than you found it.
