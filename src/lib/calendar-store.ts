import { prisma } from "@/lib/prisma";
import {
  Booking,
  BookingStatus,
  CalendarBlock,
  CalendarDb,
  EventType,
  PricingRule,
  RoomType,
} from "@/lib/calendar-types";

function toIso(value: Date) {
  return value.toISOString();
}

export async function readCalendarDb(): Promise<CalendarDb> {
  const [rooms, eventTypes, pricingRules, bookings, blocks] = await prisma.$transaction([
    prisma.roomType.findMany(),
    prisma.eventType.findMany(),
    prisma.pricingRule.findMany(),
    prisma.booking.findMany({
      include: {
        slots: true,
        amountBreakdown: true,
        overriddenTargets: true,
        paymentEntries: { orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.calendarBlock.findMany(),
  ]);

  return {
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      workingHours: {
        startTime: room.startTime,
        endTime: room.endTime,
      },
      capacity: room.capacity ?? undefined,
      description: room.description ?? undefined,
    })),
    eventTypes: eventTypes.map((eventType) => ({
      id: eventType.id,
      name: eventType.name,
      durationMinutes: eventType.durationMinutes,
      cleanupDurationMinutes: eventType.cleanupDurationMinutes,
      maxAdvanceBookingDays: eventType.maxAdvanceBookingDays,
      priority: eventType.priority,
      roomTypeId: eventType.roomTypeId ?? undefined,
    })),
    pricingRules: pricingRules.map((rule) => ({
      id: rule.id,
      roomTypeId: rule.roomTypeId,
      eventTypeId: rule.eventTypeId,
      acMode: rule.acMode,
      dayType: rule.dayType,
      amountLkr: rule.amountLkr,
    })),
    bookings: bookings.map((booking) => ({
      id: booking.id,
      reference: booking.reference,
      roomTypeId: booking.roomTypeId,
      eventTypeId: booking.eventTypeId,
      acMode: booking.acMode,
      status: booking.status,
      cleanupDurationMinutes: booking.cleanupDurationMinutes,
      slots: booking.slots.map((slot) => ({
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        slotStatus: slot.slotStatus ?? undefined,
        rejectReason: slot.rejectReason ?? undefined,
      })),
      customer: {
        name: booking.customerName,
        email: booking.customerEmail,
        phone: booking.customerPhone,
        purpose: booking.customerPurpose,
      },
      totalAmountLkr: booking.totalAmountLkr,
      paidAmountLkr: booking.paidAmountLkr,
      amountBreakdown: booking.amountBreakdown.map((item) => ({
        date: item.date,
        slot: item.slot,
        amountLkr: item.amountLkr,
        dayType: item.dayType,
      })),
      reconciliationStatus: booking.reconciliationStatus,
      reconciliationNotes: booking.reconciliationNotes,
      rejectReason: booking.rejectReason ?? undefined,
      confirmedAt: booking.confirmedAt ? toIso(booking.confirmedAt) : undefined,
      lastReminderDays: booking.lastReminderDays ?? undefined,
      paymentEntries: booking.paymentEntries.map((entry) => ({
        id: entry.id,
        bookingId: entry.bookingId,
        type: entry.type as "payment" | "refund" | "credit_note" | "waiver",
        date: entry.date,
        amountLkr: entry.amountLkr,
        receiptNo: entry.receiptNo,
        notes: entry.notes,
        createdAt: toIso(entry.createdAt),
        createdBy: entry.createdBy,
      })),
      createdAt: toIso(booking.createdAt),
      updatedAt: toIso(booking.updatedAt),
      overriddenBookingIds: booking.overriddenTargets.map((item) => item.overriddenBookingId),
    })),
    blocks: blocks.map((block) => ({
      id: block.id,
      roomTypeId: block.roomTypeId,
      date: block.date,
      startTime: block.startTime,
      endTime: block.endTime,
      reason: block.reason,
      createdAt: toIso(block.createdAt),
    })),
  };
}

// ─── Targeted writes ────────────────────────────────────────────────────────────
//
// Each route used to call updateCalendarDb(), which read every table, let the
// route mutate the in-memory snapshot, then wiped-and-recreated everything inside
// a single transaction. That pattern produced a silent last-writer-wins race
// between two admins acting on stale snapshots — the loser's work silently
// disappeared with both audit-log entries showing "success."
//
// The helpers below each touch only the rows the route actually intends to
// change. Conflict detection for booking creation / confirmation runs in the
// caller; the caller supplies the resulting `overriddenBookingIds` to the
// helpers below, which cascade them to status=cancelled_override atomically
// with the primary write.

/** Insert a new booking with all child rows. When `overriddenBookingIds` is
 *  non-empty, those bookings are cascaded to status=cancelled_override in the
 *  same transaction. The caller is responsible for running the conflict check
 *  beforehand and supplying the override target list. */
export async function insertBookingWithCascade(
  booking: Booking,
  overriddenBookingIds: string[],
) {
  await prisma.$transaction(async (tx) => {
    await tx.booking.create({
      data: {
        id: booking.id,
        reference: booking.reference,
        roomTypeId: booking.roomTypeId,
        eventTypeId: booking.eventTypeId,
        acMode: booking.acMode,
        status: booking.status,
        cleanupDurationMinutes: booking.cleanupDurationMinutes ?? 0,
        customerName: booking.customer.name,
        customerEmail: booking.customer.email,
        customerPhone: booking.customer.phone,
        customerPurpose: booking.customer.purpose,
        totalAmountLkr: booking.totalAmountLkr,
        paidAmountLkr: booking.paidAmountLkr,
        reconciliationStatus: booking.reconciliationStatus,
        reconciliationNotes: booking.reconciliationNotes,
        rejectReason: booking.rejectReason ?? null,
        confirmedAt: booking.confirmedAt ? new Date(booking.confirmedAt) : null,
        lastReminderDays: booking.lastReminderDays ?? null,
        createdAt: new Date(booking.createdAt),
        updatedAt: new Date(booking.updatedAt),
      },
    });

    if (booking.slots.length > 0) {
      await tx.bookingSlot.createMany({
        data: booking.slots.map((slot) => ({
          bookingId: booking.id,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          slotStatus: slot.slotStatus ?? null,
          rejectReason: slot.rejectReason ?? null,
        })),
      });
    }

    if (booking.amountBreakdown.length > 0) {
      await tx.bookingAmountBreakdown.createMany({
        data: booking.amountBreakdown.map((item) => ({
          bookingId: booking.id,
          date: item.date,
          slot: item.slot,
          amountLkr: item.amountLkr,
          dayType: item.dayType,
        })),
      });
    }

    if (overriddenBookingIds.length > 0) {
      await tx.bookingOverride.createMany({
        data: overriddenBookingIds.map((overriddenBookingId) => ({
          bookingId: booking.id,
          overriddenBookingId,
        })),
      });
      await tx.booking.updateMany({
        where: { id: { in: overriddenBookingIds } },
        data: { status: "cancelled_override", updatedAt: new Date() },
      });
    }
  });
}

/** Update a booking's top-level status. When the new status is "confirmed" and
 *  `overriddenBookingIds` is non-empty, the override targets are cascaded to
 *  cancelled_override and the booking_override join rows are refreshed.
 *  Booking-level status changes also wipe per-slot overrides — the batch slot
 *  helper is the path for preserving per-slot overrides. */
export async function updateBookingStatus(
  bookingId: string,
  status: BookingStatus,
  rejectReason: string | null,
  overriddenBookingIds: string[] = [],
) {
  await prisma.$transaction(async (tx) => {
    // confirmedAt is set-once — only stamped the first time the booking is
    // confirmed; re-confirming after a reject must preserve the original anchor
    // because the unpaid-reminder cadence runs off it.
    let confirmedAtToSet: Date | undefined = undefined;
    if (status === "confirmed") {
      const existing = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { confirmedAt: true },
      });
      if (!existing?.confirmedAt) confirmedAtToSet = new Date();
    }

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status,
        rejectReason: status === "rejected" ? rejectReason : undefined,
        confirmedAt: confirmedAtToSet,
        updatedAt: new Date(),
      },
    });

    await tx.bookingSlot.updateMany({
      where: { bookingId },
      data: { slotStatus: null, rejectReason: null },
    });

    if (status === "confirmed" && overriddenBookingIds.length > 0) {
      await tx.bookingOverride.deleteMany({ where: { bookingId } });
      await tx.bookingOverride.createMany({
        data: overriddenBookingIds.map((overriddenBookingId) => ({
          bookingId,
          overriddenBookingId,
        })),
      });
      await tx.booking.updateMany({
        where: { id: { in: overriddenBookingIds } },
        data: { status: "cancelled_override", updatedAt: new Date() },
      });
    }
  });
}

/** Update a single slot's status (legacy single-slot path). */
export async function updateBookingSlotStatus(
  bookingId: string,
  slotDate: string,
  slotStartTime: string,
  slotStatus: BookingStatus | null,
) {
  await prisma.$transaction(async (tx) => {
    await tx.bookingSlot.updateMany({
      where: { bookingId, date: slotDate, startTime: slotStartTime },
      data: { slotStatus },
    });
    await tx.booking.update({
      where: { id: bookingId },
      data: { updatedAt: new Date() },
    });
  });
}

/** Apply a batch of per-slot status updates to a single booking. */
export async function updateBookingSlotsBatch(
  bookingId: string,
  updates: Array<{
    slotDate: string;
    slotStartTime: string;
    slotStatus: BookingStatus | null;
    rejectReason?: string;
  }>,
) {
  await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.bookingSlot.updateMany({
        where: { bookingId, date: u.slotDate, startTime: u.slotStartTime },
        data: {
          slotStatus: u.slotStatus,
          rejectReason: u.slotStatus === "rejected" ? (u.rejectReason ?? null) : null,
        },
      });
    }
    await tx.booking.update({
      where: { id: bookingId },
      data: { updatedAt: new Date() },
    });
  });
}

/** Create a calendar block. */
export async function createCalendarBlock(block: CalendarBlock) {
  await prisma.calendarBlock.create({
    data: {
      id: block.id,
      roomTypeId: block.roomTypeId,
      date: block.date,
      startTime: block.startTime,
      endTime: block.endTime,
      reason: block.reason,
      createdAt: new Date(block.createdAt),
    },
  });
}

/** Delete a calendar block by id. */
export async function deleteCalendarBlock(id: string) {
  await prisma.calendarBlock.delete({ where: { id } });
}

/** Replace the room/event-type/pricing-rule config atomically. Bookings, slots,
 *  payment entries, and calendar blocks are NOT touched — this is scoped to
 *  the three config tables the admin actually edited. Pricing rules are deleted
 *  first because they FK-cascade from both room and event type. */
export async function replaceCalendarConfig(
  rooms: RoomType[],
  eventTypes: EventType[],
  pricingRules: PricingRule[],
) {
  await prisma.$transaction(async (tx) => {
    // PricingRule has no incoming FKs — safe to wipe and recreate.
    await tx.pricingRule.deleteMany();

    // RoomType and EventType have `onDelete: Restrict` from Booking, so a
    // blanket deleteMany() fails the moment any booking references any row.
    // Use a delta-based approach: only delete rows whose IDs are absent from
    // the payload (i.e. genuinely removed by the admin); everything else
    // upserts in place so the FK references stay valid.
    const payloadRoomIds = new Set(rooms.map((room) => room.id));
    const payloadEventTypeIds = new Set(eventTypes.map((eventType) => eventType.id));

    const existingEventTypeIds = (await tx.eventType.findMany({ select: { id: true } })).map(
      (row) => row.id,
    );
    const eventTypeIdsToRemove = existingEventTypeIds.filter((id) => !payloadEventTypeIds.has(id));
    if (eventTypeIdsToRemove.length > 0) {
      await tx.eventType.deleteMany({ where: { id: { in: eventTypeIdsToRemove } } });
    }

    const existingRoomTypeIds = (await tx.roomType.findMany({ select: { id: true } })).map(
      (row) => row.id,
    );
    const roomTypeIdsToRemove = existingRoomTypeIds.filter((id) => !payloadRoomIds.has(id));
    if (roomTypeIdsToRemove.length > 0) {
      await tx.roomType.deleteMany({ where: { id: { in: roomTypeIdsToRemove } } });
    }

    for (const room of rooms) {
      await tx.roomType.upsert({
        where: { id: room.id },
        create: {
          id: room.id,
          name: room.name,
          startTime: room.workingHours.startTime,
          endTime: room.workingHours.endTime,
          capacity: room.capacity ?? null,
          description: room.description ?? null,
        },
        update: {
          name: room.name,
          startTime: room.workingHours.startTime,
          endTime: room.workingHours.endTime,
          capacity: room.capacity ?? null,
          description: room.description ?? null,
        },
      });
    }

    for (const eventType of eventTypes) {
      await tx.eventType.upsert({
        where: { id: eventType.id },
        create: {
          id: eventType.id,
          name: eventType.name,
          durationMinutes: eventType.durationMinutes,
          cleanupDurationMinutes: eventType.cleanupDurationMinutes ?? 0,
          maxAdvanceBookingDays: eventType.maxAdvanceBookingDays ?? 365,
          priority: eventType.priority,
          roomTypeId: eventType.roomTypeId ?? null,
        },
        update: {
          name: eventType.name,
          durationMinutes: eventType.durationMinutes,
          cleanupDurationMinutes: eventType.cleanupDurationMinutes ?? 0,
          maxAdvanceBookingDays: eventType.maxAdvanceBookingDays ?? 365,
          priority: eventType.priority,
          roomTypeId: eventType.roomTypeId ?? null,
        },
      });
    }

    for (const rule of pricingRules) {
      await tx.pricingRule.create({
        data: {
          id: rule.id,
          roomTypeId: rule.roomTypeId,
          eventTypeId: rule.eventTypeId,
          acMode: rule.acMode,
          dayType: rule.dayType,
          amountLkr: rule.amountLkr,
        },
      });
    }
  }, { timeout: 30_000, maxWait: 10_000 });
}
