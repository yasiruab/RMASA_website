-- Legacy CSV → Neon import. Run interactively in psql against the direct
-- (unpooled) connection. Companion to scripts/migrate-legacy-csv.mjs.
--
-- This file is a TEMPLATE. The four \copy lines reference __CSV_DIR__,
-- which you sed-substitute per-room before piping to psql:
--
--   # Main Arena:
--   sed 's|__CSV_DIR__|db-migration/main-arena/out|g' \
--       scripts/migrate-legacy-csv.sql | psql "$DIRECT_URL"
--
--   # Studio Room:
--   sed 's|__CSV_DIR__|db-migration/studio-room/out|g' \
--       scripts/migrate-legacy-csv.sql | psql "$DIRECT_URL"
--
-- Workflow:
--   1. Run the .mjs transform first for the room you're importing.
--   2. Read this file end-to-end and make sure you understand the sanity
--      checks below (they run inside the transaction, so a bad result is
--      recoverable via ROLLBACK).
--   3. The trailing line of this file is ROLLBACK; — that means a first
--      `sed | psql` run prints all sanity-check output but commits nothing.
--      Once the output looks right, change ROLLBACK to COMMIT and re-run.
--
-- Everything runs inside a single transaction. Nothing is committed until the
-- final COMMIT at the bottom.

\set ON_ERROR_STOP on

BEGIN;

-- ---------- 1. Staging tables (TEXT-only, no constraints) ----------
CREATE TEMP TABLE stage_bookings (
  id                       TEXT,
  reference                TEXT,
  "roomTypeId"             TEXT,
  "eventTypeId"            TEXT,
  "acMode"                 TEXT,
  status                   TEXT,
  "customerName"           TEXT,
  "customerEmail"          TEXT,
  "customerPhone"          TEXT,
  "customerPurpose"        TEXT,
  "cleanupDurationMinutes" TEXT,
  "totalAmountLkr"         TEXT,
  "paidAmountLkr"          TEXT,
  "reconciliationStatus"   TEXT,
  "reconciliationNotes"    TEXT,
  "rejectReason"           TEXT,
  "confirmedAt"            TEXT,
  "lastReminderDays"       TEXT,
  "createdAt"              TEXT,
  "updatedAt"              TEXT
);

CREATE TEMP TABLE stage_booking_slots (
  "bookingId"   TEXT,
  date          TEXT,
  "startTime"   TEXT,
  "endTime"     TEXT,
  "slotStatus"  TEXT,
  "rejectReason" TEXT
);

CREATE TEMP TABLE stage_breakdown (
  "bookingId" TEXT,
  date        TEXT,
  slot        TEXT,
  "amountLkr" TEXT,
  "dayType"   TEXT
);

CREATE TEMP TABLE stage_payments (
  "bookingId" TEXT,
  type        TEXT,
  date        TEXT,
  "amountLkr" TEXT,
  "receiptNo" TEXT,
  notes       TEXT,
  "createdAt" TEXT,
  "createdBy" TEXT
);

-- ---------- 2. \copy from generated CSVs (paths relative to psql cwd) ----------
\copy stage_bookings        FROM '__CSV_DIR__/bookings.csv'          CSV HEADER
\copy stage_booking_slots   FROM '__CSV_DIR__/booking-slots.csv'     CSV HEADER
\copy stage_breakdown       FROM '__CSV_DIR__/booking-breakdown.csv' CSV HEADER
\copy stage_payments        FROM '__CSV_DIR__/payment-entries.csv'   CSV HEADER

-- ---------- 3. Sanity checks (each should print 0 rows) ----------
\echo
\echo '--- duplicate references within batch (expect 0) ---'
SELECT reference, COUNT(*) FROM stage_bookings GROUP BY reference HAVING COUNT(*) > 1;

\echo '--- references already in live "Booking" table (expect 0) ---'
SELECT s.reference
  FROM stage_bookings s
  JOIN "Booking" b ON b.reference = s.reference;

\echo '--- orphan slots (bookingId not in stage_bookings; expect 0) ---'
SELECT bs."bookingId"
  FROM stage_booking_slots bs
  LEFT JOIN stage_bookings b ON b.id = bs."bookingId"
  WHERE b.id IS NULL;

\echo '--- orphan breakdowns (expect 0) ---'
SELECT br."bookingId"
  FROM stage_breakdown br
  LEFT JOIN stage_bookings b ON b.id = br."bookingId"
  WHERE b.id IS NULL;

\echo '--- orphan payments (expect 0) ---'
SELECT p."bookingId"
  FROM stage_payments p
  LEFT JOIN stage_bookings b ON b.id = p."bookingId"
  WHERE b.id IS NULL;

\echo '--- unmapped roomTypeId (expect 0) ---'
SELECT DISTINCT s."roomTypeId"
  FROM stage_bookings s
  LEFT JOIN "RoomType" r ON r.id = s."roomTypeId"
  WHERE r.id IS NULL;

\echo '--- unmapped eventTypeId (expect 0) ---'
SELECT DISTINCT s."eventTypeId"
  FROM stage_bookings s
  LEFT JOIN "EventType" e ON e.id = s."eventTypeId"
  WHERE e.id IS NULL;

\echo '--- per-slot amount sum vs booking total (expect 0 rows with mismatch) ---'
SELECT s.id, s.reference,
       s."totalAmountLkr"::INT AS booking_total,
       COALESCE(SUM(br."amountLkr"::INT), 0) AS sum_breakdown
  FROM stage_bookings s
  LEFT JOIN stage_breakdown br ON br."bookingId" = s.id
  GROUP BY s.id, s.reference, s."totalAmountLkr"
  HAVING s."totalAmountLkr"::INT <> COALESCE(SUM(br."amountLkr"::INT), 0);

\echo '--- pre-insert row counts ---'
SELECT 'bookings'   AS table, COUNT(*) FROM stage_bookings
UNION ALL SELECT 'slots',      COUNT(*) FROM stage_booking_slots
UNION ALL SELECT 'breakdown',  COUNT(*) FROM stage_breakdown
UNION ALL SELECT 'payments',   COUNT(*) FROM stage_payments;

-- ---------- 4. INSERT … SELECT, parents first ----------
INSERT INTO "Booking" (
  id, reference, "roomTypeId", "eventTypeId", "acMode", status,
  "customerName", "customerEmail", "customerPhone", "customerPurpose",
  "cleanupDurationMinutes", "totalAmountLkr", "paidAmountLkr",
  "reconciliationStatus", "reconciliationNotes", "rejectReason",
  "confirmedAt", "lastReminderDays", "createdAt", "updatedAt"
)
SELECT
  id,
  reference,
  "roomTypeId",
  "eventTypeId",
  "acMode"::"AcMode",
  status::"BookingStatus",
  "customerName",
  "customerEmail",
  "customerPhone",
  "customerPurpose",
  "cleanupDurationMinutes"::INT,
  "totalAmountLkr"::INT,
  "paidAmountLkr"::INT,
  "reconciliationStatus"::"ReconciliationStatus",
  "reconciliationNotes",
  NULLIF("rejectReason", ''),
  NULLIF("confirmedAt", '')::TIMESTAMPTZ,
  NULLIF("lastReminderDays", '')::INT,
  "createdAt"::TIMESTAMPTZ,
  "updatedAt"::TIMESTAMPTZ
FROM stage_bookings;

INSERT INTO "BookingSlot" (
  "bookingId", date, "startTime", "endTime", "slotStatus", "rejectReason"
)
SELECT
  "bookingId",
  date,
  "startTime",
  "endTime",
  NULLIF("slotStatus", '')::"BookingStatus",
  NULLIF("rejectReason", '')
FROM stage_booking_slots;

INSERT INTO "BookingAmountBreakdown" (
  "bookingId", date, slot, "amountLkr", "dayType"
)
SELECT
  "bookingId",
  date,
  slot,
  "amountLkr"::INT,
  "dayType"::"DayType"
FROM stage_breakdown;

INSERT INTO "PaymentEntry" (
  "bookingId", type, date, "amountLkr", "receiptNo", notes, "createdAt", "createdBy"
)
SELECT
  "bookingId",
  type,
  date,
  "amountLkr"::INT,
  COALESCE("receiptNo", ''),  -- psql \copy reads empty CSV field as NULL; col is NOT NULL DEFAULT ''
  notes,
  "createdAt"::TIMESTAMPTZ,
  "createdBy"
FROM stage_payments;

-- ---------- 5. Post-insert cross-checks ----------
\echo
\echo '--- imported booking counts by status ---'
SELECT status, COUNT(*) FROM "Booking"
  WHERE "reconciliationNotes" = 'Imported from legacy CSV'
  GROUP BY status;

\echo '--- imported total amount (confirmed only) ---'
SELECT SUM("totalAmountLkr") AS confirmed_total
  FROM "Booking"
  WHERE "reconciliationNotes" = 'Imported from legacy CSV'
    AND status = 'confirmed';

\echo '--- imported PaymentEntry sum should equal confirmed_total above ---'
SELECT SUM(p."amountLkr") AS payment_total
  FROM "PaymentEntry" p
  JOIN "Booking" b ON b.id = p."bookingId"
  WHERE b."reconciliationNotes" = 'Imported from legacy CSV'
    AND p.notes = 'Historical import 2022-2026 — marked as paid';

\echo '--- any imported confirmed booking with no slots (expect 0) ---'
SELECT b.id
  FROM "Booking" b
  WHERE b."reconciliationNotes" = 'Imported from legacy CSV'
    AND b.status = 'confirmed'
    AND NOT EXISTS (SELECT 1 FROM "BookingSlot" s WHERE s."bookingId" = b.id);

-- ---------- 6. Commit (uncomment after reviewing the output above) ----------
-- COMMIT;
ROLLBACK;
