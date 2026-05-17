import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { readCalendarDb } from "@/lib/calendar-store";
import { Booking, BookingSlot } from "@/lib/calendar-types";

function isValidYmd(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return !isNaN(new Date(v + "T00:00:00").getTime());
}

type SlotEffectiveStatus = Booking["status"];

function slotEffectiveStatus(slot: BookingSlot, bookingStatus: Booking["status"]): SlotEffectiveStatus {
  return (slot.slotStatus ?? bookingStatus) as SlotEffectiveStatus;
}

function allocatePayments(booking: Booking, activeSlotKeys: Set<string>) {
  const netCash = booking.paymentEntries.reduce((sum, e) => {
    if (e.type === "payment") return sum + e.amountLkr;
    if (e.type === "refund") return sum - e.amountLkr;
    return sum;
  }, 0);
  const totalWaiver = booking.paymentEntries.reduce(
    (sum, e) => (e.type === "waiver" ? sum + e.amountLkr : sum),
    0,
  );
  const totalCredit = booking.paymentEntries.reduce(
    (sum, e) => (e.type === "credit_note" ? sum + e.amountLkr : sum),
    0,
  );

  const activeSlots = booking.slots
    .filter((s) => activeSlotKeys.has(`${s.date}|${s.startTime}`))
    .sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.startTime < b.startTime ? -1 : 1,
    );

  let remainingCash = Math.max(0, netCash);
  let remainingWaiver = Math.max(0, totalWaiver);
  let remainingCredit = Math.max(0, totalCredit);

  const alloc = new Map<
    string,
    { paidLkr: number; waiverLkr: number; creditNoteLkr: number }
  >();

  for (const slot of activeSlots) {
    const key = `${slot.date}|${slot.startTime}`;
    const bd = booking.amountBreakdown.find(
      (b) => b.date === slot.date && b.slot === `${slot.startTime}-${slot.endTime}`,
    );
    const amount = bd?.amountLkr ?? 0;

    const cashAlloc = Math.min(remainingCash, amount);
    remainingCash = Math.max(0, remainingCash - cashAlloc);

    const afterCash = Math.max(0, amount - cashAlloc);
    const waiverAlloc = Math.min(remainingWaiver, afterCash);
    remainingWaiver = Math.max(0, remainingWaiver - waiverAlloc);

    const afterWaiver = Math.max(0, afterCash - waiverAlloc);
    const creditAlloc = Math.min(remainingCredit, afterWaiver);
    remainingCredit = Math.max(0, remainingCredit - creditAlloc);

    alloc.set(key, { paidLkr: cashAlloc, waiverLkr: waiverAlloc, creditNoteLkr: creditAlloc });
  }

  return alloc;
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";

  if (!isValidYmd(from) || !isValidYmd(to) || from > to) {
    return NextResponse.json(
      { message: "from and to query params are required and must be valid YYYY-MM-DD dates with from <= to." },
      { status: 400 },
    );
  }

  const db = await readCalendarDb();
  const roomMap = Object.fromEntries(db.rooms.map((r) => [r.id, r.name]));
  const eventMap = Object.fromEntries(db.eventTypes.map((e) => [e.id, e.name]));

  const rows = [];

  for (const booking of db.bookings) {
    for (const slot of booking.slots) {
      if (slot.date < from || slot.date > to) continue;

      const effStatus = slotEffectiveStatus(slot, booking.status);
      const isActive = effStatus !== "rejected" && effStatus !== "cancelled_override";

      const activeSlotKeys = new Set(
        booking.slots
          .filter((s) => {
            const eff = slotEffectiveStatus(s, booking.status);
            return eff !== "rejected" && eff !== "cancelled_override";
          })
          .map((s) => `${s.date}|${s.startTime}`),
      );

      const alloc = allocatePayments(booking, activeSlotKeys);
      const slotKey = `${slot.date}|${slot.startTime}`;
      const slotAlloc = alloc.get(slotKey) ?? { paidLkr: 0, waiverLkr: 0, creditNoteLkr: 0 };

      const bd = booking.amountBreakdown.find(
        (b) => b.date === slot.date && b.slot === `${slot.startTime}-${slot.endTime}`,
      );
      const slotAmountLkr = isActive ? (bd?.amountLkr ?? 0) : 0;
      const slotPaidLkr = isActive ? slotAlloc.paidLkr : 0;
      const slotWaiverLkr = isActive ? slotAlloc.waiverLkr : 0;
      const slotCreditNoteLkr = isActive ? slotAlloc.creditNoteLkr : 0;
      const slotBalanceLkr = Math.max(
        0,
        slotAmountLkr - slotPaidLkr - slotWaiverLkr - slotCreditNoteLkr,
      );

      let slotPaymentStatus: "paid" | "part_paid" | "unpaid" | "waived" = "unpaid";
      if (!isActive) {
        slotPaymentStatus = "unpaid";
      } else if (slotBalanceLkr === 0 && slotAmountLkr > 0) {
        slotPaymentStatus = slotWaiverLkr > 0 && slotPaidLkr === 0 ? "waived" : "paid";
      } else if (slotPaidLkr > 0 || slotWaiverLkr > 0 || slotCreditNoteLkr > 0) {
        slotPaymentStatus = "part_paid";
      }

      rows.push({
        slotDate: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        slotEffectiveStatus: effStatus,
        rejectReason: slot.rejectReason ?? booking.rejectReason ?? undefined,
        bookingReference: booking.reference,
        bookingId: booking.id,
        customerName: booking.customer.name,
        customerEmail: booking.customer.email,
        customerPhone: booking.customer.phone,
        customerPurpose: booking.customer.purpose,
        roomName: roomMap[booking.roomTypeId] ?? booking.roomTypeId,
        eventTypeName: eventMap[booking.eventTypeId] ?? booking.eventTypeId,
        acMode: booking.acMode,
        bookingCreatedAt: booking.createdAt,
        slotAmountLkr,
        slotPaidLkr,
        slotWaiverLkr,
        slotCreditNoteLkr,
        slotBalanceLkr,
        slotPaymentStatus,
        bookingTotalAmountLkr: booking.totalAmountLkr,
        bookingPaidAmountLkr: booking.paidAmountLkr,
        reconciliationStatus: booking.reconciliationStatus,
        paymentEntries: booking.paymentEntries.map((e) => ({
          type: e.type,
          date: e.date,
          amountLkr: e.amountLkr,
          receiptNo: e.receiptNo,
          notes: e.notes,
        })),
      });
    }
  }

  rows.sort((a, b) =>
    a.slotDate !== b.slotDate
      ? a.slotDate < b.slotDate ? -1 : 1
      : a.startTime < b.startTime ? -1 : 1,
  );

  return NextResponse.json({ rows });
}
