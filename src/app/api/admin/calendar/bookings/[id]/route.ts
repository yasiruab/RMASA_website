import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import type {
  AcMode,
  Booking,
  BookingStatus,
  DayType,
  PaymentEntryType,
  ReconciliationStatus,
} from "@/lib/calendar-types";

export const dynamic = "force-dynamic";

// Returns the full single booking for the admin detail pane. Replaces the
// previous pattern of pulling the entire bookings list and finding by id on
// the client — that only worked when the row happened to be inside the
// current page.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ message: "Booking id is required." }, { status: 400 });
  }

  const row = await prisma.booking.findUnique({
    where: { id },
    include: {
      slots: true,
      amountBreakdown: true,
      paymentEntries: { orderBy: { createdAt: "asc" } },
      overriddenTargets: true,
    },
  });

  if (!row) {
    return NextResponse.json({ message: "Booking not found." }, { status: 404 });
  }

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
      slotStatus: (slot.slotStatus ?? undefined) as BookingStatus | undefined,
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
    overriddenBookingIds: row.overriddenTargets.map((t) => t.overriddenBookingId),
  };

  return NextResponse.json({ booking });
}
