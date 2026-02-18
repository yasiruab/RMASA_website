import { prisma } from "@/lib/prisma";
import { CalendarDb } from "@/lib/calendar-types";

function toIso(value: Date) {
  return value.toISOString();
}

export async function readCalendarDb(): Promise<CalendarDb> {
  const [rooms, eventTypes, pricingRules, bookings, blocks] = await prisma.$transaction([
    prisma.roomType.findMany(),
    prisma.eventType.findMany(),
    prisma.pricingRule.findMany(),
    prisma.booking.findMany({
      include: {
        slots: true,
        amountBreakdown: true,
        overriddenTargets: true,
      },
    }),
    prisma.calendarBlock.findMany(),
  ]);

  return {
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      workingHours: {
        startTime: room.startTime,
        endTime: room.endTime,
      },
    })),
    eventTypes: eventTypes.map((eventType) => ({
      id: eventType.id,
      name: eventType.name,
      durationHours: eventType.durationHours,
      priority: eventType.priority,
      roomTypeId: eventType.roomTypeId ?? undefined,
    })),
    pricingRules: pricingRules.map((rule) => ({
      id: rule.id,
      roomTypeId: rule.roomTypeId,
      eventTypeId: rule.eventTypeId,
      acMode: rule.acMode,
      dayType: rule.dayType,
      amountLkr: rule.amountLkr,
    })),
    bookings: bookings.map((booking) => ({
      id: booking.id,
      roomTypeId: booking.roomTypeId,
      eventTypeId: booking.eventTypeId,
      acMode: booking.acMode,
      status: booking.status,
      slots: booking.slots.map((slot) => ({
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
      })),
      customer: {
        name: booking.customerName,
        email: booking.customerEmail,
        phone: booking.customerPhone,
        purpose: booking.customerPurpose,
      },
      recurrence: {
        frequency: booking.recurrenceFrequency,
        endDate: booking.recurrenceEndDate ?? undefined,
        occurrences: booking.recurrenceOccurrences ?? undefined,
      },
      totalAmountLkr: booking.totalAmountLkr,
      amountBreakdown: booking.amountBreakdown.map((item) => ({
        date: item.date,
        slot: item.slot,
        amountLkr: item.amountLkr,
        dayType: item.dayType,
      })),
      reconciliationStatus: booking.reconciliationStatus,
      reconciliationNotes: booking.reconciliationNotes,
      createdAt: toIso(booking.createdAt),
      updatedAt: toIso(booking.updatedAt),
      overriddenBookingIds: booking.overriddenTargets.map((item) => item.overriddenBookingId),
    })),
    blocks: blocks.map((block) => ({
      id: block.id,
      roomTypeId: block.roomTypeId,
      date: block.date,
      startTime: block.startTime,
      endTime: block.endTime,
      reason: block.reason,
      createdAt: toIso(block.createdAt),
    })),
  };
}

export async function updateCalendarDb(mutator: (current: CalendarDb) => CalendarDb | Promise<CalendarDb>) {
  const current = await readCalendarDb();
  const next = await mutator(current);

  await prisma.$transaction(async (tx) => {
    await tx.bookingOverride.deleteMany();
    await tx.bookingAmountBreakdown.deleteMany();
    await tx.bookingSlot.deleteMany();
    await tx.booking.deleteMany();
    await tx.calendarBlock.deleteMany();
    await tx.pricingRule.deleteMany();
    await tx.eventType.deleteMany();
    await tx.roomType.deleteMany();

    for (const room of next.rooms) {
      await tx.roomType.create({
        data: {
          id: room.id,
          name: room.name,
          startTime: room.workingHours.startTime,
          endTime: room.workingHours.endTime,
        },
      });
    }

    for (const eventType of next.eventTypes) {
      await tx.eventType.create({
        data: {
          id: eventType.id,
          name: eventType.name,
          durationHours: eventType.durationHours,
          priority: eventType.priority,
          roomTypeId: eventType.roomTypeId ?? null,
        },
      });
    }

    for (const rule of next.pricingRules) {
      await tx.pricingRule.create({
        data: {
          id: rule.id,
          roomTypeId: rule.roomTypeId,
          eventTypeId: rule.eventTypeId,
          acMode: rule.acMode,
          dayType: rule.dayType,
          amountLkr: rule.amountLkr,
        },
      });
    }

    for (const booking of next.bookings) {
      await tx.booking.create({
        data: {
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

      if (booking.slots.length > 0) {
        await tx.bookingSlot.createMany({
          data: booking.slots.map((slot) => ({
            bookingId: booking.id,
            date: slot.date,
            startTime: slot.startTime,
            endTime: slot.endTime,
          })),
        });
      }

      if (booking.amountBreakdown.length > 0) {
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

      if (booking.overriddenBookingIds.length > 0) {
        await tx.bookingOverride.createMany({
          data: booking.overriddenBookingIds.map((overriddenBookingId) => ({
            bookingId: booking.id,
            overriddenBookingId,
          })),
        });
      }
    }

    for (const block of next.blocks) {
      await tx.calendarBlock.create({
        data: {
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
}
