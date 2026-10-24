// Retry helper for inserts keyed by a randomly generated unique value.
// Pure so `npm test` can load it.

/** True for a Prisma unique-constraint violation (P2002) on `field`. Matches
 *  structurally so this file needs no Prisma import. */
export function isUniqueViolationOn(error: unknown, field: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, meta } = error as { code?: unknown; meta?: { target?: unknown } };
  if (code !== "P2002") return false;
  const target = meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  return typeof target === "string" && target.includes(field);
}

/**
 * Runs `attempt(n)` (n = 1, 2, …) until it succeeds, retrying only when
 * `shouldRetry` says the failure was a collision. Any other error, or a
 * collision on the last attempt, is rethrown.
 */
export async function retryOnCollision<T>(
  attempt: (n: number) => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  maxAttempts: number,
): Promise<T> {
  for (let n = 1; ; n += 1) {
    try {
      return await attempt(n);
    } catch (error) {
      if (n >= maxAttempts || !shouldRetry(error)) throw error;
    }
  }
}
