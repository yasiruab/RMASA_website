// Forwards a contact-form submission to the optional CONTACT_WEBHOOK_URL.
// Pure (fetch is injected) so `npm test` can load it.

// The webhook receiver is a third party we don't control. Without a timeout a
// slow or hung receiver holds the anonymous POST /api/contact request open
// until the Lambda times out, and the visitor sees a spinner instead of
// "Enquiry sent".
export const CONTACT_WEBHOOK_TIMEOUT_MS = 5_000;

/** POSTs `payload` as JSON. Returns true on a 2xx; false on error, non-2xx or timeout. */
export async function postContactWebhook(
  url: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = CONTACT_WEBHOOK_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}
