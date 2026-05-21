## Admin area overview

This document explains how the admin side of the RMASA website works: authentication, routes and the calendar console.

### Goals of the admin area

- Allow trusted staff to log in securely.
- Provide an interface to:
  - View and manage bookings.
  - Configure availability and blocks.
  - Potentially manage other site content in future phases.

### Admin authentication

- **Auth library**: NextAuth (see `src/app/api/auth/[...nextauth]/route.ts`).
- **Account data**: Stored in the database via Prisma (see `prisma/schema.prisma` and `scripts/seed-super-admin.mjs`).
- **Session handling**: NextAuth session helpers are used on the server and in middleware to enforce access control.

Key pieces:

- `src/lib/auth.ts`: wraps NextAuth configuration and helpers.
- `src/lib/auth-guards.ts`: utilities to protect admin routes and APIs.
- `middleware.ts`: may apply route protection / redirects based on session state.

### Admin routes (UI)

- `src/app/admin/login/page.tsx`
  - Renders the admin login form UI.
  - Uses `src/components/admin/admin-login-form.tsx`.
- `src/app/admin/calendar/layout.tsx`
  - Thin layout wrapper. Enforces the auth guard via `getServerSession` and
    exposes the signed-in identity to client pages through
    `src/components/admin/admin-session-context.tsx`. The public Nav + Footer
    from the root layout already supply the Arena Court chrome around every
    admin page; this layout adds no inner sidebar or header.
- `src/app/admin/calendar/page.tsx`
  - The **hub** (server-rendered). Fetches bookings, blocks, recent audit
    log entries, and the 90-day revenue model, then renders the
    `<AdminHub>` from `src/components/admin/hub/admin-hub.tsx`.
- `src/app/admin/calendar/bookings/page.tsx`
  - The **bookings split-pane** (Suspense-wrapped). Mounts the
    `<AdminBookings>` client component from
    `src/components/admin/sections/admin-bookings.tsx`.
  - URL sync via `?id=<bookingId>` keeps deep links shareable.
  - Initial filter state can also be set via URL params: `?approval=…` and
    `?payment=…` accept comma-separated multi-values
    (`?approval=pending,tentative`, `?payment=unpaid,part_paid`);
    `?conflict=…` is single-valued (`with` / `without`).
- `src/app/admin/calendar/[section]/page.tsx`
  - Dynamic segment for the remaining legacy sections: `revenue`,
    `accounts`, `rooms`, `event-types`, `pricing`, `blockouts`. `dashboard`
    is no longer accepted (the new hub replaces it); `bookings` is no
    longer accepted (the explicit route shadows it). Super-admin gates
    are enforced on `accounts`, `rooms`, `event-types`, and `pricing`.
- `src/app/admin/calendar/reports/page.tsx`
  - Standalone reports view (separate from the mega-component).

Key components:

- `src/components/admin/admin-login-form.tsx`: handles credential input and submit.
- `src/components/admin/admin-logout-button.tsx`: logs out the admin (federated to Cognito).
- `src/components/admin/admin-breadcrumbs.tsx`: Geist Mono breadcrumb strip used on every admin page.
- `src/components/admin/admin-session-context.tsx`: `AdminSessionProvider` + `useAdminSession` hook.
- `src/components/admin/hub/admin-hub.tsx`: hub page composition (hero, KPI strip, section cards, revenue snapshot, recent activity). The KPI tiles are clickable — each deep-links into the bookings page with the relevant filter pre-applied (In queue → `?approval=pending,tentative`, Approved today → `?approval=confirmed`, Conflicts → `?conflict=with`, Outstanding → `?payment=unpaid,part_paid`, Active blockouts → `/admin/calendar/blockouts`).
- `src/components/admin/sections/admin-bookings.tsx`: bookings split-pane (queue + detail + action surfaces). All actions call `/api/admin/calendar/*` endpoints unchanged from the legacy implementation. Adds:
  - **Multi-select Approval + Payment filters** (custom dropdowns with checkboxes; closes on outside click / Escape).
  - **Clickable KPI tiles** at the top of the page — clicking one resets the other filter axes and applies its own; click-again clears all.
  - **Per-slot price + payment status chip** on each slot row, driven by `computeSlotAllocations()` (see "Per-slot payment allocation" below).
  - **OUTSTANDING / REFUND DUE / SETTLED tile** in the detail-pane summary strip (bold gold display when the customer owes; blue when overpaid; green when balanced).
  - **Search box** matches against booking reference, customer name/email, purpose, booking ID, room name, and event type name.
- `src/components/admin/admin-calendar-console.tsx`: legacy mega-component, still mounted for revenue / accounts / rooms / event-types / pricing / blockouts sections.
- `src/lib/admin/booking-utils.ts`: shared admin booking helpers.
  - `computeBookingEffectiveStatus()` / `isActiveBooking()` — derive effective status from per-slot overrides (a booking whose every slot is rejected is "rejected" regardless of `booking.status`).
  - `activeBookingTotalLkr()` — sum of `amountBreakdown` for non-rejected slots. Use whenever computing "what does the customer owe?"; never compare paid against `Booking.totalAmountLkr` directly — that includes amounts for slots later rejected.
  - `computeSlotAllocations()` — per-slot payment allocation (see below).

### Admin API routes

Under `src/app/api/admin/`:

- `accounts/`:
  - `src/app/api/admin/accounts/route.ts`: list or create admin accounts.
  - `src/app/api/admin/accounts/[id]/route.ts`: operate on a specific account.
  - `src/app/api/admin/accounts/[id]/reset-password/route.ts`: reset an admin password.
- `calendar/`:
  - `src/app/api/admin/calendar/config/route.ts`: manage global calendar configuration.
  - `src/app/api/admin/calendar/blocks/route.ts`: manage availability / block ranges.
  - `src/app/api/admin/calendar/bookings/route.ts`: manage bookings from an admin perspective (e.g. view, cancel).

All admin API routes should:

- Validate the current session and ensure the user is an admin.
- Validate input payloads.
- Use domain logic from `src/lib/calendar-core.ts` and related modules.
- Interact with the database via Prisma.

### Access control expectations

- Public users must **not** be able to hit admin endpoints or pages successfully.
- Admin routes and APIs should:
  - Redirect unauthenticated users to `/admin/login`.
  - Return appropriate HTTP status codes when access is denied (e.g. 401/403).

### Per-slot payment allocation

Each slot row in the bookings detail page shows its own price + a payment
status chip (PAID / PART PAID / UNPAID / WAIVED). The allocation is a pure
derivation from `booking.slots` + `booking.amountBreakdown` + `booking.
paymentEntries` — never stored. Every render of the detail pane recomputes
from current state, so any subsequent admin edit (slot status change, new
ledger entry) automatically refreshes the display.

The helper is `computeSlotAllocations()` in `src/lib/admin/booking-utils.ts`
and is the **single source of truth** — both the admin bookings detail pane
and the `/api/admin/calendar/reports` route call it.

**Allocation direction (intentionally asymmetric):**

| Stream | Direction | Slot scope |
|---|---|---|
| Payments | oldest → newest | all slots (incl. rejected) |
| Refunds | newest → oldest | all slots (incl. rejected) |
| Waivers | newest → oldest | active slots only |
| Credit notes | newest → oldest | active slots only |

Payments + refunds include rejected slots because if the customer paid
before a slot was rejected, the cash physically landed on that slot — a
later refund needs to reverse from exactly there. Waivers + credit notes
skip rejected slots since there's no debt to forgive.

**Rejected slot display**: original price struck through, no chip. The
Rejected status pill on the same row carries the rejection info.

### Outstanding / refund accounting

`Booking.totalAmountLkr` and `Booking.reconciliationStatus` are cached at
booking creation and **never** reduced when slots are later rejected. This
is intentional (the original invoice is preserved as a historical record),
but every "what does the customer owe?" computation in the app must go
through `activeBookingTotalLkr()` — using the cached total instead would
make customers appear to owe money for rejected slots.

Places this rule applies:

- Bookings filter — fully-rejected bookings drop out of "Unpaid / Part paid"
  and "Outstanding" matches; partially-rejected bookings only count their
  non-rejected slot amounts.
- Hub "Outstanding" KPI total.
- Bookings detail OUTSTANDING / REFUND DUE / SETTLED tile.
- Bookings detail payment ledger "Net owed" + "Less rejected slots" tile.
- `/api/cron/unpaid-reminders` — both the "should we send a reminder?"
  decision and the "Total Amount" line in the customer email body.

### Future ideas

If you extend the project later, this document is a good place to note:

- New admin sections (e.g. content management).
- Role-based access control (different admin roles).
- Audit logging rules and where audit logs are written (`src/lib/audit.ts`).

