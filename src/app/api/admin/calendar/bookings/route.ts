import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { logAuditEvent } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth-guards";
import {
  sendBookingStatusNotification,
  sendAdminRejectionNotification,
  sendBookingSlotOverriddenNotification,
  sendAdminSlotOverriddenNotification,
} from "@/lib/email";
import { evaluateBookingConflicts, type OverrideTarget } from "@/lib/calendar-core";
import {
  readCalendarDb,
  updateBookingSlotStatus,
  updateBookingSlotsBatch,
  updateBookingStatus,
} from "@/lib/calendar-store";
import { buildConflictPairs } from "@/lib/admin/conflict-detector";
import { prisma } from "@/lib/prisma";
import {
  AcMode,
  Booking,
  BookingSlot,
  BookingStatus,
  DayType,
  PaymentEntryType,
  ReconciliationStatus,
} from "@/lib/calendar-types";

// ─── Pagination params (page mode) ────────────────────────────────────────
const APPROVAL_VALUES = ["pending", "tentative", "confirmed", "rejected"] as const;
type ApprovalValue = (typeof APPROVAL_VALUES)[number];
const PAYMENT_VALUES = ["unpaid", "part_paid", "paid", "overpaid"] as const;
type PaymentValue = (typeof PAYMENT_VALUES)[number];
const CONFLICT_VALUES = ["all", "with", "without"] as const;
type ConflictFilter = (typeof CONFLICT_VALUES)[number];

function parseMulti<T extends string>(value: string | null, allowed: readonly T[]): Set<T> {
  if (!value) return new Set();
  const allow = new Set<string>(allowed);
  const out = new Set<T>();
  for (const part of value.split(",")) {
    const t = part.trim();
    if (allow.has(t)) out.add(t as T);
  }
  return out;
}

function parseEnum<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

type BookingRowFromDb = Awaited<ReturnType<typeof loadFullBookings>>[number];

async function loadFullBookings(where: Parameters<typeof prisma.booking.findMany>[0] extends infer P
  ? P extends { where?: infer W }
    ? W
    : never
  : never) {
  return prisma.booking.findMany({
    where,
    include: {
      slots: true,
      amountBreakdown: true,
      paymentEntries: { orderBy: { createdAt: "asc" } },
      overriddenTargets: true,
    },
  });
}

function toBooking(row: BookingRowFromDb): Booking {
  return {
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
}

type Kpis = {
  pending: number;
  tentative: number;
  approvedToday: number;
  rejectedToday: number;
  confirmRate: number;
  outstanding: number;
  conflicts: number;
};

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const { searchParams } = new URL(req.url);
  const pageParam = searchParams.get("page");

  // ─── Legacy mode (no ?page) ────────────────────────────────────────────
  // Preserves the current response shape for callers that haven't migrated
  // (admin-calendar-console.tsx, admin-revenue.tsx). Supports an optional
  // ?fromDate=&toDate= window used by the admin-schedule week view — when
  // both are present, only bookings with at least one slot inside the
  // window are returned, which is hundreds-of-rows lighter than the full
  // table scan.
  if (pageParam === null) {
    const fromDate = searchParams.get("fromDate") ?? "";
    const toDate = searchParams.get("toDate") ?? "";
    const isWindowScoped =
      /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(toDate) && fromDate <= toDate;

    if (isWindowScoped) {
      const [bookingRows, roomRows, eventTypeRows] = await prisma.$transaction([
        prisma.booking.findMany({
          where: { slots: { some: { date: { gte: fromDate, lte: toDate } } } },
          include: {
            slots: true,
            amountBreakdown: true,
            paymentEntries: { orderBy: { createdAt: "asc" } },
            overriddenTargets: true,
          },
        }),
        prisma.roomType.findMany(),
        prisma.eventType.findMany(),
      ]);
      return NextResponse.json({
        bookings: bookingRows.map(toBooking),
        rooms: roomRows.map((r) => ({
          id: r.id,
          name: r.name,
          workingHours: { startTime: r.startTime, endTime: r.endTime },
          capacity: r.capacity ?? undefined,
          description: r.description ?? undefined,
        })),
        eventTypes: eventTypeRows.map((e) => ({
          id: e.id,
          name: e.name,
          durationMinutes: e.durationMinutes,
          cleanupDurationMinutes: e.cleanupDurationMinutes,
          maxAdvanceBookingDays: e.maxAdvanceBookingDays,
          priority: e.priority,
          roomTypeId: e.roomTypeId ?? undefined,
        })),
      });
    }

    const db = await readCalendarDb();
    return NextResponse.json({
      bookings: db.bookings,
      rooms: db.rooms,
      eventTypes: db.eventTypes,
    });
  }

  // ─── Paginated mode ────────────────────────────────────────────────────
  const page = Math.max(1, Math.floor(Number(pageParam) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(searchParams.get("pageSize")) || 20)));
  const approval = parseMulti<ApprovalValue>(searchParams.get("approval"), APPROVAL_VALUES);
  const payment = parseMulti<PaymentValue>(searchParams.get("payment"), PAYMENT_VALUES);
  const conflictFilter = parseEnum<ConflictFilter>(
    searchParams.get("conflict"),
    CONFLICT_VALUES,
    "all",
  );
  const q = (searchParams.get("q") ?? "").trim();
  const sort = parseEnum<"newest" | "oldest">(
    searchParams.get("sort"),
    ["newest", "oldest"] as const,
    "newest",
  );

  // Date boundaries used by KPI counts. Computed in JS so the count queries
  // can use indexed `createdAt` / `confirmedAt` range predicates directly.
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const thirtyDaysAgo = new Date(todayStart);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Compute conflict pairs first — the conflict filter on the page query
  // needs the id set. This query is light: active bookings with only their
  // slot positions (no payment data, no breakdown).
  const conflictScanRows = await prisma.booking.findMany({
    where: { status: { in: ["pending", "confirmed", "tentative"] } },
    select: {
      id: true,
      roomTypeId: true,
      status: true,
      slots: {
        select: { date: true, startTime: true, endTime: true, slotStatus: true },
      },
    },
  });
  const conflictPairs = buildConflictPairs(conflictScanRows);
  const conflictIdSet = new Set(conflictPairs.keys());

  // ─── SQL where clause for the page query ───────────────────────────────
  // Effective status (slot-override-aware) and payment tone (post-waiver)
  // are approximated by booking.status and reconciliationStatus. Mixed-slot
  // bookings — rare — may surface in the wrong tab; documented trade-off
  // until a denormalized effective_status column exists.
  const andClauses: Prisma.BookingWhereInput[] = [];

  if (q) {
    andClauses.push({
      OR: [
        { reference: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        { customerEmail: { contains: q, mode: "insensitive" } },
        { customerPurpose: { contains: q, mode: "insensitive" } },
        { id: { equals: q } },
      ],
    });
  }

  if (approval.size > 0) {
    const statusList = [...approval].filter((v) => v !== "rejected") as BookingStatus[];
    const includesRejected = approval.has("rejected");
    const approvalOr: Prisma.BookingWhereInput[] = [];
    if (statusList.length > 0) approvalOr.push({ status: { in: statusList } });
    if (includesRejected) {
      approvalOr.push({ status: "rejected" });
      approvalOr.push({ slots: { some: { slotStatus: "rejected" } } });
    }
    andClauses.push({ OR: approvalOr });
  }

  if (payment.size > 0) {
    const reconStatuses: ReconciliationStatus[] = [];
    if (payment.has("unpaid")) reconStatuses.push("unpaid");
    if (payment.has("part_paid")) reconStatuses.push("part_paid");
    if (payment.has("paid")) reconStatuses.push("paid");
    if (payment.has("overpaid")) reconStatuses.push("paid"); // overpaid is a refinement of paid
    andClauses.push({ reconciliationStatus: { in: reconStatuses } });
  }

  if (conflictFilter === "with") {
    andClauses.push({ id: { in: Array.from(conflictIdSet) } });
  } else if (conflictFilter === "without") {
    andClauses.push({ id: { notIn: Array.from(conflictIdSet) } });
  }

  const pageWhere: Prisma.BookingWhereInput = andClauses.length > 0 ? { AND: andClauses } : {};

  // ─── Parallel KPI counts + page query ──────────────────────────────────
  // Eight count queries hit indexed predicates — each is a single index
  // lookup, far cheaper than loading every booking row. The outstanding
  // figure comes from one SQL aggregate that subtracts cached
  // paidAmountLkr and any waiver/credit_note deductions in a single scan.
  const [
    pendingCount,
    tentativeCount,
    approvedTodayCount,
    rejectedTodayCount,
    last30Confirmed,
    last30Decided,
    outstandingResult,
    pageCount,
    pageRows,
    rooms,
    eventTypes,
  ] = await prisma.$transaction([
    prisma.booking.count({ where: { status: "pending" } }),
    prisma.booking.count({ where: { status: "tentative" } }),
    prisma.booking.count({
      where: {
        status: "confirmed",
        confirmedAt: { gte: todayStart, lt: tomorrowStart },
      },
    }),
    prisma.booking.count({
      where: {
        status: "rejected",
        createdAt: { gte: todayStart, lt: tomorrowStart },
      },
    }),
    prisma.booking.count({
      where: { status: "confirmed", createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.booking.count({
      where: {
        status: { in: ["confirmed", "rejected"] },
        createdAt: { gte: thirtyDaysAgo },
      },
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
    prisma.booking.count({ where: pageWhere }),
    prisma.booking.findMany({
      where: pageWhere,
      orderBy: { createdAt: sort === "newest" ? "desc" : "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        slots: true,
        amountBreakdown: true,
        paymentEntries: { orderBy: { createdAt: "asc" } },
        overriddenTargets: true,
      },
    }),
    prisma.roomType.findMany(),
    prisma.eventType.findMany(),
  ]);

  const confirmRate =
    last30Decided === 0 ? 0 : Math.round((last30Confirmed / last30Decided) * 100);
  const outstanding = Number(outstandingResult[0]?.outstanding ?? 0);

  const kpis: Kpis = {
    pending: pendingCount,
    tentative: tentativeCount,
    approvedToday: approvedTodayCount,
    rejectedToday: rejectedTodayCount,
    confirmRate,
    outstanding,
    conflicts: conflictIdSet.size,
  };

  const bookings = pageRows.map(toBooking);

  return NextResponse.json({
    bookings,
    total: pageCount,
    page,
    pageSize,
    kpis,
    conflictPairs: Object.fromEntries(conflictPairs),
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      workingHours: { startTime: r.startTime, endTime: r.endTime },
      capacity: r.capacity ?? undefined,
      description: r.description ?? undefined,
    })),
    eventTypes: eventTypes.map((e) => ({
      id: e.id,
      name: e.name,
      durationMinutes: e.durationMinutes,
      cleanupDurationMinutes: e.cleanupDurationMinutes,
      maxAdvanceBookingDays: e.maxAdvanceBookingDays,
      priority: e.priority,
      roomTypeId: e.roomTypeId ?? undefined,
    })),
  });
}

type BatchSlotUpdate = {
  slotDate: string;
  slotStartTime: string;
  slotStatus: BookingStatus | null;
  rejectReason?: string;
};

type PatchPayload = {
  id?: string;
  status?: BookingStatus;
  rejectReason?: string;
  // Per-slot update fields (legacy single-slot path):
  slotDate?: string;
  slotStartTime?: string;
  slotStatus?: BookingStatus | null;
  // Batch slot save path:
  batchSlotUpdates?: BatchSlotUpdate[];
};

function deriveEffectiveStatus(slots: BookingSlot[], baseStatus: BookingStatus): BookingStatus | null {
  const active = slots.filter(
    (s) => (s.slotStatus ?? baseStatus) !== "rejected" && (s.slotStatus ?? baseStatus) !== "cancelled_override",
  );
  if (active.length === 0) return "rejected";
  const unique = [...new Set(active.map((s) => s.slotStatus ?? baseStatus))];
  return unique.length === 1 ? unique[0] : null;
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const payload = (await req.json()) as PatchPayload;
  const bookingId = String(payload.id ?? "");

  if (!bookingId) {
    return NextResponse.json({ message: "Booking id is required." }, { status: 400 });
  }

  // Scoped PATCH context — only the booking + its own room/event type are
  // needed for the common paths (batch save, single slot, booking-level
  // status change without confirmation cascade). For confirm-path conflict
  // evaluation and override-cascade emails, additional scoped loads happen
  // below. The `current` object preserves the legacy {rooms, eventTypes,
  // bookings}.find() patterns by being populated incrementally.
  const existingRow = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      slots: true,
      amountBreakdown: true,
      paymentEntries: { orderBy: { createdAt: "asc" } },
      overriddenTargets: true,
    },
  });
  if (!existingRow) {
    return NextResponse.json({ message: "Booking not found." }, { status: 404 });
  }
  const existing = toBooking(existingRow);

  const [ownRoomRow, ownEventTypeRow] = await prisma.$transaction([
    prisma.roomType.findUnique({ where: { id: existing.roomTypeId } }),
    prisma.eventType.findUnique({ where: { id: existing.eventTypeId } }),
  ]);

  const current: {
    rooms: Array<{ id: string; name: string; workingHours: { startTime: string; endTime: string }; capacity?: number; description?: string }>;
    eventTypes: Array<{ id: string; name: string; durationMinutes: number; cleanupDurationMinutes: number; maxAdvanceBookingDays: number; priority: number; roomTypeId?: string }>;
    bookings: Booking[];
  } = {
    rooms: ownRoomRow
      ? [
          {
            id: ownRoomRow.id,
            name: ownRoomRow.name,
            workingHours: { startTime: ownRoomRow.startTime, endTime: ownRoomRow.endTime },
            capacity: ownRoomRow.capacity ?? undefined,
            description: ownRoomRow.description ?? undefined,
          },
        ]
      : [],
    eventTypes: ownEventTypeRow
      ? [
          {
            id: ownEventTypeRow.id,
            name: ownEventTypeRow.name,
            durationMinutes: ownEventTypeRow.durationMinutes,
            cleanupDurationMinutes: ownEventTypeRow.cleanupDurationMinutes,
            maxAdvanceBookingDays: ownEventTypeRow.maxAdvanceBookingDays,
            priority: ownEventTypeRow.priority,
            roomTypeId: ownEventTypeRow.roomTypeId ?? undefined,
          },
        ]
      : [],
    bookings: [existing],
  };

  // ─── Batch slot save path ──────────────────────────────────────────────
  if (payload.batchSlotUpdates) {
    for (const u of payload.batchSlotUpdates) {
      if (u.slotStatus === "rejected" && !u.rejectReason?.trim()) {
        return NextResponse.json({ message: "Reject reason is required for rejected slots." }, { status: 400 });
      }
    }

    const preBatchSlots = existing.slots.map((s) => ({ ...s }));

    try {
      await updateBookingSlotsBatch(bookingId, payload.batchSlotUpdates);
    } catch (err) {
      console.error("[batch-save] updateBookingSlotsBatch failed:", err);
      const msg = err instanceof Error ? err.message : "Database error.";
      return NextResponse.json({ message: `Save failed: ${msg}` }, { status: 500 });
    }

    await logAuditEvent({
      actorUserId: auth.actor.userId,
      actorEmail: auth.actor.email,
      action: "ADMIN_BATCH_SLOTS_SAVED",
      resourceType: "booking",
      resourceId: bookingId,
      meta: { updates: payload.batchSlotUpdates.map((u) => ({ ...u })) },
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    });

    // Compute updated slot state in memory for email logic
    const updatedSlots: BookingSlot[] = existing.slots.map((slot) => {
      const upd = payload.batchSlotUpdates!.find(
        (u) => u.slotDate === slot.date && u.slotStartTime === slot.startTime,
      );
      if (!upd) return slot;
      return {
        ...slot,
        slotStatus: upd.slotStatus ?? undefined,
        rejectReason: upd.slotStatus === "rejected" ? (upd.rejectReason ?? undefined) : undefined,
      };
    });

    const newlyRejected = payload.batchSlotUpdates.filter((u) => {
      if (u.slotStatus !== "rejected") return false;
      const prev = preBatchSlots.find((s) => s.date === u.slotDate && s.startTime === u.slotStartTime);
      return prev?.slotStatus !== "rejected";
    });
    const hasNewRejections = newlyRejected.length > 0;
    const effectiveStatus = deriveEffectiveStatus(updatedSlots, existing.status);

    const room = current.rooms.find((r) => r.id === existing.roomTypeId);
    const eventType = current.eventTypes.find((et) => et.id === existing.eventTypeId);

    if (room && eventType && (effectiveStatus !== null || hasNewRejections)) {
      const allSlotStatuses = updatedSlots.map((s) => ({
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        status: (s.slotStatus ?? existing.status) as BookingStatus,
        rejectReason: s.rejectReason,
      }));

      const activeSlots = updatedSlots.filter(
        (s) => (s.slotStatus ?? existing.status) !== "rejected" &&
               (s.slotStatus ?? existing.status) !== "cancelled_override",
      );
      const activeSlotKeys = new Set(activeSlots.map((s) => `${s.date}|${s.startTime}-${s.endTime}`));
      const adjustedTotal = existing.amountBreakdown
        .filter((b) => activeSlotKeys.has(`${b.date}|${b.slot}`))
        .reduce((sum, b) => sum + b.amountLkr, 0) || existing.totalAmountLkr;

      let emailStatus: "confirmed" | "tentative" | "rejected" | "partial_update" | null = null;

      if (effectiveStatus === "confirmed") {
        emailStatus = hasNewRejections ? "partial_update" : "confirmed";
      } else if (effectiveStatus === "rejected") {
        emailStatus = "rejected";
      } else if (hasNewRejections) {
        emailStatus = "partial_update";
      }

      if (emailStatus) {
        const rejectReasonText = newlyRejected.map((u) => u.rejectReason).filter(Boolean).join("; ");
        await sendBookingStatusNotification({
          to: existing.customer.email,
          customerName: existing.customer.name,
          reference: existing.reference,
          roomName: room.name,
          eventTypeName: eventType.name,
          slots: activeSlots.length > 0 ? activeSlots : updatedSlots,
          slotStatuses: hasNewRejections ? allSlotStatuses : undefined,
          totalAmountLkr: adjustedTotal,
          newStatus: emailStatus,
          rejectReason: emailStatus === "rejected" ? rejectReasonText : undefined,
        });

        if (hasNewRejections) {
          await sendAdminRejectionNotification({
            reference: existing.reference,
            customerName: existing.customer.name,
            customerEmail: existing.customer.email,
            roomName: room.name,
            eventTypeName: eventType.name,
            slots: updatedSlots,
            rejectReason: rejectReasonText || "No reason provided",
          });
        }
      }
    }

    return NextResponse.json({ message: "Booking saved." });
  }

  // ─── Legacy single-slot path ───────────────────────────────────────────
  if (payload.slotDate && payload.slotStartTime && "slotStatus" in payload) {
    await updateBookingSlotStatus(
      bookingId,
      payload.slotDate,
      payload.slotStartTime,
      payload.slotStatus ?? null,
    );

    await logAuditEvent({
      actorUserId: auth.actor.userId,
      actorEmail: auth.actor.email,
      action: "ADMIN_SLOT_STATUS_UPDATED",
      resourceType: "booking",
      resourceId: bookingId,
      meta: { slotDate: payload.slotDate, slotStartTime: payload.slotStartTime, slotStatus: payload.slotStatus },
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    });

    return NextResponse.json({ message: "Slot updated." });
  }

  // ─── Booking-level status change ───────────────────────────────────────
  if (payload.status === "rejected" && !payload.rejectReason?.trim()) {
    return NextResponse.json({ message: "Reject reason is required when rejecting a booking." }, { status: 400 });
  }

  const nextStatus = payload.status ?? existing.status;
  let overrideTargets: OverrideTarget[] = [];
  let overrideReason = "";

  if (nextStatus === "confirmed") {
    const candidate: Booking = {
      ...existing,
      status: "confirmed",
    };
    // Scoped conflict scan: only slots in the candidate's date set, same
    // room, with active status. evaluateBookingConflicts inspects
    // db.bookings + db.blocks + db.eventTypes (for the priority compare).
    const candidateDates = Array.from(new Set(existing.slots.map((s) => s.date)));
    const [conflictSlotRows, conflictBlockRows] = await prisma.$transaction([
      prisma.bookingSlot.findMany({
        where: {
          date: { in: candidateDates },
          booking: {
            roomTypeId: existing.roomTypeId,
            status: { in: ["pending", "confirmed", "tentative"] },
            id: { not: bookingId },
          },
        },
        include: {
          booking: {
            select: {
              id: true,
              reference: true,
              roomTypeId: true,
              eventTypeId: true,
              status: true,
              cleanupDurationMinutes: true,
              customerName: true,
              customerEmail: true,
              customerPhone: true,
              customerPurpose: true,
              totalAmountLkr: true,
              paidAmountLkr: true,
              reconciliationStatus: true,
              reconciliationNotes: true,
              rejectReason: true,
              confirmedAt: true,
              lastReminderDays: true,
              createdAt: true,
              updatedAt: true,
              acMode: true,
            },
          },
        },
      }),
      prisma.calendarBlock.findMany({
        where: { roomTypeId: existing.roomTypeId, date: { in: candidateDates } },
      }),
    ]);

    // Reassemble bookings from the slot rows (each may contribute multiple
    // slots; same booking shows up once per active slot in the window).
    const conflictBookingsById = new Map<string, Booking>();
    for (const row of conflictSlotRows) {
      const b = row.booking;
      let entry = conflictBookingsById.get(b.id);
      if (!entry) {
        entry = {
          id: b.id,
          reference: b.reference,
          roomTypeId: b.roomTypeId,
          eventTypeId: b.eventTypeId,
          acMode: b.acMode as AcMode,
          status: b.status,
          cleanupDurationMinutes: b.cleanupDurationMinutes,
          slots: [],
          customer: {
            name: b.customerName,
            email: b.customerEmail,
            phone: b.customerPhone,
            purpose: b.customerPurpose,
          },
          totalAmountLkr: b.totalAmountLkr,
          paidAmountLkr: b.paidAmountLkr,
          amountBreakdown: [],
          reconciliationStatus: b.reconciliationStatus as ReconciliationStatus,
          reconciliationNotes: b.reconciliationNotes,
          rejectReason: b.rejectReason ?? undefined,
          confirmedAt: b.confirmedAt ? b.confirmedAt.toISOString() : undefined,
          lastReminderDays: b.lastReminderDays ?? undefined,
          paymentEntries: [],
          createdAt: b.createdAt.toISOString(),
          updatedAt: b.updatedAt.toISOString(),
          overriddenBookingIds: [],
        };
        conflictBookingsById.set(b.id, entry);
      }
      entry.slots.push({
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        slotStatus: (row.slotStatus ?? undefined) as BookingStatus | undefined,
        rejectReason: row.rejectReason ?? undefined,
      });
    }

    // Priorities for the bookings we loaded — needed by the priority compare.
    const referencedEventTypeIds = Array.from(
      new Set(Array.from(conflictBookingsById.values()).map((b) => b.eventTypeId)),
    );
    const conflictEventTypeRows = referencedEventTypeIds.length
      ? await prisma.eventType.findMany({
          where: { id: { in: referencedEventTypeIds } },
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            cleanupDurationMinutes: true,
            maxAdvanceBookingDays: true,
            priority: true,
            roomTypeId: true,
          },
        })
      : [];

    const conflictDb = {
      rooms: current.rooms,
      eventTypes: [
        ...current.eventTypes,
        ...conflictEventTypeRows
          .filter((et) => !current.eventTypes.some((own) => own.id === et.id))
          .map((et) => ({
            id: et.id,
            name: et.name,
            durationMinutes: et.durationMinutes,
            cleanupDurationMinutes: et.cleanupDurationMinutes,
            maxAdvanceBookingDays: et.maxAdvanceBookingDays,
            priority: et.priority,
            roomTypeId: et.roomTypeId ?? undefined,
          })),
      ],
      pricingRules: [],
      bookings: Array.from(conflictBookingsById.values()),
      blocks: conflictBlockRows.map((block) => ({
        id: block.id,
        roomTypeId: block.roomTypeId,
        date: block.date,
        startTime: block.startTime,
        endTime: block.endTime,
        reason: block.reason,
        createdAt: block.createdAt.toISOString(),
      })),
    } as unknown as Parameters<typeof evaluateBookingConflicts>[0];

    // Cache the overridden bookings + their event-type names into `current`
    // so the override-cascade email block below finds them via the existing
    // `.find()` patterns without another DB round-trip.
    for (const b of conflictBookingsById.values()) {
      if (!current.bookings.some((existing) => existing.id === b.id)) {
        current.bookings.push(b);
      }
    }
    for (const et of conflictEventTypeRows) {
      if (!current.eventTypes.some((own) => own.id === et.id)) {
        current.eventTypes.push({
          id: et.id,
          name: et.name,
          durationMinutes: et.durationMinutes,
          cleanupDurationMinutes: et.cleanupDurationMinutes,
          maxAdvanceBookingDays: et.maxAdvanceBookingDays,
          priority: et.priority,
          roomTypeId: et.roomTypeId ?? undefined,
        });
      }
    }

    const evaluation = evaluateBookingConflicts(conflictDb, candidate, bookingId);
    if (evaluation.conflicts.length > 0) {
      return NextResponse.json(
        {
          message: "Cannot confirm booking because it conflicts with existing equal/higher-priority bookings or blocks.",
          conflicts: evaluation.conflicts,
        },
        { status: 409 },
      );
    }
    overrideTargets = evaluation.overrideTargets;
    if (overrideTargets.length > 0) {
      const eventTypeName =
        current.eventTypes.find((et) => et.id === existing.eventTypeId)?.name ?? "higher-priority booking";
      overrideReason = `Overridden by ${existing.reference} (${eventTypeName})`;
    }
  }

  // updateBookingStatus handles set-once confirmedAt internally and cascades
  // overrideTargets to slotStatus=cancelled_override on the overlapping slots
  // (not the whole booking) inside the same transaction.
  await updateBookingStatus(
    bookingId,
    nextStatus,
    nextStatus === "rejected" ? (payload.rejectReason ?? null) : null,
    nextStatus === "confirmed" ? overrideTargets : [],
    overrideReason,
  );

  await logAuditEvent({
    actorUserId: auth.actor.userId,
    actorEmail: auth.actor.email,
    action: "ADMIN_BOOKING_UPDATED",
    resourceType: "booking",
    resourceId: bookingId,
    meta: { status: payload.status, rejectReason: payload.rejectReason },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  const notifyStatuses: BookingStatus[] = ["confirmed", "tentative", "rejected"];
  if (payload.status && notifyStatuses.includes(nextStatus)) {
    const room = current.rooms.find((r) => r.id === existing.roomTypeId);
    const eventType = current.eventTypes.find((et) => et.id === existing.eventTypeId);
    if (room && eventType) {
      await sendBookingStatusNotification({
        to: existing.customer.email,
        customerName: existing.customer.name,
        reference: existing.reference,
        roomName: room.name,
        eventTypeName: eventType.name,
        slots: existing.slots,
        totalAmountLkr: existing.totalAmountLkr,
        newStatus: nextStatus as "confirmed" | "tentative" | "rejected",
        rejectReason: nextStatus === "rejected" ? payload.rejectReason : undefined,
      });

      if (nextStatus === "rejected") {
        await sendAdminRejectionNotification({
          reference: existing.reference,
          customerName: existing.customer.name,
          customerEmail: existing.customer.email,
          roomName: room.name,
          eventTypeName: eventType.name,
          slots: existing.slots,
          rejectReason: payload.rejectReason ?? "No reason provided",
        });
      }

      // Override-cascade notifications: per-overridden-customer + one admin
      // alert. Only fires when the admin's confirm triggered an actual cascade.
      // `current` is the pre-cascade snapshot so it still carries the
      // overridden bookings' customer + slot details.
      if (nextStatus === "confirmed" && overrideTargets.length > 0) {
        const overrideCustomerEmails = overrideTargets.flatMap((target) => {
          const overridden = current.bookings.find((b) => b.id === target.bookingId);
          if (!overridden) return [];
          const overriddenRoom = current.rooms.find((r) => r.id === overridden.roomTypeId);
          const overriddenEventType = current.eventTypes.find(
            (et) => et.id === overridden.eventTypeId,
          );
          const cancelledSlots = target.slotKeys
            .map(({ date, startTime }) => {
              const slot = overridden.slots.find(
                (s) => s.date === date && s.startTime === startTime,
              );
              return slot ? { date, startTime, endTime: slot.endTime } : null;
            })
            .filter((s): s is { date: string; startTime: string; endTime: string } => s !== null);
          const survivingSlots = overridden.slots
            .filter((s) => {
              const wasCancelled = target.slotKeys.some(
                (k) => k.date === s.date && k.startTime === s.startTime,
              );
              if (wasCancelled) return false;
              const eff = s.slotStatus ?? overridden.status;
              return eff !== "rejected" && eff !== "cancelled_override";
            })
            .map((s) => ({ date: s.date, startTime: s.startTime, endTime: s.endTime }));
          return [
            sendBookingSlotOverriddenNotification({
              to: overridden.customer.email,
              customerName: overridden.customer.name,
              reference: overridden.reference,
              roomName: overriddenRoom?.name ?? room.name,
              eventTypeName: overriddenEventType?.name ?? "—",
              cancelledSlots,
              survivingSlots,
              newBookingReference: existing.reference,
              newBookingEventTypeName: eventType.name,
            }),
          ];
        });

        const overrideAdminBlocks = overrideTargets
          .map((target) => {
            const overridden = current.bookings.find((b) => b.id === target.bookingId);
            if (!overridden) return null;
            const cancelledSlots = target.slotKeys
              .map(({ date, startTime }) => {
                const slot = overridden.slots.find(
                  (s) => s.date === date && s.startTime === startTime,
                );
                return slot ? { date, startTime, endTime: slot.endTime } : null;
              })
              .filter(
                (s): s is { date: string; startTime: string; endTime: string } => s !== null,
              );
            return {
              reference: overridden.reference,
              customerName: overridden.customer.name,
              customerEmail: overridden.customer.email,
              cancelledSlots,
            };
          })
          .filter((o): o is NonNullable<typeof o> => o !== null);

        await Promise.allSettled([
          ...overrideCustomerEmails,
          sendAdminSlotOverriddenNotification({
            newBookingReference: existing.reference,
            newBookingEventTypeName: eventType.name,
            newBookingCustomerName: existing.customer.name,
            roomName: room.name,
            overrides: overrideAdminBlocks,
          }),
        ]);
      }
    }
  }

  return NextResponse.json({ message: "Booking updated." });
}
