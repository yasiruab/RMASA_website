-- Step 1: Add reference column WITHOUT unique constraint (allows all existing rows to default to '')
ALTER TABLE "Booking" ADD COLUMN "reference" TEXT NOT NULL DEFAULT '';

-- Step 2: Create PaymentEntry table
CREATE TABLE "PaymentEntry" (
    "id" SERIAL NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amountLkr" INTEGER NOT NULL,
    "receiptNo" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "PaymentEntry_pkey" PRIMARY KEY ("id")
);

-- Step 3: Index on PaymentEntry.bookingId
CREATE INDEX "PaymentEntry_bookingId_idx" ON "PaymentEntry"("bookingId");

-- Step 4: Foreign key from PaymentEntry to Booking
ALTER TABLE "PaymentEntry" ADD CONSTRAINT "PaymentEntry_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 5: Backfill unique references for all existing bookings
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  rec RECORD;
  candidate TEXT;
  collision BOOLEAN;
BEGIN
  FOR rec IN SELECT id FROM "Booking" WHERE reference = '' LOOP
    LOOP
      candidate := 'BK-' || upper(encode(gen_random_bytes(3), 'hex'));
      SELECT EXISTS(SELECT 1 FROM "Booking" WHERE reference = candidate) INTO collision;
      EXIT WHEN NOT collision;
    END LOOP;
    UPDATE "Booking" SET reference = candidate WHERE id = rec.id;
  END LOOP;
END $$;

-- Step 6: Migrate existing paidAmountLkr > 0 into a single legacy PaymentEntry per booking
INSERT INTO "PaymentEntry" ("bookingId", "type", "date", "amountLkr", "receiptNo", "notes", "createdBy")
SELECT
  b.id,
  'payment',
  to_char(b."createdAt", 'YYYY-MM-DD'),
  b."paidAmountLkr",
  '',
  'Migrated from legacy payment record',
  'system:migration'
FROM "Booking" b
WHERE b."paidAmountLkr" > 0;

-- Step 7: Now safe to add the unique constraint (all references are populated and distinct)
CREATE UNIQUE INDEX "Booking_reference_key" ON "Booking"("reference");
