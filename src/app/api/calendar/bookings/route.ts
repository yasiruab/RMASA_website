import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  sendAdminNewBookingNotification,
  sendAdminSlotOverriddenNotification,
  sendBookingAcknowledgement,
  sendBookingSlotOverriddenNotification,
} from "@/lib/email";
import {
  assertAdvanceBookingLimit,
  assertRecurrenceWindow,
  evaluateBookingConflicts,
  expandRecurrence,
  findInternalSlotConflicts,
  findPrice,
  fromMinutes,
  isEventTypeAllowedForRoom,
  isValidDate,
  isValidTime,
  sortSlots,
  toMinutes,
  toDayType,
} from "@/lib/calendar-core";
import { insertBookingWithCascade } from "@/lib/calendar-store";
import { prisma } from "@/lib/prisma";
import {
  AcMode,
  Booking,
  BookingSlot,
  CalendarDb,
  DayType,
  Recurrence,
  RoomType,
} from "@/lib/calendar-types";
import { verifyTurnstileToken } from "@/lib/turnstile";

type BookingPayload = {
  roomTypeId?: string;
  eventTypeId?: string;
  acMode?: AcMode;
  selectedSlots?: BookingSlot[];
  recurrence?: Recurrence;
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
    purpose?: string;
  };
  turnstileToken?: string;
};

function isEmail(value: string) {
  return /^\S+@\S+\.\S+$/.test(value);
}

// Length and format caps on customer-supplied fields. The endpoint is anonymous,
// so without these a bot could submit a 10 MB customer name. Phone is limited to
// digits and '+' so we don't accept obviously-unreachable values.
const MAX_NAME_LEN = 100;
const MAX_EMAIL_LEN = 254; // RFC 5321 path max
const MAX_PHONE_LEN = 16;
const MAX_PURPOSE_LEN = 1000;
// Optional leading '+' (country prefix), then 10–15 digits.
// 10-digit minimum ensures we capture a usable contact number (e.g. local
// 077XXXXXXX or international +94XXXXXXXXX); upper bound matches MAX_PHONE_LEN.
const PHONE_PATTERN = /^\+?\d{10,15}$/;

function generateBookingReference(): string {
  return "BK-" + randomBytes(3).toString("hex").toUpperCase();
}

export async function POST(req: Request) {
  const payload = (await req.json()) as BookingPayload;

  const remoteIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const turnstile = await verifyTurnstileToken(payload.turnstileToken, remoteIp);
  if (!turnstile.success) {
    return NextResponse.json(
      { message: "Bot verification failed. Please refresh the page and try again." },
      { status: 400 },
    );
  }

  const roomTypeId = String(payload.roomTypeId ?? "").trim();
  const eventTypeId = String(payload.eventTypeId ?? "").trim();
  const acMode = payload.acMode;
  const selectedSlots = payload.selectedSlots ?? [];
  const recurrence = payload.recurrence ?? { frequency: "none" };
  const customer = payload.customer ?? {};

  if (!roomTypeId || !eventTypeId || !acMode || selectedSlots.length === 0) {
    return NextResponse.json({ message: "Room, event type, AC mode, and slots are required." }, { status: 400 });
  }

  if (!customer.name || !customer.email || !customer.phone || !customer.purpose) {
    return NextResponse.json({ message: "Customer details are required." }, { status: 400 });
  }

  if (customer.name.length > MAX_NAME_LEN) {
    return NextResponse.json({ message: `Name must be ${MAX_NAME_LEN} characters or fewer.` }, { status: 400 });
  }
  if (customer.email.length > MAX_EMAIL_LEN) {
    return NextResponse.json({ message: `Email must be ${MAX_EMAIL_LEN} characters or fewer.` }, { status: 400 });
  }
  if (!PHONE_PATTERN.test(customer.phone) || customer.phone.length > MAX_PHONE_LEN) {
    return NextResponse.json(
      {
        message: `Phone must be 10–${MAX_PHONE_LEN} characters: digits only, with an optional leading '+'.`,
      },
      { status: 400 },
    );
  }
  if (customer.purpose.length > MAX_PURPOSE_LEN) {
    return NextResponse.json({ message: `Purpose must be ${MAX_PURPOSE_LEN} characters or fewer.` }, { status: 400 });
  }

  if (!isEmail(customer.email)) {
    return NextResponse.json({ message: "Invalid email address." }, { status: 400 });
  }

  for (const slot of selectedSlots) {
    if (!isValidDate(slot.date) || !isValidTime(slot.startTime) || !isValidTime(slot.endTime)) {
      return NextResponse.json({ message: "Invalid slot date/time." }, { status: 400 });
    }
  }

  try {
    assertRecurrenceWindow(recurrence);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Invalid recurrence." },
      { status: 400 },
    );
  }

  // ─── Scoped config load ───────────────────────────────────────────────
  // Only the candidate's room + event type + the matching pricing rules.
  // Everything else (other rooms, other event types' priorities) is loaded
  // on demand below from the booking dataset.
  const [roomRow, eventTypeRow, pricingRuleRows] = await prisma.$transaction([
    prisma.roomType.findUnique({ where: { id: roomTypeId } }),
    prisma.eventType.findUnique({ where: { id: eventTypeId } }),
    prisma.pricingRule.findMany({
      where: { roomTypeId, eventTypeId, acMode },
    }),
  ]);

  if (!roomRow || !eventTypeRow) {
    return NextResponse.json({ message: "Invalid room or event type." }, { status: 400 });
  }

  const room: RoomType = {
    id: roomRow.id,
    name: roomRow.name,
    workingHours: { startTime: roomRow.startTime, endTime: roomRow.endTime },
    capacity: roomRow.capacity ?? undefined,
    description: roomRow.description ?? undefined,
  };
  const eventType = {
    id: eventTypeRow.id,
    name: eventTypeRow.name,
    durationMinutes: eventTypeRow.durationMinutes,
    cleanupDurationMinutes: eventTypeRow.cleanupDurationMinutes,
    maxAdvanceBookingDays: eventTypeRow.maxAdvanceBookingDays,
    priority: eventTypeRow.priority,
    roomTypeId: eventTypeRow.roomTypeId ?? undefined,
  };

  if (!isEventTypeAllowedForRoom(eventType, roomTypeId)) {
    return NextResponse.json({ message: "Selected event type is not available for this room." }, { status: 400 });
  }

  const workingStart = toMinutes(room.workingHours.startTime);
  const workingEnd = toMinutes(room.workingHours.endTime);
  for (const slot of selectedSlots) {
    const start = toMinutes(slot.startTime);
    const end = toMinutes(slot.endTime);
    if (start < workingStart || end > workingEnd) {
      return NextResponse.json(
        {
          message: `Selected slot ${slot.date} ${slot.startTime}-${slot.endTime} is outside room working hours (${fromMinutes(workingStart)}-${fromMinutes(workingEnd)}).`,
        },
        { status: 400 },
      );
    }
  }

  let expandedSlots: BookingSlot[];
  try {
    expandedSlots = sortSlots(expandRecurrence(selectedSlots, recurrence));
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to expand recurrence." },
      { status: 400 },
    );
  }

  try {
    assertAdvanceBookingLimit(expandedSlots, eventType);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Booking exceeds advance booking window." },
      { status: 400 },
    );
  }

  const internalConflicts = findInternalSlotConflicts(expandedSlots);
  if (internalConflicts.length > 0) {
    return NextResponse.json(
      {
        message: "Selected slots and recurrence create overlapping slots in the same request.",
        conflicts: internalConflicts,
      },
      { status: 409 },
    );
  }

  // ─── Pricing breakdown ────────────────────────────────────────────────
  // findPrice() consults pricingRules filtered by (room, event, ac, dayType).
  // Build a tiny CalendarDb-shape with just the loaded rules.
  const pricingDb = {
    rooms: [room],
    eventTypes: [eventType],
    pricingRules: pricingRuleRows.map((rule) => ({
      id: rule.id,
      roomTypeId: rule.roomTypeId,
      eventTypeId: rule.eventTypeId,
      acMode: rule.acMode as AcMode,
      dayType: rule.dayType as DayType,
      amountLkr: rule.amountLkr,
    })),
    bookings: [],
    blocks: [],
  } as unknown as CalendarDb;

  let breakdown: Array<{ date: string; slot: string; amountLkr: number; dayType: DayType }>;
  try {
    breakdown = expandedSlots.map((slot) => {
      const rule = findPrice(pricingDb, roomTypeId, eventTypeId, acMode, slot.date);
      if (!rule) {
        throw new Error(`No pricing rule for ${room.name} / ${eventType.name} / ${acMode}.`);
      }

      return {
        date: slot.date,
        slot: `${slot.startTime}-${slot.endTime}`,
        amountLkr: rule.amountLkr,
        dayType: toDayType(slot.date),
      };
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Missing pricing rule." },
      { status: 400 },
    );
  }

  const booking: Booking = {
    id: randomUUID(),
    reference: generateBookingReference(),
    roomTypeId,
    eventTypeId,
    acMode,
    status: "pending",
    cleanupDurationMinutes: eventType.cleanupDurationMinutes,
    slots: expandedSlots,
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      purpose: customer.purpose,
    },
    totalAmountLkr: breakdown.reduce((sum, item) => sum + item.amountLkr, 0),
    paidAmountLkr: 0,
    amountBreakdown: breakdown,
    reconciliationStatus: "unpaid",
    reconciliationNotes: "",
    paymentEntries: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    overriddenBookingIds: [],
  };

  // ─── Scoped conflict scan ────────────────────────────────────────────
  // Load only active bookings (same room) with at least one slot on a
  // candidate date, plus blocks in the same window. Then load the priorities
  // of event types referenced by those bookings so findEventType() works
  // inside evaluateBookingConflicts.
  const candidateDates = Array.from(new Set(expandedSlots.map((s) => s.date)));
  const [conflictSlotRows, blockRows] = await prisma.$transaction([
    prisma.bookingSlot.findMany({
      where: {
        date: { in: candidateDates },
        booking: {
          roomTypeId,
          status: { in: ["pending", "confirmed", "tentative"] },
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
          },
        },
      },
    }),
    prisma.calendarBlock.findMany({
      where: { roomTypeId, date: { in: candidateDates } },
    }),
  ]);

  // Reassemble booking snapshots from the slot rows.
  type ConflictBooking = {
    id: string;
    reference: string;
    roomTypeId: string;
    eventTypeId: string;
    status: Booking["status"];
    cleanupDurationMinutes: number;
    customer: { name: string; email: string };
    slots: BookingSlot[];
  };
  const conflictBookingsById = new Map<string, ConflictBooking>();
  for (const row of conflictSlotRows) {
    const b = row.booking;
    let entry = conflictBookingsById.get(b.id);
    if (!entry) {
      entry = {
        id: b.id,
        reference: b.reference,
        roomTypeId: b.roomTypeId,
        eventTypeId: b.eventTypeId,
        status: b.status,
        cleanupDurationMinutes: b.cleanupDurationMinutes,
        customer: { name: b.customerName, email: b.customerEmail },
        slots: [],
      };
      conflictBookingsById.set(b.id, entry);
    }
    entry.slots.push({
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      slotStatus: row.slotStatus ?? undefined,
      rejectReason: row.rejectReason ?? undefined,
    });
  }

  // Event-type priorities for the bookings we loaded — needed by the
  // priority compare inside evaluateBookingConflicts.
  const referencedEventTypeIds = Array.from(
    new Set(Array.from(conflictBookingsById.values()).map((b) => b.eventTypeId)),
  );
  const eventTypeRows = referencedEventTypeIds.length
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
    rooms: [room],
    eventTypes: [
      eventType,
      ...eventTypeRows.map((et) => ({
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
    blocks: blockRows.map((block) => ({
      id: block.id,
      roomTypeId: block.roomTypeId,
      date: block.date,
      startTime: block.startTime,
      endTime: block.endTime,
      reason: block.reason,
      createdAt: block.createdAt.toISOString(),
    })),
  } as unknown as CalendarDb;

  const { conflicts, overrideTargets } = evaluateBookingConflicts(conflictDb, booking);
  if (conflicts.length > 0) {
    return NextResponse.json(
      {
        message: "Some selected slots conflict with existing bookings or blocks.",
        conflicts,
      },
      { status: 409 },
    );
  }

  booking.overriddenBookingIds = overrideTargets.map((t) => t.bookingId);

  const overrideReason = `Overridden by ${booking.reference} (${eventType.name})`;
  await insertBookingWithCascade(booking, overrideTargets, overrideReason);

  // Per-overridden-customer notifications + a single admin alert. We already
  // have the overridden bookings' customer info in conflictBookingsById from
  // the scoped scan above (no extra DB round-trip needed). For surviving slot
  // info we look up each overridden booking's full slot list — they may have
  // slots on dates outside the candidate window that should still be listed
  // in the "surviving" set.
  const overriddenBookingIds = overrideTargets.map((t) => t.bookingId);
  const overriddenFullSlots = overriddenBookingIds.length
    ? await prisma.bookingSlot.findMany({
        where: { bookingId: { in: overriddenBookingIds } },
        select: {
          bookingId: true,
          date: true,
          startTime: true,
          endTime: true,
          slotStatus: true,
        },
      })
    : [];
  const overriddenEventTypeIds = Array.from(
    new Set(
      overriddenBookingIds
        .map((id) => conflictBookingsById.get(id)?.eventTypeId)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  const overriddenEventTypeNames = new Map(
    eventTypeRows
      .filter((et) => overriddenEventTypeIds.includes(et.id))
      .map((et) => [et.id, et.name]),
  );

  const overrideCustomerEmails = overrideTargets.flatMap((target) => {
    const overridden = conflictBookingsById.get(target.bookingId);
    if (!overridden) return [];
    const cancelledSlots = target.slotKeys
      .map(({ date, startTime }) => {
        const slot = overridden.slots.find((s) => s.date === date && s.startTime === startTime);
        return slot ? { date, startTime, endTime: slot.endTime } : null;
      })
      .filter((s): s is { date: string; startTime: string; endTime: string } => s !== null);
    const survivingSlots = overriddenFullSlots
      .filter((s) => s.bookingId === target.bookingId)
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
        roomName: room.name,
        eventTypeName: overriddenEventTypeNames.get(overridden.eventTypeId) ?? "—",
        cancelledSlots,
        survivingSlots,
        newBookingReference: booking.reference,
        newBookingEventTypeName: eventType.name,
      }),
    ];
  });

  const overrideAdminBlocks = overrideTargets
    .map((target) => {
      const overridden = conflictBookingsById.get(target.bookingId);
      if (!overridden) return null;
      const cancelledSlots = target.slotKeys
        .map(({ date, startTime }) => {
          const slot = overridden.slots.find((s) => s.date === date && s.startTime === startTime);
          return slot ? { date, startTime, endTime: slot.endTime } : null;
        })
        .filter((s): s is { date: string; startTime: string; endTime: string } => s !== null);
      return {
        reference: overridden.reference,
        customerName: overridden.customer.name,
        customerEmail: overridden.customer.email,
        cancelledSlots,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  await Promise.allSettled([
    sendBookingAcknowledgement({
      to: booking.customer.email,
      customerName: booking.customer.name,
      reference: booking.reference,
      roomName: room.name,
      eventTypeName: eventType.name,
      slots: booking.slots,
      totalAmountLkr: booking.totalAmountLkr,
    }),
    sendAdminNewBookingNotification({
      reference: booking.reference,
      customerName: booking.customer.name,
      customerEmail: booking.customer.email,
      customerPhone: booking.customer.phone,
      roomName: room.name,
      eventTypeName: eventType.name,
      slots: booking.slots,
      totalAmountLkr: booking.totalAmountLkr,
    }),
    ...overrideCustomerEmails,
    sendAdminSlotOverriddenNotification({
      newBookingReference: booking.reference,
      newBookingEventTypeName: eventType.name,
      newBookingCustomerName: booking.customer.name,
      roomName: room.name,
      overrides: overrideAdminBlocks,
    }),
  ]);

  return NextResponse.json({
    message: "Booking submitted and pending admin approval.",
    bookingId: booking.id,
    reference: booking.reference,
    totalAmountLkr: booking.totalAmountLkr,
    breakdown,
    overriddenBookingIds: overrideTargets.map((t) => t.bookingId),
  });
}
