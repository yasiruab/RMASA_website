import { NextResponse } from "next/server";
import { findEventType, getSlotAvailabilities, isEventTypeAllowedForRoom, isValidDate } from "@/lib/calendar-core";
import { readCalendarDb } from "@/lib/calendar-store";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const roomTypeId = String(searchParams.get("roomTypeId") ?? "");
  const eventTypeId = String(searchParams.get("eventTypeId") ?? "");
  const date = String(searchParams.get("date") ?? "");

  if (!roomTypeId || !eventTypeId || !date || !isValidDate(date)) {
    return NextResponse.json({ message: "Missing or invalid room/event/date." }, { status: 400 });
  }

  const db = await readCalendarDb();
  const room = db.rooms.find((item) => item.id === roomTypeId);
  if (!room) {
    return NextResponse.json({ message: "Invalid room type." }, { status: 400 });
  }

  const eventType = findEventType(db, eventTypeId);
  if (!isEventTypeAllowedForRoom(eventType, roomTypeId)) {
    return NextResponse.json({ message: "Selected event type is not available for this room." }, { status: 400 });
  }
  const slots = getSlotAvailabilities(db, room, date, eventType.durationHours, eventType.priority);

  return NextResponse.json({
    date,
    roomTypeId,
    eventTypeId,
    durationHours: eventType.durationHours,
    workingHours: room.workingHours,
    slots,
  });
}
