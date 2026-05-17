import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth-guards";
import { sendBookingStatusNotification, sendAdminRejectionNotification } from "@/lib/email";
import { evaluateBookingConflicts } from "@/lib/calendar-core";
import { readCalendarDb, updateCalendarDb } from "@/lib/calendar-store";
import { Booking, BookingSlot, BookingStatus } from "@/lib/calendar-types";

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

type BatchSlotUpdate = {
  slotDate: string;
  slotStartTime: string;
  slotStatus: BookingStatus | null;
  rejectReason?: string;
};

type PatchPayload = {
  id?: string;
  status?: BookingStatus;
  rejectReason?: string;
  // Per-slot update fields (legacy single-slot path):
  slotDate?: string;
  slotStartTime?: string;
  slotStatus?: BookingStatus | null;
  // Batch slot save path:
  batchSlotUpdates?: BatchSlotUpdate[];
};

function deriveEffectiveStatus(slots: BookingSlot[], baseStatus: BookingStatus): BookingStatus | null {
  const active = slots.filter(
    (s) => (s.slotStatus ?? baseStatus) !== "rejected" && (s.slotStatus ?? baseStatus) !== "cancelled_override",
  );
  if (active.length === 0) return "rejected";
  const unique = [...new Set(active.map((s) => s.slotStatus ?? baseStatus))];
  return unique.length === 1 ? unique[0] : null;
}

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

  // ─── Batch slot save path ──────────────────────────────────────────────────
  if (payload.batchSlotUpdates) {
    for (const u of payload.batchSlotUpdates) {
      if (u.slotStatus === "rejected" && !u.rejectReason?.trim()) {
        return NextResponse.json({ message: "Reject reason is required for rejected slots." }, { status: 400 });
      }
    }

    const preBatchSlots = existing.slots.map((s) => ({ ...s }));

    try {
      await updateCalendarDb((db) => ({
        ...db,
        bookings: db.bookings.map((item) => {
          if (item.id !== bookingId) return item;
          return {
            ...item,
            slots: item.slots.map((slot) => {
              const upd = payload.batchSlotUpdates!.find(
                (u) => u.slotDate === slot.date && u.slotStartTime === slot.startTime,
              );
              if (!upd) return slot;
              return {
                ...slot,
                slotStatus: upd.slotStatus ?? undefined,
                rejectReason: upd.slotStatus === "rejected" ? (upd.rejectReason ?? undefined) : undefined,
              };
            }),
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
    } catch (err) {
      console.error("[batch-save] updateCalendarDb failed:", err);
      const msg = err instanceof Error ? err.message : "Database error.";
      return NextResponse.json({ message: `Save failed: ${msg}` }, { status: 500 });
    }

    await logAuditEvent({
      actorUserId: auth.actor.userId,
      actorEmail: auth.actor.email,
      action: "ADMIN_BATCH_SLOTS_SAVED",
      resourceType: "booking",
      resourceId: bookingId,
      meta: { updates: payload.batchSlotUpdates.map((u) => ({ ...u })) },
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    });

    // Compute updated slot state in memory for email logic
    const updatedSlots: BookingSlot[] = existing.slots.map((slot) => {
      const upd = payload.batchSlotUpdates!.find(
        (u) => u.slotDate === slot.date && u.slotStartTime === slot.startTime,
      );
      if (!upd) return slot;
      return {
        ...slot,
        slotStatus: upd.slotStatus ?? undefined,
        rejectReason: upd.slotStatus === "rejected" ? (upd.rejectReason ?? undefined) : undefined,
      };
    });

    const newlyRejected = payload.batchSlotUpdates.filter((u) => {
      if (u.slotStatus !== "rejected") return false;
      const prev = preBatchSlots.find((s) => s.date === u.slotDate && s.startTime === u.slotStartTime);
      return prev?.slotStatus !== "rejected";
    });
    const hasNewRejections = newlyRejected.length > 0;
    const effectiveStatus = deriveEffectiveStatus(updatedSlots, existing.status);

    const room = current.rooms.find((r) => r.id === existing.roomTypeId);
    const eventType = current.eventTypes.find((et) => et.id === existing.eventTypeId);

    if (room && eventType && (effectiveStatus !== null || hasNewRejections)) {
      const allSlotStatuses = updatedSlots.map((s) => ({
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        status: (s.slotStatus ?? existing.status) as BookingStatus,
        rejectReason: s.rejectReason,
      }));

      const activeSlots = updatedSlots.filter(
        (s) => (s.slotStatus ?? existing.status) !== "rejected" &&
               (s.slotStatus ?? existing.status) !== "cancelled_override",
      );
      const activeSlotKeys = new Set(activeSlots.map((s) => `${s.date}|${s.startTime}-${s.endTime}`));
      const adjustedTotal = existing.amountBreakdown
        .filter((b) => activeSlotKeys.has(`${b.date}|${b.slot}`))
        .reduce((sum, b) => sum + b.amountLkr, 0) || existing.totalAmountLkr;

      let emailStatus: "confirmed" | "tentative" | "rejected" | "partial_update" | null = null;

      if (effectiveStatus === "confirmed") {
        emailStatus = hasNewRejections ? "partial_update" : "confirmed";
      } else if (effectiveStatus === "rejected") {
        emailStatus = "rejected";
      } else if (hasNewRejections) {
        emailStatus = "partial_update";
      }

      if (emailStatus) {
        const rejectReasonText = newlyRejected.map((u) => u.rejectReason).filter(Boolean).join("; ");
        await sendBookingStatusNotification({
          to: existing.customer.email,
          customerName: existing.customer.name,
          reference: existing.reference,
          roomName: room.name,
          eventTypeName: eventType.name,
          slots: activeSlots.length > 0 ? activeSlots : updatedSlots,
          slotStatuses: hasNewRejections ? allSlotStatuses : undefined,
          totalAmountLkr: adjustedTotal,
          newStatus: emailStatus,
          rejectReason: emailStatus === "rejected" ? rejectReasonText : undefined,
        });

        if (hasNewRejections) {
          await sendAdminRejectionNotification({
            reference: existing.reference,
            customerName: existing.customer.name,
            customerEmail: existing.customer.email,
            roomName: room.name,
            eventTypeName: eventType.name,
            slots: updatedSlots,
            rejectReason: rejectReasonText || "No reason provided",
          });
        }
      }
    }

    return NextResponse.json({ message: "Booking saved." });
  }

  // ─── Legacy single-slot path ───────────────────────────────────────────────
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

    return NextResponse.json({ message: "Slot updated." });
  }

  // ─── Booking-level status change ───────────────────────────────────────────
  if (payload.status === "rejected" && !payload.rejectReason?.trim()) {
    return NextResponse.json({ message: "Reject reason is required when rejecting a booking." }, { status: 400 });
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
          rejectReason: nextStatus === "rejected" ? (payload.rejectReason ?? undefined) : item.rejectReason,
          // Wipe per-slot overrides on explicit bulk status change
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
    meta: { status: payload.status, rejectReason: payload.rejectReason },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  const notifyStatuses: BookingStatus[] = ["confirmed", "tentative", "rejected"];
  if (payload.status && notifyStatuses.includes(nextStatus)) {
    const room = current.rooms.find((r) => r.id === existing.roomTypeId);
    const eventType = current.eventTypes.find((et) => et.id === existing.eventTypeId);
    if (room && eventType) {
      await sendBookingStatusNotification({
        to: existing.customer.email,
        customerName: existing.customer.name,
        reference: existing.reference,
        roomName: room.name,
        eventTypeName: eventType.name,
        slots: existing.slots,
        totalAmountLkr: existing.totalAmountLkr,
        newStatus: nextStatus as "confirmed" | "tentative" | "rejected",
        rejectReason: nextStatus === "rejected" ? payload.rejectReason : undefined,
      });

      if (nextStatus === "rejected") {
        await sendAdminRejectionNotification({
          reference: existing.reference,
          customerName: existing.customer.name,
          customerEmail: existing.customer.email,
          roomName: room.name,
          eventTypeName: eventType.name,
          slots: existing.slots,
          rejectReason: payload.rejectReason ?? "No reason provided",
        });
      }
    }
  }

  return NextResponse.json({ message: "Booking updated." });
}
