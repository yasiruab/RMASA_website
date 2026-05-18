// Server-side Cloudflare Turnstile token verification.
// Fail-open if no secret is configured so the booking form keeps working
// before the production secret is set in Amplify.

const SECRET =
  process.env.TURNSTILE_SECRET_KEY ?? process.env._AMPLIFY_TURNSTILE_SECRET_KEY ?? "";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileVerifyResult =
  | { success: true; skipped?: false }
  | { success: true; skipped: true; reason: string }
  | { success: false; error: string };

export async function verifyTurnstileToken(
  token: string | undefined | null,
  remoteIp?: string | null,
): Promise<TurnstileVerifyResult> {
  if (!SECRET) {
    return { success: true, skipped: true, reason: "TURNSTILE_SECRET_KEY not configured" };
  }
  if (!token || typeof token !== "string") {
    return { success: false, error: "Missing Turnstile token." };
  }

  const body = new URLSearchParams({ secret: SECRET, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    const data = (await res.json()) as { success: boolean; "error-codes"?: string[] };
    if (data.success) return { success: true };
    const codes = (data["error-codes"] ?? []).join(", ") || "unknown";
    return { success: false, error: `Turnstile verification failed: ${codes}` };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Turnstile verify request failed.",
    };
  }
}

export function isTurnstileConfigured(): boolean {
  return SECRET.length > 0;
}
