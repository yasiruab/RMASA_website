# RMASA Website — Developer Notes

## Tech Stack

Next.js 15 App Router · Prisma v6 · PostgreSQL · NextAuth · Tailwind (admin) · CSS custom properties (public)

## Key File Locations

| What | Where |
|---|---|
| Public pages | `src/app/<route>/page.tsx` |
| Admin pages | `src/app/admin/<route>/page.tsx` |
| API routes | `src/app/api/<route>/route.ts` |
| Admin component | `src/components/admin/admin-calendar-console.tsx` |
| Calendar business logic | `src/lib/calendar-core.ts` |
| Calendar data access | `src/lib/calendar-store.ts` |
| Calendar TypeScript types | `src/lib/calendar-types.ts` |
| Prisma client | `src/lib/prisma.ts` |
| Auth guards | `src/lib/auth-guards.ts` |
| Audit logging | `src/lib/audit.ts` |
| DB schema | `prisma/schema.prisma` |

## Calendar Data Model

### Booking

Key fields:
- `id` — UUID (internal)
- `reference` — `BK-XXXXXX` human-readable ID, generated at creation via `randomBytes(3).toString('hex').toUpperCase()`
- `status` — `pending | confirmed | tentative | rejected | cancelled_override`
- `totalAmountLkr` — total invoice amount (immutable after creation)
- `paidAmountLkr` — **cached** net collected amount, derived from `PaymentEntry` ledger; do not mutate directly
- `reconciliationStatus` — **cached** derived status: `unpaid | part_paid | paid | waived`; recomputed by the payment entry POST endpoint; "waived" is a legacy value only

### PaymentEntry (immutable ledger)

Each booking has an append-only `PaymentEntry[]`. Entries are never deleted or edited — corrections are new offsetting entries.

| Field | Description |
|---|---|
| `type` | `payment` (+ collected) · `refund` (− collected) · `credit_note` (− outstanding, no cash) |
| `date` | YYYY-MM-DD, admin-supplied |
| `amountLkr` | Always positive; direction from `type` |
| `receiptNo` | Optional; empty string if absent |
| `notes` | Required |
| `createdBy` | Admin email (server-set) |

**Net collected** = Σ(payment.amountLkr) − Σ(refund.amountLkr) − Σ(credit_note.amountLkr)

Derived `reconciliationStatus`:
- net = 0 → `unpaid`
- 0 < net < total → `part_paid`
- net ≥ total → `paid`

### Adding a payment entry

`POST /api/admin/calendar/bookings/[id]/payments`  
Body: `{ type, date, amountLkr, receiptNo?, notes }`  
Auth: `requireAdmin()`  
This endpoint writes directly to Prisma (not through `updateCalendarDb`) and atomically updates the booking's cached `paidAmountLkr` + `reconciliationStatus`.

### Data access pattern (`calendar-store.ts`)

`updateCalendarDb(mutator)` does a full delete-and-recreate of ALL tables in a transaction. Delete order matters for FK constraints:

```
bookingOverride → bookingAmountBreakdown → bookingSlot → paymentEntry → booking → calendarBlock → pricingRule → eventType → roomType
```

`paymentEntry` must be deleted before `booking` (FK) and recreated after `booking`.

## Auth

- Admin roles: `admin | super_admin`
- Use `requireAdmin()` from `src/lib/auth-guards.ts` in all admin API routes
- Super-admin-only features guarded by `requireSuperAdmin()`
- **Hybrid identity**: AWS Cognito holds password + email-OTP MFA + lockout; Postgres `User`
  holds role + `active`. The NextAuth `signIn` callback in `src/lib/auth.ts` rejects logins for
  emails not present in Postgres or where `active === false`.
- **Adding an admin** is a two-step process: create the Postgres `User` row via the website
  (Admin Accounts page), then create the matching Cognito user in the AWS console. See
  `docs/deployment.md` § Admin Auth.
- **`cognitoSub`** on `User` is backfilled on first successful sign-in (don't set it manually).

## Enum Values

- Booking status: `pending | confirmed | tentative | rejected | cancelled_override`
- Reconciliation status: `unpaid | part_paid | paid | waived` (waived is legacy only going forward)
- AC mode: `with_ac | without_ac`
- Day type: `weekday | weekend | any`
