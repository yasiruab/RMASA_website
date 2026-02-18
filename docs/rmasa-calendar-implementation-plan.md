# RMASA Calendar Booking System - Current Implementation Status

## Source
Based on: `20250621 RMASA Calendar plugin requirement with badminton.docx` and all subsequent implementation decisions.

## Phase Status
- Phase 1 core platform: implemented.
- Phase 2 integrations: deferred.

## Implemented Features

### 1. Public Booking Calendar UX
- Default calendar view is weekly with visible hour rows.
- Week navigation is available (`Prev` / `Next`).
- Working hours are active and off-hours are greyed out.
- Calendar shows existing statuses: pending, confirmed, tentative, blocked.
- Slot selection is click-based (no drag flow).
- Selecting a start time creates a duration-based block.
- Multiple slot selection is supported.

### 2. Slot Selection Rules
- No manual start/end time entry.
- Duration comes from selected event type.
- Overlapping manual selections are blocked.
- Selections outside working hours are blocked.

### 3. Recurrence
- Supported frequencies: daily, weekly, monthly.
- Recurrence inputs appear only when recurrence is enabled.
- Recurrence limit is mandatory and exclusive:
  - either `End Date`
  - or `Number of Recurrences`
  - never both
- Recurrence preview is shown on calendar.
- Recurrence blocks render as continuous blocks with a recurrence marker.
- Recurrence conflicts are highlighted and block submit.
- Internal overlap between recurrence-generated slots is validated (client + API).
- Recurrence window max: 6 months / 26 occurrences.

### 4. Pricing and Booking Summary
- Pricing is matrix-driven by:
  - room type
  - event type
  - AC mode
  - day type (`weekday` / `weekend` / `any`)
- Booking summary uses a single table (merged slots + charges).
- Recurrence-generated slots are included in summary and total.
- Submit is blocked when any row has missing pricing.
- API returns clean validation errors for missing pricing.

### 5. Dynamic Filter Logic (Pricing-Aware)
- `Appointment Type` shows only event types that:
  - are allowed for selected room, and
  - have pricing rows for that room.
- `AC Mode` shows only modes with pricing for selected room + event type.
- Invalid combinations are auto-corrected to first valid option.

### 6. Event Type to Room Binding
- Event types can be bound to a specific room (`roomTypeId`) or all rooms.
- Booking flow filters event types by selected room.
- API enforces room-event compatibility on availability and booking submit.
- Admin config validation blocks invalid room-event or pricing mappings.

### 7. Priority Rules
- Event types have priority values.
- Availability behavior:
  - high-priority request ignores lower-priority occupied slots (shows as available)
  - low-priority request is blocked by equal/higher-priority bookings
- Submission behavior:
  - high-priority request can be submitted over lower-priority overlaps
  - low-priority conflicting requests are rejected
- Cancellation timing:
  - lower-priority bookings are **not cancelled at submit time**
  - they are cancelled only when admin confirms the high-priority booking

### 8. Admin Console
- Manage rooms and working hours.
- Manage event types (duration, priority, room binding).
- Manage pricing matrix.
- Manage blockouts.
- Review booking queue and update status.
- Update reconciliation status and notes.
- Save feedback improved with success/error messages.
- Delete controls added for:
  - rooms
  - event types
  - pricing rows
- Delete safeguards:
  - cannot delete room/event type with booking history
  - cannot delete room with active blockouts
  - cannot delete room while event types are still attached
- Admin authentication layer:
  - credentials-based login at `/admin/login`
  - protected `/admin/*` routes via middleware
  - role-based access (`admin`, `super_admin`)
  - super-admin-only access for rooms/event types/pricing configuration

### 9. Admin Revenue Insights
- Dashboard revenue snapshot is available (recognized/collected/receivable/rate + mini trend).
- Dedicated `/admin/calendar/revenue` section added with:
  - date/room/event/ac filters
  - monthly trend chart
  - breakdown tables
  - pipeline and collections queue.

## Current Data Storage
- Persistence is database-backed (Postgres via Prisma):
  - schema: `prisma/schema.prisma`
  - migrations: `prisma/migrations/*`
- Access layer:
  - `src/lib/calendar-store.ts`

## Environment and Setup
- Required environment variables:
  - `DATABASE_URL`
  - `NEXTAUTH_SECRET`
  - `NEXTAUTH_URL`
  - `ADMIN_EMAIL`
  - `ADMIN_PASSWORD`
- Example file:
  - `.env.example`
- Database/auth commands:
  - `npm run db:generate`
  - `npm run db:migrate`
  - `npm run db:seed:admin`
  - `npm run db:migrate:calendar-json`

## API/Runtime Hardening Applied
- Config endpoints forced dynamic to avoid stale config reads.
- Booking config fetch uses no-store.
- Booking submit has defensive JSON parse handling in client.
- Booking API returns structured JSON errors for pricing/config validation failures.

## Deferred to Phase 2
- GA4 integration
- Email integration and sender domain setup
- CAPTCHA integration
- Cloud hosting / handover package

## Functional Rules (Current)
- New booking status starts as `pending`.
- Booking uses predefined duration slots only.
- Conflict checks apply to one-time and recurrence.
- Blockouts always block booking.
- Priority override is deterministic and auditable.
- Lower-priority cancellation occurs only after admin confirmation of high-priority request.

## Open Follow-Ups
- Add notifications (email/WhatsApp) once integration phase starts.
- Add step-up auth (MFA or re-auth) for super-admin sensitive actions.
- Add email-based password reset flow.
- Add rate limiting / lockout policy on repeated failed sign-ins.

## Change Log

### 2026-02-16
- Created core RMASA booking platform with week-hour calendar, slot selection, recurrence, pricing matrix, admin operations, and blockouts.
- Switched booking selection to click-based duration blocks with multi-slot support.
- Added recurrence visualization in calendar as continuous blocks with recurrence marker.
- Implemented recurrence validation:
  - internal overlap checks
  - conflict checks against existing bookings and blockouts
  - mandatory exclusive recurrence limit (`End Date` xor `Occurrences`)
- Fixed timezone/date-shift issues in recurrence expansion on both client and server.
- Merged Selected Slots and Charge Breakdown into a unified Booking Summary table.
- Included recurrence-generated slots in summary and charge total.
- Added room-event binding so event types can be room-specific or all-rooms.
- Added pricing-aware filter behavior for booking:
  - show only event types with pricing for selected room
  - show only AC modes with pricing for selected room + event type
- Added admin delete actions for rooms, event types, and pricing rows with safety guards.
- Improved admin config save feedback and refresh behavior.
- Forced dynamic/no-store config reads to avoid stale room/event/pricing options.
- Hardened booking API/client error handling for missing pricing and non-JSON server responses.
- Implemented priority-aware availability:
  - high-priority requests can see through lower-priority bookings
  - low-priority requests remain blocked by equal/higher-priority bookings
- Changed override lifecycle:
  - lower-priority bookings are no longer cancelled at submit time
  - cancellation occurs only when admin confirms the high-priority booking.

### 2026-02-17
- Added admin auth foundation with NextAuth credentials provider and secure session handling.
- Added middleware protection for `/admin/*` and dedicated `/admin/login`.
- Added role-based authorization utilities and applied guards to admin calendar APIs.
- Added super-admin-only admin account management APIs:
  - list/create accounts
  - role/active updates
  - password reset
- Added audit logging for auth events and admin mutation endpoints.
- Added Prisma/Postgres schema for auth, calendar domain, and audit records.
- Added migration scripts:
  - seed super admin from env
  - migrate legacy JSON calendar data into Postgres.
