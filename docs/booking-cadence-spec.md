# Booking Cadence — Feature Spec

## Overview

Each room gets a **booking cadence** of 30 or 60 minutes that controls which start
times customers can book. Allowed starts are counted from the room's opening time:
opening 08:30 with 60-minute cadence allows 08:30, 09:30, 10:30 … — never 09:00 or
10:00. Today every room uses a fixed 30-minute step (`SLOT_STEP_MINUTES` in
`calendar-core.ts`); this feature turns that constant into a per-room setting.
To support openings like 08:30, room opening and closing times may now be on the
hour or half hour (`:00` / `:30`), not only on the hour.

Cadence controls start times only. Event durations and cleanup times are unchanged,
so some combinations leave short unused gaps. The admin sees a warning about these
but they never block saving.

## Layout / UX

### Admin — Rooms page (`/admin/calendar/rooms`)

A new **START EVERY** column is added between CLOSING TIME and CAPACITY: a select
with `30 min` / `60 min`.

Opening and closing time pickers accept `:00` and `:30` (step 30 minutes instead of
60).

```
ROOM NAME     OPENING   CLOSING   START EVERY   CAPACITY   DESCRIPTION
[Main Arena]  [08:30]   [20:00]   [60 min ▾]    [1200]     [The full floor…]   DELETE
  ⚠ Last start time is 18:30. The time from 19:30 to 20:00 cannot be booked.
  ⚠ "Full Day": each booking + cleanup is 105 min. 15 min will be empty after each booking.
[Studio Room] [06:00]   [18:00]   [30 min ▾]    [120]      [e.g. …]            DELETE
```

Warnings show under the room row, update live as the admin edits, and never block
Save. All warning text is short, simple English for non-native readers.

**Gap warnings** (computed on the client from the current form values):

| When | Message |
|---|---|
| The last allowed start + shortest event ends before closing time, so the end of the day cannot be used | `Last start time is {HH:MM}. The time from {HH:MM} to {close} cannot be booked.` |
| An event type for this room has (duration + cleanup) not a multiple of the cadence | `"{event name}": each booking + cleanup is {N} min. {G} min will be empty after each booking.` |

The event-type check uses the event types that apply to this room (room-specific
ones plus ones with no room set). The end-of-day message uses the shortest of those
event types, so it shows at most once per room: last start = the last cadence start
where `start + duration ≤ close`, and it shows only when `last start + duration` is
before closing time.

**Change warning** (shown after the admin changes cadence or opening time of an
existing room, before Save):

> `{N} future bookings in this room do not start on the new times. They will not change. Only new bookings use the new times.`

"Future bookings" means active (`pending` / `tentative` / `confirmed`) slots dated
today or later whose start time is off the new cadence grid. The count comes from
the server (see API). When N = 0, nothing is shown.

### Public — bookings calendar

- Allowed starts for the selected room follow its cadence.
- The grid keeps its 30-minute rows. On a 60-minute room, a row that is **not** an
  allowed start is still clickable if a valid start exists after it: clicking it
  **snaps forward** to the next allowed start. Example (opening 08:30, 60 min):
  clicking the 09:00 row selects 09:30–10:30.
- If the snapped-to slot is not available (booked, blocked, cleanup) the existing
  "Cannot select this slot (…)" error shows. The calendar does not keep searching
  further forward.
- If there is no allowed start after the clicked row that fits before closing time,
  the row is not clickable (same look as today's non-fitting rows).
- Same behaviour in the mobile day view. A snapped row shows its own time and a
  second line `Books {start} – {end}` so the customer sees what PICK will book.
- Opening / closing times on `:30` render correctly: rows before opening and at or
  after closing get the existing CLOSED hatch at half-hour precision.

## Data Model

`RoomType` gets one new column:

```prisma
model RoomType {
  …
  bookingCadenceMinutes Int @default(30)
}
```

Migration `…_room_booking_cadence` adds the column with default 30, so all existing
rooms keep today's behaviour exactly. No booking data changes. Existing bookings are
never modified, re-validated or moved when cadence or opening time changes.

TypeScript: `RoomType.bookingCadenceMinutes: BookingCadence` where
`type BookingCadence = 30 | 60` in `calendar-types.ts`, plus an exported
`BOOKING_CADENCE_OPTIONS = [30, 60] as const`.

`SLOT_STEP_MINUTES` is removed; `generateSlotsForDuration()` takes the cadence as a
parameter. Every place that builds a `RoomType` from a Prisma row passes the new field
through (store, config routes, bookings routes, blocks route).

## API Routes

### `GET /api/calendar/config` (public) and `GET /api/admin/calendar/config`
Room objects gain `bookingCadenceMinutes`.

### `PUT /api/admin/calendar/config` (super admin)
- Each room must have `bookingCadenceMinutes` ∈ {30, 60}; else 400
  `Room "{name}": start every must be 30 or 60 minutes.`
- Opening and closing times must match `^\d{2}:(00|30)$`; else 400
  `Each room must have working times on the hour or half hour (HH:00 or HH:30).`
- Opening time must be before closing time (existing behaviour kept if already
  checked; added if not).
- Audit log entry unchanged in shape (the full new config is already logged).

### `POST /api/calendar/bookings` (public)
New server-side check, after the existing working-hours check: every selected slot's
start time must be `opening + k × cadence` for a whole number k ≥ 0. Else 400
`Selected slot {date} {start}-{end} does not start at an allowed time for this room.`
This closes the current gap where the API accepts any start time inside working
hours. Recurrence-expanded slots share the base slot's start time, so they pass
automatically.

### `GET /api/admin/calendar/rooms/[id]/off-cadence?startTime=HH:MM&cadence=30|60` (admin, new)
Returns `{ count: number }` — active future slots (`date ≥ today` Colombo time,
effective slot status not rejected / cancelled_override) in this room whose start
time is not on the grid defined by the query params. Used only for the change
warning. `requireAdmin()` guard; 400 on bad params. Query: `bookingSlot.findMany`
scoped by `booking.roomTypeId` and `date ≥ today`, selecting `startTime` only.
Read-only, not audit-logged.

## Acceptance Criteria

- [x] AC-1: Migration adds `RoomType.bookingCadenceMinutes` default 30; existing rooms read back as 30.
- [x] AC-2: Rooms page shows a START EVERY select (30 / 60) per room; value saves and reloads.
- [x] AC-3: Opening / closing pickers accept `:00` and `:30`; the config PUT accepts `HH:30` and rejects other minutes with 400.
- [x] AC-4: Config PUT rejects cadence values other than 30 / 60 with 400.
- [x] AC-5: `generateSlotsForDuration()` produces starts at `opening + k × cadence` only. Unit tests (on the pure helpers in `booking-cadence.ts`, since `calendar-core.ts` uses `@/` imports the Node test runner can't resolve): opening 08:30 / 60 min → 08:30, 09:30 …; opening 06:00 / 30 min → same as today.
- [x] AC-6: Public calendar: on a 60-min room opening 08:30, clicking the 09:00 row selects 09:30–10:30 (desktop and mobile).
- [x] AC-7: Public calendar: clicking an allowed-start row selects that start (no snap).
- [x] AC-8: Public calendar: if the snapped-to slot is busy, the existing "Cannot select this slot" error shows and nothing is selected.
- [x] AC-9: Public calendar: rows with no allowed start after them that fits before closing are not clickable.
- [x] AC-10: Public calendar: a room opening at 08:30 shows the 08:00 row as CLOSED and 08:30 as open (half-hour precision), and closing at 19:30 marks 19:30 onwards as CLOSED.
- [x] AC-11: `POST /api/calendar/bookings` rejects a slot whose start is off the room's cadence grid with 400; on-grid slots still succeed.
- [x] AC-12: Rooms page shows the end-of-day gap warning when applicable, in the specified simple English wording.
- [x] AC-13: Rooms page shows the per-event-type gap warning when (duration + cleanup) is not a multiple of cadence.
- [x] AC-14: Changing cadence or opening time of an existing room shows the change warning with the count from the off-cadence endpoint; hidden when count is 0.
- [x] AC-15: Warnings never block Save.
- [x] AC-16: Existing bookings are untouched after a cadence change: they still show on the public calendar and admin views at their original times and still block conflicting slots.
- [x] AC-17: Off-cadence endpoint requires admin auth (401/403 otherwise) and validates params.
- [x] AC-18: `npm test`, `npx tsc --noEmit`, `npm run lint` pass; CLAUDE.md updated.

## Out of Scope

- A 15-minute cadence (would need a finer public calendar grid; left for later).
- Cadence per event type or per day of week.
- Moving, re-validating or notifying customers about existing bookings after a change.
- Letting a booking start right after the previous booking + cleanup when that time
  is off-cadence (gaps are accepted, only warned).
- Admin schedule view (`admin-schedule.tsx`) layout changes — it is read-only and
  already shows bookings at their real times.
- Server-side check that `endTime = startTime + event duration` (existing behaviour,
  not changed here).
