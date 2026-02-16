import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
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
import { readCalendarDb, updateCalendarDb } from "@/lib/calendar-store";
import { AcMode, Booking, BookingSlot, DayType, Recurrence } from "@/lib/calendar-types";

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
};

function isEmail(value: string) {
  return /^\S+@\S+\.\S+$/.test(value);
}

export async function POST(req: Request) {
  const payload = (await req.json()) as BookingPayload;
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

  const db = await readCalendarDb();
  const room = db.rooms.find((item) => item.id === roomTypeId);
  const eventType = db.eventTypes.find((item) => item.id === eventTypeId);
  if (!room || !eventType) {
    return NextResponse.json({ message: "Invalid room or event type." }, { status: 400 });
  }
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

  let breakdown: Array<{ date: string; slot: string; amountLkr: number; dayType: DayType }>;
  try {
    breakdown = expandedSlots.map((slot) => {
      const rule = findPrice(db, roomTypeId, eventTypeId, acMode, slot.date);
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
    roomTypeId,
    eventTypeId,
    acMode,
    status: "pending",
    slots: expandedSlots,
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      purpose: customer.purpose,
    },
    recurrence,
    totalAmountLkr: breakdown.reduce((sum, item) => sum + item.amountLkr, 0),
    amountBreakdown: breakdown,
    reconciliationStatus: "unpaid",
    reconciliationNotes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    overriddenBookingIds: [],
  };

  const { conflicts, overrideTargets } = evaluateBookingConflicts(db, booking);
  if (conflicts.length > 0) {
    return NextResponse.json(
      {
        message: "Some selected slots conflict with existing bookings or blocks.",
        conflicts,
      },
      { status: 409 },
    );
  }

  booking.overriddenBookingIds = overrideTargets;

  await updateCalendarDb((current) => ({
    ...current,
    bookings: [...current.bookings, booking],
  }));

  return NextResponse.json({
    message: "Booking submitted and pending admin approval.",
    bookingId: booking.id,
    totalAmountLkr: booking.totalAmountLkr,
    breakdown,
    overriddenBookingIds: overrideTargets,
    notificationNote:
      overrideTargets.length > 0
        ? "Lower-priority overlapping bookings will be cancelled only after admin approval. Email notifications are deferred until integration phase."
        : undefined,
  });
}
