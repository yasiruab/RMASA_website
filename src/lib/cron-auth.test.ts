import { strict as assert } from "node:assert";
import { test } from "node:test";
import { hasValidCronSecret } from "./cron-auth.ts";

test("accepts the exact bearer secret", () => {
  assert.equal(hasValidCronSecret("Bearer s3cret", "s3cret"), true);
});

test("rejects a wrong, partial, or differently formatted secret", () => {
  assert.equal(hasValidCronSecret("Bearer wrong", "s3cret"), false);
  assert.equal(hasValidCronSecret("Bearer s3cre", "s3cret"), false);
  assert.equal(hasValidCronSecret("s3cret", "s3cret"), false);
  assert.equal(hasValidCronSecret("bearer s3cret", "s3cret"), false);
});

test("rejects a missing header", () => {
  assert.equal(hasValidCronSecret(null, "s3cret"), false);
});

test("an unset secret authorises nothing, not even an empty bearer", () => {
  assert.equal(hasValidCronSecret("Bearer ", ""), false);
  assert.equal(hasValidCronSecret(null, ""), false);
});
