## Overview

This document describes the high-level architecture of the RMASA website project so that new contributors (and future-you) can quickly build a mental model of how things fit together.

### Purpose of the system

Royal MAS Arena is the indoor sports complex of **Royal College Colombo**, focused on impact sports such as boxing and karate.  
The arena was built as a donation; the school now owns it and must cover ongoing maintenance costs.

The site supports that mission by:

- Acting as a public-facing marketing and information site for Royal MAS Arena.
- Providing an online calendar-based booking experience so interested parties can book unused timeslots.
- Helping the school and Old Boys’ Union generate income from underused arena time to support maintenance.
- Providing an admin console for staff to manage bookings, availability and related configuration.

### High-level stack

- **Framework**: Next.js 15 (App Router) with React and TypeScript.
- **Styling**: Global CSS in `src/app/globals.css` plus component-level Tailwind/utility classes (where used).
- **Database**: Aurora PostgreSQL Serverless v2 (AWS RDS, ap-southeast-1) via Prisma v6.
- **Auth**: NextAuth v4 (JWT strategy) as the session layer, AWS Cognito User Pool as the
  identity provider. Cognito holds passwords + account lockout; the Postgres `User` table
  remains the source of truth for admin role and `active` status. Federated sign-out via
  `/api/auth/federated-logout` clears both the NextAuth and Cognito session cookies. MFA is
  currently off, pending the `royalmasarena.lk` domain (needed for SES sender verification).
  See `docs/deployment.md` § Admin Auth for the full flow + setup gotchas.
- **Runtime**: Node.js — Amplify Gen 1 Web Compute runs standard Next.js output (`.next/`).
  `output: "standalone"` was attempted and reverted; see `docs/deployment.md` issues 4–5.
- **Hosting**: AWS Amplify Hosting — Web compute platform (managed SSR infrastructure).

### Infrastructure

```
User browser
    │
    ▼
AWS Amplify Hosting (ap-southeast-1)
  └─ Web compute (managed Node.js — runs .next/standalone/server.js)
       │
       ▼
Aurora PostgreSQL Serverless v2
  └─ VPC: default  ·  Region: ap-southeast-1
  └─ Connected via DATABASE_URL (sslmode=require)
```

Key AWS resources:

| Resource | Details |
|---|---|
| Amplify app | `main.d8k1nfzx3tpc7.amplifyapp.com` |
| Aurora cluster | ap-southeast-1, Serverless v2, pauses when idle |
| Amplify service role | `AmplifySSRLoggingRole` — used during build/deploy. Permissions: default `AmplifySSRLoggingPolicy` + scoped inline `AmplifyBuildSsmAccess` (SSM Put/Get/Delete on `/amplify/*` + KMS via SSM only). |
| Amplify compute role | `AmplifySSRComputeRole` — assumed by SSR runtime. Permissions: only `AWSLambdaBasicExecutionRole`. (Gen 1 doesn't expose IAM creds to SSR, so SSM at runtime never worked — see deployment.md issue 1.) |

See `docs/deployment.md` for the full deployment history, issues encountered, and security notes.

### Directory structure (core areas)

- `src/app`
  - Route segments for all pages and API endpoints.
  - `layout.tsx` defines the main HTML shell, navigation, footer and providers.
  - Public routes like `about`, `facilities`, `bookings`, `events`, `faq`, `contact`, `privacy`.
  - Admin routes under `admin/` (e.g. `admin/login`, `admin/calendar`).
- `src/components`
  - Reusable UI components.
  - `admin/` for admin-specific components (login form, logout button, calendar console).
  - `calendar/` for the user-facing booking/calendar flow.
- `src/lib`
  - Shared server and domain logic (auth, calendar core, Prisma client, etc.).
  - Calendar domain types and store used by both UI and API where relevant.
- `src/config`
  - Static configuration and content that is not user-generated.
- `src/content`
  - Content used by public pages (e.g. site copy, hero content).
- `prisma`
  - `schema.prisma` defines DB models (e.g. bookings, blocks, admins).
  - `migrations/` contains migration history.
- `scripts`
  - Node scripts for seeding, JSON → DB migration and other one-off tasks.

### Request flow (public user)

1. A visitor navigates to a page (e.g. `/bookings`).
2. A React component in `src/app/bookings/page.tsx` renders the booking UI, using calendar components from `src/components/calendar`.
3. When the user searches availability or submits a booking, the client calls Calendar API routes (e.g. `src/app/api/calendar/availability/route.ts`, `src/app/api/calendar/bookings/route.ts`).
4. API routes call into domain logic in `src/lib/calendar-core.ts` and related modules.
5. Prisma (`src/lib/prisma.ts`) is used to read/write from PostgreSQL.
6. The response is returned to the client and the UI updates.

### Request flow (admin)

1. An admin visits `/admin/login` and signs in via NextAuth credentials provider (or other configured provider).
2. On success, NextAuth issues a session that is used by admin pages and APIs.
3. Admin-only routes like `/admin/calendar` and admin API routes under `src/app/api/admin/*` use auth guards from `src/lib/auth-guards.ts` or NextAuth helpers to enforce access control.
4. The admin calendar console (components under `src/components/admin`) talks to admin API routes to:
   - Fetch availability and bookings.
   - Configure blocks and booking rules.
   - Perform admin-only operations such as resetting passwords or managing accounts.

### Data model (very high-level)

See `prisma/schema.prisma` for the exact schema, but conceptually:

- **Accounts / Users**: Admin accounts that can log in and manage the system.
- **Calendar configuration**: Global settings for how far ahead users can book, default durations, etc.
- **Blocks**: Time ranges that are available or unavailable (e.g. maintenance windows, regular opening hours).
- **Bookings**: Individual booking records tied to times, facilities and contact details.

### Related documentation

- `docs/rmasa-calendar-implementation-plan.md`: deeper dive into the calendar implementation details and roadmap.
- `docs/admin.md`: details of how the admin login and console work.
- `docs/conventions.md`: coding and project conventions specific to this repo.

