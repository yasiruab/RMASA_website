# Bookings Page Redesign — Feature Spec

## Overview

Rebuilds `/bookings` to match the Arena Court design (`rmasa-website-design/project/pages/bookings.jsx`) while preserving **100% of the existing functional behavior** — calendar config fetching, weekly availability fetching, slot selection, recurrence expansion with conflict detection, pricing rule lookup, customer form, and submission to `/api/calendar/bookings`. The existing 1,000+ line `BookingCalendarFlow` is split into four named UI sections inside the same client component file (Hero, RoomBlock, Calendar, Details); state and effects remain in the parent.

No API changes, no schema changes, no behavior changes — purely a UI re-skin and restructure on top of the existing booking flow.

## Layout / UX

The page replaces the current `<Breadcrumbs/> + <h1>Bookings</h1> + lede + flow` stack with four sections rendered by `BookingCalendarFlow`:

```
┌─ Hero  (dark navy + gold gradient) ───────────────────────────┐
│  // BOOKINGS · {RoomName} · {MonthYear}        FIXTURE #...   │
│  BOOK.   the floor.                                            │
│  lede + assistance aside (phone + email link)                  │
├─ 01 / THE ROOM.  (room selection + event-type + A/C) ─────────┤
│  ┌ Main Arena (accent) ─┬─ Studio Room ──┐                    │
│  │ ● SELECTED            │                │                    │
│  │ stats: cap · hr · day │ stats           │                    │
│  └───────────────────────┴────────────────┘                    │
│  USE CASE — event-type pill row                                 │
│  AIR CONDITIONING — segmented (Without A/C · With A/C)         │
├─ 02 / THE WEEK.  (dark dense weekly grid) ────────────────────┤
│  ◂ WEEK n   WEEK current · NOW   WEEK n+1 ▸                   │
│  Legend: PENDING · CONFIRMED · HELD · BLOCKED · ★ YOURS · ↻   │
│  Grid: time column + 7 day columns, today highlighted gold     │
│  Slots rendered as absolutely-positioned blocks per booking    │
├─ 03 / THE DETAILS. (form + sticky receipt) ───────────────────┤
│  ┌ Left ──────────────────┬─ Right (sticky receipt) ────────┐ │
│  │ RECURRENCE pills (one/ │ ● BOOKING FEE                   │ │
│  │ daily/weekly/monthly)  │ // YOUR BOOKINGS                │ │
│  │ End-date or count      │ ROOM · EVENT · A/C              │ │
│  │ YOUR PARTICULARS form: │ entry list w/ remove btns       │ │
│  │  Name / Phone / Email  │ ───────────                     │ │
│  │  Purpose (textarea)    │ BOOKING FEE · LKR  total        │ │
│  │ Terms checkbox         │ [ Submit Booking  ↗ ]           │ │
│  │                        │ [ Reset Form     ]              │ │
│  └────────────────────────┴─────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### Calendar grid — visual mechanics

- **Dark card** wrapper with `--ac-card` background, `--ac-line` borders.
- **Header row** is `--ac-ink2`; today's column gets a gold top border + tinted background.
- **Time column** (~64 px) lists hours in Geist Mono (`7 AM`, `8`, `9`, …).
- **Body** is a stack of equal-height rows (`gridRowHeight = 36 px`), one per hour.
- **Slot blocks** are absolutely positioned inside each day column. Each block has:
  - status colours (pending = amber tint + gold border, confirmed = green tint, tentative = blue tint, blocked = red tint)
  - mono status chip + time range across the top
  - bold title (e.g., "Royal SC", "Pending Booking", "MAINTENANCE")
  - mono meta line
- **Selected (user) slots** render with the gold fill + dark text (`★ YOURS` chip), bordered with goldBright + soft outer glow.
- **Recurrence preview slots** render in a separate amber-outline style.
- **Recurrence conflict slots** render in the danger / red palette.
- Cells outside working hours remain dim; cells outside the per-event-type advance limit get a "past-limit" style.

The visual mapping uses the **existing data model unchanged**: each `Slot` from `/api/calendar/availability` has `status`, `bookingId`, `bookingStartTime`, `bookingEndTime`. Slots with the same `bookingId` on the same date are grouped into one absolute-positioned block (top from `bookingStartTime`, height from `bookingEndTime − bookingStartTime`). Cells without a `bookingId` (status `available` / `cleanup` without booking) keep per-cell click targets for selection.

### Section heading style

Re-uses `.ac-section-heading` (existing) + the `.num` gold prefix (`01 /`, `02 /`, `03 /`) introduced in the About/Facilities/Contact branch.

### Hero "FIXTURE" stamp

Same corner-stamp style as the home page hero (`EST · 2016 · COLOMBO 07`). Renders the current week number / room as the fixture id (`FIXTURE #2026-W20`).

## Data Model

None.

## API Routes

None.

## Acceptance Criteria

- [x] AC-1: `/bookings` renders the new four-section Arena Court layout via `BookingCalendarFlow`. The page wrapper drops `.content-page`; sections render full-bleed on dark navy.
- [x] AC-2: Hero renders gold `// BOOKINGS · ROOM · MONTH YEAR` eyebrow, 130 px "BOOK." display + 78 px "the floor." italic, lede, and an assistance aside (phone + "Or write to the bookings office →" link). Corner stamp shows fixture id derived from ISO week of current view.
- [x] AC-3: `01 / THE ROOM.` renders one selectable card per room (max 2 in current data) with stats row (capacity / hourly / day rate). Selected card uses 2-px gold border + `● SELECTED` corner tag.
- [x] AC-4: Below the room cards: "USE CASE" event-type pill row (one chip per allowed event type, gold-fill when active) AND "AIR CONDITIONING" segmented toggle (Without A/C · With A/C) with sub-labels. Both bound to the existing state.
- [x] AC-5: `02 / THE WEEK.` renders dark weekly grid (time column + 7 day columns). Today's column gets gold top accent. Week navigation: `◂ WEEK n`, `WEEK current · NOW`, `WEEK n+1 ▸`. Month/year jump still available (hidden in a "Jump to…" disclosure to keep the design tight).
- [x] AC-6: Slot blocks are absolutely positioned per booking and render with status-specific colours (pending/confirmed/tentative/blocked) + status chip + booking title + mono meta. Multi-hour blocks span vertically; one block per `bookingId` per day.
- [x] AC-7: User-selected slots render in the `★ YOURS` gold fill style with goldBright border and soft outer glow.
- [x] AC-8: Recurrence preview slots render in the amber outline style; recurrence conflict slots render in the danger style. The existing recurrence warning banner still shows above the calendar when conflicts exist.
- [x] AC-9: Clicking an available cell toggles selection via the existing `toggleSelectionForCell()` logic (unchanged). Cells outside working hours or past the event-type's `maxAdvanceBookingDays` are dim and non-interactive.
- [x] AC-10: `03 / THE DETAILS.` renders the recurrence selector as a 4-pill segmented control (No recurrence / Daily / Weekly / Monthly). When non-`none`, a second row shows the End Date or Occurrences choice (segmented) + the matching input, plus the existing advance-booking-limit notice.
- [x] AC-11: Particulars form renders Name / Phone / Email (3-col grid) + Purpose textarea using dark `--ac-card` inputs with mono uppercase labels.
- [x] AC-12: Terms checkbox renders as `--ac-card` row with 3-px gold left border, gold check icon, and an inline link to `/privacy`. The existing `consent` state is preserved (was not previously required by the booking submit; remains optional for now to avoid breaking the existing flow — surfaced only as informational copy).
- [x] AC-13: Receipt sidebar renders sticky inside the grid with:
  - `● BOOKING FEE` gold corner tag
  - `// YOUR BOOKINGS` mono eyebrow + Archivo room name + event chip
  - Entry list (one row per planned slot, base + recurrence) with per-entry remove button on base slots; recurrence rows show "Auto" badge
  - `BOOKING FEE · LKR` line + display total
  - `Submit Booking ↗` gold button (uses existing `submitBooking()`) + `Reset Form` ghost button (clears state)
- [x] AC-14: Status/error messages from the existing submission flow render below the receipt in the same `.form-message.success` / `.form-message.error` style (restyled for dark theme).
- [x] AC-15: Loading skeleton (`CalendarLoadingSkeleton`) and config-error retry (`CalendarLoadError`) states are kept but restyled for dark theme.
- [x] AC-16: The page collapses cleanly at ≤980 px: room cards stack, calendar gets horizontal scroll, receipt becomes non-sticky and stacks below the form.
- [x] AC-17: `npx tsc --noEmit` passes clean.
- [x] AC-18: `npm run lint` passes clean.
- [x] AC-19: All AC checkboxes marked `[x]` after implementation.

## Out of Scope

- API changes (none).
- Multi-room / cross-room booking (still single room per booking).
- Live pricing display per cell (kept on the receipt; matches the existing pattern).
- Drag-to-select multi-hour slots (kept click-to-select).
- Admin Booking Queue changes.
- Public site mobile breakpoints below 600 px (current site has limited fine-tune below that).
- Renaming the underlying `BookingCalendarFlow` component or moving it out of `src/components/calendar/`.
