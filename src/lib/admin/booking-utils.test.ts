import { strict as assert } from "node:assert";
import { test } from "node:test";
import { computeSlotAllocations } from "./booking-utils.ts";

type BookingStatus = "pending" | "confirmed" | "tentative" | "rejected" | "cancelled_override";

function mkBooking({
  slots,
  paymentEntries = [],
  status = "confirmed" as BookingStatus,
}: {
  slots: Array<{ date: string; startTime: string; endTime: string; amountLkr: number; slotStatus?: BookingStatus | null }>;
  paymentEntries?: Array<{ type: "payment" | "refund" | "waiver" | "credit_note"; amountLkr: number }>;
  status?: BookingStatus;
}) {
  return {
    status,
    slots: slots.map((s) => ({
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      slotStatus: s.slotStatus,
    })),
    amountBreakdown: slots.map((s) => ({
      date: s.date,
      slot: `${s.startTime}-${s.endTime}`,
      amountLkr: s.amountLkr,
    })),
    paymentEntries,
  };
}

test("no payments → every active slot unpaid", () => {
  const result = computeSlotAllocations(
    mkBooking({
      slots: [
        { date: "2026-05-20", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
        { date: "2026-05-21", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
      ],
    }),
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].status, "unpaid");
  assert.equal(result[0].balanceLkr, 1000);
  assert.equal(result[1].status, "unpaid");
});

test("payments allocate oldest → newest", () => {
  const result = computeSlotAllocations(
    mkBooking({
      slots: [
        { date: "2026-05-20", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
        { date: "2026-05-21", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
        { date: "2026-05-22", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
      ],
      paymentEntries: [{ type: "payment", amountLkr: 1500 }],
    }),
  );
  assert.equal(result[0].status, "paid");
  assert.equal(result[0].paidLkr, 1000);
  assert.equal(result[1].status, "part_paid");
  assert.equal(result[1].paidLkr, 500);
  assert.equal(result[2].status, "unpaid");
});

test("waivers allocate newest → oldest over active slots", () => {
  const result = computeSlotAllocations(
    mkBooking({
      slots: [
        { date: "2026-05-20", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
        { date: "2026-05-21", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
      ],
      paymentEntries: [{ type: "waiver", amountLkr: 1500 }],
    }),
  );
  // Newest gets full 1000 waiver, oldest gets 500.
  assert.equal(result[1].waiverLkr, 1000);
  assert.equal(result[1].status, "waived");
  assert.equal(result[0].waiverLkr, 500);
  assert.equal(result[0].status, "part_paid");
});

test("rejected slot with prior payment + refund — refund reverses from rejected slot", () => {
  // Regression check from plan: 2 slots × 1000, paid 2000 (both paid),
  // reject slot 2, refund 1000. Expect slot 1 still PAID, slot 2 rejected.
  const result = computeSlotAllocations(
    mkBooking({
      slots: [
        { date: "2026-05-20", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
        { date: "2026-05-21", startTime: "07:00", endTime: "08:00", amountLkr: 1000, slotStatus: "rejected" },
      ],
      paymentEntries: [
        { type: "payment", amountLkr: 2000 },
        { type: "refund", amountLkr: 1000 },
      ],
    }),
  );
  assert.equal(result[0].status, "paid");
  assert.equal(result[0].paidLkr, 1000);
  assert.equal(result[1].status, "rejected");
});

test("waiver re-flows when newest slot is later rejected", () => {
  // Regression check from plan: 2 slots × 1000, waive 1000, reject slot 2.
  // Waiver should re-flow to slot 1.
  const result = computeSlotAllocations(
    mkBooking({
      slots: [
        { date: "2026-05-20", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
        { date: "2026-05-21", startTime: "07:00", endTime: "08:00", amountLkr: 1000, slotStatus: "rejected" },
      ],
      paymentEntries: [{ type: "waiver", amountLkr: 1000 }],
    }),
  );
  assert.equal(result[0].status, "waived");
  assert.equal(result[0].waiverLkr, 1000);
  assert.equal(result[1].status, "rejected");
});

test("rejected-only booking — all slots rejected", () => {
  const result = computeSlotAllocations(
    mkBooking({
      slots: [
        { date: "2026-05-20", startTime: "07:00", endTime: "08:00", amountLkr: 1000, slotStatus: "rejected" },
      ],
    }),
  );
  assert.equal(result[0].status, "rejected");
  assert.equal(result[0].balanceLkr, 0);
});

test("over-payment leaves residual outside slots — booking-level overpaid", () => {
  // 2 slots × 1000, customer paid 2500. Both slots fully paid; 500 excess.
  const result = computeSlotAllocations(
    mkBooking({
      slots: [
        { date: "2026-05-20", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
        { date: "2026-05-21", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
      ],
      paymentEntries: [{ type: "payment", amountLkr: 2500 }],
    }),
  );
  assert.equal(result[0].status, "paid");
  assert.equal(result[0].paidLkr, 1000);
  assert.equal(result[1].status, "paid");
  assert.equal(result[1].paidLkr, 1000);
  // The excess 500 is implicit (booking-level overpaid).
});

test("mixed: payment + waiver + credit_note", () => {
  // 3 slots × 1000, paid 1000 (cash), waiver 500, credit_note 500.
  // Pass 1: payment 1000 → slot1 paid. Pass 3: waiver 500 newest → slot3 waiverLkr=500.
  // Pass 4: credit_note 500 newest → slot3 already has 500 waiver. capacity = 1000 - 0 - 500 - 0 = 500. Fill 500.
  // Result: slot1 paid (1000), slot2 unpaid, slot3 waived (waiver 500 + credit 500).
  const result = computeSlotAllocations(
    mkBooking({
      slots: [
        { date: "2026-05-20", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
        { date: "2026-05-21", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
        { date: "2026-05-22", startTime: "07:00", endTime: "08:00", amountLkr: 1000 },
      ],
      paymentEntries: [
        { type: "payment", amountLkr: 1000 },
        { type: "waiver", amountLkr: 500 },
        { type: "credit_note", amountLkr: 500 },
      ],
    }),
  );
  assert.equal(result[0].status, "paid");
  assert.equal(result[1].status, "unpaid");
  assert.equal(result[2].status, "waived");
  assert.equal(result[2].waiverLkr, 500);
  assert.equal(result[2].creditNoteLkr, 500);
});

test("free slot (amountLkr=0) is always paid", () => {
  const result = computeSlotAllocations(
    mkBooking({
      slots: [
        { date: "2026-05-20", startTime: "07:00", endTime: "08:00", amountLkr: 0 },
      ],
    }),
  );
  assert.equal(result[0].status, "paid");
});
