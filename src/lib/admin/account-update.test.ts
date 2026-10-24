import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MAX_ACCOUNT_NAME_LEN, parseAccountUpdate } from "./account-update.ts";

test("accepts the fields the Accounts page sends", () => {
  assert.deepEqual(parseAccountUpdate({ role: "super_admin" }), { ok: true, update: { role: "super_admin" } });
  assert.deepEqual(parseAccountUpdate({ active: false }), { ok: true, update: { active: false } });
  assert.deepEqual(parseAccountUpdate({ name: "  Nimal  " }), { ok: true, update: { name: "Nimal" } });
});

test("rejects unknown roles", () => {
  assert.equal(parseAccountUpdate({ role: "owner" }).ok, false);
  assert.equal(parseAccountUpdate({ role: "" }).ok, false);
});

test("rejects a non-boolean active flag", () => {
  assert.equal(parseAccountUpdate({ active: "false" }).ok, false);
  assert.equal(parseAccountUpdate({ active: 0 }).ok, false);
});

test("rejects over-long or non-text names", () => {
  assert.equal(parseAccountUpdate({ name: "x".repeat(MAX_ACCOUNT_NAME_LEN + 1) }).ok, false);
  assert.equal(parseAccountUpdate({ name: 5 }).ok, false);
});

test("rejects empty or non-object bodies", () => {
  assert.equal(parseAccountUpdate({}).ok, false);
  assert.equal(parseAccountUpdate(null).ok, false);
  assert.equal(parseAccountUpdate("role=admin").ok, false);
});
