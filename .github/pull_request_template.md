## What and why

<!-- What does this change, and what problem does it solve? Link the issue: "Closes #123". -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor / tooling (no user-visible change)
- [ ] **Breaking** — changes the `.atlas.json` format, an API response shape, or how Atlas is started or configured

## How I tested it

<!--
There is no test suite yet, so say what you actually did: the steps you clicked
through, the API calls you made, or `npm run validate` against a fixture.
Screenshots or a GIF for UI changes, please.
-->

## Checklist

- [ ] One concern in this PR
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes (includes the version check)
- [ ] Matches the surrounding code — comments explain *why*, colours come from `tokens.css`
- [ ] If I changed shared types, `server/src/types.ts` and `web/src/types.ts` still mirror each other
- [ ] If users can see the change, `README.md` / `docs/` are updated
- [ ] If I changed the file format: bumped `BUNDLE_VERSION`, added one `UPGRADES` rung, and updated `docs/FILE_FORMAT.md`
- [ ] If I changed how Atlas is started, configured or installed: updated `PROJECT_DOCUMENTATION.md`, `docs/AI_AGENTS.md` and the skill under `.claude/`
- [ ] `CHANGELOG.md` has an entry under **Unreleased** (for anything user-visible)

See [CONTRIBUTING.md](https://github.com/eesa-syed/lineage-atlas/blob/main/CONTRIBUTING.md) for details. By contributing you agree to follow the [Code of Conduct](https://github.com/eesa-syed/lineage-atlas/blob/main/CODE_OF_CONDUCT.md).
