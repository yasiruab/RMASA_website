# Deployment — RMASA Website

This document records the production deployment architecture, all significant issues encountered
during the initial setup, their resolutions, and outstanding security concerns.

---

## Architecture

The site is deployed on **AWS Amplify Hosting** (Web compute platform) in **ap-southeast-1 (Singapore)**.

### How Amplify Web compute works

Amplify Web compute is managed SSR infrastructure — there are no customer-owned Lambda functions.
Amplify builds the Next.js app during CI, packages the deployment artifact, and runs
`.next/standalone/server.js` on managed Node.js compute. The customer never sees or manages the
underlying servers.

### Next.js build mode

The app uses **standard Next.js output** (no `output: "standalone"`). Amplify Gen 1 Web Compute is
designed for this format — it reads the standard `.next/` build output and runs the SSR server with
its own managed runtime. We attempted `output: "standalone"` as a workaround for a runtime env-var
issue (see issue 1 below) but reverted it after multiple deployments failed Amplify's artifact-
structure validation. The right fix turned out to be IAM-level (compute role SSM permissions), not
build-output-level.

### Build pipeline (`amplify.yml`)

```
preBuild:  npm ci
build:     npx prisma generate
           npm run build
artifact:  .next/**
```

### Database

Aurora PostgreSQL Serverless v2 cluster in ap-southeast-1. Prisma connects using `DATABASE_URL`
with `sslmode=require`. The cluster is configured to pause when idle (cost optimisation for a low-
traffic site).

### IAM roles

| Role | Purpose |
|---|---|
| `AmplifySSRLoggingRole` | Service role — used during build and deploy phases. Needs SSM access so Amplify can store env var secrets in Parameter Store. Attached policies: the default `AmplifySSRLoggingPolicy` (managed) plus the inline `AmplifyBuildSsmAccess` granting `ssm:Put/Get/Delete` on `arn:aws:ssm:*:*:parameter/amplify/*` and KMS decrypt scoped to `ssm.*.amazonaws.com`. `AmazonSSMFullAccess` was previously attached but has been replaced with the tighter inline policy. |
| `AmplifySSRComputeRole` | Compute role — assumed by the SSR runtime process. Trust policy must include both `amplify.amazonaws.com` AND `lambda.amazonaws.com` as trusted principals. Attached policies: only `AWSLambdaBasicExecutionRole`. SSM permissions removed — Amplify Gen 1 Web Compute doesn't expose IAM credentials to the SSR process, so SSM read at runtime never worked anyway (see issue 1). |

---

## Issues Encountered

### 1. Env vars not available at SSR runtime (resolved with workaround)

**Symptom:** `/api/calendar/config` → 500 (blank body). `/api/auth/session` → 500 `"There is a
problem with the server configuration"`. All calendar and auth features broken in production.

**Root cause confirmed via debug endpoint** (`/api/debug-env`):
```json
{
  "hasNextAuthSecret": false,
  "hasNextAuthUrl": false,
  "hasDatabaseUrl": false,
  "nextAuthUrl": null,
  "nodeEnv": "production"
}
```
`NODE_ENV` was available (baked in at build time by Next.js) but all three Amplify console env vars
returned `false`.

**How Amplify injects env vars at SSR runtime:**
1. Env vars set in the Amplify console are stored in SSM Parameter Store at
   `/amplify/{appId}/{branch}/` (encrypted as SecureStrings).
2. At runtime, the **compute role** (`AmplifySSRComputeRole`) is assumed by the SSR process.
3. The SSR process reads SSM parameters and populates `process.env`.

For step 3 to work, the compute role must have `ssm:GetParameter`, `ssm:GetParameters`, and
`ssm:GetParametersByPath` permissions on `arn:aws:ssm:*:*:parameter/amplify/{appId}/*`, plus KMS
decrypt permission for the SecureString key.

**Failed attempt (standalone output):** Switched to `output: "standalone"` and embedded env vars
into `.next/standalone/.env.production` during build. This was a workaround intended to bypass the
SSM injection path entirely. It failed because Amplify Gen 1's artifact validator does not support
the standalone directory layout — successive deployments failed on missing
`required-server-files.json`, then missing server trace files. Reverted to standard Next.js output.

**Current hypothesis:** The compute role lacks SSM read + KMS decrypt permissions. We attached
`AmazonSSMFullAccess` to the **service role** (`AmplifySSRLoggingRole`) earlier — that fixed the
build-phase `Failed to set up process.env.secrets` warning — but the compute role was never given
SSM read access.

**What we tried (didn't work):**
- Attached `AmazonSSMFullAccess` to the service role → fixed build-phase warnings, did not fix
  runtime injection.
- Attached `AmplifySSRComputeSSMRead` inline policy to `AmplifySSRComputeRole` granting SSM read +
  KMS decrypt. Did not fix runtime injection. The compute role permissions are correct; Amplify
  Gen 1 simply does not automatically inject SSM params into the SSR process for this app.
- Attempted `output: "standalone"` with embedded `.env.production` — failed Amplify's artifact
  validation (see issues 4 & 5 below).

**AWS SDK approach attempted (failed):**
We tried fetching SSM params directly using `@aws-sdk/client-ssm` from `src/instrumentation.ts`.
The instrumentation hook ran successfully, but the SDK call failed with
`Could not load credentials from any providers`. **Amplify Gen 1 Web Compute does not expose the
compute role's IAM credentials to the SSR process** — no `AWS_ACCESS_KEY_ID`, no IMDS endpoint, no
container credentials URI. The compute role we configured in the console is essentially unused at
runtime. This is a fundamental Gen 1 limitation, not fixable from our side.

**Working fix: build-time inlining via `next.config.ts` env config.**

`next.config.ts` declares an `env` block with prefixed keys (`_AMPLIFY_DATABASE_URL` etc.). At
build time on Amplify, Amplify's build environment has the real secret values in `process.env`.
Next.js reads them during build and inlines them as string literals throughout the JS bundle.

At server startup, `src/instrumentation.ts` reads the inlined values via the prefixed keys (which
get replaced with the actual values by Next.js's DefinePlugin) and assigns them to the standard
key names (`DATABASE_URL`, etc.) on the real runtime `process.env` using dynamic-key access (which
is *not* inlined). After `register()` runs, Prisma and NextAuth can read `process.env.DATABASE_URL`
and `process.env.NEXTAUTH_SECRET` normally.

Files involved:
- `next.config.ts` — declares the build-time env baking with `_AMPLIFY_*` prefix.
- `src/instrumentation.ts` — copies inlined values to standard env-var names at startup.
- `src/lib/prisma.ts` — passes `datasourceUrl` explicitly as a safety net.

**Why prefixed keys:** if we used `env: { DATABASE_URL: ... }` directly, Next.js would inline
*every* `process.env.DATABASE_URL` reference in the codebase — including our debug endpoint and
any place that reads it dynamically. By using `_AMPLIFY_*` prefixes, we keep the inlining scoped
to one file (`instrumentation.ts`) and minimise the surface area where secrets can leak into
client bundles.

---

### 2. Service role missing SSM permissions

**Symptom:** Build log warning: `!Failed to set up process.env.secrets`

**Root cause:** `AmplifySSRLoggingRole` (the Amplify service role) lacked permission to write to
SSM Parameter Store, which Amplify uses to store env var secrets for the Web compute runtime.

**Fix:** Attached `AmazonSSMFullAccess` policy to `AmplifySSRLoggingRole` in IAM.

**Result:** Warning disappeared in subsequent builds. Did not by itself fix the runtime env var
issue (see issue 1 above).

---

### 3. Compute role trust policy error

**Symptom:** "Update default role failed — cannot be assumed by Amplify" when setting the compute
role in the Amplify console.

**Root cause:** The `AmplifySSRComputeRole` was created with only `lambda.amazonaws.com` in its
trust policy. Amplify requires `amplify.amazonaws.com` as a trusted principal to be able to assign
the role.

**Fix:** Updated the trust policy to include both principals:
```json
{
  "Principal": {
    "Service": [
      "amplify.amazonaws.com",
      "lambda.amazonaws.com"
    ]
  }
}
```

---

### 4. Standalone artifact mismatch — `required-server-files.json` not found (Deployment 5, reverted)

**Symptom:** Build succeeded but packaging failed:
```
CustomerError: Can't find required-server-files.json in build output directory
```

**Root cause:** Amplify looks for `required-server-files.json` at the root of the artifact
`baseDirectory`. With `baseDirectory: .next/standalone`, it expects the file at
`.next/standalone/required-server-files.json`. Next.js places it at `.next/required-server-files.json`
(one level up). The file is also included inside `.next/standalone/.next/` by Next.js standalone
output, but Amplify only checks the artifact root.

**Fix:** Added an explicit copy step to `amplify.yml`:
```bash
cp .next/required-server-files.json .next/standalone/required-server-files.json
```

**Status:** Resolved (Deployment 6).

---

### 5. Standalone artifact mismatch — server trace files not found (Deployments 6 & 7, reverted)

**Symptom:** Build succeeded but packaging failed (same error in both Deployment 6 and Deployment 7
even after copying `.next/server` into `.next/standalone/server`):
```
CustomerError: Server trace files are not found in .next/standalone, please check your build artifacts path
```

**Diagnosis:** Amplify Gen 1's artifact validator does not recognise standalone layouts regardless
of which files are copied where. The validator appears to enforce a specific path convention that
the standalone output does not match. After two failed attempts to mimic the expected structure,
we abandoned the standalone approach.

**Resolution:** Reverted to standard Next.js output (`baseDirectory: .next`, no
`output: "standalone"`). This passes Amplify's artifact validation because Next.js puts
`required-server-files.json` and `server/app/*.nft.json` exactly where Amplify expects them.

**Lesson:** Do not use `output: "standalone"` with Amplify Gen 1 Web Compute. Use standard Next.js
output and address runtime env var issues at the IAM/compute-role level instead.

---

### 5. Prisma native binary not bundled (potential)

**Symptom:** Not yet observed, but a known risk with Next.js standalone + Prisma.

**Explanation:** Prisma requires a platform-specific native query engine binary at runtime. Next.js
standalone's file tracing does not always pick this up automatically. Without it, Prisma throws
at startup.

**Preemptive fix:** Added `outputFileTracingIncludes` to `next.config.ts`:
```typescript
outputFileTracingIncludes: {
  "/**": ["./node_modules/.prisma/**/*"],
},
```

---

## Security Concerns

### 1. Secrets baked into the JS bundle (active tradeoff)

Because Amplify Gen 1 Web Compute will not expose IAM credentials at runtime (see issue 1 in the
issues section), we cannot fetch secrets from SSM on-demand at startup. The working solution is
to bake secret values into the build JS as string literals at build time via `next.config.ts`'s
`env` config.

**Implications:**
- `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL` exist as plaintext strings inside the
  compiled JS in `.next/`, which is uploaded to Amplify's managed S3 bucket.
- Anywhere `process.env._AMPLIFY_DATABASE_URL` (or the other prefixed keys) is referenced in code,
  the literal value will be inlined into that bundle — including potentially the client bundle if
  ever accidentally referenced from a client component.
- Rotating a secret requires a rebuild.

**Mitigations in place:**
- The prefixed keys `_AMPLIFY_*` are referenced **only** in `src/instrumentation.ts` (server-only)
  and `src/lib/prisma.ts` (server-only). Neither file is reachable from client bundles.
- The artifact S3 bucket is private, IAM-controlled by Amplify; only AWS console users with
  access can extract values from it.
- Production secrets are never committed to git — they live only in Amplify's environment
  variables UI (encrypted in SSM) and in the build output.

**Bundle leak guardrail (in place):** `scripts/check-amplify-secret-leak.mjs` runs in the `prebuild`
npm hook (and therefore on every Amplify build). It fails the build if `_AMPLIFY_*` appears in any
source file outside the allowlist (`next.config.ts`, `src/instrumentation.ts`, `src/lib/prisma.ts`).
Without this, a stray reference in a client component would inline the production secret into the
browser bundle.

**Long-term fix:** migrate the app to Amplify Gen 2 (CDK-based, proper runtime env var support)
or to a hosting platform with native Next.js SSR support (Vercel, Cloudflare Pages with workers).

---

### 2. Debug endpoint in codebase (`/api/debug-env`) — RESOLVED

`src/app/api/debug-env/route.ts` was created to diagnose the env var injection issue. It returned
whether `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, and `DATABASE_URL` were defined, plus instrumentation
state. **Deleted** once env var injection was confirmed working. No longer in the codebase.

---

### 3. Aurora Serverless cold start on first DB connection

Aurora Serverless v2 with **min ACU 0** fully pauses when idle. The first database request after a
pause period incurs a cold start of 15–30 seconds while the cluster scales from 0 ACUs.

**Approach taken — accept the cold start, mask it in the UI, retry at the build step.** Given the
site sees fewer than five bookings a day, the cost of keeping Aurora warm (≈US$43/month at min ACU
0.5) was not justified. Two mitigations are in place:

- **Build step retries `prisma migrate deploy`** — wrapped in a 6× loop with 15s sleeps in
  `amplify.yml` (~90s of headroom). Without this, deploys randomly fail with `P1001: Can't reach
  database server` because Prisma's default ~5s connection timeout is shorter than Aurora's wake-up.
- **Booking calendar masks the runtime cold start in the client:**
  - **Skeleton-shimmer placeholder** replaces the empty calendar during the first fetch
    (`CalendarLoadingSkeleton` in `src/components/calendar/booking-calendar-flow.tsx`). User sees
    a structured loading state, not a blank page.
  - **Friendly copy:** "Warming up the courts… your booking calendar is on its way." Generic, no
    time-of-day reference, no exposure of "database is sleeping" framing.
  - **AbortController timeout:** 60 seconds on the first attempt (cold-start tolerant), 20 seconds
    on retries (the cluster should be warm by then).
  - **Explicit error + retry UI** (`CalendarLoadError`) if the request fails or times out. Different
    copy for timeout vs network failure, with an in-place **Try again** button that re-runs the
    fetch without a page reload.

**Trade-offs still to be aware of:**
- The first customer of any idle period still waits 3–10 seconds. The skeleton makes that wait
  feel intentional rather than broken, but it doesn't eliminate it.
- If Aurora is genuinely down (not just paused), users see the error UI with retry. There's no
  automatic background retry — the user has to click.

**Alternatives if cold-start latency ever becomes a real complaint:**
1. **Keep-alive ping:** EventBridge schedule → Lambda → ping `/api/calendar/config` every 5
   minutes between business hours. Cost above. Cheapest infrastructure path.
2. **Increase Aurora min capacity** to keep an instance warm (more expensive, eliminates cold
   start entirely).
3. **Disable auto-pause** (most expensive, simplest).

---

## One-time Setup Steps (completed)

These steps were run once to initialise the database and do not need to be repeated unless the
database is reset.

1. **Database provisioned** — Aurora PostgreSQL Serverless v2 cluster created in ap-southeast-1.
2. **Schema migrated** — `npx prisma migrate deploy` run against the Aurora instance to apply
   `prisma/migrations/0001_init/migration.sql`.
3. **Calendar data seeded** — `scripts/migrate-calendar-json-to-postgres.mjs` run to import room
   types, event types, pricing rules, and existing bookings from `data/calendar-db.json`.
4. **Super-admin seeded** — `scripts/seed-super-admin.mjs` run to create the initial admin account.

---

## Environment Variables (Amplify console)

| Variable | Where set | Notes |
|---|---|---|
| `DATABASE_URL` | Amplify console → Environment variables | Includes `?sslmode=require` for Aurora SSL |
| `NEXTAUTH_SECRET` | Amplify console → Environment variables | Random 32-byte secret for JWT signing |
| `NEXTAUTH_URL` | Amplify console → Environment variables | Full URL of the deployed site (e.g. `https://main.d8k1nfzx3tpc7.amplifyapp.com`) — update when custom domain is configured |
| `COGNITO_CLIENT_ID` | Amplify console → Environment variables | App Client ID from the Cognito User Pool |
| `COGNITO_CLIENT_SECRET` | Amplify console → Environment variables | App Client secret (confidential client) |
| `COGNITO_ISSUER` | Amplify console → Environment variables | `https://cognito-idp.<region>.amazonaws.com/<user-pool-id>` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Amplify console → Environment variables | Cloudflare Turnstile widget key for the booking-form bot challenge. `NEXT_PUBLIC_*` is inlined automatically by Next.js — no `_AMPLIFY_*` baking needed. |
| `TURNSTILE_SECRET_KEY` | Amplify console → Environment variables | Server-side Turnstile verification secret. Baked via `_AMPLIFY_TURNSTILE_SECRET_KEY` in `next.config.ts`; read in `src/lib/turnstile.ts`. Fail-open: if unset, the booking endpoint skips verification (does not break submissions). |

All server-side variables listed above are mirrored into the JS bundle at build time via
`next.config.ts` `env` config (prefixed `_AMPLIFY_*`) and re-exported at server start by
`src/instrumentation.ts`. The bundle-leak guardrail (`scripts/check-amplify-secret-leak.mjs`)
keeps these references confined to an allowlist of server-only files (Prisma, NextAuth,
Resend, Turnstile).

---

## Admin Auth (AWS Cognito + Postgres)

Admin authentication is a hybrid: **Cognito** (User Pool `ap-southeast-1_XE0FgWA4X`) holds the
credential (password + account lockout); **Postgres `User`** holds the application-level role
(`admin` / `super_admin`) and `active` flag. NextAuth v4 (JWT strategy) is the session layer.

### Login flow
1. Admin visits `/admin/login` → clicks "Sign in" → redirected to Cognito hosted UI.
2. Cognito takes the password (no MFA currently — see below).
3. On success, Cognito redirects to `/api/auth/callback/cognito`.
4. NextAuth `signIn` callback looks up the user by email in Postgres:
   - Not found → reject (audit: `AUTH_LOGIN_FAILED` reason `not_in_postgres`).
   - `active === false` → reject (audit: `AUTH_LOGIN_FAILED` reason `inactive`).
   - Otherwise → backfill `cognitoSub` on the Postgres row (first login only), allow.
5. JWT session cookie is set (4-hour max-age). Role comes from Postgres.

### Sign-out flow (federated)
NextAuth's default `signOut` clears the app's session cookie but NOT Cognito's session cookie,
so on next "Sign in" Cognito would auto-complete the OAuth flow without prompting. To prevent
that, the AdminLogoutButton calls `signOut({ redirect: false })` and then navigates to
`/api/auth/federated-logout`, which:
1. Reads Cognito's `end_session_endpoint` from the discovery doc (cached after first hit).
2. Redirects to it with `client_id` + `logout_uri` so Cognito terminates its own session.
3. Cognito then redirects to the `logout_uri` (`<NEXTAUTH_URL>/admin/login`).

The `logout_uri` must be in the App Client's allowed sign-out URLs — both
`https://main.d8k1nfzx3tpc7.amplifyapp.com/admin/login` and
`http://localhost:3000/admin/login` are configured.

### MFA — deferred until custom domain is registered
MFA is currently set to **No MFA** on the User Pool. The intended second factor is email OTP,
which requires Cognito to send via Amazon SES (the default Cognito sender doesn't support MFA
emails). SES needs a verified domain or per-recipient verified email addresses — neither is
practical until `royalmasarena.lk` is registered.

When the domain arrives:
1. Verify the domain in SES (region `ap-southeast-1`).
2. Request SES production access (removes sandbox restrictions).
3. Cognito User Pool → Authentication → MFA → set to Required, tick "Email message".
4. On next sign-in, each admin is prompted to enrol in email MFA.

TOTP authenticator-app MFA is available immediately on any Cognito tier — switch to that any
time as an interim measure.

### Adding a new admin (two-step)
1. **In the website:** super-admin uses Admin Accounts page (`/admin/calendar/accounts`) to
   create a Postgres User row (email + role + name). No password is taken.
2. **In the AWS Cognito console:** super-admin creates a matching Cognito user with the same
   email, marks email_verified, sets a temporary password (Cognito forces change on first login).
3. New admin signs in via `/admin/login`. On first sign-in they're prompted to set a new
   password.

### Removing / disabling an admin
- Soft-disable: super-admin toggles `active = false` in the Admin Accounts page. The next
  login attempt is rejected by the NextAuth `signIn` callback; any existing session naturally
  expires within 4 hours.
- Hard-remove: in addition, super-admin deletes the user from the Cognito User Pool.

### Forgot password
Admins use the "Forgot password" link in the Cognito hosted UI — Cognito handles email
verification and reset. The website has no password-reset endpoint of its own.

### Setup gotchas (learned the hard way)
- **`COGNITO_ISSUER` must be the full URL**, not just the pool ID. Format:
  `https://cognito-idp.<region>.amazonaws.com/<pool-id>`. Just the pool ID will cause NextAuth
  to fail with "only valid absolute URLs can be requested".
- **Callback URLs in the App Client must include both production and `localhost`**:
  `https://<prod>/api/auth/callback/cognito` AND `http://localhost:3000/api/auth/callback/cognito`.
- **Sign-out URLs similarly** must include both.
- **OAuth scopes must include `profile`** — NextAuth's Cognito provider requests
  `openid email profile` by default; if `profile` isn't ticked in the App Client, the OAuth flow
  fails after the user authenticates.
- **Behind Amplify's reverse proxy**, `req.url` reflects the internal Node host
  (`localhost:3000`). Server code that needs the public origin must read `NEXTAUTH_URL` env var,
  not derive from `req.url`. See `src/app/api/auth/federated-logout/route.ts`.

### Why no `AdminCreateUser` from the website?
Amplify Gen 1 Web Compute doesn't expose IAM credentials to the SSR runtime, so calling the
Cognito Admin SDK from inside Next.js would require baking AWS access keys into the bundle.
That trade-off didn't fit the "very secure" goal for the small admin count, so admin creation
in Cognito is intentionally a manual console step.

---

## Pending Tasks

- [x] Add SSM read + KMS decrypt permissions to `AmplifySSRComputeRole` — later removed; SSM at
      runtime never worked on Gen 1 (no IAM creds exposed to SSR)
- [x] Confirm `AmplifySSRComputeRole` is set as the compute role
- [x] SDK-based SSM fetch in `instrumentation.ts` — abandoned (no runtime IAM credentials)
- [x] Build-time env baking via `next.config.ts` env config + `instrumentation.ts` re-export
- [x] Deploy and verify env vars are populated at runtime
- [x] Delete `src/app/api/debug-env/route.ts`
- [x] Add `_AMPLIFY_*` bundle-leak guardrail (`scripts/check-amplify-secret-leak.mjs` in prebuild)
- [x] Strip `AmazonSSMFullAccess` from `AmplifySSRComputeRole` (compute role now only has
      `AWSLambdaBasicExecutionRole`)
- [x] Replace `AmazonSSMFullAccess` on `AmplifySSRLoggingRole` with scoped `AmplifyBuildSsmAccess`
      inline policy
- [x] Rotate Aurora master password (production credentials had been exposed in chat)
- [x] Add a loading skeleton + error/retry UI to `BookingCalendarFlow`
- [x] Fluid header-logo sizing (replaced 540→340 breakpoint snap and scroll-triggered compact
      width override with `clamp()`-based scaling)
- [~] EventBridge keep-alive ping — **deferred**. Skeleton UX handles the cold start at near-zero
      cost; revisit if traffic grows enough to justify ≈US$25–40/month.
- [x] Migrate admin auth to AWS Cognito (password-only currently — MFA deferred — 4-hour
      session, security headers, HTTPS redirect on `/admin/*`)
- [x] Mirror existing Postgres admin to the Cognito User Pool (renamed dummy
      `admin@rmasa.local` → real email)
- [x] Federated sign-out via `/api/auth/federated-logout` so Cognito's session cookie is
      cleared alongside the NextAuth one
- [x] Verify admin login at `/admin/login` in production (Cognito flow end-to-end)
- [~] MFA — **deferred**. Re-enable as **Required** with **Email message** once
      `royalmasarena.lk` is registered and SES domain verification + production access are
      complete. TOTP authenticator MFA is available immediately as a stop-gap if desired.
- [ ] Test the bookings page calendar data in production (verify skeleton shows on a cold cluster)
- [ ] Remove `bcrypt` dependency after one week of stable Cognito operation (Phase D cleanup)
- [ ] Purchase and configure custom domain → update `NEXTAUTH_URL` in Amplify console (also
      revisit Cognito callback / sign-out URLs to use the new domain)
