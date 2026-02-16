import {
  AcMode,
  Booking,
  BookingSlot,
  CalendarBlock,
  CalendarDb,
  DayType,
  EventType,
  Recurrence,
  RoomType,
  SlotAvailability,
} from "@/lib/calendar-types";

const MAX_RECURRENCE_DAYS = 183;

function ymdToDateLocal(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function formatDateLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function toDayType(date: string): DayType {
  const d = ymdToDateLocal(date);
  const day = d.getDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
}

export function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(ymdToDateLocal(value).valueOf());
}

export function isValidTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

export function toMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(total: number) {
  const h = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const m = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function overlaps(a: BookingSlot, b: BookingSlot) {
  if (a.date !== b.date) return false;
  const aStart = toMinutes(a.startTime);
  const aEnd = toMinutes(a.endTime);
  const bStart = toMinutes(b.startTime);
  const bEnd = toMinutes(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

export function generateSlotsForDuration(
  date: string,
  durationHours: number,
  workingStartTime: string,
  workingEndTime: string,
): BookingSlot[] {
  const slots: BookingSlot[] = [];
  const minutes = durationHours * 60;
  let start = toMinutes(workingStartTime);
  const lastStart = toMinutes(workingEndTime) - minutes;

  while (start <= lastStart) {
    slots.push({
      date,
      startTime: fromMinutes(start),
      endTime: fromMinutes(start + minutes),
    });
    start += 60;
  }

  return slots;
}

function addDays(date: string, days: number) {
  const d = ymdToDateLocal(date);
  d.setDate(d.getDate() + days);
  return formatDateLocal(d);
}

function addMonths(date: string, months: number) {
  const d = ymdToDateLocal(date);
  d.setMonth(d.getMonth() + months);
  return formatDateLocal(d);
}

export function expandRecurrence(baseSlots: BookingSlot[], recurrence: Recurrence): BookingSlot[] {
  if (recurrence.frequency === "none") return baseSlots;
  if (!recurrence.endDate && !recurrence.occurrences) {
    throw new Error("Provide recurrence end date or occurrences.");
  }

  const results: BookingSlot[] = [...baseSlots];
  const baseDates = [...new Set(baseSlots.map((s) => s.date))].sort();
  const endDate = recurrence.endDate;
  const maxOccurrences = recurrence.occurrences;

  let step = 1;
  while (true) {
    const nextDates = baseDates.map((date) => {
      if (recurrence.frequency === "daily") return addDays(date, step);
      if (recurrence.frequency === "weekly") return addDays(date, step * 7);
      return addMonths(date, step);
    });

    const furthest = nextDates[nextDates.length - 1];
    if ((endDate && furthest > endDate) || step > MAX_RECURRENCE_DAYS) {
      break;
    }

    const expansions = baseSlots.map((slot) => {
      const idx = baseDates.indexOf(slot.date);
      return { ...slot, date: nextDates[idx] };
    });

    results.push(...expansions);

    if (maxOccurrences && step + 1 >= maxOccurrences) {
      break;
    }

    step += 1;
  }

  return results;
}

export function getSlotStatus(
  db: CalendarDb,
  roomTypeId: string,
  slot: BookingSlot,
  candidatePriority?: number,
): Omit<SlotAvailability, "date" | "startTime" | "endTime"> {
  const block = db.blocks.find((b) => b.roomTypeId === roomTypeId && overlaps(slot, b));
  if (block) {
    return { status: "blocked", reason: block.reason };
  }

  const overlappingBookings = db.bookings.filter(
    (b) =>
      b.roomTypeId === roomTypeId &&
      ["pending", "confirmed", "tentative"].includes(b.status) &&
      b.slots.some((s) => overlaps(s, slot)),
  );

  if (overlappingBookings.length === 0) return { status: "available" };

  const blockingBookings = overlappingBookings.filter((booking) => {
    if (candidatePriority === undefined) return true;
    const existingType = findEventType(db, booking.eventTypeId);
    return existingType.priority >= candidatePriority;
  });

  if (blockingBookings.length === 0) {
    return { status: "available" };
  }

  const booking = blockingBookings[0];

  return { status: booking.status as "pending" | "confirmed" | "tentative", bookingId: booking.id };
}

export function getSlotAvailabilities(
  db: CalendarDb,
  room: RoomType,
  date: string,
  durationHours: number,
  candidatePriority?: number,
): SlotAvailability[] {
  const slots = generateSlotsForDuration(
    date,
    durationHours,
    room.workingHours.startTime,
    room.workingHours.endTime,
  );
  return slots.map((slot) => {
    const status = getSlotStatus(db, room.id, slot, candidatePriority);
    return { ...slot, ...status };
  });
}

export function findEventType(db: CalendarDb, eventTypeId: string): EventType {
  const eventType = db.eventTypes.find((item) => item.id === eventTypeId);
  if (!eventType) throw new Error("Invalid event type.");
  return eventType;
}

export function isEventTypeAllowedForRoom(eventType: EventType, roomTypeId: string) {
  return !eventType.roomTypeId || eventType.roomTypeId === roomTypeId;
}

export function findPrice(
  db: CalendarDb,
  roomTypeId: string,
  eventTypeId: string,
  acMode: AcMode,
  date: string,
) {
  const dayType = toDayType(date);
  const exact = db.pricingRules.find(
    (rule) =>
      rule.roomTypeId === roomTypeId &&
      rule.eventTypeId === eventTypeId &&
      rule.acMode === acMode &&
      rule.dayType === dayType,
  );
  if (exact) return exact;

  const anyDay = db.pricingRules.find(
    (rule) =>
      rule.roomTypeId === roomTypeId &&
      rule.eventTypeId === eventTypeId &&
      rule.acMode === acMode &&
      rule.dayType === "any",
  );
  return anyDay;
}

export function evaluateBookingConflicts(db: CalendarDb, candidate: Booking, ignoreBookingId?: string) {
  const candidateType = findEventType(db, candidate.eventTypeId);
  const conflicts: Array<{ slot: BookingSlot; reason: string }> = [];
  const overrideTargets = new Set<string>();

  for (const slot of candidate.slots) {
    const blocked = db.blocks.find((b) => b.roomTypeId === candidate.roomTypeId && overlaps(slot, blockToSlot(b)));
    if (blocked) {
      conflicts.push({ slot, reason: `Blocked: ${blocked.reason}` });
      continue;
    }

    for (const booking of db.bookings) {
      if (ignoreBookingId && booking.id === ignoreBookingId) continue;
      if (booking.roomTypeId !== candidate.roomTypeId) continue;
      if (![
        "pending",
        "confirmed",
        "tentative",
      ].includes(booking.status))
        continue;
      if (!booking.slots.some((s) => overlaps(s, slot))) continue;

      const existingType = findEventType(db, booking.eventTypeId);
      if (candidateType.priority > existingType.priority) {
        overrideTargets.add(booking.id);
      } else {
        conflicts.push({ slot, reason: `Conflicts with booking ${booking.id}` });
      }
    }
  }

  return { conflicts, overrideTargets: [...overrideTargets] };
}

export function blockToSlot(block: CalendarBlock): BookingSlot {
  return { date: block.date, startTime: block.startTime, endTime: block.endTime };
}

export function assertRecurrenceWindow(recurrence: Recurrence) {
  if (recurrence.frequency === "none") return;
  const hasEndDate = Boolean(recurrence.endDate);
  const hasOccurrences = Boolean(recurrence.occurrences);

  if (hasEndDate === hasOccurrences) {
    throw new Error("For recurrence, provide exactly one of endDate or occurrences.");
  }

  if (recurrence.endDate) {
    const start = new Date();
    const end = ymdToDateLocal(recurrence.endDate);
    const diffDays = Math.floor((end.valueOf() - start.valueOf()) / (1000 * 60 * 60 * 24));
    if (diffDays > MAX_RECURRENCE_DAYS) {
      throw new Error("Recurrence exceeds the 6-month window.");
    }
  }

  if (recurrence.occurrences && recurrence.occurrences > 26) {
    throw new Error("Recurrence occurrences cannot exceed 26.");
  }
}

export function sortSlots(slots: BookingSlot[]) {
  return [...slots].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.startTime.localeCompare(b.startTime);
  });
}

export function findInternalSlotConflicts(slots: BookingSlot[]) {
  const conflicts: Array<{ slot: BookingSlot; reason: string }> = [];
  const seen = new Set<string>();

  const key = (slot: BookingSlot) => `${slot.date}-${slot.startTime}-${slot.endTime}`;

  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      if (!overlaps(slots[i], slots[j])) continue;

      const aKey = key(slots[i]);
      const bKey = key(slots[j]);

      if (!seen.has(aKey)) {
        conflicts.push({ slot: slots[i], reason: "Overlaps another slot in this booking request." });
        seen.add(aKey);
      }
      if (!seen.has(bKey)) {
        conflicts.push({ slot: slots[j], reason: "Overlaps another slot in this booking request." });
        seen.add(bKey);
      }
    }
  }

  return conflicts;
}
