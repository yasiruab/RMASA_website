import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { isBookingCadence, isOnCadence } from "@/lib/booking-cadence";
import { toMinutes } from "@/lib/calendar-core";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const INACTIVE_STATUSES = new Set(["rejected", "cancelled_override"]);

function todayInColombo() {
  // en-CA formats as YYYY-MM-DD, matching BookingSlot.date.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date());
}

// Counts active future slots in a room that do NOT start on the grid given by
// `startTime` + k × `cadence`. The Rooms editor calls this while the admin edits
// cadence or opening time, to warn that those bookings will keep their times.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const params = new URL(req.url).searchParams;
  const startTime = params.get("startTime") ?? "";
  const cadence = Number(params.get("cadence"));

  if (!id || !/^\d{2}:(00|30)$/.test(startTime) || !isBookingCadence(cadence)) {
    return NextResponse.json(
      { message: "Room id, startTime (HH:00 or HH:30) and cadence (30 or 60) are required." },
      { status: 400 },
    );
  }

  const slots = await prisma.bookingSlot.findMany({
    where: { date: { gte: todayInColombo() }, booking: { roomTypeId: id } },
    select: { startTime: true, slotStatus: true, booking: { select: { status: true } } },
  });

  const openingMinutes = toMinutes(startTime);
  const count = slots.filter(
    (slot) =>
      !INACTIVE_STATUSES.has(slot.slotStatus ?? slot.booking.status) &&
      !isOnCadence(toMinutes(slot.startTime), openingMinutes, cadence),
  ).length;

  return NextResponse.json({ count });
}
