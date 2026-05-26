import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { computeSlotAllocations } from "@/lib/admin/booking-utils";
import { prisma } from "@/lib/prisma";
import type {
  AcMode,
  Booking,
  BookingSlot,
  DayType,
  PaymentEntryType,
  ReconciliationStatus,
} from "@/lib/calendar-types";

function isValidYmd(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return !isNaN(new Date(v + "T00:00:00").getTime());
}

type SlotEffectiveStatus = Booking["status"];

function slotEffectiveStatus(slot: BookingSlot, bookingStatus: Booking["status"]): SlotEffectiveStatus {
  return (slot.slotStatus ?? bookingStatus) as SlotEffectiveStatus;
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

  // Scoped: only bookings with at least one slot in the requested window.
  // Each booking still loads all its slots (computeSlotAllocations needs the
  // full slot set to allocate payments correctly across active vs rejected
  // slots), plus its amountBreakdown + paymentEntries. Rooms and event
  // types are loaded separately as full lists (small).
  const [bookingRows, roomRows, eventRows] = await prisma.$transaction([
    prisma.booking.findMany({
      where: { slots: { some: { date: { gte: from, lte: to } } } },
      include: {
        slots: true,
        amountBreakdown: true,
        paymentEntries: { orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.roomType.findMany({ select: { id: true, name: true } }),
    prisma.eventType.findMany({ select: { id: true, name: true } }),
  ]);

  const roomMap = Object.fromEntries(roomRows.map((r) => [r.id, r.name]));
  const eventMap = Object.fromEntries(eventRows.map((e) => [e.id, e.name]));

  const rows = [];

  for (const row of bookingRows) {
    // Build a Booking-shaped object for the helper.
    const booking: Booking = {
      id: row.id,
      reference: row.reference,
      roomTypeId: row.roomTypeId,
      eventTypeId: row.eventTypeId,
      acMode: row.acMode as AcMode,
      status: row.status,
      cleanupDurationMinutes: row.cleanupDurationMinutes,
      slots: row.slots.map((slot) => ({
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        slotStatus: (slot.slotStatus ?? undefined) as Booking["status"] | undefined,
        rejectReason: slot.rejectReason ?? undefined,
      })),
      customer: {
        name: row.customerName,
        email: row.customerEmail,
        phone: row.customerPhone,
        purpose: row.customerPurpose,
      },
      totalAmountLkr: row.totalAmountLkr,
      paidAmountLkr: row.paidAmountLkr,
      amountBreakdown: row.amountBreakdown.map((item) => ({
        date: item.date,
        slot: item.slot,
        amountLkr: item.amountLkr,
        dayType: item.dayType as DayType,
      })),
      reconciliationStatus: row.reconciliationStatus as ReconciliationStatus,
      reconciliationNotes: row.reconciliationNotes,
      rejectReason: row.rejectReason ?? undefined,
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : undefined,
      lastReminderDays: row.lastReminderDays ?? undefined,
      paymentEntries: row.paymentEntries.map((entry) => ({
        id: entry.id,
        bookingId: entry.bookingId,
        type: entry.type as PaymentEntryType,
        date: entry.date,
        amountLkr: entry.amountLkr,
        receiptNo: entry.receiptNo,
        notes: entry.notes,
        createdAt: entry.createdAt.toISOString(),
        createdBy: entry.createdBy,
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      overriddenBookingIds: [],
    };

    // Per-slot allocation uses the shared helper — payments oldest→newest,
    // refunds/waivers/credit_notes newest→oldest. See computeSlotAllocations
    // in src/lib/admin/booking-utils.ts for the algorithm.
    const allocations = computeSlotAllocations(booking);
    const allocByKey = new Map(allocations.map((a) => [a.key, a]));

    for (const slot of booking.slots) {
      if (slot.date < from || slot.date > to) continue;

      const effStatus = slotEffectiveStatus(slot, booking.status);
      const slotKey = `${slot.date}|${slot.startTime}`;
      const alloc = allocByKey.get(slotKey);
      const slotAmountLkr = alloc?.amountLkr ?? 0;
      const slotPaidLkr = alloc?.paidLkr ?? 0;
      const slotWaiverLkr = alloc?.waiverLkr ?? 0;
      const slotCreditNoteLkr = alloc?.creditNoteLkr ?? 0;
      const slotBalanceLkr = alloc?.balanceLkr ?? 0;
      // Map the shared helper's status to the legacy reports schema.
      // Rejected → "unpaid" preserves the CSV column shape (the
      // slotEffectiveStatus column carries the rejection info).
      const slotPaymentStatus: "paid" | "part_paid" | "unpaid" | "waived" =
        alloc?.status === "rejected" ? "unpaid" : (alloc?.status ?? "unpaid");

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
