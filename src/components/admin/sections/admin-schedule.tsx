"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminLogoutButton } from "@/components/admin/admin-logout-button";
import { useAdminSession } from "@/components/admin/admin-session-context";
import { safeJson } from "@/lib/admin/api";

/* ── Types (mirror admin-bookings / admin-revenue shapes) ────────────────── */

type BookingStatus = "pending" | "confirmed" | "tentative" | "rejected" | "cancelled_override";

type RoomType = {
  id: string;
  name: string;
  workingHours: { startTime: string; endTime: string };
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
  status: BookingStatus;
  customer: { name: string; purpose: string };
  slots: Slot[];
};

type EventType = { id: string; name: string };

/* ── Display constants ───────────────────────────────────────────────────── */

const ROW_HEIGHT = 24; // pixels per half-hour
const PX_PER_MINUTE = ROW_HEIGHT / 30;

const STATUS_KEYS: BookingStatus[] = [
  "pending",
  "tentative",
  "confirmed",
  "rejected",
  "cancelled_override",
];

const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "PENDING",
  tentative: "TENTATIVE",
  confirmed: "CONFIRMED",
  rejected: "REJECTED",
  cancelled_override: "CANCELLED",
};

// Up to 6 rooms get a distinct hue; further rooms cycle. Tokens declared in
// src/styles/admin.css (--ac-chart-1 .. --ac-chart-6).
const ROOM_PALETTE = [
  "var(--ac-gold)",
  "var(--ac-chart-2)",
  "var(--ac-chart-3)",
  "var(--ac-chart-4)",
  "var(--ac-chart-5)",
  "var(--ac-chart-6)",
];

const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/* ── Date helpers ────────────────────────────────────────────────────────── */

function fmtYmd(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ymdToDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function startOfWeek(d: Date) {
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? -6 : 1 - day;
  const out = new Date(d);
  out.setDate(out.getDate() + diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function toHour(hhmm: string) {
  return Math.floor(toMinutes(hhmm) / 60);
}

function fmtMonthDay(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/* ── Block layout (lane assignment for overlapping slots) ────────────────── */

type RawBlock = {
  bookingId: string;
  reference: string;
  roomTypeId: string;
  eventTypeId: string;
  status: BookingStatus;
  customerName: string;
  purpose: string;
  date: string;
  startMin: number;
  endMin: number;
};

type LaidOutBlock = RawBlock & { lane: number; lanesInGroup: number };

/** Assign each block a lane index so visually-overlapping blocks sit side-by-side.
 * Greedy first-fit: blocks sorted by start; for each, place in the earliest lane
 * whose last block has already ended. */
function assignLanes(blocks: RawBlock[]): LaidOutBlock[] {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const lanes: number[] = []; // each entry = endMin of last block in that lane
  const out: Array<RawBlock & { lane: number }> = [];
  for (const block of sorted) {
    let placed = -1;
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i] <= block.startMin) {
        placed = i;
        lanes[i] = block.endMin;
        break;
      }
    }
    if (placed === -1) {
      placed = lanes.length;
      lanes.push(block.endMin);
    }
    out.push({ ...block, lane: placed });
  }

  // Pass 2: compute lanesInGroup per block as the max lane count among
  // anything that overlaps it. Keeps a tight-packed day from forcing
  // narrow widths on lone bookings elsewhere in the same day.
  return out.map((block) => {
    let maxLane = block.lane;
    for (const other of out) {
      if (other === block) continue;
      const overlaps = other.startMin < block.endMin && block.startMin < other.endMin;
      if (overlaps && other.lane > maxLane) maxLane = other.lane;
    }
    return { ...block, lanesInGroup: maxLane + 1 };
  });
}

/* ── Component ───────────────────────────────────────────────────────────── */

export function AdminSchedule() {
  const session = useAdminSession();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [weekStartDate, setWeekStartDate] = useState<Date>(() => startOfWeek(new Date()));
  const [hiddenRoomIds, setHiddenRoomIds] = useState<Set<string>>(new Set());
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<BookingStatus>>(
    () => new Set(["rejected", "cancelled_override"]),
  );

  /* ── Derived: week dates + working hour window ─────────────────────────── */

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => fmtYmd(addDays(weekStartDate, i))),
    [weekStartDate],
  );

  /* ── Data fetch (scoped to the visible week) ──────────────────────────── */
  // /api/admin/calendar/bookings supports ?fromDate&toDate — when both are
  // present, only bookings with at least one slot inside that window come
  // back. Switching weeks refetches the new window.
  useEffect(() => {
    if (weekDates.length === 0) return;
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          fromDate: weekDates[0],
          toDate: weekDates[weekDates.length - 1],
        });
        const res = await fetch(`/api/admin/calendar/bookings?${params.toString()}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) throw new Error("Failed to load schedule data.");
        const data = await safeJson<{
          bookings: Booking[];
          rooms: RoomType[];
          eventTypes: EventType[];
        }>(res);
        if (cancelled) return;
        setBookings(data?.bookings ?? []);
        setRooms(data?.rooms ?? []);
        setEventTypes(data?.eventTypes ?? []);
        setErrorMessage("");
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : "Failed to load schedule.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekDates]);

  const todayYmd = useMemo(() => fmtYmd(new Date()), []);

  const { firstVisibleHour, lastVisibleHour } = useMemo(() => {
    if (rooms.length === 0) {
      return { firstVisibleHour: 6, lastVisibleHour: 22 };
    }
    let earliest = 24;
    let latest = 0;
    for (const room of rooms) {
      const startH = toHour(room.workingHours.startTime);
      const endH = toHour(room.workingHours.endTime);
      if (startH < earliest) earliest = startH;
      if (endH > latest) latest = endH;
    }
    return {
      firstVisibleHour: Math.max(0, earliest - 1),
      lastVisibleHour: Math.min(23, latest + 1),
    };
  }, [rooms]);

  const firstVisibleMinute = firstVisibleHour * 60;
  const visibleSubRows = (lastVisibleHour - firstVisibleHour + 1) * 2;
  const bodyHeight = visibleSubRows * ROW_HEIGHT;

  /* ── Room color map ───────────────────────────────────────────────────── */
  const roomColorMap = useMemo(() => {
    const map = new Map<string, string>();
    rooms.forEach((room, i) => {
      map.set(room.id, ROOM_PALETTE[i % ROOM_PALETTE.length]);
    });
    return map;
  }, [rooms]);

  /* ── Build blocks per day ─────────────────────────────────────────────── */
  const blocksByDate = useMemo(() => {
    const map: Record<string, RawBlock[]> = {};
    for (const date of weekDates) map[date] = [];

    for (const booking of bookings) {
      if (hiddenRoomIds.has(booking.roomTypeId)) continue;
      for (const slot of booking.slots) {
        if (!weekDates.includes(slot.date)) continue;
        const effectiveStatus: BookingStatus = slot.slotStatus ?? booking.status;
        if (hiddenStatuses.has(effectiveStatus)) continue;
        map[slot.date].push({
          bookingId: booking.id,
          reference: booking.reference,
          roomTypeId: booking.roomTypeId,
          eventTypeId: booking.eventTypeId,
          status: effectiveStatus,
          customerName: booking.customer.name,
          purpose: booking.customer.purpose,
          date: slot.date,
          startMin: toMinutes(slot.startTime),
          endMin: toMinutes(slot.endTime),
        });
      }
    }

    const out: Record<string, LaidOutBlock[]> = {};
    for (const date of weekDates) out[date] = assignLanes(map[date]);
    return out;
  }, [bookings, weekDates, hiddenRoomIds, hiddenStatuses]);

  const totalVisibleBlocks = useMemo(
    () => weekDates.reduce((sum, d) => sum + (blocksByDate[d]?.length ?? 0), 0),
    [blocksByDate, weekDates],
  );

  const eventTypeNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of eventTypes) m.set(t.id, t.name);
    return m;
  }, [eventTypes]);

  /* ── Handlers ─────────────────────────────────────────────────────────── */

  const goPrevWeek = useCallback(() => {
    setWeekStartDate((d) => addDays(d, -7));
  }, []);
  const goNextWeek = useCallback(() => {
    setWeekStartDate((d) => addDays(d, 7));
  }, []);
  const goToday = useCallback(() => {
    setWeekStartDate(startOfWeek(new Date()));
  }, []);

  const toggleRoom = useCallback((roomId: string) => {
    setHiddenRoomIds((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  }, []);
  const toggleStatus = useCallback((status: BookingStatus) => {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

  /* ── Render ──────────────────────────────────────────────────────────── */

  const weekRangeLabel = `${fmtMonthDay(ymdToDate(weekDates[0]))} – ${fmtMonthDay(ymdToDate(weekDates[6]))}, ${ymdToDate(weekDates[6]).getFullYear()}`;
  const containsToday = weekDates.includes(todayYmd);

  return (
    <div className="admin-section admin-schedule">
      <section className="admin-schedule-hero">
        <div className="admin-schedule-hero-grid">
          <div>
            <div className="ac-mono admin-schedule-hero-eyebrow">{"// SCHEDULE · OPERATIONS"}</div>
            <h1 className="admin-schedule-hero-title">
              <span className="ac-display">
                Calendar<span className="punct">.</span>
              </span>{" "}
              <span className="ac-italic admin-schedule-hero-italic">overview.</span>
            </h1>
            <p className="admin-schedule-hero-blurb">
              Unified week view across all venues. Bookings color-coded by room with their
              purpose visible inline. Click a legend chip to hide that segment.
            </p>
          </div>
          <div className="admin-schedule-hero-side">
            <div className="admin-schedule-identity-pill">
              <span aria-hidden className="admin-schedule-identity-dot" />
              <span className="admin-schedule-identity-email">{session.email ?? "—"}</span>
              <span className="admin-schedule-identity-role">
                {session.isSuperAdmin ? "Super admin" : "Admin"}
              </span>
            </div>
            <AdminLogoutButton />
          </div>
        </div>
      </section>

      <section className="admin-schedule-controls">
        <div className="admin-schedule-week-nav">
          <button className="admin-schedule-nav-btn" onClick={goPrevWeek} type="button">
            ← Prev week
          </button>
          <button
            className={`admin-schedule-nav-btn${containsToday ? " is-today" : ""}`}
            onClick={goToday}
            type="button"
          >
            {containsToday ? "● This week" : "Today"}
          </button>
          <button className="admin-schedule-nav-btn" onClick={goNextWeek} type="button">
            Next week →
          </button>
        </div>
        <div className="admin-schedule-week-label">
          <span className="ac-mono">{weekRangeLabel}</span>
          <span className="admin-schedule-week-count">
            {totalVisibleBlocks} {totalVisibleBlocks === 1 ? "slot" : "slots"} shown
          </span>
        </div>
      </section>

      <section className="admin-schedule-legend">
        <div className="admin-schedule-legend-group">
          <span className="ac-mono admin-schedule-legend-label">Venues</span>
          <div className="admin-schedule-legend-chips">
            {rooms.map((room) => {
              const hidden = hiddenRoomIds.has(room.id);
              const color = roomColorMap.get(room.id) ?? "var(--ac-text-dim)";
              return (
                <button
                  className={`admin-schedule-legend-chip${hidden ? " is-hidden" : ""}`}
                  key={room.id}
                  onClick={() => toggleRoom(room.id)}
                  type="button"
                  style={{ "--chip-color": color } as React.CSSProperties}
                  aria-pressed={!hidden}
                >
                  <span className="admin-schedule-legend-swatch" aria-hidden />
                  <span>{room.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="admin-schedule-legend-group">
          <span className="ac-mono admin-schedule-legend-label">Status</span>
          <div className="admin-schedule-legend-chips">
            {STATUS_KEYS.map((status) => {
              const hidden = hiddenStatuses.has(status);
              return (
                <button
                  className={`admin-schedule-legend-chip is-status tone-${status}${hidden ? " is-hidden" : ""}`}
                  key={status}
                  onClick={() => toggleStatus(status)}
                  type="button"
                  aria-pressed={!hidden}
                >
                  <span className="admin-schedule-legend-swatch" aria-hidden />
                  <span>{STATUS_LABELS[status]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {errorMessage ? (
        <div className="admin-schedule-error ac-mono">{errorMessage}</div>
      ) : null}

      {isLoading ? (
        <div className="admin-schedule-loading ac-mono">Loading week…</div>
      ) : (
        <section className="admin-schedule-grid-wrap">
          <div
            className="admin-schedule-grid"
            style={{ "--row-h": `${ROW_HEIGHT}px` } as React.CSSProperties}
          >
            <div className="admin-schedule-grid-head">
              <div className="admin-schedule-grid-time-head">
                <span className="ac-mono">TIME</span>
              </div>
              {weekDates.map((date, i) => {
                const d = ymdToDate(date);
                const isToday = date === todayYmd;
                return (
                  <div
                    className={`admin-schedule-grid-day-head${isToday ? " is-today" : ""}`}
                    key={date}
                  >
                    <span className="ac-mono admin-schedule-day-name">{WEEKDAY_LABELS[i]}</span>
                    <span className="admin-schedule-day-date">{fmtMonthDay(d)}</span>
                  </div>
                );
              })}
            </div>

            <div className="admin-schedule-grid-body" style={{ height: bodyHeight }}>
              {Array.from({ length: visibleSubRows }, (_, i) => {
                const minute = i * 30;
                const totalMinute = firstVisibleMinute + minute;
                const hour = Math.floor(totalMinute / 60);
                const minOfHour = totalMinute % 60;
                const isHourRow = minOfHour === 0;
                return (
                  <div
                    className={`admin-schedule-grid-row${isHourRow ? " is-hour" : " is-half"}`}
                    key={i}
                  >
                    <div className="admin-schedule-grid-time-cell">
                      {isHourRow ? (
                        <span className="ac-mono">{String(hour).padStart(2, "0")}:00</span>
                      ) : null}
                    </div>
                    {weekDates.map((date) => (
                      <div className="admin-schedule-grid-cell" key={`${date}-${i}`} />
                    ))}
                  </div>
                );
              })}

              <div className="admin-schedule-grid-blocks" aria-hidden={false}>
                {weekDates.map((date, dayIndex) => {
                  const blocks = blocksByDate[date] ?? [];
                  return (
                    <div
                      className="admin-schedule-day-blocks"
                      data-day={dayIndex}
                      key={`blocks-${date}`}
                    >
                      {blocks.map((block) => {
                        const top = (block.startMin - firstVisibleMinute) * PX_PER_MINUTE;
                        const height = (block.endMin - block.startMin) * PX_PER_MINUTE - 3;
                        if (top < 0 || height <= 0) return null;
                        const lanePct = 100 / block.lanesInGroup;
                        const left = block.lane * lanePct;
                        const width = lanePct;
                        const color = roomColorMap.get(block.roomTypeId) ?? "var(--ac-text-dim)";
                        const eventTypeName = eventTypeNameMap.get(block.eventTypeId) ?? "";
                        const startHH = String(Math.floor(block.startMin / 60)).padStart(2, "0");
                        const startMM = String(block.startMin % 60).padStart(2, "0");
                        const endHH = String(Math.floor(block.endMin / 60)).padStart(2, "0");
                        const endMM = String(block.endMin % 60).padStart(2, "0");
                        const timeRange = `${startHH}:${startMM}–${endHH}:${endMM}`;
                        const purpose = block.purpose?.trim() ?? "";
                        const primary = purpose || eventTypeName || block.customerName || "—";
                        const isInactive =
                          block.status === "rejected" || block.status === "cancelled_override";

                        // Tiered detail levels — each step adds one row of metadata
                        // as the block grows tall enough to fit it.
                        const tier =
                          height >= 128
                            ? 5
                            : height >= 96
                              ? 4
                              : height >= 64
                                ? 3
                                : height >= 44
                                  ? 2
                                  : 1;
                        const showChipRow = tier >= 2;
                        const showCompactDot = tier === 1;
                        const showCustomer = tier >= 3;
                        const showMeta = tier >= 4;
                        const showReference = tier >= 5;

                        return (
                          <Link
                            className={`admin-schedule-block tone-${block.status} is-tier-${tier}${isInactive ? " is-inactive" : ""}`}
                            href={`/admin/calendar/bookings?id=${block.bookingId}`}
                            key={`b-${block.bookingId}-${block.startMin}`}
                            style={
                              {
                                top,
                                height,
                                left: `calc(${left}% + 2px)`,
                                width: `calc(${width}% - 4px)`,
                                "--block-color": color,
                              } as React.CSSProperties
                            }
                            title={`${block.reference} · ${timeRange} · ${block.customerName}${purpose ? ` · ${purpose}` : ""}${eventTypeName ? ` · ${eventTypeName}` : ""}`}
                          >
                            {showChipRow ? (
                              <div className="admin-schedule-block-head">
                                <span className="admin-schedule-block-chip">
                                  {STATUS_LABELS[block.status]}
                                </span>
                              </div>
                            ) : null}
                            <div className="admin-schedule-block-primary">
                              {showCompactDot ? (
                                <span aria-hidden className="admin-schedule-block-dot" />
                              ) : null}
                              <span className="admin-schedule-block-primary-text">{primary}</span>
                            </div>
                            {showCustomer ? (
                              <div className="admin-schedule-block-customer">
                                {block.customerName || "—"}
                              </div>
                            ) : null}
                            {showMeta ? (
                              <div className="admin-schedule-block-meta ac-mono">
                                {timeRange}
                                {eventTypeName ? ` · ${eventTypeName}` : ""}
                              </div>
                            ) : null}
                            {showReference ? (
                              <div className="admin-schedule-block-ref ac-mono">
                                {block.reference}
                              </div>
                            ) : null}
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {totalVisibleBlocks === 0 ? (
            <div className="admin-schedule-empty ac-mono">
              No bookings match the current filters this week.
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
