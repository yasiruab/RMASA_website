# DB Bandwidth Fix — Plan

**Problem.** The single helper `readCalendarDb()` in
[`src/lib/calendar-store.ts`](../src/lib/calendar-store.ts) loads every
`Booking` joined to every `BookingSlot`, `BookingAmountBreakdown`,
`BookingOverride`, and `PaymentEntry`, plus every `RoomType`, `EventType`,
`PricingRule`, and `CalendarBlock`. It is called from **8 endpoints**, several
of which run on every public page-view or every admin click. The bookings
table will only grow, and Neon bandwidth is billed.

The admin UI compounds the problem by fetching the entire booking list into
the browser and paginating client-side. There is no server pagination
anywhere in the project today.

This plan replaces `readCalendarDb()` with targeted queries on every caller,
adds server pagination to the admin bookings list, and deletes the helper
once the last caller is migrated.

---

## Inventory of `readCalendarDb()` callers

| # | File | Runs on | What it actually needs |
|---|---|---|---|
| A | [`src/app/api/calendar/availability/route.ts`](../src/app/api/calendar/availability/route.ts) | Every public calendar render, every week change, every event-type switch | One room, one event type, that room's pricing rules, slots/blocks for the requested date only |
| B | [`src/app/api/calendar/config/route.ts`](../src/app/api/calendar/config/route.ts) | Every public bookings page-load | Rooms, event types, pricing rules — **no bookings, no blocks, no payments** |
| C | [`src/app/api/calendar/bookings/route.ts`](../src/app/api/calendar/bookings/route.ts) (POST) | Every public booking submission | Rooms, event types, pricing rules, blocks + slots for the *candidate date range only*, same room |
| D | [`src/app/api/admin/calendar/bookings/route.ts`](../src/app/api/admin/calendar/bookings/route.ts) GET | Every admin bookings desk open + every refresh | A *page* of bookings matching the active filter, plus rooms + event types for display |
| E | Same file, PATCH | Every approve/reject/save click | Just the single booking being edited + conflict-scoped slots |
| F | [`src/app/api/admin/calendar/blocks/route.ts`](../src/app/api/admin/calendar/blocks/route.ts) | Every blockout edit | Blocks only (currently re-reads everything) |
| G | [`src/app/api/admin/calendar/config/route.ts`](../src/app/api/admin/calendar/config/route.ts) | Every config save | Existing rooms / event types / pricing rules only — no bookings |
| H | [`src/app/api/admin/calendar/reports/route.ts`](../src/app/api/admin/calendar/reports/route.ts) | CSV export | Slots inside the requested date window only |
| I | [`src/app/admin/calendar/page.tsx`](../src/app/admin/calendar/page.tsx) | Every admin hub render | KPI counts, 90-day revenue window, recent audit log |

---

## Phase 1 — Public endpoints (biggest bandwidth win)

These three changes hit every public visitor; they're also the easiest to
land because the routes are small and have no admin UI dependencies.

### 1a. `/api/calendar/config` — never return bookings/blocks

**Current**: returns `{ rooms, eventTypes, pricingRules, bookings, blocks }`
via `readCalendarDb()`.

**Change**: return `{ rooms, eventTypes, pricingRules }` from three targeted
`findMany()` calls. Drop bookings + blocks from the response shape. Audit
[`booking-calendar-flow.tsx`](../src/components/calendar/booking-calendar-flow.tsx)
for any reference to `config.bookings` / `config.blocks` — none expected since
the calendar fetches availability separately, but verify before shipping.

### 1b. `/api/calendar/availability` — one room, one week

**Current**: `readCalendarDb()` then filters in
`getSlotAvailabilities()` ([calendar-core.ts](../src/lib/calendar-core.ts)).

**Change**: replace the read with:
- `roomType.findUnique({ where: { id: roomTypeId } })`
- `eventType.findUnique({ where: { id: eventTypeId } })` (+ priority)
- `pricingRule.findMany({ where: { roomTypeId, eventTypeId } })`
- `bookingSlot.findMany({ where: { booking: { roomTypeId }, date }, include: { booking: { select: { id, status, eventTypeId, cleanupDurationMinutes, eventType: { select: { priority } } } } } })`
- `calendarBlock.findMany({ where: { roomTypeId, date } })`

Build a minimal `CalendarDb`-shaped object in memory containing only these
rows and pass it to the existing `getSlotAvailabilities()`. This keeps the
business logic in `calendar-core.ts` unchanged.

**Note**: cleanup windows can extend past midnight, so the slot query
actually needs `date IN (requestedDate, requestedDate - 1 day)` so the
previous day's late bookings show their cleanup tail today. We can narrow to
`requestedDate` only if I verify `effectiveOverlaps()` doesn't span days —
flagging this as a thing to double-check while implementing.

### 1c. `/api/calendar/bookings` (POST) — scoped conflict check

**Current**: `readCalendarDb()` is fed to `evaluateBookingConflicts()`.

**Change**: compute the date set the candidate booking touches (after
recurrence expansion), then run a targeted load that includes only:
- The candidate room
- Event types referenced by the candidate room (for priority compares)
- Pricing rules for the candidate room
- Slots whose `(roomTypeId, date)` intersects the candidate's date set
- Blocks in the same scope

Pass this trimmed snapshot into the existing
`evaluateBookingConflicts()` call. The override-cascade insert stays as-is
inside the transaction.

---

## Phase 2 — Admin pagination + targeted PATCH

This is the harder change because [`admin-bookings.tsx`](../src/components/admin/sections/admin-bookings.tsx)
(1,956 lines) currently pages everything client-side.

### 2a. Server-paginated `/api/admin/calendar/bookings` GET

**New query params** (all optional):

| Param | Values | Default |
|---|---|---|
| `page` | 1, 2, 3, … | 1 |
| `pageSize` | 1-100 | 20 |
| `tab` | `all`, `pending`, `tentative`, `unpaid`, `part_paid`, `paid`, `overpaid`, `rejected`, `conflicts` | `pending` |
| `dateRange` | `all`, `today`, `last_7`, `last_30`, `custom` | `all` |
| `from` / `to` | `YYYY-MM-DD` (when `dateRange=custom`) | — |
| `search` | reference / customer name / email fragment | — |

**Response shape**:
```json
{
  "bookings": [...],          // current page only, full detail
  "total": 1247,              // total matching the filter
  "tabCounts": {              // for the tab strip badges
    "pending": 4, "tentative": 2, ...
  },
  "rooms": [...],             // small — full list
  "eventTypes": [...]         // small — full list
}
```

**Implementation notes**:

- Most tab filters translate cleanly to Prisma `where` clauses:
  - `pending`, `tentative`, `paid`, `unpaid`, `part_paid` →
    `where: { status / reconciliationStatus }`
  - `rejected` → `where: { OR: [{ status: "rejected" }, { slots: { some: { slotStatus: "rejected" } } }] }`
  - `confirmed` (effective) needs the derivation helper. Move
    `computeBookingEffectiveStatus()` to a server-side equivalent that runs
    in SQL where possible (status + slot-status grouping) — or, simpler,
    add a denormalized `effectiveStatus` column updated by the same writes
    that touch slots. **Recommendation**: start without the column, derive
    in a small post-query filter on the *current page*, and add the column
    later if it shows up in slow queries.
- `conflicts` tab needs a scoped conflict scan. Acceptable cost: this tab
  is opened on demand and conflicts only arise within overlapping date
  windows — limit the scan to bookings with `status IN (pending, tentative)`
  in the active date range.
- `overpaid` is derived (`effectivePaid > amountDue`). Pull bookings whose
  `paidAmountLkr > 0` and `reconciliationStatus IN (paid, part_paid)` and
  evaluate in JS on the page. Acceptable because the candidate set is small.
- `tabCounts` are independent `prisma.booking.count({ where })` calls — one
  per tab. 9 lightweight counts is much cheaper than returning all rows.

### 2b. Admin bookings component refactor

[`admin-bookings.tsx`](../src/components/admin/sections/admin-bookings.tsx)
changes:
- Replace the single `loadAll()` fetch with a paginated fetch keyed on
  `(tab, dateRange, from, to, search, page)`.
- Remove client-side filtering — the server returns exactly the right rows.
- Add a pagination footer (Prev / Page N of M / Next, "20 per page" hint).
- When the user clicks a queue row, **fetch the full single booking** from a
  new `GET /api/admin/calendar/bookings/[id]` endpoint (currently the
  payment endpoint exists at `/[id]/payments` — add a sibling root GET).
  This lets the queue rows themselves carry a slimmer payload (no payment
  entries, no breakdowns) and the detail pane lazy-loads the heavy bits.
- Initial filter from URL params (`?id`, `?approval`, `?payment`,
  `?conflict`) stays — they map to the new query params.

### 2c. PATCH handler stops re-reading everything

[`src/app/api/admin/calendar/bookings/route.ts`](../src/app/api/admin/calendar/bookings/route.ts)
currently does `await readCalendarDb()` to find one booking and run the
override-conflict check. Replace with:
- `prisma.booking.findUnique({ where: { id }, include: { slots, amountBreakdown, paymentEntries } })`
- For confirm-path conflict scan: same scoped read as Phase 1c above
  (`roomTypeId` + candidate date range)

---

## Phase 3 — Hub, blocks, config, reports

### 3a. `/admin/calendar` hub page

Replace `readCalendarDb()` with:
- 5 `prisma.booking.count({ where })` calls for the KPI tiles
- 1 `prisma.calendarBlock.count()` for the "Active blockouts" tile
- A targeted 90-day window query for `buildRevenueModel()`:
  ```ts
  prisma.booking.findMany({
    where: { createdAt: { gte: ninetyDaysAgo } },
    include: { amountBreakdown: true, paymentEntries: true, slots: { select: { slotStatus: true } } },
  })
  ```
- The existing audit-log query is already targeted — keep as-is.

### 3b. `/api/admin/calendar/blocks` POST / DELETE

The current route reads the entire DB just to return the updated blocks
list after a single insert/delete. Change to: do the insert/delete, then
return only the blocks (`calendarBlock.findMany()` — small, scoped to that
table only).

### 3c. `/api/admin/calendar/config` PUT

Reads the full DB to validate config edits. Change to read only the three
config tables that the validation actually touches.

### 3d. `/api/admin/calendar/reports`

Push the date filter into SQL — replace the in-JS slot filter with
`prisma.bookingSlot.findMany({ where: { date: { gte: from, lte: to } }, include: { booking: { include: { amountBreakdown, paymentEntries, eventType, roomType } } } })`. The
shared `computeSlotAllocations()` helper continues to derive the per-slot
financials.

---

## Phase 4 — Delete `readCalendarDb()`

Once Phases 1-3 land and the helper has no callers, delete it from
[`src/lib/calendar-store.ts`](../src/lib/calendar-store.ts). Also delete
`CalendarDb` from [`src/lib/calendar-types.ts`](../src/lib/calendar-types.ts)
**unless** it's still useful as the shape `calendar-core.ts` expects — in
that case keep the type but rename to something like `CalendarSnapshot` so
it's clear it's a per-request scoped object, not "the whole DB".

---

## What I am NOT changing

- **Write helpers** (`insertBookingWithCascade`, `updateBookingStatus`,
  `updateBookingSlotsBatch`, `replaceCalendarConfig`, payment-entry POST):
  already targeted, already race-safe. Out of scope.
- **Calendar business logic** (`calendar-core.ts`): unchanged. Every fix
  above feeds a *trimmed but same-shaped* `CalendarDb` into the existing
  helpers (`getSlotAvailabilities`, `evaluateBookingConflicts`,
  `effectiveOverlaps`). No business logic rewrites.
- **Public booking calendar UI**
  ([`booking-calendar-flow.tsx`](../src/components/calendar/booking-calendar-flow.tsx)):
  already fetches availability per week (good); already fetches config once
  on mount (good once Phase 1a trims the response). The only change is the
  response shape from `/api/calendar/config` losing `bookings` + `blocks` —
  verify no client code reads them. **Recurrence preview**: currently
  computed client-side from expanded dates; conflicts are checked server-
  side at submit time. Keep this — the user's note about "server query for
  conflicts" is already how submit works. No client behaviour change needed.
- **Admin write paths**: behaviour identical. The only changes are read
  scoping + pagination in GET.

---

## Risk register

| Risk | Mitigation |
|---|---|
| Phase 2b is a big refactor of a 1,956-line component | Land Phase 2a (server endpoint) first behind a feature flag or simply as an additive endpoint that the old code can opt into. Migrate the component in a follow-up commit on the same PR so we can revert independently. |
| Effective-status filter (`pending`/`tentative`/`confirmed`) doesn't translate cleanly to SQL | Acceptable: fetch a slightly wider candidate set, filter on the current page. Re-evaluate if the wider set becomes large. |
| Availability cleanup-window edge case (cleanup spilling past midnight) | Verify against `effectiveOverlaps()` before shipping Phase 1b. If it can spill, widen the date query by one day. |
| `/api/calendar/config` losing `bookings` may break a hidden caller | Grep the client for `config.bookings` / `config.blocks` first; if anything reads them, fix the caller first. |
| Pagination changes URL semantics for shared admin links | Keep existing query params (`?id`, `?approval`, `?payment`, `?conflict`) working — translate them in the new endpoint. Add `?page` as additive. |

---

## Order of work (recommendation)

1. **PR 1** — Phase 1 (public endpoints). Smallest diff, largest visitor-side
   bandwidth win, lowest risk.
2. **PR 2** — Phase 2 (admin pagination + scoped PATCH). Largest refactor;
   the new endpoint can ship first, the component swap follows.
3. **PR 3** — Phase 3 (hub, blocks, config, reports).
4. **PR 4** — Phase 4 (delete `readCalendarDb()` + cleanup).

Each PR is independently revertable. Each one measurably reduces Neon
egress on its own.
