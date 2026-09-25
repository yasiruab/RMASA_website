"use client";

import { useEffect, useState } from "react";
import { cadenceGapMinutes, lastCadenceStart } from "@/lib/booking-cadence";
import { fromMinutes, toMinutes } from "@/lib/calendar-core";
import type { BookingCadence } from "@/lib/calendar-types";

type Room = {
  id: string;
  workingHours: { startTime: string; endTime: string };
  bookingCadenceMinutes: BookingCadence;
};
type EventTypeLite = {
  name: string;
  durationMinutes: number;
  cleanupDurationMinutes: number;
  roomTypeId?: string;
};

const HALF_HOUR_TIME = /^\d{2}:(00|30)$/;
const COUNT_FETCH_DELAY_MS = 400;

// Warning text is deliberately short and plain — most admins read English as a
// second language.
function buildGapWarnings(room: Room, eventTypes: EventTypeLite[]): string[] {
  const { startTime, endTime } = room.workingHours;
  if (!HALF_HOUR_TIME.test(startTime) || !HALF_HOUR_TIME.test(endTime)) return [];
  const opening = toMinutes(startTime);
  const closing = toMinutes(endTime);
  if (opening >= closing) return [];

  const cadence = room.bookingCadenceMinutes;
  const roomEvents = eventTypes.filter((e) => !e.roomTypeId || e.roomTypeId === room.id);
  const warnings: string[] = [];

  // End of day: judged by the shortest event, so the message shows once per room.
  const shortest = Math.min(...roomEvents.map((e) => e.durationMinutes));
  const lastStart = Number.isFinite(shortest)
    ? lastCadenceStart(opening, closing, cadence, shortest)
    : null;
  if (lastStart !== null && lastStart + shortest < closing) {
    warnings.push(
      `Last start time is ${fromMinutes(lastStart)}. The time from ${fromMinutes(lastStart + shortest)} to ${endTime} cannot be booked.`,
    );
  }

  for (const eventType of roomEvents) {
    const occupied = eventType.durationMinutes + eventType.cleanupDurationMinutes;
    const gap = cadenceGapMinutes(occupied, cadence);
    if (gap > 0) {
      warnings.push(
        `"${eventType.name}": each booking + cleanup is ${occupied} min. ${gap} min will be empty after each booking.`,
      );
    }
  }
  return warnings;
}

function changeWarning(count: number) {
  return count === 1
    ? "1 future booking in this room does not start on the new times. It will not change. Only new bookings use the new times."
    : `${count} future bookings in this room do not start on the new times. They will not change. Only new bookings use the new times.`;
}

/** Live, non-blocking cadence warnings shown under one row of the Rooms editor. */
export function RoomCadenceWarnings({
  room,
  savedRoom,
  eventTypes,
}: {
  room: Room;
  savedRoom?: Room;
  eventTypes: EventTypeLite[];
}) {
  const [offCadenceCount, setOffCadenceCount] = useState(0);

  const { startTime } = room.workingHours;
  const cadence = room.bookingCadenceMinutes;
  // Only an existing room whose start grid moved can have bookings off the new grid.
  const gridChanged =
    savedRoom !== undefined &&
    (savedRoom.workingHours.startTime !== startTime || savedRoom.bookingCadenceMinutes !== cadence);

  useEffect(() => {
    setOffCadenceCount(0);
    if (!gridChanged || !HALF_HOUR_TIME.test(startTime)) return;

    // Debounced because the time input fires on every keystroke.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams({ startTime, cadence: String(cadence) });
        const res = await fetch(
          `/api/admin/calendar/rooms/${encodeURIComponent(room.id)}/off-cadence?${query}`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        setOffCadenceCount(data.count);
      } catch {
        // Aborted or offline: the warning is advisory, so just leave it hidden.
      }
    }, COUNT_FETCH_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [gridChanged, room.id, startTime, cadence]);

  const warnings = buildGapWarnings(room, eventTypes);
  if (gridChanged && offCadenceCount > 0) warnings.unshift(changeWarning(offCadenceCount));
  if (warnings.length === 0) return null;

  return (
    <ul className="admin-room-warnings" role="status">
      {warnings.map((text) => (
        <li key={text}>⚠ {text}</li>
      ))}
    </ul>
  );
}
