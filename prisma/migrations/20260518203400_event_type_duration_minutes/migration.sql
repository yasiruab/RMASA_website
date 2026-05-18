-- Add new minutes column with default 0 so the NOT NULL constraint is safe before backfill
ALTER TABLE "EventType" ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 0;

-- Backfill from hours
UPDATE "EventType" SET "durationMinutes" = "durationHours" * 60;

-- Drop the old hours column
ALTER TABLE "EventType" DROP COLUMN "durationHours";

-- Drop the placeholder default; the application supplies the value going forward
ALTER TABLE "EventType" ALTER COLUMN "durationMinutes" DROP DEFAULT;
