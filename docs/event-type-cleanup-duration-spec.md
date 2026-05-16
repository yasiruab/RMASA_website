# Event Type Cleanup Duration — Feature Spec

## Overview

Certain events require a post-event cleanup window before the room can be reused. This feature adds a configurable `cleanupDurationMinutes` to each event type. The cleanup window is enforced during conflict detection — no new booking may start during a booking's cleanup period — and is surfaced as a distinct `"cleanup"` status in the availability API. Because admins may adjust the value over time, the duration is snapshotted onto each booking at creation so that changing the event type does not affect past bookings.

## Layout / UX

The Event Types admin section (super-admin only) gains a **Cleanup (min)** column between Duration and Priority:

```
| Name       | Applies To | Duration (hrs) | Cleanup (min) | Priority | Actions |
|------------|------------|----------------|---------------|----------|---------|
| Conference | All Rooms  | [4]            | [60]          | [1]      | Delete  |
| Wedding    | Hall       | [8]            | [120]         | [2]      | Delete  |
```

- Input: `type="number"`, `min=0`, `step=15`
- Range: 0–480 minutes (0 = no cleanup, enforced by server)
- The existing Save Configuration button persists changes; dirty-state tracking is automatic

## Data Model

### New fields

```prisma
model EventType {
  cleanupDurationMinutes Int @default(0)   // admin-configured; 0 = no cleanup
}

model Booking {
  cleanupDurationMinutes Int @default(0)   // snapshot from EventType at creation
}
```

### Snapshot rationale

`Booking.cleanupDurationMinutes` captures the EventType value at the time of booking. Changing the EventType's cleanup duration later has no effect on existing bookings.

### Migration

`prisma/migrations/20260516090731_add_cleanup_duration_minutes/migration.sql`

## API Routes

### PUT /api/admin/calendar/config

Validates `cleanupDurationMinutes` on each event type:
- Must be a whole number
- Range: 0–480 inclusive
- Returns `400` with a descriptive message on failure

### POST /api/calendar/bookings

Snapshots `eventType.cleanupDurationMinutes` onto the new `Booking` at creation. No changes to the request payload.

### GET /api/calendar/availability (indirect)

`getSlotAvailabilities()` in `calendar-core.ts` now returns `status: "cleanup"` for time slots that fall within a booking's cleanup window but not the booking itself. The response includes two additional fields on every non-available slot:

| Field | Type | Description |
|---|---|---|
| `bookingStartTime` | `string \| undefined` | Actual start time of the booking slot (HH:mm) |
| `bookingEndTime` | `string \| undefined` | Actual end time of the booking slot, or cleanup window end for `"cleanup"` slots (HH:mm) |

These fields are used by the public calendar to correctly colour only the cells that the booking actually covers. Without them a single booking can mark multiple candidate slots as busy, causing cells to be painted beyond the booking's real end time (the "staircase effect").

## Conflict Detection

`effectiveOverlaps(slotA, cleanupA, slotB, cleanupB)` extends each slot's end by its cleanup minutes before comparing. Used in:

- `getSlotStatus()` — availability calendar; cleanup-only overlaps return `{ status: "cleanup" }`
- `evaluateBookingConflicts()` — booking creation/confirmation; candidate and existing bookings both use their snapshotted cleanup values

The existing `overlaps()` is unchanged and still used for `CalendarBlock` checks and internal slot conflict detection.

## Public Calendar Display

Cleanup slots are displayed in the public booking calendar as **"Site Preparation"** in warm orange, distinct from regular busy slots:

- `status: "pending" | "confirmed" | "tentative"` → existing colour scheme (unavailable)
- `status: "cleanup"` → warm orange (`#fff7ed` background, `#9a3412` text), labelled "Site Preparation"

The calendar legend includes a "Site Preparation" entry alongside the existing status dots.

Cell colouring uses `bookingStartTime`/`bookingEndTime` from the API response (not the candidate slot's times) to avoid the staircase effect where multiple candidate slots would colour cells beyond the booking's real end time.

## Admin UI Changes

- Event Types table: **Cleanup (min)** column added between Duration and Priority
- Delete action replaced with a compact icon button (trash icon, 34×34 px, red)
- "Add Event Type" and "Save Configuration" buttons separated from the table rows by a `border-top` divider with `margin-top: 16px`
- Column header left-padding corrected to 15 px (was 14 px) to align with card content accounting for the 1 px card border

## Acceptance Criteria

- [x] AC-1: Super admin can set `cleanupDurationMinutes` (0–480, whole number) per event type via the Event Types config UI
- [x] AC-2: Value persists through save/reload
- [x] AC-3: When a booking is created, `cleanupDurationMinutes` from the EventType is snapshotted onto the Booking
- [x] AC-4: A new booking whose start time falls within an existing booking's cleanup window is rejected with a conflict error
- [x] AC-5: The availability API returns `status: "cleanup"` for slots in a cleanup window
- [x] AC-6: Changing an EventType's cleanup duration does NOT retroactively affect existing bookings
- [x] AC-7: `cleanupDurationMinutes = 0` allows back-to-back bookings (backward-compatible default)
- [x] AC-8: Cleanup duration > 480 or non-integer is rejected by the config API with a 400 error
- [x] AC-9: Cleanup period may extend beyond room working hours without error
- [x] AC-10: Public calendar displays cleanup slots as "Site Preparation" in warm orange with a matching legend entry
- [x] AC-11: Calendar cells are coloured using actual booking times (`bookingStartTime`/`bookingEndTime`), not candidate slot times
- [x] AC-12: Availability API response includes `bookingStartTime` and `bookingEndTime` on all non-available slots

## Out of Scope

- Visual cleanup-period block in the admin booking calendar grid (future enhancement; public calendar already shows Site Preparation)
- Per-occurrence cleanup overrides for recurring bookings
- Cleanup time for admin-created `CalendarBlock` entries
