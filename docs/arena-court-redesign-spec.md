# Arena Court Redesign (Home Page + Site Chrome) — Feature Spec

## Overview

Implements the Claude Design "Arena Court Edition" (handoff bundle in `rmasa-website-design/`) for the **public site**. Pivots the public brand from the current warm beige/brown to a dark navy (`#06112E`) and gold (`#E8B73A`) palette with editorial-grade typography (Archivo, Newsreader, Space Grotesk, Geist Mono). Replaces the site-wide chrome (header + footer) and rebuilds the home page; non-home public pages keep their existing markup but inherit the new chrome and base palette (their inner content will look mismatched until they are redesigned in follow-up branches — out of scope here). The admin panel is **untouched** — it keeps its Tailwind look.

## Layout / UX

### Chrome (site-wide)

**Header** — two strips:
1. **Live strip** (top, `--ink`): pulsing green dot · "LIVE BOOKINGS DESK · OPEN 08:00–18:00" · address · phone · email · EN. Geist Mono, 11px, uppercase, gold accents.
2. **Logo + nav strip** (`--ink2`): cream `ac-logo-plaque` (light backplate behind dark wordmark) · pill-style nav items with active page highlighted in gold · "Book Now ↗" CTA on the right.

Mobile: live strip details collapse to phone+address. Nav becomes a hamburger drawer (re-uses existing `.menu-toggle` mechanic from `nav.tsx`).

**Footer** — 4-col grid:
- Logo plaque + 340-px about paragraph
- VISIT links · BOOKING links · OFFICE links
- Second row: ADDRESS · CONTACT (mono) · SOCIAL
- Gold hairline divider · copyright + edition mark in mono

### Home page (`/`)

```
┌─ HeroSlider ────────────────────────────────────┐
│  · 720px tall · 4 slides · 0.5s fade · auto-play 5s
│  · EST·2016·COLOMBO 07 stamp top-right
│  · Archivo 132px headline + 84px italic suffix
│  · Two CTAs: "Start Booking ↗" gold · "Explore Facilities" outline
│  · Bottom-right dot indicator + slide counter "01 / 04"
├─ Intro ─────────────────────────────────────────┤
│  · Centered Newsreader 38px lede + Space Grotesk sub
│  · "FOR RESERVATIONS · +94 70 442 1590"
├─ SectionCards (THE TOUR.) ──────────────────────┤
│  · 3-col grid: About / Activities / Facilities
│  · 240px image · gold CHAPTER ONE/TWO/THREE tag
│  · Display title + italic suffix · body · "Read more ↗"
├─ RoomCompare (FIND THE FLOOR.) ─────────────────┤
│  · 2-col grid: Main Arena (accent + "● MOST POPULAR") · Studio Room
│  · 64px stacked display name · best-for line · 3 bullets
│  · Meta row: sqm · LKR/hr · day rate
│  · CTA per card
├─ ClosingCTA ────────────────────────────────────┤
│  · "BOOK." 96px + "the floor today." italic 56px
│  · Sidebar: phone + "Or write to the bookings office →"
└─────────────────────────────────────────────────┘
```

### Design tokens

Palette (extends `:root` in globals.css):

| Token | Value | Use |
|---|---|---|
| `--ac-bg` | `#06112E` | page background |
| `--ac-ink` | `#08163A` | live strip + footer |
| `--ac-ink2` | `#0F2255` | nav strip + intro panel + room compare bg |
| `--ac-line` | `#1F3360` | hairlines |
| `--ac-card` | `#0E1F4A` | card backgrounds |
| `--ac-text` | `#E9ECF4` | body text |
| `--ac-text-dim` | `#9CA6BF` | secondary text |
| `--ac-text-mute` | `#6B7494` | tertiary / mono meta |
| `--ac-gold` | `#E8B73A` | brand accent |
| `--ac-gold-deep` | `#B8870A` | underlines |
| `--ac-live` | `#22D67C` | LIVE dot |
| `--ac-paper` | `#FAF7F0` | logo plaque |
| `--ac-hair` | `#E5DFD0` | logo plaque border |

Type families (loaded via `<link>` from `fonts.googleapis.com` per the design source):

| Family | Use |
|---|---|
| Archivo (400–900) | Display + nav labels |
| Newsreader (400–700) | Italic serif suffix + intro lede |
| Space Grotesk (400–700) | Body text |
| Geist Mono (400–500) | Eyebrows / meta / monospace |

## Data Model

None. UI-only change.

## API Routes

None.

## Acceptance Criteria

- [x] AC-1: Google Fonts (Archivo, Space Grotesk, Geist Mono, Newsreader) are loaded site-wide via `<link>` in `src/app/layout.tsx`.
- [x] AC-2: New `--ac-*` design tokens defined in `:root` in `src/app/globals.css`; `body` background is dark navy (`--ac-bg`) and text is `--ac-text`.
- [x] AC-3: `Nav` component renders the two-strip header from the design (live strip + logo/nav strip) with active-page gold pill, "Book Now ↗" CTA, and works in mobile drawer mode.
- [x] AC-4: `Footer` component renders the 4-col chrome from the design (logo + 3 link columns + second row of address/contact/social + copyright/edition strip).
- [x] AC-5: Home page hero renders 4 slides on a 720-px frame with the design's headline/italic-suffix/CTAs/corner stamp/slide indicator; auto-advances every 5s; manual dots work.
- [x] AC-6: Home Intro section renders centered Newsreader lede + Space Grotesk sub + mono phone line on `--ac-ink2`.
- [x] AC-7: SectionCards renders 3 cards (About / Activities / Facilities) with CHAPTER tag, image, display + italic title, body, "Read more ↗" gold underline.
- [x] AC-8: RoomCompare renders 2 cards with the design's stacked 64-px display names, bullets, mono meta row, and CTAs. Main Arena card shows the "● MOST POPULAR" badge and uses the `--ac-gold` outline + filled CTA; Studio Room uses the outline variant.
- [x] AC-9: ClosingCTA renders the "BOOK." display + italic suffix on the left and the "FOR ASSISTANCE" sidebar with phone + contact link on the right.
- [x] AC-10: Non-home public pages (`/about`, `/facilities`, `/activities`, `/events`, `/contact`, `/faq`, `/privacy`) render their inner content directly on the new Arena Court palette via the rewritten `.content-page` class — no white card, Archivo h1 with gold full-stop, gold links, mono breadcrumbs. The `/bookings` page is the one exception: its inner `BookingCalendarFlow` component still uses the legacy light theme — calendar rebuild deferred to a follow-up branch (see Out of Scope).
- [x] AC-11: Admin panel pages under `/admin/**` keep the white-card look via a new `.admin-content-page` class. Admin Tailwind classes are untouched.
- [x] AC-12: `npx tsc --noEmit` passes with no errors.
- [x] AC-13: `npm run lint` passes with no warnings.
- [x] AC-14: Spec file checkboxes are all `[x]` after implementation.

## Out of Scope

- Rebuilding the `/bookings` `BookingCalendarFlow` component (room picker, calendar grid, slot cells, recurrence selector, fee receipt, customer form) to match the design's `bookings.jsx` — separate follow-up branch.
- Bespoke per-page hero blocks for About / Facilities / Activities / Events / Contact (the design package has section-specific heroes; this branch only ships the generic `.content-page` treatment).
- Admin panel visual changes.
- Updating booking-calendar-flow.tsx, admin-calendar-console.tsx, or any data layer.
- Image asset re-export — re-uses existing `/public/rmasa/*.jpg` and `/public/rmasa/logo.png`.
- Updating SEO / Open Graph metadata.
- Responsive breakpoints below 480 px (current site doesn't have them; design only spells out desktop).
- Animation polish beyond the slider fade.
