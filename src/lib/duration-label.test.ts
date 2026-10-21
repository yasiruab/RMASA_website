import { strict as assert } from "node:assert";
import { test } from "node:test";
import { formatDurationLabel } from "./duration-label.ts";

test("whole hours use HR / HRS", () => {
  assert.equal(formatDurationLabel(60), "1 HR");
  assert.equal(formatDurationLabel(360), "6 HRS");
});

test("under an hour shows minutes only", () => {
  assert.equal(formatDurationLabel(30), "30 MIN");
  assert.equal(formatDurationLabel(55), "55 MIN");
});

test("mixed durations show hours and minutes", () => {
  assert.equal(formatDurationLabel(90), "1 HR 30 MIN");
  assert.equal(formatDurationLabel(835), "13 HRS 55 MIN");
});
