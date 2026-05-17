# Activities Page + Channel Icons — Feature Spec

## Overview

1. Rebuilds `/activities` to match the Arena Court design (`rmasa-website-design/project/pages/activities.jsx`): hero, three discipline categories (Combat / Sport / Gatherings) rendered as horizontal cards with monogram tiles, and a closing "Got a different event in mind?" gold-outlined call-out. **Adds Badminton** under the Sport category (not in the design's catalog but explicitly requested).
2. Replaces the 3-letter text monograms used as visual tags with **inline SVG icons** in two places:
   - The activity tiles on `/activities` (was `BOX`, `WRS`, `KRT`, …)
   - The channel cards on `/contact` (was `TEL`, `@`, `GEO`, `FB`, `WA`)

This spec is the follow-up to `arena-court-redesign-spec.md` and `about-facilities-contact-redesign-spec.md`. Ships in the same branch as those changes because the icon swap touches `/contact`.

## Layout / UX

### `/activities`

```
┌─ Hero (assets/activities.jpg darkened) ──────┐
│  // WHAT THE FLOOR CAN HOST
│  ACTIVITIES.   +   sport, training, gatherings.
├─ Disciplines (01 / THE DISCIPLINES.) ────────┤
│  ┌ combat. ── 6 activities ────────────────┐ │
│  │ [glove] Boxing   [grap] Wrestling   …   │ │
│  │ [karate] Karate  [wushu] Wushu      …   │ │
│  │ [foil] Fencing   [knot] Grappling       │ │
│  └─────────────────────────────────────────┘ │
│  ┌ sport. ── 2 activities ──────────────────┐│
│  │ [rings] Gymnastics   [shuttle] Badminton ││
│  └──────────────────────────────────────────┘│
│  ┌ gatherings. ── 3 activities ─────────────┐│
│  │ [mic] Seminars  [table] Meetings  [mask] ││
│  │   Performing Arts                        ││
│  └──────────────────────────────────────────┘│
├─ GotSomethingElse? (gold outline card) ──────┤
│  // ANYTHING ELSE?
│  Got a different event in mind?  +  Talk to the desk ↗
└──────────────────────────────────────────────┘
```

Each activity tile is a horizontal card: 88-px square icon tile on `--ac-ink` with `--ac-gold` icon stroke, plus a body cell with the activity name in 22-px Archivo on `--ac-card`.

### Channel icons on `/contact`

The 5 channel cards (`Call` / `Email` / `Address` / `Facebook` / `WhatsApp`) replace the previous `TEL` / `@` / `GEO` / `FB` / `WA` text monograms with the matching SVG icon from the icon set. Tile dimensions and surrounding layout are unchanged.

## Icon set (`src/components/icons.tsx`)

A small, dependency-free SVG icon module. Each icon is a stateless functional component with `currentColor` strokes, 24×24 viewBox, default 28-px render size, `aria-hidden="true"` by default, accepts any `SVGProps<SVGSVGElement>` override.

| Export | Used by |
|---|---|
| `PhoneIcon` | Contact · Call |
| `EnvelopeIcon` | Contact · Email |
| `PinIcon` | Contact · Address |
| `FacebookIcon` | Contact · Facebook |
| `WhatsAppIcon` | Contact · WhatsApp |
| `BoxingIcon` | Activities · Boxing |
| `WrestlingIcon` | Activities · Wrestling |
| `KarateIcon` | Activities · Karate |
| `WushuIcon` | Activities · Wushu |
| `FencingIcon` | Activities · Fencing |
| `GrapplingIcon` | Activities · Grappling |
| `GymnasticsIcon` | Activities · Gymnastics |
| `BadmintonIcon` | Activities · Badminton **(new sport)** |
| `SeminarsIcon` | Activities · Seminars |
| `MeetingsIcon` | Activities · Meetings |
| `PerformingArtsIcon` | Activities · Performing Arts |

## Data Model

None. UI only.

## API Routes

None.

## Acceptance Criteria

- [x] AC-1: `/activities` Hero renders with `assets/activities.jpg` background, gold "// WHAT THE FLOOR CAN HOST" eyebrow, "ACTIVITIES." 140 px display, "sport, training, gatherings." italic suffix, and lede.
- [x] AC-2: Disciplines section heading reads `01 / THE DISCIPLINES.` with meta `THREE CATEGORIES · TWELVE USES`.
- [x] AC-3: **Combat** group renders 6 horizontal activity cards: Boxing / Wrestling / Karate / Wushu / Fencing / Grappling. 3-col grid on desktop.
- [x] AC-4: **Sport** group renders 2 horizontal activity cards: Gymnastics and **Badminton (new)**. 3-col grid on desktop.
- [x] AC-5: **Gatherings** group renders 3 horizontal activity cards: Seminars / Meetings / Performing Arts. 3-col grid on desktop.
- [x] AC-6: Each activity card has an 88-px-square `--ac-ink` icon tile on the left, with a sport-specific gold inline SVG icon, and the activity name in 22-px Archivo on `--ac-card` on the right.
- [x] AC-7: Closing call-out renders a 2-col grid: "// ANYTHING ELSE?" mono + "Got a different event in mind?" 42 px display + supporting paragraph on the left; gold "Talk to the desk ↗" CTA linking to `/contact` on the right. Wrapped in a `--ac-card` panel with a 2 px gold border.
- [x] AC-8: `/contact` channel cards display the matching icon from `icons.tsx` inside the existing 64-px tile, replacing the previous 3-letter text codes. WhatsApp tile shows `WhatsAppIcon`.
- [x] AC-9: Icons inherit `--ac-gold` color via `color: var(--ac-gold)` on the tile container; SVG strokes use `currentColor`.
- [x] AC-10: Activity cards collapse to single-column on viewports ≤980 px.
- [x] AC-11: `npx tsc --noEmit` clean.
- [x] AC-12: `npm run lint` clean.
- [x] AC-13: All AC checkboxes marked `[x]` after implementation.

## Out of Scope

- Bookings calendar UI rebuild (still deferred).
- Per-page hero photos for `/events`, `/faq`, `/privacy` (separate branches if/when needed).
- Animation on the icons (kept static).
- Replacing the iconography on any admin-side UI.
