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
| Transactional email | `src/lib/email.ts` |
| DB schema | `prisma/schema.prisma` |

## Calendar Data Model

### Booking

Key fields:
- `id` — UUID (internal)
- `reference` — `BK-XXXXXX` human-readable ID, generated at creation via `randomBytes(3).toString('hex').toUpperCase()`
- `status` — `pending | confirmed | tentative | rejected | cancelled_override`
- `cleanupDurationMinutes` — **snapshot** of the EventType's `cleanupDurationMinutes` at booking creation; immutable per booking; used in conflict detection so past bookings are unaffected when the EventType value changes
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
- **Hybrid identity**: AWS Cognito holds password + lockout; Postgres `User` holds role +
  `active`. The NextAuth `signIn` callback in `src/lib/auth.ts` rejects logins for emails not
  present in Postgres or where `active === false`.
- **MFA is currently off** — deferred until `royalmasarena.lk` is registered (email MFA needs
  SES with a verified domain). Don't assume admins have MFA.
- **Sign-out goes federated** via `/api/auth/federated-logout` so Cognito's session cookie is
  cleared too. Without that, the next sign-in click auto-completes the OAuth flow.
- **Adding an admin** is a two-step process: create the Postgres `User` row via the website
  (Admin Accounts page), then create the matching Cognito user in the AWS console. See
  `docs/deployment.md` § Admin Auth.
- **`cognitoSub`** on `User` is backfilled on first successful sign-in (don't set it manually).
- **`COGNITO_ISSUER` env var** must be the full URL
  (`https://cognito-idp.<region>.amazonaws.com/<pool-id>`), not just the pool ID.
- **Behind Amplify's reverse proxy**, `req.url` reports the internal host (`localhost:3000`).
  For the public origin in server code, use `NEXTAUTH_URL`.

## Enum Values

- Booking status: `pending | confirmed | tentative | rejected | cancelled_override`
- Reconciliation status: `unpaid | part_paid | paid | waived` (waived is legacy only going forward)
- AC mode: `with_ac | without_ac`
- Day type: `weekday | weekend | any`
- Slot status (availability): `available | pending | confirmed | tentative | blocked | cleanup`
  - `cleanup` — slot falls within a booking's post-event cleanup window; conflicts are enforced the same as occupied slots; displayed as **"Site Preparation"** (warm orange) in the public booking calendar

## EventType: Cleanup Duration

`EventType.cleanupDurationMinutes` (0–480, whole number) defines how long the room must remain reserved for cleanup after each booking of that type. Configured by super-admins in the Event Types section. The value is snapshotted onto `Booking.cleanupDurationMinutes` at booking creation.

Conflict detection uses `effectiveOverlaps()` in `src/lib/calendar-core.ts`, which extends each booking slot's end time by its cleanup duration before comparing. The cleanup window may extend beyond room working hours — no validation is applied to enforce it stays within working hours.

## EventType: Max Advance Booking Days

`EventType.maxAdvanceBookingDays` (0–3650, whole number; default **365**) limits how far in advance customers can book that event type. 0 = no limit.

- **Enforced at booking creation**: `assertAdvanceBookingLimit(slots, eventType)` in `calendar-core.ts` rejects any slot beyond `today + maxAdvanceBookingDays`. Called from `POST /api/calendar/bookings` after recurrence expansion.
- **Not snapshotted on Booking**: the check runs only at creation time; changing the limit never affects existing bookings.
- **Client-side disabling** in `booking-calendar-flow.tsx`:
  - `maxDateStr` memo derived from the selected event type (null when limit = 0)
  - "Next week" button disabled when next week's start > `maxDateStr`
  - Day columns beyond limit: `gc-day-past-limit` class (opacity 0.4 on header); `past-limit` class on cells (greyed, `pointer-events: none`)
  - `toggleSelectionForCell` returns early for past-limit dates
  - Pre-submit guard blocks submission if any slot > `maxDateStr`
- **Admin UI**: "Advance (days)" column in Event Types table (between Cleanup and Priority); blank input coerces to 365.
- **Config validation**: `PUT /api/admin/calendar/config` validates 0–3650 whole number; returns 400 otherwise.

## Deployment & Infrastructure

### Amplify build vs. runtime connectivity

The production database (Aurora PostgreSQL) is in a private VPC. **The Amplify build container IS inside that VPC** and can reach Aurora. The developer's local machine cannot (blocked by the security group). This means:

- `npx prisma migrate deploy` runs correctly in the Amplify build step — this is the intended migration path for production
- **Never remove `prisma migrate deploy` from `amplify.yml`** thinking it "can't connect from the build container" — it can
- Running migrations locally against production is not possible without temporarily opening the security group or using a bastion host

### Amplify environment variables

Environment variables added or changed in the Amplify console **do not take effect until the next deployment**. Running Lambda functions continue using the env snapshot from their last deploy. If you add an env var after a deploy, you must trigger a new build for the running app to see it.

### Amplify SSR env var pattern

Amplify SSR Lambdas do **not** receive raw env vars at runtime via `process.env`. The established pattern in this project is:

1. Add `_AMPLIFY_MY_VAR: process.env.MY_VAR ?? ""` to the `env` block in `next.config.ts` — this bakes the value into the build at build time
2. In the consuming code, read with fallback: `process.env.MY_VAR ?? process.env._AMPLIFY_MY_VAR`
   - `process.env.MY_VAR` works locally (from `.env.local`)
   - `process.env._AMPLIFY_MY_VAR` works in production (baked into the build)

**Every new server-only env var must be added to both `next.config.ts` and the consuming code with this pattern.** Setting a var in the Amplify console alone is not sufficient — it only reaches the build step, not the running Lambda, unless it's in `next.config.ts`.

**`_AMPLIFY_*` values are statically inlined, not runtime env vars.** Next.js's `env` block in `next.config.ts` does **build-time string replacement** — every `process.env._AMPLIFY_FOO` reference becomes a literal string in the compiled JS. The key never appears in the runtime `process.env`, so you can't iterate `Object.keys(process.env)` to find it. You must reference each key explicitly by name in source code. This also means `_AMPLIFY_*` references must stay in server-only files; the [`scripts/check-amplify-secret-leak.mjs`](scripts/check-amplify-secret-leak.mjs) prebuild guard enforces an allowlist so stray references can't leak production secrets into the client bundle.

### Aurora Serverless v2 cold-start (min ACU 0)

The production Aurora cluster runs **Serverless v2 with min capacity 0 ACU** — it fully pauses when idle. The first connection after a pause takes 15–30s to wake the cluster, while Prisma's default connection timeout is ~5s. This manifests as `P1001: Can't reach database server` in the Amplify build log, even though the cluster shows "Available" in the RDS console.

The mitigation is in [`amplify.yml`](amplify.yml): `npx prisma migrate deploy` runs inside a 6× retry loop with 15s sleeps (~90s of headroom). Do not remove this loop while min ACU stays at 0. If cold-start delays become a problem at runtime too (first request after a long idle), bump min ACU to 0.5 to keep the cluster warm at the cost of ~USD 43/month baseline.

### Fire-and-forget (`void`) does not work in Lambda

AWS Lambda freezes the execution context the moment the HTTP response is returned. Any un-awaited promises are abandoned — they will never complete. **Never use `void someAsyncFn()` before a `return NextResponse.json(...)` in a route handler.** Always `await` async work before returning, even if you don't care about the result. Since the email send functions already catch all errors internally, awaiting them is safe and does not affect the response status.

### SDK client initialisation

Never instantiate SDK clients (Resend, etc.) at module level without guarding against missing env vars. A top-level `new Resend(undefined)` throws immediately, crashing the module on import and causing every route that imports it to return 500 — even routes that never call any email function.

Always guard:
```typescript
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
```

And handle the `null` case inside the function body.

## Transactional Email (`src/lib/email.ts`)

Uses the **Resend** SDK. Three exported async functions — each catches its own errors internally so they never throw. **Always `await` them** (or `Promise.allSettled` for parallel sends) before returning from a route handler — see the "Fire-and-forget (`void`) does not work in Lambda" gotcha above.

| Function | Trigger |
|---|---|
| `sendBookingAcknowledgement` | Called in `POST /api/calendar/bookings` after booking saved |
| `sendBookingStatusNotification` | Called in `PATCH /api/admin/calendar/bookings` on booking-level status change to `confirmed`, `tentative`, or `rejected` |
| `sendAdminNewBookingNotification` | Called alongside acknowledgement on new booking; skipped if `ADMIN_NOTIFICATION_EMAIL` unset |

Every send attempt writes a row to `EmailLog` (status `sent` or `failed`). Email failures never propagate to the API response.

**Required env vars:**

| Variable | Notes |
|---|---|
| `RESEND_API_KEY` | Server-only; from Resend dashboard — set in Amplify console |
| `RESEND_FROM` | From address; `onboarding@resend.dev` until domain verified — set in Amplify console |
| `ADMIN_NOTIFICATION_EMAIL` | Admin inbox for new-booking alerts; omit to disable — set in Amplify console |

**`EmailLog` model** (Prisma): `id`, `bookingReference` (denormalized string — no FK), `type`, `toEmail`, `fromEmail`, `subject`, `htmlBody`, `status`, `errorMessage`, `createdAt`.

## SlotAvailability

`SlotAvailability` (in `calendar-types.ts`) is the shape returned by `GET /api/calendar/availability`. Key fields:

| Field | Description |
|---|---|
| `startTime` / `endTime` | The **candidate** slot window (based on the requested event type's duration) |
| `status` | One of the slot status values above |
| `bookingId` | Set for non-available slots; identifies the blocking booking |
| `bookingStartTime` | Actual booking slot start time — use this for calendar cell coloring, not `startTime` |
| `bookingEndTime` | Actual booking slot end time (or cleanup window end for `status: "cleanup"`) |
| `reason` | Human-readable reason string for `blocked` slots |

`bookingStartTime`/`bookingEndTime` are critical for correct display. Because a single booking can block multiple candidate slots (staircase effect), the public calendar uses `busySlotCoversHour()` in `booking-calendar-flow.tsx` which reads these actual booking times. Without them, a Full Day booking at 07:00–17:00 would visually extend to 19:00+ when the user views the calendar with a shorter event type selected.

## Admin Booking Queue: Tab Filtering

The Booking Queue section has a horizontal tab bar that filters the list client-side. Default tab is **Pending**. All filtering happens inside `admin-calendar-console.tsx` — no API changes.

| Tab | Filter |
|---|---|
| All | all bookings |
| Pending | `computeBookingEffectiveStatus(b) === "pending"` |
| Tentative | `computeBookingEffectiveStatus(b) === "tentative"` |
| Unpaid | `reconciliationStatus === "unpaid"` AND active status |
| Part Paid | `reconciliationStatus === "part_paid"` AND active status |
| Paid | `reconciliationStatus === "paid"` |
| Overpaid | `paidAmountLkr > totalAmountLkr` AND active status |
| Conflicts | booking id present in `conflictMap` (existing memo) |

"Active status" = `pending | confirmed | tentative`. Rejected / cancelled_override bookings are only visible under **All**.

The Conflicts tab badge uses an orange outline when its count > 0. The conflict warning banner above the list remains visible regardless of active tab.

Key implementation details in `admin-calendar-console.tsx`:
- `BookingTab` union type and `isActiveBooking()` helper are module-level (not inside the component).
- `tabCounts` and `filteredBookings` are `useMemo` hooks that depend on `bookings` + `conflictMap`.
- CSS classes: `.admin-booking-tabs`, `.admin-booking-tab`, `.admin-booking-tab-count` (in `globals.css`).

## Admin Booking Queue: Effective Status & Pay Tags

### `computeBookingEffectiveStatus()`

Defined at module level in `admin-calendar-console.tsx`. Derives a single display status from a booking's per-slot overrides:

1. Map each slot to its `slotStatus ?? booking.status`.
2. Filter out `"rejected"` and `"cancelled_override"` entries.
3. If no active slots remain → return `"rejected"`.
4. If all active slots share one status → return that status.
5. Otherwise → fall back to `booking.status`.

**Why step 2 matters**: a booking with some rejected slots and some confirmed slots must display as `"confirmed"` (the status of the remaining active slots), not `"tentative"` (the original booking-level status). Without this filter, mixed-status bookings incorrectly appeared in the Tentative tab.

### Pay tags (booking card meta row)

The payment status tag evaluates in this order — the overpaid check must come first because `reconciliationStatus` is `"paid"` whenever `paidAmountLkr >= totalAmountLkr`, which includes the overpaid case:

| Condition | Tag | CSS class |
|---|---|---|
| `effectivePaid > totalAmountLkr` | Overpaid · Refund Due LKR X | `.bk-pay-overpaid` (warm orange) |
| `reconciliationStatus === "paid"` | Paid in Full | `.bk-pay-paid` (green) |
| `reconciliationStatus === "waived"` | Waived | `.bk-pay-waived` (grey) |
| `reconciliationStatus === "part_paid"` | Paid LKR X · Due LKR Y | `.bk-pay-part` (amber) |
| default | Unpaid | `.bk-pay-unpaid` (red) |
