-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cleanupDurationMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "EventType" ADD COLUMN     "cleanupDurationMinutes" INTEGER NOT NULL DEFAULT 0;
