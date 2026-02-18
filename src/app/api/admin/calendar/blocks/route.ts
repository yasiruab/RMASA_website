import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth-guards";
import { isValidDate, isValidTime } from "@/lib/calendar-core";
import { readCalendarDb, updateCalendarDb } from "@/lib/calendar-store";

type BlockPayload = {
  id?: string;
  roomTypeId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  reason?: string;
};

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const db = await readCalendarDb();
  return NextResponse.json({
    blocks: db.blocks,
    rooms: db.rooms,
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const payload = (await req.json()) as BlockPayload;
  const roomTypeId = String(payload.roomTypeId ?? "");
  const date = String(payload.date ?? "");
  const startTime = String(payload.startTime ?? "");
  const endTime = String(payload.endTime ?? "");
  const reason = String(payload.reason ?? "").trim();

  if (!roomTypeId || !isValidDate(date) || !isValidTime(startTime) || !isValidTime(endTime) || !reason) {
    return NextResponse.json({ message: "roomTypeId, date, startTime, endTime and reason are required." }, { status: 400 });
  }

  const block = {
    id: randomUUID(),
    roomTypeId,
    date,
    startTime,
    endTime,
    reason,
    createdAt: new Date().toISOString(),
  };

  await updateCalendarDb((current) => ({
    ...current,
    blocks: [...current.blocks, block],
  }));

  await logAuditEvent({
    actorUserId: auth.actor.userId,
    actorEmail: auth.actor.email,
    action: "ADMIN_BLOCK_CREATED",
    resourceType: "calendar_block",
    resourceId: block.id,
    meta: { roomTypeId, date, startTime, endTime, reason },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ message: "Block created.", block });
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const payload = (await req.json()) as BlockPayload;
  const id = String(payload.id ?? "");

  if (!id) {
    return NextResponse.json({ message: "Block id is required." }, { status: 400 });
  }

  await updateCalendarDb((current) => ({
    ...current,
    blocks: current.blocks.filter((item) => item.id !== id),
  }));

  await logAuditEvent({
    actorUserId: auth.actor.userId,
    actorEmail: auth.actor.email,
    action: "ADMIN_BLOCK_REMOVED",
    resourceType: "calendar_block",
    resourceId: id,
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ message: "Block removed." });
}
