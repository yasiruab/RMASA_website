/*
  Warnings:

  - You are about to drop the column `recurrenceEndDate` on the `Booking` table.
    Will drop 0 non-null values (per `prisma migrate dev --create-only` check).
  - You are about to drop the column `recurrenceFrequency` on the `Booking` table.
    Will drop 6 non-null values.
  - You are about to drop the column `recurrenceOccurrences` on the `Booking` table.
    Will drop 1 non-null value.

  Recurrence was a creation-time concept only — the expanded BookingSlot rows
  are the post-creation source of truth. No application code reads these
  columns from a loaded booking. See conversation log for the grep that
  confirmed zero post-creation consumers.
*/
-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "recurrenceEndDate",
DROP COLUMN "recurrenceFrequency",
DROP COLUMN "recurrenceOccurrences";

-- DropEnum
DROP TYPE "RecurrenceFrequency";
