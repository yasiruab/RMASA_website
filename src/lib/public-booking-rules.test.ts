import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  addMinutesToTime,
  hasPastDatedSlot,
  normalizePublicSlots,
  toPublicConflictReason,
  todayInColombo,
} from "./public-booking-rules.ts";

test("addMinutesToTime handles hour and half-hour steps", () => {
  assert.equal(addMinutesToTime("08:00", 60), "09:00");
  assert.equal(addMinutesToTime("08:30", 45), "09:15");
  assert.equal(addMinutesToTime("07:00", 600), "17:00");
});

test("addMinutesToTime does not wrap past midnight", () => {
  // Kept above 24:00 so the working-hours check rejects it.
  assert.equal(addMinutesToTime("23:00", 120), "25:00");
});

test("normalizePublicSlots derives endTime from the event duration", () => {
  const slots = normalizePublicSlots(
    [{ date: "2026-11-07", startTime: "08:00", endTime: "18:00" } as never],
    60,
  );
  assert.deepEqual(slots, [{ date: "2026-11-07", startTime: "08:00", endTime: "09:00" }]);
});

test("normalizePublicSlots drops client-sent slotStatus and rejectReason", () => {
  const forged = {
    date: "2026-11-07",
    startTime: "10:00",
    endTime: "11:00",
    slotStatus: "confirmed",
    rejectReason: "x",
  };
  const [slot] = normalizePublicSlots([forged as never], 60);
  assert.equal("slotStatus" in slot, false);
  assert.equal("rejectReason" in slot, false);
});

test("hasPastDatedSlot compares against today", () => {
  const today = "2026-10-22";
  assert.equal(hasPastDatedSlot([{ date: "2026-10-22" }], today), false);
  assert.equal(hasPastDatedSlot([{ date: "2026-10-23" }], today), false);
  assert.equal(hasPastDatedSlot([{ date: "2026-10-23" }, { date: "2026-10-21" }], today), true);
});

test("todayInColombo uses the Colombo calendar day", () => {
  // 20:00 UTC is 01:30 the next day in Colombo (UTC+05:30).
  assert.equal(todayInColombo(new Date("2026-10-22T20:00:00Z")), "2026-10-23");
  assert.equal(todayInColombo(new Date("2026-10-22T10:00:00Z")), "2026-10-22");
});

test("toPublicConflictReason hides block notes and booking ids", () => {
  assert.equal(toPublicConflictReason("Blocked: VIP private event"), "Unavailable — closed by the venue.");
  assert.equal(
    toPublicConflictReason("Conflicts with booking 6f1c0a2e-0000-4000-8000-000000000000"),
    "Already booked.",
  );
  assert.equal(
    toPublicConflictReason("Overlaps another slot in this booking request."),
    "Overlaps another slot in this booking request.",
  );
});
