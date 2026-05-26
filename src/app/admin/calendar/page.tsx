import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import {
  AdminHub,
  type ActivityBookingLookup,
  type HubActivity,
  type HubKpis,
} from "@/components/admin/hub/admin-hub";
import { authOptions } from "@/lib/auth";
import { buildRevenueModel } from "@/lib/admin/revenue-model";
import { buildConflictPairs } from "@/lib/admin/conflict-detector";
import { prisma } from "@/lib/prisma";
import type {
  AcMode,
  BookingStatus,
  DayType,
  PaymentEntryType,
  ReconciliationStatus,
} from "@/lib/calendar-types";

export const dynamic = "force-dynamic";

export default async function AdminCalendarHubPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/admin/login?next=/admin/calendar");
  }
  const email = session.user.email ?? "—";
  const isSuperAdmin = session.user.role === "super_admin";

  // ─── Date boundaries ───────────────────────────────────────────────────
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  // Week-of bounds for the activeBlocks tile (Mon-start week).
  const dow = todayStart.getDay();
  const diff = (dow === 0 ? -6 : 1) - dow;
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() + diff);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  const weekStartYmd = weekStart.toISOString().slice(0, 10);
  const weekEndYmd = weekEnd.toISOString().slice(0, 10);

  // Revenue window: last 90 days, cohort-attributed by Booking.createdAt.
  const ninetyDaysAgo = new Date(todayStart);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 89);
  const rangeStart = ninetyDaysAgo.toISOString().slice(0, 10);
  const rangeEnd = todayStart.toISOString().slice(0, 10);

  // ─── Parallel scoped queries ───────────────────────────────────────────
  const [
    pendingCount,
    tentativeCount,
    approvedTodayCount,
    activeBlocksCount,
    outstandingResult,
    conflictScanRows,
    revenueRows,
    auditRows,
  ] = await prisma.$transaction([
    prisma.booking.count({ where: { status: "pending" } }),
    prisma.booking.count({ where: { status: "tentative" } }),
    prisma.booking.count({
      where: {
        status: "confirmed",
        confirmedAt: { gte: todayStart, lt: tomorrowStart },
      },
    }),
    prisma.calendarBlock.count({
      where: { date: { gte: weekStartYmd, lt: weekEndYmd } },
    }),
    prisma.$queryRaw<{ outstanding: bigint | null }[]>(Prisma.sql`
      SELECT COALESCE(SUM(GREATEST(0, b."totalAmountLkr" - b."paidAmountLkr" - COALESCE(d.total, 0))), 0)::bigint AS outstanding
      FROM "Booking" b
      LEFT JOIN (
        SELECT "bookingId", SUM("amountLkr")::bigint AS total
        FROM "PaymentEntry"
        WHERE "type" IN ('waiver', 'credit_note')
        GROUP BY "bookingId"
      ) d ON d."bookingId" = b."id"
      WHERE b."status" IN ('pending', 'confirmed', 'tentative')
    `),
    // Conflict scan — slot positions only.
    prisma.booking.findMany({
      where: { status: { in: ["pending", "confirmed", "tentative"] } },
      select: {
        id: true,
        roomTypeId: true,
        status: true,
        slots: {
          select: { date: true, startTime: true, endTime: true, slotStatus: true },
        },
      },
    }),
    // 90-day revenue window — fields needed by buildRevenueModel only.
    prisma.booking.findMany({
      where: { createdAt: { gte: ninetyDaysAgo } },
      include: {
        amountBreakdown: true,
        paymentEntries: true,
        slots: true,
      },
    }),
    prisma.auditLog.findMany({
      where: { resourceType: "booking" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        createdAt: true,
        actorEmail: true,
        action: true,
        resourceId: true,
        meta: true,
        actor: { select: { role: true } },
      },
    }),
  ]);

  const conflictPairs = buildConflictPairs(conflictScanRows);
  const outstandingLkr = Number(outstandingResult[0]?.outstanding ?? 0);

  const kpis: HubKpis = {
    pending: pendingCount,
    tentative: tentativeCount,
    approvedToday: approvedTodayCount,
    activeBlocks: activeBlocksCount,
    outstandingLkr,
    conflictCount: conflictPairs.size,
  };

  // Adapt the 90-day window rows to the BookingForRevenue shape expected
  // by buildRevenueModel.
  const revenueBookings = revenueRows.map((row) => ({
    id: row.id,
    reference: row.reference,
    roomTypeId: row.roomTypeId,
    eventTypeId: row.eventTypeId,
    acMode: row.acMode as AcMode,
    status: row.status as BookingStatus,
    totalAmountLkr: row.totalAmountLkr,
    paidAmountLkr: row.paidAmountLkr,
    reconciliationStatus: row.reconciliationStatus as ReconciliationStatus,
    paymentEntries: row.paymentEntries.map((p) => ({
      type: p.type as PaymentEntryType,
      amountLkr: p.amountLkr,
    })),
    customer: { name: row.customerName },
    slots: row.slots.map((s) => ({
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      slotStatus: (s.slotStatus ?? undefined) as BookingStatus | undefined,
    })),
    amountBreakdown: row.amountBreakdown.map((bd) => ({
      date: bd.date,
      slot: bd.slot,
      amountLkr: bd.amountLkr,
      dayType: bd.dayType as DayType,
    })),
    createdAt: row.createdAt.toISOString(),
  }));

  const revenue = buildRevenueModel(revenueBookings, rangeStart, rangeEnd);

  // Booking lookup for the RecentActivity rows — only fetch the bookings
  // actually referenced by an audit-log entry (max 8 unique ids).
  const referencedBookingIds = Array.from(
    new Set(auditRows.map((row) => row.resourceId).filter((id): id is string => Boolean(id))),
  );
  const activityBookingRows = referencedBookingIds.length > 0
    ? await prisma.booking.findMany({
        where: { id: { in: referencedBookingIds } },
        select: {
          id: true,
          reference: true,
          customerName: true,
          customerPurpose: true,
        },
      })
    : [];
  const activityBookings: ActivityBookingLookup[] = activityBookingRows.map((b) => ({
    id: b.id,
    reference: b.reference,
    customerName: b.customerName,
    customerPurpose: b.customerPurpose,
  }));

  const activity: HubActivity[] = auditRows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    actorEmail: row.actorEmail,
    actorRole: row.actor?.role === "super_admin" ? "super_admin" : row.actor ? "admin" : "system",
    action: row.action,
    resourceId: row.resourceId,
    meta: (row.meta as Record<string, unknown> | null) ?? null,
  }));

  return (
    <AdminHub
      activity={activity}
      activityBookings={activityBookings}
      email={email}
      isSuperAdmin={isSuperAdmin}
      kpis={kpis}
      revenue={revenue}
    />
  );
}
