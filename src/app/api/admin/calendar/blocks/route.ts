import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
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
  const db = await readCalendarDb();
  return NextResponse.json({
    blocks: db.blocks,
    rooms: db.rooms,
  });
}

export async function POST(req: Request) {
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

  return NextResponse.json({ message: "Block created.", block });
}

export async function DELETE(req: Request) {
  const payload = (await req.json()) as BlockPayload;
  const id = String(payload.id ?? "");

  if (!id) {
    return NextResponse.json({ message: "Block id is required." }, { status: 400 });
  }

  await updateCalendarDb((current) => ({
    ...current,
    blocks: current.blocks.filter((item) => item.id !== id),
  }));

  return NextResponse.json({ message: "Block removed." });
}
