import Link from "next/link";
import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminLogoutButton } from "@/components/admin/admin-logout-button";
import type { RevenueModel } from "@/lib/admin/revenue-model";

export type HubActivity = {
  id: string;
  createdAt: Date;
  actorEmail: string | null;
  actorRole: "admin" | "super_admin" | "system";
  action: string;
  resourceId: string | null;
  meta: Record<string, unknown> | null;
};

export type HubKpis = {
  pending: number;
  tentative: number;
  approvedToday: number;
  activeBlocks: number;
  outstandingLkr: number;
  conflictCount: number;
};

// Minimal lookup shape for RecentActivity — only fields the row UI needs.
export type ActivityBookingLookup = {
  id: string;
  reference: string;
  customerName: string;
  customerPurpose: string;
};

type Props = {
  email: string;
  isSuperAdmin: boolean;
  kpis: HubKpis;
  revenue: RevenueModel;
  activity: HubActivity[];
  activityBookings: ActivityBookingLookup[];
};

const LKR = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 0 });

function fmtLkr(n: number) {
  return `LKR ${LKR.format(Math.round(n))}`;
}

function fmtDateTime(d: Date) {
  const day = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${day} · ${t}`;
}

function relTime(from: Date, now: Date) {
  const ms = now.getTime() - from.getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ACTION_LABELS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "info" | "neutral" }> = {
  ADMIN_BOOKING_UPDATED: { label: "Booking updated", tone: "info" },
  ADMIN_SLOT_STATUS_UPDATED: { label: "Slot updated", tone: "info" },
  ADMIN_BATCH_SLOTS_SAVED: { label: "Slots saved", tone: "info" },
  ADMIN_PAYMENT_RECORDED: { label: "Payment", tone: "ok" },
  ADMIN_BLOCK_CREATED: { label: "Block added", tone: "neutral" },
  ADMIN_BLOCK_DELETED: { label: "Block removed", tone: "neutral" },
  ADMIN_CONFIG_UPDATED: { label: "Config updated", tone: "neutral" },
  ADMIN_ACCOUNT_CREATED: { label: "Account created", tone: "ok" },
  ADMIN_ACCOUNT_UPDATED: { label: "Account updated", tone: "info" },
  ADMIN_ACCOUNT_DELETED: { label: "Account removed", tone: "danger" },
};

function actionDisplay(action: string, meta: Record<string, unknown> | null) {
  const fallback = action
    .replace(/^ADMIN_/, "")
    .toLowerCase()
    .replace(/_/g, " ");
  const known = ACTION_LABELS[action];
  if (!known) return { label: fallback.charAt(0).toUpperCase() + fallback.slice(1), tone: "neutral" as const };
  if (action === "ADMIN_BOOKING_UPDATED" && meta && typeof meta === "object") {
    const status = (meta as { status?: string }).status;
    if (status === "confirmed") return { label: "Approved", tone: "ok" as const };
    if (status === "tentative") return { label: "Tentative", tone: "info" as const };
    if (status === "rejected") return { label: "Rejected", tone: "danger" as const };
  }
  if (action === "ADMIN_PAYMENT_RECORDED" && meta && typeof meta === "object") {
    const type = (meta as { type?: string }).type;
    if (type === "refund") return { label: "Refund", tone: "danger" as const };
    if (type === "credit_note") return { label: "Credit note", tone: "info" as const };
    if (type === "waiver") return { label: "Waiver", tone: "info" as const };
  }
  return known;
}

export function AdminHub({ email, isSuperAdmin, kpis, revenue, activity, activityBookings }: Props) {
  const now = new Date();

  // KPIs come pre-computed from the server — see src/app/admin/calendar/page.tsx.
  const { pending, tentative, approvedToday, activeBlocks, outstandingLkr, conflictCount } = kpis;

  const dateString = now.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    weekday: "short",
    timeZone: "Asia/Colombo",
  });
  const timeString = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Colombo",
  });

  return (
    <div className="admin-hub">
      <AdminBreadcrumbs trail={[{ label: "Admin", href: "/admin/calendar" }, { label: "Console" }]} />

      <section className="admin-hub-hero">
        <div className="admin-hub-hero-inner">
          <div className="admin-hub-hero-title-row">
            <h1 className="admin-hub-hero-title">
              <span className="ac-display">
                Admin<span className="punct">.</span>
              </span>
              <span className="ac-italic admin-hub-hero-italic">console.</span>
            </h1>
            <span className="ac-mono admin-hub-hero-stamp">
              {dateString.toUpperCase()} · {timeString}
            </span>
          </div>
          <div className="admin-hub-identity-row">
            <div className="admin-hub-identity-pill">
              <span aria-hidden className="admin-hub-identity-dot" />
              <span className="admin-hub-identity-email">{email}</span>
              <span className="admin-hub-identity-role">{isSuperAdmin ? "Super admin" : "Admin"}</span>
            </div>
            <AdminLogoutButton />
          </div>
        </div>
      </section>

      <div className="admin-hub-kpis">
        <KpiTile
          label="In queue"
          value={String(pending + tentative)}
          sub={`${pending} pending · ${tentative} tentative`}
          hot={pending + tentative > 0}
          href="/admin/calendar/bookings?approval=pending,tentative"
        />
        <KpiTile
          label="Approved · today"
          value={String(approvedToday)}
          sub="rolling 24h"
          href="/admin/calendar/bookings?approval=confirmed"
        />
        <KpiTile
          label="Active blockouts"
          value={String(activeBlocks)}
          sub="this week"
          href="/admin/calendar/blockouts"
        />
        <KpiTile
          label="Conflicts"
          value={String(conflictCount)}
          sub="requires reconciliation"
          hot={conflictCount > 0}
          href="/admin/calendar/bookings?conflict=with"
        />
        <KpiTile
          label="Outstanding"
          value={fmtLkr(outstandingLkr)}
          sub="across all open bookings"
          hot={outstandingLkr > 0}
          small
          href="/admin/calendar/bookings?payment=unpaid,part_paid"
        />
      </div>

      <div className="admin-hub-notice">
        <span className="admin-hub-notice-tag">
          <span aria-hidden className="admin-hub-notice-dot" /> Secure
        </span>
        <span className="admin-hub-notice-text">
          Admin access is protected by AWS Cognito and Postgres role checks. Every action is recorded against your handle in the audit trail.
        </span>
      </div>

      <SectionGrid pending={pending} tentative={tentative} activeBlocks={activeBlocks} isSuperAdmin={isSuperAdmin} />

      <RevenueSnapshot revenue={revenue} />

      <RecentActivity activity={activity} activityBookings={activityBookings} now={now} />
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  hot,
  small,
  href,
}: {
  label: string;
  value: string;
  sub: string;
  hot?: boolean;
  small?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <div className="admin-hub-kpi-label">{label}</div>
      <div className={`admin-hub-kpi-value${hot ? " is-hot" : ""}${small ? " is-small" : ""}`}>{value}</div>
      <div className="admin-hub-kpi-sub">· {sub}</div>
    </>
  );
  if (!href) {
    return <div className="admin-hub-kpi-tile">{body}</div>;
  }
  return (
    <Link className="admin-hub-kpi-tile is-link" href={href}>
      {body}
    </Link>
  );
}

function SectionGrid({
  pending,
  tentative,
  activeBlocks,
  isSuperAdmin,
}: {
  pending: number;
  tentative: number;
  activeBlocks: number;
  isSuperAdmin: boolean;
}) {
  const topCards = [
    {
      code: "01",
      name: "Bookings",
      href: "/admin/calendar/bookings",
      stat: `${pending + tentative} in queue`,
      hot: pending + tentative > 0,
      primary: true,
      desc: "Review incoming requests, approve or reject per slot, track payments and audit trail.",
      badge: "● Operations",
    },
    {
      code: "02",
      name: "Calendar",
      href: "/admin/calendar/schedule",
      stat: "Week view · both venues",
      hot: false,
      primary: false,
      desc: "Unified week schedule across Main Arena and Studio Room. Purpose visible in every slot, color-coded by venue, with a toggleable legend.",
    },
    {
      code: "04",
      name: "Revenue",
      href: "/admin/calendar/revenue",
      stat: "Insights · last 90 days",
      hot: false,
      primary: false,
      desc: "Recognized vs collected trends, collection rate, refund pipeline, by-venue / event / org leaderboards.",
    },
    ...(isSuperAdmin
      ? [
          {
            code: "05",
            name: "Accounts",
            href: "/admin/calendar/accounts",
            stat: "Desk staff & roles",
            hot: false,
            primary: false,
            desc: "Manage desk staff accounts and roles (admin / super_admin). Cognito identity, Postgres authorization.",
          },
        ]
      : []),
    {
      code: "06",
      name: "Reports",
      href: "/admin/calendar/reports",
      stat: "Slot-level ledger",
      hot: false,
      primary: false,
      desc: "Per-slot financial allocation across a date range. CSV export. Includes waivers and credit notes.",
    },
  ];

  const configItems: Array<{ name: string; href: string; stat: string; desc: string; gated: boolean }> = [
    {
      name: "Blockouts",
      href: "/admin/calendar/blockouts",
      stat: `${activeBlocks} this week`,
      desc: "Maintenance, walk-in priority, school priority — kept off the public calendar.",
      gated: false,
    },
    {
      name: "Rooms",
      href: "/admin/calendar/rooms",
      stat: "Court layout & capacity",
      desc: "A/C zones, capacity, working hours, room description shown to the public.",
      gated: true,
    },
    {
      name: "Event types",
      href: "/admin/calendar/event-types",
      stat: "Duration · cleanup · advance",
      desc: "Duration locks, cleanup windows, max advance booking days, priorities per use.",
      gated: true,
    },
    {
      name: "Pricing",
      href: "/admin/calendar/pricing",
      stat: "Rates · AC · day type",
      desc: "Hourly and full-day rates, A/C surcharges, weekday / weekend / any pricing.",
      gated: true,
    },
  ];

  return (
    <section className="admin-hub-sections">
      <SubHeading title="Sections" italic="" meta="Click a card to drill in" accent={`· ${topCards.length + 1} areas`} />

      <div className="admin-hub-section-grid">
        {topCards.map((s) => (
          <Link key={s.code} className={`admin-hub-section-card${s.primary ? " is-primary" : ""}`} href={s.href}>
            {s.badge ? <div className="admin-hub-section-card-badge">{s.badge}</div> : null}
            <div className="admin-hub-section-card-head">
              <span className="ac-mono admin-hub-section-card-code">{s.code}</span>
              <span className="ac-display admin-hub-section-card-name">{s.name}</span>
            </div>
            <p className="admin-hub-section-card-desc">{s.desc}</p>
            <div className="admin-hub-section-card-foot">
              <span className={`admin-hub-section-card-stat${s.hot ? " is-hot" : ""}`}>
                {s.hot ? <span aria-hidden className="admin-hub-section-card-stat-dot" /> : null}
                {s.stat}
              </span>
              <span className="admin-hub-section-card-cta">Open ↗</span>
            </div>
          </Link>
        ))}

        <div className="admin-hub-config-card">
          <div className="admin-hub-config-head">
            <div className="admin-hub-section-card-head">
              <span className="ac-mono admin-hub-section-card-code">03</span>
              <span className="ac-display admin-hub-section-card-name">Configuration</span>
            </div>
            <p className="admin-hub-config-blurb">
              How the desk is set up — calendar overrides, venue config, event types, and pricing rules.
            </p>
          </div>
          <div className="admin-hub-config-divider" />
          <div className="admin-hub-config-grid">
            {configItems.map((c) => {
              const allowed = !c.gated || isSuperAdmin;
              if (!allowed) {
                return (
                  <div key={c.name} className="admin-hub-config-tile is-locked">
                    <div className="admin-hub-config-tile-name">{c.name}</div>
                    <p className="admin-hub-config-tile-desc">{c.desc}</p>
                    <div className="admin-hub-config-tile-foot">
                      <span className="admin-hub-config-tile-stat">{c.stat}</span>
                      <span className="admin-hub-config-tile-cta is-locked">Super admin</span>
                    </div>
                  </div>
                );
              }
              return (
                <Link key={c.name} className="admin-hub-config-tile" href={c.href}>
                  <div className="admin-hub-config-tile-name">{c.name}</div>
                  <p className="admin-hub-config-tile-desc">{c.desc}</p>
                  <div className="admin-hub-config-tile-foot">
                    <span className="admin-hub-config-tile-stat">{c.stat}</span>
                    <span className="admin-hub-config-tile-cta">Open ↗</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function SubHeading({ title, italic, meta, accent }: { title: string; italic?: string; meta?: string; accent?: string }) {
  return (
    <div className="admin-hub-subheading">
      <div>
        <h3 className="admin-hub-subheading-title">
          {title}
          {italic ? <span className="admin-hub-subheading-italic">{italic}</span> : null}
          {accent ? <span className="admin-hub-subheading-accent">{accent}</span> : null}
        </h3>
        <span aria-hidden className="admin-hub-subheading-rule" />
      </div>
      {meta ? <span className="ac-mono admin-hub-subheading-meta">{meta}</span> : null}
    </div>
  );
}

function RevenueSnapshot({ revenue }: { revenue: RevenueModel }) {
  const lastThree = revenue.trendBuckets.slice(-3);
  const max = Math.max(
    1,
    ...lastThree.map((b) => Math.max(b.recognizedLkr, b.collectedLkr, b.receivableLkr)),
  );
  const tiles = [
    { label: "Recognized", value: fmtLkr(revenue.recognizedRevenueLkr), col: "text" as const },
    { label: "Collected", value: fmtLkr(revenue.collectedRevenueLkr), col: "live" as const },
    { label: "Receivable", value: fmtLkr(revenue.receivableRevenueLkr), col: "warn" as const },
    {
      label: "Collection rate",
      value: revenue.recognizedRevenueLkr === 0 ? "—" : `${Math.round(revenue.collectionRatePct * 100)}%`,
      col: "gold" as const,
    },
  ];

  return (
    <section className="admin-hub-revenue">
      <SubHeading title="Revenue snapshot" meta="Source: payments ledger + invoice ledger" accent="· last 90 days" />
      <div className="admin-hub-revenue-card">
        <div className="admin-hub-revenue-tiles">
          {tiles.map((t) => (
            <div key={t.label} className="admin-hub-revenue-tile">
              <div className="admin-hub-kpi-label">{t.label}</div>
              <div className={`admin-hub-revenue-tile-value tone-${t.col}`}>{t.value}</div>
            </div>
          ))}
        </div>
        <div className="admin-hub-revenue-chart-wrap">
          <div className="admin-hub-revenue-chart-head">
            <span className="ac-mono admin-hub-revenue-chart-title">MONTHLY TREND</span>
            <div className="admin-hub-revenue-legend">
              <span><span className="legend-swatch tone-text" /> Recognized</span>
              <span><span className="legend-swatch tone-live" /> Collected</span>
              <span><span className="legend-swatch tone-warn" /> Receivable</span>
            </div>
          </div>
          {lastThree.length === 0 ? (
            <p className="admin-hub-revenue-empty">No revenue activity in the last 90 days.</p>
          ) : (
            <div className="admin-hub-revenue-chart">
              {lastThree.map((bucket) => (
                <div key={bucket.key} className="admin-hub-revenue-bar-group">
                  <div className="admin-hub-revenue-bar-stack">
                    <div className="admin-hub-revenue-bar tone-text" style={{ height: `${(bucket.recognizedLkr / max) * 100}%` }} title={fmtLkr(bucket.recognizedLkr)} />
                    <div className="admin-hub-revenue-bar tone-live" style={{ height: `${(bucket.collectedLkr / max) * 100}%` }} title={fmtLkr(bucket.collectedLkr)} />
                    <div className="admin-hub-revenue-bar tone-warn" style={{ height: `${(bucket.receivableLkr / max) * 100}%` }} title={fmtLkr(bucket.receivableLkr)} />
                  </div>
                  <span className="admin-hub-revenue-bar-label">{bucket.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="admin-hub-revenue-foot">
          <span className="ac-mono">Asia/Colombo</span>
          <Link className="admin-hub-revenue-link" href="/admin/calendar/revenue">
            Open full revenue insights →
          </Link>
        </div>
      </div>
    </section>
  );
}

function RecentActivity({ activity, activityBookings, now }: { activity: HubActivity[]; activityBookings: ActivityBookingLookup[]; now: Date }) {
  const bookingIndex = new Map(activityBookings.map((b) => [b.id, b]));
  return (
    <section className="admin-hub-activity">
      <SubHeading title="Recent activity" meta="Admin + system events" accent={`· ${activity.length} latest`} />
      <div className="admin-hub-activity-card">
        <div className="admin-hub-activity-head">
          <div>When</div>
          <div>Action</div>
          <div>Who</div>
          <div>Booking · Note</div>
          <div className="is-right">Go</div>
        </div>
        {activity.length === 0 ? (
          <div className="admin-hub-activity-empty">No admin activity yet.</div>
        ) : (
          activity.map((ev) => {
            const booking = ev.resourceId ? bookingIndex.get(ev.resourceId) : null;
            const action = actionDisplay(ev.action, ev.meta);
            const note = (ev.meta?.notes as string | undefined) ?? (ev.meta?.rejectReason as string | undefined) ?? "";
            return (
              <Link
                key={ev.id}
                className="admin-hub-activity-row"
                href={booking ? `/admin/calendar/bookings?id=${booking.id}` : "/admin/calendar/bookings"}
              >
                <div className="admin-hub-activity-when">
                  <div className="admin-hub-activity-when-abs">{fmtDateTime(ev.createdAt)}</div>
                  <div className="admin-hub-activity-when-rel">{relTime(ev.createdAt, now)}</div>
                </div>
                <div className={`admin-hub-activity-action tone-${action.tone}`}>{action.label}</div>
                <div className={`admin-hub-activity-who role-${ev.actorRole}`}>{ev.actorEmail ?? "system"}</div>
                <div>
                  <div className="admin-hub-activity-subject">
                    <span className="admin-hub-activity-ref">{booking?.reference ?? ev.resourceId ?? "—"}</span>
                    {booking ? <> · {booking.customerPurpose || booking.customerName}</> : null}
                  </div>
                  {note ? <div className="admin-hub-activity-note">{note}</div> : null}
                </div>
                <div className="admin-hub-activity-go">Open ↗</div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
