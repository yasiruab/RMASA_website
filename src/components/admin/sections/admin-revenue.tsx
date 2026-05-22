"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminLogoutButton } from "@/components/admin/admin-logout-button";
import { useAdminSession } from "@/components/admin/admin-session-context";
import { safeJson } from "@/lib/admin/api";
import {
  buildRevenueInsightsModel,
  type RevenueGranularity,
  type RevenueInsightsBreakdownBy,
  type RevenueInsightsFilters,
  type RevenueInsightsRangePreset,
  type RevenuePeriodBucket,
} from "@/lib/admin/revenue-model";

/* ── Types (mirror admin-bookings shape) ─────────────────────────────────── */

type BookingStatus = "pending" | "confirmed" | "tentative" | "rejected" | "cancelled_override";
type ReconStatus = "unpaid" | "part_paid" | "paid" | "waived";

type RoomType = { id: string; name: string };
type EventType = { id: string; name: string };

type PaymentEntry = {
  id: number;
  bookingId: string;
  type: "payment" | "refund" | "credit_note" | "waiver";
  date: string;
  amountLkr: number;
  receiptNo: string;
  notes: string;
  createdAt: string;
  createdBy: string;
};

type Slot = {
  date: string;
  startTime: string;
  endTime: string;
  slotStatus?: BookingStatus;
};

type Booking = {
  id: string;
  reference: string;
  roomTypeId: string;
  eventTypeId: string;
  acMode: "with_ac" | "without_ac";
  status: BookingStatus;
  totalAmountLkr: number;
  paidAmountLkr: number;
  reconciliationStatus: ReconStatus;
  paymentEntries: PaymentEntry[];
  customer: { name: string };
  slots: Slot[];
  amountBreakdown: Array<{ date: string; slot: string; amountLkr: number; dayType: string }>;
  createdAt: string;
};

/* ── Formatting helpers ──────────────────────────────────────────────────── */

const LKR_FULL = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 0 });
function fmtLkr(n: number) {
  return `LKR ${LKR_FULL.format(Math.round(n))}`;
}

function fmtLkrCompact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `LKR ${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `LKR ${Math.round(n / 1_000)}k`;
  return `LKR ${Math.round(n)}`;
}

function fmtPercent(p: number) {
  return `${Math.round(p * 100)}%`;
}

/* ── Constants ───────────────────────────────────────────────────────────── */

const GRANULARITY_OPTIONS: { value: RevenueGranularity; label: string }[] = [
  { value: "daily", label: "DAILY" },
  { value: "weekly", label: "WEEKLY" },
  { value: "monthly", label: "MONTHLY" },
];

const RANGE_OPTIONS: { value: RevenueInsightsRangePreset; label: string }[] = [
  { value: "last_30_days", label: "Last 30 Days" },
  { value: "last_60_days", label: "Last 60 Days" },
  { value: "last_90_days", label: "Last 90 Days" },
  { value: "calendar_year", label: "Calendar Year" },
  { value: "last_12_months", label: "Last 12 Months" },
  { value: "last_24_months", label: "Last 24 Months" },
];

const BREAKDOWN_OPTIONS: { value: RevenueInsightsBreakdownBy; label: string }[] = [
  { value: "venue", label: "VENUE" },
  { value: "event_type", label: "EVENT TYPE" },
];

// Up to 5 named segments + 1 "OTHER" bucket. Colors come from --ac-chart-*.
const MAX_NAMED_SEGMENTS = 5;
const OTHER_KEY = "__other__";
const OTHER_LABEL = "OTHER";

function segmentColorVar(index: number): string {
  return `var(--ac-chart-${(index % 6) + 1})`;
}

/* ── Component ───────────────────────────────────────────────────────────── */

export function AdminRevenue() {
  const session = useAdminSession();
  const email = session?.email ?? "—";

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState<RevenueInsightsFilters>({
    rangePreset: "last_12_months",
    granularity: "monthly",
    breakdownBy: "venue",
  });

  // Toggleable legend state — track *disabled* segment keys per chart
  const [hiddenTrendSegments, setHiddenTrendSegments] = useState<Set<string>>(new Set());
  const [hiddenAdjustmentSeries, setHiddenAdjustmentSeries] = useState<Set<string>>(new Set());

  /* Initial load */
  const refresh = useCallback(async () => {
    const [bookingRes, configRes] = await Promise.all([
      fetch("/api/admin/calendar/bookings", { cache: "no-store" }),
      fetch("/api/admin/calendar/config", { cache: "no-store" }),
    ]);
    const bd = await safeJson<{ bookings?: Booking[] }>(bookingRes);
    const cd = await safeJson<{ rooms?: RoomType[]; eventTypes?: EventType[] }>(configRes);
    if (bd.bookings) setBookings(bd.bookings);
    if (cd.rooms) setRooms(cd.rooms);
    if (cd.eventTypes) setEventTypes(cd.eventTypes);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Clear hidden trend segments whenever the breakdown axis changes
  useEffect(() => {
    setHiddenTrendSegments(new Set());
  }, [filters.breakdownBy]);

  // Build the insights model
  const today = useMemo(() => new Date(), []);
  const model = useMemo(
    () =>
      buildRevenueInsightsModel(bookings, filters, today, {
        rooms,
        eventTypes,
      }),
    [bookings, filters, today, rooms, eventTypes],
  );

  // Reduce model.segments to top-5 + OTHER (so the legend matches the design)
  const trendSegments = useMemo(() => {
    if (model.segments.length <= MAX_NAMED_SEGMENTS) {
      return model.segments.map((s, i) => ({ key: s.key, label: s.label, color: segmentColorVar(i) }));
    }
    const named = model.segments.slice(0, MAX_NAMED_SEGMENTS);
    return [
      ...named.map((s, i) => ({ key: s.key, label: s.label, color: segmentColorVar(i) })),
      { key: OTHER_KEY, label: OTHER_LABEL, color: segmentColorVar(MAX_NAMED_SEGMENTS) },
    ];
  }, [model.segments]);

  // Pre-compute bar stacks per bucket (named + OTHER aggregation + hidden filter)
  const trendBars = useMemo(() => {
    const namedKeys = new Set(
      trendSegments.filter((s) => s.key !== OTHER_KEY).map((s) => s.key),
    );
    return model.buckets.map((bucket) => {
      const stack: { key: string; label: string; color: string; value: number }[] = [];
      let otherTotal = 0;
      for (const segment of trendSegments) {
        if (segment.key === OTHER_KEY) continue;
        const raw = bucket.bySegmentLkr[segment.key] ?? 0;
        const value = Math.max(0, raw);
        if (hiddenTrendSegments.has(segment.key)) continue;
        stack.push({ key: segment.key, label: segment.label, color: segment.color, value });
      }
      // Sum everything not in named (the "other" bucket)
      for (const [key, value] of Object.entries(bucket.bySegmentLkr)) {
        if (namedKeys.has(key)) continue;
        otherTotal += Math.max(0, value);
      }
      if (otherTotal > 0 && !hiddenTrendSegments.has(OTHER_KEY)) {
        const otherSeg = trendSegments.find((s) => s.key === OTHER_KEY);
        if (otherSeg) {
          stack.push({
            key: OTHER_KEY,
            label: OTHER_LABEL,
            color: otherSeg.color,
            value: otherTotal,
          });
        }
      }
      const total = stack.reduce((sum, s) => sum + s.value, 0);
      return { bucket, stack, total };
    });
  }, [model.buckets, trendSegments, hiddenTrendSegments]);

  const trendMaxStack = useMemo(
    () => Math.max(1, ...trendBars.map((b) => b.total)),
    [trendBars],
  );

  // Adjustment chart series (two fixed series: WAIVED + CREDIT NOTE)
  const adjustmentSeries = useMemo(
    () => [
      { key: "waiver", label: "WAIVED", color: "var(--ac-chart-3)" },
      { key: "credit_note", label: "CREDIT NOTE", color: "var(--ac-chart-2)" },
    ],
    [],
  );

  const adjustmentBars = useMemo(() => {
    return model.buckets.map((bucket) => {
      const waiver = hiddenAdjustmentSeries.has("waiver") ? 0 : bucket.waiverLkr;
      const creditNote = hiddenAdjustmentSeries.has("credit_note") ? 0 : bucket.creditNoteLkr;
      return { bucket, waiver, creditNote, total: waiver + creditNote };
    });
  }, [model.buckets, hiddenAdjustmentSeries]);

  const adjustmentMax = useMemo(
    () => Math.max(1, ...adjustmentBars.map((b) => b.total)),
    [adjustmentBars],
  );

  const onExportCsv = useCallback(() => {
    const cols = [
      "Period",
      "Invoiced (LKR)",
      "Collected (LKR)",
      "Waiver (LKR)",
      "Credit Note (LKR)",
      "Adjustments (LKR)",
      "Net Revenue (LKR)",
      "Collection Rate (%)",
    ];
    const lines = [cols.join(",")];
    for (const bucket of model.buckets) {
      const row = [
        bucket.label,
        Math.round(bucket.invoicedLkr),
        Math.round(bucket.collectedLkr),
        Math.round(bucket.waiverLkr),
        Math.round(bucket.creditNoteLkr),
        Math.round(bucket.adjustmentsLkr),
        Math.round(bucket.netRevenueLkr),
        Math.round(bucket.collectionRatePct * 100),
      ];
      lines.push(row.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `revenue-insights-${filters.rangePreset}-${filters.granularity}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filters.granularity, filters.rangePreset, model.buckets]);

  const toggleTrendSegment = useCallback((key: string) => {
    setHiddenTrendSegments((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAdjustmentSeries = useCallback((key: string) => {
    setHiddenAdjustmentSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const breakdownLabel = filters.breakdownBy === "venue" ? "venue" : "event type";
  const granularityLabel = filters.granularity;

  return (
    <>
      <section className="admin-revenue-hero">
        <div className="admin-revenue-hero-grid">
          <div className="admin-revenue-hero-titles">
            <h1 className="admin-revenue-hero-title ac-display">
              Revenue<span className="punct">.</span>
            </h1>
            <span className="admin-revenue-hero-italic ac-italic">insights.</span>
            <span className="admin-revenue-hero-meta ac-mono">
              {todayLabel(today)} · LKR
            </span>
          </div>
          <div className="admin-revenue-hero-right">
            <div className="admin-revenue-hero-identity">
              <span aria-hidden className="admin-revenue-hero-identity-dot" />
              <span className="admin-revenue-hero-identity-email">{email}</span>
              <AdminLogoutButton />
            </div>
            <button type="button" className="admin-revenue-export" onClick={onExportCsv}>
              EXPORT CSV <span aria-hidden>↗</span>
            </button>
          </div>
        </div>
      </section>

      <section className="admin-revenue-controls">
        <div className="admin-revenue-control-group">
          <span className="ac-mono admin-revenue-control-label">GRANULARITY</span>
          <div className="admin-revenue-segmented" role="radiogroup" aria-label="Granularity">
            {GRANULARITY_OPTIONS.map((opt) => (
              <button
                type="button"
                key={opt.value}
                role="radio"
                aria-checked={filters.granularity === opt.value}
                className={
                  "admin-revenue-segmented-btn" +
                  (filters.granularity === opt.value ? " is-active" : "")
                }
                onClick={() => setFilters((f) => ({ ...f, granularity: opt.value }))}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="admin-revenue-control-group">
          <span className="ac-mono admin-revenue-control-label">RANGE</span>
          <select
            className="admin-revenue-select"
            value={filters.rangePreset}
            onChange={(e) => setFilters((f) => ({ ...f, rangePreset: e.target.value as RevenueInsightsRangePreset }))}
          >
            {RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-revenue-control-spacer" />
        <span className="ac-mono admin-revenue-control-count">
          SHOWING {model.buckets.length} {pluraliseBucket(filters.granularity, model.buckets.length)}
        </span>
      </section>

      <section className="admin-revenue-kpis">
        <KpiCard
          label="INVOICED"
          value={fmtLkrCompact(model.totals.invoicedLkr)}
          tone="invoiced"
          subtitle="GROSS BILLED"
        />
        <KpiCard
          label="COLLECTED"
          value={fmtLkrCompact(model.totals.collectedLkr)}
          tone="collected"
          subtitle={`${fmtPercent(model.totals.collectionRatePct)} OF OWED`}
        />
        <KpiCard
          label="RECEIVABLE"
          value={fmtLkrCompact(model.totals.receivableLkr)}
          tone="receivable"
          subtitle="OUTSTANDING"
        />
        <KpiCard
          label="ADJUSTMENTS"
          value={fmtLkrCompact(model.totals.adjustmentsLkr)}
          tone="adjustments"
          subtitle="WAIVER + CREDIT"
        />
        <KpiCard
          label="NET REVENUE"
          value={fmtLkrCompact(model.totals.netRevenueLkr)}
          tone="net"
          subtitle={
            model.netRevenueDeltaPct == null
              ? "VS PREV — —"
              : `VS PREV ${model.netRevenueDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(model.netRevenueDeltaPct * 100))}%`
          }
          subtitleTone={
            model.netRevenueDeltaPct == null
              ? "neutral"
              : model.netRevenueDeltaPct >= 0
                ? "positive"
                : "negative"
          }
        />
      </section>

      <section className="admin-revenue-chart-panel">
        <div className="admin-revenue-chart-head">
          <div>
            <h3 className="admin-revenue-chart-title ac-italic">Revenue trend</h3>
            <span className="admin-revenue-chart-subtitle ac-mono">
              · {breakdownLabel} · {granularityLabel}
            </span>
          </div>
          <div className="admin-revenue-chart-head-right">
            <span className="ac-mono admin-revenue-chart-label">BREAK DOWN BY</span>
            <select
              className="admin-revenue-select"
              value={filters.breakdownBy}
              onChange={(e) =>
                setFilters((f) => ({ ...f, breakdownBy: e.target.value as RevenueInsightsBreakdownBy }))
              }
            >
              {BREAKDOWN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="admin-revenue-chart-frame">
          <div className="admin-revenue-chart-frame-head">
            <span className="ac-mono">COLLECTED REVENUE · STACKED BY {filters.breakdownBy === "venue" ? "VENUE" : "EVENT TYPE"}</span>
            <span className="ac-mono admin-revenue-chart-frame-hint">CLICK A LEGEND ITEM TO TOGGLE</span>
          </div>
          <StackedBarChart
            buckets={trendBars}
            max={trendMaxStack}
            ariaLabel={`Collected revenue stacked by ${breakdownLabel}, ${granularityLabel}`}
          />
          <Legend
            items={trendSegments}
            hidden={hiddenTrendSegments}
            onToggle={toggleTrendSegment}
          />
        </div>
      </section>

      <section className="admin-revenue-secondary">
        <article className="admin-revenue-chart-panel admin-revenue-line-panel">
          <div className="admin-revenue-chart-head">
            <div>
              <h3 className="admin-revenue-chart-title ac-italic">Collection efficiency</h3>
              <span className="admin-revenue-chart-subtitle ac-mono">
                HIGHER IS BETTER · 100% = EVERYTHING OWED GOT COLLECTED
              </span>
            </div>
          </div>
          <div className="admin-revenue-chart-frame">
            <div className="admin-revenue-chart-frame-head">
              <span className="ac-mono">COLLECTED ÷ (INVOICED − ADJUSTMENTS)</span>
              <span className="ac-mono">
                <span className="admin-revenue-line-key" aria-hidden /> COLLECTION RATE
              </span>
            </div>
            <LineChart buckets={model.buckets} />
          </div>
        </article>
        <article className="admin-revenue-chart-panel admin-revenue-adjustment-panel">
          <div className="admin-revenue-chart-head">
            <div>
              <h3 className="admin-revenue-chart-title ac-italic">Adjustments</h3>
              <span className="admin-revenue-chart-subtitle ac-mono">· {granularityLabel}</span>
            </div>
            <span className="ac-mono admin-revenue-chart-frame-hint">WAIVERS + CREDIT NOTES</span>
          </div>
          <div className="admin-revenue-chart-frame">
            <div className="admin-revenue-chart-frame-head">
              <span className="ac-mono">REVENUE GIVEN UP (NOT REFUNDED) · STACKED</span>
              <span className="ac-mono admin-revenue-chart-frame-hint">CLICK A LEGEND ITEM TO TOGGLE</span>
            </div>
            <AdjustmentBarChart bars={adjustmentBars} max={adjustmentMax} />
            <Legend
              items={adjustmentSeries}
              hidden={hiddenAdjustmentSeries}
              onToggle={toggleAdjustmentSeries}
            />
          </div>
        </article>
      </section>

      {loading ? <p className="admin-revenue-loading ac-mono">Loading…</p> : null}
    </>
  );
}

/* ── KPI Card ────────────────────────────────────────────────────────────── */

type KpiTone = "invoiced" | "collected" | "receivable" | "adjustments" | "net";

function KpiCard({
  label,
  value,
  tone,
  subtitle,
  subtitleTone,
}: {
  label: string;
  value: string;
  tone: KpiTone;
  subtitle: string;
  subtitleTone?: "neutral" | "positive" | "negative";
}) {
  return (
    <article className={`admin-revenue-kpi tone-${tone}`}>
      <p className="ac-mono admin-revenue-kpi-label">{label}</p>
      <p className="admin-revenue-kpi-value">{value}</p>
      <p
        className={
          "ac-mono admin-revenue-kpi-subtitle" +
          (subtitleTone ? ` tone-${subtitleTone}` : "")
        }
      >
        · {subtitle}
      </p>
    </article>
  );
}

/* ── Stacked bar chart (Revenue trend) ───────────────────────────────────── */

type StackedBucket = {
  bucket: RevenuePeriodBucket;
  stack: { key: string; label: string; color: string; value: number }[];
  total: number;
};

function StackedBarChart({
  buckets,
  max,
  ariaLabel,
}: {
  buckets: StackedBucket[];
  max: number;
  ariaLabel: string;
}) {
  const axisTicks = useMemo(() => makeAxisTicks(max), [max]);
  return (
    <div className="admin-revenue-chart" role="img" aria-label={ariaLabel}>
      <div className="admin-revenue-chart-yaxis">
        {axisTicks
          .slice()
          .reverse()
          .map((tick, i) => (
            <span key={i} className="ac-mono admin-revenue-chart-ytick">
              {fmtLkrCompact(tick)}
            </span>
          ))}
      </div>
      <div className="admin-revenue-chart-plot">
        <div className="admin-revenue-chart-grid">
          {axisTicks.slice(1).map((_tick, i) => (
            <div key={i} className="admin-revenue-chart-gridline" />
          ))}
        </div>
        <div className="admin-revenue-chart-bars">
          {buckets.map((b) => (
            <div className="admin-revenue-chart-barwrap" key={b.bucket.key}>
              <div
                className="admin-revenue-chart-bar"
                style={{ height: `${(b.total / max) * 100}%` }}
                title={`${b.bucket.label}: ${fmtLkr(b.total)}`}
              >
                {b.stack.map((seg) => (
                  <div
                    key={seg.key}
                    className="admin-revenue-chart-seg"
                    style={{
                      flex: seg.value,
                      background: seg.color,
                    }}
                    title={`${seg.label}: ${fmtLkr(seg.value)}`}
                  />
                ))}
              </div>
              <span className="ac-mono admin-revenue-chart-xlabel">{b.bucket.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Adjustment bar chart (two-series stacked) ───────────────────────────── */

function AdjustmentBarChart({
  bars,
  max,
}: {
  bars: { bucket: RevenuePeriodBucket; waiver: number; creditNote: number; total: number }[];
  max: number;
}) {
  const axisTicks = useMemo(() => makeAxisTicks(max), [max]);
  return (
    <div className="admin-revenue-chart admin-revenue-chart-mini" role="img" aria-label="Adjustments by period">
      <div className="admin-revenue-chart-yaxis">
        {axisTicks
          .slice()
          .reverse()
          .map((tick, i) => (
            <span key={i} className="ac-mono admin-revenue-chart-ytick">
              {fmtLkrCompact(tick)}
            </span>
          ))}
      </div>
      <div className="admin-revenue-chart-plot">
        <div className="admin-revenue-chart-grid">
          {axisTicks.slice(1).map((_tick, i) => (
            <div key={i} className="admin-revenue-chart-gridline" />
          ))}
        </div>
        <div className="admin-revenue-chart-bars">
          {bars.map((b) => (
            <div className="admin-revenue-chart-barwrap" key={b.bucket.key}>
              <div
                className="admin-revenue-chart-bar"
                style={{ height: `${(b.total / max) * 100}%` }}
                title={`${b.bucket.label}: ${fmtLkr(b.total)}`}
              >
                {b.waiver > 0 ? (
                  <div
                    className="admin-revenue-chart-seg"
                    style={{ flex: b.waiver, background: "var(--ac-chart-3)" }}
                    title={`Waived: ${fmtLkr(b.waiver)}`}
                  />
                ) : null}
                {b.creditNote > 0 ? (
                  <div
                    className="admin-revenue-chart-seg"
                    style={{ flex: b.creditNote, background: "var(--ac-chart-2)" }}
                    title={`Credit Note: ${fmtLkr(b.creditNote)}`}
                  />
                ) : null}
              </div>
              <span className="ac-mono admin-revenue-chart-xlabel">{b.bucket.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Line chart (Collection efficiency) ──────────────────────────────────── */

function LineChart({ buckets }: { buckets: RevenuePeriodBucket[] }) {
  // SVG dimensions and padding
  const width = 760;
  const height = 240;
  const padLeft = 56;
  const padRight = 24;
  const padTop = 24;
  const padBottom = 32;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  // Y axis: 50% to 100% by default (matches design); expand if data goes lower
  const rates = buckets.map((b) => b.collectionRatePct);
  const lowestRaw = Math.min(0.5, ...rates.filter((r) => r > 0));
  const yMin = Math.floor(lowestRaw * 10) / 10;
  const yMax = 1;
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-6; v += 0.1) yTicks.push(Math.round(v * 10) / 10);

  const xStep = buckets.length > 1 ? plotW / (buckets.length - 1) : plotW;
  const points = buckets.map((b, i) => {
    const x = padLeft + i * xStep;
    const yNorm = Math.max(yMin, Math.min(yMax, b.collectionRatePct));
    const y = padTop + plotH * (1 - (yNorm - yMin) / (yMax - yMin));
    return { x, y, value: b.collectionRatePct, label: b.label };
  });

  const linePath = points.length === 0 ? "" : `M ${points.map((p) => `${p.x},${p.y}`).join(" L ")}`;
  const areaPath =
    points.length === 0
      ? ""
      : `${linePath} L ${points[points.length - 1].x},${padTop + plotH} L ${points[0].x},${padTop + plotH} Z`;

  return (
    <svg
      className="admin-revenue-line-svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Collection efficiency line chart"
    >
      {/* Y-axis grid + labels */}
      {yTicks.map((t) => {
        const y = padTop + plotH * (1 - (t - yMin) / (yMax - yMin));
        return (
          <g key={t}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y}
              y2={y}
              stroke="var(--ac-line)"
              strokeOpacity={t === yMax ? 0.4 : 0.18}
              strokeDasharray={t === yMax ? "" : "2 4"}
            />
            <text
              x={padLeft - 8}
              y={y + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--ac-text-mute)"
              fontFamily="var(--font-mono, monospace)"
            >
              {Math.round(t * 100)}%
            </text>
          </g>
        );
      })}

      {/* Filled area under the line */}
      <path d={areaPath} fill="var(--ac-gold)" fillOpacity={0.12} />
      {/* Line stroke */}
      <path d={linePath} fill="none" stroke="var(--ac-gold)" strokeWidth={1.5} />

      {/* Point markers + value labels */}
      {points.map((p) => (
        <g key={`${p.label}-${p.x}`}>
          <circle cx={p.x} cy={p.y} r={3.5} fill="var(--ac-gold)" />
          <text
            x={p.x}
            y={p.y - 8}
            textAnchor="middle"
            fontSize="10"
            fill="var(--ac-gold)"
            fontFamily="var(--font-mono, monospace)"
          >
            {Math.round(p.value * 100)}%
          </text>
        </g>
      ))}

      {/* X-axis labels */}
      {points.map((p, i) =>
        // Show every label up to 12 points; otherwise space them out
        i % Math.max(1, Math.ceil(points.length / 12)) === 0 ? (
          <text
            key={`x-${p.label}-${p.x}`}
            x={p.x}
            y={height - 10}
            textAnchor="middle"
            fontSize="10"
            fill="var(--ac-text-mute)"
            fontFamily="var(--font-mono, monospace)"
          >
            {p.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/* ── Legend ──────────────────────────────────────────────────────────────── */

function Legend({
  items,
  hidden,
  onToggle,
}: {
  items: { key: string; label: string; color: string }[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="admin-revenue-legend" role="group">
      {items.map((item) => {
        const isHidden = hidden.has(item.key);
        return (
          <button
            type="button"
            key={item.key}
            className={`admin-revenue-legend-item${isHidden ? " is-hidden" : ""}`}
            onClick={() => onToggle(item.key)}
            aria-pressed={!isHidden}
          >
            <span className="admin-revenue-legend-swatch" style={{ background: item.color }} aria-hidden />
            <span className="admin-revenue-legend-label">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Utility ─────────────────────────────────────────────────────────────── */

function makeAxisTicks(max: number): number[] {
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-6; v += step) ticks.push(Math.round(v));
  return ticks;
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  // Floor the step at 1 — y-axis values are integer LKR amounts, so a
  // sub-unit step (e.g. 0.5) lets Math.round collapse distinct ticks to
  // the same integer, producing duplicate React keys.
  if (raw < 1) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let nice: number;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * mag;
}

function pluraliseBucket(g: RevenueGranularity, count: number) {
  if (g === "daily") return count === 1 ? "DAY" : "DAYS";
  if (g === "weekly") return count === 1 ? "WEEK" : "WEEKS";
  return count === 1 ? "MONTHLY PERIOD" : "MONTHLY PERIODS";
}

function todayLabel(d: Date) {
  const day = d.getDate();
  const month = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const year = d.getFullYear();
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const hour = String(d.getHours()).padStart(2, "0");
  const minute = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} · ${weekday} · ${hour}:${minute}`;
}
