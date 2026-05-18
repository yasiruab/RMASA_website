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

## Design System

The public site and admin panel use **two separate design systems**.

### Public site — Arena Court Edition (dark navy + gold)

Palette tokens live in `:root` of `src/app/globals.css` with the `--ac-*` prefix.

| Token | Value | Use |
|---|---|---|
| `--ac-bg` | `#06112E` | page background |
| `--ac-ink` | `#08163A` | live strip + footer |
| `--ac-ink2` | `#0F2255` | nav strip + intro + room compare bg |
| `--ac-line` | `#1F3360` | hairlines |
| `--ac-card` | `#0E1F4A` | card backgrounds |
| `--ac-text` | `#E9ECF4` | body text |
| `--ac-text-dim` | `#9CA6BF` | secondary text |
| `--ac-text-mute` | `#6B7494` | tertiary / mono meta |
| `--ac-gold` | `#E8B73A` | brand accent |
| `--ac-gold-bright` | `#FFC83D` | hover state |
| `--ac-gold-deep` | `#B8870A` | underlines |
| `--ac-live` | `#22D67C` | LIVE booking-desk dot |
| `--ac-paper` | `#FAF7F0` | logo plaque background |
| `--ac-hair` | `#E5DFD0` | logo plaque border |

Type families (loaded via `<link>` in `src/app/layout.tsx` from `fonts.googleapis.com`):

| Family | Use |
|---|---|
| Archivo (400–900) | Display + nav labels |
| Newsreader (400–700, italic) | Italic serif suffix + intro lede |
| Space Grotesk (400–700) | Body text (default `body` font) |
| Geist Mono (400–500) | Eyebrows / meta / monospace numbers |

Helper classes — use these instead of re-declaring inline:

| Class | Use |
|---|---|
| `.ac-display` | Archivo 900, tight tracking, line-height 0.92 — pair with inline `font-size` |
| `.ac-italic` | Archivo italic 500 — for the secondary italic suffix |
| `.ac-mono` | Geist Mono 11px, uppercase, letter-spaced eyebrows |
| `.ac-logo-plaque` | Cream-tile backplate behind the dark wordmark |
| `.ac-btn-primary` / `.ac-btn-ghost` | Gold-filled / outline buttons (uppercase Archivo) |

The site-wide chrome lives in [`src/components/nav.tsx`](src/components/nav.tsx) (two-strip header: live strip + nav strip) and [`src/components/footer.tsx`](src/components/footer.tsx) (4-col + meta row + edition tag).

### Admin panel — legacy tokens (kept for compatibility)

The legacy `--brand` / `--ink` / `--muted` / `--bg` / `--panel` / `--line` / `--footer` tokens are still defined in `:root` and are used by all `.admin-*`, `.bk-*`, `.rpt-*`, `.gc-*` rules. Do **not** rename or remove these. Admin pages render inside `.content-page` (white card) and read fine on top of the new dark `body` background; the dark perimeter around the admin card is expected and matches the new public chrome that wraps every page in the App Router.

## Calendar Data Model

### RoomType

Key fields:
- `id`, `name`, `startTime`, `endTime` (room working hours, HH:00)
- `capacity` (Int?) — admin-editable; appears as the CAPACITY tile on the public bookings room card
- `description` (String?) — short blurb (e.g. "The full floor. 1,200 sqm of polished maple."); admin-editable; shown on the public bookings room card; hidden when blank

Both `capacity` and `description` are set by super-admins in the Room Types editor (admin/calendar/rooms). The public bookings page derives HOURLY / DAY RATE / +LKR X/hr from `PricingRule` — never hardcode them in the component.

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
| `type` | `payment` (+ collected) · `refund` (− collected) · `credit_note` (− outstanding, no cash) · `waiver` (− outstanding, no cash; displayed as "Fee Waiver") |
| `date` | YYYY-MM-DD, admin-supplied |
| `amountLkr` | Always positive; direction from `type` |
| `receiptNo` | Optional; empty string if absent |
| `notes` | Required |
| `createdBy` | Admin email (server-set) |

**Net collected** = Σ(payment.amountLkr) − Σ(refund.amountLkr) − Σ(credit_note.amountLkr) − Σ(waiver.amountLkr)

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

The interactive transaction is configured with `{ timeout: 30_000, maxWait: 10_000 }` because the wipe-and-recreate body issues many sequential round-trips to Neon (Singapore). The default 5 s Prisma timeout is too tight once real bookings exist. The wipe-recreate pattern itself is wasteful — a future refactor should do targeted upserts on the changed table(s) instead of nuking everything.

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

### Database: Neon Serverless Postgres

The production database is **Neon** in `aws-ap-southeast-1` (Singapore) — plain Postgres, public over TLS, reachable from anywhere with the connection string. Prisma uses `provider = "postgresql"` unchanged.

**Two connection strings** are configured:

| Env var | URL shape | Used for |
|---|---|---|
| `DATABASE_URL` | `…-pooler.…neon.tech/<db>?sslmode=require` | Runtime queries (Lambda) — goes through Neon's built-in pgBouncer |
| `DIRECT_URL` | `…(no pooler).…neon.tech/<db>?sslmode=require` | `prisma migrate deploy` and any other unpooled use |

The Prisma `datasource` block declares both: `url = env("DATABASE_URL")` + `directUrl = env("DIRECT_URL")`. Migrations always run against the direct URL; runtime queries use the pooled URL automatically.

Neon **autosuspends after 5 min idle** and **wakes in ~300 ms** when the next request lands — fast enough to be invisible to end users. This means no Aurora-style P1001 cold-start failures, no retry loop in `amplify.yml`, and migrations from a developer laptop just work over the public internet (no VPC bastion needed).

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
| `sendAdminRejectionNotification` | Called when any booking is set to `rejected` (booking-level or per-slot via Save); skipped if `ADMIN_NOTIFICATION_EMAIL` unset; includes reject reason |

Every send attempt writes a row to `EmailLog` (status `sent` or `failed`). Email failures never propagate to the API response.

**Required env vars:**

| Variable | Notes |
|---|---|
| `RESEND_API_KEY` | Server-only; from Resend dashboard — set in Amplify console |
| `RESEND_FROM` | From address; `onboarding@resend.dev` until domain verified — set in Amplify console |
| `ADMIN_NOTIFICATION_EMAIL` | Admin inbox for new-booking alerts; omit to disable — set in Amplify console |

**`EmailLog` model** (Prisma): `id`, `bookingReference` (denormalized string — no FK), `type`, `toEmail`, `fromEmail`, `subject`, `htmlBody`, `status`, `errorMessage`, `createdAt`.

## Bot Protection: Cloudflare Turnstile

The public booking form is gated by **Cloudflare Turnstile** to prevent scripted abuse (the endpoint is anonymous and triggers two transactional emails per submit). Turnstile is a free, invisible CAPTCHA alternative — the user usually sees nothing.

**Files:**
- `src/lib/turnstile.ts` — server-side `verifyTurnstileToken()`. **Fail-open** if `TURNSTILE_SECRET_KEY` is unset (deploys keep working before keys are configured in Amplify).
- `src/components/calendar/turnstile-widget.tsx` — client widget; loads the CF script on demand, exposes a `resetKey` prop to force token rotation between submits (CF tokens are single-use).
- `src/components/calendar/booking-calendar-flow.tsx` — renders widget in the receipt aside, gates Submit button, sends `turnstileToken` in the POST body, resets after every submit attempt (success or failure).
- `src/app/api/calendar/bookings/route.ts` — verifies the token **first**, before any DB read.

**Required env vars:**

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Client widget key; inlined at build time (no `_AMPLIFY_*` baking needed — Next.js handles `NEXT_PUBLIC_*` automatically). Set in Amplify console. |
| `TURNSTILE_SECRET_KEY` | Server-only; uses the `_AMPLIFY_*` pattern in [`next.config.ts`](next.config.ts). Set in Amplify console. |

**Test keys** for local dev (always pass, from [CF docs](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)) are pre-populated in `.env.local`:
- Site key: `1x00000000000000000000AA`
- Secret: `1x0000000000000000000000000000000AA`

Get real keys at https://dash.cloudflare.com → **Turnstile** → **Add Site**. Add `royalmasarena.lk` (and `localhost` for dev) to the hostnames list. Widget mode: **Managed** (recommended).

`src/lib/turnstile.ts` is on the `_AMPLIFY_*` allowlist in [`scripts/check-amplify-secret-leak.mjs`](scripts/check-amplify-secret-leak.mjs).

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

## Public Bookings Page: Room Cards, Recurrence, Terms

The public bookings page (`booking-calendar-flow.tsx`) drives all room-card data from the admin portal — **never hardcode** capacity, description, or pricing in the component:

- **CAPACITY** and **description** come from `RoomType.capacity` / `RoomType.description` (admin-editable in Room Types editor)
- **HOURLY** = min `amountLkr * 60 / durationMinutes` across all event types for the room (weekday or any, without_ac), derived via `getRoomHourlyRate()`
- **DAY RATE** = `amountLkr` of the event type with the longest `durationMinutes` for the room (weekday or any, without_ac), via `getRoomDayRate()` → `getFullDayEventTypeId()`
- **WITH A/C sub** = `+LKR X` where X = `with_ac.amountLkr - without_ac.amountLkr` for the currently selected event type, via `getAcPremiumForEventType()`
- **VENUE 01 / 02** tag is derived from sort order of the `rooms` array, not from any DB field

**Recurrence preview**: `expandRecurrencePreview()` returns `[]` until the admin has set either an End Date or Occurrences. Choosing Daily/Weekly/Monthly with no limit does **not** paint recurrence blocks on the calendar.

**Booking terms**: a real `<input type="checkbox">` (default unchecked) gates the Submit button. The full General Guidelines list is embedded inline in a `<details>` expander — not linked to the privacy policy.

## Responsive Breakpoints (public site)

Standard breakpoints used across `src/app/globals.css`:

| Breakpoint | Used for |
|---|---|
| `@media (max-width: 980px)` | tablet — desktop nav collapses to hamburger, two-column grids stack |
| `@media (max-width: 700px)` | phones + small tablets portrait — section paddings compress to 16 px; bookings page swaps to the mobile **day-picker** view; form field grids stack; live-strip address line + bullet hidden |
| `@media (max-width: 420px)` | narrow phones — paddings compress to 12 px; AC toggle stacks vertically; recurrence row goes single-column; live-strip email link hidden (phone link only); activity tiles use `auto-fill` |

Display typography uses `clamp()` instead of breakpoint overrides — see `.ac-hero-title`, `.ac-hero-italic`, `.ac-page-hero-title`, `.ac-page-hero-italic`. Hero slider height is `clamp(420px, 56vw, 720px)`. Map iframe is `clamp(240px, 60vw, 420px)`.

## Bookings Page: Dual-Render Calendar (desktop grid + mobile day picker)

The bookings calendar in `booking-calendar-flow.tsx` mounts **two views simultaneously** but only one is visible at a time, controlled purely by CSS:

- `.ac-bookings-grid-wrap` — desktop 8-column week grid (existing). Hidden below 700 px.
- `.ac-bookings-day-view` — mobile day-picker (day pills + vertical hour rows). Hidden above 700 px (default `display: none`).

Both share the same component state (`weekDates`, `slotMap`, `selectedSlots`, `recurrencePreviewSlots`, `recurrenceConflictKeys`). A separate `selectedDayDate` state tracks the currently-shown day in the mobile view; an effect keeps it valid when `weekDates` changes (defaults to today if visible, else the first day of the week).

Each mobile hour row calls the same `toggleSelectionForCell(date, hour)` used by the desktop grid, so behaviour stays identical across both views — the only difference is rendering. Status badges and labels reuse `STATUS_LABELS`.

## Admin Booking Queue: Tab Filtering

The Booking Queue section has a horizontal tab bar that filters the list client-side. Default tab is **Pending**. All filtering happens inside `admin-calendar-console.tsx` — no API changes.

| Tab | Filter |
|---|---|
| All | all bookings |
| Pending | `computeBookingEffectiveStatus(b) === "pending"` |
| Tentative | `computeBookingEffectiveStatus(b) === "tentative"` |
| Unpaid | `reconciliationStatus === "unpaid"` AND active effective status |
| Part Paid | `reconciliationStatus === "part_paid"` AND active effective status |
| Paid | `reconciliationStatus === "paid"` |
| Overpaid | `paidAmountLkr > totalAmountLkr` AND active effective status |
| Rejected | at least one slot has effective status `"rejected"` (covers both full-booking rejections and per-slot rejections) |
| Conflicts | booking id present in `conflictMap` (existing memo) |

**"Active effective status"** = `computeBookingEffectiveStatus(b) ∈ {pending, confirmed, tentative}`. `isActiveBooking()` always routes through the effective status — never `b.status` directly — so a booking whose every slot has been overridden to `rejected` correctly drops out of Unpaid / Part Paid / Overpaid even when its booking-level `status` is still `pending`. Rejected / cancelled_override bookings are visible under **All** and **Rejected**.

The Conflicts tab badge uses an orange outline when its count > 0. The conflict warning banner above the list remains visible regardless of active tab.

Key implementation details in `admin-calendar-console.tsx`:
- `BookingTab` union type, `BookingDateRange` union type, `isActiveBooking()`, `hasRejectedSlot()`, and `computeBookingEffectiveStatus()` are module-level (not inside the component).
- `tabCounts` and `filteredBookings` derive from `dateFilteredBookings` (a useMemo that applies the date-range filter before tab filtering, so counts reflect the active range).
- CSS classes: `.admin-booking-tabs`, `.admin-booking-tab`, `.admin-booking-tab-count`, `.admin-booking-date-filter` (in `globals.css`).

## Admin Booking Queue: Date Range Filter

A date-range dropdown above the tabs filters the queue to bookings with at least one slot whose `date` falls inside the range. Options:

| Preset | Range |
|---|---|
| All dates | no filter (default) |
| Today | `[today, today]` |
| Last 7 days | `[today − 6, today]` |
| Last 30 days | `[today − 29, today]` |
| Custom range | user-supplied start and end (inclusive) |

The filter applies BEFORE the tab filter, so tab counts reflect the active range. Date semantics are based on slot dates (`booking.slots[].date`), not booking creation date — the admin is reviewing what is/was happening on the calendar, not when records were entered.

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

## Admin Booking Queue: Staged Slot Changes & Save Button

Per-slot approve/reject actions are **staged locally** in a `Map<bookingId, changes[]>` before being sent to the server. Nothing is persisted until the admin explicitly clicks **Save Changes**.

Key state:
- `stagedSlotChanges` — `Map<string, Array<{ slotDate, slotStartTime, slotStatus, rejectReason? }>>` — pending per-slot edits
- `bookingsWithStaged` — useMemo merging staged changes into `bookings` for display only; actual `bookings` state is unchanged until Save succeeds
- `savingBookingIds` — `Set<string>` of booking IDs currently mid-save

Clicking **Save Changes (N)** calls `savePendingSlotChanges(bookingId)` which sends a single `PATCH /api/admin/calendar/bookings` with `{ id, batchSlotUpdates: [...] }`. On success, the staged changes are cleared and `refreshAll()` is called. On failure, staged changes are preserved so the admin can retry.

Per-slot badges show a `●` indicator when staged. The slot row gets `.bk-slot-staged` CSS class (amber left border).

**Reject reason modals** — per-slot rejection opens `slotRejectModal`; bulk "Reject All" opens `bulkRejectModal`. Both require a non-empty reason before the confirm button is enabled.

**Bulk status changes** (Confirm All / Tentative) remain immediate (no staging) and call `updateBookingStatus()` directly. Bulk rejection now opens the `bulkRejectModal` and requires a reason.

## Admin Booking Queue: Per-Slot Payment Allocation

`computeSlotPaymentAllocation(booking)` returns a `Map<"date|startTime", "paid"|"part_paid"|"unpaid">` for display in each slot row. Logic:
1. Filter to active (non-rejected, non-cancelled) slots; sort oldest-first
2. Walk slots oldest-first, consuming `paidAmountLkr` against each slot's `amountBreakdown` amount
3. `paid` if slot fully covered; `part_paid` if partially; `unpaid` if nothing left

This is display-only — payments are still recorded at booking level, not per-slot.

## Reject Reason Storage

- **Booking-level rejection** (`status: "rejected"` via bulk PATCH): stored in `Booking.rejectReason`
- **Per-slot rejection** (`slotStatus: "rejected"` via batch PATCH): stored in `BookingSlot.rejectReason`
- Both fields are `String?` in Prisma schema
- Reject reason is required (validated in API) for all rejection paths — both booking-level and per-slot
- Displayed under each slot row as `.bk-slot-reject-reason`
- Included in customer rejection email and admin rejection notification

## Accounting Report

`GET /api/admin/calendar/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` — returns all booking slots in the date range with per-slot financial allocation.

**Per-slot financial allocation logic** (server-side, same approach as `computeSlotPaymentAllocation`):
1. Separate payment entries into: `netCash` (payments − refunds), `totalWaiver`, `totalCredit`
2. Active slots sorted oldest-first
3. Walk slots: allocate cash first, then waiver, then credit notes until each stream exhausted
4. `slotBalanceLkr = slotAmountLkr − paidLkr − waiverLkr − creditNoteLkr` (min 0)

Report page at `/admin/calendar/reports` (visible to all admins, not super-admin-only). Columns: Date, Time, Room, Event Type, Ref, Customer, Purpose, Status, Pay Status, Amount (LKR), Paid (LKR), Waiver (LKR), Credit Note (LKR), Balance (LKR), Reject Reason. Summary row shows totals. CSV export available.
