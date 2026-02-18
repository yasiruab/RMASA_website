import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth-guards";
import { readCalendarDb, updateCalendarDb } from "@/lib/calendar-store";
import { EventType, PricingRule, RoomType } from "@/lib/calendar-types";

export const dynamic = "force-dynamic";

type ConfigPayload = {
  rooms?: RoomType[];
  eventTypes?: EventType[];
  pricingRules?: PricingRule[];
};

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const db = await readCalendarDb();
  return NextResponse.json({
    rooms: db.rooms,
    eventTypes: db.eventTypes,
    pricingRules: db.pricingRules,
  });
}

export async function PUT(req: Request) {
  const auth = await requireSuperAdmin();
  if ("response" in auth) return auth.response;

  const payload = (await req.json()) as ConfigPayload;
  if (!payload.rooms || !payload.eventTypes || !payload.pricingRules) {
    return NextResponse.json({ message: "rooms, eventTypes and pricingRules are required." }, { status: 400 });
  }

  const invalidRoom = payload.rooms.find(
    (room) =>
      !room.name.trim() ||
      !/^\d{2}:00$/.test(room.workingHours.startTime) ||
      !/^\d{2}:00$/.test(room.workingHours.endTime),
  );
  if (invalidRoom) {
    return NextResponse.json(
      { message: "Each room must have a name and full-hour working times (HH:00)." },
      { status: 400 },
    );
  }

  const roomIds = new Set(payload.rooms.map((room) => room.id));
  const invalidEventType = payload.eventTypes.find(
    (eventType) => Boolean(eventType.roomTypeId) && !roomIds.has(String(eventType.roomTypeId)),
  );
  if (invalidEventType) {
    return NextResponse.json(
      { message: `Event type "${invalidEventType.name}" is attached to an invalid room.` },
      { status: 400 },
    );
  }

  const eventTypeMap = new Map(payload.eventTypes.map((eventType) => [eventType.id, eventType]));
  const invalidPricingRule = payload.pricingRules.find((rule) => {
    const type = eventTypeMap.get(rule.eventTypeId);
    if (!type) return true;
    return Boolean(type.roomTypeId) && type.roomTypeId !== rule.roomTypeId;
  });
  if (invalidPricingRule) {
    return NextResponse.json(
      { message: "Pricing matrix contains event types that are not allowed for selected room types." },
      { status: 400 },
    );
  }

  await updateCalendarDb((current) => ({
    ...current,
    rooms: payload.rooms ?? current.rooms,
    eventTypes: payload.eventTypes ?? current.eventTypes,
    pricingRules: payload.pricingRules ?? current.pricingRules,
  }));

  await logAuditEvent({
    actorUserId: auth.actor.userId,
    actorEmail: auth.actor.email,
    action: "ADMIN_CONFIG_UPDATED",
    resourceType: "calendar_config",
    resourceId: "global",
    meta: {
      roomCount: payload.rooms.length,
      eventTypeCount: payload.eventTypes.length,
      pricingRuleCount: payload.pricingRules.length,
    },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ message: "Configuration updated." });
}
