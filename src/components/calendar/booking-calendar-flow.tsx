"use client";

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

type Slot = {
  date: string;
  startTime: string;
  endTime: string;
  status: "available" | "pending" | "confirmed" | "tentative" | "blocked";
  reason?: string;
};

type RecurrenceFrequency = "none" | "daily" | "weekly" | "monthly";
type RecurrenceLimitType = "end_date" | "occurrences";

const statusLabels: Record<Slot["status"], string> = {
  available: "Available",
  pending: "Pending",
  confirmed: "Confirmed",
  tentative: "Tentative",
  blocked: "Blocked",
};

const acModeLabels: Record<"with_ac" | "without_ac", string> = {
  with_ac: "With AC",
  without_ac: "Without AC",
};

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

function currency(value: number) {
  return new Intl.NumberFormat("en-LK").format(value);
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
  return `${norm}${suffix}`;
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

function slotPartForHour(slot: { startTime: string; endTime: string }, hour: number): "start" | "middle" | "end" {
  const startHour = toHour(slot.startTime);
  const endHour = toHour(slot.endTime);
  if (hour === startHour) return "start";
  if (hour === endHour - 1) return "end";
  return "middle";
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
      (rule) =>
        rule.roomTypeId === roomTypeId &&
        rule.eventTypeId === eventTypeId &&
        rule.acMode === acMode &&
        rule.dayType === type,
    ) ??
    pricingRules.find(
      (rule) =>
        rule.roomTypeId === roomTypeId &&
        rule.eventTypeId === eventTypeId &&
        rule.acMode === acMode &&
        rule.dayType === "any",
    )
  );
}

function expandRecurrencePreview(
  selectedSlots: Array<{ date: string; startTime: string; endTime: string }>,
  frequency: RecurrenceFrequency,
  endDate: string,
  occurrences: string,
  previewUntilDate?: string,
) {
  if (frequency === "none" || selectedSlots.length === 0) return [];

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
    if (!endDate && !occurrences && previewUntilDate && furthest > previewUntilDate) break;

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

export function BookingCalendarFlow() {
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [roomTypeId, setRoomTypeId] = useState("");
  const [eventTypeId, setEventTypeId] = useState("");
  const [acMode, setAcMode] = useState<"with_ac" | "without_ac">("without_ac");
  const [weekStartDate, setWeekStartDate] = useState(startOfWeek(new Date()));
  const [weekSlots, setWeekSlots] = useState<Record<string, Slot[]>>({});
  const [selectedSlots, setSelectedSlots] = useState<Array<{ date: string; startTime: string; endTime: string }>>([]);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("none");
  const [recurrenceLimitType, setRecurrenceLimitType] = useState<RecurrenceLimitType>("end_date");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [occurrences, setOccurrences] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "", purpose: "" });

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => formatDate(addDays(weekStartDate, i))),
    [weekStartDate],
  );

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/calendar/config", { cache: "no-store" });
      const data = (await res.json()) as {
        rooms: RoomType[];
        eventTypes: EventType[];
        pricingRules: PricingRule[];
      };
      setRooms(data.rooms);
      setEventTypes(data.eventTypes);
      setPricingRules(data.pricingRules);
      const firstRoomId = data.rooms[0]?.id ?? "";
      setRoomTypeId(firstRoomId);
      const firstRoomEventType = data.eventTypes.find(
        (type) =>
          (!type.roomTypeId || type.roomTypeId === firstRoomId) &&
          data.pricingRules.some((rule) => rule.roomTypeId === firstRoomId && rule.eventTypeId === type.id),
      );
      setEventTypeId(firstRoomEventType?.id ?? "");
    })();
  }, []);

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
      for (const response of responses) {
        next[response.date] = response.data.slots ?? [];
      }

      setWeekSlots(next);
      setErrorMessage(failed ? failed.data.message ?? "Failed to load week availability." : "");
    })();
  }, [roomTypeId, eventTypeId, weekDates]);

  const allowedEventTypes = useMemo(
    () =>
      eventTypes.filter(
        (item) =>
          (!item.roomTypeId || item.roomTypeId === roomTypeId) &&
          pricingRules.some((rule) => rule.roomTypeId === roomTypeId && rule.eventTypeId === item.id),
      ),
    [eventTypes, roomTypeId, pricingRules],
  );

  useEffect(() => {
    if (allowedEventTypes.length === 0) {
      setEventTypeId("");
      return;
    }
    if (!allowedEventTypes.some((type) => type.id === eventTypeId)) {
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
        .filter((rule) => rule.roomTypeId === roomTypeId && rule.eventTypeId === eventTypeId)
        .map((rule) => rule.acMode),
    );
    return (["with_ac", "without_ac"] as const).filter((mode) => values.has(mode));
  }, [pricingRules, roomTypeId, eventTypeId]);

  useEffect(() => {
    if (availableAcModes.length === 0) return;
    if (!availableAcModes.includes(acMode)) {
      setAcMode(availableAcModes[0]);
    }
  }, [availableAcModes, acMode]);

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === roomTypeId),
    [rooms, roomTypeId],
  );

  const workingStartHour = activeRoom ? toHour(activeRoom.workingHours.startTime) : 7;
  const workingEndHour = activeRoom ? toHour(activeRoom.workingHours.endTime) : 21;
  const durationHours = eventType?.durationHours ?? 1;
  const firstVisibleHour = Math.max(0, workingStartHour - 2);
  const lastVisibleHour = Math.min(23, workingEndHour + 2);

  const slotMap = useMemo(() => {
    const map: Record<string, Record<string, Slot>> = {};
    for (const date of weekDates) {
      map[date] = {};
      for (const slot of weekSlots[date] ?? []) {
        map[date][slot.startTime] = slot;
      }
    }
    return map;
  }, [weekDates, weekSlots]);

  const selectedByDate = useMemo(() => {
    const map: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
    for (const slot of selectedSlots) {
      map[slot.date] = [...(map[slot.date] ?? []), slot];
    }
    return map;
  }, [selectedSlots]);

  const recurrenceExpandedSlots = useMemo(() => {
    const expanded = expandRecurrencePreview(
      selectedSlots,
      frequency,
      recurrenceEndDate,
      occurrences,
      weekDates[weekDates.length - 1],
    );
    const selectedKeys = new Set(selectedSlots.map((slot) => slotKey(slot)));
    return expanded.filter((slot) => !selectedKeys.has(slotKey(slot)));
  }, [selectedSlots, frequency, recurrenceEndDate, occurrences, weekDates]);

  const recurrencePreviewSlots = useMemo(
    () => recurrenceExpandedSlots.filter((slot) => weekDates.includes(slot.date)),
    [recurrenceExpandedSlots, weekDates],
  );

  const allPlannedSlots = useMemo(() => {
    const map = new Map<string, { date: string; startTime: string; endTime: string; isBase: boolean }>();

    for (const slot of selectedSlots) {
      map.set(slotKey(slot), { ...slot, isBase: true });
    }

    for (const slot of recurrenceExpandedSlots) {
      const key = slotKey(slot);
      if (!map.has(key)) {
        map.set(key, { ...slot, isBase: false });
      }
    }

    return [...map.values()].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
    });
  }, [selectedSlots, recurrenceExpandedSlots]);

  const recurrenceByDate = useMemo(() => {
    const map: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
    for (const slot of recurrencePreviewSlots) {
      map[slot.date] = [...(map[slot.date] ?? []), slot];
    }
    return map;
  }, [recurrencePreviewSlots]);

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

  const recurrenceConflictByDate = useMemo(() => {
    const map: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
    for (const slot of recurrenceConflictSlots) {
      map[slot.date] = [...(map[slot.date] ?? []), slot];
    }
    return map;
  }, [recurrenceConflictSlots]);

  const busyByDate = useMemo(() => {
    const map: Record<string, Slot[]> = {};
    for (const date of weekDates) {
      map[date] = (weekSlots[date] ?? []).filter((slot) => slot.status !== "available");
    }
    return map;
  }, [weekDates, weekSlots]);

  function coversHour(startTime: string, hour: number) {
    const start = toHour(startTime);
    return hour >= start && hour < start + durationHours;
  }

  function toggleSelectionForCell(date: string, hour: number) {
    const startTime = `${String(hour).padStart(2, "0")}:00`;
    const slot = slotMap[date]?.[startTime];

    if (!slot) {
      setErrorMessage("This start time is not valid for the selected duration.");
      return;
    }

    if (slot.status !== "available") {
      setErrorMessage(`Cannot select this slot (${statusLabels[slot.status]}).`);
      return;
    }

    const key = slotKey(slot);
    const exists = selectedSlots.some((item) => slotKey(item) === key);
    if (exists) {
      setSelectedSlots((current) => current.filter((item) => slotKey(item) !== key));
      setErrorMessage("");
      return;
    }

    const candidateStart = toMinutes(slot.startTime);
    const candidateEnd = toMinutes(slot.endTime);
    const overlap = selectedSlots.some((item) => {
      if (item.date !== slot.date) return false;
      const existingStart = toMinutes(item.startTime);
      const existingEnd = toMinutes(item.endTime);
      return candidateStart < existingEnd && existingStart < candidateEnd;
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

  const pricingPreview = useMemo(() => {
    return allPlannedSlots.map((slot) => {
      const rule = getPrice(pricingRules, roomTypeId, eventTypeId, acMode, slot.date);
      return {
        ...slot,
        amountLkr: rule?.amountLkr ?? 0,
        missingPrice: !rule,
      };
    });
  }, [allPlannedSlots, pricingRules, roomTypeId, eventTypeId, acMode]);

  const total = pricingPreview.reduce((sum, item) => sum + item.amountLkr, 0);

  async function submitBooking() {
    if (!roomTypeId || !eventTypeId || selectedSlots.length === 0) {
      setErrorMessage("Select room, event type, and at least one slot.");
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
            occurrences: recurrenceLimitType === "occurrences" && occurrences ? Number(occurrences) : undefined,
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
            .map((item) => `${item.slot.date} ${item.slot.startTime}-${item.slot.endTime}`)
            .join(", ")}`,
        );
      } else {
        setErrorMessage(data.message ?? "Failed to submit booking.");
      }
      setIsSubmitting(false);
      return;
    }

    const overrideNote =
      data.overriddenBookingIds && data.overriddenBookingIds.length > 0
        ? ` Lower-priority overlaps cancelled: ${data.overriddenBookingIds.length}.`
        : "";

    setStatusMessage(`${data.message ?? "Booking submitted."}${overrideNote}`);
    setSelectedSlots([]);
    setCustomer({ name: "", email: "", phone: "", purpose: "" });
    setFrequency("none");
    setRecurrenceLimitType("end_date");
    setRecurrenceEndDate("");
    setOccurrences("");
    setIsSubmitting(false);
  }

  return (
    <div className="calendar-booking-wrap">
      <div className="calendar-booking-stack">
        <article className="calendar-panel gc-panel">
          <div className="gc-toolbar">
            <h2>{weekStartDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
            <div className="gc-nav">
              <button className="btn btn-secondary" onClick={() => setWeekStartDate(addDays(weekStartDate, -7))} type="button">Prev</button>
              <button className="btn btn-secondary" onClick={() => setWeekStartDate(addDays(weekStartDate, 7))} type="button">Next</button>
            </div>
          </div>

          <div className="calendar-form-row">
            <label>
              Room Type
              <select value={roomTypeId} onChange={(event) => setRoomTypeId(event.target.value)}>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>{room.name}</option>
                ))}
              </select>
            </label>
            <label>
              Appointment Type
              <select value={eventTypeId} onChange={(event) => setEventTypeId(event.target.value)}>
                {allowedEventTypes.map((type) => (
                  <option key={type.id} value={type.id}>{type.name} ({type.durationHours} hrs)</option>
                ))}
              </select>
            </label>
            <label>
              AC Mode
              <select
                value={acMode}
                onChange={(event) => setAcMode(event.target.value as "with_ac" | "without_ac")}
                disabled={availableAcModes.length === 0}
              >
                {availableAcModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {acModeLabels[mode]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p>Working hours: <strong>{activeRoom?.workingHours.startTime ?? "--"} - {activeRoom?.workingHours.endTime ?? "--"}</strong>. Click a row inside a day to add/remove a {durationHours}-hour block.</p>

          <div className="slot-legend" aria-label="Slot status legend">
            <span className="legend-dot available">Available</span>
            <span className="legend-dot pending">Pending</span>
            <span className="legend-dot confirmed">Confirmed</span>
            <span className="legend-dot tentative">Tentative</span>
            <span className="legend-dot blocked">Blocked</span>
            <span className="legend-dot current-selection">Current Selection</span>
            <span className="legend-dot recurrence-preview">Recurrence Preview</span>
            <span className="legend-dot recurrence-conflict">Recurrence Conflict</span>
          </div>
          {frequency !== "none" && recurrenceConflictSlots.length > 0 ? (
            <p className="form-message error" role="alert">
              Recurrence warning: {recurrenceConflictSlots.length} slot(s) conflict with existing
              classes/bookings in this view.
            </p>
          ) : null}

          <div className="gc-grid-wrap">
            <div className="gc-head-row">
              <div className="gc-time-head">Time</div>
              {weekDates.map((date) => {
                const isToday = formatDate(new Date()) === date;
                return (
                  <div className="gc-day-head" key={`head-${date}`}>
                    <span>{new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" })}</span>
                    <strong className={isToday ? "active" : ""}>{new Date(`${date}T00:00:00`).getDate()}</strong>
                  </div>
                );
              })}
            </div>

            {Array.from({ length: lastVisibleHour - firstVisibleHour + 1 }, (_, i) => {
              const hour = firstVisibleHour + i;
              return (
                <div className="gc-row" key={`row-${hour}`}>
                  <div className="gc-time-label">{toHourLabel(hour)}</div>
                  {weekDates.map((date) => {
                    const inWorkingHours = hour >= workingStartHour && hour + durationHours <= workingEndHour;
                    const hasClickableSlot = Boolean(slotMap[date]?.[`${String(hour).padStart(2, "0")}:00`]);
                    const busySlot = (busyByDate[date] ?? []).find((slot) => coversHour(slot.startTime, hour));
                    const recurrenceSlot = (recurrenceByDate[date] ?? []).find((slot) => coversHour(slot.startTime, hour));
                    const recurrenceConflictSlot = (recurrenceConflictByDate[date] ?? []).find((slot) =>
                      coversHour(slot.startTime, hour),
                    );
                    const selectedSlot = (selectedByDate[date] ?? []).find((slot) => coversHour(slot.startTime, hour));
                    const recurrencePart = recurrenceSlot ? slotPartForHour(recurrenceSlot, hour) : null;
                    const recurrenceConflictPart = recurrenceConflictSlot
                      ? slotPartForHour(recurrenceConflictSlot, hour)
                      : null;
                    const selectedPart = selectedSlot ? slotPartForHour(selectedSlot, hour) : null;

                    const classes = ["gc-cell"];
                    if (!inWorkingHours || !hasClickableSlot) classes.push("off");
                    if (busySlot) classes.push(`busy-${busySlot.status}`);
                    if (recurrenceSlot) classes.push("recurrence");
                    if (recurrenceConflictSlot) classes.push("recurrence-conflict");
                    if (selectedSlot) classes.push("selected");
                    if (recurrencePart) classes.push(`recurrence-${recurrencePart}`);
                    if (recurrenceConflictPart) classes.push(`recurrence-conflict-${recurrenceConflictPart}`);
                    if (selectedPart) classes.push(`selected-${selectedPart}`);

                    let cellLabel = "";
                    if (selectedSlot && toHour(selectedSlot.startTime) === hour) {
                      cellLabel = `${selectedSlot.startTime}-${selectedSlot.endTime}`;
                    } else if (recurrenceConflictSlot && toHour(recurrenceConflictSlot.startTime) === hour) {
                      cellLabel = "↻ Conflict";
                    } else if (recurrenceSlot && toHour(recurrenceSlot.startTime) === hour) {
                      cellLabel = "↻ Recurrence";
                    } else if (busySlot && toHour(busySlot.startTime) === hour) {
                      cellLabel = statusLabels[busySlot.status];
                    }

                    return (
                      <button
                        className={classes.join(" ")}
                        key={`${date}-${hour}`}
                        onClick={() => toggleSelectionForCell(date, hour)}
                        type="button"
                      >
                        {cellLabel}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </article>

        <article className="calendar-panel">
          <h2>2. Recurrence and Customer Details</h2>

          <div className="calendar-form-row recurrence-row">
            <label>
              Recurrence
              <select value={frequency} onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}>
                <option value="none">No recurrence</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
          </div>

          {frequency !== "none" ? (
            <div className="calendar-form-row recurrence-row">
              <label>
                Recurrence Limit
                <select
                  value={recurrenceLimitType}
                  onChange={(event) => {
                    const next = event.target.value as RecurrenceLimitType;
                    setRecurrenceLimitType(next);
                    if (next === "end_date") setOccurrences("");
                    if (next === "occurrences") setRecurrenceEndDate("");
                  }}
                >
                  <option value="end_date">End Date</option>
                  <option value="occurrences">Number of Recurrences</option>
                </select>
              </label>
              {recurrenceLimitType === "end_date" ? (
                <label>
                  End Date (required)
                  <input type="date" value={recurrenceEndDate} onChange={(event) => setRecurrenceEndDate(event.target.value)} />
                </label>
              ) : (
                <label>
                  Occurrences (required)
                  <input min={1} max={26} type="number" value={occurrences} onChange={(event) => setOccurrences(event.target.value)} />
                </label>
              )}
            </div>
          ) : null}

          <div className="calendar-form-row customer-row">
            <label>
              Name
              <input type="text" value={customer.name} onChange={(event) => setCustomer((prev) => ({ ...prev, name: event.target.value }))} />
            </label>
            <label>
              Email
              <input type="email" value={customer.email} onChange={(event) => setCustomer((prev) => ({ ...prev, email: event.target.value }))} />
            </label>
            <label>
              Contact Number
              <input type="tel" value={customer.phone} onChange={(event) => setCustomer((prev) => ({ ...prev, phone: event.target.value }))} />
            </label>
          </div>

          <label>
            Purpose
            <textarea rows={3} value={customer.purpose} onChange={(event) => setCustomer((prev) => ({ ...prev, purpose: event.target.value }))} />
          </label>

          <h3>Booking Summary</h3>
          <div className="booking-summary-wrap">
            <table className="booking-summary-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Charge</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pricingPreview.map((item) => (
                  <tr key={`${item.date}-${item.startTime}-${item.endTime}`}>
                    <td>{item.date}</td>
                    <td>{item.startTime}-{item.endTime}</td>
                    <td>{item.isBase ? "Base" : "Recurrence"}</td>
                    <td>{item.missingPrice ? "Missing price rule" : `LKR ${currency(item.amountLkr)}`}</td>
                    <td>
                      {item.isBase ? (
                        <button className="btn btn-secondary" onClick={() => toggleSelectionForCell(item.date, toHour(item.startTime))} type="button">
                          Remove
                        </button>
                      ) : (
                        <span className="booking-summary-note">Auto</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="charge-total"><strong>Total: LKR {currency(total)}</strong></p>

          <div className="booking-flow-actions">
            <button className="btn btn-primary" disabled={isSubmitting} onClick={submitBooking} type="button">
              {isSubmitting ? "Submitting..." : "Submit Booking Request"}
            </button>
            <a className="btn btn-secondary" href="/contact">Need help? Go to Contact</a>
          </div>

          {statusMessage ? <p className="form-message success">{statusMessage}</p> : null}
          {errorMessage ? <p className="form-message error">{errorMessage}</p> : null}
        </article>
      </div>
    </div>
  );
}
