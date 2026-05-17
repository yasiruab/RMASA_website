# Transactional Email Notifications — Feature Spec

## Overview

When a customer submits a booking request, they immediately receive an acknowledgement email confirming receipt and showing the total amount (for reference only — no payment prompt at this stage). When an admin makes a booking-level status decision (confirmed, tentative, or rejected), the customer receives a status notification email. Confirmed bookings include payment instructions. Admins receive an alert email whenever a new booking is submitted, so they do not need to monitor the portal manually.

All email send attempts (success and failure) are written to an `EmailLog` table in the database, including the full HTML body, for audit purposes.

## Layout / UX

No new UI is introduced. All emails are sent server-side. Email templates use a minimal branded HTML layout matching the public site palette (`#b26c5e` accent, white card, Lato font).

### Email types and subjects

| Trigger | Recipient | Subject |
|---|---|---|
| Booking submitted | Customer | `Booking Request Received – {reference}` |
| Admin bulk-confirms all slots | Customer | `Your Booking {reference} is Confirmed` |
| Admin bulk-confirms but some slots were already rejected | Customer | `Booking Update – {reference}` |
| Admin marks tentative | Customer | `Your Booking {reference} is On Hold` |
| Admin rejects | Customer | `Update on Your Booking {reference}` |
| Booking submitted | Admin | `New Booking Request – {reference}` |

### Content per email

- **Acknowledgement**: reference, venue, event type, date(s) & times, total amount labelled "indicative, pending confirmation" — **no payment prompt**
- **Confirmed (all slots)**: reference, venue, event type, slot list, amount due, **payment deadline (24 hours from send time, Sri Lanka Time)**, payment instructions
- **Confirmed (partial — some slots rejected)**: same as above, but intro reads "Some of your requested slots have been approved"; slot table shows every slot with its individual status (✓ Confirmed / On Hold / ✗ Not Available); amount is adjusted total for confirmed slots only
- **Tentative**: reference, "on hold" message, per-slot status table if per-slot actioning was used, contact info
- **Rejected**: reference, "unable to accommodate" message, per-slot status table if per-slot actioning was used, contact info
- **Admin alert**: customer name/email/phone, reference, venue, event type, date(s), total, link to admin portal

### Per-slot actioning trigger

When an admin actions individual slots one by one (rather than using a bulk status change), the status email fires automatically when the **last unactioned slot is resolved**. At that point:

- All slots are included in a per-slot status table rendered in the email
- Effective status is derived from the slot overrides: all active → that status; all rejected → `rejected`; mixed (some confirmed + some tentative) → no email (admin should use bulk change)
- Amount shown is the adjusted total for active (non-rejected) slots only

## Data Model

### New model: `EmailLog`

```prisma
model EmailLog {
  id               Int      @id @default(autoincrement())
  bookingReference String
  type             String   // "booking_acknowledgement" | "booking_status" | "admin_notification"
  toEmail          String
  fromEmail        String
  subject          String
  htmlBody         String
  status           String   // "sent" | "failed"
  errorMessage     String?
  createdAt        DateTime @default(now())

  @@index([bookingReference])
  @@index([createdAt])
}
```

No FK to `Booking` — logs survive booking deletion. `bookingReference` is denormalized.

Migration: `prisma/migrations/20260517005911_add_email_log/migration.sql`

## API Routes

No new routes. Existing routes updated:

### POST /api/calendar/bookings

After booking is persisted, fires (fire-and-forget):
- `sendBookingAcknowledgement` → customer
- `sendAdminNewBookingNotification` → `ADMIN_NOTIFICATION_EMAIL` (skipped if env var unset)

### PATCH /api/admin/calendar/bookings

Two code paths — both fire `sendBookingStatusNotification` → customer:

1. **Booking-level status change** (`payload.status` set): fires immediately for `confirmed`, `tentative`, or `rejected`
2. **Per-slot status update** (`payload.slotDate` + `payload.slotStartTime` + `payload.slotStatus`): fires when this update resolves the last unactioned slot (transition from partial → all-actioned), if the derived effective status is `confirmed`, `tentative`, or `rejected`

## New Files

| File | Purpose |
|---|---|
| `src/lib/email.ts` | Resend client, `sendEmail()` internal helper with `EmailLog` persistence, 3 exported send functions |

## Environment Variables

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key (server-only) |
| `RESEND_FROM` | From address; use `onboarding@resend.dev` until domain verified |
| `ADMIN_NOTIFICATION_EMAIL` | Admin inbox for new-booking alerts; omit to disable |

## Acceptance Criteria

- [x] AC-1: Customer receives acknowledgement email immediately after booking submission — contains reference, room, event type, slot date(s) & times, total amount; no payment prompt
- [x] AC-2: Admin receives notification email on new booking — contains customer name, email, phone, reference, room, event type, slot date(s), total amount
- [x] AC-3: Customer receives "confirmed" email when admin sets booking to `confirmed` — contains reference, room, event type, slot date(s) & times, total amount, and payment instructions
- [x] AC-4: Customer receives "rejected" email when admin sets booking to `rejected`
- [x] AC-5: Customer receives "on hold" email when admin sets booking to `tentative`
- [x] AC-6: Per-slot status changes trigger a customer email only when the final unactioned slot is resolved; the email shows a per-slot status table for all slots
- [x] AC-7: Every email send attempt (success or failure) is written to `EmailLog` with: `bookingReference`, `type`, `toEmail`, `fromEmail`, `subject`, `htmlBody`, `status` (`sent`/`failed`), `errorMessage` (if failed), `createdAt`
- [x] AC-8: Email delivery failure never causes the booking creation or status update API to return an error — the booking operation always succeeds regardless of email outcome
- [x] AC-9: `ADMIN_NOTIFICATION_EMAIL` missing → admin notification silently skipped; customer email and logging still work
- [x] AC-10: `RESEND_API_KEY` missing → Resend throws, error caught, `EmailLog` entry written with `status: "failed"`; booking flow unaffected
- [x] AC-11: `npx tsc --noEmit` and `npm run lint` pass clean

## Out of Scope

- Admin UI for viewing `EmailLog` records (accessible via DB)
- Admin UI for viewing `EmailLog` records (accessible via DB)
- Email resend / retry mechanism
- Resend domain verification steps (done in Resend dashboard)
- Email on `cancelled_override` status
- Mixed per-slot actioning email (some confirmed + some tentative — admin should use bulk change)
