import { NextResponse } from "next/server";
import { isValidDate } from "@/lib/calendar-core";
import { prisma } from "@/lib/prisma";
import type { Booking, BookingSlot, CalendarBlock } from "@/lib/calendar-types";

export const dynamic = "force-dynamic";

// Returns the raw conflict data (active bookings + blocks) for the requested
// date window, across ALL rooms. The client derives per-(room, event) slot
// availability from this snapshot by calling getSlotAvailabilities() locally —
// switching room/event/AC mode then re-renders without a network round-trip.
//
// The window must be small (the calendar fetches 14 days). Rejected and
// cancelled_override bookings are excluded server-side since they never block
// availability.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = String(searchParams.get("from") ?? "");
  const to = String(searchParams.get("to") ?? "");

  if (!from || !to || !isValidDate(from) || !isValidDate(to) || from > to) {
    return NextResponse.json(
      { message: "Missing or invalid from/to date." },
      { status: 400 },
    );
  }

  // Hard ceiling on the window size — keeps a bug or malicious client from
  // pulling the whole table. 31 days covers the calendar's 14-day fetch plus
  // headroom for prefetch experiments.
  const fromMs = new Date(from + "T00:00:00Z").getTime();
  const toMs = new Date(to + "T00:00:00Z").getTime();
  const windowDays = Math.round((toMs - fromMs) / 86_400_000) + 1;
  if (windowDays > 31) {
    return NextResponse.json(
      { message: "Window too large (max 31 days)." },
      { status: 400 },
    );
  }

  const [slotRows, blockRows] = await prisma.$transaction([
    prisma.bookingSlot.findMany({
      where: {
        date: { gte: from, lte: to },
        booking: { status: { in: ["pending", "confirmed", "tentative"] } },
      },
      include: {
        booking: {
          select: {
            id: true,
            roomTypeId: true,
            eventTypeId: true,
            status: true,
            cleanupDurationMinutes: true,
          },
        },
      },
    }),
    prisma.calendarBlock.findMany({
      where: { date: { gte: from, lte: to } },
    }),
  ]);

  // Group slots by their parent booking, then emit a minimal Booking-shaped
  // object per group. Only the fields read by getSlotAvailabilities() /
  // getSlotStatus() are populated; everything else is left as a safe zero
  // value so the type still matches.
  const byBookingId = new Map<
    string,
    {
      id: string;
      roomTypeId: string;
      eventTypeId: string;
      status: Booking["status"];
      cleanupDurationMinutes: number;
      slots: BookingSlot[];
    }
  >();

  for (const row of slotRows) {
    const b = row.booking;
    let entry = byBookingId.get(b.id);
    if (!entry) {
      entry = {
        id: b.id,
        roomTypeId: b.roomTypeId,
        eventTypeId: b.eventTypeId,
        status: b.status,
        cleanupDurationMinutes: b.cleanupDurationMinutes,
        slots: [],
      };
      byBookingId.set(b.id, entry);
    }
    entry.slots.push({
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      slotStatus: row.slotStatus ?? undefined,
      rejectReason: row.rejectReason ?? undefined,
    });
  }

  const bookings = Array.from(byBookingId.values());
  const blocks: CalendarBlock[] = blockRows.map((block) => ({
    id: block.id,
    roomTypeId: block.roomTypeId,
    date: block.date,
    startTime: block.startTime,
    endTime: block.endTime,
    reason: block.reason,
    createdAt: block.createdAt.toISOString(),
  }));

  return NextResponse.json({ from, to, bookings, blocks });
}
