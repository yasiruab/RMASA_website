// Booking cadence = how often a booking may start in a room (every 30 or 60 min),
// counted from the room's opening time. Opening 08:30 + 60 min cadence allows
// 08:30, 09:30, 10:30 … only. All helpers work in minutes-since-midnight and
// have no imports, so they run unchanged in the browser, API routes and tests.

import type { BookingCadence } from "./calendar-types";

export const BOOKING_CADENCE_OPTIONS: readonly BookingCadence[] = [30, 60];
export const DEFAULT_BOOKING_CADENCE: BookingCadence = 30;

export function isBookingCadence(value: unknown): value is BookingCadence {
  return BOOKING_CADENCE_OPTIONS.includes(value as BookingCadence);
}

/** Coerces a stored value to a valid cadence; unknown values fall back to the default. */
export function toBookingCadence(value: unknown): BookingCadence {
  return isBookingCadence(value) ? value : DEFAULT_BOOKING_CADENCE;
}

export function isOnCadence(startMinutes: number, openingMinutes: number, cadence: number) {
  return startMinutes >= openingMinutes && (startMinutes - openingMinutes) % cadence === 0;
}

/** Smallest allowed start at or after `minutes`. */
export function nextCadenceStart(minutes: number, openingMinutes: number, cadence: number) {
  if (minutes <= openingMinutes) return openingMinutes;
  return openingMinutes + Math.ceil((minutes - openingMinutes) / cadence) * cadence;
}

/** Last allowed start whose booking still ends by closing time, or null if none fits. */
export function lastCadenceStart(
  openingMinutes: number,
  closingMinutes: number,
  cadence: number,
  durationMinutes: number,
): number | null {
  const latest = closingMinutes - durationMinutes;
  if (latest < openingMinutes) return null;
  return openingMinutes + Math.floor((latest - openingMinutes) / cadence) * cadence;
}

/** Empty minutes left after a booking (duration + cleanup) before the next allowed start. */
export function cadenceGapMinutes(occupiedMinutes: number, cadence: number) {
  return (cadence - (occupiedMinutes % cadence)) % cadence;
}
