// Server-side rules for the anonymous public booking endpoint. Pure helpers with
// no runtime `@/` imports (type imports are stripped) so `npm test` can load them.

import type { BookingSlot } from "@/lib/calendar-types";

// Request-size caps. The calendar UI sends a handful of base slots; recurrence
// multiplies them by up to 26. Without caps, one request could carry thousands
// of slots into the O(n²) internal-overlap check and a single createMany.
export const MAX_SELECTED_SLOTS = 50;
export const MAX_EXPANDED_SLOTS = 400;

/** Today's date in Colombo as YYYY-MM-DD (en-CA formats that way), matching BookingSlot.date. */
export function todayInColombo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(now);
}

/** `HH:MM` + minutes → `HH:MM`. Values past midnight are kept as e.g. "25:00" so
 *  the working-hours check rejects them instead of wrapping to the next day. */
export function addMinutesToTime(startTime: string, minutes: number): string {
  const [h, m] = startTime.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const mins = String(total % 60).padStart(2, "0");
  return `${hours}:${mins}`;
}

/**
 * Rebuilds the customer's slots from date + start time only. The end time comes
 * from the event type's duration — a client-sent endTime is ignored, so a
 * "1 Hour" booking can't stretch to a full day at the one-hour price. Any
 * client-sent slotStatus / rejectReason is dropped, so a request can't
 * self-confirm its own slots.
 */
export function normalizePublicSlots(
  slots: Array<Pick<BookingSlot, "date" | "startTime">>,
  durationMinutes: number,
): BookingSlot[] {
  return slots.map((slot) => ({
    date: slot.date,
    startTime: slot.startTime,
    endTime: addMinutesToTime(slot.startTime, durationMinutes),
  }));
}

/** True when any slot is dated before `today` (YYYY-MM-DD string compare). */
export function hasPastDatedSlot(slots: Array<Pick<BookingSlot, "date">>, today: string): boolean {
  return slots.some((slot) => slot.date < today);
}

/**
 * Conflict reasons from evaluateBookingConflicts() name internal booking ids and
 * admin-written block notes. Those are fine for admins but must not reach an
 * anonymous caller, so the public endpoint maps them to generic wording.
 */
export function toPublicConflictReason(reason: string): string {
  if (reason.startsWith("Blocked:")) return "Unavailable — closed by the venue.";
  if (reason.startsWith("Conflicts with booking")) return "Already booked.";
  return reason;
}
