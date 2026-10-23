// Server-side Cloudflare Turnstile token verification.
//
// Missing secret: fail-open in development (so local dev works without keys) but
// fail CLOSED in production — a dropped Amplify env bake must not silently remove
// the only bot control on the anonymous booking and contact endpoints.
//
// Hostname: in production the hostname Cloudflare reports for the solved
// challenge must be the site's own (from NEXTAUTH_URL, plus its www/apex twin,
// plus any extra names in TURNSTILE_ALLOWED_HOSTNAMES, comma-separated).

const SECRET =
  process.env.TURNSTILE_SECRET_KEY ?? process.env._AMPLIFY_TURNSTILE_SECRET_KEY ?? "";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileVerifyResult =
  | { success: true; skipped?: false }
  | { success: true; skipped: true; reason: string }
  | { success: false; error: string };

export type TurnstileVerifyOptions = {
  secret: string;
  isProduction: boolean;
  /** Empty → hostname is not checked. */
  allowedHostnames: string[];
  fetchImpl: typeof fetch;
};

/** Site hostname from NEXTAUTH_URL, its www/apex twin, and any extra names. */
export function buildAllowedHostnames(siteUrl: string | undefined, extra: string | undefined): string[] {
  const names = new Set<string>();
  if (siteUrl) {
    try {
      const host = new URL(siteUrl).hostname.toLowerCase();
      names.add(host);
      names.add(host.startsWith("www.") ? host.slice(4) : `www.${host}`);
    } catch {
      // Malformed NEXTAUTH_URL — fall through to the extra list only.
    }
  }
  for (const name of (extra ?? "").split(",")) {
    const trimmed = name.trim().toLowerCase();
    if (trimmed) names.add(trimmed);
  }
  return [...names];
}

function defaultOptions(): TurnstileVerifyOptions {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    secret: SECRET,
    isProduction,
    allowedHostnames: isProduction
      ? buildAllowedHostnames(
          process.env.NEXTAUTH_URL,
          process.env.TURNSTILE_ALLOWED_HOSTNAMES ?? process.env._AMPLIFY_TURNSTILE_ALLOWED_HOSTNAMES,
        )
      : [],
    fetchImpl: fetch,
  };
}

export async function verifyTurnstileToken(
  token: string | undefined | null,
  remoteIp?: string | null,
  options: TurnstileVerifyOptions = defaultOptions(),
): Promise<TurnstileVerifyResult> {
  if (!options.secret) {
    if (options.isProduction) {
      console.error("[turnstile] TURNSTILE_SECRET_KEY is not configured in production — rejecting request.");
      return { success: false, error: "Bot verification is not configured." };
    }
    return { success: true, skipped: true, reason: "TURNSTILE_SECRET_KEY not configured" };
  }
  if (!token || typeof token !== "string") {
    return { success: false, error: "Missing Turnstile token." };
  }

  const body = new URLSearchParams({ secret: options.secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await options.fetchImpl(VERIFY_URL, { method: "POST", body });
    const data = (await res.json()) as {
      success: boolean;
      hostname?: string;
      "error-codes"?: string[];
    };
    if (!data.success) {
      const codes = (data["error-codes"] ?? []).join(", ") || "unknown";
      return { success: false, error: `Turnstile verification failed: ${codes}` };
    }
    const hostname = (data.hostname ?? "").toLowerCase();
    if (options.allowedHostnames.length > 0 && !options.allowedHostnames.includes(hostname)) {
      return { success: false, error: `Turnstile token was issued for an unexpected host: ${hostname || "none"}` };
    }
    return { success: true };
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
