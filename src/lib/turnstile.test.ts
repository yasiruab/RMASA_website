import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildAllowedHostnames, verifyTurnstileToken, type TurnstileVerifyOptions } from "./turnstile.ts";

function fakeFetch(response: Record<string, unknown>): typeof fetch {
  return (async () => new Response(JSON.stringify(response))) as typeof fetch;
}

function options(overrides: Partial<TurnstileVerifyOptions>): TurnstileVerifyOptions {
  return {
    secret: "secret",
    isProduction: true,
    allowedHostnames: ["royalmasarena.lk", "www.royalmasarena.lk"],
    fetchImpl: fakeFetch({ success: true, hostname: "royalmasarena.lk" }),
    ...overrides,
  };
}

test("missing secret fails open outside production", async () => {
  const result = await verifyTurnstileToken("t", null, options({ secret: "", isProduction: false }));
  assert.equal(result.success, true);
});

test("missing secret fails closed in production", async () => {
  const result = await verifyTurnstileToken("t", null, options({ secret: "" }));
  assert.equal(result.success, false);
});

test("missing token is rejected", async () => {
  const result = await verifyTurnstileToken("", null, options({}));
  assert.equal(result.success, false);
});

test("a valid token for the site's hostname passes", async () => {
  const result = await verifyTurnstileToken("t", null, options({}));
  assert.deepEqual(result, { success: true });
});

test("a valid token issued for another hostname is rejected", async () => {
  const result = await verifyTurnstileToken(
    "t",
    null,
    options({ fetchImpl: fakeFetch({ success: true, hostname: "evil.example" }) }),
  );
  assert.equal(result.success, false);
});

test("hostname is not checked when no allowlist is configured", async () => {
  const result = await verifyTurnstileToken(
    "t",
    null,
    options({ allowedHostnames: [], fetchImpl: fakeFetch({ success: true, hostname: "localhost" }) }),
  );
  assert.equal(result.success, true);
});

test("a failed Cloudflare verification is rejected", async () => {
  const result = await verifyTurnstileToken(
    "t",
    null,
    options({ fetchImpl: fakeFetch({ success: false, "error-codes": ["invalid-input-response"] }) }),
  );
  assert.equal(result.success, false);
});

test("buildAllowedHostnames adds the www/apex twin and extra names", () => {
  assert.deepEqual(buildAllowedHostnames("https://royalmasarena.lk", undefined).sort(), [
    "royalmasarena.lk",
    "www.royalmasarena.lk",
  ]);
  assert.deepEqual(
    buildAllowedHostnames("https://www.example.com/", " Main.Example.Amplifyapp.com , ").sort(),
    ["example.com", "main.example.amplifyapp.com", "www.example.com"],
  );
  assert.deepEqual(buildAllowedHostnames("not a url", undefined), []);
});
