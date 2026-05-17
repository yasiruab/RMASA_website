import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth-guards";
import { sendBookingStatusNotification } from "@/lib/email";
import { evaluateBookingConflicts } from "@/lib/calendar-core";
import { readCalendarDb, updateCalendarDb } from "@/lib/calendar-store";
import { Booking, BookingStatus } from "@/lib/calendar-types";

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
  // Per-slot update fields:
  slotDate?: string;
  slotStartTime?: string;
  slotStatus?: BookingStatus | null; // null = clear override (inherit booking status)
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

  // Per-slot status update (slotStatus can be a status string or null to clear override)
  if (payload.slotDate && payload.slotStartTime && "slotStatus" in payload) {
    await updateCalendarDb((db) => ({
      ...db,
      bookings: db.bookings.map((item) => {
        if (item.id !== bookingId) return item;
        return {
          ...item,
          slots: item.slots.map((slot) =>
            slot.date === payload.slotDate && slot.startTime === payload.slotStartTime
              ? { ...slot, slotStatus: payload.slotStatus ?? undefined }
              : slot,
          ),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));

    await logAuditEvent({
      actorUserId: auth.actor.userId,
      actorEmail: auth.actor.email,
      action: "ADMIN_SLOT_STATUS_UPDATED",
      resourceType: "booking",
      resourceId: bookingId,
      meta: { slotDate: payload.slotDate, slotStartTime: payload.slotStartTime, slotStatus: payload.slotStatus },
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    });

    // Fire status email when this update completes the final unactioned slot.
    // Compute updated slots in memory to detect the partial→all-actioned transition.
    const updatedSlots = existing.slots.map((slot) =>
      slot.date === payload.slotDate && slot.startTime === payload.slotStartTime
        ? { ...slot, slotStatus: payload.slotStatus ?? undefined }
        : slot,
    );
    const wasAllActioned = existing.slots.every((s) => s.slotStatus != null);
    const nowAllActioned = updatedSlots.every((s) => s.slotStatus != null);

    if (!wasAllActioned && nowAllActioned) {
      const activeSlots = updatedSlots.filter(
        (s) => s.slotStatus !== "rejected" && s.slotStatus !== "cancelled_override",
      );
      let effectiveStatus: BookingStatus | null = null;
      if (activeSlots.length === 0) {
        effectiveStatus = "rejected";
      } else {
        const uniqueStatuses = [...new Set(activeSlots.map((s) => s.slotStatus!))];
        if (uniqueStatuses.length === 1) effectiveStatus = uniqueStatuses[0];
      }

      const notifyStatuses: BookingStatus[] = ["confirmed", "tentative", "rejected"];
      if (effectiveStatus && notifyStatuses.includes(effectiveStatus)) {
        const room = current.rooms.find((r) => r.id === existing.roomTypeId);
        const eventType = current.eventTypes.find((et) => et.id === existing.eventTypeId);
        if (room && eventType) {
          const activeSlotKeys = new Set(activeSlots.map((s) => `${s.date}|${s.startTime}-${s.endTime}`));
          const adjustedTotal =
            effectiveStatus === "rejected"
              ? existing.totalAmountLkr
              : existing.amountBreakdown
                  .filter((b) => activeSlotKeys.has(`${b.date}|${b.slot}`))
                  .reduce((sum, b) => sum + b.amountLkr, 0);
          void sendBookingStatusNotification({
            to: existing.customer.email,
            customerName: existing.customer.name,
            reference: existing.reference,
            roomName: room.name,
            eventTypeName: eventType.name,
            slots: updatedSlots,
            slotStatuses: updatedSlots.map((s) => ({
              date: s.date,
              startTime: s.startTime,
              endTime: s.endTime,
              status: s.slotStatus!,
            })),
            totalAmountLkr: adjustedTotal,
            newStatus: effectiveStatus as "confirmed" | "tentative" | "rejected",
          });
        }
      }
    }

    return NextResponse.json({ message: "Slot updated." });
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
          // Only wipe per-slot overrides when doing an explicit bulk status change.
          slots: payload.status !== undefined
            ? item.slots.map((slot) => ({ ...slot, slotStatus: undefined }))
            : item.slots,
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

      return { ...item };
    }),
  }));

  await logAuditEvent({
    actorUserId: auth.actor.userId,
    actorEmail: auth.actor.email,
    action: "ADMIN_BOOKING_UPDATED",
    resourceType: "booking",
    resourceId: bookingId,
    meta: { status: payload.status },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  const notifyStatuses: BookingStatus[] = ["confirmed", "tentative", "rejected"];
  if (payload.status && notifyStatuses.includes(nextStatus)) {
    const room = current.rooms.find((r) => r.id === existing.roomTypeId);
    const eventType = current.eventTypes.find((et) => et.id === existing.eventTypeId);
    if (room && eventType) {
      void sendBookingStatusNotification({
        to: existing.customer.email,
        customerName: existing.customer.name,
        reference: existing.reference,
        roomName: room.name,
        eventTypeName: eventType.name,
        slots: existing.slots,
        totalAmountLkr: existing.totalAmountLkr,
        newStatus: nextStatus as "confirmed" | "tentative" | "rejected",
      });
    }
  }

  return NextResponse.json({ message: "Booking updated." });
}
