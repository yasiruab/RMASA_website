// Which slots an admin per-slot save (batch or legacy single-slot PATCH) is
// putting into an occupying state, so the route can conflict-check exactly
// those. Pure (type-only imports) so `npm test` can load it.

import type { BookingSlot, BookingStatus } from "@/lib/calendar-types";

export type SlotStatusUpdate = {
  slotDate: string;
  slotStartTime: string;
  /** null clears the per-slot override, so the slot falls back to the booking's status. */
  slotStatus: BookingStatus | null;
};

const INACTIVE: ReadonlySet<BookingStatus> = new Set(["rejected", "cancelled_override"]);

export type SlotActivation = {
  /** Slots this save makes `confirmed`. Must not overlap ANY other active booking. */
  confirming: BookingSlot[];
  /** Slots this save turns from inactive back to pending/tentative. Must not
   *  overlap equal/higher-priority bookings or blocks. */
  reactivating: BookingSlot[];
};

/**
 * Splits a per-slot save into the slots that start occupying the calendar.
 * Before this check existed, per-slot approve wrote `confirmed` with no
 * conflict scan, so an admin could double-book a slot that "Confirm All"
 * would have refused.
 */
export function classifySlotActivation(
  updates: SlotStatusUpdate[],
  slots: BookingSlot[],
  bookingStatus: BookingStatus,
): SlotActivation {
  const confirming: BookingSlot[] = [];
  const reactivating: BookingSlot[] = [];

  for (const update of updates) {
    const slot = slots.find((s) => s.date === update.slotDate && s.startTime === update.slotStartTime);
    if (!slot) continue;
    const before = slot.slotStatus ?? bookingStatus;
    const after = update.slotStatus ?? bookingStatus;
    if (INACTIVE.has(after)) continue;

    const target = { date: slot.date, startTime: slot.startTime, endTime: slot.endTime };
    if (after === "confirmed" && before !== "confirmed") confirming.push(target);
    else if (INACTIVE.has(before)) reactivating.push(target);
  }

  return { confirming, reactivating };
}
