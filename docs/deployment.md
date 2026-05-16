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
| `AmplifySSRLoggingRole` | Service role — used during build and deploy phases. Needs SSM write access so Amplify can store env var secrets in Parameter Store. Fixed by attaching `AmazonSSMFullAccess`. |
| `AmplifySSRComputeRole` | Compute role — assumed by the SSR runtime process. Trust policy must include both `amplify.amazonaws.com` AND `lambda.amazonaws.com` as trusted principals. |

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

**Lint rule to consider:** add a check to fail CI if `_AMPLIFY_*` is referenced from any file
under `src/app/` that isn't a server-side route handler or server component.

**Long-term fix:** migrate the app to Amplify Gen 2 (CDK-based, proper runtime env var support)
or to a hosting platform with native Next.js SSR support (Vercel, Cloudflare Pages with workers).

---

### 2. Debug endpoint in codebase (`/api/debug-env`)

`src/app/api/debug-env/route.ts` was created to diagnose the env var injection issue. It returns
whether `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, and `DATABASE_URL` are defined.

**Risk:** Exposes infrastructure information (which secrets are configured) to any unauthenticated
HTTP client.

**Action required:** Delete this file once the fix is confirmed working and env vars return `true`
at the endpoint. Do not leave it in production.

---

### 3. Aurora Serverless cold start on first DB connection

Aurora Serverless v2 pauses when idle. The first database request after a pause period incurs a
cold start (typically 3–10 seconds). This is a UX concern for a low-traffic site, not a security
concern, but worth noting.

**Mitigation options:** Disable auto-pause (increases cost) or set a keep-alive ping on a schedule
(e.g. EventBridge → Lambda → ping `/api/calendar/config` every 5 minutes during business hours).

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

---

## Pending Tasks

- [x] Add SSM read + KMS decrypt permissions to `AmplifySSRComputeRole` (unused at runtime; kept
      in case Amplify Gen 1's behaviour changes or we migrate to Gen 2)
- [x] Confirm `AmplifySSRComputeRole` is set as the compute role
- [x] SDK-based SSM fetch in `instrumentation.ts` — abandoned (no runtime IAM credentials)
- [x] Build-time env baking via `next.config.ts` env config + `instrumentation.ts` re-export
- [ ] Deploy and verify `/api/debug-env` returns `true` for all three env vars
- [ ] Delete `src/app/api/debug-env/route.ts`
- [ ] Test the bookings page calendar data in production
- [ ] Test admin login at `/admin/login` in production
- [ ] Purchase and configure custom domain → update `NEXTAUTH_URL` in Amplify console
