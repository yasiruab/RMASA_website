import { createHash, timingSafeEqual } from "node:crypto";

// Shared-secret auth for the GitHub Actions cron routes. Cron has no user, so
// it can't go through NextAuth. On the `_AMPLIFY_*` leak-guard allowlist —
// import it only from server route handlers.

const CRON_SECRET = process.env.CRON_SECRET ?? process.env._AMPLIFY_CRON_SECRET ?? "";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * True when `authorizationHeader` is exactly `Bearer <secret>`. Compares fixed-
 * length digests with timingSafeEqual so response timing doesn't leak how much
 * of the secret matched. An empty secret never authorises anything.
 */
export function hasValidCronSecret(authorizationHeader: string | null, secret: string = CRON_SECRET): boolean {
  if (!secret) return false;
  return timingSafeEqual(sha256(authorizationHeader ?? ""), sha256(`Bearer ${secret}`));
}
