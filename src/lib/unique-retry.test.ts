import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isUniqueViolationOn, retryOnCollision } from "./unique-retry.ts";

const collision = Object.assign(new Error("Unique constraint failed"), {
  code: "P2002",
  meta: { target: ["reference"] },
});

test("isUniqueViolationOn matches P2002 on the named field", () => {
  assert.equal(isUniqueViolationOn(collision, "reference"), true);
  assert.equal(isUniqueViolationOn({ code: "P2002", meta: { target: "Booking_reference_key" } }, "reference"), true);
  assert.equal(isUniqueViolationOn({ code: "P2002", meta: { target: ["id"] } }, "reference"), false);
  assert.equal(isUniqueViolationOn({ code: "P2025" }, "reference"), false);
  assert.equal(isUniqueViolationOn(new Error("boom"), "reference"), false);
  assert.equal(isUniqueViolationOn(null, "reference"), false);
});

test("retryOnCollision retries collisions and returns the first success", async () => {
  const attempts: number[] = [];
  const result = await retryOnCollision(
    async (n) => {
      attempts.push(n);
      if (n < 3) throw collision;
      return "ok";
    },
    (e) => isUniqueViolationOn(e, "reference"),
    5,
  );
  assert.equal(result, "ok");
  assert.deepEqual(attempts, [1, 2, 3]);
});

test("retryOnCollision rethrows non-collision errors immediately", async () => {
  let calls = 0;
  await assert.rejects(
    retryOnCollision(
      async () => {
        calls += 1;
        throw new Error("database down");
      },
      (e) => isUniqueViolationOn(e, "reference"),
      5,
    ),
    /database down/,
  );
  assert.equal(calls, 1);
});

test("retryOnCollision gives up after maxAttempts", async () => {
  let calls = 0;
  await assert.rejects(
    retryOnCollision(
      async () => {
        calls += 1;
        throw collision;
      },
      (e) => isUniqueViolationOn(e, "reference"),
      3,
    ),
  );
  assert.equal(calls, 3);
});
