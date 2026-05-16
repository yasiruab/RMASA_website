## Admin area overview

This document explains how the admin side of the RMASA website works: authentication, routes and the calendar console.

### Goals of the admin area

- Allow trusted staff to log in securely.
- Provide an interface to:
  - View and manage bookings.
  - Configure availability and blocks.
  - Potentially manage other site content in future phases.

### Admin authentication

- **Auth library**: NextAuth (see `src/app/api/auth/[...nextauth]/route.ts`).
- **Account data**: Stored in the database via Prisma (see `prisma/schema.prisma` and `scripts/seed-super-admin.mjs`).
- **Session handling**: NextAuth session helpers are used on the server and in middleware to enforce access control.

Key pieces:

- `src/lib/auth.ts`: wraps NextAuth configuration and helpers.
- `src/lib/auth-guards.ts`: utilities to protect admin routes and APIs.
- `middleware.ts`: may apply route protection / redirects based on session state.

### Admin routes (UI)

- `src/app/admin/login/page.tsx`
  - Renders the admin login form UI.
  - Uses `src/components/admin/admin-login-form.tsx`.
- `src/app/admin/calendar/layout.tsx`
  - Layout wrapper for all calendar admin pages (shared nav, guards, etc.).
- `src/app/admin/calendar/page.tsx`
  - Main admin calendar console entry.
- `src/app/admin/calendar/[section]/page.tsx`
  - Sectioned views inside the calendar console (e.g. bookings, settings, blocks).

Key components:

- `src/components/admin/admin-login-form.tsx`: handles credential input and submit.
- `src/components/admin/admin-logout-button.tsx`: logs out the admin.
- `src/components/admin/admin-calendar-console.tsx`: main admin calendar interface (views, filters, actions).

### Admin API routes

Under `src/app/api/admin/`:

- `accounts/`:
  - `src/app/api/admin/accounts/route.ts`: list or create admin accounts.
  - `src/app/api/admin/accounts/[id]/route.ts`: operate on a specific account.
  - `src/app/api/admin/accounts/[id]/reset-password/route.ts`: reset an admin password.
- `calendar/`:
  - `src/app/api/admin/calendar/config/route.ts`: manage global calendar configuration.
  - `src/app/api/admin/calendar/blocks/route.ts`: manage availability / block ranges.
  - `src/app/api/admin/calendar/bookings/route.ts`: manage bookings from an admin perspective (e.g. view, cancel).

All admin API routes should:

- Validate the current session and ensure the user is an admin.
- Validate input payloads.
- Use domain logic from `src/lib/calendar-core.ts` and related modules.
- Interact with the database via Prisma.

### Access control expectations

- Public users must **not** be able to hit admin endpoints or pages successfully.
- Admin routes and APIs should:
  - Redirect unauthenticated users to `/admin/login`.
  - Return appropriate HTTP status codes when access is denied (e.g. 401/403).

### Future ideas

If you extend the project later, this document is a good place to note:

- New admin sections (e.g. content management).
- Role-based access control (different admin roles).
- Audit logging rules and where audit logs are written (`src/lib/audit.ts`).

