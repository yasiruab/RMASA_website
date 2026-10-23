// Which routes Microsoft Clarity must never record. Pure (no `@/` imports) so
// `npm test` can load it.

/** True for /admin and everything under it — those pages show customer PII. */
export function isClarityExcludedPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}
