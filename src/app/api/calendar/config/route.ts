import { NextResponse } from "next/server";
import { toRoomType } from "@/lib/calendar-core";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const [rooms, eventTypes, pricingRules] = await prisma.$transaction([
    prisma.roomType.findMany(),
    prisma.eventType.findMany(),
    prisma.pricingRule.findMany(),
  ]);

  return NextResponse.json({
    rooms: rooms.map(toRoomType),
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
    acModes: [
      { id: "with_ac", label: "With A/C" },
      { id: "without_ac", label: "Without A/C" },
    ],
  });
}
