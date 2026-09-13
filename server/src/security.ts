import type { NextFunction, Request, Response } from 'express';

/**
 * Who may talk to the API.
 *
 * Atlas has no login (see `actor.ts`), so "anyone who reaches the API can edit
 * the graph" — which makes *who can reach it* the whole security model. Three
 * ways something other than the person at the keyboard could otherwise reach it:
 *
 *  - **Another machine on the network.** The server binds to loopback unless
 *    `ATLAS_HOST` says otherwise, so the LAN never sees it by default.
 *  - **A web page open in the same browser.** Any site can `fetch` a localhost
 *    port. With no CORS headers the browser refuses to let it read replies or
 *    send JSON writes, and the Origin check below refuses the simple
 *    form-encoded requests that would slip past CORS without a preflight.
 *  - **DNS rebinding.** A hostile domain re-pointed at 127.0.0.1 *is* same-origin
 *    to the browser, so CORS does nothing; but its requests still carry that
 *    domain in `Host`, which the Host check refuses.
 */

/** The interface to listen on. Loopback unless someone deliberately opens it up. */
export const HOST = process.env.ATLAS_HOST?.trim() || '127.0.0.1';

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Extra host names the server should answer to, for anyone who set `ATLAS_HOST`
 * to serve a team: `ATLAS_ALLOWED_HOSTS=atlas.internal,10.0.0.12`.
 */
const EXTRA_HOSTS = new Set(
  (process.env.ATLAS_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);
if (HOST !== '127.0.0.1' && HOST !== '::1' && HOST !== 'localhost') {
  // Binding to a specific address means that address is a legitimate Host.
  if (HOST !== '0.0.0.0' && HOST !== '::') EXTRA_HOSTS.add(HOST.toLowerCase());
}

/** `localhost:5174` → `localhost`, `[::1]:5174` → `[::1]`. */
function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0];
}

function isAllowedHostname(name: string): boolean {
  return LOOPBACK_NAMES.has(name) || name.endsWith('.localhost') || EXTRA_HOSTS.has(name);
}

/** Refuses requests whose `Host` is not this machine (or an allowed name): DNS rebinding. */
export function checkHost(req: Request, res: Response, next: NextFunction): void {
  const host = req.headers.host;
  if (host && isAllowedHostname(hostnameOf(host))) return next();
  res.status(403).json({
    error: 'Host not allowed. Set ATLAS_ALLOWED_HOSTS to serve Atlas under another name.',
  });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuses writes sent by a page on another origin. Browsers always send
 * `Origin` on cross-origin writes; curl, scripts and agents send none and are
 * let through, since they are already on the machine.
 */
export function checkOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (SAFE_METHODS.has(req.method) || !origin) return next();
  try {
    const url = new URL(origin);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && isAllowedHostname(url.hostname.toLowerCase())) {
      return next();
    }
    // Same origin as the request itself, whatever name that is.
    if (req.headers.host && url.host.toLowerCase() === req.headers.host.toLowerCase()) return next();
  } catch {
    // `Origin: null` (sandboxed frames, file://) and garbage fall through to refusal.
  }
  res.status(403).json({ error: 'Cross-origin writes are not allowed.' });
}

/**
 * Response headers for everything the server sends: no MIME sniffing, no
 * framing (a hostile page cannot overlay the app and steal clicks on Delete),
 * and a CSP that keeps the built app to its own scripts and Google Fonts.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
}
