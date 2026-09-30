// Customer-facing "booking priority" notice. A higher-priority booking cancels
// the overlapping slots of lower-priority ones, even confirmed ones (see
// evaluateBookingConflicts in calendar-core.ts), so customers booking a
// lower-priority event type are told up front. The same wording is used on the
// bookings page and in customer emails. No `@/` imports so `npm test` can load it.

type PriorityEventType = { id: string; name: string; priority: number };

export type PriorityNotice = { title: string; paragraphs: string[] };

export const PRIORITY_SUMMARY_LINE = "This booking can be overridden by a higher-priority event.";

/**
 * Names of the room's bookable event types that outrank `selected`, highest
 * priority first. `roomEventTypes` must already be limited to what can be
 * booked in the selected room. Empty when nothing outranks it.
 */
export function higherPriorityEventNames(
  selected: PriorityEventType,
  roomEventTypes: PriorityEventType[],
): string[] {
  return roomEventTypes
    .filter((e) => e.id !== selected.id && e.priority > selected.priority)
    .sort((a, b) => b.priority - a.priority)
    .map((e) => e.name);
}

/** "A", "A or B", "A, B, or C". */
function joinWithOr(names: string[]) {
  if (names.length <= 2) return names.join(" or ");
  return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
}

export function buildPriorityNotice(eventTypeName: string, higherNames: string[]): PriorityNotice | null {
  if (higherNames.length === 0) return null;
  return {
    title: "Please note: Booking priority applies",
    paragraphs: [
      `${eventTypeName} bookings have lower priority than other events in this room. ` +
        `If someone books a ${joinWithOr(higherNames)} session that overlaps with your booking, ` +
        "your booking may be cancelled, even if it has already been confirmed.",
      "We’ll email you if this happens.",
    ],
  };
}
