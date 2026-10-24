// Content-Security-Policy builders. Pure (no `@/` imports) so `npm test`,
// next.config.ts and src/middleware.ts can all load it.
//
// Two policies:
//
// - PUBLIC (static, set in next.config.ts headers()): the public pages are
//   prerendered and CDN-cached, so they can't carry a per-request nonce. Next's
//   App Router writes its page data as inline <script> tags, so this policy
//   needs `'unsafe-inline'` on script-src. Public pages render no customer- or
//   admin-supplied text, which keeps the XSS exposure low.
//
// - ADMIN (per request, set by src/middleware.ts on /admin/*): admin pages are
//   already rendered per request and are where customer PII and admin sessions
//   live, so they get a strict nonce-based script-src with no `'unsafe-inline'`.
//   Next reads the nonce from the request's CSP header and stamps it on its own
//   scripts; `'strict-dynamic'` lets those trusted scripts load the JS chunks.
//   Admin pages load no Clarity or Turnstile scripts, so no third-party hosts.
//
// 'unsafe-eval' is added in development only: React Refresh evaluates strings
// as JS, and blocking it halts the dev bundle before hydration.

const SHARED_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
];

function devEval(isDev: boolean): string {
  return isDev ? " 'unsafe-eval'" : "";
}

/** Static policy for every non-admin route. */
export function buildPublicCsp(isDev: boolean): string {
  return [
    ...SHARED_DIRECTIVES,
    `script-src 'self' 'unsafe-inline'${devEval(isDev)} https://www.clarity.ms https://*.clarity.ms https://challenges.cloudflare.com`,
    "connect-src 'self' https://*.clarity.ms https://challenges.cloudflare.com",
    "img-src 'self' data: https://*.clarity.ms",
    "frame-src https://challenges.cloudflare.com https://www.google.com",
  ].join("; ");
}

/** Strict per-request policy for /admin/*. `nonce` must be fresh per request. */
export function buildAdminCsp(nonce: string, isDev: boolean): string {
  return [
    ...SHARED_DIRECTIVES,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval(isDev)}`,
    "connect-src 'self'",
    "img-src 'self' data:",
    "frame-src 'none'",
    "object-src 'none'",
  ].join("; ");
}

/** True for /admin and everything under it — the routes the strict policy covers. */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}
