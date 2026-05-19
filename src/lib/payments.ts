import type { ReconciliationStatus } from "@/lib/calendar-types";

// Pure payment-math helpers.
//
// The accounting model has two independent streams:
//   - cash collected: payments minus refunds. This is real money movement.
//   - amount due:     the original invoice total, reduced by waivers and
//                     credit notes (forgiven invoice lines, no cash moved).
//
// The old route conflated both into a single counter and subtracted waivers
// from cash-collected, which produced phantom debt: a fully-paid booking that
// later received a fee waiver flipped to `part_paid` even though the customer
// owed nothing.

export type PaymentTotals = {
  /** Σ(payment) − Σ(refund). May be negative if refunds exceed payments. */
  netCash: number;
  /** Σ(waiver) + Σ(credit_note). Reductions to the amount the customer owes. */
  totalDeducted: number;
};

// Accepts a loose `{ type: string }` shape so it works directly with Prisma's
// PaymentEntry row (where `type` is the un-narrowed string column) and with
// our app-level PaymentEntryType union — comparisons inside the function
// narrow the value either way.
export function computePaymentTotals(
  entries: { type: string; amountLkr: number }[],
): PaymentTotals {
  let netCash = 0;
  let totalDeducted = 0;
  for (const e of entries) {
    if (e.type === "payment") netCash += e.amountLkr;
    else if (e.type === "refund") netCash -= e.amountLkr;
    else if (e.type === "waiver" || e.type === "credit_note") {
      totalDeducted += e.amountLkr;
    }
  }
  return { netCash, totalDeducted };
}

/** Compute the customer's remaining liability given the booking total and the
 *  payment-entry totals. Never negative — if waivers/credits exceed the total,
 *  the amount due is zero. */
export function computeAmountDue(totalAmountLkr: number, totals: PaymentTotals): number {
  return Math.max(0, totalAmountLkr - totals.totalDeducted);
}

/** Derive the booking-level reconciliation status from the cash counter and
 *  the amount-due counter. Returns one of the active enum values; the legacy
 *  "waived" value is not produced by this function.
 *
 *  Semantics:
 *   - amountDue ≤ 0 → "paid" (fully waived/credited; customer owes nothing)
 *   - netCash   ≤ 0 → "unpaid" (no cash collected)
 *   - netCash ≥ due → "paid"
 *   - otherwise     → "part_paid"
 */
export function deriveReconciliationStatus(
  netCash: number,
  amountDue: number,
): Exclude<ReconciliationStatus, "waived"> {
  if (amountDue <= 0) return "paid";
  if (netCash <= 0) return "unpaid";
  if (netCash >= amountDue) return "paid";
  return "part_paid";
}
