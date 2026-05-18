# Unpaid-Booking Reminder System — Feature Spec

## Overview

Confirmed bookings that aren't fully paid get periodic reminder emails to both the customer and the admin until they're settled. Reminders fire on a fixed cadence anchored to the time the admin confirmed the booking: **24 h**, **7 d**, **30 d**, then every **+30 d** indefinitely. Sends stop automatically when the booking is paid, waived, or rejected/cancelled. A daily GitHub Actions cron hits a single protected API endpoint that scans for due reminders and dispatches the emails (per-booking to the customer, one digest to the admin per run).

## Layout / UX

No new UI in the app — this feature is purely backend + transactional email. Two email templates are added, matching the existing branded card pattern in `src/lib/email.ts`:

1. **Customer reminder** (one email per due booking):
   ```
   Subject: Payment Reminder — BK-XXXXXX (24 hours overdue)
   Body:
     Hi {customerName},
     Your booking BK-XXXXXX for {roomName} on {firstSlotDate} has an
     outstanding balance of LKR {balance}. (paid LKR {paid} of LKR {total})
     Please settle by replying to this email or contacting
     info@royalmasarena.lk.
     [card with booking details]
   ```
   Subject milestone label changes per stage: "24 hours overdue", "1 week overdue", "1 month overdue", "X months overdue" (X = floor(days/30)).

2. **Admin digest** (one email per cron run that produced any reminders):
   ```
   Subject: Unpaid Booking Reminders — N bookings — YYYY-MM-DD
   Body:
     The following N bookings hit a reminder milestone today:
     [table: Reference | Customer | Venue | Confirmed | Days Overdue | Balance LKR]
     Open admin portal → /admin/calendar/dashboard
   ```

## Data Model

Add two fields to `Booking` in `prisma/schema.prisma`:

| Field | Type | Purpose |
|---|---|---|
| `confirmedAt` | `DateTime?` | Set to `now()` the first time a booking transitions to `status: "confirmed"`. Once set, never overwritten (re-confirmation after a reject doesn't reset). The reminder clock anchor. |
| `lastReminderDays` | `Int?` | The milestone day-count of the most recent reminder sent (1, 7, 30, 60, 90, ...). NULL means no reminder sent yet. |

Indices:
```prisma
@@index([reconciliationStatus, confirmedAt])
```

Backfill: existing confirmed bookings get `confirmedAt = updatedAt` (closest available proxy) via the migration's data step.

The `lastReminderAt` timestamp isn't stored separately — `EmailLog` already records every send, and `lastReminderDays` is sufficient for idempotency.

## API Routes

### `POST /api/cron/unpaid-reminders`

**Auth**: shared-secret `Authorization: Bearer ${CRON_SECRET}` header. Reject 401 if missing or wrong. No NextAuth session required (cron has no user context).

**Body**: none.

**Response** (200):
```json
{
  "scannedBookings": 12,
  "remindersSent": 3,
  "adminDigestSent": true,
  "bookingsReminded": [
    { "reference": "BK-A1B2C3", "milestoneDays": 30, "customerEmailSent": true },
    ...
  ]
}
```

**Logic**:
1. Validate `Authorization: Bearer` header against `CRON_SECRET` env var. 401 if invalid.
2. Compute `now`.
3. Fetch all bookings where:
   - `confirmedAt IS NOT NULL`
   - `reconciliationStatus IN ("unpaid", "part_paid")`
   - `status NOT IN ("rejected", "cancelled_override")`
4. For each booking, derive **applicable milestone**:
   ```ts
   const daysSinceConfirm = Math.floor((now - confirmedAt) / 86_400_000);
   let milestone: number | null = null;
   if (daysSinceConfirm >= 1) milestone = 1;
   if (daysSinceConfirm >= 7) milestone = 7;
   if (daysSinceConfirm >= 30) milestone = 30 * Math.floor(daysSinceConfirm / 30);
   ```
   So at day 35 the milestone is 30; at day 65 it's 60; at day 95 it's 90.
5. Skip if `milestone === null` OR `lastReminderDays >= milestone`. Otherwise this booking is **due**.
6. For each due booking: send customer email via `sendBookingUnpaidReminder(...)`, update `lastReminderDays = milestone`. Use `prisma.$transaction` so the field write and the EmailLog row are atomic with each other (the email itself is fire-and-forget after `await`, per the existing pattern in `email.ts`).
7. After all customer emails, send **one** admin digest via `sendAdminUnpaidDigest(...)` listing every booking that was reminded.
8. Return summary.

### Cron trigger: `.github/workflows/unpaid-reminders.yml`

```yaml
name: Unpaid booking reminders
on:
  schedule:
    - cron: '30 0 * * *'   # 06:00 SL time (00:30 UTC, daily)
  workflow_dispatch:        # allow manual runs
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST "${{ secrets.SITE_URL }}/api/cron/unpaid-reminders" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

Secrets required in GitHub repo settings: `SITE_URL` (e.g. `https://royalmasarena.lk` or the Amplify URL), `CRON_SECRET` (random string, must match Amplify env var of same name).

## Confirmation hook (existing route)

Modify `PATCH /api/admin/calendar/bookings` so that when a booking transitions to `status: "confirmed"` AND `confirmedAt IS NULL`, set `confirmedAt = new Date()`. Don't overwrite if already set (re-confirmation after rejection retains the original anchor — or, alternatively, we can reset on re-confirm; this spec keeps it set-once for simplicity).

## Email helpers (additions to `src/lib/email.ts`)

```ts
export async function sendBookingUnpaidReminder(params: {
  to: string;
  customerName: string;
  reference: string;
  roomName: string;
  eventTypeName: string;
  slots: SlotList;
  totalAmountLkr: number;
  paidAmountLkr: number;
  daysOverdue: number;          // milestone (1, 7, 30, 60, 90, ...)
}): Promise<void>;

export async function sendAdminUnpaidDigest(params: {
  runDate: string;              // YYYY-MM-DD
  bookings: Array<{
    reference: string;
    customerName: string;
    customerEmail: string;
    roomName: string;
    confirmedAt: string;        // YYYY-MM-DD
    daysOverdue: number;
    balanceLkr: number;
  }>;
}): Promise<void>;
```

Add two values to the `EmailLogType` union in `email.ts`: `"unpaid_reminder_customer"` and `"unpaid_reminder_admin_digest"`. (The `EmailLog.type` Prisma column is a free-form string, no schema change required.)

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `CRON_SECRET` | Amplify console + GitHub secrets | Auth token for the cron endpoint |
| `_AMPLIFY_CRON_SECRET` | `next.config.ts` env bake | Make CRON_SECRET available to the Lambda |

`scripts/check-amplify-secret-leak.mjs` allowlists the cron route handler file.

`ADMIN_NOTIFICATION_EMAIL`, `RESEND_API_KEY`, `RESEND_FROM` — already configured. Digest is skipped silently if `ADMIN_NOTIFICATION_EMAIL` is unset.

## Acceptance Criteria

- [ ] AC-1: `Booking.confirmedAt` and `Booking.lastReminderDays` exist in Prisma schema. Migration is reversible and includes the `confirmedAt = updatedAt` backfill for existing confirmed bookings.
- [ ] AC-2: When an admin confirms a booking (`status` → `confirmed`) for the first time, `confirmedAt` is set to `now()`. Re-confirmation after an unconfirm/reconfirm cycle keeps the original value.
- [ ] AC-3: `POST /api/cron/unpaid-reminders` returns 401 without a valid `Authorization: Bearer ${CRON_SECRET}` header.
- [ ] AC-4: Cron endpoint with a valid header returns `200` with the JSON summary even when no reminders are due (`remindersSent: 0`).
- [ ] AC-5: For a booking confirmed 25 hours ago with reconciliation status `unpaid`, calling the cron endpoint sends one customer reminder (milestone `1`) and includes the booking in the admin digest.
- [ ] AC-6: Calling the cron endpoint a second time on the same booking the same day sends **no** additional reminders (`lastReminderDays = 1` blocks re-sending). The endpoint still returns 200.
- [ ] AC-7: A booking confirmed 8 days ago that has not yet received a reminder gets one customer email at milestone `7` on the next cron run, skipping the `1` milestone (only the highest applicable milestone is fired per run).
- [ ] AC-8: A booking confirmed 65 days ago gets the milestone `60` reminder; `lastReminderDays` becomes `60`. At day 95 the next milestone `90` fires.
- [ ] AC-9: When `reconciliationStatus` becomes `paid` or `waived`, subsequent cron runs do **not** send further reminders for that booking (regardless of `lastReminderDays`).
- [ ] AC-10: Bookings with effective status `rejected` or `cancelled_override` are excluded from the cron scan and never receive reminders.
- [ ] AC-11: Customer email subject line includes the milestone label ("24 hours overdue", "1 week overdue", "1 month overdue", "X months overdue" for milestones ≥ 60).
- [ ] AC-12: Customer email body shows balance = `totalAmountLkr − paidAmountLkr` and references the booking ID + slots.
- [ ] AC-13: Admin digest is sent **once** per cron run that produces any reminders. If `remindersSent === 0`, no digest is sent.
- [ ] AC-14: Every send writes a row to `EmailLog` with `type` set to `"unpaid_reminder_customer"` or `"unpaid_reminder_admin_digest"`, plus `status` (`"sent"` or `"failed"`).
- [ ] AC-15: `.github/workflows/unpaid-reminders.yml` exists, runs on schedule + `workflow_dispatch`, and `curl`s the endpoint with the Bearer header.
- [ ] AC-16: `npx tsc --noEmit` and `npm run lint` clean.

## Out of Scope

- **UI to view reminder history** — visible only via the EmailLog table or a query.
- **Admin opt-out / per-booking snooze** — no UI to suppress reminders for a specific booking; the only way to stop them is to set the booking to paid/waived/rejected/cancelled.
- **SMS reminders** — email only.
- **Configurable cadence per room or event type** — hardcoded `[1, 7, 30, +30]` for now.
- **Retry on send failure** — relies on the next daily cron run; the `lastReminderDays` field is only updated when the customer email is dispatched successfully (Resend returns 2xx).
- **Stop-after-N-months upper bound** — reminders continue indefinitely; cancelling the booking is the only way to stop them.
- **Pending / tentative bookings** — only `confirmed` bookings (with `confirmedAt` set) receive reminders. Pending bookings are still "in review" so chasing payment doesn't apply yet.
