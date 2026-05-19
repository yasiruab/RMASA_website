-- Add reminder-tracking columns
ALTER TABLE "Booking" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "lastReminderDays" INTEGER;

-- Backfill confirmedAt for existing confirmed bookings using updatedAt as the closest available proxy
UPDATE "Booking" SET "confirmedAt" = "updatedAt" WHERE "status" = 'confirmed' AND "confirmedAt" IS NULL;

-- Index supporting the cron scan: WHERE reconciliationStatus IN (...) AND confirmedAt IS NOT NULL
CREATE INDEX "Booking_reconciliationStatus_confirmedAt_idx" ON "Booking"("reconciliationStatus", "confirmedAt");
