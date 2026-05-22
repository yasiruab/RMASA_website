import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth-guards";
import {
  sendBookingStatusNotification,
  sendAdminRejectionNotification,
  sendBookingSlotOverriddenNotification,
  sendAdminSlotOverriddenNotification,
} from "@/lib/email";
import { evaluateBookingConflicts, type OverrideTarget } from "@/lib/calendar-core";
import {
  readCalendarDb,
  updateBookingSlotStatus,
  updateBookingSlotsBatch,
  updateBookingStatus,
} from "@/lib/calendar-store";
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
      await updateBookingSlotsBatch(bookingId, payload.batchSlotUpdates);
    } catch (err) {
      console.error("[batch-save] updateBookingSlotsBatch failed:", err);
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
    await updateBookingSlotStatus(
      bookingId,
      payload.slotDate,
      payload.slotStartTime,
      payload.slotStatus ?? null,
    );

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
  let overrideTargets: OverrideTarget[] = [];
  let overrideReason = "";

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
    if (overrideTargets.length > 0) {
      const eventTypeName =
        current.eventTypes.find((et) => et.id === existing.eventTypeId)?.name ?? "higher-priority booking";
      overrideReason = `Overridden by ${existing.reference} (${eventTypeName})`;
    }
  }

  // updateBookingStatus handles set-once confirmedAt internally and cascades
  // overrideTargets to slotStatus=cancelled_override on the overlapping slots
  // (not the whole booking) inside the same transaction.
  await updateBookingStatus(
    bookingId,
    nextStatus,
    nextStatus === "rejected" ? (payload.rejectReason ?? null) : null,
    nextStatus === "confirmed" ? overrideTargets : [],
    overrideReason,
  );

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

      // Override-cascade notifications: per-overridden-customer + one admin
      // alert. Only fires when the admin's confirm triggered an actual cascade.
      // `current` is the pre-cascade snapshot so it still carries the
      // overridden bookings' customer + slot details.
      if (nextStatus === "confirmed" && overrideTargets.length > 0) {
        const overrideCustomerEmails = overrideTargets.flatMap((target) => {
          const overridden = current.bookings.find((b) => b.id === target.bookingId);
          if (!overridden) return [];
          const overriddenRoom = current.rooms.find((r) => r.id === overridden.roomTypeId);
          const overriddenEventType = current.eventTypes.find(
            (et) => et.id === overridden.eventTypeId,
          );
          const cancelledSlots = target.slotKeys
            .map(({ date, startTime }) => {
              const slot = overridden.slots.find(
                (s) => s.date === date && s.startTime === startTime,
              );
              return slot ? { date, startTime, endTime: slot.endTime } : null;
            })
            .filter((s): s is { date: string; startTime: string; endTime: string } => s !== null);
          const survivingSlots = overridden.slots
            .filter((s) => {
              const wasCancelled = target.slotKeys.some(
                (k) => k.date === s.date && k.startTime === s.startTime,
              );
              if (wasCancelled) return false;
              const eff = s.slotStatus ?? overridden.status;
              return eff !== "rejected" && eff !== "cancelled_override";
            })
            .map((s) => ({ date: s.date, startTime: s.startTime, endTime: s.endTime }));
          return [
            sendBookingSlotOverriddenNotification({
              to: overridden.customer.email,
              customerName: overridden.customer.name,
              reference: overridden.reference,
              roomName: overriddenRoom?.name ?? room.name,
              eventTypeName: overriddenEventType?.name ?? "—",
              cancelledSlots,
              survivingSlots,
              newBookingReference: existing.reference,
              newBookingEventTypeName: eventType.name,
            }),
          ];
        });

        const overrideAdminBlocks = overrideTargets
          .map((target) => {
            const overridden = current.bookings.find((b) => b.id === target.bookingId);
            if (!overridden) return null;
            const cancelledSlots = target.slotKeys
              .map(({ date, startTime }) => {
                const slot = overridden.slots.find(
                  (s) => s.date === date && s.startTime === startTime,
                );
                return slot ? { date, startTime, endTime: slot.endTime } : null;
              })
              .filter(
                (s): s is { date: string; startTime: string; endTime: string } => s !== null,
              );
            return {
              reference: overridden.reference,
              customerName: overridden.customer.name,
              customerEmail: overridden.customer.email,
              cancelledSlots,
            };
          })
          .filter((o): o is NonNullable<typeof o> => o !== null);

        await Promise.allSettled([
          ...overrideCustomerEmails,
          sendAdminSlotOverriddenNotification({
            newBookingReference: existing.reference,
            newBookingEventTypeName: eventType.name,
            newBookingCustomerName: existing.customer.name,
            roomName: room.name,
            overrides: overrideAdminBlocks,
          }),
        ]);
      }
    }
  }

  return NextResponse.json({ message: "Booking updated." });
}
