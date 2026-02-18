import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth-guards";
import { evaluateBookingConflicts } from "@/lib/calendar-core";
import { readCalendarDb, updateCalendarDb } from "@/lib/calendar-store";
import { Booking, BookingStatus, ReconciliationStatus } from "@/lib/calendar-types";

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const db = await readCalendarDb();
  return NextResponse.json({
    bookings: db.bookings,
    rooms: db.rooms,
    eventTypes: db.eventTypes,
  });
}

type PatchPayload = {
  id?: string;
  status?: BookingStatus;
  reconciliationStatus?: ReconciliationStatus;
  reconciliationNotes?: string;
};

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const payload = (await req.json()) as PatchPayload;
  const bookingId = String(payload.id ?? "");

  if (!bookingId) {
    return NextResponse.json({ message: "Booking id is required." }, { status: 400 });
  }

  const current = await readCalendarDb();
  const existing = current.bookings.find((item) => item.id === bookingId);
  if (!existing) {
    return NextResponse.json({ message: "Booking not found." }, { status: 404 });
  }

  const nextStatus = payload.status ?? existing.status;
  let overrideTargets: string[] = [];

  if (nextStatus === "confirmed") {
    const candidate: Booking = {
      ...existing,
      status: "confirmed",
    };
    const evaluation = evaluateBookingConflicts(current, candidate, bookingId);
    if (evaluation.conflicts.length > 0) {
      return NextResponse.json(
        {
          message: "Cannot confirm booking because it conflicts with existing equal/higher-priority bookings or blocks.",
          conflicts: evaluation.conflicts,
        },
        { status: 409 },
      );
    }
    overrideTargets = evaluation.overrideTargets;
  }

  await updateCalendarDb((db) => ({
    ...db,
    bookings: db.bookings.map((item) => {
      if (item.id === bookingId) {
        return {
          ...item,
          status: nextStatus,
          reconciliationStatus: payload.reconciliationStatus ?? item.reconciliationStatus,
          reconciliationNotes: payload.reconciliationNotes ?? item.reconciliationNotes,
          overriddenBookingIds:
            nextStatus === "confirmed" ? overrideTargets : item.overriddenBookingIds,
          updatedAt: new Date().toISOString(),
        };
      }

      if (nextStatus === "confirmed" && overrideTargets.includes(item.id)) {
        return {
          ...item,
          status: "cancelled_override" as const,
          updatedAt: new Date().toISOString(),
        };
      }

      return {
        ...item,
      };
    }),
  }));

  await logAuditEvent({
    actorUserId: auth.actor.userId,
    actorEmail: auth.actor.email,
    action: "ADMIN_BOOKING_UPDATED",
    resourceType: "booking",
    resourceId: bookingId,
    meta: {
      status: payload.status,
      reconciliationStatus: payload.reconciliationStatus,
      reconciliationNotes: payload.reconciliationNotes,
    },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ message: "Booking updated." });
}
