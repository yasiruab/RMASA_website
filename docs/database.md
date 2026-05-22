# Database schema

Source of truth: [`prisma/schema.prisma`](../prisma/schema.prisma). This document
explains what each table is for, which application code reads / writes it,
and flags tables that exist but are no longer used.

**Host**: Neon Serverless Postgres (`aws-ap-southeast-1`). Two connection
strings — pooled (`DATABASE_URL`, runtime) and direct (`DIRECT_URL`,
`prisma migrate deploy`). Migrated from Aurora Serverless v2 in May 2026.

## Date / time storage convention

Two distinct shapes, by intent:

| Pattern | Examples | Postgres type |
|---|---|---|
| Business-semantic dates / times — "when does the booking happen?" | `BookingSlot.date` (`"2026-05-20"`), `BookingSlot.startTime` / `endTime` (`"07:00"`), `CalendarBlock.date`, `BookingAmountBreakdown.date` / `slot`, `PaymentEntry.date` | **`text`** (Prisma `String`) |
| System event timestamps — "when did this row happen?" | `Booking.createdAt` / `updatedAt` / `confirmedAt`, `EmailLog.createdAt`, `AuditLog.createdAt`, `PaymentEntry.createdAt` | **`timestamp with time zone`** (Prisma `DateTime`) |

A booking slot is "May 20, 7:00 AM **in Colombo**" — independent of any
viewer's local timezone. If we stored these as `DATE` / `TIMESTAMP`, every
read would round-trip through JavaScript's `Date`, which is TZ-aware and
will silently shift values when the runtime or the viewer is not in
Asia/Colombo. The whole calendar logic already keys slots by
`"YYYY-MM-DD|HH:mm"` strings (see [`src/lib/calendar-store.ts`](../src/lib/calendar-store.ts),
[`src/lib/admin/booking-utils.ts`](../src/lib/admin/booking-utils.ts),
`computeSlotAllocations()`), so keeping them as strings end-to-end means
zero conversion and zero TZ bugs.

ISO 8601 (`YYYY-MM-DD`) sorts lexicographically the same as
chronologically, so `WHERE slot.date >= from` works correctly on the string
column and indexes on `(date)` are still useful.

System timestamps (`createdAt` etc.) are real points in absolute time —
TZ-aware comparison is what you want for "what's the newest audit row?",
so those stay `DateTime`.

**Tradeoff**: Postgres won't reject `BookingSlot.date = 'banana'`. Input
validation is the app's responsibility (Zod / regex / Prisma typing all
handle this at the API boundary). A direct DB write that bypasses the app
could insert garbage — accepted in exchange for the TZ-safety benefit.

## Table summary

| Table | Status | Purpose |
|---|---|---|
| `_prisma_migrations` | system | Prisma migration history — managed by `prisma migrate`, never touched by app code |
| `User` | **used** | Admin identity + role + active flag (Postgres-side complement to Cognito) |
| `RoomType` | **used** | Bookable venues (Main Arena, Studio Room, etc.) |
| `EventType` | **used** | Sport / event categories with duration, cleanup, priority, advance-booking limits |
| `PricingRule` | **used** | Per (room, event, AC mode, day type) price |
| `Booking` | **used** | Top-level booking record + cached payment totals |
| `BookingSlot` | **used** | Per-slot date + time + optional per-slot status override |
| `BookingAmountBreakdown` | **used** | Per-slot amount applied at creation; immutable record of the original quote |
| `BookingOverride` | **used** | Records which existing bookings were cascaded to `cancelled_override` when a higher-priority booking was confirmed over them |
| `PaymentEntry` | **used** | Immutable ledger — `payment` / `refund` / `waiver` / `credit_note` |
| `CalendarBlock` | **used** | Admin-defined unavailability ranges |
| `AuditLog` | **used** | Append-only audit trail of admin actions |
| `EmailLog` | **used** | One row per outbound transactional email (success or failure) |

## Used tables — detail

### User

Postgres holds the **role + active** for each admin; AWS Cognito holds the
password + lockout state. The NextAuth `signIn` callback rejects login for
emails not present here, or where `active = false`.

| Column | Used? | Notes |
|---|---|---|
| `id`, `email`, `role`, `active`, `createdAt`, `updatedAt` | yes | |
| `cognitoSub` | yes | Backfilled on first successful Cognito sign-in |
| `name` | partial | Displayed in admin Accounts page; only set by `scripts/seed-super-admin.mjs` for the super-admin row. Nullable; new admins added via UI never get a name. |
| `passwordHash` | **legacy** | Pre-Cognito column. Never read by current code; safe to drop in a future migration. |
| `emailVerified`, `image` | **unused** | NextAuth-adapter columns. Never read or written by current code. |

Relations: `auditLogs[]` — populated by `AuditLog.actorUserId`.

### RoomType

Capacity + description are admin-editable in the Room Types editor and shown
on the public bookings room cards. Working hours (`startTime` / `endTime`)
constrain slot generation in `calendar-core.ts`.

Writes: `replaceCalendarConfig()` in `src/lib/calendar-store.ts` (wipe + recreate
scoped to room/event-type/pricing only).

### EventType

`durationMinutes` (1–1440), `cleanupDurationMinutes` (0–480), `maxAdvanceBookingDays`
(0–3650, default 365), `priority`. Optional `roomTypeId` ties this event type
to one room; null = available to any room.

Writes: same path as `RoomType`.

### PricingRule

Index: `(roomTypeId, eventTypeId, acMode, dayType)` — supports the per-rule
lookup that powers the public bookings receipt + admin revenue model.

### Booking

The top-level booking record. Cached fields:

- `totalAmountLkr` — immutable after creation. Reflects the original quote.
  Slots rejected later **do not reduce this**.
- `paidAmountLkr` — cached `Σ payment − Σ refund`. Recomputed by the
  payment-entry POST endpoint.
- `reconciliationStatus` — derived from `paidAmountLkr` vs `amountDue`;
  recomputed alongside `paidAmountLkr`.

**Hard rule**: never compute "what does the customer owe?" from
`totalAmountLkr` directly. Use `activeBookingTotalLkr()` from
`src/lib/admin/booking-utils.ts` — it sums `amountBreakdown` only for
non-rejected slots.

Reminder cadence anchor:
- `confirmedAt` — stamped once on first confirmation (set-once).
- `lastReminderDays` — largest reminder milestone already sent (1, 7, 30,
  60, 90, …); the cron skips milestones already covered.

Indexes:
- `(status)` — list filters
- `(createdAt)` — chronological scans
- `(reconciliationStatus, confirmedAt)` — covers the daily unpaid-reminder cron's filter prefix

### BookingSlot

One row per slot. `slotStatus` is nullable — null means "inherit
`booking.status`". When admins approve / reject individual slots, the
slot-level override is stored here. `rejectReason` carries the per-slot
rejection note (separate from the booking-level `Booking.rejectReason`).

Cascade-deleted with the parent booking.

### BookingAmountBreakdown

One row per slot per booking, recording the price applied at booking
creation. **Immutable** record of the original quote — the source of truth
for "how much was this slot priced at?" used by the per-slot payment
allocation in `computeSlotAllocations()`.

Cascade-deleted with the parent booking.

### BookingOverride

When a higher-priority booking is confirmed over an existing lower-priority
one, the older bookings get `status = cancelled_override` and a row here
records the mapping. Lets the admin trace "why did this booking get
cancelled?" back to the booking that displaced it.

Cascade-deleted with the parent (overriding) booking.

### PaymentEntry

**Immutable ledger.** Entries are never updated or deleted — corrections are
new offsetting entries. Types: `payment` (+cash), `refund` (−cash),
`waiver` (−amount due, no cash), `credit_note` (−amount due, no cash).

Index: `(bookingId)`.

### CalendarBlock

Admin-defined unavailability ranges. Used in conflict detection alongside
existing bookings.

Index: `(date, roomTypeId)` — supports the per-day per-room availability scan.

### AuditLog

Append-only audit trail of admin actions. Populated by `logAuditEvent()` in
`src/lib/audit.ts`. The hub page reads the most recent rows for the "Recent
activity" section.

Indexes: `(createdAt)`, `(action)`.

### EmailLog

One row per outbound transactional email — written by every send in
`src/lib/email.ts`, success or failure. `bookingReference` is a denormalised
string (no FK) so logs survive booking deletion. `htmlBody` is the full
rendered HTML; treat as sensitive — every user-supplied interpolation in
`email.ts` must go through the `esc()` helper before rendering.

Indexes: `(bookingReference)`, `(createdAt)`.

## Removed tables

`Account`, `Session`, `VerificationToken` were dropped in migration
`20260521032505_drop_unused_nextauth_tables`. They existed from when
NextAuth was configured with the Prisma DB-adapter strategy; the project
moved to the JWT session strategy + AWS Cognito IdP and the tables had
never received writes since. If NextAuth DB sessions or account-linking
are ever needed again, restore them by adding the models back to
`schema.prisma` and running a new migration — no application code change
is required.

## Documenting changes

When changing the schema:

1. Edit [`prisma/schema.prisma`](../prisma/schema.prisma).
2. `npm run db:generate && npm run db:migrate -- --name <descriptive-name>`.
3. Update this document — at minimum the table summary row and any
   "Hard rule" callouts whose invariants changed.
4. Update [CLAUDE.md](../CLAUDE.md) if the change affects file locations,
   data shapes, or conventions other code depends on.
