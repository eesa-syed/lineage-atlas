import { userInfo } from 'node:os';

/**
 * Who is editing.
 *
 * Atlas has no accounts and no login — it is a local tool, and inventing an
 * auth model to fill in one field would be the wrong trade. But "who last
 * touched this?" is worth recording even so, so every write resolves an
 * *actor*: a short free-text name, stamped onto the record it changes.
 *
 * Three sources, most specific first:
 *
 *  1. the `X-Atlas-User` header on the request — how an agent, a script or a
 *     shared deployment says who it is acting for;
 *  2. `ATLAS_USER` in the environment — how a machine names itself once;
 *  3. the operating-system user — the honest default for a checkout on a laptop.
 *
 * It is attribution, not authentication: nothing verifies it and nothing is
 * gated on it. Treat it the way you would a git author line.
 */
export const ACTOR_HEADER = 'x-atlas-user';

/** How long a name may be before it stops being a name. */
const MAX_ACTOR = 80;

const MACHINE_ACTOR = ((): string => {
  const configured = process.env.ATLAS_USER?.trim();
  if (configured) return configured.slice(0, MAX_ACTOR);
  try {
    return userInfo().username || 'unknown';
  } catch {
    // No passwd entry — a container running as a bare uid, typically.
    return 'unknown';
  }
})();

/**
 * The name to stamp on this write. Never empty: a blank or missing value falls
 * back to the machine's own, so `updatedBy` always answers the question.
 */
export function resolveActor(supplied?: unknown): string {
  const given = typeof supplied === 'string' ? supplied.trim().slice(0, MAX_ACTOR) : '';
  return given || MACHINE_ACTOR;
}
