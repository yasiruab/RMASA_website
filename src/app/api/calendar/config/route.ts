import { NextResponse } from "next/server";
import { readCalendarDb } from "@/lib/calendar-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readCalendarDb();
  return NextResponse.json({
    rooms: db.rooms,
    eventTypes: db.eventTypes,
    pricingRules: db.pricingRules,
    acModes: [
      { id: "with_ac", label: "With AC" },
      { id: "without_ac", label: "Without AC" },
    ],
  });
}
