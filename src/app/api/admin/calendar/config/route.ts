import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth-guards";
import { replaceCalendarConfig } from "@/lib/calendar-store";
import { EventType, PricingRule, RoomType } from "@/lib/calendar-types";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ConfigPayload = {
  rooms?: RoomType[];
  eventTypes?: EventType[];
  pricingRules?: PricingRule[];
};

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  // Scoped: three config tables only. The legacy readCalendarDb() pulled
  // every booking and payment entry alongside.
  const [rooms, eventTypes, pricingRules] = await prisma.$transaction([
    prisma.roomType.findMany(),
    prisma.eventType.findMany(),
    prisma.pricingRule.findMany(),
  ]);
  return NextResponse.json({
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      workingHours: { startTime: r.startTime, endTime: r.endTime },
      capacity: r.capacity ?? undefined,
      description: r.description ?? undefined,
    })),
    eventTypes: eventTypes.map((e) => ({
      id: e.id,
      name: e.name,
      durationMinutes: e.durationMinutes,
      cleanupDurationMinutes: e.cleanupDurationMinutes,
      maxAdvanceBookingDays: e.maxAdvanceBookingDays,
      priority: e.priority,
      roomTypeId: e.roomTypeId ?? undefined,
    })),
    pricingRules: pricingRules.map((rule) => ({
      id: rule.id,
      roomTypeId: rule.roomTypeId,
      eventTypeId: rule.eventTypeId,
      acMode: rule.acMode,
      dayType: rule.dayType,
      amountLkr: rule.amountLkr,
    })),
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

  const invalidCapacity = payload.rooms.find(
    (room) =>
      room.capacity !== undefined &&
      room.capacity !== null &&
      (!Number.isInteger(room.capacity) || room.capacity < 0 || room.capacity > 100000),
  );
  if (invalidCapacity) {
    return NextResponse.json(
      { message: `Room "${invalidCapacity.name}": capacity must be a whole number between 0 and 100000.` },
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

  const invalidDuration = payload.eventTypes.find(
    (et) =>
      typeof et.durationMinutes !== "number" ||
      !Number.isInteger(et.durationMinutes) ||
      et.durationMinutes < 1 ||
      et.durationMinutes > 24 * 60,
  );
  if (invalidDuration) {
    return NextResponse.json(
      { message: `Event type "${invalidDuration.name}": duration must be a whole number of minutes between 1 and 1440.` },
      { status: 400 },
    );
  }

  const invalidCleanup = payload.eventTypes.find(
    (et) =>
      typeof et.cleanupDurationMinutes !== "number" ||
      !Number.isInteger(et.cleanupDurationMinutes) ||
      et.cleanupDurationMinutes < 0 ||
      et.cleanupDurationMinutes > 480,
  );
  if (invalidCleanup) {
    return NextResponse.json(
      { message: `Event type "${invalidCleanup.name}": cleanup duration must be a whole number between 0 and 480 minutes.` },
      { status: 400 },
    );
  }

  const invalidAdvanceLimit = payload.eventTypes.find(
    (et) =>
      typeof et.maxAdvanceBookingDays !== "number" ||
      !Number.isInteger(et.maxAdvanceBookingDays) ||
      et.maxAdvanceBookingDays < 0 ||
      et.maxAdvanceBookingDays > 3650,
  );
  if (invalidAdvanceLimit) {
    return NextResponse.json(
      { message: `Event type "${invalidAdvanceLimit.name}": advance booking limit must be a whole number between 0 and 3650 days.` },
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

  try {
    // Wipe-and-recreate scoped to the three config tables only — bookings,
    // slots, payment entries, and calendar blocks are not touched, so this
    // can no longer race with admin booking-queue actions.
    await replaceCalendarConfig(payload.rooms, payload.eventTypes, payload.pricingRules);
  } catch (error) {
    console.error("[config PUT] replaceCalendarConfig failed:", error);
    return NextResponse.json(
      { message: "Failed to save configuration. Please try again or restart the server." },
      { status: 500 },
    );
  }

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
