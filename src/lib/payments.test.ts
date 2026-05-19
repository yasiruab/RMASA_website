import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  computeAmountDue,
  computePaymentTotals,
  deriveReconciliationStatus,
} from "./payments.ts";

type Entry = { type: "payment" | "refund" | "credit_note" | "waiver"; amountLkr: number };

function statusFor(entries: Entry[], total: number) {
  const totals = computePaymentTotals(entries);
  const due = computeAmountDue(total, totals);
  return {
    netCash: totals.netCash,
    totalDeducted: totals.totalDeducted,
    amountDue: due,
    status: deriveReconciliationStatus(Math.max(0, totals.netCash), due),
  };
}

test("no entries → unpaid", () => {
  assert.deepEqual(statusFor([], 50_000), {
    netCash: 0,
    totalDeducted: 0,
    amountDue: 50_000,
    status: "unpaid",
  });
});

test("payment covers total → paid", () => {
  assert.equal(statusFor([{ type: "payment", amountLkr: 50_000 }], 50_000).status, "paid");
});

test("payment below total → part_paid", () => {
  const r = statusFor([{ type: "payment", amountLkr: 30_000 }], 50_000);
  assert.equal(r.status, "part_paid");
  assert.equal(r.netCash, 30_000);
});

test("payment then refund → unpaid when net = 0", () => {
  const r = statusFor(
    [
      { type: "payment", amountLkr: 50_000 },
      { type: "refund", amountLkr: 50_000 },
    ],
    50_000,
  );
  assert.equal(r.netCash, 0);
  assert.equal(r.status, "unpaid");
});

test("BUG REGRESSION: payment in full + waiver later → still paid (was: part_paid)", () => {
  // Customer pays 50,000. Booking is "paid in full". Admin later forgives 10,000
  // (e.g. they were overcharged) via a waiver. The customer owes nothing more,
  // so status must remain "paid". The old code treated waiver as cash lost and
  // flipped to part_paid.
  const r = statusFor(
    [
      { type: "payment", amountLkr: 50_000 },
      { type: "waiver", amountLkr: 10_000 },
    ],
    50_000,
  );
  assert.equal(r.netCash, 50_000);
  assert.equal(r.totalDeducted, 10_000);
  assert.equal(r.amountDue, 40_000);
  assert.equal(r.status, "paid");
});

test("credit note reduces amount due → paid when netCash covers reduced due", () => {
  const r = statusFor(
    [
      { type: "credit_note", amountLkr: 15_000 },
      { type: "payment", amountLkr: 35_000 },
    ],
    50_000,
  );
  assert.equal(r.amountDue, 35_000);
  assert.equal(r.status, "paid");
});

test("waiver covers full total → paid even with zero cash", () => {
  const r = statusFor([{ type: "waiver", amountLkr: 50_000 }], 50_000);
  assert.equal(r.amountDue, 0);
  assert.equal(r.netCash, 0);
  assert.equal(r.status, "paid");
});

test("waiver exceeds total → amountDue clamped to 0, status paid", () => {
  const r = statusFor([{ type: "waiver", amountLkr: 75_000 }], 50_000);
  assert.equal(r.amountDue, 0);
  assert.equal(r.status, "paid");
});

test("mixed: payment + refund + waiver + credit", () => {
  // total 100k. payments 80k. refund 10k. waiver 5k. credit 5k.
  // netCash = 70k. totalDeducted = 10k. amountDue = 90k. 70 < 90 → part_paid.
  const r = statusFor(
    [
      { type: "payment", amountLkr: 80_000 },
      { type: "refund", amountLkr: 10_000 },
      { type: "waiver", amountLkr: 5_000 },
      { type: "credit_note", amountLkr: 5_000 },
    ],
    100_000,
  );
  assert.equal(r.netCash, 70_000);
  assert.equal(r.totalDeducted, 10_000);
  assert.equal(r.amountDue, 90_000);
  assert.equal(r.status, "part_paid");
});

test("netCash exceeds amountDue (overpayment) → still paid", () => {
  // The route exposes overpayment via netCash > amountDue elsewhere; the
  // reconciliation enum has no "overpaid" value, so it stays "paid".
  const r = statusFor([{ type: "payment", amountLkr: 60_000 }], 50_000);
  assert.equal(r.netCash, 60_000);
  assert.equal(r.amountDue, 50_000);
  assert.equal(r.status, "paid");
});

test("refund exceeds payment → netCash negative, clamped, status unpaid", () => {
  const r = statusFor(
    [
      { type: "payment", amountLkr: 20_000 },
      { type: "refund", amountLkr: 30_000 },
    ],
    50_000,
  );
  assert.equal(r.netCash, -10_000);
  // Caller clamps before storing; deriveReconciliationStatus receives 0.
  assert.equal(r.status, "unpaid");
});
