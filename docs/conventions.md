## Coding and project conventions

This document captures local conventions for the RMASA website so that the codebase stays consistent as it grows.

### General principles

- Prefer **clear, explicit code** over clever abstractions.
- Keep **domain logic** (e.g. booking rules, availability calculations) in `src/lib`, not buried in components.
- Keep **UI components** focused on rendering and user interactions.

### TypeScript / React

- Use **TypeScript everywhere** (components, libs, API routes).
- Prefer **functional React components** with hooks over classes.
- Use **server components** by default in the App Router, and only opt into client components when you need browser APIs or local state.
- Co-locate small helper types near where they are used; share widely used domain types in `src/lib/calendar-types.ts` or `src/types`.

### File and folder structure

- **Routes**:
  - Use the Next.js App Router conventions in `src/app`.
  - Keep each page in its own folder if it needs a `layout.tsx` or additional route segments.
- **Components**:
  - Public/shared components live in `src/components`.
  - Admin-specific components live in `src/components/admin`.
  - Calendar-specific UI lives in `src/components/calendar`.
- **Domain logic**:
  - Calendar core logic and reusable helpers live in `src/lib/calendar-core.ts` and related modules.
  - Prisma client lives in `src/lib/prisma.ts` and should be reused everywhere instead of instantiating new clients.

### Styling

- Global styles live in `src/app/globals.css`.
- Use composable utility classes (e.g. Tailwind-style) and small reusable components where appropriate.
- Keep page-specific styling as close to the page or component as possible.

### API routes

- API routes live under `src/app/api/**`.
- Prefer a **thin route handler** that:
  - Validates input.
  - Calls into a function in `src/lib/**` that contains the core logic.
  - Handles formatting the HTTP response and error codes.
- For admin APIs, always enforce authentication/authorization using helpers from `src/lib/auth-guards.ts` or the NextAuth session.

### Database and migrations

- All schema changes go through `prisma/schema.prisma` and migrations via Prisma.
- Keep **one-off scripts** in `scripts/` (e.g. seeding, data migrations) and make them idempotent where possible.

### Documentation

- Keep `README.md` up to date with how to run the project.
- Use files in `docs/` for architecture, domain and admin docs instead of long comments in code.
- When you make a big architectural or domain decision, consider capturing it in an ADR-style note in `docs/adrs/` (if that folder exists).

