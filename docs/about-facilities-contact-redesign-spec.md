# About / Facilities / Contact Pages — Feature Spec

## Overview

Rebuilds `/about`, `/facilities`, and `/contact` to match the Arena Court design (`rmasa-website-design/project/pages/about.jsx`, `facilities.jsx`, `contact.jsx`). Each page becomes a multi-section editorial layout with its own hero, dark navy + gold palette, and Archivo/Newsreader/Geist Mono typography — consistent with the home page shipped in `feature/arena-court-redesign`. The Contact page preserves its functional form (`ContactForm` component, `/api/contact` POST, validation) and a real Google Maps iframe (the design's grid-pattern fake map is a prototype placeholder only).

## Layout / UX

### `/about`

```
┌─ Hero (assets/about.jpg darkened) ───────────┐
│  // ABOUT THE ARENA
│  ABOUT.  140px display + gold full-stop
│  a versatile floor.  64px italic
│  lede paragraph
├─ FactStrip (4 stats, dark) ──────────────────┤
│  1,000 / 2,000 / LKR 150M / 2016
├─ Story (2-col on --ac-bg) ───────────────────┤
│  01 / THE STORY.
│  ┌───────────────────┬────────────────────┐
│  │ body paragraphs   │ // THE INTENT      │
│  │ with gold spans   │ Newsreader pull-q  │
│  │                   │ MANAGED BY · RCU   │
│  └───────────────────┴────────────────────┘
├─ Timeline (4 history items, --ac-ink2) ──────┤
│  02 / A SHORT HISTORY.
│  · 2015 — Ground broken
│  · 2016 — Ceremonial opening
│  · 2018 — Public access expands
│  ● NOW  — A bookings refresh   (gold dot)
└──────────────────────────────────────────────┘
```

### `/facilities`

```
┌─ Hero (assets/facilities.jpg darkened) ──────┐
│  // SPACES & SUPPORT
│  FACILITIES.  +  every room, equipped.
├─ MainArena (01) ─────────────────────────────┤
│  ┌─ slider-2 image ─┬─ copy + 3 stat cards ─┐
│  │ ● CONFIG · CONCERT MODE badge            │
│  │                  │ Reserve Main Arena ↗  │
│  └──────────────────┴───────────────────────┘
├─ StudioRoom (02, --ac-ink2) ─────────────────┤
│  ┌─ copy + 6 stat cards ─┬─ slider-4 image ─┐
│  │ Book Studio Room ↗    │                  │
│  └───────────────────────┴──────────────────┘
├─ Support (03) ───────────────────────────────┤
│  4-card row: Changing rooms · Showers ·
│  Toilets · Parking
└──────────────────────────────────────────────┘
```

### `/contact`

```
┌─ Hero (radial gold gradient on --ac-bg) ─────┐
│  // REACH THE DESK
│  CONTACT.  +  four ways in.
│  lede w/ inline link to /bookings
├─ ChannelsAndMap (01) ────────────────────────┤
│  ┌─ 4 channel cards ─┬─ Google Maps iframe ─┐
│  │ TEL / @ / GEO/FB  │ in bordered .ac-card │
│  └───────────────────┴──────────────────────┘
├─ EnquiryForm (02, --ac-ink2) ────────────────┤
│  ┌─ form (real ContactForm) ─┬─ FOR ASSIST ─┐
│  │ Name · Phone · Email ·    │ phone +      │
│  │ Message · Consent · Send  │ 24h response │
│  └───────────────────────────┴──────────────┘
└──────────────────────────────────────────────┘
```

## Reusable patterns introduced

Adds three new utility classes to `globals.css`:

| Class | Use |
|---|---|
| `.ac-page-hero` | Background-image hero with dark navy gradient overlay; eyebrow + 140 px display + italic suffix + lede |
| `.ac-page-hero.is-gradient` | Same hero geometry but with radial gold gradient instead of a photo (Contact page) |
| `.ac-fact-strip` | 4-col bordered row, used by About FactStrip; reusable for future stat blocks |
| `.ac-section-numbered` | Standardised "01 / SECTION TITLE." + meta heading (extracted from existing `.ac-section-heading`) — adds the gold "01 /" prefix |
| `.ac-stat-card` | Padded `.ac-card` with mono label + Archivo value — used by Facilities and Contact form fields |
| `.ac-channel-card` | Code-block + label/value/sub triple-column card, used by Contact |
| `.ac-aside` | Left-bordered editorial sidebar with "FOR ASSISTANCE" + Newsreader body — used by Contact |
| `.ac-timeline` | Vertical-spine timeline with dot markers (last marker gold), used by About |
| `.ac-field`, `.ac-field input`, `.ac-field textarea` | Dark form field with mono label and dark card input |

## Data Model

None. All UI.

## API Routes

No new routes. `/contact` retains the existing `POST /api/contact`.

## Acceptance Criteria

- [x] AC-1: `/about` renders Hero with `assets/about.jpg` background, gold eyebrow, 140 px "ABOUT." display, italic "a versatile floor.", and lede. Hero respects `--ac-bg` page background.
- [x] AC-2: `/about` renders FactStrip with 4 stats (1,000 / 2,000 / LKR 150M / 2016) on `--ac-ink2` with mono labels and Archivo values; first value is gold.
- [x] AC-3: `/about` Story section is a 2-col layout on `--ac-bg`: left = 6 body paragraphs with gold emphasis spans on "1,000 spectators" and "Rs. 150 million"; right = "// THE INTENT" mono eyebrow + Newsreader italic pull-quote + "MANAGED BY · The Royal College Union" block. Section heading reads `01 / THE STORY.`.
- [x] AC-4: `/about` Timeline renders 4 items (2015 / 2016 / 2018 / NOW) with a vertical spine and circular dot markers. The last marker (NOW) is gold with a soft outer glow. Section heading reads `02 / A SHORT HISTORY.`.
- [x] AC-5: `/facilities` renders Hero with `assets/facilities.jpg`, gold "// SPACES & SUPPORT" eyebrow, "FACILITIES." display, "every room, equipped." italic, lede.
- [x] AC-6: `/facilities` MainArena (`01 / MAIN ARENA.`) renders the `slider-2.jpg` image with `● CONFIG · CONCERT MODE` gold badge on the left; copy + 3 stat cards (CAPACITY 1,000 / SEATING Retractable / USE Sport · Theatre · Concerts) + "Reserve Main Arena ↗" gold CTA on the right.
- [x] AC-7: `/facilities` StudioRoom (`02 / STUDIO ROOM.`) renders copy + 6 stat cards (3 cols × 2 rows: AREA / CLIMATE / FLOOR / WALL / BEST FOR / USE) + "Book Studio Room ↗" CTA on the left; `slider-4.jpg` image on the right; `--ac-ink2` background.
- [x] AC-8: `/facilities` Support (`03 / SUPPORT.`) renders 4 cards in a row (Changing rooms / Shower rooms / Toilets / Parking).
- [x] AC-9: `/contact` renders Hero with radial gold gradient on `--ac-bg` (no photo), "CONTACT." display, "four ways in." italic, and a lede with an inline gold link to `/bookings`.
- [x] AC-10: `/contact` ChannelsAndMap (`01 / REACH US.`) renders 5 channel cards on the left (TEL/@/GEO/FB/WA code blocks → label/value/sub; WhatsApp opens `https://wa.me/...`) and a Google Maps iframe inside an `--ac-card` border on the right. Map address text shown above the iframe in `--ac-text`.
- [x] AC-11: `/contact` EnquiryForm (`02 / SEND AN ENQUIRY.`) renders the existing `<ContactForm>` (preserving validation + `/api/contact` POST + space-prefill from `?space=...`) but restyled with dark inputs and mono labels matching the design. Right aside shows "FOR ASSISTANCE" body + phone + "Or email the bookings office →" + "24h" response-time stat block.
- [x] AC-12: ContactForm fields use dark `--ac-card` backgrounds with `--ac-line` borders, mono uppercase labels, `--ac-text` input text, and `--ac-gold` send button (Archivo 900 uppercase) with "↗" trailing glyph.
- [x] AC-13: Existing space-prefill behavior (`?space=main-arena|studio-room` → pre-filled message) still works. WhatsApp CTA preserved as a 5th channel card.
- [x] AC-14: Breadcrumbs render at the top of each page in the established mono gold style.
- [x] AC-15: Pages collapse cleanly to a single column at ≤980 px (heroes shrink display sizes; 2-col grids stack).
- [x] AC-16: `npx tsc --noEmit` clean.
- [x] AC-17: `npm run lint` clean.
- [x] AC-18: All AC checkboxes marked `[x]` after implementation.

## Out of Scope

- `/activities` and `/events` page redesigns (separate branches).
- `/bookings` calendar UI rebuild (deferred; tracked in `arena-court-redesign-spec.md`).
- Replacing the Google Maps iframe with a custom-rendered map (the design's grid pattern is a prototype-only placeholder).
- Admin pages.
- Updating per-page metadata / OpenGraph.
