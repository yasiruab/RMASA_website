"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { TurnstileWidget } from "@/components/calendar/turnstile-widget";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/* ─── Types ─────────────────────────────────────────────────────── */

type RoomType = {
  id: string;
  name: string;
  workingHours: { startTime: string; endTime: string };
  capacity?: number;
  description?: string;
};
type EventType = {
  id: string;
  name: string;
  durationHours: number;
  priority: number;
  roomTypeId?: string;
  maxAdvanceBookingDays: number;
};
type PricingRule = {
  id: string;
  roomTypeId: string;
  eventTypeId: string;
  acMode: "with_ac" | "without_ac";
  dayType: "weekday" | "weekend" | "any";
  amountLkr: number;
};

type Slot = {
  date: string;
  startTime: string;
  endTime: string;
  status: "available" | "pending" | "confirmed" | "tentative" | "blocked" | "cleanup";
  bookingId?: string;
  bookingStartTime?: string;
  bookingEndTime?: string;
  reason?: string;
};

type RecurrenceFrequency = "none" | "daily" | "weekly" | "monthly";
type RecurrenceLimitType = "end_date" | "occurrences";

const STATUS_LABELS: Record<Slot["status"], string> = {
  available: "Available",
  pending: "PENDING",
  confirmed: "CONFIRMED",
  tentative: "HELD",
  blocked: "BLOCKED",
  cleanup: "PREP",
};

/* ─── Date / time helpers ───────────────────────────────────────── */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ymdToDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addDaysYmd(date: string, days: number) {
  const d = ymdToDate(date);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function addMonthsYmd(date: string, months: number) {
  const d = ymdToDate(date);
  d.setMonth(d.getMonth() + months);
  return formatDate(d);
}

function isoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

function currency(value: number) {
  return new Intl.NumberFormat("en-LK").format(value);
}

function formatLkrK(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1000) {
    const k = value / 1000;
    return `LKR ${k < 10 ? k.toFixed(1) : Math.round(k).toString()}K`;
  }
  return `LKR ${Math.round(value)}`;
}

function venueTagPrefix(index: number): string {
  return `VENUE ${String(index + 1).padStart(2, "0")}`;
}

function formatCapacity(capacity: number | undefined): string {
  if (capacity === undefined || capacity === null || !Number.isFinite(capacity)) return "—";
  return new Intl.NumberFormat("en-LK").format(capacity);
}

function getRoomHourlyRate(
  rules: PricingRule[],
  eventTypes: EventType[],
  roomId: string,
): number | null {
  const candidates = rules
    .filter(
      (r) =>
        r.roomTypeId === roomId &&
        r.acMode === "without_ac" &&
        (r.dayType === "weekday" || r.dayType === "any"),
    )
    .map((r) => {
      const et = eventTypes.find((e) => e.id === r.eventTypeId);
      if (!et || et.durationHours <= 0) return null;
      return r.amountLkr / et.durationHours;
    })
    .filter((v): v is number => v !== null);
  return candidates.length ? Math.min(...candidates) : null;
}

// The "full day" event type for a room is whichever event type the admin has
// configured with the longest durationHours and has pricing rules for the room.
function getFullDayEventTypeId(
  rules: PricingRule[],
  eventTypes: EventType[],
  roomId: string,
): string | null {
  const eligibleIds = new Set(
    rules
      .filter(
        (r) =>
          r.roomTypeId === roomId &&
          (r.dayType === "weekday" || r.dayType === "any"),
      )
      .map((r) => r.eventTypeId),
  );
  const eligible = eventTypes.filter((e) => eligibleIds.has(e.id));
  if (eligible.length === 0) return null;
  return eligible.reduce((longest, et) =>
    et.durationHours > longest.durationHours ? et : longest,
  ).id;
}

function getRoomDayRate(
  rules: PricingRule[],
  eventTypes: EventType[],
  roomId: string,
): number | null {
  const fullDayId = getFullDayEventTypeId(rules, eventTypes, roomId);
  if (!fullDayId) return null;
  const rule = rules.find(
    (r) =>
      r.roomTypeId === roomId &&
      r.eventTypeId === fullDayId &&
      r.acMode === "without_ac" &&
      (r.dayType === "weekday" || r.dayType === "any"),
  );
  return rule?.amountLkr ?? null;
}

function getAcPremiumFullDay(
  rules: PricingRule[],
  eventTypes: EventType[],
  roomId: string,
): number | null {
  const fullDayId = getFullDayEventTypeId(rules, eventTypes, roomId);
  if (!fullDayId) return null;
  const findRule = (mode: "with_ac" | "without_ac") =>
    rules.find(
      (r) =>
        r.roomTypeId === roomId &&
        r.eventTypeId === fullDayId &&
        r.acMode === mode &&
        (r.dayType === "weekday" || r.dayType === "any"),
    );
  const withAc = findRule("with_ac");
  const withoutAc = findRule("without_ac");
  if (!withAc || !withoutAc) return null;
  const diff = withAc.amountLkr - withoutAc.amountLkr;
  return diff > 0 ? diff : null;
}

function dayType(date: string): "weekday" | "weekend" {
  const d = ymdToDate(date).getDay();
  return d === 0 || d === 6 ? "weekend" : "weekday";
}

function toHour(time: string) {
  return Number(time.split(":")[0]);
}

function toMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function toHourLabel(hour: number) {
  const h = hour % 24;
  const suffix = h >= 12 ? "PM" : "AM";
  const norm = h % 12 === 0 ? 12 : h % 12;
  return hour === 0 || hour === 12 ? `${norm} ${suffix}` : `${norm}`;
}

function slotKey(slot: { date: string; startTime: string; endTime: string }) {
  return `${slot.date}-${slot.startTime}-${slot.endTime}`;
}

function overlapsSlots(
  a: { date: string; startTime: string; endTime: string },
  b: { date: string; startTime: string; endTime: string },
) {
  if (a.date !== b.date) return false;
  const aStart = toMinutes(a.startTime);
  const aEnd = toMinutes(a.endTime);
  const bStart = toMinutes(b.startTime);
  const bEnd = toMinutes(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

function getPrice(
  pricingRules: PricingRule[],
  roomTypeId: string,
  eventTypeId: string,
  acMode: "with_ac" | "without_ac",
  date: string,
) {
  const type = dayType(date);
  return (
    pricingRules.find(
      (r) =>
        r.roomTypeId === roomTypeId &&
        r.eventTypeId === eventTypeId &&
        r.acMode === acMode &&
        r.dayType === type,
    ) ??
    pricingRules.find(
      (r) =>
        r.roomTypeId === roomTypeId &&
        r.eventTypeId === eventTypeId &&
        r.acMode === acMode &&
        r.dayType === "any",
    )
  );
}

function expandRecurrencePreview(
  selectedSlots: Array<{ date: string; startTime: string; endTime: string }>,
  frequency: RecurrenceFrequency,
  endDate: string,
  occurrences: string,
) {
  if (frequency === "none" || selectedSlots.length === 0) return [];
  // No preview until the admin has set an explicit limit.
  if (!endDate && !occurrences) return [];

  const baseDates = [...new Set(selectedSlots.map((slot) => slot.date))].sort();
  const maxSteps = occurrences ? Math.max(0, Number(occurrences) - 1) : Number.POSITIVE_INFINITY;
  const results: Array<{ date: string; startTime: string; endTime: string }> = [];

  let step = 1;
  while (step <= maxSteps) {
    const nextDates = baseDates.map((date) => {
      if (frequency === "daily") return addDaysYmd(date, step);
      if (frequency === "weekly") return addDaysYmd(date, step * 7);
      return addMonthsYmd(date, step);
    });

    const furthest = nextDates[nextDates.length - 1];
    if (endDate && furthest > endDate) break;

    results.push(
      ...selectedSlots.map((slot) => ({
        ...slot,
        date: nextDates[baseDates.indexOf(slot.date)],
      })),
    );

    step += 1;
    if (step > 183) break;
  }

  return results;
}

/* ─── Main component ───────────────────────────────────────────── */

export function BookingCalendarFlow() {
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [roomTypeId, setRoomTypeId] = useState("");
  const [eventTypeId, setEventTypeId] = useState("");
  const [acMode, setAcMode] = useState<"with_ac" | "without_ac">("without_ac");
  const [weekStartDate, setWeekStartDate] = useState(startOfWeek(new Date()));
  const [weekSlots, setWeekSlots] = useState<Record<string, Slot[]>>({});
  const [selectedSlots, setSelectedSlots] = useState<
    Array<{ date: string; startTime: string; endTime: string }>
  >([]);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("none");
  const [recurrenceLimitType, setRecurrenceLimitType] = useState<RecurrenceLimitType>("end_date");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [occurrences, setOccurrences] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "", purpose: "" });
  const [availabilityRefreshKey, setAvailabilityRefreshKey] = useState(0);
  const [selectedDayDate, setSelectedDayDate] = useState<string>("");
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<"timeout" | "failed" | null>(null);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const turnstileRequired = TURNSTILE_SITE_KEY.length > 0;

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => formatDate(addDays(weekStartDate, i))),
    [weekStartDate],
  );
  const visibleMonth = weekStartDate.getMonth();
  const visibleYear = weekStartDate.getFullYear();
  const visibleYearOptions = useMemo(
    () => Array.from({ length: 7 }, (_, i) => visibleYear - 3 + i),
    [visibleYear],
  );

  // Keep the day-view focus on a valid date when the visible week changes.
  useEffect(() => {
    if (weekDates.length === 0) return;
    if (selectedDayDate && weekDates.includes(selectedDayDate)) return;
    const today = formatDate(new Date());
    setSelectedDayDate(weekDates.includes(today) ? today : weekDates[0]);
  }, [weekDates, selectedDayDate]);

  /* ─── Config fetch ───────────────────────────────────────────── */
  useEffect(() => {
    const controller = new AbortController();
    const timeoutMs = configAttempt === 0 ? 60_000 : 20_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let cancelled = false;

    setIsConfigLoading(true);
    setConfigError(null);

    void (async () => {
      try {
        const res = await fetch("/api/calendar/config", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Config request failed (${res.status})`);
        const data = (await res.json()) as {
          rooms: RoomType[];
          eventTypes: EventType[];
          pricingRules: PricingRule[];
        };
        if (cancelled) return;
        setRooms(data.rooms);
        setEventTypes(data.eventTypes);
        setPricingRules(data.pricingRules);
        const firstRoomId = data.rooms[0]?.id ?? "";
        setRoomTypeId(firstRoomId);
        const firstRoomEventType = data.eventTypes.find(
          (type) =>
            (!type.roomTypeId || type.roomTypeId === firstRoomId) &&
            data.pricingRules.some(
              (rule) => rule.roomTypeId === firstRoomId && rule.eventTypeId === type.id,
            ),
        );
        setEventTypeId(firstRoomEventType?.id ?? "");
        setIsConfigLoading(false);
      } catch (err) {
        if (cancelled) return;
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        setConfigError(isAbort ? "timeout" : "failed");
        setIsConfigLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [configAttempt]);

  const retryConfig = useCallback(() => setConfigAttempt((n) => n + 1), []);

  /* ─── Availability fetch ─────────────────────────────────────── */
  useEffect(() => {
    if (!roomTypeId || !eventTypeId || weekDates.length === 0) return;

    void (async () => {
      const responses = await Promise.all(
        weekDates.map(async (date) => {
          const query = new URLSearchParams({ roomTypeId, eventTypeId, date });
          const res = await fetch(`/api/calendar/availability?${query.toString()}`);
          const data = (await res.json()) as { slots?: Slot[]; message?: string };
          return { date, ok: res.ok, data };
        }),
      );

      const next: Record<string, Slot[]> = {};
      const failed = responses.find((item) => !item.ok);
      for (const response of responses) next[response.date] = response.data.slots ?? [];

      setWeekSlots(next);
      setErrorMessage(failed ? failed.data.message ?? "Failed to load week availability." : "");
    })();
  }, [roomTypeId, eventTypeId, weekDates, availabilityRefreshKey]);

  /* ─── Derived state ──────────────────────────────────────────── */
  const allowedEventTypes = useMemo(
    () =>
      eventTypes.filter(
        (item) =>
          (!item.roomTypeId || item.roomTypeId === roomTypeId) &&
          pricingRules.some((r) => r.roomTypeId === roomTypeId && r.eventTypeId === item.id),
      ),
    [eventTypes, roomTypeId, pricingRules],
  );

  useEffect(() => {
    if (allowedEventTypes.length === 0) {
      setEventTypeId("");
      return;
    }
    if (!allowedEventTypes.some((t) => t.id === eventTypeId)) {
      setEventTypeId(allowedEventTypes[0].id);
    }
  }, [allowedEventTypes, eventTypeId]);

  const eventType = useMemo(
    () => allowedEventTypes.find((item) => item.id === eventTypeId),
    [allowedEventTypes, eventTypeId],
  );

  const availableAcModes = useMemo(() => {
    if (!roomTypeId || !eventTypeId) return [];
    const values = new Set(
      pricingRules
        .filter((r) => r.roomTypeId === roomTypeId && r.eventTypeId === eventTypeId)
        .map((r) => r.acMode),
    );
    return (["without_ac", "with_ac"] as const).filter((mode) => values.has(mode));
  }, [pricingRules, roomTypeId, eventTypeId]);

  useEffect(() => {
    if (availableAcModes.length === 0) return;
    if (!availableAcModes.includes(acMode)) setAcMode(availableAcModes[0]);
  }, [availableAcModes, acMode]);

  const activeRoom = useMemo(() => rooms.find((r) => r.id === roomTypeId), [rooms, roomTypeId]);

  const workingStartHour = activeRoom ? toHour(activeRoom.workingHours.startTime) : 7;
  const workingEndHour = activeRoom ? toHour(activeRoom.workingHours.endTime) : 21;
  const durationHours = eventType?.durationHours ?? 1;
  const firstVisibleHour = Math.max(0, workingStartHour - 2);
  const lastVisibleHour = Math.min(23, workingEndHour + 2);
  const ROW_HEIGHT = 36;
  const visibleHours = lastVisibleHour - firstVisibleHour + 1;

  const slotMap = useMemo(() => {
    const map: Record<string, Record<string, Slot>> = {};
    for (const date of weekDates) {
      map[date] = {};
      for (const slot of weekSlots[date] ?? []) map[date][slot.startTime] = slot;
    }
    return map;
  }, [weekDates, weekSlots]);

  // Group busy slots by bookingId per date to render absolutely-positioned blocks.
  const busyBlocksByDate = useMemo(() => {
    const map: Record<
      string,
      Array<{
        bookingId: string;
        status: Slot["status"];
        startHour: number;
        endHour: number;
        startTime: string;
        endTime: string;
        reason?: string;
      }>
    > = {};
    for (const date of weekDates) {
      const seen = new Set<string>();
      const blocks: Array<{
        bookingId: string;
        status: Slot["status"];
        startHour: number;
        endHour: number;
        startTime: string;
        endTime: string;
        reason?: string;
      }> = [];
      for (const slot of weekSlots[date] ?? []) {
        if (slot.status === "available" || !slot.bookingId) continue;
        const key = `${slot.bookingId}-${slot.bookingStartTime ?? slot.startTime}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const sTime = slot.bookingStartTime ?? slot.startTime;
        const eTime = slot.bookingEndTime ?? slot.endTime;
        blocks.push({
          bookingId: slot.bookingId,
          status: slot.status,
          startHour: toHour(sTime),
          endHour: toHour(eTime),
          startTime: sTime,
          endTime: eTime,
          reason: slot.reason,
        });
      }
      map[date] = blocks;
    }
    return map;
  }, [weekDates, weekSlots]);

  const recurrenceExpandedSlots = useMemo(() => {
    const expanded = expandRecurrencePreview(
      selectedSlots,
      frequency,
      recurrenceEndDate,
      occurrences,
    );
    const selectedKeys = new Set(selectedSlots.map((slot) => slotKey(slot)));
    return expanded.filter((slot) => !selectedKeys.has(slotKey(slot)));
  }, [selectedSlots, frequency, recurrenceEndDate, occurrences]);

  const recurrencePreviewSlots = useMemo(
    () => recurrenceExpandedSlots.filter((slot) => weekDates.includes(slot.date)),
    [recurrenceExpandedSlots, weekDates],
  );

  const allPlannedSlots = useMemo(() => {
    const map = new Map<
      string,
      { date: string; startTime: string; endTime: string; isBase: boolean }
    >();
    for (const slot of selectedSlots) map.set(slotKey(slot), { ...slot, isBase: true });
    for (const slot of recurrenceExpandedSlots) {
      const key = slotKey(slot);
      if (!map.has(key)) map.set(key, { ...slot, isBase: false });
    }
    return [...map.values()].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
    });
  }, [selectedSlots, recurrenceExpandedSlots]);

  const recurrenceConflictSlots = useMemo(() => {
    return recurrencePreviewSlots.filter((slot, index) => {
      const availability = slotMap[slot.date]?.[slot.startTime];
      const conflictsWithBusy = !availability || availability.status !== "available";
      const conflictsWithSelection = selectedSlots.some((selected) => overlapsSlots(selected, slot));
      const conflictsWithRecurrence = recurrencePreviewSlots.some(
        (other, otherIndex) => otherIndex !== index && overlapsSlots(other, slot),
      );
      return conflictsWithBusy || conflictsWithSelection || conflictsWithRecurrence;
    });
  }, [recurrencePreviewSlots, slotMap, selectedSlots]);

  const recurrenceConflictKeys = useMemo(
    () => new Set(recurrenceConflictSlots.map((s) => slotKey(s))),
    [recurrenceConflictSlots],
  );

  const maxDateStr = useMemo(() => {
    const et = eventTypes.find((e) => e.id === eventTypeId);
    if (!et || !et.maxAdvanceBookingDays) return null;
    const d = new Date();
    d.setDate(d.getDate() + et.maxAdvanceBookingDays);
    return formatDate(d);
  }, [eventTypes, eventTypeId]);

  const maxOccurrences = useMemo(() => {
    if (!maxDateStr || frequency === "none" || selectedSlots.length === 0) return 26;
    const baseDates = [...new Set(selectedSlots.map((s) => s.date))].sort();
    const latestBase = baseDates[baseDates.length - 1];
    if (latestBase > maxDateStr) return 1;
    let count = 1;
    for (let step = 1; step <= 25; step++) {
      let furthest: string;
      if (frequency === "daily") furthest = addDaysYmd(latestBase, step);
      else if (frequency === "weekly") furthest = addDaysYmd(latestBase, step * 7);
      else furthest = addMonthsYmd(latestBase, step);
      if (furthest > maxDateStr) break;
      count += 1;
    }
    return count;
  }, [maxDateStr, frequency, selectedSlots]);

  useEffect(() => {
    if (maxDateStr && recurrenceEndDate > maxDateStr) setRecurrenceEndDate(maxDateStr);
  }, [maxDateStr, recurrenceEndDate]);

  useEffect(() => {
    const occ = Number(occurrences);
    if (occurrences !== "" && !isNaN(occ) && occ > maxOccurrences) setOccurrences(String(maxOccurrences));
  }, [maxOccurrences, occurrences]);

  /* ─── Selection ──────────────────────────────────────────────── */
  function toggleSelectionForCell(date: string, hour: number) {
    if (maxDateStr !== null && date > maxDateStr) {
      setErrorMessage("This date is outside the available booking window.");
      return;
    }

    const startTime = `${String(hour).padStart(2, "0")}:00`;
    const slot = slotMap[date]?.[startTime];

    if (!slot) {
      setErrorMessage("This start time is not valid for the selected duration.");
      return;
    }

    if (slot.status !== "available") {
      setErrorMessage(`Cannot select this slot (${STATUS_LABELS[slot.status]}).`);
      return;
    }

    const key = slotKey(slot);
    const exists = selectedSlots.some((item) => slotKey(item) === key);
    if (exists) {
      setSelectedSlots((current) => current.filter((item) => slotKey(item) !== key));
      setErrorMessage("");
      return;
    }

    const cStart = toMinutes(slot.startTime);
    const cEnd = toMinutes(slot.endTime);
    const overlap = selectedSlots.some((item) => {
      if (item.date !== slot.date) return false;
      const eStart = toMinutes(item.startTime);
      const eEnd = toMinutes(item.endTime);
      return cStart < eEnd && eStart < cEnd;
    });
    if (overlap) {
      setErrorMessage("This selection overlaps an already selected slot. Remove the existing one first.");
      return;
    }

    setSelectedSlots((current) => [
      ...current,
      { date: slot.date, startTime: slot.startTime, endTime: slot.endTime },
    ]);
    setErrorMessage("");
  }

  /* ─── Pricing + submission ───────────────────────────────────── */
  const pricingPreview = useMemo(() => {
    return allPlannedSlots.map((slot) => {
      const rule = getPrice(pricingRules, roomTypeId, eventTypeId, acMode, slot.date);
      return { ...slot, amountLkr: rule?.amountLkr ?? 0, missingPrice: !rule };
    });
  }, [allPlannedSlots, pricingRules, roomTypeId, eventTypeId, acMode]);

  const total = pricingPreview.reduce((sum, item) => sum + item.amountLkr, 0);

  function resetForm() {
    setSelectedSlots([]);
    setCustomer({ name: "", email: "", phone: "", purpose: "" });
    setFrequency("none");
    setRecurrenceLimitType("end_date");
    setRecurrenceEndDate("");
    setOccurrences("");
    setErrorMessage("");
    setStatusMessage("");
    setTermsAccepted(false);
    setTurnstileToken(null);
    setTurnstileResetKey((k) => k + 1);
  }

  async function submitBooking() {
    if (!roomTypeId || !eventTypeId || selectedSlots.length === 0) {
      setErrorMessage("Select room, event type, and at least one slot.");
      return;
    }
    if (!customer.name.trim() || !customer.email.trim() || !customer.phone.trim()) {
      setErrorMessage("Name, email, and contact number are required.");
      return;
    }
    if (!termsAccepted) {
      setErrorMessage("Please accept the booking terms before submitting.");
      return;
    }
    if (turnstileRequired && !turnstileToken) {
      setErrorMessage("Please complete the bot verification check before submitting.");
      return;
    }

    if (frequency !== "none") {
      const hasEndDate = recurrenceEndDate.trim().length > 0;
      const hasOccurrences = occurrences.trim().length > 0;
      if (!hasEndDate && !hasOccurrences) {
        setErrorMessage("For recurrence, provide either End Date or Occurrences.");
        return;
      }
      if (hasEndDate && hasOccurrences) {
        setErrorMessage("Provide only one recurrence limit: End Date or Occurrences.");
        return;
      }
      if (recurrenceLimitType === "end_date" && !hasEndDate) {
        setErrorMessage("End Date is required for the selected recurrence limit.");
        return;
      }
      if (recurrenceLimitType === "occurrences" && !hasOccurrences) {
        setErrorMessage("Occurrences is required for the selected recurrence limit.");
        return;
      }
    }

    if (maxDateStr !== null && selectedSlots.some((slot) => slot.date > maxDateStr)) {
      setErrorMessage("One or more selected slots are outside the available booking window for this event type.");
      return;
    }
    if (frequency !== "none" && recurrenceConflictSlots.length > 0) {
      setErrorMessage(
        `Recurrence has ${recurrenceConflictSlots.length} conflicting slot(s) with existing classes/bookings. Resolve conflicts before submitting.`,
      );
      return;
    }
    if (pricingPreview.some((item) => item.missingPrice)) {
      setErrorMessage("Cannot submit booking while pricing rules are missing for one or more slots.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setStatusMessage("");

    const recurrence =
      frequency === "none"
        ? { frequency: "none" as const }
        : {
            frequency,
            endDate: recurrenceLimitType === "end_date" ? recurrenceEndDate || undefined : undefined,
            occurrences:
              recurrenceLimitType === "occurrences" && occurrences ? Number(occurrences) : undefined,
          };

    const res = await fetch("/api/calendar/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomTypeId,
        eventTypeId,
        acMode,
        selectedSlots,
        recurrence,
        customer,
        turnstileToken,
      }),
    });

    let data: {
      message?: string;
      conflicts?: Array<{ slot: { date: string; startTime: string; endTime: string }; reason: string }>;
      overriddenBookingIds?: string[];
    } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      setErrorMessage("Booking request failed with an invalid server response.");
      setIsSubmitting(false);
      return;
    }

    if (!res.ok) {
      if (data.conflicts?.length) {
        setErrorMessage(
          `${data.message ?? "Conflicts found."} ${data.conflicts
            .slice(0, 5)
            .map((c) => `${c.slot.date} ${c.slot.startTime}-${c.slot.endTime}`)
            .join(", ")}`,
        );
      } else {
        setErrorMessage(data.message ?? "Failed to submit booking.");
      }
      setTurnstileToken(null);
      setTurnstileResetKey((k) => k + 1);
      setIsSubmitting(false);
      return;
    }

    const overrideNote =
      data.overriddenBookingIds && data.overriddenBookingIds.length > 0
        ? ` Lower-priority overlaps cancelled: ${data.overriddenBookingIds.length}.`
        : "";

    setStatusMessage(`${data.message ?? "Booking submitted."}${overrideNote}`);
    resetForm();
    setIsSubmitting(false);
    setAvailabilityRefreshKey((k) => k + 1);
  }

  function jumpToMonthYear(month: number, year: number) {
    setWeekStartDate(startOfWeek(new Date(year, month, 1)));
  }

  /* ─── Computed labels ────────────────────────────────────────── */
  const week = isoWeek(weekStartDate);
  const fixtureId = `FIXTURE #${week.year}-W${String(week.week).padStart(2, "0")}`;
  const monthYearLabel = `${MONTH_NAMES[visibleMonth].toUpperCase()} ${visibleYear}`;
  const heroEyebrowTxt = `// BOOKINGS · ${activeRoom?.name?.toUpperCase() ?? "ROOM"} · ${monthYearLabel}`;
  const todayYmd = formatDate(new Date());
  const isNextDisabled =
    maxDateStr !== null && formatDate(addDays(weekStartDate, 7)) > maxDateStr;

  if (isConfigLoading) {
    return (
      <section className="ac-bookings-loading">
        <div className="ac-bookings-loading-inner">
          <Breadcrumbs current="Bookings" />
          <p className="ac-bookings-loading-eyebrow">{"// WARMING UP THE COURTS"}</p>
          <div className="ac-page-hero-title">
            <span className="ac-display">
              LOADING<span className="punct">.</span>
            </span>
          </div>
          <p className="ac-page-hero-lede">Your booking calendar is on its way.</p>
        </div>
      </section>
    );
  }

  if (configError) {
    return (
      <section className="ac-bookings-loading">
        <div className="ac-bookings-loading-inner">
          <Breadcrumbs current="Bookings" />
          <p className="ac-bookings-loading-eyebrow ac-bookings-loading-eyebrow-danger">
            {"// CALENDAR UNAVAILABLE"}
          </p>
          <div className="ac-page-hero-title">
            <span className="ac-display">
              OFFLINE<span className="punct">.</span>
            </span>
          </div>
          <p className="ac-page-hero-lede">
            {configError === "timeout"
              ? "The calendar is taking a slow lap today. Give it another go?"
              : "We couldn’t reach the calendar this time. Mind having another try?"}
          </p>
          <button className="ac-btn-primary" onClick={retryConfig} type="button">
            Try again <span aria-hidden="true">↗</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section className="ac-page-hero is-gradient ac-bookings-hero" aria-label="Bookings hero">
        <div className="ac-page-hero-inner">
          <Breadcrumbs current="Bookings" />
          <div className="ac-bookings-hero-stamp">{fixtureId}</div>
          <div className="ac-bookings-hero-grid">
            <div>
              <span className="ac-page-hero-eyebrow">{heroEyebrowTxt}</span>
              <div className="ac-page-hero-title">
                <span className="ac-display">
                  BOOK<span className="punct">.</span>
                </span>
              </div>
              <div className="ac-page-hero-italic">
                <span className="ac-italic">the floor.</span>
              </div>
              <p className="ac-page-hero-lede">
                Reserve the Main Arena or Studio Room. Sport, ceremony, assembly — any use, any
                week. Requests are reviewed by the bookings desk within 24 hours.
              </p>
            </div>
            <aside className="ac-aside ac-bookings-hero-aside">
              <span className="ac-aside-eyebrow">FOR ASSISTANCE</span>
              <p className="ac-aside-quote ac-aside-quote-sm">
                The desk takes calls between 08:00–18:00 daily.
              </p>
              <p className="ac-aside-phone">+94&nbsp;&nbsp;70&nbsp;&nbsp;442&nbsp;&nbsp;1590</p>
              <a className="ac-aside-link" href="mailto:info@royalmasarena.lk">
                Or write to the bookings office →
              </a>
            </aside>
          </div>
        </div>
      </section>

      {/* ─── 01 / THE ROOM. ───────────────────────────────────── */}
      <section className="ac-bookings-room-section" aria-label="Choose room and event type">
        <div className="ac-section-heading">
          <span className="title">
            <span className="num">01 /</span> THE ROOM.
          </span>
          <span className="meta">SELECT VENUE TO REVEAL CALENDAR</span>
        </div>

        <div className="ac-bookings-room-grid">
          {rooms.map((room, idx) => {
            const selected = room.id === roomTypeId;
            const hourly = getRoomHourlyRate(pricingRules, eventTypes, room.id);
            const dayRate = getRoomDayRate(pricingRules, eventTypes, room.id);
            return (
              <button
                aria-pressed={selected}
                className={`ac-bookings-room-card${selected ? " is-selected" : ""}`}
                key={room.id}
                onClick={() => setRoomTypeId(room.id)}
                type="button"
              >
                {selected ? <div className="ac-bookings-room-badge">● SELECTED</div> : null}
                <span className="ac-bookings-room-tag">
                  {venueTagPrefix(idx)} / {room.name.toUpperCase()}
                </span>
                <div className="ac-bookings-room-headline">
                  <div className="ac-bookings-room-name">
                    {room.name.split(" ").map((word) => (
                      <span className="ac-display" key={word}>
                        {word.toUpperCase()}
                      </span>
                    ))}
                  </div>
                  {room.description ? (
                    <p className="ac-bookings-room-desc">{room.description}</p>
                  ) : null}
                </div>
                <div className="ac-bookings-room-stats">
                  <div className="ac-bookings-room-stat">
                    <span className="label">CAPACITY</span>
                    <span className="value">{formatCapacity(room.capacity)}</span>
                  </div>
                  <div className="ac-bookings-room-stat">
                    <span className="label">HOURLY</span>
                    <span className="value">{formatLkrK(hourly)}</span>
                  </div>
                  <div className="ac-bookings-room-stat">
                    <span className="label">DAY RATE</span>
                    <span className="value">{formatLkrK(dayRate)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="ac-bookings-config-row">
          <div>
            <span className="ac-bookings-config-eyebrow">
              USE CASE — DURATION &amp; RATE ARE SET PER EVENT TYPE
            </span>
            <div className="ac-bookings-event-pills" role="radiogroup" aria-label="Event type">
              {allowedEventTypes.map((type) => {
                const active = type.id === eventTypeId;
                return (
                  <button
                    aria-checked={active}
                    className={`ac-bookings-event-pill${active ? " is-active" : ""}`}
                    key={type.id}
                    onClick={() => setEventTypeId(type.id)}
                    role="radio"
                    type="button"
                  >
                    {type.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="ac-bookings-config-eyebrow">AIR CONDITIONING</span>
            <div className="ac-bookings-ac-toggle" role="radiogroup" aria-label="Air conditioning">
              {(["without_ac", "with_ac"] as const).map((mode) => {
                const active = acMode === mode;
                const disabled = !availableAcModes.includes(mode);
                const premium =
                  mode === "with_ac"
                    ? getAcPremiumFullDay(pricingRules, eventTypes, roomTypeId)
                    : null;
                const withAcSub =
                  premium !== null
                    ? `climate · +LKR ${currency(premium)} / day`
                    : "climate · premium";
                return (
                  <button
                    aria-checked={active}
                    className={`ac-bookings-ac-btn${active ? " is-active" : ""}`}
                    disabled={disabled}
                    key={mode}
                    onClick={() => setAcMode(mode)}
                    role="radio"
                    type="button"
                  >
                    <span className="ac-bookings-ac-label">
                      {mode === "without_ac" ? "Without A/C" : "With A/C"}
                    </span>
                    <span className="ac-bookings-ac-sub">
                      {mode === "without_ac" ? "open vents · included" : withAcSub}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ─── 02 / THE WEEK. ───────────────────────────────────── */}
      <section className="ac-bookings-week-section" aria-label="Weekly calendar">
        <div className="ac-section-heading">
          <span className="title">
            <span className="num">02 /</span> THE WEEK.
          </span>
          <span className="meta">
            {ymdToDate(weekDates[0]).toLocaleDateString("en-US", { day: "numeric", month: "short" })}{" "}
            →{" "}
            {ymdToDate(weekDates[6]).toLocaleDateString("en-US", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>

        <div className="ac-bookings-week-nav">
          <button
            className="ac-bookings-week-btn"
            onClick={() => setWeekStartDate(addDays(weekStartDate, -7))}
            type="button"
          >
            ◂ WEEK {isoWeek(addDays(weekStartDate, -7)).week}
          </button>
          <button
            className="ac-bookings-week-btn is-current"
            onClick={() => setWeekStartDate(startOfWeek(new Date()))}
            type="button"
          >
            WEEK {week.week} · {weekDates.includes(todayYmd) ? "NOW" : "GO TO TODAY"}
          </button>
          <button
            className="ac-bookings-week-btn"
            disabled={isNextDisabled}
            onClick={() => setWeekStartDate(addDays(weekStartDate, 7))}
            type="button"
          >
            WEEK {isoWeek(addDays(weekStartDate, 7)).week} ▸
          </button>
          <button
            className="ac-bookings-week-btn ac-bookings-jump-toggle"
            onClick={() => setShowJump((v) => !v)}
            type="button"
          >
            Jump to ▾
          </button>
        </div>

        {showJump ? (
          <div className="ac-bookings-jump-row">
            <label>
              <span className="ac-bookings-config-eyebrow">MONTH</span>
              <select
                aria-label="Jump to month"
                onChange={(e) => jumpToMonthYear(Number(e.target.value), visibleYear)}
                value={visibleMonth}
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="ac-bookings-config-eyebrow">YEAR</span>
              <select
                aria-label="Jump to year"
                onChange={(e) => jumpToMonthYear(visibleMonth, Number(e.target.value))}
                value={visibleYear}
              >
                {visibleYearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {/* Legend */}
        <div className="ac-bookings-legend">
          <span className="ac-bookings-legend-eyebrow">STATUS</span>
          <span className="ac-bookings-legend-item is-pending">
            <span className="dot" /> PENDING
          </span>
          <span className="ac-bookings-legend-item is-confirmed">
            <span className="dot" /> CONFIRMED
          </span>
          <span className="ac-bookings-legend-item is-tentative">
            <span className="dot" /> HELD
          </span>
          <span className="ac-bookings-legend-item is-blocked">
            <span className="dot" /> BLOCKED
          </span>
          <span className="ac-bookings-legend-item is-cleanup">
            <span className="dot" /> PREP
          </span>
          <span className="ac-bookings-legend-item is-yours">
            <span className="dot" /> ★ YOURS
          </span>
          <span className="ac-bookings-legend-item is-recurrence">
            <span className="dot" /> ↻ RECURRENCE
          </span>
          <span className="ac-bookings-legend-suffix">
            SLOT · {durationHours} HR{durationHours > 1 ? "S" : ""} · COLOMBO TIME
          </span>
        </div>

        {frequency !== "none" && recurrenceConflictSlots.length > 0 ? (
          <p className="form-message error ac-bookings-recurrence-warning" role="alert">
            Recurrence warning: {recurrenceConflictSlots.length} slot(s) conflict with existing
            classes/bookings in this view.
          </p>
        ) : null}

        {/* Grid */}
        <div className="ac-bookings-grid-wrap">
          <div className="ac-bookings-grid" style={{ "--row-h": `${ROW_HEIGHT}px` } as React.CSSProperties}>
            {/* Header row */}
            <div className="ac-bookings-grid-head">
              <div className="ac-bookings-grid-time-head">
                <span>HR</span>
              </div>
              {weekDates.map((date) => {
                const d = ymdToDate(date);
                const isToday = date === todayYmd;
                const isPastLimit = maxDateStr !== null && date > maxDateStr;
                return (
                  <div
                    className={`ac-bookings-grid-day-head${isToday ? " is-today" : ""}${
                      isPastLimit ? " is-past-limit" : ""
                    }`}
                    key={`head-${date}`}
                  >
                    <span className="dow">
                      {d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}
                    </span>
                    <span className="dom">{d.getDate()}</span>
                    <span className="note">{isToday ? "· TODAY ·" : ""}</span>
                  </div>
                );
              })}
            </div>

            {/* Body rows with hour labels and click cells */}
            <div className="ac-bookings-grid-body" style={{ height: `${visibleHours * ROW_HEIGHT}px` }}>
              {Array.from({ length: visibleHours }, (_, i) => {
                const hour = firstVisibleHour + i;
                return (
                  <div className="ac-bookings-grid-row" key={`row-${hour}`}>
                    <div className="ac-bookings-grid-time-cell">{toHourLabel(hour)}</div>
                    {weekDates.map((date) => {
                      const isPastLimit = maxDateStr !== null && date > maxDateStr;
                      const inWorkingHours =
                        hour >= workingStartHour && hour + durationHours <= workingEndHour;
                      const clickable =
                        inWorkingHours &&
                        !isPastLimit &&
                        Boolean(slotMap[date]?.[`${String(hour).padStart(2, "0")}:00`]);
                      const isToday = date === todayYmd;
                      return (
                        <button
                          aria-label={`${date} ${toHourLabel(hour)}`}
                          className={`ac-bookings-grid-cell${clickable ? "" : " is-off"}${
                            isPastLimit ? " is-past-limit" : ""
                          }${isToday ? " is-today" : ""}`}
                          disabled={!clickable}
                          key={`${date}-${hour}`}
                          onClick={() => toggleSelectionForCell(date, hour)}
                          type="button"
                        />
                      );
                    })}
                  </div>
                );
              })}

              {/* Slot blocks layer (absolutely positioned) */}
              <div className="ac-bookings-grid-blocks" aria-hidden="true">
                {weekDates.map((date, dayIndex) => {
                  const blocks = busyBlocksByDate[date] ?? [];
                  const selected = selectedSlots.filter((s) => s.date === date);
                  const recurrence = recurrencePreviewSlots.filter((s) => s.date === date);
                  return (
                    <div className="ac-bookings-day-blocks" data-day={dayIndex} key={`blocks-${date}`}>
                      {blocks.map((block) => {
                        const top = (block.startHour - firstVisibleHour) * ROW_HEIGHT;
                        const height = (block.endHour - block.startHour) * ROW_HEIGHT - 3;
                        if (top < 0 || height <= 0) return null;
                        return (
                          <div
                            className={`ac-bookings-block is-${block.status}`}
                            key={`b-${block.bookingId}-${block.startTime}`}
                            style={{ top, height }}
                          >
                            <div className="ac-bookings-block-head">
                              <span className="chip">{STATUS_LABELS[block.status]}</span>
                              <span className="time">
                                {block.startTime}–{block.endTime}
                              </span>
                            </div>
                            <div className="ac-bookings-block-title">
                              {block.status === "blocked"
                                ? block.reason ?? "BLOCKED"
                                : block.status === "cleanup"
                                  ? "Site preparation"
                                  : block.status === "pending"
                                    ? "Pending request"
                                    : block.status === "tentative"
                                      ? "Held"
                                      : "Confirmed booking"}
                            </div>
                          </div>
                        );
                      })}

                      {selected.map((s) => {
                        const startHour = toHour(s.startTime);
                        const endHour = toHour(s.endTime);
                        const top = (startHour - firstVisibleHour) * ROW_HEIGHT;
                        const height = (endHour - startHour) * ROW_HEIGHT - 3;
                        if (top < 0 || height <= 0) return null;
                        return (
                          <div
                            className="ac-bookings-block is-selection"
                            key={`s-${s.date}-${s.startTime}`}
                            style={{ top, height }}
                          >
                            <div className="ac-bookings-block-head">
                              <span className="chip">★ YOURS</span>
                              <span className="time">
                                {s.startTime}–{s.endTime}
                              </span>
                            </div>
                            <div className="ac-bookings-block-title">Your booking</div>
                            <div className="ac-bookings-block-meta">unsaved · pending submit</div>
                          </div>
                        );
                      })}

                      {recurrence.map((s) => {
                        const startHour = toHour(s.startTime);
                        const endHour = toHour(s.endTime);
                        const top = (startHour - firstVisibleHour) * ROW_HEIGHT;
                        const height = (endHour - startHour) * ROW_HEIGHT - 3;
                        if (top < 0 || height <= 0) return null;
                        const conflict = recurrenceConflictKeys.has(slotKey(s));
                        return (
                          <div
                            className={`ac-bookings-block ${
                              conflict ? "is-recurrence-conflict" : "is-recurrence"
                            }`}
                            key={`r-${s.date}-${s.startTime}`}
                            style={{ top, height }}
                          >
                            <div className="ac-bookings-block-head">
                              <span className="chip">
                                {conflict ? "↻ CONFLICT" : "↻ RECURRENCE"}
                              </span>
                              <span className="time">
                                {s.startTime}–{s.endTime}
                              </span>
                            </div>
                            <div className="ac-bookings-block-title">
                              {conflict ? "Resolve before submit" : "Recurrence preview"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Mobile day-picker view (CSS shows it below 700px) */}
        <div className="ac-bookings-day-view" aria-label="Day view">
          <div className="ac-bookings-day-pills" role="tablist" aria-label="Choose day">
            {weekDates.map((date) => {
              const d = ymdToDate(date);
              const isActive = date === selectedDayDate;
              const isToday = date === todayYmd;
              const isPastLimit = maxDateStr !== null && date > maxDateStr;
              return (
                <button
                  aria-selected={isActive}
                  className={`ac-bookings-day-pill${isActive ? " is-active" : ""}${isPastLimit ? " is-past-limit" : ""}`}
                  disabled={isPastLimit}
                  key={`pill-${date}`}
                  onClick={() => setSelectedDayDate(date)}
                  role="tab"
                  type="button"
                >
                  <span className="dow">
                    {d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}
                  </span>
                  <span className="dom">{d.getDate()}</span>
                  {isToday ? <span className="today">TODAY</span> : null}
                </button>
              );
            })}
          </div>

          {selectedDayDate ? (
            <>
              <div className="ac-bookings-day-header">
                {ymdToDate(selectedDayDate).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </div>
              <div className="ac-bookings-day-rows">
                {Array.from({ length: visibleHours }, (_, i) => {
                  const hour = firstVisibleHour + i;
                  const startTime = `${String(hour).padStart(2, "0")}:00`;
                  const slot = slotMap[selectedDayDate]?.[startTime];
                  const inWorkingHours =
                    hour >= workingStartHour && hour + durationHours <= workingEndHour;
                  const isPastLimit = maxDateStr !== null && selectedDayDate > maxDateStr;
                  const endTime = slot?.endTime ?? `${String(hour + durationHours).padStart(2, "0")}:00`;

                  const isSelected = selectedSlots.some(
                    (s) => s.date === selectedDayDate && s.startTime === startTime,
                  );
                  const recurrenceSlot = recurrencePreviewSlots.find(
                    (s) => s.date === selectedDayDate && s.startTime === startTime,
                  );
                  const isRecurrenceConflict =
                    recurrenceSlot !== undefined &&
                    recurrenceConflictKeys.has(slotKey(recurrenceSlot));

                  let rowClass = "ac-bookings-day-row";
                  let labelText = "AVAILABLE";
                  let metaText = "";
                  let actionText = "PICK";
                  let actionDisabled = false;
                  let actionIsRemove = false;

                  if (!inWorkingHours) {
                    rowClass += " is-off";
                    labelText = "—";
                    actionDisabled = true;
                  } else if (isPastLimit) {
                    rowClass += " is-past-limit";
                    labelText = "Outside booking window";
                    actionDisabled = true;
                  } else if (isSelected) {
                    rowClass += " is-selection";
                    labelText = "★ YOURS";
                    actionText = "REMOVE";
                    actionIsRemove = true;
                  } else if (recurrenceSlot && isRecurrenceConflict) {
                    rowClass += " is-recurrence-conflict";
                    labelText = "↻ CONFLICT";
                    metaText = "Resolve before submit";
                    actionDisabled = true;
                  } else if (recurrenceSlot) {
                    rowClass += " is-recurrence";
                    labelText = "↻ RECURRENCE";
                    metaText = "Recurrence preview";
                    actionDisabled = true;
                  } else if (slot) {
                    if (slot.status === "available") {
                      rowClass += " is-available";
                    } else {
                      rowClass += ` is-${slot.status}`;
                      labelText = STATUS_LABELS[slot.status];
                      if (slot.status === "blocked") metaText = slot.reason ?? "Blocked";
                      else if (slot.status === "cleanup") metaText = "Site preparation";
                      else if (slot.status === "pending") metaText = "Pending request";
                      else if (slot.status === "tentative") metaText = "Held";
                      else if (slot.status === "confirmed") metaText = "Confirmed booking";
                      actionDisabled = true;
                    }
                  } else {
                    rowClass += " is-off";
                    labelText = "—";
                    actionDisabled = true;
                  }

                  return (
                    <div className={rowClass} key={`day-row-${hour}`}>
                      <span className="time">
                        {startTime} – {endTime}
                      </span>
                      <div>
                        <span className="label">{labelText}</span>
                        {metaText ? <div className="meta">{metaText}</div> : null}
                      </div>
                      <button
                        aria-label={`${actionText} ${startTime}`}
                        className={`action${actionIsRemove ? " is-remove" : ""}`}
                        disabled={actionDisabled}
                        onClick={() => toggleSelectionForCell(selectedDayDate, hour)}
                        type="button"
                      >
                        {actionText}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      </section>

      {/* ─── 03 / THE DETAILS. ────────────────────────────────── */}
      <section className="ac-bookings-details-section" aria-label="Your details and booking fee">
        <div className="ac-section-heading">
          <span className="title">
            <span className="num">03 /</span> THE DETAILS.
          </span>
          <span className="meta">{selectedSlots.length === 0 ? "PICK A SLOT TO BEGIN" : "FORM AUTO-SAVES"}</span>
        </div>

        <div className="ac-bookings-details-grid">
          <div className="ac-bookings-details-form">
            {/* Recurrence */}
            <span className="ac-bookings-config-eyebrow">RECURRENCE</span>
            <div className="ac-bookings-recurrence-row" role="radiogroup" aria-label="Recurrence">
              {(
                [
                  { v: "none", l: "One-off", sub: "single date" },
                  { v: "daily", l: "Daily", sub: "every day" },
                  { v: "weekly", l: "Weekly", sub: "same day each week" },
                  { v: "monthly", l: "Monthly", sub: "same date each month" },
                ] as { v: RecurrenceFrequency; l: string; sub: string }[]
              ).map((opt) => {
                const active = frequency === opt.v;
                return (
                  <button
                    aria-checked={active}
                    className={`ac-bookings-ac-btn${active ? " is-active" : ""}`}
                    key={opt.v}
                    onClick={() => setFrequency(opt.v)}
                    role="radio"
                    type="button"
                  >
                    <span className="ac-bookings-ac-label">{opt.l}</span>
                    <span className="ac-bookings-ac-sub">{opt.sub}</span>
                  </button>
                );
              })}
            </div>

            {frequency !== "none" ? (
              <div className="ac-bookings-recurrence-detail">
                <span className="ac-bookings-config-eyebrow">RECURRENCE LIMIT</span>
                <div className="ac-bookings-recurrence-row">
                  {(["end_date", "occurrences"] as RecurrenceLimitType[]).map((opt) => {
                    const active = recurrenceLimitType === opt;
                    return (
                      <button
                        aria-checked={active}
                        className={`ac-bookings-ac-btn${active ? " is-active" : ""}`}
                        key={opt}
                        onClick={() => {
                          setRecurrenceLimitType(opt);
                          if (opt === "end_date") setOccurrences("");
                          if (opt === "occurrences") setRecurrenceEndDate("");
                        }}
                        role="radio"
                        type="button"
                      >
                        <span className="ac-bookings-ac-label">
                          {opt === "end_date" ? "End Date" : "Number of Recurrences"}
                        </span>
                        <span className="ac-bookings-ac-sub">
                          {opt === "end_date" ? "until a specific date" : `up to ${maxOccurrences}`}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="ac-bookings-recurrence-input">
                  {recurrenceLimitType === "end_date" ? (
                    <label>
                      <span className="ac-bookings-config-eyebrow">END DATE</span>
                      <input
                        max={maxDateStr ?? undefined}
                        onChange={(e) => setRecurrenceEndDate(e.target.value)}
                        type="date"
                        value={recurrenceEndDate}
                      />
                    </label>
                  ) : (
                    <label>
                      <span className="ac-bookings-config-eyebrow">OCCURRENCES</span>
                      <input
                        max={Math.min(26, maxOccurrences)}
                        min={1}
                        onChange={(e) => setOccurrences(e.target.value)}
                        type="number"
                        value={occurrences}
                      />
                    </label>
                  )}
                </div>

                {maxDateStr !== null ? (
                  <p className="ac-bookings-limit-note">
                    Bookings for this event type are limited to{" "}
                    {eventTypes.find((e) => e.id === eventTypeId)?.maxAdvanceBookingDays} days in
                    advance (until {maxDateStr}).
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Particulars */}
            <div className="ac-bookings-particulars">
              <span className="ac-bookings-config-eyebrow">YOUR PARTICULARS</span>
              <div className="ac-bookings-field-grid">
                <label>
                  <span className="ac-bookings-field-label">FULL NAME</span>
                  <input
                    onChange={(e) => setCustomer((p) => ({ ...p, name: e.target.value }))}
                    type="text"
                    value={customer.name}
                  />
                </label>
                <label>
                  <span className="ac-bookings-field-label">CONTACT NUMBER</span>
                  <input
                    onChange={(e) => setCustomer((p) => ({ ...p, phone: e.target.value }))}
                    type="tel"
                    value={customer.phone}
                  />
                </label>
              </div>
              <label>
                <span className="ac-bookings-field-label">EMAIL</span>
                <input
                  onChange={(e) => setCustomer((p) => ({ ...p, email: e.target.value }))}
                  type="email"
                  value={customer.email}
                />
              </label>
              <label>
                <span className="ac-bookings-field-label">PURPOSE OF BOOKING</span>
                <textarea
                  onChange={(e) => setCustomer((p) => ({ ...p, purpose: e.target.value }))}
                  rows={4}
                  value={customer.purpose}
                />
              </label>
            </div>

            {/* Terms */}
            <div className="ac-bookings-terms">
              <label className="ac-bookings-terms-label">
                <input
                  checked={termsAccepted}
                  className="ac-bookings-terms-checkbox"
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  type="checkbox"
                />
                <span className="ac-bookings-terms-text">
                  I have read and accept the booking terms below, and confirm that the venue will
                  not be used for commercial purposes without prior approval.
                </span>
              </label>
              <details className="ac-bookings-terms-details">
                <summary>Read booking terms</summary>
                <div className="ac-bookings-terms-body">
                  <h4>General Guidelines</h4>
                  <ul>
                    <li>
                      All reservations must be done through the website. Verbal confirmations to
                      RMASA Manager are not valid.
                    </li>
                    <li>
                      Any reservation done via the website will be considered TENTATIVE until the
                      relevant advance payment is completed within 1 working day.
                    </li>
                    <li>
                      The reservation will be considered CONFIRMED only if valid payment details
                      with relevant transaction reference nos. are conveyed to RMASA Manager or the
                      payment is directly paid via Credit Card at RMASA premises.
                    </li>
                    <li>
                      If no payment details are conveyed to RMASA Manager, the TENTATIVE
                      reservation will be considered as CANCELLED.
                    </li>
                    <li>
                      Instructors / users who wish to reserve the Studio Room on a regular basis
                      shall enter into a legal agreement with BoMRMASA.
                    </li>
                    <li>
                      Verbal confirmations to RMASA Manager will not be considered as a
                      CONFIRMATION, especially where another instructor / user CONFIRMS the said
                      time slot with requisite payment.
                    </li>
                    <li>
                      Rescheduling of CONFIRMED reservations will not be possible if it is within
                      3 weeks of the confirmed date.
                    </li>
                  </ul>
                </div>
              </details>
            </div>
          </div>

          {/* Receipt */}
          <aside className="ac-bookings-receipt">
            <div className="ac-bookings-receipt-tag">● BOOKING FEE</div>

            <div className="ac-bookings-receipt-head">
              <span className="ac-page-hero-eyebrow">{"// YOUR BOOKINGS"}</span>
              <div className="ac-bookings-receipt-room">
                {activeRoom
                  ? activeRoom.name.split(" ").map((w) => (
                      <span className="ac-display" key={w}>
                        {w.toUpperCase()}
                      </span>
                    ))
                  : (
                      <span className="ac-display">—</span>
                    )}
              </div>
              <span className="ac-bookings-receipt-chip">
                {eventType?.name?.toUpperCase() ?? "—"} ·{" "}
                {acMode === "without_ac" ? "WITHOUT A/C" : "WITH A/C"}
              </span>
            </div>

            <div className="ac-bookings-receipt-entries">
              <div className="ac-bookings-receipt-entries-head">
                <span>
                  {pricingPreview.length} {pricingPreview.length === 1 ? "ENTRY" : "ENTRIES"}
                  {frequency !== "none" ? ` · ${frequency.toUpperCase()}` : ""}
                </span>
              </div>
              {pricingPreview.length === 0 ? (
                <p className="ac-bookings-receipt-empty">
                  Pick at least one slot on the calendar to start.
                </p>
              ) : (
                pricingPreview.map((entry, i) => (
                  <div className="ac-bookings-receipt-row" key={`${entry.date}-${entry.startTime}`}>
                    <div className="ac-bookings-receipt-row-left">
                      <span className="num">
                        <span className="num-badge">{i + 1}</span> BOOKING {i + 1}
                      </span>
                      <div className="when">
                        {ymdToDate(entry.date).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                      <div className="time">
                        {entry.startTime} — {entry.endTime}{" "}
                        {entry.isBase ? null : <span className="auto">AUTO</span>}
                      </div>
                    </div>
                    <div className="ac-bookings-receipt-row-right">
                      <span className="price">
                        {entry.missingPrice ? "—" : `LKR ${currency(entry.amountLkr)}`}
                      </span>
                      {entry.isBase ? (
                        <button
                          className="remove"
                          onClick={() => toggleSelectionForCell(entry.date, toHour(entry.startTime))}
                          type="button"
                        >
                          REMOVE
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="ac-bookings-receipt-total">
              <div>
                <span className="ac-page-hero-eyebrow">BOOKING FEE · LKR</span>
                <span className="sub">
                  {pricingPreview.length === 0
                    ? "—"
                    : `${pricingPreview.length} entr${pricingPreview.length === 1 ? "y" : "ies"} · on confirmation`}
                </span>
              </div>
              <span className="ac-display ac-bookings-receipt-amount">{currency(total)}</span>
            </div>

            {turnstileRequired ? (
              <div className="ac-bookings-receipt-turnstile">
                <TurnstileWidget
                  siteKey={TURNSTILE_SITE_KEY}
                  onToken={setTurnstileToken}
                  resetKey={turnstileResetKey}
                  theme="dark"
                />
              </div>
            ) : null}

            <div className="ac-bookings-receipt-actions">
              <button
                className="ac-btn-primary"
                disabled={
                  isSubmitting ||
                  selectedSlots.length === 0 ||
                  !termsAccepted ||
                  (turnstileRequired && !turnstileToken)
                }
                onClick={submitBooking}
                type="button"
              >
                {isSubmitting ? "Submitting…" : "Submit Booking"}{" "}
                <span aria-hidden="true">↗</span>
              </button>
              <button className="ac-btn-ghost" onClick={resetForm} type="button">
                Reset Form
              </button>
            </div>

            {statusMessage ? (
              <p className="ac-bookings-receipt-message ac-bookings-receipt-message-success" role="status">
                {statusMessage}
              </p>
            ) : null}
            {errorMessage ? (
              <p className="ac-bookings-receipt-message ac-bookings-receipt-message-error" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </aside>
        </div>
      </section>
    </>
  );
}
