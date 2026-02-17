"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type RoomType = {
  id: string;
  name: string;
  workingHours: { startTime: string; endTime: string };
};
type EventType = { id: string; name: string; durationHours: number; priority: number; roomTypeId?: string };
type PricingRule = {
  id: string;
  roomTypeId: string;
  eventTypeId: string;
  acMode: "with_ac" | "without_ac";
  dayType: "weekday" | "weekend" | "any";
  amountLkr: number;
};

type Booking = {
  id: string;
  roomTypeId: string;
  eventTypeId: string;
  acMode: "with_ac" | "without_ac";
  status: "pending" | "confirmed" | "tentative" | "rejected" | "cancelled_override";
  totalAmountLkr: number;
  reconciliationStatus: "unpaid" | "part_paid" | "paid" | "waived";
  reconciliationNotes: string;
  customer: { name: string; email: string; phone: string; purpose: string };
  slots: Array<{ date: string; startTime: string; endTime: string }>;
  createdAt: string;
};

type CalendarBlock = {
  id: string;
  roomTypeId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
};

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

type RevenueRangePreset = "last_30_days" | "last_90_days" | "current_month";
type RevenueFilters = {
  rangePreset: RevenueRangePreset;
  roomTypeId: string;
  eventTypeId: string;
  acMode: "all" | "with_ac" | "without_ac";
};

type RevenueBucket = {
  key: string;
  label: string;
  recognizedLkr: number;
  collectedLkr: number;
  receivableLkr: number;
};

type BreakdownRow = {
  key: string;
  amountLkr: number;
};

function toYmd(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ymdToDate(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthKey(ymd: string) {
  return ymd.slice(0, 7);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function isWeekend(ymd: string) {
  const day = ymdToDate(ymd).getDay();
  return day === 0 || day === 6;
}

function inDateRange(date: string, startYmd: string, endYmd: string) {
  return date >= startYmd && date <= endYmd;
}

function buildRevenueModel(sourceBookings: Booking[], startYmd: string, endYmd: string) {
  const recognizedByRoom = new Map<string, number>();
  const recognizedByEvent = new Map<string, number>();
  const recognizedByAcMode = new Map<string, number>();
  let weekdayRevenueLkr = 0;
  let weekendRevenueLkr = 0;
  let recognizedRevenueLkr = 0;
  let collectedRevenueLkr = 0;
  let receivableRevenueLkr = 0;
  let confirmedCount = 0;
  let pendingPipelineLkr = 0;
  let tentativePipelineLkr = 0;
  let cancelledOverrideValueLkr = 0;

  const startMonth = startOfMonth(ymdToDate(startYmd));
  const endMonth = startOfMonth(ymdToDate(endYmd));
  const monthOrder: string[] = [];
  const trendMap = new Map<string, RevenueBucket>();

  const monthPointer = new Date(startMonth);
  while (monthPointer <= endMonth) {
    const key = `${monthPointer.getFullYear()}-${String(monthPointer.getMonth() + 1).padStart(2, "0")}`;
    monthOrder.push(key);
    trendMap.set(key, {
      key,
      label: monthLabel(key),
      recognizedLkr: 0,
      collectedLkr: 0,
      receivableLkr: 0,
    });
    monthPointer.setMonth(monthPointer.getMonth() + 1);
  }

  const collectionsQueue: Array<{
    id: string;
    customerName: string;
    totalAmountLkr: number;
    reconciliationStatus: Booking["reconciliationStatus"];
    ageDays: number;
  }> = [];

  for (const booking of sourceBookings) {
    const inRangeDates = booking.slots
      .map((slot) => slot.date)
      .filter((date) => inDateRange(date, startYmd, endYmd))
      .sort();
    if (inRangeDates.length === 0) continue;

    if (booking.status === "pending") {
      pendingPipelineLkr += booking.totalAmountLkr;
    }
    if (booking.status === "tentative") {
      tentativePipelineLkr += booking.totalAmountLkr;
    }
    if (booking.status === "cancelled_override") {
      cancelledOverrideValueLkr += booking.totalAmountLkr;
    }
    if (booking.status !== "confirmed") continue;

    confirmedCount += 1;
    recognizedRevenueLkr += booking.totalAmountLkr;
    if (booking.reconciliationStatus === "paid" || booking.reconciliationStatus === "part_paid") {
      collectedRevenueLkr += booking.totalAmountLkr;
    }
    if (booking.reconciliationStatus === "unpaid" || booking.reconciliationStatus === "part_paid") {
      receivableRevenueLkr += booking.totalAmountLkr;
      const createdAtMs = Date.parse(booking.createdAt);
      const nowMs = Date.now();
      const ageDays =
        Number.isNaN(createdAtMs) || createdAtMs > nowMs
          ? 0
          : Math.floor((nowMs - createdAtMs) / (1000 * 60 * 60 * 24));
      collectionsQueue.push({
        id: booking.id,
        customerName: booking.customer.name,
        totalAmountLkr: booking.totalAmountLkr,
        reconciliationStatus: booking.reconciliationStatus,
        ageDays,
      });
    }

    recognizedByRoom.set(
      booking.roomTypeId,
      (recognizedByRoom.get(booking.roomTypeId) ?? 0) + booking.totalAmountLkr,
    );
    recognizedByEvent.set(
      booking.eventTypeId,
      (recognizedByEvent.get(booking.eventTypeId) ?? 0) + booking.totalAmountLkr,
    );
    recognizedByAcMode.set(
      booking.acMode,
      (recognizedByAcMode.get(booking.acMode) ?? 0) + booking.totalAmountLkr,
    );

    const perSlotShare = booking.totalAmountLkr / inRangeDates.length;
    for (const date of inRangeDates) {
      if (isWeekend(date)) weekendRevenueLkr += perSlotShare;
      else weekdayRevenueLkr += perSlotShare;
    }

    const bucketKey = monthKey(inRangeDates[0]);
    const bucket = trendMap.get(bucketKey);
    if (bucket) {
      bucket.recognizedLkr += booking.totalAmountLkr;
      if (booking.reconciliationStatus === "paid" || booking.reconciliationStatus === "part_paid") {
        bucket.collectedLkr += booking.totalAmountLkr;
      }
      if (booking.reconciliationStatus === "unpaid" || booking.reconciliationStatus === "part_paid") {
        bucket.receivableLkr += booking.totalAmountLkr;
      }
    }
  }

  const toBreakdownRows = (map: Map<string, number>): BreakdownRow[] =>
    [...map.entries()]
      .map(([key, amountLkr]) => ({ key, amountLkr }))
      .sort((a, b) => b.amountLkr - a.amountLkr);

  const trendBuckets = monthOrder.map((key) => trendMap.get(key) as RevenueBucket);
  const maxTrendValue = Math.max(
    1,
    ...trendBuckets.map((bucket) =>
      Math.max(bucket.recognizedLkr, bucket.collectedLkr, bucket.receivableLkr),
    ),
  );

  return {
    recognizedRevenueLkr,
    collectedRevenueLkr,
    receivableRevenueLkr,
    collectionRatePct: recognizedRevenueLkr === 0 ? 0 : collectedRevenueLkr / recognizedRevenueLkr,
    avgBookingValueLkr: confirmedCount === 0 ? 0 : recognizedRevenueLkr / confirmedCount,
    pendingPipelineLkr,
    tentativePipelineLkr,
    cancelledOverrideValueLkr,
    roomBreakdown: toBreakdownRows(recognizedByRoom),
    eventBreakdown: toBreakdownRows(recognizedByEvent),
    acModeBreakdown: toBreakdownRows(recognizedByAcMode),
    dayTypeBreakdown: [
      { key: "weekday", amountLkr: weekdayRevenueLkr },
      { key: "weekend", amountLkr: weekendRevenueLkr },
    ],
    trendBuckets,
    maxTrendValue,
    collectionsQueue: collectionsQueue.sort((a, b) => b.ageDays - a.ageDays),
  };
}

export type AdminCalendarSection =
  | "dashboard"
  | "revenue"
  | "rooms"
  | "event-types"
  | "pricing"
  | "bookings"
  | "blockouts";

type AdminCalendarConsoleProps = {
  section: AdminCalendarSection;
};

export function AdminCalendarConsole({ section }: AdminCalendarConsoleProps) {
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [blockForm, setBlockForm] = useState({
    roomTypeId: "",
    date: "",
    startTime: "07:00",
    endTime: "10:00",
    reason: "Maintenance",
  });
  const [revenueFilters, setRevenueFilters] = useState<RevenueFilters>({
    rangePreset: "last_90_days",
    roomTypeId: "all",
    eventTypeId: "all",
    acMode: "all",
  });

  useEffect(() => {
    void refreshAll();
  }, []);

  async function refreshAll() {
    const [configRes, bookingRes, blockRes] = await Promise.all([
      fetch("/api/admin/calendar/config"),
      fetch("/api/admin/calendar/bookings"),
      fetch("/api/admin/calendar/blocks"),
    ]);

    const configData = (await configRes.json()) as {
      rooms: RoomType[];
      eventTypes: EventType[];
      pricingRules: PricingRule[];
    };
    const bookingData = (await bookingRes.json()) as { bookings: Booking[] };
    const blockData = (await blockRes.json()) as { blocks: CalendarBlock[]; rooms: RoomType[] };

    setRooms(configData.rooms);
    setEventTypes(configData.eventTypes);
    setPricingRules(configData.pricingRules);
    setBookings(bookingData.bookings);
    setBlocks(blockData.blocks);
    setBlockForm((current) => ({
      ...current,
      roomTypeId: current.roomTypeId || configData.rooms[0]?.id || "",
    }));
  }

  async function saveConfig() {
    const res = await fetch("/api/admin/calendar/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rooms, eventTypes, pricingRules }),
    });

    const data = (await res.json()) as { message?: string };
    if (!res.ok) {
      setMessageTone("error");
      setMessage(data.message ?? "Failed to save configuration.");
      return;
    }

    setMessageTone("success");
    setMessage(data.message ?? "Configuration saved.");
    await refreshAll();
  }

  async function updateBookingStatus(id: string, status: Booking["status"]) {
    const res = await fetch("/api/admin/calendar/bookings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    const data = (await res.json()) as { message?: string };
    setMessageTone(res.ok ? "success" : "error");
    setMessage(data.message ?? (res.ok ? "Booking updated." : "Failed to update booking."));
    await refreshAll();
  }

  async function updateReconciliation(
    id: string,
    reconciliationStatus: Booking["reconciliationStatus"],
    reconciliationNotes: string,
  ) {
    await fetch("/api/admin/calendar/bookings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, reconciliationStatus, reconciliationNotes }),
    });
    await refreshAll();
  }

  async function createBlock() {
    const res = await fetch("/api/admin/calendar/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blockForm),
    });

    const data = (await res.json()) as { message?: string };
    setMessage(data.message ?? "Block created.");
    await refreshAll();
  }

  async function removeBlock(id: string) {
    await fetch("/api/admin/calendar/blocks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await refreshAll();
  }

  function removeRoom(roomId: string) {
    const roomName = rooms.find((room) => room.id === roomId)?.name ?? roomId;
    if (bookings.some((booking) => booking.roomTypeId === roomId)) {
      setMessageTone("error");
      setMessage(`Cannot delete "${roomName}" because it has booking history.`);
      return;
    }
    if (blocks.some((block) => block.roomTypeId === roomId)) {
      setMessageTone("error");
      setMessage(`Cannot delete "${roomName}" because it has active blockouts.`);
      return;
    }
    if (eventTypes.some((eventType) => eventType.roomTypeId === roomId)) {
      setMessageTone("error");
      setMessage(`Cannot delete "${roomName}" because event types are attached to it. Reassign them first.`);
      return;
    }
    if (!window.confirm(`Delete room "${roomName}" and its pricing rows?`)) return;

    setRooms((current) => current.filter((room) => room.id !== roomId));
    setPricingRules((current) => current.filter((rule) => rule.roomTypeId !== roomId));
    setBlockForm((current) => ({
      ...current,
      roomTypeId: current.roomTypeId === roomId ? "" : current.roomTypeId,
    }));
    setMessageTone("success");
    setMessage(`Removed room "${roomName}". Click Save Configuration to persist.`);
  }

  function removeEventType(eventTypeId: string) {
    const eventTypeName = eventTypes.find((eventType) => eventType.id === eventTypeId)?.name ?? eventTypeId;
    if (bookings.some((booking) => booking.eventTypeId === eventTypeId)) {
      setMessageTone("error");
      setMessage(`Cannot delete "${eventTypeName}" because it has booking history.`);
      return;
    }
    if (!window.confirm(`Delete event type "${eventTypeName}" and related pricing rows?`)) return;

    setEventTypes((current) => current.filter((eventType) => eventType.id !== eventTypeId));
    setPricingRules((current) => current.filter((rule) => rule.eventTypeId !== eventTypeId));
    setMessageTone("success");
    setMessage(`Removed event type "${eventTypeName}". Click Save Configuration to persist.`);
  }

  function removePricingRule(ruleId: string) {
    if (!window.confirm("Delete this pricing row?")) return;
    setPricingRules((current) => current.filter((rule) => rule.id !== ruleId));
    setMessageTone("success");
    setMessage("Removed pricing row. Click Save Configuration to persist.");
  }

  const roomNameMap = useMemo(
    () => Object.fromEntries(rooms.map((item) => [item.id, item.name])),
    [rooms],
  );
  const eventNameMap = useMemo(
    () => Object.fromEntries(eventTypes.map((item) => [item.id, item.name])),
    [eventTypes],
  );
  const pendingBookings = useMemo(
    () => bookings.filter((booking) => booking.status === "pending").length,
    [bookings],
  );
  const tentativeBookings = useMemo(
    () => bookings.filter((booking) => booking.status === "tentative").length,
    [bookings],
  );
  const confirmedBookings = useMemo(
    () => bookings.filter((booking) => booking.status === "confirmed").length,
    [bookings],
  );
  const currencyFormatter = useMemo(() => new Intl.NumberFormat("en-LK"), []);
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }),
    [],
  );

  const todayYmd = useMemo(() => toYmd(new Date()), []);
  const currentRangeStartYmd = useMemo(() => {
    const today = ymdToDate(todayYmd);
    if (revenueFilters.rangePreset === "current_month") {
      return toYmd(startOfMonth(today));
    }
    if (revenueFilters.rangePreset === "last_30_days") {
      return toYmd(addDays(today, -29));
    }
    return toYmd(addDays(today, -89));
  }, [todayYmd, revenueFilters.rangePreset]);
  const dashboardRangeStartYmd = useMemo(
    () => toYmd(addDays(ymdToDate(todayYmd), -89)),
    [todayYmd],
  );

  const filteredRevenueBookings = useMemo(
    () =>
      bookings.filter((booking) => {
        if (revenueFilters.roomTypeId !== "all" && booking.roomTypeId !== revenueFilters.roomTypeId) return false;
        if (revenueFilters.eventTypeId !== "all" && booking.eventTypeId !== revenueFilters.eventTypeId) return false;
        if (revenueFilters.acMode !== "all" && booking.acMode !== revenueFilters.acMode) return false;
        return booking.slots.some((slot) => inDateRange(slot.date, currentRangeStartYmd, todayYmd));
      }),
    [bookings, revenueFilters, currentRangeStartYmd, todayYmd],
  );

  const revenueModel = useMemo(
    () => buildRevenueModel(filteredRevenueBookings, currentRangeStartYmd, todayYmd),
    [filteredRevenueBookings, currentRangeStartYmd, todayYmd],
  );

  const dashboardRevenueBookings = useMemo(
    () =>
      bookings.filter((booking) =>
        booking.slots.some((slot) => inDateRange(slot.date, dashboardRangeStartYmd, todayYmd)),
      ),
    [bookings, dashboardRangeStartYmd, todayYmd],
  );
  const dashboardRevenueModel = useMemo(
    () => buildRevenueModel(dashboardRevenueBookings, dashboardRangeStartYmd, todayYmd),
    [dashboardRevenueBookings, dashboardRangeStartYmd, todayYmd],
  );

  return (
    <div className="admin-console">
      <p className="admin-note">No authentication layer is included yet. Add RBAC in production.</p>
      {message ? <p className={`form-message ${messageTone}`}>{message}</p> : null}

      {section === "dashboard" ? (
        <section className="admin-panel">
          <h2>Dashboard</h2>
          <div className="admin-dashboard-grid">
            <article className="admin-stat-card">
              <h3>Pending</h3>
              <p>{pendingBookings}</p>
            </article>
            <article className="admin-stat-card">
              <h3>Tentative</h3>
              <p>{tentativeBookings}</p>
            </article>
            <article className="admin-stat-card">
              <h3>Confirmed</h3>
              <p>{confirmedBookings}</p>
            </article>
            <article className="admin-stat-card">
              <h3>Blockouts</h3>
              <p>{blocks.length}</p>
            </article>
          </div>
          <section className="admin-revenue-snapshot">
            <div className="admin-revenue-snapshot-head">
              <h3>Revenue Snapshot (Last 90 Days)</h3>
              <Link className="btn btn-secondary" href="/admin/calendar/revenue">Open Revenue Insights</Link>
            </div>
            <div className="admin-revenue-grid">
              <article className="admin-kpi-card">
                <h4>Recognized</h4>
                <p>LKR {currencyFormatter.format(Math.round(dashboardRevenueModel.recognizedRevenueLkr))}</p>
              </article>
              <article className="admin-kpi-card">
                <h4>Collected</h4>
                <p>LKR {currencyFormatter.format(Math.round(dashboardRevenueModel.collectedRevenueLkr))}</p>
              </article>
              <article className="admin-kpi-card">
                <h4>Receivable</h4>
                <p>LKR {currencyFormatter.format(Math.round(dashboardRevenueModel.receivableRevenueLkr))}</p>
              </article>
              <article className="admin-kpi-card">
                <h4>Collection Rate</h4>
                <p>{percentFormatter.format(dashboardRevenueModel.collectionRatePct)}</p>
              </article>
            </div>
            <div className="admin-chart-panel admin-chart-panel-mini">
              <h4>Recent Monthly Trend</h4>
              <div className="admin-chart-legend">
                <span className="legend-recognized">Recognized</span>
                <span className="legend-collected">Collected</span>
                <span className="legend-receivable">Receivable</span>
              </div>
              <div className="admin-bar-chart">
                {dashboardRevenueModel.trendBuckets.slice(-3).map((bucket) => (
                  <div className="admin-bar-group" key={`dash-${bucket.key}`}>
                    <div className="admin-bar-stack">
                      <span
                        className="admin-bar recognized"
                        style={{ height: `${(bucket.recognizedLkr / dashboardRevenueModel.maxTrendValue) * 100}%` }}
                        title={`Recognized: LKR ${currencyFormatter.format(Math.round(bucket.recognizedLkr))}`}
                      />
                      <span
                        className="admin-bar collected"
                        style={{ height: `${(bucket.collectedLkr / dashboardRevenueModel.maxTrendValue) * 100}%` }}
                        title={`Collected: LKR ${currencyFormatter.format(Math.round(bucket.collectedLkr))}`}
                      />
                      <span
                        className="admin-bar receivable"
                        style={{ height: `${(bucket.receivableLkr / dashboardRevenueModel.maxTrendValue) * 100}%` }}
                        title={`Receivable: LKR ${currencyFormatter.format(Math.round(bucket.receivableLkr))}`}
                      />
                    </div>
                    <span className="admin-bar-label">{bucket.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <div className="admin-quick-links">
            <Link className="btn btn-secondary" href="/admin/calendar/bookings">Go to Bookings</Link>
            <Link className="btn btn-secondary" href="/admin/calendar/blockouts">Go to Blockouts</Link>
            <Link className="btn btn-secondary" href="/admin/calendar/pricing">Go to Pricing</Link>
            <Link className="btn btn-secondary" href="/admin/calendar/revenue">Go to Revenue</Link>
          </div>
        </section>
      ) : null}

      {section === "revenue" ? (
        <section className="admin-panel">
          <h2>Revenue Insights</h2>
          <div className="admin-revenue-filters">
            <select
              value={revenueFilters.rangePreset}
              onChange={(event) =>
                setRevenueFilters((current) => ({
                  ...current,
                  rangePreset: event.target.value as RevenueRangePreset,
                }))
              }
            >
              <option value="last_30_days">Last 30 Days</option>
              <option value="last_90_days">Last 90 Days</option>
              <option value="current_month">Current Month</option>
            </select>
            <select
              value={revenueFilters.roomTypeId}
              onChange={(event) =>
                setRevenueFilters((current) => ({
                  ...current,
                  roomTypeId: event.target.value,
                }))
              }
            >
              <option value="all">All Rooms</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
            <select
              value={revenueFilters.eventTypeId}
              onChange={(event) =>
                setRevenueFilters((current) => ({
                  ...current,
                  eventTypeId: event.target.value,
                }))
              }
            >
              <option value="all">All Event Types</option>
              {eventTypes.map((eventType) => (
                <option key={eventType.id} value={eventType.id}>
                  {eventType.name}
                </option>
              ))}
            </select>
            <select
              value={revenueFilters.acMode}
              onChange={(event) =>
                setRevenueFilters((current) => ({
                  ...current,
                  acMode: event.target.value as RevenueFilters["acMode"],
                }))
              }
            >
              <option value="all">All AC Modes</option>
              <option value="with_ac">With AC</option>
              <option value="without_ac">Without AC</option>
            </select>
          </div>

          <div className="admin-revenue-grid">
            <article className="admin-kpi-card">
              <h4>Recognized</h4>
              <p>LKR {currencyFormatter.format(Math.round(revenueModel.recognizedRevenueLkr))}</p>
            </article>
            <article className="admin-kpi-card">
              <h4>Collected</h4>
              <p>LKR {currencyFormatter.format(Math.round(revenueModel.collectedRevenueLkr))}</p>
            </article>
            <article className="admin-kpi-card">
              <h4>Receivable</h4>
              <p>LKR {currencyFormatter.format(Math.round(revenueModel.receivableRevenueLkr))}</p>
            </article>
            <article className="admin-kpi-card">
              <h4>Collection Rate</h4>
              <p>{percentFormatter.format(revenueModel.collectionRatePct)}</p>
            </article>
            <article className="admin-kpi-card">
              <h4>Avg Booking Value</h4>
              <p>LKR {currencyFormatter.format(Math.round(revenueModel.avgBookingValueLkr))}</p>
            </article>
            <article className="admin-kpi-card">
              <h4>Cancelled Override</h4>
              <p>LKR {currencyFormatter.format(Math.round(revenueModel.cancelledOverrideValueLkr))}</p>
            </article>
          </div>

          <div className="admin-chart-panel">
            <h3>Monthly Revenue Trend</h3>
            <div className="admin-chart-legend">
              <span className="legend-recognized">Recognized</span>
              <span className="legend-collected">Collected</span>
              <span className="legend-receivable">Receivable</span>
            </div>
            <div className="admin-bar-chart">
              {revenueModel.trendBuckets.map((bucket) => (
                <div className="admin-bar-group" key={bucket.key}>
                  <div className="admin-bar-stack">
                    <span
                      className="admin-bar recognized"
                      style={{ height: `${(bucket.recognizedLkr / revenueModel.maxTrendValue) * 100}%` }}
                      title={`Recognized: LKR ${currencyFormatter.format(Math.round(bucket.recognizedLkr))}`}
                    />
                    <span
                      className="admin-bar collected"
                      style={{ height: `${(bucket.collectedLkr / revenueModel.maxTrendValue) * 100}%` }}
                      title={`Collected: LKR ${currencyFormatter.format(Math.round(bucket.collectedLkr))}`}
                    />
                    <span
                      className="admin-bar receivable"
                      style={{ height: `${(bucket.receivableLkr / revenueModel.maxTrendValue) * 100}%` }}
                      title={`Receivable: LKR ${currencyFormatter.format(Math.round(bucket.receivableLkr))}`}
                    />
                  </div>
                  <span className="admin-bar-label">{bucket.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="admin-revenue-breakdowns">
            <article className="admin-panel admin-breakdown-panel">
              <h3>By Room Type</h3>
              <table className="admin-breakdown-table">
                <tbody>
                  {revenueModel.roomBreakdown.map((item) => (
                    <tr key={item.key}>
                      <td>{roomNameMap[item.key] ?? item.key}</td>
                      <td>LKR {currencyFormatter.format(Math.round(item.amountLkr))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
            <article className="admin-panel admin-breakdown-panel">
              <h3>By Appointment Type</h3>
              <table className="admin-breakdown-table">
                <tbody>
                  {revenueModel.eventBreakdown.map((item) => (
                    <tr key={item.key}>
                      <td>{eventNameMap[item.key] ?? item.key}</td>
                      <td>LKR {currencyFormatter.format(Math.round(item.amountLkr))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
            <article className="admin-panel admin-breakdown-panel">
              <h3>AC Mode Split</h3>
              <table className="admin-breakdown-table">
                <tbody>
                  {revenueModel.acModeBreakdown.map((item) => (
                    <tr key={item.key}>
                      <td>{item.key === "with_ac" ? "With AC" : "Without AC"}</td>
                      <td>LKR {currencyFormatter.format(Math.round(item.amountLkr))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
            <article className="admin-panel admin-breakdown-panel">
              <h3>Weekday vs Weekend</h3>
              <table className="admin-breakdown-table">
                <tbody>
                  {revenueModel.dayTypeBreakdown.map((item) => (
                    <tr key={item.key}>
                      <td>{item.key === "weekday" ? "Weekday" : "Weekend"}</td>
                      <td>LKR {currencyFormatter.format(Math.round(item.amountLkr))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </div>

          <div className="admin-risk-panel">
            <article className="admin-kpi-card">
              <h4>Pending Pipeline</h4>
              <p>LKR {currencyFormatter.format(Math.round(revenueModel.pendingPipelineLkr))}</p>
            </article>
            <article className="admin-kpi-card">
              <h4>Tentative Pipeline</h4>
              <p>LKR {currencyFormatter.format(Math.round(revenueModel.tentativePipelineLkr))}</p>
            </article>
          </div>

          <div className="admin-chart-panel">
            <h3>Collections Queue</h3>
            <p className="admin-revenue-note">
              Note: <code>part_paid</code> is counted in both Collected and Receivable until partial payment amounts are tracked.
            </p>
            <div className="booking-summary-wrap">
              <table className="admin-queue-table">
                <thead>
                  <tr>
                    <th>Booking</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Age</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueModel.collectionsQueue.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No unpaid or part-paid confirmed bookings in this range.</td>
                    </tr>
                  ) : (
                    revenueModel.collectionsQueue.map((row) => (
                      <tr key={row.id}>
                        <td>{row.id}</td>
                        <td>{row.customerName}</td>
                        <td>LKR {currencyFormatter.format(Math.round(row.totalAmountLkr))}</td>
                        <td>{row.reconciliationStatus}</td>
                        <td>{row.ageDays} days</td>
                        <td>
                          <Link className="btn btn-secondary" href="/admin/calendar/bookings">
                            Review
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {section === "rooms" ? (
        <section className="admin-panel">
        <h2>Room Types and Working Hours</h2>
        <div className="admin-list">
          {rooms.map((room, index) => (
            <div className="admin-row admin-row-rooms" key={room.id}>
              <input
                placeholder="Room Name"
                value={room.name}
                onChange={(event) =>
                  setRooms((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
              />
              <input
                type="time"
                step={3600}
                value={room.workingHours.startTime}
                onChange={(event) =>
                  setRooms((current) =>
                    current.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            workingHours: {
                              ...item.workingHours,
                              startTime: event.target.value,
                            },
                          }
                        : item,
                    ),
                  )
                }
              />
              <input
                type="time"
                step={3600}
                value={room.workingHours.endTime}
                onChange={(event) =>
                  setRooms((current) =>
                    current.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            workingHours: {
                              ...item.workingHours,
                              endTime: event.target.value,
                            },
                          }
                        : item,
                    ),
                  )
                }
              />
              <button
                className="btn btn-secondary"
                onClick={() => removeRoom(room.id)}
                type="button"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
        <button
          className="btn btn-secondary"
          onClick={() =>
            setRooms((current) => [
              ...current,
              {
                id: uid("room"),
                name: "New Room",
                workingHours: { startTime: "07:00", endTime: "21:00" },
              },
            ])
          }
          type="button"
        >
          Add Room
        </button>
        <button className="btn btn-primary" onClick={saveConfig} type="button">
          Save Configuration
        </button>
        </section>
      ) : null}

      {section === "event-types" ? (
        <section className="admin-panel">
        <h2>Event Types (Duration + Priority)</h2>
        <div className="admin-list">
          {eventTypes.map((eventType, index) => (
            <div className="admin-row admin-row-event-types" key={eventType.id}>
              <input
                value={eventType.name}
                onChange={(event) =>
                  setEventTypes((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
              />
              <select
                value={eventType.roomTypeId ?? ""}
                onChange={(event) =>
                  setEventTypes((current) =>
                    current.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            roomTypeId: event.target.value || undefined,
                          }
                        : item,
                    ),
                  )
                }
              >
                <option value="">All Rooms</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
              <input
                min={1}
                type="number"
                value={eventType.durationHours}
                onChange={(event) =>
                  setEventTypes((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, durationHours: Number(event.target.value) } : item,
                    ),
                  )
                }
              />
              <input
                min={1}
                type="number"
                value={eventType.priority}
                onChange={(event) =>
                  setEventTypes((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, priority: Number(event.target.value) } : item,
                    ),
                  )
                }
              />
              <button
                className="btn btn-secondary"
                onClick={() => removeEventType(eventType.id)}
                type="button"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
        <button
          className="btn btn-secondary"
          onClick={() =>
            setEventTypes((current) => [
              ...current,
              { id: uid("event"), name: "New Type", durationHours: 4, priority: 1, roomTypeId: rooms[0]?.id },
            ])
          }
          type="button"
        >
          Add Event Type
        </button>
        <button className="btn btn-primary" onClick={saveConfig} type="button">
          Save Configuration
        </button>
        </section>
      ) : null}

      {section === "pricing" ? (
        <section className="admin-panel">
        <h2>Pricing Matrix</h2>
        <div className="admin-list">
          {pricingRules.map((rule, index) => (
            <div className="admin-row admin-row-pricing" key={rule.id}>
              <select
                value={rule.roomTypeId}
                onChange={(event) =>
                  setPricingRules((current) =>
                    current.map((item, i) => {
                      if (i !== index) return item;
                      const nextRoomTypeId = event.target.value;
                      const allowedEventTypeIds = eventTypes
                        .filter((eventType) => !eventType.roomTypeId || eventType.roomTypeId === nextRoomTypeId)
                        .map((eventType) => eventType.id);
                      return {
                        ...item,
                        roomTypeId: nextRoomTypeId,
                        eventTypeId: allowedEventTypeIds.includes(item.eventTypeId)
                          ? item.eventTypeId
                          : (allowedEventTypeIds[0] ?? ""),
                      };
                    }),
                  )
                }
              >
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
              <select
                value={rule.eventTypeId}
                onChange={(event) =>
                  setPricingRules((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, eventTypeId: event.target.value } : item,
                    ),
                  )
                }
              >
                {eventTypes
                  .filter((eventType) => !eventType.roomTypeId || eventType.roomTypeId === rule.roomTypeId)
                  .map((eventType) => (
                  <option key={eventType.id} value={eventType.id}>
                    {eventType.name}
                  </option>
                  ))}
              </select>
              <select
                value={rule.acMode}
                onChange={(event) =>
                  setPricingRules((current) =>
                    current.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            acMode: event.target.value as "with_ac" | "without_ac",
                          }
                        : item,
                    ),
                  )
                }
              >
                <option value="with_ac">With AC</option>
                <option value="without_ac">Without AC</option>
              </select>
              <select
                value={rule.dayType}
                onChange={(event) =>
                  setPricingRules((current) =>
                    current.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            dayType: event.target.value as "weekday" | "weekend" | "any",
                          }
                        : item,
                    ),
                  )
                }
              >
                <option value="any">Any Day</option>
                <option value="weekday">Weekday</option>
                <option value="weekend">Weekend</option>
              </select>
              <input
                min={0}
                type="number"
                value={rule.amountLkr}
                onChange={(event) =>
                  setPricingRules((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, amountLkr: Number(event.target.value) } : item,
                    ),
                  )
                }
              />
              <button
                className="btn btn-secondary"
                onClick={() => removePricingRule(rule.id)}
                type="button"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
        <button
          className="btn btn-secondary"
          onClick={() =>
            setPricingRules((current) => [
              ...current,
              {
                id: uid("price"),
                roomTypeId: rooms[0]?.id ?? "",
                eventTypeId: eventTypes[0]?.id ?? "",
                acMode: "without_ac",
                dayType: "any",
                amountLkr: 0,
              },
            ])
          }
          type="button"
        >
          Add Pricing Row
        </button>
        <button className="btn btn-primary" onClick={saveConfig} type="button">
          Save Configuration
        </button>
        </section>
      ) : null}

      {section === "blockouts" ? (
        <section className="admin-panel">
        <h2>Calendar Blockouts</h2>
        <div className="admin-row">
          <select
            value={blockForm.roomTypeId}
            onChange={(event) =>
              setBlockForm((current) => ({ ...current, roomTypeId: event.target.value }))
            }
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={blockForm.date}
            onChange={(event) =>
              setBlockForm((current) => ({ ...current, date: event.target.value }))
            }
          />
          <input
            type="time"
            value={blockForm.startTime}
            onChange={(event) =>
              setBlockForm((current) => ({ ...current, startTime: event.target.value }))
            }
          />
          <input
            type="time"
            value={blockForm.endTime}
            onChange={(event) =>
              setBlockForm((current) => ({ ...current, endTime: event.target.value }))
            }
          />
          <input
            type="text"
            value={blockForm.reason}
            onChange={(event) =>
              setBlockForm((current) => ({ ...current, reason: event.target.value }))
            }
          />
          <button className="btn btn-primary" onClick={createBlock} type="button">
            Block Slot
          </button>
        </div>
        <ul className="selected-slot-list">
          {blocks.map((block) => (
            <li key={block.id}>
              {roomNameMap[block.roomTypeId]} {block.date} {block.startTime}-{block.endTime} ({block.reason})
              <button
                className="btn btn-secondary"
                onClick={() => void removeBlock(block.id)}
                type="button"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        </section>
      ) : null}

      {section === "bookings" ? (
        <section className="admin-panel">
        <h2>Booking Queue and Reconciliation</h2>
        <div className="admin-bookings">
          {bookings.map((booking) => (
            <article className="admin-booking-card" key={booking.id}>
              <h3>
                {booking.customer.name} - {roomNameMap[booking.roomTypeId]} / {eventNameMap[booking.eventTypeId]}
              </h3>
              <p>
                Status: <strong>{booking.status}</strong>
              </p>
              <p>Total: LKR {new Intl.NumberFormat("en-LK").format(booking.totalAmountLkr)}</p>
              <p>
                {booking.customer.email} | {booking.customer.phone}
              </p>
              <p>{booking.customer.purpose}</p>
              <ul className="selected-slot-list">
                {booking.slots.map((slot) => (
                  <li key={`${booking.id}-${slot.date}-${slot.startTime}`}>
                    {slot.date} {slot.startTime}-{slot.endTime}
                  </li>
                ))}
              </ul>

              <div className="admin-row">
                <button
                  className="btn btn-secondary"
                  onClick={() => void updateBookingStatus(booking.id, "confirmed")}
                  type="button"
                >
                  Approve
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => void updateBookingStatus(booking.id, "tentative")}
                  type="button"
                >
                  Tentative
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => void updateBookingStatus(booking.id, "rejected")}
                  type="button"
                >
                  Reject
                </button>
              </div>

              <div className="admin-row">
                <select
                  value={booking.reconciliationStatus}
                  onChange={(event) =>
                    void updateReconciliation(
                      booking.id,
                      event.target.value as Booking["reconciliationStatus"],
                      booking.reconciliationNotes,
                    )
                  }
                >
                  <option value="unpaid">Unpaid</option>
                  <option value="part_paid">Part Paid</option>
                  <option value="paid">Paid</option>
                  <option value="waived">Waived</option>
                </select>
                <input
                  placeholder="Reconciliation notes"
                  value={booking.reconciliationNotes}
                  onChange={(event) =>
                    setBookings((current) =>
                      current.map((item) =>
                        item.id === booking.id
                          ? { ...item, reconciliationNotes: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    void updateReconciliation(
                      booking.id,
                      booking.reconciliationStatus,
                      booking.reconciliationNotes,
                    )
                  }
                  type="button"
                >
                  Save Notes
                </button>
              </div>
            </article>
          ))}
        </div>
        </section>
      ) : null}
    </div>
  );
}
