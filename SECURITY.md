# Security policy

## Supported versions

Lineage Atlas is maintained on a single line. Security fixes land on `main` and
ship in the next release; older releases are not patched.

| Version | Supported |
|---|---|
| Latest release (`1.x`) and `main` | ✅ |
| Anything older | ❌ — upgrade with `npx lineage-atlas@latest` |

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a security
problem.**

Report it privately through GitHub instead:
[**Report a vulnerability**](https://github.com/eesa-syed/lineage-atlas/security/advisories/new)
(the *Security* tab → *Report a vulnerability*). Only the maintainer can see it.

A useful report includes:

- The output of `GET /api/version` (or `lineage-atlas version`).
- How Atlas was run: `npx lineage-atlas`, a checkout with `npm run dev`, or a
  built server — and any `ATLAS_*` environment variables that were set,
  especially `ATLAS_HOST` and `ATLAS_ALLOWED_HOSTS`.
- Steps to reproduce, and what an attacker gains (read, edit, delete, code
  execution, …).
- For import problems, a minimal `.atlas.json` or dbt `manifest.json` that
  triggers it.

### What to expect

- An acknowledgement within **7 days**.
- An assessment — confirmed, needs more information, or out of scope — within
  **14 days**.
- For a confirmed issue, a fix and a published GitHub security advisory, with
  credit to you unless you would rather stay anonymous. The fix is also called
  out under **Security** in [`CHANGELOG.md`](CHANGELOG.md).

This is a small project maintained in spare time, so these are targets rather
than guarantees. Please give a reasonable window to fix the issue before
disclosing it publicly.

## Security model — what counts as a vulnerability

Atlas is a **single-user, local-first** tool with **no login**. Anyone who can
reach its API can read and edit every pipeline, so *who can reach it* is the
whole security model (see [README § Security model](README.md#security-model)
and `server/src/security.ts`).

**In scope** — please report:

- Another website open in the same browser reading or changing data on a
  default install (a CORS, `Origin` or `Host` check bypass, DNS rebinding).
- The server listening beyond loopback when `ATLAS_HOST` is not set.
- An imported `.atlas.json` or dbt project that can execute code, write files
  outside the database, or run script in the UI (XSS).
- Path traversal or arbitrary file reads through the CLI or API.
- Vulnerable dependencies that are actually reachable in Atlas.

**Out of scope** — expected behaviour, not a vulnerability:

- Anyone who can reach the API being able to edit it. That includes a server
  deliberately exposed with `ATLAS_HOST` — only do that on a network you trust.
- Edits attributed to a spoofed `X-Atlas-User` header; attribution is a
  convenience, not authentication.
- Attacks that need local access to your machine or your user account, such as
  reading the SQLite database file directly.
- Denial of service against your own local instance.
