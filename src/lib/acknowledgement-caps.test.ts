import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  ACKNOWLEDGEMENT_DAILY_CAPS,
  isAcknowledgementAllowed,
  type CountRecentEmails,
} from "./acknowledgement-caps.ts";

const fixedCount = (count: number): CountRecentEmails => async () => count;

test("allows sends below the daily cap", async () => {
  assert.equal(await isAcknowledgementAllowed("contact_acknowledgement", "a@b.lk", fixedCount(0)), true);
  assert.equal(
    await isAcknowledgementAllowed(
      "contact_acknowledgement",
      "a@b.lk",
      fixedCount(ACKNOWLEDGEMENT_DAILY_CAPS.contact_acknowledgement - 1),
    ),
    true,
  );
});

test("blocks sends at or above the daily cap", async () => {
  assert.equal(
    await isAcknowledgementAllowed(
      "contact_acknowledgement",
      "a@b.lk",
      fixedCount(ACKNOWLEDGEMENT_DAILY_CAPS.contact_acknowledgement),
    ),
    false,
  );
  assert.equal(
    await isAcknowledgementAllowed(
      "booking_acknowledgement",
      "a@b.lk",
      fixedCount(ACKNOWLEDGEMENT_DAILY_CAPS.booking_acknowledgement),
    ),
    false,
  );
});

test("counts a normalised address over the last 24 hours", async () => {
  let seen: { type: string; toEmail: string; since: Date } | null = null;
  const countRecent: CountRecentEmails = async (type, toEmail, since) => {
    seen = { type, toEmail, since };
    return 0;
  };
  const now = new Date("2026-10-24T12:00:00Z");
  await isAcknowledgementAllowed("booking_acknowledgement", "  Victim@Example.COM ", countRecent, now);
  assert.deepEqual(seen, {
    type: "booking_acknowledgement",
    toEmail: "victim@example.com",
    since: new Date("2026-10-23T12:00:00Z"),
  });
});
