// Pure helpers shared across admin booking views (queue, detail, hub KPIs).
// Extracted from src/components/admin/admin-calendar-console.tsx so future
// per-section components can import them without dragging in the mega-file.
//
// Function signatures are intentionally generic (`Pick`-style) so they accept
// both the canonical Booking type from @/lib/calendar-types and any narrower
// admin-internal shape that happens to include the required fields.

import { computeAmountDue, computePaymentTotals } from "../payments.ts";
import type { BookingStatus, PaymentEntry, ReconciliationStatus } from "../calendar-types.ts";

export const ACTIVE_EFFECTIVE_STATUSES = ["pending", "confirmed", "tentative"] as const;

type SlotLite = {
  date: string;
  startTime: string;
  endTime: string;
  slotStatus?: BookingStatus | null;
  rejectReason?: string | null;
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

type BookingForActiveTotal = BookingLite & {
  totalAmountLkr: number;
  amountBreakdown: AmountBreakdownLite[];
};

/** Sum of amountBreakdown for non-rejected / non-cancelled slots. When all
 *  slots are active, returns the cached totalAmountLkr (covers old bookings
 *  whose amountBreakdown rows may be empty or shape-mismatched).
 *
 *  Why: Booking.totalAmountLkr is set at creation and never reduced when
 *  slots are later rejected — but the customer doesn't owe for slots we
 *  rejected. Use this when computing "what's actually owed". */
export function activeBookingTotalLkr<B extends BookingForActiveTotal>(booking: B): number {
  const allActive = booking.slots.every((s) => {
    const eff = s.slotStatus ?? booking.status;
    return eff !== "rejected" && eff !== "cancelled_override";
  });
  if (allActive) return booking.totalAmountLkr;

  return booking.slots
    .filter((s) => {
      const eff = s.slotStatus ?? booking.status;
      return eff !== "rejected" && eff !== "cancelled_override";
    })
    .reduce((sum, slot) => {
      const bd = booking.amountBreakdown.find(
        (b) => b.date === slot.date && b.slot === `${slot.startTime}-${slot.endTime}`,
      );
      return sum + (bd?.amountLkr ?? 0);
    }, 0);
}

export type SlotAllocationStatus =
  | "paid"
  | "part_paid"
  | "unpaid"
  | "waived"
  | "rejected";

export type SlotAllocation = {
  key: string;
  date: string;
  startTime: string;
  endTime: string;
  amountLkr: number;
  paidLkr: number;
  waiverLkr: number;
  creditNoteLkr: number;
  balanceLkr: number;
  status: SlotAllocationStatus;
};

type BookingForSlotAllocations = BookingLite & {
  amountBreakdown: AmountBreakdownLite[];
  paymentEntries: Array<Pick<PaymentEntry, "type" | "amountLkr">>;
};

/** Per-slot allocation breakdown. Always re-derived from the booking's
 *  current state — never stored. Allocation rules:
 *  - Payments oldest → newest over ALL slots (including rejected slots:
 *    if cash was paid before a rejection, it landed on that slot and a
 *    future refund may reverse it from exactly there).
 *  - Refunds newest → oldest over ALL slots (reverses cash in the order
 *    most-recently-paid first).
 *  - Waivers newest → oldest over ACTIVE slots only (rejected slots have
 *    no debt to forgive).
 *  - Credit notes newest → oldest over ACTIVE slots only.
 *  Rejected / cancelled_override slots always return `status: "rejected"`
 *  regardless of any residual paidLkr the allocation may have left on
 *  them — the UI uses a struck-through price + no chip for those rows. */
export function computeSlotAllocations<B extends BookingForSlotAllocations>(
  booking: B,
): SlotAllocation[] {
  const sorted = [...booking.slots].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.startTime < b.startTime ? -1 : 1,
  );

  const isRejected = (s: { slotStatus?: BookingStatus | null }) => {
    const eff = s.slotStatus ?? booking.status;
    return eff === "rejected" || eff === "cancelled_override";
  };

  const entries: SlotAllocation[] = sorted.map((slot) => {
    const bd = booking.amountBreakdown.find(
      (b) => b.date === slot.date && b.slot === `${slot.startTime}-${slot.endTime}`,
    );
    return {
      key: `${slot.date}|${slot.startTime}`,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      amountLkr: bd?.amountLkr ?? 0,
      paidLkr: 0,
      waiverLkr: 0,
      creditNoteLkr: 0,
      balanceLkr: 0,
      status: "unpaid",
    };
  });

  let totalPayments = 0;
  let totalRefunds = 0;
  let totalWaivers = 0;
  let totalCreditNotes = 0;
  for (const e of booking.paymentEntries) {
    if (e.type === "payment") totalPayments += e.amountLkr;
    else if (e.type === "refund") totalRefunds += e.amountLkr;
    else if (e.type === "waiver") totalWaivers += e.amountLkr;
    else if (e.type === "credit_note") totalCreditNotes += e.amountLkr;
  }

  // Pass 1 — Payments oldest → newest, over ALL slots.
  let remaining = totalPayments;
  for (const entry of entries) {
    if (remaining <= 0) break;
    const capacity = entry.amountLkr - entry.paidLkr;
    if (capacity <= 0) continue;
    const fill = Math.min(remaining, capacity);
    entry.paidLkr += fill;
    remaining -= fill;
  }

  // Pass 2 — Refunds newest → oldest, over ALL slots.
  remaining = totalRefunds;
  for (let i = entries.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const entry = entries[i];
    const reverse = Math.min(remaining, entry.paidLkr);
    if (reverse <= 0) continue;
    entry.paidLkr -= reverse;
    remaining -= reverse;
  }

  // Pass 3 — Waivers newest → oldest, ACTIVE slots only.
  remaining = totalWaivers;
  for (let i = entries.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const entry = entries[i];
    const slot = sorted[i];
    if (isRejected(slot)) continue;
    const capacity = entry.amountLkr - entry.paidLkr - entry.waiverLkr - entry.creditNoteLkr;
    if (capacity <= 0) continue;
    const fill = Math.min(remaining, capacity);
    entry.waiverLkr += fill;
    remaining -= fill;
  }

  // Pass 4 — Credit notes newest → oldest, ACTIVE slots only.
  remaining = totalCreditNotes;
  for (let i = entries.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const entry = entries[i];
    const slot = sorted[i];
    if (isRejected(slot)) continue;
    const capacity = entry.amountLkr - entry.paidLkr - entry.waiverLkr - entry.creditNoteLkr;
    if (capacity <= 0) continue;
    const fill = Math.min(remaining, capacity);
    entry.creditNoteLkr += fill;
    remaining -= fill;
  }

  // Derive status + balance.
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const slot = sorted[i];
    if (isRejected(slot)) {
      entry.status = "rejected";
      entry.balanceLkr = 0;
      continue;
    }
    const covered = entry.paidLkr + entry.waiverLkr + entry.creditNoteLkr;
    entry.balanceLkr = Math.max(0, entry.amountLkr - covered);
    if (entry.amountLkr === 0) {
      entry.status = "paid";
    } else if (covered >= entry.amountLkr && entry.paidLkr === 0 && (entry.waiverLkr + entry.creditNoteLkr) > 0) {
      entry.status = "waived";
    } else if (covered >= entry.amountLkr) {
      entry.status = "paid";
    } else if (covered > 0) {
      entry.status = "part_paid";
    } else {
      entry.status = "unpaid";
    }
  }

  return entries;
}

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
