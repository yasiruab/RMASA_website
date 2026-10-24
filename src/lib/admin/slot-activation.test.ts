import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifySlotActivation } from "./slot-activation.ts";
import type { BookingSlot } from "../calendar-types.ts";

const slots: BookingSlot[] = [
  { date: "2026-11-07", startTime: "08:00", endTime: "09:00" },
  { date: "2026-11-07", startTime: "10:00", endTime: "11:00", slotStatus: "rejected" },
  { date: "2026-11-08", startTime: "08:00", endTime: "09:00", slotStatus: "confirmed" },
];

const update = (slotDate: string, slotStartTime: string, slotStatus: BookingSlot["slotStatus"] | null) => ({
  slotDate,
  slotStartTime,
  slotStatus: slotStatus ?? null,
});

test("approving a pending slot is a confirmation to check", () => {
  const result = classifySlotActivation([update("2026-11-07", "08:00", "confirmed")], slots, "pending");
  assert.deepEqual(result.confirming, [{ date: "2026-11-07", startTime: "08:00", endTime: "09:00" }]);
  assert.deepEqual(result.reactivating, []);
});

test("bringing a rejected slot back to tentative is a reactivation", () => {
  const result = classifySlotActivation([update("2026-11-07", "10:00", "tentative")], slots, "pending");
  assert.deepEqual(result.confirming, []);
  assert.deepEqual(result.reactivating, [{ date: "2026-11-07", startTime: "10:00", endTime: "11:00" }]);
});

test("clearing an override falls back to the booking status", () => {
  // Booking is confirmed, so clearing the rejected slot's override confirms it.
  const result = classifySlotActivation([update("2026-11-07", "10:00", null)], slots, "confirmed");
  assert.equal(result.confirming.length, 1);
});

test("rejections and already-confirmed slots need no check", () => {
  const result = classifySlotActivation(
    [update("2026-11-07", "08:00", "rejected"), update("2026-11-08", "08:00", "confirmed")],
    slots,
    "pending",
  );
  assert.deepEqual(result, { confirming: [], reactivating: [] });
});

test("unknown slots are ignored", () => {
  const result = classifySlotActivation([update("2026-12-01", "08:00", "confirmed")], slots, "pending");
  assert.deepEqual(result, { confirming: [], reactivating: [] });
});
