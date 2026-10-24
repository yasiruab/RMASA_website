import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildAdminCsp, buildPublicCsp, isAdminPath } from "./csp.ts";

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

test("admin policy uses a nonce and never allows inline scripts", () => {
  const csp = buildAdminCsp("abc123", false);
  const scriptSrc = directive(csp, "script-src");
  assert.match(scriptSrc, /'nonce-abc123'/);
  assert.match(scriptSrc, /'strict-dynamic'/);
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
  assert.doesNotMatch(scriptSrc, /'unsafe-eval'/);
});

test("admin policy loads no third-party script or connect hosts", () => {
  const csp = buildAdminCsp("n", false);
  assert.doesNotMatch(directive(csp, "script-src"), /https:/);
  assert.equal(directive(csp, "connect-src"), "connect-src 'self'");
  assert.equal(directive(csp, "object-src"), "object-src 'none'");
});

test("unsafe-eval is added in development only", () => {
  assert.match(directive(buildAdminCsp("n", true), "script-src"), /'unsafe-eval'/);
  assert.match(directive(buildPublicCsp(true), "script-src"), /'unsafe-eval'/);
  assert.doesNotMatch(directive(buildPublicCsp(false), "script-src"), /'unsafe-eval'/);
});

test("public policy keeps the hosts the public pages load", () => {
  const scriptSrc = directive(buildPublicCsp(false), "script-src");
  assert.match(scriptSrc, /https:\/\/www\.clarity\.ms/);
  assert.match(scriptSrc, /https:\/\/challenges\.cloudflare\.com/);
  assert.match(directive(buildPublicCsp(false), "frame-src"), /https:\/\/www\.google\.com/);
});

test("both policies keep the framing and base-uri lockdown", () => {
  for (const csp of [buildPublicCsp(false), buildAdminCsp("n", false)]) {
    assert.equal(directive(csp, "frame-ancestors"), "frame-ancestors 'none'");
    assert.equal(directive(csp, "base-uri"), "base-uri 'none'");
    assert.equal(directive(csp, "form-action"), "form-action 'self'");
  }
});

test("isAdminPath matches /admin routes only", () => {
  assert.equal(isAdminPath("/admin"), true);
  assert.equal(isAdminPath("/admin/calendar/bookings"), true);
  assert.equal(isAdminPath("/administration"), false);
  assert.equal(isAdminPath("/bookings"), false);
});
