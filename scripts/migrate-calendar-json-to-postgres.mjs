import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DB_PATH = path.join(process.cwd(), "data", "calendar-db.json");

async function main() {
  const raw = await readFile(DB_PATH, "utf8");
  const data = JSON.parse(raw);

  await prisma.$transaction(async (tx) => {
    for (const room of data.rooms ?? []) {
      await tx.roomType.upsert({
        where: { id: room.id },
        update: {
          name: room.name,
          startTime: room.workingHours.startTime,
          endTime: room.workingHours.endTime,
        },
        create: {
          id: room.id,
          name: room.name,
          startTime: room.workingHours.startTime,
          endTime: room.workingHours.endTime,
        },
      });
    }

    for (const eventType of data.eventTypes ?? []) {
      await tx.eventType.upsert({
        where: { id: eventType.id },
        update: {
          name: eventType.name,
          durationHours: eventType.durationHours,
          priority: eventType.priority,
          roomTypeId: eventType.roomTypeId ?? null,
        },
        create: {
          id: eventType.id,
          name: eventType.name,
          durationHours: eventType.durationHours,
          priority: eventType.priority,
          roomTypeId: eventType.roomTypeId ?? null,
        },
      });
    }

    for (const rule of data.pricingRules ?? []) {
      await tx.pricingRule.upsert({
        where: { id: rule.id },
        update: {
          roomTypeId: rule.roomTypeId,
          eventTypeId: rule.eventTypeId,
          acMode: rule.acMode,
          dayType: rule.dayType,
          amountLkr: rule.amountLkr,
        },
        create: {
          id: rule.id,
          roomTypeId: rule.roomTypeId,
          eventTypeId: rule.eventTypeId,
          acMode: rule.acMode,
          dayType: rule.dayType,
          amountLkr: rule.amountLkr,
        },
      });
    }

    for (const booking of data.bookings ?? []) {
      await tx.booking.upsert({
        where: { id: booking.id },
        update: {
          roomTypeId: booking.roomTypeId,
          eventTypeId: booking.eventTypeId,
          acMode: booking.acMode,
          status: booking.status,
          customerName: booking.customer.name,
          customerEmail: booking.customer.email,
          customerPhone: booking.customer.phone,
          customerPurpose: booking.customer.purpose,
          recurrenceFrequency: booking.recurrence.frequency,
          recurrenceEndDate: booking.recurrence.endDate ?? null,
          recurrenceOccurrences: booking.recurrence.occurrences ?? null,
          totalAmountLkr: booking.totalAmountLkr,
          reconciliationStatus: booking.reconciliationStatus,
          reconciliationNotes: booking.reconciliationNotes,
          createdAt: new Date(booking.createdAt),
          updatedAt: new Date(booking.updatedAt),
        },
        create: {
          id: booking.id,
          roomTypeId: booking.roomTypeId,
          eventTypeId: booking.eventTypeId,
          acMode: booking.acMode,
          status: booking.status,
          customerName: booking.customer.name,
          customerEmail: booking.customer.email,
          customerPhone: booking.customer.phone,
          customerPurpose: booking.customer.purpose,
          recurrenceFrequency: booking.recurrence.frequency,
          recurrenceEndDate: booking.recurrence.endDate ?? null,
          recurrenceOccurrences: booking.recurrence.occurrences ?? null,
          totalAmountLkr: booking.totalAmountLkr,
          reconciliationStatus: booking.reconciliationStatus,
          reconciliationNotes: booking.reconciliationNotes,
          createdAt: new Date(booking.createdAt),
          updatedAt: new Date(booking.updatedAt),
        },
      });

      await tx.bookingSlot.deleteMany({ where: { bookingId: booking.id } });
      await tx.bookingAmountBreakdown.deleteMany({ where: { bookingId: booking.id } });
      await tx.bookingOverride.deleteMany({ where: { bookingId: booking.id } });

      if ((booking.slots ?? []).length > 0) {
        await tx.bookingSlot.createMany({
          data: booking.slots.map((slot) => ({
            bookingId: booking.id,
            date: slot.date,
            startTime: slot.startTime,
            endTime: slot.endTime,
          })),
        });
      }

      if ((booking.amountBreakdown ?? []).length > 0) {
        await tx.bookingAmountBreakdown.createMany({
          data: booking.amountBreakdown.map((item) => ({
            bookingId: booking.id,
            date: item.date,
            slot: item.slot,
            amountLkr: item.amountLkr,
            dayType: item.dayType,
          })),
        });
      }

      if ((booking.overriddenBookingIds ?? []).length > 0) {
        await tx.bookingOverride.createMany({
          data: booking.overriddenBookingIds.map((overriddenBookingId) => ({
            bookingId: booking.id,
            overriddenBookingId,
          })),
        });
      }
    }

    for (const block of data.blocks ?? []) {
      await tx.calendarBlock.upsert({
        where: { id: block.id },
        update: {
          roomTypeId: block.roomTypeId,
          date: block.date,
          startTime: block.startTime,
          endTime: block.endTime,
          reason: block.reason,
          createdAt: new Date(block.createdAt),
        },
        create: {
          id: block.id,
          roomTypeId: block.roomTypeId,
          date: block.date,
          startTime: block.startTime,
          endTime: block.endTime,
          reason: block.reason,
          createdAt: new Date(block.createdAt),
        },
      });
    }
  });

  console.log("Calendar JSON migration completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
