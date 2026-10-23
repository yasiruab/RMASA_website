import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isClarityExcludedPath } from "./clarity-scope.ts";

test("admin routes are excluded from Clarity", () => {
  assert.equal(isClarityExcludedPath("/admin"), true);
  assert.equal(isClarityExcludedPath("/admin/login"), true);
  assert.equal(isClarityExcludedPath("/admin/calendar/bookings"), true);
});

test("public routes are recorded", () => {
  assert.equal(isClarityExcludedPath("/"), false);
  assert.equal(isClarityExcludedPath("/bookings"), false);
  // Not an admin route despite the prefix.
  assert.equal(isClarityExcludedPath("/administration-policy"), false);
});
