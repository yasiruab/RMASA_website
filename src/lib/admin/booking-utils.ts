// Pure helpers shared across admin booking views (queue, detail, hub KPIs).
// Extracted from src/components/admin/admin-calendar-console.tsx so future
// per-section components can import them without dragging in the mega-file.
//
// Function signatures are intentionally generic (`Pick`-style) so they accept
// both the canonical Booking type from @/lib/calendar-types and any narrower
// admin-internal shape that happens to include the required fields.

import { computeAmountDue, computePaymentTotals } from "@/lib/payments";
import type { BookingStatus, PaymentEntry, ReconciliationStatus } from "@/lib/calendar-types";

export const ACTIVE_EFFECTIVE_STATUSES = ["pending", "confirmed", "tentative"] as const;

type SlotLite = {
  date: string;
  startTime: string;
  endTime: string;
  slotStatus?: BookingStatus;
  rejectReason?: string;
};

type BookingLite = {
  status: BookingStatus;
  slots: SlotLite[];
};

/** Effective status accounts for per-slot approve/reject overrides:
 *  - all slots rejected → "rejected"
 *  - all active (non-rejected) slots share one status → that status
 *  - otherwise → booking.status (mixed) */
export function computeBookingEffectiveStatus<B extends BookingLite>(booking: B): BookingStatus {
  if (booking.slots.length === 0) return booking.status;
  const effectives = booking.slots.map((s) => s.slotStatus ?? booking.status);
  const active = effectives.filter((s) => s !== "rejected" && s !== "cancelled_override");
  if (active.length === 0) return "rejected";
  if (active.every((s) => s === active[0])) return active[0] as BookingStatus;
  return booking.status;
}

export function isActiveBooking<B extends BookingLite>(b: B): boolean {
  return (ACTIVE_EFFECTIVE_STATUSES as readonly string[]).includes(computeBookingEffectiveStatus(b));
}

export function hasRejectedSlot<B extends BookingLite>(b: B): boolean {
  return b.slots.some((s) => (s.slotStatus ?? b.status) === "rejected");
}

type AmountBreakdownLite = {
  date: string;
  slot: string;
  amountLkr: number;
};

type BookingForAllocation = BookingLite & {
  paidAmountLkr: number;
  amountBreakdown: AmountBreakdownLite[];
};

/** Allocate the booking's collected cash across its active slots oldest-first.
 *  Returns a map keyed by "YYYY-MM-DD|HH:mm" → "paid" | "part_paid" | "unpaid". */
export function computeSlotPaymentAllocation<B extends BookingForAllocation>(
  booking: B,
): Map<string, "paid" | "part_paid" | "unpaid"> {
  const activeSlots = booking.slots
    .filter((s) => {
      const eff = s.slotStatus ?? booking.status;
      return eff !== "rejected" && eff !== "cancelled_override";
    })
    .sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.startTime < b.startTime ? -1 : 1,
    );

  let remaining = booking.paidAmountLkr;
  const result = new Map<string, "paid" | "part_paid" | "unpaid">();

  for (const slot of activeSlots) {
    const key = `${slot.date}|${slot.startTime}`;
    const bd = booking.amountBreakdown.find(
      (b) => b.date === slot.date && b.slot === `${slot.startTime}-${slot.endTime}`,
    );
    const amount = bd?.amountLkr ?? 0;
    if (amount === 0) {
      result.set(key, "paid");
    } else if (remaining >= amount) {
      result.set(key, "paid");
      remaining -= amount;
    } else if (remaining > 0) {
      result.set(key, "part_paid");
      remaining = 0;
    } else {
      result.set(key, "unpaid");
    }
  }
  return result;
}

type BookingForPay = {
  reconciliationStatus: ReconciliationStatus;
  paidAmountLkr: number;
  paymentEntries: Array<Pick<PaymentEntry, "type" | "amountLkr">>;
  totalAmountLkr: number;
};

/** Server-computed net of payments minus refunds. Treats legacy "waived" rows
 *  (no payment entries) as zero collected. */
export function effectivePaidLkr<B extends BookingForPay>(booking: B): number {
  if (booking.reconciliationStatus === "waived" && booking.paymentEntries.length === 0) return 0;
  return booking.paidAmountLkr;
}

/** True when cash collected exceeds the post-waiver invoice. Must compare
 *  against amountDue (total − waivers − credit_notes), not totalAmountLkr;
 *  see CLAUDE.md "hard rule" in the accounting section. */
export function isOverpaid<B extends BookingForPay>(booking: B): boolean {
  const totals = computePaymentTotals(booking.paymentEntries);
  const amountDue = computeAmountDue(booking.totalAmountLkr, totals);
  return effectivePaidLkr(booking) > amountDue;
}

export function bookingStatusLabel(status: BookingStatus): string {
  const map: Record<BookingStatus, string> = {
    pending: "Pending",
    confirmed: "Confirmed",
    tentative: "Tentative",
    rejected: "Rejected",
    cancelled_override: "Cancelled",
  };
  return map[status] ?? status;
}

export function formatSlotDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
