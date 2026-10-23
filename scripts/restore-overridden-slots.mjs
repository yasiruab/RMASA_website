#!/usr/bin/env node
// One-off repair for audit finding F1 (October 2026).
//
// Before the fix, an anonymous public booking request for a higher-priority
// event type immediately set overlapping slots of lower-priority bookings to
// slotStatus="cancelled_override" — even if an admin later rejected that request.
// This script finds those orphaned cancellations and puts the slots back.
//
// A slot is restored only when ALL of these hold:
//   - it is cancelled_override with rejectReason "Overridden by <REF> (…)"
//   - booking <REF> ended up rejected (booking-level, or every slot rejected /
//     cancelled) — overrides by bookings that are still pending or were
//     confirmed are left alone
//   - the slot does not now overlap another active booking in the same room
//     (including cleanup windows); those are listed for manual review
//
// Dry run by default (read-only). Pass --apply to write. Each restore clears
// slotStatus + rejectReason and writes an AuditLog row. Customers were already
// emailed that these slots were cancelled — the output lists their contact
// details so the desk can tell them the booking stands.
//
//   node scripts/restore-overridden-slots.mjs           # report only
//   node scripts/restore-overridden-slots.mjs --apply   # restore

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const INACTIVE = new Set(["rejected", "cancelled_override"]);
const REASON_PATTERN = /^Overridden by (BK-[0-9A-F]{6}) \(/;

function toMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function effectiveStatus(slot, booking) {
  return slot.slotStatus ?? booking.status;
}

function isDead(booking) {
  if (INACTIVE.has(booking.status)) return true;
  return booking.slots.every((slot) => INACTIVE.has(effectiveStatus(slot, booking)));
}

// Same rule as effectiveOverlaps() in src/lib/calendar-core.ts: each slot's end
// is extended by its booking's cleanup window before comparing.
function overlaps(a, cleanupA, b, cleanupB) {
  if (a.date !== b.date) return false;
  return (
    toMinutes(a.startTime) < toMinutes(b.endTime) + cleanupB &&
    toMinutes(b.startTime) < toMinutes(a.endTime) + cleanupA
  );
}

async function findBlockingSlot(victim, slot) {
  const rows = await prisma.bookingSlot.findMany({
    where: {
      date: slot.date,
      bookingId: { not: victim.id },
      booking: { roomTypeId: victim.roomTypeId, status: { in: ["pending", "confirmed", "tentative"] } },
    },
    include: { booking: { select: { reference: true, status: true, cleanupDurationMinutes: true } } },
  });
  return rows.find(
    (row) =>
      !INACTIVE.has(row.slotStatus ?? row.booking.status) &&
      overlaps(slot, victim.cleanupDurationMinutes, row, row.booking.cleanupDurationMinutes),
  );
}

async function main() {
  const cancelled = await prisma.bookingSlot.findMany({
    where: { slotStatus: "cancelled_override", rejectReason: { startsWith: "Overridden by " } },
    include: {
      booking: {
        select: {
          id: true,
          reference: true,
          roomTypeId: true,
          status: true,
          cleanupDurationMinutes: true,
          customerName: true,
          customerEmail: true,
          customerPhone: true,
        },
      },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  const overriderRefs = [
    ...new Set(cancelled.map((s) => REASON_PATTERN.exec(s.rejectReason ?? "")?.[1]).filter(Boolean)),
  ];
  const overriders = await prisma.booking.findMany({
    where: { reference: { in: overriderRefs } },
    select: { reference: true, status: true, slots: { select: { slotStatus: true } } },
  });
  const deadRefs = new Set(overriders.filter(isDead).map((b) => b.reference));

  const restorable = [];
  const needsReview = [];
  for (const slot of cancelled) {
    const ref = REASON_PATTERN.exec(slot.rejectReason ?? "")?.[1];
    if (!ref || !deadRefs.has(ref)) continue;
    const blocker = await findBlockingSlot(slot.booking, slot);
    (blocker ? needsReview : restorable).push({ slot, overrider: ref, blocker });
  }

  const describe = ({ slot, overrider }) =>
    `${slot.booking.reference} ${slot.date} ${slot.startTime}-${slot.endTime} ` +
    `(cancelled by rejected ${overrider}) — ${slot.booking.customerName} <${slot.booking.customerEmail}> ${slot.booking.customerPhone}`;

  console.log(`Orphaned override cancellations: ${restorable.length + needsReview.length}`);
  console.log(`\nRestorable (${restorable.length}):`);
  for (const item of restorable) console.log(`  ${describe(item)}`);
  console.log(`\nNeeds manual review — slot is now taken (${needsReview.length}):`);
  for (const item of needsReview) {
    console.log(`  ${describe(item)}\n    now overlaps ${item.blocker.booking.reference} ${item.blocker.startTime}-${item.blocker.endTime}`);
  }

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to restore the slots listed above.");
    return;
  }

  for (const { slot, overrider } of restorable) {
    await prisma.$transaction([
      prisma.bookingSlot.update({ where: { id: slot.id }, data: { slotStatus: null, rejectReason: null } }),
      prisma.booking.update({ where: { id: slot.booking.id }, data: { updatedAt: new Date() } }),
      prisma.auditLog.create({
        data: {
          actorEmail: "script:restore-overridden-slots",
          action: "ADMIN_OVERRIDE_RESTORED",
          resourceType: "booking",
          resourceId: slot.booking.id,
          meta: { date: slot.date, startTime: slot.startTime, overriddenBy: overrider },
        },
      }),
    ]);
  }
  console.log(`\nRestored ${restorable.length} slot(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
