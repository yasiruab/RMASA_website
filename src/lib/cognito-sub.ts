// Decides how a sign-in's Cognito `sub` relates to the one stored on the
// Postgres User row. Pure so `npm test` can load it.
//
// `sub` is Cognito's immutable user id. It is stored on first sign-in
// (trust-on-first-use). After that it must match: if the Cognito user is
// deleted and recreated with the same email — by mistake or by someone with
// pool access — the new identity gets a new `sub` and must not silently
// inherit the existing admin row.

export type CognitoSubCheck = "match" | "backfill" | "mismatch" | "missing";

export function checkCognitoSub(stored: string | null | undefined, incoming: unknown): CognitoSubCheck {
  if (typeof incoming !== "string" || !incoming) return "missing";
  if (!stored) return "backfill";
  return stored === incoming ? "match" : "mismatch";
}
