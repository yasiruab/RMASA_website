import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EMAIL_LOG_RETENTION_MONTHS, REDACTED_FIELDS, emailLogRetentionCutoff } from "./email-log-retention.ts";

test("retention is 18 months", () => {
  assert.equal(EMAIL_LOG_RETENTION_MONTHS, 18);
});

test("cutoff is 18 calendar months before now, keeping the time of day", () => {
  assert.equal(
    emailLogRetentionCutoff(new Date("2026-10-24T01:00:00Z")).toISOString(),
    "2025-04-24T01:00:00.000Z",
  );
});

test("cutoff crosses year boundaries", () => {
  assert.equal(emailLogRetentionCutoff(new Date("2026-03-15T00:00:00Z")).toISOString(), "2024-09-15T00:00:00.000Z");
});

test("a day missing from the target month clamps to its last day", () => {
  // 31 Aug 2026 − 18 months → February 2025, which has 28 days.
  assert.equal(emailLogRetentionCutoff(new Date("2026-08-31T00:00:00Z")).toISOString(), "2025-02-28T00:00:00.000Z");
  // Leap year: 31 Aug 2025 − 18 months → February 2024 (29 days).
  assert.equal(emailLogRetentionCutoff(new Date("2025-08-31T00:00:00Z")).toISOString(), "2024-02-29T00:00:00.000Z");
});

test("a custom month count is honoured", () => {
  assert.equal(emailLogRetentionCutoff(new Date("2026-10-24T00:00:00Z"), 1).toISOString(), "2026-09-24T00:00:00.000Z");
});

test("does not mutate the input date", () => {
  const now = new Date("2026-10-24T00:00:00Z");
  emailLogRetentionCutoff(now);
  assert.equal(now.toISOString(), "2026-10-24T00:00:00.000Z");
});

test("redaction blanks every field that can hold personal data", () => {
  assert.deepEqual(REDACTED_FIELDS, {
    toEmail: "[redacted]",
    subject: "[redacted]",
    htmlBody: "",
    errorMessage: null,
  });
});
