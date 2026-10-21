# Expert UX/UI Panel Audit — Royal MAS Arena (live site)

**Audited:** 22 Oct 2026 · **Target:** https://main.d8k1nfzx3tpc7.amplifyapp.com/ (`main` branch, Amplify)
**Method:** Live walkthrough in a real browser at 800 px (tablet / collapsed nav) and 375 px (iPhone) widths,
DOM + accessibility inspection via script, console review, then each finding traced back to source.
Nothing was submitted; one calendar slot was selected and left unsaved.

**Panel:** Jakob Nielsen · Jared Spool · Peter Tarka · Aurélien Salomon · Jony Ive

> The panel is a framing device. Every finding below was observed on the live site or read from the
> source file cited; the opinions attached to them are the panel's.

---

## Opening — first impressions

**Jony Ive:** It has a point of view, which is rarer than people think. Dark navy, one gold accent, a
heavy grotesque set against a soft italic. "The arena, made for you." You know immediately this is a
place, not a SaaS dashboard. I'd protect that.

**Jakob Nielsen:** I'd protect it too, but the first thing a visitor reads is *wrong*. The hero title
renders as **"The arena,."** — comma followed by the gold full-stop. Same on slide 4: **"A studio,."**
`src/components/hero-slider.tsx:18` and `:39` put a comma in `title`, then `:76` unconditionally
appends `<span className="punct">.</span>`. It's tiny, it's in 200 px type, and it's the first thing
everyone sees.

**Jared Spool:** And the second thing they read is a price that the booking page contradicts. That's
the one I'd lose sleep over. We'll get to it.

**Peter Tarka:** Visually the system is coherent on the redesigned pages — Home, Bookings, Contact.
But Events, FAQ and the 404 page are visibly a different generation. You feel the seam.

---

## Part 1 — Information architecture, navigation & findability

**Jakob Nielsen:** Every single page has the same `<title>` — "Royal MAS Arena" — and the same meta
description, "Sports and event venue website for Royal MAS Arena." I fetched `/`, `/about`,
`/activities`, `/facilities`, `/events`, `/bookings`, `/contact`, `/faq`, `/privacy`: identical. Set
once in `src/app/layout.tsx:11-12`; no page exports its own `metadata`. Browser tabs, history, bookmarks
and Google results are indistinguishable. There is also no `og:image`, so a WhatsApp share — which is
how a Colombo venue actually gets passed around — shows a bare link.

**Jared Spool:** Heading structure is the same story. `/`, `/about`, `/activities`, `/facilities`,
`/bookings` and `/contact` have **zero `<h1>`, `<h2>` or `<h3>` elements**. The giant "BOOK." and
"THE WEEK." are `<span>`s. A screen-reader user pressing `H` on the bookings page gets nothing; they
can't jump from "The Room" to "The Week" to "The Details". The older pages (`/events`, `/faq`,
`/privacy`) do have proper `<h1>`s — so the redesign actually regressed this.

**Jakob Nielsen:** The 404 is Next's default: "404 | This page could not be found." in dim grey,
centred in an empty navy field, no link home, no link to bookings. There's no `src/app/not-found.tsx`.
Low effort, real recovery value.

**Jony Ive:** I'll push back slightly on priorities. Titles and headings are hygiene — do them, of
course. But the IA question I'd ask is: why does the *bookings* page open with a full-height hero
("BOOK. the floor." + a paragraph + an assistance block) before the visitor sees a room or a calendar?
They've already decided to book. They clicked "Start Booking".

**Jared Spool:** Measured on a 375 px phone: the calendar section starts at **2,287 px** — almost three
full screens of scrolling — and the full page is **8,554 px**, about ten and a half screens. The
details form starts at 5,344 px. The visitor's job is "can I get the floor on Saturday?" and the answer
is three swipes away.

**Jakob Nielsen:** And the phone number in that bookings hero — "+94 70 442 1590" — is a plain `<p>`,
not a `tel:` link. On a phone, the one block that says "For assistance… the desk takes calls" is the
one block you can't tap to call. The live-strip number *is* a link, but the live strip is hidden below
700 px by design.

---

## Part 2 — The booking flow (`/bookings`)

**Jared Spool:** The trust problem first. Home page room cards (`src/app/page.tsx:63` and `:78`) are
hardcoded:

| | Home page says | Bookings page (from `PricingRule`) says |
|---|---|---|
| Main Arena | **LKR 18.5K/HR · DAY LKR 165K** · 1,200 SQM · "capacity up to 1,000" | 6 Hours **LKR 50,000** · Full Day **LKR 95,000 / 110,000** · Capacity **1,200** |
| Studio Room | **LKR 6.4K/HR · DAY LKR 56K** · **280 SQM** · "2,000 square foot" | 1 Hour **LKR 2,500** · Full Day **LKR 13,500** · Capacity 120 |

The home page quotes the Studio at *four times* the real full-day rate, and the Main Arena day rate at
almost double. Some people will bounce at 165K who would have booked at 95K. The Studio also claims
280 m² and 2,000 ft² (≈186 m²) in the same card. Main Arena capacity is 1,000 on Home and Facilities
(`src/app/facilities/page.tsx:73`) but 1,200 on Bookings. CLAUDE.md already says the bookings page must
derive pricing from `PricingRule` and never hardcode — the home page is the one place that rule
wasn't applied.

**Jakob Nielsen:** Heuristic #4, consistency, and frankly #1 — the system is showing a status that
isn't true. Fix: either fetch the real rows (the same `getRoomPricingRows()` used on Bookings) or
remove prices from Home and say "from LKR 2,500 · see rates".

**Jared Spool:** The event-type pills read **6 HOURS · FULL DAY (WEEKDAY) · BADMINTON · FULL DAY (WEEK
END)**. Two problems. One: Weekday and Weekend are modelled as separate event types even though the
data model has `dayType` on `PricingRule` precisely for this — so a customer can pick "Full Day
(Weekday)" and then click a Saturday. Two: the order doesn't match the pricing list directly above
it (Badminton, 6 Hours, Full Day Weekday, Full Day Weekend). "Badminton · LKR 1,000" also has no
duration, so the visitor can't tell if that's per hour, per court, or per session. That's admin
config rather than code, but the page could help: show the duration on every pricing row and pill.

**Jakob Nielsen:** On Main Arena, **WITH A/C is a disabled button with no explanation**
(`booking-calendar-flow.tsx:1336-1347` — `disabled={!availableAcModes.includes(mode)}`, empty
sub-label). It looks like a broken control. Either hide the toggle for rooms with one mode, or keep it
and label it "Not available in Main Arena".

**Jared Spool:** Vocabulary. The legend says **HELD** and **PREP**; the code's display label for
`cleanup` is "Site preparation" (CLAUDE.md says the public calendar should call it "Site
Preparation"), and the hover title for tentative is "Held". Customers don't know what a "held" slot
is — is it held *for them*? I'd use "Provisional" and "Setup / cleanup". And **"FIXTURE #2026-W43"**
in the hero (`:1142`) is decoration that reads like a reference number a customer should note down.

**Jakob Nielsen:** The week navigator re-labels its middle button: in the current week it reads
"WEEK 43 · NOW"; one week ahead it reads "WEEK 44 · GO TO TODAY". The same button means "you are
here" and "take me back" depending on state. Make it a constant "Today" button and show the week
number as plain text.

**Jared Spool:** The desktop grid starts at **04:00** and runs to 22:00 even though the Main Arena opens
at 06:00 — two-plus rows of hatched "closed" before the first real slot. On mobile it's worse: the
day view opens with four rows of "04:00 – 10:00 CLOSED [PICK]", each with a ghosted PICK button.
And hour labels mix "4, 5 … 12 PM, 1, 2" with "06:00–20:00" in the blocks — two time formats on one
grid.

**Jakob Nielsen:** On a fully-booked day the mobile view is a wall: every half-hour row reads
"CONFIRMED / Confirmed booking / [PICK]" with a disabled button — 28 identical rows for one booking.
The desktop grid already merges this into a single block; mobile should too: one row,
"Booked 06:00 – 20:00".

**Jakob Nielsen:** The **"FIX TO SUBMIT · 7 ITEMS"** panel is visible in red on first paint, before the
user has touched anything — including "Complete the human-check." It's `role="alert"`
(`:2206-2210`), so screen readers announce it on load and again on every keystroke that changes the
count. The *field* markers are correctly gated on `hasInteractedSubmit`; the panel isn't. Show it
neutral ("To submit you'll need: …") until first submit attempt, then turn it red, and use
`role="status"` / `aria-live="polite"`.

**Jared Spool:** The form fields have no `autocomplete`, `name` or `required` attributes — name, tel,
email are all `autocomplete=""`. On a phone that's four fields typed by hand when autofill could do
three of them. Add `autocomplete="name" | "tel" | "email"`, `inputmode="tel"`.

**Jony Ive:** And Turnstile — sold as invisible — rendered as a visible "Verify you are human"
checkbox in my session. That's Cloudflare's call per visitor, but it's another task stacked at the
very end of a long form. Fine to keep; just don't list it as a red error before the user has had a
chance to see it.

**Jared Spool:** The FAQ is out of date: "Go to the Bookings page, select your preferred space, then
continue to the Contact page to submit your enquiry." (`src/app/faq/page.tsx:7`). Bookings are
submitted on the bookings page now. Documentation lying about the core flow is worse than no FAQ.

---

## Part 3 — Home page & content pages

**Peter Tarka:** The home hero on a phone: "The arena," and the italic "made for you." collide —
the italic's ascenders overlap the display line, and the subtitle sits over the busiest part of the
photo (the ceiling ring) with no scrim behind it. "EXPLORE FACILITIES" is a ghost button whose
outline almost disappears against the photo. The gradient overlay needs to be stronger at the
bottom-left where the text lives.

**Jony Ive:** "THE TOUR. Three chapters" is lovely. But "FIND THE FLOOR" then repeats the room
pitch that `/bookings` makes again, with *different* numbers. Say it once, with real data.

**Peter Tarka:** Events and FAQ use the older layout — sentence-case "Events." headline, plain cards,
body-copy rhythm different from the Arena Court pages. Bringing them onto the `ac-page-hero` pattern
would finish the system.

**Jakob Nielsen:** Phone formatting varies: "+94 (0) 70 442 1590" in the strip, "+94 70 442 1590"
(spaced as mono digits) in assistance blocks, "+94 (0) 70 442 1590" on Contact. Pick one — the
international format without "(0)" is the one that dials correctly when tapped.

---

## Part 4 — Visual design, typography & cohesion

**Peter Tarka:** The type system is strong — Archivo 900 + Newsreader italic + Geist Mono is a good
triad. Two craft issues:
1. The mono eyebrows (`// BOOKINGS · MAIN ARENA · OCTOBER 2026`, `SLOT · 6 HRS · COLOMBO TIME`,
   pricing sub-lines "+ LKR 1,250 with A/C") are 10–11 px uppercase on navy. They're legible on a
   retina screen; on a mid-range Android at arm's length the A/C premium — actual money — is the
   smallest text on the page. Promote pricing information out of the eyebrow style.
2. The disabled PICK buttons on mobile are gold-outlined at low opacity — they still *read* as
   buttons. Disabled actions on rows that can't be booked should be removed, not dimmed.

**Jony Ive:** What would I remove? The "// " prefixes on eyebrows, the FIXTURE stamp, "EST · 2016"
badge competing with the slider counter, and on bookings the duplicated assistance block (it's
already in the footer). The page would lose nothing and the calendar would move up a screen.

**Jakob Nielsen:** I'll defend one piece of "decoration": the `★ YOURS` gold block with "UNSAVED ·
PENDING SUBMIT" after picking a slot is excellent feedback — clear, distinct, and honest about state.
Keep it. What's missing is that on anything narrower than the two-column desktop layout, the receipt
with the price is ~2,000 px below the grid, so you pick a slot and see no price change. A compact
sticky summary bar ("1 slot · LKR 50,000 · Continue ↓") would close that loop.

---

## Part 5 — Motion, micro-interactions & feedback states

**Aurélien Salomon:** The hero auto-advances every 5 s (`hero-slider.tsx:49`) with **no pause
control, no pause-on-hover/focus, and no `prefers-reduced-motion` handling** — `globals.css` has no
`prefers-reduced-motion` query at all. That's a WCAG 2.2.2 failure and, more practically, the
headline changes while someone is still reading the first one. The slide text also changes, so the
H1-equivalent of the page is a moving target. Pause on hover/focus, add a pause button next to
"01 / 04", and stop autoplay under reduced motion.

**Aurélien Salomon:** Loading: the CLAUDE.md notes the calendar can take seconds on a cold start
("WARMING UP THE COURTS"). On my run it loaded within ~5 s. When switching weeks there's no
in-grid skeleton — the old week's blocks clear and the grid is briefly empty, which reads as "no
bookings this week". The `skeleton-shimmer` keyframe already exists in `globals.css:3939`; reuse it
over the grid body during week fetches.

**Aurélien Salomon:** Selecting a slot snaps the gold block in with no transition. A 120 ms
scale-from-0.96 + fade would make it feel placed rather than appeared — but only after the
reduced-motion query exists.

**Jony Ive:** I'd be careful. Motion here should do one job: confirm. Don't add flourish to the
hero, add it to the moment someone commits to a slot.

---

## Part 6 — Accessibility & technical hygiene (observed)

- No `<h1>`–`<h3>` on 6 of 9 public pages (see Part 1).
- Same `<title>` / description on every route; no Open Graph image.
- Hero autoplay without pause; no `prefers-reduced-motion` anywhere.
- `role="alert"` blockers panel announced on load.
- Form inputs: no `autocomplete`, `name`, `required`; tel field has no `inputmode`.
- Disabled A/C toggle with no accessible explanation.
- Console: Clarity tries to load `https://c.bing.com/c.gif` and is blocked by CSP `img-src`. Harmless to
  users; either add `c.bing.com` to `img-src` or accept the noise.
- No horizontal overflow at 375 px — good. Focus-visible styles exist (23 rules in `globals.css`).

---

## Conclusions

**Jared Spool:** Fix the numbers. A venue site's only real job is "what does it cost, and is it
free?" — and the home page answers the first question wrongly.

**Jakob Nielsen:** Then the cheap, high-yield hygiene: titles, headings, 404, `tel:` links,
autocomplete, the red-on-load panel.

**Jony Ive:** Then reduce. Get the calendar on the first screen of `/bookings`. Collapse the
mobile day view. Remove the ornaments that look like data.

**Peter Tarka:** And finish the system — Events and FAQ onto Arena Court.

**Aurélien Salomon:** Motion last, and only after reduced-motion support exists.

---

## Prioritised recommendations

> **Status (22 Oct 2026):** P1 items #1–#9 are implemented on branch `claude/live-site-ui-ux-audit-cba4b8`. For #1, prices were removed from the home page rather than fetched live. The capacity shown on `/bookings` (1,200) is admin data in `RoomType.capacity`; check it against the 1,000 quoted elsewhere.

| # | Recommendation | Where | Expert(s) | Effort | Impact | Priority |
|---|---|---|---|---|---|---|
| 1 | Replace hardcoded home-page prices/capacity/area with `PricingRule`/`RoomType` data (or remove prices); fix 280 SQM vs 2,000 ft² and 1,000 vs 1,200 capacity | `src/app/page.tsx:53-80`, `facilities/page.tsx:73` | Spool, Nielsen | Low–Med | High | P1 |
| 2 | Fix "The arena,." / "A studio,." double punctuation | `hero-slider.tsx:18,39,76` | Nielsen, Tarka | Low | Med | P1 |
| 3 | Per-page `metadata` (title + description) and an `og:image` | each `src/app/*/page.tsx`, `layout.tsx` | Nielsen | Low | High | P1 |
| 4 | Real heading hierarchy (one `<h1>`, section `<h2>`s) on redesigned pages | Home, About, Activities, Facilities, Bookings, Contact | Nielsen, Spool | Low | High | P1 |
| 5 | Update stale FAQ booking instructions | `src/app/faq/page.tsx:7` | Spool | Low | Med | P1 |
| 6 | Blockers panel neutral until first submit attempt; `role="status"` instead of `alert` | `booking-calendar-flow.tsx:2206` | Nielsen | Low | Med | P1 |
| 7 | Hero slider: pause on hover/focus, pause button, respect `prefers-reduced-motion` | `hero-slider.tsx:48-51`, `globals.css` | Salomon, Nielsen | Low | Med | P1 |
| 8 | Make bookings-hero phone a `tel:` link; standardise phone format | bookings hero, footer, contact | Nielsen | Low | Med | P1 |
| 9 | Add `autocomplete` / `name` / `inputmode` to booking form fields | `booking-calendar-flow.tsx:~1950-2020` | Spool | Low | Med | P1 |
| 10 | Hide or explain the disabled WITH A/C toggle | `booking-calendar-flow.tsx:1333-1360` | Nielsen | Low | Med | P2 |
| 11 | Compress the bookings hero so the room picker/calendar is on the first screen (esp. mobile) | `/bookings` hero section | Ive, Spool | Med | High | P2 |
| 12 | Mobile day view: collapse contiguous booked/closed rows into one range row; drop disabled PICK buttons | `booking-calendar-flow.tsx:~1780-1830` | Nielsen, Tarka | Med | High | P2 |
| 13 | Clip grid rows to room working hours (no 04:00 start); one time format | grid render in `booking-calendar-flow.tsx` | Spool | Low–Med | Med | P2 |
| 14 | Plain-language legend: "Provisional", "Setup / cleanup"; remove FIXTURE stamp | `:67-69`, `:1142`, `:1459-1465` | Spool, Ive | Low | Med | P2 |
| 15 | Constant "Today" button in week navigator | week nav | Nielsen | Low | Low | P2 |
| 16 | Sticky compact booking summary on < 981 px | receipt aside | Nielsen, Salomon | Med | Med | P2 |
| 17 | Merge Full Day Weekday/Weekend into one event type using `dayType` pricing; show duration on every pill/row (admin config + small UI tweak) | admin Event Types + pricing rows | Spool | Med | Med | P2 |
| 18 | Branded `not-found.tsx` with links to Home and Bookings | `src/app/not-found.tsx` (new) | Nielsen | Low | Low | P3 |
| 19 | Move Events and FAQ onto Arena Court page-hero pattern | `src/app/events`, `src/app/faq` | Tarka | Med | Low | P3 |
| 20 | Stronger scrim behind hero text on mobile; fix title/italic overlap | `.ac-hero-*` in `globals.css` | Tarka | Low | Med | P3 |
| 21 | Week-change skeleton over grid body; subtle slot-placed animation (after #7) | calendar grid | Salomon | Low | Low | P3 |
| 22 | Allow `c.bing.com` in CSP `img-src` or ignore Clarity console error | `next.config.ts` | — | Low | Low | P3 |
