-- Per-room booking cadence: allowed start times are RoomType.startTime + k × cadence.
-- Default 30 matches the previous fixed 30-minute step, so existing rooms behave
-- exactly as before. Existing bookings are not touched.
ALTER TABLE "RoomType" ADD COLUMN "bookingCadenceMinutes" INTEGER NOT NULL DEFAULT 30;
