// Pure helper with no "@/" imports so `npm test` (node --experimental-strip-types)
// can load it directly.

/**
 * Customer-facing duration label for event types: "1 HR", "6 HRS", "55 MIN",
 * "13 HRS 55 MIN". Used by the bookings legend, event pills and room pricing rows.
 */
export function formatDurationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = hours > 0 ? `${hours} HR${hours > 1 ? "S" : ""}` : "";
  const minutePart = rest > 0 ? `${rest} MIN` : "";
  return [hourPart, minutePart].filter(Boolean).join(" ");
}
