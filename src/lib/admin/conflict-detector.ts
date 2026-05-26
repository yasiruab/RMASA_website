// Pair-overlap conflict detector. Pure helper shared by the admin bookings
// desk + the admin hub. Both call it with a minimal projection — booking id,
// roomTypeId, status, and the slot positions — so neither path needs the
// full payment-entry / amount-breakdown payload.
//
// Mirrors the original client-side logic in admin-bookings.tsx: two active
// bookings on the same room with at least one overlapping slot (after
// dropping rejected / cancelled_override slots) are flagged as a pair.

import type { BookingStatus } from "@/lib/calendar-types";

type ConflictBookingInput = {
  id: string;
  roomTypeId: string;
  status: BookingStatus;
  slots: Array<{
    date: string;
    startTime: string;
    endTime: string;
    slotStatus: string | null;
  }>;
};

const ACTIVE_STATUSES = ["pending", "confirmed", "tentative"] as const;

function isActive(b: ConflictBookingInput): boolean {
  if (b.slots.length === 0) {
    return (ACTIVE_STATUSES as readonly string[]).includes(b.status);
  }
  const effectives = b.slots.map((s) => s.slotStatus ?? b.status);
  const live = effectives.filter((s) => s !== "rejected" && s !== "cancelled_override");
  if (live.length === 0) return false;
  if (live.every((s) => s === live[0])) {
    return (ACTIVE_STATUSES as readonly string[]).includes(live[0]);
  }
  return (ACTIVE_STATUSES as readonly string[]).includes(b.status);
}

export function buildConflictPairs(
  bookings: ConflictBookingInput[],
): Map<string, string[]> {
  const pairs = new Map<string, string[]>();
  const active = bookings.filter(isActive);
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      if (a.roomTypeId !== b.roomTypeId) continue;
      const overlap = a.slots.some((sa) => {
        if ((sa.slotStatus ?? a.status) === "rejected") return false;
        if ((sa.slotStatus ?? a.status) === "cancelled_override") return false;
        return b.slots.some((sb) => {
          if ((sb.slotStatus ?? b.status) === "rejected") return false;
          if ((sb.slotStatus ?? b.status) === "cancelled_override") return false;
          return sa.date === sb.date && sa.startTime < sb.endTime && sb.startTime < sa.endTime;
        });
      });
      if (overlap) {
        if (!pairs.has(a.id)) pairs.set(a.id, []);
        if (!pairs.has(b.id)) pairs.set(b.id, []);
        pairs.get(a.id)!.push(b.id);
        pairs.get(b.id)!.push(a.id);
      }
    }
  }
  return pairs;
}
