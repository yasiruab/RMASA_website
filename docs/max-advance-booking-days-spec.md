# Max Advance Booking Days — Feature Spec

## Overview

Each event type can now have a maximum advance booking window, expressed in days. When set to a value greater than 0, the public booking calendar disables dates beyond `today + maxAdvanceBookingDays`, and the booking creation API rejects any submission that includes a slot beyond that window. A value of 0 means no limit. The setting is configured per event type by super-admins and applies immediately to new bookings — existing bookings are unaffected.

## Layout / UX

The Event Types admin section gains an **Advance (days)** column between Cleanup and Priority:

```
| Name       | Applies To | Duration (hrs) | Cleanup (min) | Advance (days) | Priority | Actions |
|------------|------------|----------------|---------------|----------------|----------|---------|
| Badminton  | Hall       | [2]            | [30]          | [30]           | [1]      | Delete  |
| Conference | All Rooms  | [4]            | [60]          | [365]          | [2]      | Delete  |
```

- Input: `type="number"`, `min=0`, `step=1`
- Range: 0–3650 (0 = no limit; 10 years max)
- Default for new event types: **365 days**
- Blank input coerces to 365

### Public Calendar Enforcement

After the customer selects a room and event type:
- Calendar day columns beyond `today + maxAdvanceBookingDays` are greyed out with `pointer-events: none`
- The "Next week" navigation button is disabled when the next week starts beyond the limit
- Clicking a past-limit cell shows an error: "This date is outside the available booking window."
- Pre-submit validation blocks submission if any selected slot exceeds the limit

## Data Model

### New field

```prisma
model EventType {
  maxAdvanceBookingDays Int @default(365)   // 0 = no limit; applied at booking creation
}
```

No snapshot on `Booking` — the check runs only at creation time. Changing the limit never retroactively affects existing bookings.

### Migration

`prisma/migrations/20260516225909_add_max_advance_booking_days/migration.sql`

## API Routes

### PUT /api/admin/calendar/config

Validates `maxAdvanceBookingDays` on each event type:
- Must be a whole number
- Range: 0–3650 inclusive
- Returns 400 with a descriptive message on failure

### POST /api/calendar/bookings

After recurrence expansion, calls `assertAdvanceBookingLimit(expandedSlots, eventType)` from `calendar-core.ts`. Returns 400 if any expanded slot date exceeds `today + maxAdvanceBookingDays`.

### GET /api/calendar/config (public)

The `maxAdvanceBookingDays` field is included on each event type in the response. The public booking calendar reads this to compute `maxDateStr` client-side.

## Public Calendar Changes (`booking-calendar-flow.tsx`)

- Local `EventType` type includes `maxAdvanceBookingDays: number`
- `maxDateStr` memo computed from selected event type; `null` when no limit
- "Next week" button disabled when `formatDate(addDays(weekStartDate, 7)) > maxDateStr`
- Day column headers get `gc-day-past-limit` class (opacity 0.4) when `date > maxDateStr`
- Cells get `past-limit` class (greyed, pointer-events: none) when `date > maxDateStr`
- `toggleSelectionForCell` returns early with an error for past-limit dates
- Pre-submit guard prevents form submission if any selected slot exceeds limit

### Recurrence enforcement

- `maxOccurrences` memo: steps through the selected frequency from the latest base slot date, counting how many repetitions fit within `maxDateStr`; returns 26 (uncapped) when no limit applies
- End date `<input type="date">` gets `max={maxDateStr}` — native picker greys out dates beyond the window
- Occurrences `<input type="number">` gets `max={Math.min(26, maxOccurrences)}` — caps the spinner at the window boundary
- Two clamping `useEffect`s automatically trim `recurrenceEndDate` / `occurrences` when the event type changes to one with a tighter limit
- An info notice (`recurrence-limit-notice`) renders inside the recurrence block whenever `maxDateStr !== null`, stating the day limit and exact cutoff date

## Acceptance Criteria

- [x] AC-1: Super admin can set `maxAdvanceBookingDays` (0–3650, whole number) per event type; default for new types is 365
- [x] AC-2: Blank input in the admin form coerces to 365 (not 0)
- [x] AC-3: Value persists through save/reload
- [x] AC-4: Public booking calendar disables week navigation beyond `today + maxAdvanceBookingDays` for the selected event type
- [x] AC-5: Calendar cells beyond the limit are greyed/disabled; clicking them shows an error
- [x] AC-6: Disabling is based on the customer's selected event type (switching event type updates the limit in real time)
- [x] AC-7: A booking whose slot date exceeds the limit is rejected with a 400 error (server-side safety net)
- [x] AC-8: Recurring bookings whose expanded slots extend past the limit are also rejected
- [x] AC-9: Changing the limit does NOT affect already-created bookings
- [x] AC-10: `maxAdvanceBookingDays > 3650` or non-integer rejected by the config API with a 400 error
- [x] AC-11: `maxAdvanceBookingDays = 0` means no limit; navigation and cells are unrestricted
- [x] AC-12: `npx tsc --noEmit` and `npm run lint` pass clean

## Out of Scope

- Per-room advance booking limits (limit is per event type only)
- Admin-panel booking creation exemption from the limit
- "Booking in the past" validation
- Visual indicator in the public calendar showing the exact cutoff date
