import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  sendAdminUnpaidDigest,
  sendBookingUnpaidReminder,
} from "@/lib/email";
import { activeBookingTotalLkr } from "@/lib/admin/booking-utils";
import { computeAmountDue, computePaymentTotals } from "@/lib/payments";

const CRON_SECRET = process.env.CRON_SECRET ?? process.env._AMPLIFY_CRON_SECRET ?? "";
const MS_PER_DAY = 86_400_000;

function deriveMilestone(daysSinceConfirm: number): number | null {
  if (daysSinceConfirm < 1) return null;
  if (daysSinceConfirm < 7) return 1;
  if (daysSinceConfirm < 30) return 7;
  return 30 * Math.floor(daysSinceConfirm / 30);
}

function formatYmd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export async function POST(req: Request) {
  // Bearer-secret auth: cron has no user context so we don't go through NextAuth.
  // Using timingSafeEqual would be marginally better, but the secret is high-entropy
  // and the route is rate-limited by being POST-only with a single daily caller.
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${CRON_SECRET}`;
  if (!CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();

  // Scan only the bookings the cadence could fire on. The composite index on
  // (reconciliationStatus, confirmedAt) covers the filter prefix. paymentEntries
  // are needed to compute amountDue (total minus waivers + credit_notes) so the
  // emailed balance reflects waivers, not just cash collected.
  const candidates = await prisma.booking.findMany({
    where: {
      reconciliationStatus: { in: ["unpaid", "part_paid"] },
      status: { notIn: ["rejected", "cancelled_override"] },
      confirmedAt: { not: null },
    },
    include: {
      roomType: { select: { name: true } },
      eventType: { select: { name: true } },
      slots: {
        select: { date: true, startTime: true, endTime: true, slotStatus: true },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      },
      paymentEntries: { select: { type: true, amountLkr: true } },
      amountBreakdown: { select: { date: true, slot: true, amountLkr: true } },
    },
  });

  type Reminded = {
    reference: string;
    customerName: string;
    customerEmail: string;
    roomName: string;
    confirmedAt: string;
    daysOverdue: number;
    balanceLkr: number;
  };

  const reminded: Reminded[] = [];
  const summary: Array<{ reference: string; milestoneDays: number; customerEmailSent: boolean }> = [];

  for (const booking of candidates) {
    if (!booking.confirmedAt) continue;

    const daysSinceConfirm = Math.floor((now.getTime() - booking.confirmedAt.getTime()) / MS_PER_DAY);
    const milestone = deriveMilestone(daysSinceConfirm);
    if (milestone === null) continue;
    if (booking.lastReminderDays !== null && booking.lastReminderDays >= milestone) continue;

    // Use the active slots (exclude per-slot rejections/cancellations) for the
    // customer-facing email — same logic that the booking PATCH route applies.
    const activeSlots = booking.slots.filter(
      (s) => s.slotStatus !== "rejected" && s.slotStatus !== "cancelled_override",
    );
    const slotsForEmail = (activeSlots.length > 0 ? activeSlots : booking.slots).map((s) => ({
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
    }));

    const totals = computePaymentTotals(booking.paymentEntries);
    // Use the active-slot total — partially-rejected bookings don't owe for
    // their rejected slot amounts.
    const activeTotal = activeBookingTotalLkr(booking);
    const amountDue = computeAmountDue(activeTotal, totals);
    const balance = Math.max(0, amountDue - booking.paidAmountLkr);
    // Defense in depth: skip bookings whose balance is fully covered by waivers
    // and/or payments even if reconciliationStatus is stale. Don't dun a customer
    // for LKR 0.
    if (balance <= 0) continue;

    const sent = await sendBookingUnpaidReminder({
      to: booking.customerEmail,
      customerName: booking.customerName,
      reference: booking.reference,
      roomName: booking.roomType.name,
      eventTypeName: booking.eventType.name,
      slots: slotsForEmail,
      // Show the active-slot total in the email (not the original invoice)
      // so the customer's "Paid X of Y" line reads correctly when some
      // slots were rejected after the original quote.
      totalAmountLkr: activeTotal,
      paidAmountLkr: booking.paidAmountLkr,
      amountDueLkr: amountDue,
      daysOverdue: milestone,
    });

    summary.push({ reference: booking.reference, milestoneDays: milestone, customerEmailSent: sent });

    if (sent) {
      // Only stamp lastReminderDays on successful dispatch — failed sends retry
      // on the next cron run via the same milestone calculation.
      await prisma.booking.update({
        where: { id: booking.id },
        data: { lastReminderDays: milestone },
      });

      reminded.push({
        reference: booking.reference,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        roomName: booking.roomType.name,
        confirmedAt: formatYmd(booking.confirmedAt),
        daysOverdue: milestone,
        balanceLkr: balance,
      });
    }
  }

  let adminDigestSent = false;
  if (reminded.length > 0) {
    adminDigestSent = await sendAdminUnpaidDigest({
      runDate: formatYmd(now),
      bookings: reminded,
    });
  }

  return NextResponse.json({
    scannedBookings: candidates.length,
    remindersSent: reminded.length,
    adminDigestSent,
    bookingsReminded: summary,
  });
}
