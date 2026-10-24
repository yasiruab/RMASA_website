import { strict as assert } from "node:assert";
import { test } from "node:test";
import { checkCognitoSub } from "./cognito-sub.ts";

test("first sign-in backfills the sub", () => {
  assert.equal(checkCognitoSub(null, "sub-1"), "backfill");
  assert.equal(checkCognitoSub("", "sub-1"), "backfill");
});

test("a matching sub is accepted", () => {
  assert.equal(checkCognitoSub("sub-1", "sub-1"), "match");
});

test("a different sub for the same email is a mismatch", () => {
  assert.equal(checkCognitoSub("sub-1", "sub-2"), "mismatch");
});

test("a profile without a sub is reported as missing", () => {
  assert.equal(checkCognitoSub("sub-1", undefined), "missing");
  assert.equal(checkCognitoSub(null, ""), "missing");
  assert.equal(checkCognitoSub(null, 42), "missing");
});
