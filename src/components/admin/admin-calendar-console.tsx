"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { computeAmountDue, computePaymentTotals } from "@/lib/payments";

type RoomType = {
  id: string;
  name: string;
  workingHours: { startTime: string; endTime: string };
  capacity?: number;
  description?: string;
};
type EventType = { id: string; name: string; durationMinutes: number; cleanupDurationMinutes: number; maxAdvanceBookingDays: number; priority: number; roomTypeId?: string };
type PricingRule = {
  id: string;
  roomTypeId: string;
  eventTypeId: string;
  acMode: "with_ac" | "without_ac";
  dayType: "weekday" | "weekend" | "any";
  amountLkr: number;
};

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

type Booking = {
  id: string;
  reference: string;
  roomTypeId: string;
  eventTypeId: string;
  acMode: "with_ac" | "without_ac";
  status: "pending" | "confirmed" | "tentative" | "rejected" | "cancelled_override";
  totalAmountLkr: number;
  paidAmountLkr: number;
  reconciliationStatus: "unpaid" | "part_paid" | "paid" | "waived";
  reconciliationNotes: string;
  paymentEntries: PaymentEntry[];
  customer: { name: string; email: string; phone: string; purpose: string };
  rejectReason?: string;
  slots: Array<{ date: string; startTime: string; endTime: string; slotStatus?: Booking["status"]; rejectReason?: string }>;
  amountBreakdown: Array<{ date: string; slot: string; amountLkr: number; dayType: string }>;
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

type BookingTab = "all" | "pending" | "tentative" | "unpaid" | "part_paid" | "paid" | "overpaid" | "rejected" | "conflicts";

type BookingDateRange = "all" | "today" | "last_7_days" | "last_30_days" | "custom";

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function computeBookingEffectiveStatus(booking: Booking): Booking["status"] {
  if (booking.slots.length === 0) return booking.status;
  const effectives = booking.slots.map((s) => s.slotStatus ?? booking.status);
  const active = effectives.filter((s) => s !== "rejected" && s !== "cancelled_override");
  if (active.length === 0) return "rejected";
  if (active.every((s) => s === active[0])) return active[0] as Booking["status"];
  return booking.status;
}

const ACTIVE_EFFECTIVE_STATUSES = ["pending", "confirmed", "tentative"] as const;
function isActiveBooking(b: Booking) {
  return (ACTIVE_EFFECTIVE_STATUSES as readonly string[]).includes(computeBookingEffectiveStatus(b));
}

function hasRejectedSlot(b: Booking) {
  return b.slots.some((s) => (s.slotStatus ?? b.status) === "rejected");
}

function computeSlotPaymentAllocation(booking: Booking): Map<string, "paid" | "part_paid" | "unpaid"> {
  const activeSlots = booking.slots
    .filter((s) => {
      const eff = s.slotStatus ?? booking.status;
      return eff !== "rejected" && eff !== "cancelled_override";
    })
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.startTime < b.startTime ? -1 : 1));

  let remaining = booking.paidAmountLkr;
  const result = new Map<string, "paid" | "part_paid" | "unpaid">();

  for (const slot of activeSlots) {
    const key = `${slot.date}|${slot.startTime}`;
    const bd = booking.amountBreakdown.find((b) => b.date === slot.date && b.slot === `${slot.startTime}-${slot.endTime}`);
    const amount = bd?.amountLkr ?? 0;
    if (amount === 0) {
      result.set(key, "paid");
    } else if (remaining >= amount) {
      result.set(key, "paid");
      remaining -= amount;
    } else if (remaining > 0) {
      result.set(key, "part_paid");
      remaining = 0;
    } else {
      result.set(key, "unpaid");
    }
  }
  return result;
}

function formatSlotDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function bookingStatusLabel(status: Booking["status"]): string {
  const map: Record<Booking["status"], string> = {
    pending: "Pending",
    confirmed: "Confirmed",
    tentative: "Tentative",
    rejected: "Rejected",
    cancelled_override: "Cancelled",
  };
  return map[status] ?? status;
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

type CollectionsRow = {
  id: string;
  reference: string;
  customerName: string;
  totalAmountLkr: number;
  paidAmountLkr: number;
  outstandingLkr: number;
  reconciliationStatus: Booking["reconciliationStatus"];
  ageDays: number;
};

type RefundRow = {
  id: string;
  customerName: string;
  totalAmountLkr: number;
  paidAmountLkr: number;
  reconciliationStatus: Booking["reconciliationStatus"];
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

async function safeJson<T>(res: Response): Promise<T> {
  try { return (await res.json()) as T; } catch { return {} as T; }
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

function effectivePaidLkr(booking: Booking): number {
  // paidAmountLkr is the server-computed net of all payment ledger entries.
  // For legacy bookings with reconciliationStatus "waived", treat collected as 0.
  if (booking.reconciliationStatus === "waived" && booking.paymentEntries.length === 0) return 0;
  return booking.paidAmountLkr;
}

// True when cash collected exceeds the post-waiver invoice. Must compare against
// amountDue (total − waivers − credit_notes), not totalAmountLkr, otherwise a
// booking that's been partly waived but overpaid in cash never shows up in the
// Overpaid tab even though the booking-detail meta line correctly flags it.
function isOverpaid(booking: Booking): boolean {
  const totals = computePaymentTotals(booking.paymentEntries);
  const amountDue = computeAmountDue(booking.totalAmountLkr, totals);
  return effectivePaidLkr(booking) > amountDue;
}

// KPIs are computed from ALL confirmed bookings (no date filter) so they match the bookings tab totals.
// The trend chart uses only slots within the selected date range for month-by-month breakdown.
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
  let cancelledOverrideValueLkr = 0;
  let deferredRevenueLkr = 0;

  const startMonth = startOfMonth(ymdToDate(startYmd));
  const endMonth = startOfMonth(ymdToDate(endYmd));
  const monthOrder: string[] = [];
  const trendMap = new Map<string, RevenueBucket>();

  const monthPointer = new Date(startMonth);
  while (monthPointer <= endMonth) {
    const key = `${monthPointer.getFullYear()}-${String(monthPointer.getMonth() + 1).padStart(2, "0")}`;
    monthOrder.push(key);
    trendMap.set(key, { key, label: monthLabel(key), recognizedLkr: 0, collectedLkr: 0, receivableLkr: 0 });
    monthPointer.setMonth(monthPointer.getMonth() + 1);
  }

  const collectionsQueue: CollectionsRow[] = [];
  const refundQueue: RefundRow[] = [];

  for (const booking of sourceBookings) {
    const paid = effectivePaidLkr(booking);
    // Use effective status (accounts for per-slot approve/reject overrides)
    const effectiveStatus = computeBookingEffectiveStatus(booking);

    if (effectiveStatus === "cancelled_override") {
      cancelledOverrideValueLkr += booking.totalAmountLkr;
      continue;
    }

    // Deferred revenue: rejected bookings where the customer already paid — these need a refund.
    if (effectiveStatus === "rejected") {
      if (paid > 0) {
        deferredRevenueLkr += paid;
        refundQueue.push({
          id: booking.id,
          customerName: booking.customer.name,
          totalAmountLkr: booking.totalAmountLkr,
          paidAmountLkr: paid,
          reconciliationStatus: booking.reconciliationStatus,
        });
      }
      continue;
    }

    if (effectiveStatus !== "confirmed") continue;

    // ── KPIs: all confirmed, no date filter ──────────────────────────
    confirmedCount += 1;
    recognizedRevenueLkr += booking.totalAmountLkr;
    collectedRevenueLkr += paid;

    // Outstanding must use amountDue (post-waiver/credit), not totalAmountLkr,
    // otherwise a fully-waived booking still shows as receivable.
    const totals = computePaymentTotals(booking.paymentEntries);
    const amountDue = computeAmountDue(booking.totalAmountLkr, totals);
    const outstanding = Math.max(0, amountDue - paid);
    if (outstanding > 0 && booking.reconciliationStatus !== "waived") {
      receivableRevenueLkr += outstanding;
      if (booking.reconciliationStatus === "unpaid" || booking.reconciliationStatus === "part_paid") {
        const createdAtMs = Date.parse(booking.createdAt);
        const nowMs = Date.now();
        const ageDays =
          Number.isNaN(createdAtMs) || createdAtMs > nowMs
            ? 0
            : Math.floor((nowMs - createdAtMs) / (1000 * 60 * 60 * 24));
        collectionsQueue.push({
          id: booking.id,
          reference: booking.reference,
          customerName: booking.customer.name,
          totalAmountLkr: booking.totalAmountLkr,
          paidAmountLkr: paid,
          outstandingLkr: outstanding,
          reconciliationStatus: booking.reconciliationStatus,
          ageDays,
        });
      }
    }

    // Room/event/AC/day breakdown from full booking amount
    recognizedByRoom.set(booking.roomTypeId, (recognizedByRoom.get(booking.roomTypeId) ?? 0) + booking.totalAmountLkr);
    recognizedByEvent.set(booking.eventTypeId, (recognizedByEvent.get(booking.eventTypeId) ?? 0) + booking.totalAmountLkr);
    recognizedByAcMode.set(booking.acMode, (recognizedByAcMode.get(booking.acMode) ?? 0) + booking.totalAmountLkr);
    for (const item of booking.amountBreakdown) {
      if (item.dayType === "weekend") weekendRevenueLkr += item.amountLkr;
      else weekdayRevenueLkr += item.amountLkr;
    }

    // ── Trend chart: only slots within selected date range ───────────
    const paymentFraction = booking.totalAmountLkr > 0 ? paid / booking.totalAmountLkr : 0;
    const inRangeBreakdown = booking.amountBreakdown.filter((item) => inDateRange(item.date, startYmd, endYmd));

    if (inRangeBreakdown.length > 0) {
      for (const item of inRangeBreakdown) {
        const bKey = monthKey(item.date);
        const bucket = trendMap.get(bKey);
        if (bucket) {
          const itemPaid = Math.round(item.amountLkr * paymentFraction);
          bucket.recognizedLkr += item.amountLkr;
          bucket.collectedLkr += itemPaid;
          if (outstanding > 0 && booking.reconciliationStatus !== "waived") {
            bucket.receivableLkr += item.amountLkr - itemPaid;
          }
        }
      }
    } else {
      const inRangeDates = booking.slots.map((s) => s.date).filter((d) => inDateRange(d, startYmd, endYmd));
      if (inRangeDates.length > 0) {
        const firstDate = inRangeDates.sort()[0];
        const prorated = Math.round((booking.totalAmountLkr * inRangeDates.length) / Math.max(1, booking.slots.length));
        const proratedPaid = Math.round(prorated * paymentFraction);
        const bKey = monthKey(firstDate);
        const bucket = trendMap.get(bKey);
        if (bucket) {
          bucket.recognizedLkr += prorated;
          bucket.collectedLkr += proratedPaid;
          if (outstanding > 0 && booking.reconciliationStatus !== "waived") {
            bucket.receivableLkr += prorated - proratedPaid;
          }
        }
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
    deferredRevenueLkr,
    collectionRatePct: recognizedRevenueLkr === 0 ? 0 : collectedRevenueLkr / recognizedRevenueLkr,
    avgBookingValueLkr: confirmedCount === 0 ? 0 : recognizedRevenueLkr / confirmedCount,
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
    refundQueue,
  };
}

export type AdminCalendarSection =
  | "dashboard"
  | "revenue"
  | "accounts"
  | "rooms"
  | "event-types"
  | "pricing"
  | "bookings"
  | "blockouts";

type AdminCalendarConsoleProps = {
  section: AdminCalendarSection;
};

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "super_admin";
  active: boolean;
  cognitoSub: string | null;
  createdAt: string;
  updatedAt: string;
};

export function AdminCalendarConsole({ section }: AdminCalendarConsoleProps) {
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "super_admin";
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [savedRooms, setSavedRooms] = useState<RoomType[]>([]);
  const [savedEventTypes, setSavedEventTypes] = useState<EventType[]>([]);
  const [savedPricingRules, setSavedPricingRules] = useState<PricingRule[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  // Per-booking error slot so booking-scoped failures render next to the booking
  // card instead of at the top of the page (where they're easy to miss when the
  // queue is scrolled). Cleared on the next successful action on that booking.
  const [bookingErrors, setBookingErrors] = useState<Map<string, string>>(new Map());
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
  const [slotConflictWarning, setSlotConflictWarning] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState<{
    bookingId: string;
    type: "payment" | "refund" | "credit_note" | "waiver";
    date: string;
    amountLkr: string;
    receiptNo: string;
    notes: string;
  } | null>(null);
  const [accountForm, setAccountForm] = useState({
    email: "",
    role: "admin" as "admin" | "super_admin",
    name: "",
  });
  const [activeBookingTab, setActiveBookingTab] = useState<BookingTab>("pending");
  const [bookingDateRange, setBookingDateRange] = useState<BookingDateRange>("all");
  const [bookingCustomStart, setBookingCustomStart] = useState<string>("");
  const [bookingCustomEnd, setBookingCustomEnd] = useState<string>("");
  const [stagedSlotChanges, setStagedSlotChanges] = useState<Map<string, Array<{ slotDate: string; slotStartTime: string; slotStatus: Booking["status"] | null; rejectReason?: string }>>>(new Map());
  const [savingBookingIds, setSavingBookingIds] = useState<Set<string>>(new Set());
  const [slotRejectModal, setSlotRejectModal] = useState<{ bookingId: string; slotDate: string; slotStartTime: string; reason: string } | null>(null);
  const [bulkRejectModal, setBulkRejectModal] = useState<{ bookingId: string; reason: string } | null>(null);

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    void refreshAccounts();
  }, [isSuperAdmin, section]);

  async function refreshAll() {
    const [configRes, bookingRes, blockRes] = await Promise.all([
      fetch("/api/admin/calendar/config"),
      fetch("/api/admin/calendar/bookings"),
      fetch("/api/admin/calendar/blocks"),
    ]);

    const configData = await safeJson<{ rooms: RoomType[]; eventTypes: EventType[]; pricingRules: PricingRule[] }>(configRes);
    const bookingData = await safeJson<{ bookings: Booking[] }>(bookingRes);
    const blockData = await safeJson<{ blocks: CalendarBlock[]; rooms: RoomType[] }>(blockRes);

    if (configData.rooms) { setRooms(configData.rooms); setSavedRooms(configData.rooms); }
    if (configData.eventTypes) {
      const normalisedEventTypes = configData.eventTypes.map((et) => ({
        ...et,
        cleanupDurationMinutes: et.cleanupDurationMinutes ?? 0,
        maxAdvanceBookingDays: et.maxAdvanceBookingDays ?? 365,
      }));
      setEventTypes(normalisedEventTypes);
      setSavedEventTypes(normalisedEventTypes);
    }
    if (configData.pricingRules) { setPricingRules(configData.pricingRules); setSavedPricingRules(configData.pricingRules); }
    if (bookingData.bookings) setBookings(bookingData.bookings);
    if (blockData.blocks) setBlocks(blockData.blocks);
    setBlockForm((current) => ({
      ...current,
      roomTypeId: current.roomTypeId || configData.rooms[0]?.id || "",
    }));
  }

  async function refreshAccounts() {
    const res = await fetch("/api/admin/accounts");
    const data = await safeJson<{ users?: AdminUser[]; message?: string }>(res);
    if (!res.ok) return;
    setAdminUsers(data.users ?? []);
  }

  async function saveConfig() {
    const res = await fetch("/api/admin/calendar/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rooms, eventTypes, pricingRules }),
    });

    const data = await safeJson<{ message?: string }>(res);
    if (!res.ok) {
      setMessageTone("error");
      setMessage(data.message ?? "Failed to save configuration.");
      return;
    }

    setMessageTone("success");
    setMessage(data.message ?? "Configuration saved.");
    await refreshAll();
  }

  function setBookingError(bookingId: string, msg: string | null) {
    setBookingErrors((prev) => {
      const next = new Map(prev);
      if (msg) next.set(bookingId, msg);
      else next.delete(bookingId);
      return next;
    });
  }

  async function updateBookingStatus(id: string, status: Booking["status"], rejectReason?: string) {
    const res = await fetch("/api/admin/calendar/bookings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, ...(rejectReason ? { rejectReason } : {}) }),
    });
    const data = await safeJson<{ message?: string }>(res);
    if (res.ok) {
      setBookingError(id, null);
      setMessageTone("success");
      setMessage(data.message ?? "Booking updated.");
    } else {
      setBookingError(id, data.message ?? "Failed to update booking.");
    }
    await refreshAll();
  }

  function stageSlotChange(
    bookingId: string,
    slotDate: string,
    slotStartTime: string,
    slotStatus: Booking["status"] | null,
    rejectReason?: string,
  ) {
    setStagedSlotChanges((prev) => {
      const next = new Map(prev);
      const existing = next.get(bookingId) ?? [];
      const idx = existing.findIndex((c) => c.slotDate === slotDate && c.slotStartTime === slotStartTime);
      const updated = [...existing];
      if (idx >= 0) {
        updated[idx] = { slotDate, slotStartTime, slotStatus, rejectReason };
      } else {
        updated.push({ slotDate, slotStartTime, slotStatus, rejectReason });
      }
      next.set(bookingId, updated);
      return next;
    });
  }

  function discardStagedChanges(bookingId: string) {
    setStagedSlotChanges((prev) => {
      const next = new Map(prev);
      next.delete(bookingId);
      return next;
    });
  }

  async function savePendingSlotChanges(bookingId: string) {
    const staged = stagedSlotChanges.get(bookingId);
    if (!staged || staged.length === 0) return;

    setSavingBookingIds((prev) => new Set([...prev, bookingId]));
    const res = await fetch("/api/admin/calendar/bookings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: bookingId, batchSlotUpdates: staged }),
    });
    const data = await safeJson<{ message?: string }>(res);
    if (res.ok) {
      setBookingError(bookingId, null);
      setMessageTone("success");
      setMessage(data.message ?? "Booking saved.");
    } else {
      setBookingError(bookingId, data.message ?? "Failed to save.");
    }
    setSavingBookingIds((prev) => {
      const next = new Set(prev);
      next.delete(bookingId);
      return next;
    });
    if (res.ok) {
      discardStagedChanges(bookingId);
      await refreshAll();
    }
  }

  async function addPaymentEntry(
    bookingId: string,
    form: { type: string; date: string; amountLkr: string; receiptNo: string; notes: string },
  ) {
    const amountLkr = Math.floor(Number(form.amountLkr));
    if (!amountLkr || amountLkr <= 0) {
      setMessageTone("error");
      setMessage("Amount must be a positive whole number.");
      return false;
    }
    if (!form.notes.trim()) {
      setMessageTone("error");
      setMessage("Notes are required.");
      return false;
    }
    const res = await fetch(`/api/admin/calendar/bookings/${bookingId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: form.type,
        date: form.date,
        amountLkr,
        receiptNo: form.receiptNo.trim(),
        notes: form.notes.trim(),
      }),
    });
    const data = await safeJson<{ message?: string }>(res);
    setMessageTone(res.ok ? "success" : "error");
    setMessage(data.message ?? (res.ok ? "Entry added." : "Failed to add entry."));
    if (res.ok) await refreshAll();
    return res.ok;
  }

  async function createBlock() {
    if (!blockForm.date) {
      setMessageTone("error");
      setMessage("Please select a date for the blockout.");
      return;
    }
    const res = await fetch("/api/admin/calendar/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blockForm),
    });

    const data = await safeJson<{ message?: string }>(res);
    setMessageTone(res.ok ? "success" : "error");
    setMessage(data.message ?? (res.ok ? "Block created." : "Failed to create block."));
    if (res.ok) await refreshAll();
  }

  async function removeBlock(id: string) {
    await fetch("/api/admin/calendar/blocks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await refreshAll();
  }

  async function createAccount() {
    const res = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accountForm),
    });
    const data = await safeJson<{ message?: string }>(res);
    setMessageTone(res.ok ? "success" : "error");
    setMessage(data.message ?? (res.ok ? "Account created." : "Failed to create account."));
    if (!res.ok) return;

    setAccountForm((current) => ({ ...current, email: "", name: "" }));
    await refreshAccounts();
  }

  async function updateAccountRoleAndState(
    id: string,
    payload: Partial<Pick<AdminUser, "role" | "active">>,
  ) {
    const res = await fetch(`/api/admin/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await safeJson<{ message?: string }>(res);
    setMessageTone(res.ok ? "success" : "error");
    setMessage(data.message ?? (res.ok ? "Account updated." : "Failed to update account."));
    if (!res.ok) return;
    await refreshAccounts();
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
    () => bookings.filter((b) => computeBookingEffectiveStatus(b) === "pending").length,
    [bookings],
  );
  const tentativeBookings = useMemo(
    () => bookings.filter((b) => computeBookingEffectiveStatus(b) === "tentative").length,
    [bookings],
  );
  const confirmedBookings = useMemo(
    () => bookings.filter((b) => computeBookingEffectiveStatus(b) === "confirmed").length,
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

  // KPIs come from ALL bookings matching the room/event/acMode filter (no date filter).
  // The date range is used only for the monthly trend chart inside buildRevenueModel.
  const filteredRevenueBookings = useMemo(
    () =>
      bookings.filter((booking) => {
        if (revenueFilters.roomTypeId !== "all" && booking.roomTypeId !== revenueFilters.roomTypeId) return false;
        if (revenueFilters.eventTypeId !== "all" && booking.eventTypeId !== revenueFilters.eventTypeId) return false;
        if (revenueFilters.acMode !== "all" && booking.acMode !== revenueFilters.acMode) return false;
        return true;
      }),
    [bookings, revenueFilters],
  );

  const revenueModel = useMemo(
    () => buildRevenueModel(filteredRevenueBookings, currentRangeStartYmd, todayYmd),
    [filteredRevenueBookings, currentRangeStartYmd, todayYmd],
  );

  // Dashboard uses all bookings; date range only affects the trend chart.
  const dashboardRevenueModel = useMemo(
    () => buildRevenueModel(bookings, dashboardRangeStartYmd, todayYmd),
    [bookings, dashboardRangeStartYmd, todayYmd],
  );
  const activeSuperAdminCount = useMemo(
    () => adminUsers.filter((user) => user.active && user.role === "super_admin").length,
    [adminUsers],
  );

  const isConfigDirty = useMemo(
    () =>
      JSON.stringify(rooms) !== JSON.stringify(savedRooms) ||
      JSON.stringify(eventTypes) !== JSON.stringify(savedEventTypes) ||
      JSON.stringify(pricingRules) !== JSON.stringify(savedPricingRules),
    [rooms, eventTypes, pricingRules, savedRooms, savedEventTypes, savedPricingRules],
  );

  // Pipeline = all pending/tentative bookings regardless of date range (future prospects)
  const pendingPipelineLkr = useMemo(
    () => bookings.filter((b) => computeBookingEffectiveStatus(b) === "pending").reduce((sum, b) => sum + b.totalAmountLkr, 0),
    [bookings],
  );
  const tentativePipelineLkr = useMemo(
    () => bookings.filter((b) => computeBookingEffectiveStatus(b) === "tentative").reduce((sum, b) => sum + b.totalAmountLkr, 0),
    [bookings],
  );

  const conflictMap = useMemo(() => {
    const active = bookings.filter((b) =>
      ["pending", "tentative", "confirmed"].includes(b.status),
    );
    const map = new Map<string, string[]>();
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        if (a.roomTypeId !== b.roomTypeId) continue;
        const aSlots = a.slots.filter((s) => {
          const eff = s.slotStatus ?? a.status;
          return eff !== "rejected" && eff !== "cancelled_override";
        });
        const bSlots = b.slots.filter((s) => {
          const eff = s.slotStatus ?? b.status;
          return eff !== "rejected" && eff !== "cancelled_override";
        });
        const hasOverlap = aSlots.some((sa) =>
          bSlots.some(
            (sb) =>
              sa.date === sb.date &&
              sa.startTime < sb.endTime &&
              sa.endTime > sb.startTime,
          ),
        );
        if (hasOverlap) {
          map.set(a.id, [...(map.get(a.id) ?? []), b.id]);
          map.set(b.id, [...(map.get(b.id) ?? []), a.id]);
        }
      }
    }
    return map;
  }, [bookings]);

  // Per-slot conflict map: "bookingId|date|startTime" → description strings of conflicting slots
  const slotConflictMap = useMemo(() => {
    const active = bookings.filter((b) =>
      ["pending", "tentative", "confirmed"].includes(b.status),
    );
    const map = new Map<string, string[]>();
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        if (a.roomTypeId !== b.roomTypeId) continue;
        const aSlots = a.slots.filter((s) => (s.slotStatus ?? a.status) !== "rejected" && (s.slotStatus ?? a.status) !== "cancelled_override");
        const bSlots = b.slots.filter((s) => (s.slotStatus ?? b.status) !== "rejected" && (s.slotStatus ?? b.status) !== "cancelled_override");
        for (const sa of aSlots) {
          for (const sb of bSlots) {
            if (sa.date === sb.date && sa.startTime < sb.endTime && sa.endTime > sb.startTime) {
              const keyA = `${a.id}|${sa.date}|${sa.startTime}`;
              const keyB = `${b.id}|${sb.date}|${sb.startTime}`;
              map.set(keyA, [...(map.get(keyA) ?? []), `${b.customer.name} (${eventNameMap[b.eventTypeId]}) ${sb.date} ${sb.startTime}–${sb.endTime}`]);
              map.set(keyB, [...(map.get(keyB) ?? []), `${a.customer.name} (${eventNameMap[a.eventTypeId]}) ${sa.date} ${sa.startTime}–${sa.endTime}`]);
            }
          }
        }
      }
    }
    return map;
  }, [bookings, eventNameMap]);

  const conflictPairs = useMemo(() => {
    const seen = new Set<string>();
    const pairs: Array<{ aId: string; bId: string }> = [];
    for (const [aId, bIds] of conflictMap.entries()) {
      for (const bId of bIds) {
        const key = [aId, bId].sort().join("||");
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push({ aId, bId });
        }
      }
    }
    return pairs;
  }, [conflictMap]);

  const dateRangeBounds = useMemo<{ start: string; end: string } | null>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = toYmd(today);
    switch (bookingDateRange) {
      case "today":        return { start: todayStr, end: todayStr };
      case "last_7_days":  return { start: toYmd(addDays(today, -6)), end: todayStr };
      case "last_30_days": return { start: toYmd(addDays(today, -29)), end: todayStr };
      case "custom":
        if (bookingCustomStart && bookingCustomEnd && bookingCustomStart <= bookingCustomEnd) {
          return { start: bookingCustomStart, end: bookingCustomEnd };
        }
        return null;
      default: return null;
    }
  }, [bookingDateRange, bookingCustomStart, bookingCustomEnd]);

  const dateFilteredBookings = useMemo(() => {
    if (!dateRangeBounds) return bookings;
    const { start, end } = dateRangeBounds;
    return bookings.filter((b) => b.slots.some((s) => s.date >= start && s.date <= end));
  }, [bookings, dateRangeBounds]);

  const tabCounts = useMemo(() => ({
    all: dateFilteredBookings.length,
    pending: dateFilteredBookings.filter((b) => computeBookingEffectiveStatus(b) === "pending").length,
    tentative: dateFilteredBookings.filter((b) => computeBookingEffectiveStatus(b) === "tentative").length,
    unpaid: dateFilteredBookings.filter((b) => b.reconciliationStatus === "unpaid" && isActiveBooking(b)).length,
    part_paid: dateFilteredBookings.filter((b) => b.reconciliationStatus === "part_paid" && isActiveBooking(b)).length,
    paid: dateFilteredBookings.filter((b) => b.reconciliationStatus === "paid").length,
    overpaid: dateFilteredBookings.filter((b) => isOverpaid(b) && isActiveBooking(b)).length,
    rejected: dateFilteredBookings.filter((b) => hasRejectedSlot(b)).length,
    conflicts: dateFilteredBookings.filter((b) => (conflictMap.get(b.id) ?? []).length > 0).length,
  }), [dateFilteredBookings, conflictMap]);

  const filteredBookings = useMemo(() => {
    switch (activeBookingTab) {
      case "pending":   return dateFilteredBookings.filter((b) => computeBookingEffectiveStatus(b) === "pending");
      case "tentative": return dateFilteredBookings.filter((b) => computeBookingEffectiveStatus(b) === "tentative");
      case "unpaid":    return dateFilteredBookings.filter((b) => b.reconciliationStatus === "unpaid" && isActiveBooking(b));
      case "part_paid": return dateFilteredBookings.filter((b) => b.reconciliationStatus === "part_paid" && isActiveBooking(b));
      case "paid":      return dateFilteredBookings.filter((b) => b.reconciliationStatus === "paid");
      case "overpaid":  return dateFilteredBookings.filter((b) => isOverpaid(b) && isActiveBooking(b));
      case "rejected":  return dateFilteredBookings.filter((b) => hasRejectedSlot(b));
      case "conflicts": return dateFilteredBookings.filter((b) => (conflictMap.get(b.id) ?? []).length > 0);
      default:          return dateFilteredBookings;
    }
  }, [dateFilteredBookings, activeBookingTab, conflictMap]);

  const bookingsWithStaged = useMemo(() => {
    if (stagedSlotChanges.size === 0) return bookings;
    return bookings.map((b) => {
      const staged = stagedSlotChanges.get(b.id);
      if (!staged) return b;
      return {
        ...b,
        slots: b.slots.map((slot) => {
          const change = staged.find((c) => c.slotDate === slot.date && c.slotStartTime === slot.startTime);
          if (!change) return slot;
          return {
            ...slot,
            slotStatus: change.slotStatus ?? undefined,
            rejectReason: change.slotStatus === "rejected" ? change.rejectReason : undefined,
          };
        }),
      };
    });
  }, [bookings, stagedSlotChanges]);

  return (
    <div className="admin-console">
      <p className="admin-note">Admin access is protected by authentication and role-based permissions.</p>
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
              {dashboardRevenueModel.deferredRevenueLkr > 0 ? (
                <article className="admin-kpi-card admin-kpi-card-alert">
                  <h4>Deferred (Refund Due)</h4>
                  <p>LKR {currencyFormatter.format(Math.round(dashboardRevenueModel.deferredRevenueLkr))}</p>
                </article>
              ) : null}
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

          <p className="admin-revenue-note">
            Recognized, Collected, and Receivable cover <strong>all confirmed bookings</strong> regardless of date.
            The trend chart and period filter below apply to the selected date range.
          </p>
          <div className="admin-revenue-grid">
            <article className="admin-kpi-card">
              <h4>Recognized (Confirmed)</h4>
              <p>LKR {currencyFormatter.format(Math.round(revenueModel.recognizedRevenueLkr))}</p>
            </article>
            <article className="admin-kpi-card">
              <h4>Collected</h4>
              <p>LKR {currencyFormatter.format(Math.round(revenueModel.collectedRevenueLkr))}</p>
            </article>
            <article className="admin-kpi-card">
              <h4>Receivable (Outstanding)</h4>
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
            <article className={`admin-kpi-card${revenueModel.deferredRevenueLkr > 0 ? " admin-kpi-card-alert" : ""}`}>
              <h4>Deferred (Refund Due)</h4>
              <p>LKR {currencyFormatter.format(Math.round(revenueModel.deferredRevenueLkr))}</p>
              {revenueModel.deferredRevenueLkr > 0 && (
                <small className="admin-kpi-note">{revenueModel.refundQueue.length} rejected booking{revenueModel.refundQueue.length !== 1 ? "s" : ""} — refund customers</small>
              )}
            </article>
          </div>

          {revenueModel.refundQueue.length > 0 ? (
            <div className="admin-chart-panel">
              <h3>Refund Queue — Rejected Bookings with Payment</h3>
              <div className="booking-summary-wrap">
                <table className="admin-queue-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Total Booked</th>
                      <th>Paid</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenueModel.refundQueue.map((row) => (
                      <tr key={row.id} className="refund-queue-row">
                        <td>{row.customerName}</td>
                        <td>LKR {currencyFormatter.format(Math.round(row.totalAmountLkr))}</td>
                        <td className="queue-outstanding">LKR {currencyFormatter.format(Math.round(row.paidAmountLkr))}</td>
                        <td>{row.reconciliationStatus === "paid" ? "Paid in Full" : row.reconciliationStatus === "part_paid" ? "Part Paid" : row.reconciliationStatus}</td>
                        <td>
                          <Link className="btn btn-secondary" href="/admin/calendar/bookings">Review</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

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
              <p>LKR {currencyFormatter.format(Math.round(pendingPipelineLkr))}</p>
              <small className="admin-kpi-note">{bookings.filter((b) => computeBookingEffectiveStatus(b) === "pending").length} booking{bookings.filter((b) => computeBookingEffectiveStatus(b) === "pending").length !== 1 ? "s" : ""}</small>
            </article>
            <article className="admin-kpi-card">
              <h4>Tentative Pipeline</h4>
              <p>LKR {currencyFormatter.format(Math.round(tentativePipelineLkr))}</p>
              <small className="admin-kpi-note">{bookings.filter((b) => computeBookingEffectiveStatus(b) === "tentative").length} booking{bookings.filter((b) => computeBookingEffectiveStatus(b) === "tentative").length !== 1 ? "s" : ""}</small>
            </article>
          </div>

          <div className="admin-chart-panel">
            <h3>Collections Queue</h3>
            <div className="booking-summary-wrap">
              <table className="admin-queue-table">
                <thead>
                  <tr>
                    <th>Booking</th>
                    <th>Customer</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Outstanding</th>
                    <th>Status</th>
                    <th>Age</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueModel.collectionsQueue.length === 0 ? (
                    <tr>
                      <td colSpan={8}>No unpaid or part-paid confirmed bookings in this range.</td>
                    </tr>
                  ) : (
                    revenueModel.collectionsQueue.map((row) => (
                      <tr key={row.id}>
                        <td><code>{row.reference || row.id.slice(0, 8)}</code></td>
                        <td>{row.customerName}</td>
                        <td>LKR {currencyFormatter.format(Math.round(row.totalAmountLkr))}</td>
                        <td>LKR {currencyFormatter.format(Math.round(row.paidAmountLkr))}</td>
                        <td className="queue-outstanding">LKR {currencyFormatter.format(Math.round(row.outstandingLkr))}</td>
                        <td>{row.reconciliationStatus === "part_paid" ? "Part Paid" : "Unpaid"}</td>
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
        isSuperAdmin ? (
        <section className="admin-panel">
        <h2>Room Types and Working Hours</h2>
        <p className="admin-help-text">
          Capacity and description appear on the public bookings page room cards. Leave blank to hide.
        </p>
        <div className="admin-list">
          <div className="admin-row admin-row-rooms admin-row-header">
            <span>Room Name</span>
            <span>Opening Time</span>
            <span>Closing Time</span>
            <span>Capacity</span>
            <span>Description</span>
            <span></span>
          </div>
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
              <input
                type="number"
                min={0}
                step={1}
                placeholder="e.g. 1200"
                value={room.capacity ?? ""}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  const next = raw === "" ? undefined : Number(raw);
                  setRooms((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, capacity: next } : item,
                    ),
                  );
                }}
              />
              <input
                placeholder="e.g. The full floor. 1,200 sqm of polished maple."
                value={room.description ?? ""}
                onChange={(event) => {
                  const next = event.target.value;
                  setRooms((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, description: next || undefined } : item,
                    ),
                  );
                }}
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
        <button className="btn btn-primary" disabled={!isConfigDirty} onClick={saveConfig} type="button">
          Save Configuration{isConfigDirty ? "" : " (no changes)"}
        </button>
        </section>
        ) : (
          <section className="admin-panel">
            <p className="form-message error">Only super admins can manage room configuration.</p>
          </section>
        )
      ) : null}

      {section === "event-types" ? (
        isSuperAdmin ? (
        <section className="admin-panel">
        <h2>Event Types</h2>
        <div className="admin-list">
          <div className="admin-row admin-row-event-types admin-row-header admin-event-type-header">
            <span>Name</span>
            <span>Applies To</span>
            <span>Duration (min)</span>
            <span>Cleanup (min)</span>
            <span>Advance (days)</span>
            <span>Priority</span>
            <span></span>
          </div>
          {eventTypes.map((eventType, index) => (
            <div className="admin-event-type-card" key={eventType.id}>
              <div className="admin-row admin-row-event-types">
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
                  max={1440}
                  step={1}
                  type="number"
                  value={eventType.durationMinutes}
                  onChange={(event) =>
                    setEventTypes((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, durationMinutes: Number(event.target.value) } : item,
                      ),
                    )
                  }
                />
                <input
                  min={0}
                  step={15}
                  type="number"
                  value={eventType.cleanupDurationMinutes ?? 0}
                  onChange={(event) =>
                    setEventTypes((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, cleanupDurationMinutes: Number(event.target.value) } : item,
                      ),
                    )
                  }
                />
                <input
                  min={0}
                  step={1}
                  type="number"
                  value={eventType.maxAdvanceBookingDays ?? 365}
                  onChange={(event) => {
                    const val = parseInt(event.target.value, 10);
                    setEventTypes((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, maxAdvanceBookingDays: isNaN(val) ? 365 : val } : item,
                      ),
                    );
                  }}
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
                  aria-label={`Delete ${eventType.name}`}
                  className="btn-icon-delete"
                  onClick={() => removeEventType(eventType.id)}
                  type="button"
                >
                  <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="15" xmlns="http://www.w3.org/2000/svg">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14H6L5 6"/>
                    <line x1="10" x2="10" y1="11" y2="17"/>
                    <line x1="14" x2="14" y1="11" y2="17"/>
                    <path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="admin-config-actions">
          <button
            className="btn btn-secondary"
            onClick={() =>
              setEventTypes((current) => [
                ...current,
                { id: uid("event"), name: "New Type", durationMinutes: 240, cleanupDurationMinutes: 0, maxAdvanceBookingDays: 365, priority: 1, roomTypeId: rooms[0]?.id },
              ])
            }
            type="button"
          >
            Add Event Type
          </button>
          <button className="btn btn-primary" disabled={!isConfigDirty} onClick={saveConfig} type="button">
            Save Configuration{isConfigDirty ? "" : " (no changes)"}
          </button>
        </div>
        </section>
        ) : (
          <section className="admin-panel">
            <p className="form-message error">Only super admins can manage event type configuration.</p>
          </section>
        )
      ) : null}

      {section === "pricing" ? (
        isSuperAdmin ? (
        <section className="admin-panel">
        <h2>Pricing Matrix</h2>
        <div className="admin-list">
          <div className="admin-row admin-row-pricing admin-row-header">
            <span>Room</span>
            <span>Event Type</span>
            <span>AC Mode</span>
            <span>Day Type</span>
            <span>Amount (LKR)</span>
            <span></span>
          </div>
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
        <button className="btn btn-primary" disabled={!isConfigDirty} onClick={saveConfig} type="button">
          Save Configuration{isConfigDirty ? "" : " (no changes)"}
        </button>
        </section>
        ) : (
          <section className="admin-panel">
            <p className="form-message error">Only super admins can manage pricing configuration.</p>
          </section>
        )
      ) : null}

      {section === "accounts" ? (
        isSuperAdmin ? (
          <section className="admin-panel">
            <h2>Admin Accounts</h2>
            <p className="admin-revenue-note">
              Creating an admin is a two-step process: add the account row here, then create a
              matching user in the AWS Cognito user pool with the same email. The new admin signs
              in via the standard login page — Cognito handles their password and the email
              verification code.
            </p>
            <div className="admin-row admin-row-accounts">
              <input
                type="text"
                placeholder="Name (optional)"
                value={accountForm.name}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, name: event.target.value }))
                }
              />
              <input
                type="email"
                placeholder="Email"
                value={accountForm.email}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, email: event.target.value }))
                }
              />
              <select
                value={accountForm.role}
                onChange={(event) =>
                  setAccountForm((current) => ({
                    ...current,
                    role: event.target.value as "admin" | "super_admin",
                  }))
                }
              >
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
              <button className="btn btn-primary" onClick={createAccount} type="button">
                Create Account
              </button>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-queue-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Cognito</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.map((user) => (
                    <tr key={user.id}>
                      <td>
                        {user.email}
                        {user.id === session?.user?.id ? " (you)" : ""}
                      </td>
                      <td>{user.name || "-"}</td>
                      <td>{user.role}</td>
                      <td>{user.active ? "active" : "inactive"}</td>
                      <td title={user.cognitoSub ?? "Not linked yet — create matching user in AWS Cognito console"}>
                        {user.cognitoSub ? "linked" : "not linked"}
                      </td>
                      <td>{new Date(user.createdAt).toLocaleDateString("en-LK")}</td>
                      <td>
                        <div className="admin-inline-actions">
                          {(() => {
                            const isSelf = user.id === session?.user?.id;
                            const isLastActiveSuperAdmin =
                              user.role === "super_admin" && user.active && activeSuperAdminCount <= 1;
                            const disableRoleToggle = isSelf || isLastActiveSuperAdmin;
                            const disableActivationToggle = isSelf || isLastActiveSuperAdmin;
                            return (
                              <>
                          <button
                            className="btn btn-secondary"
                            onClick={() =>
                              void updateAccountRoleAndState(user.id, {
                                role: user.role === "super_admin" ? "admin" : "super_admin",
                              })
                            }
                            type="button"
                            disabled={disableRoleToggle}
                            title={
                              disableRoleToggle
                                ? isSelf
                                  ? "You cannot change your own role."
                                  : "Cannot remove the last active super admin."
                                : undefined
                            }
                          >
                            Toggle Role
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() =>
                              void updateAccountRoleAndState(user.id, { active: !user.active })
                            }
                            type="button"
                            disabled={disableActivationToggle}
                            title={
                              disableActivationToggle
                                ? isSelf
                                  ? "You cannot deactivate your own account."
                                  : "Cannot deactivate the last active super admin."
                                : undefined
                            }
                          >
                            {user.active ? "Deactivate" : "Activate"}
                          </button>
                              </>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="admin-panel">
            <p className="form-message error">Only super admins can manage admin accounts.</p>
          </section>
        )
      ) : null}

      {section === "blockouts" ? (
        <section className="admin-panel">
        <h2>Calendar Blockouts</h2>
        <p className="admin-revenue-note">
          A blockout prevents any booking slot that <strong>overlaps</strong> the blocked window.
          For example, blocking 12:00–13:00 will make a 4-hour slot starting at 09:00 unavailable
          (09:00–13:00 overlaps), but a slot ending at 12:00 (08:00–12:00) remains available.
          Blocked slots appear highlighted in the public booking calendar.
        </p>
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
          <h2>Booking Queue</h2>

          <div className="admin-booking-date-filter">
            <label htmlFor="booking-date-range">Date range:</label>
            <select
              id="booking-date-range"
              value={bookingDateRange}
              onChange={(e) => setBookingDateRange(e.target.value as BookingDateRange)}
            >
              <option value="all">All dates</option>
              <option value="today">Today</option>
              <option value="last_7_days">Last 7 days</option>
              <option value="last_30_days">Last 30 days</option>
              <option value="custom">Custom range</option>
            </select>
            {bookingDateRange === "custom" ? (
              <>
                <input
                  type="date"
                  aria-label="Start date"
                  value={bookingCustomStart}
                  max={bookingCustomEnd || undefined}
                  onChange={(e) => setBookingCustomStart(e.target.value)}
                />
                <span className="admin-booking-date-sep">to</span>
                <input
                  type="date"
                  aria-label="End date"
                  value={bookingCustomEnd}
                  min={bookingCustomStart || undefined}
                  onChange={(e) => setBookingCustomEnd(e.target.value)}
                />
              </>
            ) : null}
            {dateRangeBounds ? (
              <span className="admin-booking-date-summary">
                Showing slots {dateRangeBounds.start === dateRangeBounds.end
                  ? `on ${formatSlotDate(dateRangeBounds.start)}`
                  : `from ${formatSlotDate(dateRangeBounds.start)} to ${formatSlotDate(dateRangeBounds.end)}`}
              </span>
            ) : null}
          </div>

          <div className="admin-booking-tabs" role="tablist">
            {(
              [
                ["all", "All"],
                ["pending", "Pending"],
                ["tentative", "Tentative"],
                ["unpaid", "Unpaid"],
                ["part_paid", "Part Paid"],
                ["paid", "Paid"],
                ["overpaid", "Overpaid"],
                ["rejected", "Rejected"],
                ["conflicts", "Conflicts"],
              ] as [BookingTab, string][]
            ).map(([tab, label]) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeBookingTab === tab}
                className={[
                  "admin-booking-tab",
                  activeBookingTab === tab ? "active" : "",
                  tab === "conflicts" && tabCounts.conflicts > 0 ? "has-conflicts" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => setActiveBookingTab(tab)}
                type="button"
              >
                {label}
                <span className="admin-booking-tab-count">{tabCounts[tab]}</span>
              </button>
            ))}
          </div>

          {conflictPairs.length > 0 ? (
            <div className="bk-conflicts-banner">
              <div className="bk-conflicts-icon">⚠</div>
              <div className="bk-conflicts-body">
                <strong>
                  {conflictPairs.length} scheduling conflict{conflictPairs.length > 1 ? "s" : ""} detected
                </strong>
                <ul>
                  {conflictPairs.map(({ aId, bId }) => {
                    const a = bookings.find((b) => b.id === aId);
                    const b = bookings.find((b) => b.id === bId);
                    if (!a || !b) return null;
                    const aActive = a.slots.filter((s) => (s.slotStatus ?? a.status) !== "rejected" && (s.slotStatus ?? a.status) !== "cancelled_override");
                    const bActive = b.slots.filter((s) => (s.slotStatus ?? b.status) !== "rejected" && (s.slotStatus ?? b.status) !== "cancelled_override");
                    const overlapDescriptions = aActive.flatMap((sa) =>
                      bActive
                        .filter((sb) => sa.date === sb.date && sa.startTime < sb.endTime && sa.endTime > sb.startTime)
                        .map(() => `${formatSlotDate(sa.date)} ${sa.startTime}–${sa.endTime}`),
                    );
                    return (
                      <li key={`${aId}||${bId}`}>
                        <strong>{a.customer.name}</strong> ({eventNameMap[a.eventTypeId] ?? "?"}, {bookingStatusLabel(a.status)})
                        {" vs "}
                        <strong>{b.customer.name}</strong> ({eventNameMap[b.eventTypeId] ?? "?"}, {bookingStatusLabel(b.status)})
                        {" — "}
                        {roomNameMap[a.roomTypeId] ?? "Unknown room"}
                        {overlapDescriptions.length > 0 && (
                          <span className="bk-conflict-slots">: {overlapDescriptions.join(", ")}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ) : null}

          <div className="bk-list">
            {filteredBookings.length === 0 ? (
              <p className="admin-revenue-note">
                {activeBookingTab === "all" || activeBookingTab === "pending" ? "No bookings yet." : "No bookings in this category."}
              </p>
            ) : null}
            {filteredBookings.map((booking) => {
              const displayStatus = computeBookingEffectiveStatus(booking);
              const conflictIds = conflictMap.get(booking.id) ?? [];
              const hasBookingConflict = conflictIds.length > 0;
              const stagedForBooking = stagedSlotChanges.get(booking.id) ?? [];
              const hasStagedChanges = stagedForBooking.length > 0;
              const isSaving = savingBookingIds.has(booking.id);
              const displayBooking = hasStagedChanges
                ? (bookingsWithStaged.find((b) => b.id === booking.id) ?? booking)
                : booking;
              const slotPaymentAlloc = computeSlotPaymentAllocation(booking);

              return (
                <article
                  className={`bk-card${hasBookingConflict ? " bk-card-conflicted" : ""}`}
                  key={booking.id}
                >
                  {/* ── Header ── */}
                  <div className="bk-header">
                    <div className="bk-title-group">
                      <h3 className="bk-customer-name">{booking.customer.name}</h3>
                      <p className="bk-reference">{booking.reference || booking.id.slice(0, 8)}</p>
                      <p className="bk-subtitle">
                        {roomNameMap[booking.roomTypeId]} &middot;{" "}
                        {eventNameMap[booking.eventTypeId]} &middot;{" "}
                        {booking.acMode === "with_ac" ? "With AC" : "No AC"}
                      </p>
                    </div>
                    <div className="bk-header-right">
                      <span className={`bk-status-pill bk-status-${displayStatus}`}>
                        {bookingStatusLabel(displayStatus)}
                      </span>
                      {hasBookingConflict ? (
                        <span className="bk-conflict-tag">⚠ Conflict</span>
                      ) : null}
                    </div>
                  </div>

                  {/* ── Conflict detail ── */}
                  {hasBookingConflict ? (
                    <div className="bk-conflict-detail">
                      <span className="bk-conflict-detail-label">Overlaps with:</span>
                      <ul className="bk-conflict-detail-list">
                        {conflictIds.map((cid) => {
                          const other = bookings.find((b) => b.id === cid);
                          if (!other) return null;
                          const overlapSlots = booking.slots.filter((sa) =>
                            other.slots.some(
                              (sb) =>
                                (sa.slotStatus ?? booking.status) !== "rejected" &&
                                (sb.slotStatus ?? other.status) !== "rejected" &&
                                sa.date === sb.date &&
                                sa.startTime < sb.endTime &&
                                sa.endTime > sb.startTime,
                            ),
                          );
                          return (
                            <li key={cid}>
                              <strong>{other.customer.name}</strong>{" "}
                              ({eventNameMap[other.eventTypeId] ?? "?"} · {bookingStatusLabel(other.status)})
                              {overlapSlots.length > 0 && (
                                <span className="bk-conflict-slots">
                                  {" "}on {overlapSlots.map((s) => `${formatSlotDate(s.date)} ${s.startTime}–${s.endTime}`).join(", ")}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  {/* ── Refund alert (rejected + paid) ── */}
                  {computeBookingEffectiveStatus(booking) === "rejected" && effectivePaidLkr(booking) > 0 ? (
                    <div className="bk-refund-alert">
                      ⚠ Refund required — customer paid LKR{" "}
                      {currencyFormatter.format(effectivePaidLkr(booking))} for this rejected booking
                    </div>
                  ) : null}

                  {/* ── Meta ── */}
                  {(() => {
                    // Use amountDue (total minus waivers + credit_notes), not totalAmountLkr,
                    // when computing what the customer still owes. Otherwise waivers and
                    // credit_notes never reduce the displayed "Due" figure.
                    const effectivePaid = effectivePaidLkr(booking);
                    const totals = computePaymentTotals(booking.paymentEntries);
                    const amountDue = computeAmountDue(booking.totalAmountLkr, totals);
                    const outstanding = Math.max(0, amountDue - effectivePaid);
                    const overpayment = effectivePaid - amountDue;
                    return (
                      <div className="bk-meta">
                        <span>{booking.customer.email}</span>
                        <span className="bk-sep">&middot;</span>
                        <span>{booking.customer.phone}</span>
                        <span className="bk-sep">&middot;</span>
                        <span className="bk-total">
                          LKR {currencyFormatter.format(booking.totalAmountLkr)}
                        </span>
                        <span className="bk-sep">&middot;</span>
                        {overpayment > 0 ? (
                          <span className="bk-pay-tag bk-pay-overpaid">
                            Overpaid &middot; Refund Due LKR {currencyFormatter.format(overpayment)}
                          </span>
                        ) : booking.reconciliationStatus === "paid" ? (
                          <span className="bk-pay-tag bk-pay-paid">Paid in Full</span>
                        ) : booking.reconciliationStatus === "waived" ? (
                          <span className="bk-pay-tag bk-pay-waived">Waived</span>
                        ) : booking.reconciliationStatus === "part_paid" ? (
                          <span className="bk-pay-tag bk-pay-part">
                            Paid LKR {currencyFormatter.format(effectivePaid)} &middot; Due LKR {currencyFormatter.format(outstanding)}
                          </span>
                        ) : (
                          <span className="bk-pay-tag bk-pay-unpaid">Unpaid</span>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── Purpose ── */}
                  {booking.customer.purpose ? (
                    <p className="bk-purpose">&ldquo;{booking.customer.purpose}&rdquo;</p>
                  ) : null}

                  {/* ── Slot list ── */}
                  <div className="bk-slots">
                    {displayBooking.slots.map((slot) => {
                      const effectiveStatus = slot.slotStatus ?? booking.status;
                      const isApproved = effectiveStatus === "confirmed";
                      const isRejected = effectiveStatus === "rejected";
                      const slotKey = `${booking.id}|${slot.date}|${slot.startTime}`;
                      const slotConflicts = slotConflictMap.get(slotKey) ?? [];
                      const hasSlotConflict = slotConflicts.length > 0 && !isRejected;
                      const showConflictWarning = slotConflictWarning === slotKey;
                      const isStaged = stagedForBooking.some(
                        (c) => c.slotDate === slot.date && c.slotStartTime === slot.startTime,
                      );
                      const payStatus = slotPaymentAlloc.get(`${slot.date}|${slot.startTime}`);

                      return (
                        <div
                          key={slotKey}
                          className={`bk-slot-row${hasSlotConflict ? " bk-slot-conflicted" : ""}${isStaged ? " bk-slot-staged" : ""}`}
                        >
                          <div className="bk-slot-main">
                            <div className="bk-slot-info">
                              <span className="bk-slot-date">{formatSlotDate(slot.date)}</span>
                              <span className="bk-slot-time">
                                {slot.startTime}–{slot.endTime}
                              </span>
                              <span className={`bk-slot-badge bk-slot-${effectiveStatus}`}>
                                {isApproved
                                  ? "✓ Confirmed"
                                  : isRejected
                                    ? "✕ Rejected"
                                    : effectiveStatus.charAt(0).toUpperCase() +
                                      effectiveStatus.slice(1)}
                                {hasSlotConflict ? " ⚠" : ""}
                                {isStaged ? " ●" : ""}
                              </span>
                              {payStatus && !isRejected ? (
                                <span className={`bk-slot-pay bk-slot-pay-${payStatus}`}>
                                  {payStatus === "paid" ? "Paid" : payStatus === "part_paid" ? "Part Paid" : "Unpaid"}
                                </span>
                              ) : null}
                            </div>
                            <div className="bk-slot-actions">
                              <button
                                className={`bk-btn-approve${isApproved ? " is-active" : ""}${hasSlotConflict && !isApproved ? " is-blocked" : ""}`}
                                onClick={() => {
                                  if (isApproved) {
                                    stageSlotChange(booking.id, slot.date, slot.startTime, null);
                                    return;
                                  }
                                  if (hasSlotConflict) {
                                    setSlotConflictWarning(showConflictWarning ? null : slotKey);
                                    return;
                                  }
                                  setSlotConflictWarning(null);
                                  stageSlotChange(booking.id, slot.date, slot.startTime, "confirmed");
                                }}
                                type="button"
                              >
                                {isApproved ? "✓ Approved" : hasSlotConflict ? "⚠ Blocked" : "✓ Approve"}
                              </button>
                              <button
                                className={`bk-btn-reject${isRejected ? " is-active" : ""}`}
                                onClick={() => {
                                  if (isRejected) {
                                    stageSlotChange(booking.id, slot.date, slot.startTime, null);
                                    return;
                                  }
                                  setSlotConflictWarning(null);
                                  setSlotRejectModal({ bookingId: booking.id, slotDate: slot.date, slotStartTime: slot.startTime, reason: "" });
                                }}
                                type="button"
                              >
                                {isRejected ? "✕ Rejected" : "✕ Reject"}
                              </button>
                            </div>
                          </div>
                          {slot.rejectReason ? (
                            <div className="bk-slot-reject-reason">Reason: {slot.rejectReason}</div>
                          ) : null}
                          {showConflictWarning ? (
                            <div className="bk-slot-conflict-msg">
                              ⚠ Cannot approve — conflicts with: {slotConflicts.join("; ")}. Reject
                              those slots first, then try again.
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Footer: bulk + reconciliation ── */}
                  <div className="bk-footer">
                    <div className="bk-bulk">
                      <span className="bk-bulk-label">Bulk:</span>
                      <button
                        className="bk-btn-bulk bk-bulk-approve"
                        onClick={() => void updateBookingStatus(booking.id, "confirmed")}
                        type="button"
                      >
                        Confirm All
                      </button>
                      <button
                        className="bk-btn-bulk bk-bulk-tentative"
                        onClick={() => void updateBookingStatus(booking.id, "tentative")}
                        type="button"
                      >
                        Tentative
                      </button>
                      <button
                        className="bk-btn-bulk bk-bulk-reject"
                        onClick={() => setBulkRejectModal({ bookingId: booking.id, reason: "" })}
                        type="button"
                      >
                        Reject All
                      </button>
                      {hasStagedChanges ? (
                        <>
                          <button
                            className="bk-discard-btn"
                            onClick={() => discardStagedChanges(booking.id)}
                            type="button"
                            disabled={isSaving}
                          >
                            Discard ({stagedForBooking.length})
                          </button>
                          <button
                            className="bk-save-staged-btn"
                            onClick={() => void savePendingSlotChanges(booking.id)}
                            type="button"
                            disabled={isSaving}
                          >
                            {isSaving ? "Saving…" : `Save Changes (${stagedForBooking.length})`}
                          </button>
                        </>
                      ) : null}
                    </div>
                    {bookingErrors.get(booking.id) ? (
                      <div className="bk-booking-error" role="alert">
                        <span>⚠ {bookingErrors.get(booking.id)}</span>
                        <button
                          aria-label="Dismiss error"
                          className="bk-booking-error-dismiss"
                          onClick={() => setBookingError(booking.id, null)}
                          type="button"
                        >
                          ✕
                        </button>
                      </div>
                    ) : null}
                    {/* ── Payment Ledger ── */}
                    <div className="bk-ledger">
                      <div className="bk-ledger-header">
                        <span className="bk-ledger-title">Payment Ledger</span>
                        <button
                          className="btn btn-secondary bk-ledger-add-btn"
                          type="button"
                          onClick={() =>
                            setPaymentForm(
                              paymentForm?.bookingId === booking.id
                                ? null
                                : { bookingId: booking.id, type: "payment", date: todayYmd, amountLkr: "", receiptNo: "", notes: "" },
                            )
                          }
                        >
                          {paymentForm?.bookingId === booking.id ? "Cancel" : "+ Add Entry"}
                        </button>
                      </div>

                      {booking.paymentEntries.length > 0 ? (
                        <table className="bk-ledger-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Type</th>
                              <th>Amount (LKR)</th>
                              <th>Receipt #</th>
                              <th>Notes</th>
                              <th>By</th>
                            </tr>
                          </thead>
                          <tbody>
                            {booking.paymentEntries.map((entry) => (
                              <tr key={entry.id} className={`bk-ledger-row bk-ledger-row-${entry.type}`}>
                                <td>{entry.date}</td>
                                <td className="bk-ledger-type">
                                  {entry.type === "payment" ? "Payment" : entry.type === "refund" ? "Refund" : entry.type === "waiver" ? "Fee Waiver" : "Credit Note"}
                                </td>
                                <td className={entry.type === "payment" ? "bk-ledger-credit" : "bk-ledger-debit"}>
                                  {entry.type === "payment" ? "+" : "−"} {currencyFormatter.format(entry.amountLkr)}
                                </td>
                                <td>{entry.receiptNo || "—"}</td>
                                <td>{entry.notes}</td>
                                <td className="bk-ledger-by">{entry.createdBy}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="bk-ledger-empty">No payment entries yet.</p>
                      )}

                      {paymentForm?.bookingId === booking.id ? (
                        <div className="bk-ledger-form">
                          <div className="bk-ledger-form-row">
                            <select
                              className="bk-recon-select"
                              value={paymentForm.type}
                              onChange={(e) =>
                                setPaymentForm((f) => f && { ...f, type: e.target.value as typeof f.type })
                              }
                            >
                              <option value="waiver">Fee Waiver</option>
                              <option value="payment">Payment</option>
                              <option value="refund">Refund</option>
                              <option value="credit_note">Credit Note</option>
                            </select>
                            <input
                              type="date"
                              className="bk-paid-input"
                              value={paymentForm.date}
                              onChange={(e) => setPaymentForm((f) => f && { ...f, date: e.target.value })}
                            />
                            <input
                              type="number"
                              className="bk-paid-input"
                              placeholder="Amount (LKR)"
                              min={1}
                              value={paymentForm.amountLkr}
                              onChange={(e) => setPaymentForm((f) => f && { ...f, amountLkr: e.target.value })}
                            />
                            <input
                              type="text"
                              className="bk-paid-input"
                              placeholder="Receipt # (optional)"
                              value={paymentForm.receiptNo}
                              onChange={(e) => setPaymentForm((f) => f && { ...f, receiptNo: e.target.value })}
                            />
                          </div>
                          <div className="bk-ledger-form-row">
                            <input
                              type="text"
                              className="bk-recon-notes"
                              placeholder="Notes (required)"
                              value={paymentForm.notes}
                              onChange={(e) => setPaymentForm((f) => f && { ...f, notes: e.target.value })}
                            />
                            <button
                              className="btn btn-primary bk-save-btn"
                              type="button"
                              onClick={() => {
                                void addPaymentEntry(booking.id, paymentForm).then((ok) => {
                                  if (ok) setPaymentForm(null);
                                });
                              }}
                            >
                              Save Entry
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ── Slot reject modal ── */}
      {slotRejectModal ? (
        <div className="bk-modal-overlay" onClick={() => setSlotRejectModal(null)}>
          <div className="bk-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="bk-modal-title">Reject Slot</h3>
            <p className="bk-modal-desc">
              {formatSlotDate(slotRejectModal.slotDate)} {slotRejectModal.slotStartTime}
            </p>
            <label className="bk-modal-label" htmlFor="slot-reject-reason">
              Reason for rejection <span className="bk-modal-required">*</span>
            </label>
            <textarea
              id="slot-reject-reason"
              className="bk-modal-textarea"
              rows={3}
              value={slotRejectModal.reason}
              onChange={(e) => setSlotRejectModal((m) => m && { ...m, reason: e.target.value })}
              placeholder="Enter a reason (required)"
            />
            <div className="bk-modal-actions">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setSlotRejectModal(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary bk-modal-confirm-reject"
                type="button"
                disabled={!slotRejectModal.reason.trim()}
                onClick={() => {
                  stageSlotChange(
                    slotRejectModal.bookingId,
                    slotRejectModal.slotDate,
                    slotRejectModal.slotStartTime,
                    "rejected",
                    slotRejectModal.reason.trim(),
                  );
                  setSlotRejectModal(null);
                }}
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Bulk reject modal ── */}
      {bulkRejectModal ? (
        <div className="bk-modal-overlay" onClick={() => setBulkRejectModal(null)}>
          <div className="bk-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="bk-modal-title">Reject All Slots</h3>
            <label className="bk-modal-label" htmlFor="bulk-reject-reason">
              Reason for rejection <span className="bk-modal-required">*</span>
            </label>
            <textarea
              id="bulk-reject-reason"
              className="bk-modal-textarea"
              rows={3}
              value={bulkRejectModal.reason}
              onChange={(e) => setBulkRejectModal((m) => m && { ...m, reason: e.target.value })}
              placeholder="Enter a reason (required)"
            />
            <div className="bk-modal-actions">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setBulkRejectModal(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary bk-modal-confirm-reject"
                type="button"
                disabled={!bulkRejectModal.reason.trim()}
                onClick={() => {
                  void updateBookingStatus(bulkRejectModal.bookingId, "rejected", bulkRejectModal.reason.trim());
                  setBulkRejectModal(null);
                }}
              >
                Confirm Reject All
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
