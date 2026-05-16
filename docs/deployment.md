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

The app is built with `output: "standalone"` (`next.config.ts`). This packages the entire app and
its dependencies into `.next/standalone/` — a self-contained Node.js server that can run without
`node_modules` in the project root. This is required for Amplify Web compute to run the SSR server
correctly.

### Build pipeline (`amplify.yml`)

Amplify's build is controlled by `amplify.yml` in the repo root. The key steps:

```
preBuild:  npm ci
build:     npx prisma generate
           npm run build
           cp -r public          → .next/standalone/public/
           cp -r .next/static    → .next/standalone/.next/static/
           cp required-server-files.json → .next/standalone/required-server-files.json
           printf env vars       → .next/standalone/.env.production
artifact:  .next/standalone/**
```

The last two `cp` / `printf` steps are not part of a standard Next.js build — they are workarounds
for Amplify-specific issues described below.

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

### 1. Env vars not available at SSR runtime

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
returned `false`. Amplify Web compute was not injecting custom env vars from the Amplify console
into the SSR Node.js process for this Next.js 15 configuration.

**Fix applied (two-layer approach):**

1. Switched to `output: "standalone"` in `next.config.ts`. Standalone deployments have a different
   packaging model that Amplify handles differently, which may fix the injection path.

2. Added a `printf` step in `amplify.yml` to write the env vars directly into
   `.next/standalone/.env.production` during the build phase. Next.js reads `.env.production` at
   server startup as a fallback. This guarantees env var availability even if Amplify's runtime
   injection fails.

**Status:** Fix committed. Pending verification that env vars return `true` at the debug endpoint
after the next successful deploy.

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

### 4. `required-server-files.json` not found (Deployment 5)

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

### 5. Server trace files not found (Deployment 6)

**Symptom:** Build succeeded but packaging failed:
```
CustomerError: Server trace files are not found in .next/standalone, please check your build artifacts path
```

**Root cause:** Amplify requires Next.js server trace files (`.nft.json`) to be present at
`{baseDirectory}/server/app/*.nft.json`. These files exist in `.next/server/` but NOT in
`.next/standalone/server/` — the standalone build produces a monolithic `server.js` and does not
copy the trace files into the standalone output.

**Fix:** Added an explicit copy step to `amplify.yml`:
```bash
cp -r .next/server .next/standalone/server
```
This places the trace files at `.next/standalone/server/app/*.nft.json` where Amplify expects them.

**Status:** Fix committed (after Deployment 6 failure). Pending Deployment 7.

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

### 1. Secrets baked into deployment artifact (active concern)

The `amplify.yml` build step writes `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL` as
**plaintext** into `.next/standalone/.env.production`. This file is included in the deployment
artifact uploaded to Amplify's managed S3 bucket.

**Why the practical risk is currently low:**
- The artifact S3 bucket is private and access-controlled by Amplify.
- `.env.production` is not served over HTTP — it's not a web route.
- Anyone who could extract it from the artifact already has AWS console access, which gives them
  the same secrets via the Amplify environment variables UI.

**Why it is still not best practice:**
- Plaintext secrets in a deployment artifact are harder to rotate (every rotation requires a
  rebuild).
- If the S3 bucket policy is ever misconfigured, secrets are exposed with no additional layer of
  protection.
- Secrets in plaintext files do not benefit from KMS encryption at rest.

**Recommended long-term fix:** Migrate secrets from Amplify environment variables to **Amplify
Secrets** (SSM SecureString, KMS-encrypted). Amplify Secrets are intended to be injected at
runtime without being baked into the build artifact. Once confirmed working, remove the `printf`
line from `amplify.yml`.

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

- [ ] Confirm Deployment 6 succeeds after the `required-server-files.json` fix
- [ ] Verify `/api/debug-env` returns `true` for all three env vars
- [ ] Delete `src/app/api/debug-env/route.ts`
- [ ] Test the bookings page calendar data in production
- [ ] Test admin login at `/admin/login` in production
- [ ] Purchase and configure custom domain → update `NEXTAUTH_URL` in Amplify console
- [ ] Migrate secrets to Amplify Secrets (SSM SecureString) and remove `printf` from `amplify.yml`
