"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminLogoutButton } from "@/components/admin/admin-logout-button";
import { useAdminSession } from "@/components/admin/admin-session-context";
import { safeJson } from "@/lib/admin/api";
import {
  activeBookingTotalLkr,
  bookingStatusLabel,
  computeBookingEffectiveStatus,
  computeSlotAllocations,
  effectivePaidLkr,
  formatSlotDate,
  isActiveBooking,
  type SlotAllocation,
} from "@/lib/admin/booking-utils";
import { computeAmountDue, computePaymentTotals } from "@/lib/payments";

/* ── Types (mirror admin-calendar-console.tsx, kept narrow for this file) ── */

type BookingStatus = "pending" | "confirmed" | "tentative" | "rejected" | "cancelled_override";
type ReconStatus = "unpaid" | "part_paid" | "paid" | "waived";

type RoomType = {
  id: string;
  name: string;
  workingHours: { startTime: string; endTime: string };
  capacity?: number;
};

type EventType = {
  id: string;
  name: string;
  durationMinutes: number;
  cleanupDurationMinutes: number;
  maxAdvanceBookingDays: number;
  priority: number;
  roomTypeId?: string;
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

type Slot = {
  date: string;
  startTime: string;
  endTime: string;
  slotStatus?: BookingStatus;
  rejectReason?: string;
};

type AmountBreakdown = { date: string; slot: string; amountLkr: number; dayType: string };

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
  reconciliationNotes: string;
  paymentEntries: PaymentEntry[];
  customer: { name: string; email: string; phone: string; purpose: string };
  rejectReason?: string;
  slots: Slot[];
  amountBreakdown: AmountBreakdown[];
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
};

type StagedSlotChange = {
  slotDate: string;
  slotStartTime: string;
  slotStatus: BookingStatus | null;
  rejectReason?: string;
};

type ApprovalValue = "pending" | "tentative" | "confirmed" | "rejected";
type PaymentValue = "unpaid" | "part_paid" | "paid" | "overpaid";
type ConflictFilter = "all" | "with" | "without";
type SortMode = "newest" | "oldest";

const APPROVAL_VALUES = ["pending", "tentative", "confirmed", "rejected"] as const;
const PAYMENT_VALUES = ["unpaid", "part_paid", "paid", "overpaid"] as const;
const CONFLICT_FILTER_VALUES = ["all", "with", "without"] as const;

const APPROVAL_LABELS: Record<ApprovalValue, string> = {
  pending: "Pending",
  tentative: "Tentative",
  confirmed: "Confirmed",
  rejected: "Rejected",
};

const PAYMENT_LABELS: Record<PaymentValue, string> = {
  unpaid: "Unpaid",
  part_paid: "Part paid",
  paid: "Paid",
  overpaid: "Overpaid",
};

/** Narrow a free-form URL param to one of a known union, falling back when
 *  the value is missing or unrecognised. */
function pickEnumParam<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Parse a comma-separated URL param into a Set of allowed values. Unknown
 *  tokens are dropped silently. Empty / missing yields an empty Set, which
 *  the filter logic treats as "match everything". */
function parseMultiParam<T extends string>(value: string | null, allowed: readonly T[]): Set<T> {
  if (!value) return new Set();
  const allowSet = new Set<string>(allowed);
  const out = new Set<T>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (allowSet.has(trimmed)) out.add(trimmed as T);
  }
  return out;
}

/* ── Formatters ──────────────────────────────────────────────────────────── */

const LKR = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 0 });
function fmtLkr(n: number) {
  return `LKR ${LKR.format(Math.round(n))}`;
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${day} · ${t}`;
}

function fmtTimeShort(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${day} · ${t}`;
}

function relTime(iso: string, now: Date) {
  const ms = now.getTime() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ── Derived helpers ─────────────────────────────────────────────────────── */

function bookingTitle(b: Booking, eventName: string) {
  const purpose = b.customer.purpose.trim();
  return purpose.length > 0 ? purpose : `${eventName} booking`;
}

function paymentTone(b: Booking): "paid" | "part" | "unpaid" | "overpaid" | "waived" {
  // Legacy waiver-only state (no payment entries) keeps its own tag.
  if (b.reconciliationStatus === "waived" && b.paymentEntries.length === 0) return "waived";
  // Compute owing against the ACTIVE-slot total — rejected slots don't
  // create debt. Booking.totalAmountLkr and reconciliationStatus are cached
  // at booking creation and never reduced when slots are later rejected,
  // so deriving the tone from the active total is the only correct shape.
  const totals = computePaymentTotals(b.paymentEntries);
  const activeDue = Math.max(0, activeBookingTotalLkr(b) - totals.totalDeducted);
  const paid = effectivePaidLkr(b);
  if (paid > activeDue) return "overpaid";
  if (activeDue === 0) return "paid";
  if (paid >= activeDue) return "paid";
  if (paid > 0) return "part";
  return "unpaid";
}

function paymentLabel(tone: ReturnType<typeof paymentTone>) {
  switch (tone) {
    case "paid":
      return "Paid";
    case "part":
      return "Part paid";
    case "overpaid":
      return "Overpaid";
    case "waived":
      return "Waived";
    default:
      return "Unpaid";
  }
}

type HistoryEvent = {
  t: string;
  who: string;
  whoRole: "requester" | "admin" | "system";
  action:
    | "submitted"
    | "confirmed"
    | "tentative"
    | "rejected"
    | "slot-rejected"
    | "slot-overridden"
    | "payment"
    | "refund"
    | "credit_note"
    | "waiver";
  note: string;
};

function deriveHistory(b: Booking): HistoryEvent[] {
  const events: HistoryEvent[] = [];

  events.push({
    t: b.createdAt,
    who: b.customer.email || "—",
    whoRole: "requester",
    action: "submitted",
    note: b.customer.purpose
      ? `Booking request submitted via public site. "${b.customer.purpose.slice(0, 120)}${b.customer.purpose.length > 120 ? "…" : ""}"`
      : "Booking request submitted via public site.",
  });

  if (b.confirmedAt) {
    events.push({
      t: b.confirmedAt,
      who: "desk.auto",
      whoRole: "system",
      action: "confirmed",
      note: "Booking confirmed.",
    });
  }

  if (b.status === "rejected" && b.rejectReason) {
    events.push({
      t: b.createdAt,
      who: "admin",
      whoRole: "admin",
      action: "rejected",
      note: `Booking rejected — ${b.rejectReason}`,
    });
  }

  for (const slot of b.slots) {
    if (slot.slotStatus === "rejected" && slot.rejectReason) {
      events.push({
        t: b.createdAt,
        who: "admin",
        whoRole: "admin",
        action: "slot-rejected",
        note: `${formatSlotDate(slot.date)} ${slot.startTime}–${slot.endTime} rejected — ${slot.rejectReason}`,
      });
    }
    if (slot.slotStatus === "cancelled_override") {
      events.push({
        // Approximate timestamp: the cascade bumps booking.updatedAt, so this
        // is the most-recent-cascade time, not a per-slot wall clock.
        t: b.updatedAt,
        who: "desk.auto",
        whoRole: "system",
        action: "slot-overridden",
        note: `${formatSlotDate(slot.date)} ${slot.startTime}–${slot.endTime} cancelled — ${slot.rejectReason ?? "overridden by a higher-priority booking"}`,
      });
    }
  }

  // Legacy fallback: bookings whose entire row was flipped to cancelled_override
  // by the pre-fix cascade have no per-slot override marker. Surface them as a
  // single booking-level event so the timeline isn't blank.
  if (b.status === "cancelled_override" && !b.slots.some((s) => s.slotStatus === "cancelled_override")) {
    events.push({
      t: b.updatedAt,
      who: "desk.auto",
      whoRole: "system",
      action: "slot-overridden",
      note: "Booking cancelled — overridden by a higher-priority booking.",
    });
  }

  for (const entry of b.paymentEntries) {
    const ledgerActionMap = { payment: "payment", refund: "refund", credit_note: "credit_note", waiver: "waiver" } as const;
    events.push({
      t: entry.createdAt,
      who: entry.createdBy || "desk",
      whoRole: "admin",
      action: ledgerActionMap[entry.type],
      note: `${entry.type.replace("_", " ")} — ${fmtLkr(entry.amountLkr)} (${entry.receiptNo || "—"}). ${entry.notes}`,
    });
  }

  return events.sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime());
}

/* ── Main component ──────────────────────────────────────────────────────── */

export function AdminBookings() {
  const session = useAdminSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [bookingErrors, setBookingErrors] = useState<Map<string, string>>(new Map());

  // Filters — initial values can come from the URL (?approval / ?payment /
  // ?conflict), letting the hub KPI tiles deep-link into a pre-filtered queue.
  // ?approval and ?payment accept comma-separated multi values
  // (e.g. ?approval=pending,tentative).
  const initialApproval = parseMultiParam<ApprovalValue>(
    searchParams.get("approval"),
    APPROVAL_VALUES,
  );
  const initialPayment = parseMultiParam<PaymentValue>(
    searchParams.get("payment"),
    PAYMENT_VALUES,
  );
  const initialConflict = pickEnumParam<ConflictFilter>(
    searchParams.get("conflict"),
    CONFLICT_FILTER_VALUES,
    "all",
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");
  const [approvalFilter, setApprovalFilter] = useState<Set<ApprovalValue>>(initialApproval);
  const [paymentFilter, setPaymentFilter] = useState<Set<PaymentValue>>(initialPayment);
  const [conflictFilter, setConflictFilter] = useState<ConflictFilter>(initialConflict);

  // Detail / action state
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("id"));
  const [stagedSlotChanges, setStagedSlotChanges] = useState<Map<string, StagedSlotChange[]>>(new Map());
  const [savingBookingIds, setSavingBookingIds] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState("");
  const [slotRejectModal, setSlotRejectModal] = useState<{ bookingId: string; slotDate: string; slotStartTime: string; reason: string } | null>(null);
  const [bulkRejectModal, setBulkRejectModal] = useState<{ bookingId: string; reason: string } | null>(null);

  // Ledger form
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerForm, setLedgerForm] = useState<{ type: PaymentEntry["type"]; date: string; amountLkr: string; receiptNo: string; notes: string }>({
    type: "payment",
    date: todayYmd(),
    amountLkr: "",
    receiptNo: "",
    notes: "",
  });
  const [ledgerError, setLedgerError] = useState("");

  /* ── Server pagination state ─────────────────────────────────────────── */
  // bookings holds only the current page. Filters + page changes drive a
  // fresh fetch via /api/admin/calendar/bookings?page&pageSize&approval=...
  // KPIs, conflict pairs, and total count come from that same response so
  // they stay accurate across pages.
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [total, setTotal] = useState(0);
  const [kpisFromServer, setKpisFromServer] = useState<{
    pending: number;
    tentative: number;
    approvedToday: number;
    rejectedToday: number;
    confirmRate: number;
    outstanding: number;
    conflicts: number;
  } | null>(null);
  const [conflictMapFromServer, setConflictMapFromServer] = useState<Map<string, string[]>>(
    new Map(),
  );
  // Lazy-fetched full detail for selectedId when it's not in the current
  // page (e.g. after the user changes filter/page).
  const [selectedDetail, setSelectedDetail] = useState<Booking | null>(null);
  const refreshTokenRef = useRef(0);

  // Debounce search input so each keystroke doesn't fire a request.
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Reset to page 1 whenever any filter changes.
  useEffect(() => {
    setPage(1);
  }, [approvalFilter, paymentFilter, conflictFilter, debouncedQuery, sort]);

  /* ── Server fetch ────────────────────────────────────────────────────── */
  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    if (approvalFilter.size > 0) params.set("approval", [...approvalFilter].join(","));
    if (paymentFilter.size > 0) params.set("payment", [...paymentFilter].join(","));
    if (conflictFilter !== "all") params.set("conflict", conflictFilter);
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    params.set("sort", sort);

    const token = ++refreshTokenRef.current;
    const res = await fetch(`/api/admin/calendar/bookings?${params.toString()}`, {
      cache: "no-store",
    });
    // Drop stale responses if a newer fetch has started.
    if (token !== refreshTokenRef.current) return;
    const data = await safeJson<{
      bookings?: Booking[];
      total?: number;
      kpis?: typeof kpisFromServer;
      conflictPairs?: Record<string, string[]>;
      rooms?: RoomType[];
      eventTypes?: EventType[];
    }>(res);
    if (data.bookings) setBookings(data.bookings);
    if (typeof data.total === "number") setTotal(data.total);
    if (data.kpis) setKpisFromServer(data.kpis);
    if (data.conflictPairs) {
      setConflictMapFromServer(new Map(Object.entries(data.conflictPairs)));
    }
    if (data.rooms) setRooms(data.rooms);
    if (data.eventTypes) {
      setEventTypes(
        data.eventTypes.map((et) => ({
          ...et,
          cleanupDurationMinutes: et.cleanupDurationMinutes ?? 0,
          maxAdvanceBookingDays: et.maxAdvanceBookingDays ?? 365,
        })),
      );
    }
    setLoading(false);
  }, [page, approvalFilter, paymentFilter, conflictFilter, debouncedQuery, sort]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* Auto-clear flash messages after a few seconds */
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(t);
  }, [message]);

  /* Sync ?id=... <-> selectedId */
  useEffect(() => {
    const id = searchParams.get("id");
    if (id !== selectedId) setSelectedId(id);
  }, [searchParams, selectedId]);

  const selectBooking = useCallback(
    (id: string | null) => {
      const next = id ? `/admin/calendar/bookings?id=${id}` : "/admin/calendar/bookings";
      router.replace(next, { scroll: false });
    },
    [router],
  );

  /* ── Derived ─────────────────────────────────────────────────────────── */
  const roomNameMap = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r.name])), [rooms]);
  const eventNameMap = useMemo(() => Object.fromEntries(eventTypes.map((e) => [e.id, e.name])), [eventTypes]);

  // The server returns the canonical conflict map; the buildConflictMap()
  // helper stays in the file for type compatibility, but isn't called.
  const conflictMap = conflictMapFromServer;

  // Server already filtered + sorted + paginated; just surface the page.
  const filteredBookings = bookings;

  /* Pick a default booking on the desktop pane when none selected */
  useEffect(() => {
    if (!selectedId && filteredBookings.length > 0 && typeof window !== "undefined" && window.innerWidth > 980) {
      selectBooking(filteredBookings[0].id);
    }
  }, [selectedId, filteredBookings, selectBooking]);

  // Lazy-fetch the selected booking when it's not in the current page —
  // happens after the user changes filter/page while a booking is selected,
  // or after refresh() promotes the selected booking to a different page
  // (e.g. pending → confirmed).
  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null);
      return;
    }
    if (bookings.some((b) => b.id === selectedId)) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/admin/calendar/bookings/${selectedId}`, {
        cache: "no-store",
      });
      const data = await safeJson<{ booking?: Booking }>(res);
      if (cancelled) return;
      if (data.booking) setSelectedDetail(data.booking);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, bookings]);

  const selected = useMemo(
    () =>
      bookings.find((b) => b.id === selectedId) ??
      (selectedDetail && selectedDetail.id === selectedId ? selectedDetail : null),
    [bookings, selectedId, selectedDetail],
  );

  const bookingsWithStaged = useMemo(() => {
    const source: Booking[] = selected && !bookings.some((b) => b.id === selected.id)
      ? [...bookings, selected]
      : bookings;
    if (stagedSlotChanges.size === 0) return source;
    return source.map((b) => {
      const staged = stagedSlotChanges.get(b.id);
      if (!staged || staged.length === 0) return b;
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
  }, [bookings, selected, stagedSlotChanges]);

  /* ── KPIs (header strip) ─────────────────────────────────────────────── */
  // Comes from the server response so the numbers reflect the whole
  // database, not just the current page.
  const kpis = kpisFromServer ?? {
    pending: 0,
    tentative: 0,
    approvedToday: 0,
    rejectedToday: 0,
    confirmRate: 0,
    outstanding: 0,
    conflicts: 0,
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /* ── Mutations (call existing /api/admin/calendar/* endpoints) ───────── */
  const setBookingError = useCallback((id: string, msg: string | null) => {
    setBookingErrors((prev) => {
      const next = new Map(prev);
      if (msg) next.set(id, msg);
      else next.delete(id);
      return next;
    });
  }, []);

  const updateBookingStatus = useCallback(
    async (id: string, status: BookingStatus, rejectReason?: string) => {
      const res = await fetch("/api/admin/calendar/bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, ...(rejectReason ? { rejectReason } : {}) }),
      });
      const data = await safeJson<{ message?: string }>(res);
      if (res.ok) {
        setBookingError(id, null);
        setMessage({ text: data.message ?? "Booking updated.", tone: "success" });
      } else {
        setBookingError(id, data.message ?? "Failed to update booking.");
      }
      await refresh();
    },
    [refresh, setBookingError],
  );

  const stageSlotChange = useCallback(
    (bookingId: string, slotDate: string, slotStartTime: string, slotStatus: BookingStatus | null, rejectReason?: string) => {
      setStagedSlotChanges((prev) => {
        const next = new Map(prev);
        const existing = next.get(bookingId) ?? [];
        const idx = existing.findIndex((c) => c.slotDate === slotDate && c.slotStartTime === slotStartTime);
        const updated = [...existing];
        if (idx >= 0) updated[idx] = { slotDate, slotStartTime, slotStatus, rejectReason };
        else updated.push({ slotDate, slotStartTime, slotStatus, rejectReason });
        next.set(bookingId, updated);
        return next;
      });
    },
    [],
  );

  const discardStaged = useCallback((bookingId: string) => {
    setStagedSlotChanges((prev) => {
      const next = new Map(prev);
      next.delete(bookingId);
      return next;
    });
  }, []);

  const saveStaged = useCallback(
    async (bookingId: string) => {
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
        setMessage({ text: data.message ?? "Slot changes saved.", tone: "success" });
        discardStaged(bookingId);
        await refresh();
      } else {
        setBookingError(bookingId, data.message ?? "Failed to save.");
      }
      setSavingBookingIds((prev) => {
        const next = new Set(prev);
        next.delete(bookingId);
        return next;
      });
    },
    [stagedSlotChanges, discardStaged, refresh, setBookingError],
  );

  const addLedgerEntry = useCallback(async () => {
    if (!selected) return;
    setLedgerError("");
    const amount = Math.floor(Number(ledgerForm.amountLkr));
    if (!amount || amount <= 0) {
      setLedgerError("Amount must be a positive whole number.");
      return;
    }
    if (!ledgerForm.notes.trim()) {
      setLedgerError("Notes are required.");
      return;
    }
    const res = await fetch(`/api/admin/calendar/bookings/${selected.id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: ledgerForm.type,
        date: ledgerForm.date,
        amountLkr: amount,
        receiptNo: ledgerForm.receiptNo.trim(),
        notes: ledgerForm.notes.trim(),
      }),
    });
    const data = await safeJson<{ message?: string }>(res);
    if (res.ok) {
      setMessage({ text: data.message ?? "Entry added.", tone: "success" });
      setLedgerOpen(false);
      setLedgerForm({ type: "payment", date: todayYmd(), amountLkr: "", receiptNo: "", notes: "" });
      await refresh();
    } else {
      setLedgerError(data.message ?? "Failed to add entry.");
    }
  }, [selected, ledgerForm, refresh]);

  if (loading) {
    return (
      <div className="admin-bookings-loading">
        <AdminBreadcrumbs trail={[{ label: "Admin", href: "/admin/calendar" }, { label: "Bookings" }]} />
        <div className="admin-bookings-loading-body">
          <p className="ac-mono admin-bookings-loading-eyebrow">{"// LOADING QUEUE"}</p>
          <p>Pulling fresh bookings…</p>
        </div>
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="admin-bookings">
      <AdminBreadcrumbs
        trail={[
          { label: "Admin", href: "/admin/calendar" },
          { label: "Bookings" },
          { label: "Queue" },
        ]}
      />

      {message ? (
        <div className={`admin-bookings-flash tone-${message.tone}`}>
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} type="button" aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}

      <BookingsHero
        kpis={kpis}
        email={session.email ?? "—"}
        approvalFilter={approvalFilter}
        setApprovalFilter={setApprovalFilter}
        paymentFilter={paymentFilter}
        setPaymentFilter={setPaymentFilter}
        setConflictFilter={setConflictFilter}
      />

      <section className="admin-bookings-split">
        <QueuePanel
          bookings={filteredBookings}
          selectedId={selectedId}
          onSelect={selectBooking}
          query={query}
          setQuery={setQuery}
          sort={sort}
          setSort={setSort}
          approvalFilter={approvalFilter}
          setApprovalFilter={setApprovalFilter}
          paymentFilter={paymentFilter}
          setPaymentFilter={setPaymentFilter}
          conflictFilter={conflictFilter}
          setConflictFilter={setConflictFilter}
          conflictMap={conflictMap}
          eventNameMap={eventNameMap}
          now={now}
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />

        <DetailPanel
          booking={selected ? bookingsWithStaged.find((b) => b.id === selected.id) ?? null : null}
          rawBooking={selected}
          stagedChanges={selected ? stagedSlotChanges.get(selected.id) ?? [] : []}
          isSaving={selected ? savingBookingIds.has(selected.id) : false}
          conflictMap={conflictMap}
          bookingError={selected ? bookingErrors.get(selected.id) ?? null : null}
          onDismissError={(id) => setBookingError(id, null)}
          roomNameMap={roomNameMap}
          eventNameMap={eventNameMap}
          eventTypes={eventTypes}
          bulkReason={bulkReason}
          setBulkReason={setBulkReason}
          ledgerOpen={ledgerOpen}
          setLedgerOpen={setLedgerOpen}
          ledgerForm={ledgerForm}
          setLedgerForm={setLedgerForm}
          ledgerError={ledgerError}
          actions={{
            onSlotApprove: (b, slot) => stageSlotChange(b.id, slot.date, slot.startTime, "confirmed"),
            onSlotTentative: (b, slot) => stageSlotChange(b.id, slot.date, slot.startTime, "tentative"),
            onSlotReject: (b, slot) => setSlotRejectModal({ bookingId: b.id, slotDate: slot.date, slotStartTime: slot.startTime, reason: "" }),
            onSlotClear: (b, slot) => stageSlotChange(b.id, slot.date, slot.startTime, null),
            onSaveStaged: (b) => saveStaged(b.id),
            onDiscardStaged: (b) => discardStaged(b.id),
            onBulkApprove: (b, reason) => updateBookingStatus(b.id, "confirmed", reason || undefined),
            onBulkTentative: (b, reason) => updateBookingStatus(b.id, "tentative", reason || undefined),
            onBulkReject: (b) => setBulkRejectModal({ bookingId: b.id, reason: "" }),
            onAddLedger: addLedgerEntry,
          }}
          session={{ email: session.email ?? "—", isSuperAdmin: session.isSuperAdmin }}
          now={now}
        />
      </section>

      {slotRejectModal ? (
        <RejectModal
          title="Reject this slot"
          desc="Tell the customer why this slot is being declined. They'll see this in their email."
          value={slotRejectModal.reason}
          onChange={(v) => setSlotRejectModal((m) => (m ? { ...m, reason: v } : m))}
          onCancel={() => setSlotRejectModal(null)}
          onConfirm={() => {
            if (!slotRejectModal.reason.trim()) return;
            stageSlotChange(
              slotRejectModal.bookingId,
              slotRejectModal.slotDate,
              slotRejectModal.slotStartTime,
              "rejected",
              slotRejectModal.reason.trim(),
            );
            setSlotRejectModal(null);
          }}
        />
      ) : null}

      {bulkRejectModal ? (
        <RejectModal
          title="Reject every slot in this booking"
          desc="The customer will receive this reason in their decline email. Affects all open slots."
          value={bulkRejectModal.reason}
          onChange={(v) => setBulkRejectModal((m) => (m ? { ...m, reason: v } : m))}
          onCancel={() => setBulkRejectModal(null)}
          onConfirm={() => {
            if (!bulkRejectModal.reason.trim()) return;
            const id = bulkRejectModal.bookingId;
            const reason = bulkRejectModal.reason.trim();
            setBulkRejectModal(null);
            void updateBookingStatus(id, "rejected", reason);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── Hero strip with QUEUE. + KPI tiles ──────────────────────────────────── */

function BookingsHero({
  kpis,
  email,
  approvalFilter,
  setApprovalFilter,
  paymentFilter,
  setPaymentFilter,
  setConflictFilter,
}: {
  kpis: { pending: number; tentative: number; approvedToday: number; rejectedToday: number; confirmRate: number; outstanding: number; conflicts: number };
  email: string;
  approvalFilter: Set<ApprovalValue>;
  setApprovalFilter: (v: Set<ApprovalValue>) => void;
  paymentFilter: Set<PaymentValue>;
  setPaymentFilter: (v: Set<PaymentValue>) => void;
  setConflictFilter: (v: ConflictFilter) => void;
}) {
  // Tiles that map to a filter are clickable — clicking applies the filter,
  // clicking again toggles it back to "all". Static tiles (confirm rate)
  // render as plain divs.
  type TileFilter =
    | { kind: "approval"; values: ApprovalValue[] }
    | { kind: "payment"; values: PaymentValue[] };

  const items: Array<{
    label: string;
    value: string;
    sub: string;
    hot?: boolean;
    small?: boolean;
    filter?: TileFilter;
  }> = [
    {
      label: "In queue",
      value: String(kpis.pending + kpis.tentative),
      sub: `${kpis.pending} pending · ${kpis.tentative} tentative`,
      hot: kpis.pending + kpis.tentative > 0,
      filter: { kind: "approval", values: ["pending", "tentative"] },
    },
    {
      label: "Approved · today",
      value: String(kpis.approvedToday),
      sub: "rolling 24h",
      filter: { kind: "approval", values: ["confirmed"] },
    },
    {
      label: "Rejected · today",
      value: String(kpis.rejectedToday),
      sub: "rolling 24h",
      filter: { kind: "approval", values: ["rejected"] },
    },
    { label: "Confirm rate", value: `${kpis.confirmRate}%`, sub: "last 30 days" },
    {
      label: "Outstanding",
      value: fmtLkr(kpis.outstanding),
      sub: `${kpis.conflicts} booking${kpis.conflicts === 1 ? "" : "s"} flagged for conflict`,
      hot: kpis.outstanding > 0,
      small: true,
      filter: { kind: "payment", values: ["unpaid", "part_paid"] },
    },
  ];

  const setEquals = <T,>(a: Set<T>, b: readonly T[]): boolean =>
    a.size === b.length && b.every((v) => a.has(v));

  const isActive = (f: TileFilter | undefined): boolean => {
    if (!f) return false;
    if (f.kind === "approval") return setEquals(approvalFilter, f.values);
    return setEquals(paymentFilter, f.values);
  };

  // KPI tiles are single-purpose filter shortcuts: clicking one resets the
  // other axes back to "all" so the queue shows exactly what the tile claims.
  // Clicking the active tile again clears everything.
  const applyFilter = (f: TileFilter) => {
    if (isActive(f)) {
      setApprovalFilter(new Set());
      setPaymentFilter(new Set());
      setConflictFilter("all");
      return;
    }
    if (f.kind === "approval") {
      setApprovalFilter(new Set(f.values));
      setPaymentFilter(new Set());
      setConflictFilter("all");
    } else {
      setPaymentFilter(new Set(f.values));
      setApprovalFilter(new Set());
      setConflictFilter("all");
    }
  };

  return (
    <>
      <section className="admin-bookings-hero">
        <div className="admin-bookings-hero-grid">
          <div>
            <p className="ac-mono admin-bookings-hero-eyebrow">{"// BOOKINGS DESK · OPERATIONS"}</p>
            <h1 className="admin-bookings-hero-title ac-display">
              QUEUE<span className="punct">.</span>
            </h1>
            <p className="admin-bookings-hero-lede">
              Review incoming requests, take action, and keep a clean audit trail. Every action you take is logged below the
              booking with your handle and timestamp.
            </p>
          </div>
          <div className="admin-bookings-hero-identity">
            <span aria-hidden className="admin-bookings-hero-identity-dot" />
            <span className="admin-bookings-hero-identity-email">{email}</span>
            <AdminLogoutButton />
          </div>
        </div>
      </section>
      <div className="admin-bookings-kpis">
        {items.map((s) => {
          const active = isActive(s.filter);
          const cls = `admin-bookings-kpi-tile${s.filter ? " is-link" : ""}${active ? " is-active" : ""}`;
          const body = (
            <>
              <div className="admin-bookings-kpi-label">{s.label}</div>
              <div className={`admin-bookings-kpi-value${s.hot ? " is-hot" : ""}${s.small ? " is-small" : ""}`}>{s.value}</div>
              <div className="admin-bookings-kpi-sub">· {s.sub}</div>
            </>
          );
          if (s.filter) {
            return (
              <button
                key={s.label}
                type="button"
                className={cls}
                onClick={() => applyFilter(s.filter!)}
                aria-pressed={active}
              >
                {body}
              </button>
            );
          }
          return (
            <div className={cls} key={s.label}>
              {body}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Multi-select filter dropdown ────────────────────────────────────────── */

function MultiSelectFilter<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  selected: Set<T>;
  onChange: (next: Set<T>) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const summary =
    selected.size === 0
      ? "All"
      : selected.size === 1
        ? (options.find((o) => selected.has(o.value))?.label ?? "—")
        : `${selected.size} selected`;

  const toggle = (value: T) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  return (
    <label className="admin-bookings-multi">
      <span>{label}</span>
      <div className="admin-bookings-multi-wrap" ref={rootRef}>
        <button
          type="button"
          className={`admin-bookings-multi-trigger${open ? " is-open" : ""}`}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span>{summary.toUpperCase()}</span>
          <span aria-hidden className="admin-bookings-multi-caret">▾</span>
        </button>
        {open ? (
          <div className="admin-bookings-multi-panel" role="listbox">
            {options.map((opt) => {
              const checked = selected.has(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`admin-bookings-multi-option${checked ? " is-checked" : ""}`}
                  onClick={() => toggle(opt.value)}
                  role="option"
                  aria-selected={checked}
                >
                  <span aria-hidden className="admin-bookings-multi-check">{checked ? "✓" : ""}</span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
            {selected.size > 0 ? (
              <button
                type="button"
                className="admin-bookings-multi-clear"
                onClick={() => onChange(new Set())}
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </label>
  );
}

/* ── Queue panel (left rail) ─────────────────────────────────────────────── */

function QueuePanel({
  bookings,
  selectedId,
  onSelect,
  query,
  setQuery,
  sort,
  setSort,
  approvalFilter,
  setApprovalFilter,
  paymentFilter,
  setPaymentFilter,
  conflictFilter,
  setConflictFilter,
  conflictMap,
  eventNameMap,
  now,
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
}: {
  bookings: Booking[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  query: string;
  setQuery: (v: string) => void;
  sort: SortMode;
  setSort: (v: SortMode) => void;
  approvalFilter: Set<ApprovalValue>;
  setApprovalFilter: (v: Set<ApprovalValue>) => void;
  paymentFilter: Set<PaymentValue>;
  setPaymentFilter: (v: Set<PaymentValue>) => void;
  conflictFilter: ConflictFilter;
  setConflictFilter: (v: ConflictFilter) => void;
  conflictMap: Map<string, string[]>;
  eventNameMap: Record<string, string>;
  now: Date;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (next: number) => void;
}) {
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);
  return (
    <aside className="admin-bookings-queue">
      <div className="admin-bookings-queue-head">
        <p className="ac-mono admin-bookings-queue-eyebrow">{"// REQUEST QUEUE"}</p>
        <div className="admin-bookings-queue-search-row">
          <div className="admin-bookings-queue-search">
            <span aria-hidden>⌕</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ref, name, email, room, event…"
            />
          </div>
          <select className="admin-bookings-queue-sort" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
            <option value="newest">NEWEST</option>
            <option value="oldest">OLDEST</option>
          </select>
        </div>
        <div className="admin-bookings-queue-filters">
          <MultiSelectFilter
            label="Approval"
            options={APPROVAL_VALUES.map((v) => ({ value: v, label: APPROVAL_LABELS[v] }))}
            selected={approvalFilter}
            onChange={setApprovalFilter}
          />
          <MultiSelectFilter
            label="Payment"
            options={PAYMENT_VALUES.map((v) => ({ value: v, label: PAYMENT_LABELS[v] }))}
            selected={paymentFilter}
            onChange={setPaymentFilter}
          />
          <label>
            <span>Conflicts</span>
            <select value={conflictFilter} onChange={(e) => setConflictFilter(e.target.value as ConflictFilter)}>
              <option value="all">All</option>
              <option value="with">Conflicts only</option>
              <option value="without">No conflicts</option>
            </select>
          </label>
        </div>
      </div>

      <div className="admin-bookings-queue-list">
        {bookings.length === 0 ? (
          <div className="admin-bookings-queue-empty">No bookings match your filters.</div>
        ) : (
          bookings.map((b) => (
            <QueueRow
              key={b.id}
              booking={b}
              active={b.id === selectedId}
              onClick={() => onSelect(b.id)}
              hasConflict={conflictMap.has(b.id)}
              eventName={eventNameMap[b.eventTypeId] ?? "?"}
              now={now}
            />
          ))
        )}
      </div>

      {total > 0 ? (
        <div className="admin-bookings-queue-pager">
          <span className="ac-mono admin-bookings-queue-pager-range">
            {rangeStart}–{rangeEnd} of {total}
          </span>
          <div className="admin-bookings-queue-pager-controls">
            <button
              type="button"
              className="admin-bookings-queue-pager-btn"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              ‹ Prev
            </button>
            <span className="ac-mono admin-bookings-queue-pager-page">
              Page {page} of {pageCount}
            </span>
            <button
              type="button"
              className="admin-bookings-queue-pager-btn"
              onClick={() => onPageChange(Math.min(pageCount, page + 1))}
              disabled={page >= pageCount}
              aria-label="Next page"
            >
              Next ›
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function QueueRow({
  booking,
  active,
  onClick,
  hasConflict,
  eventName,
  now,
}: {
  booking: Booking;
  active: boolean;
  onClick: () => void;
  hasConflict: boolean;
  eventName: string;
  now: Date;
}) {
  const effectiveStatus = computeBookingEffectiveStatus(booking);
  const slotCount = booking.slots.length;
  const firstSlot = booking.slots[0];
  const tone = paymentTone(booking);
  // Hide the pay tag for fully-rejected bookings with no payments — the
  // Rejected status pill already says everything. A refund-due ("overpaid")
  // tag still surfaces here when an admin owes the customer money back.
  const showPayTag = isActiveBooking(booking) || effectivePaidLkr(booking) > 0;

  return (
    <button className={`admin-bookings-queue-row${active ? " is-active" : ""}`} onClick={onClick} type="button">
      <div className="admin-bookings-queue-row-top">
        <span className="ac-mono admin-bookings-queue-row-ref">{booking.reference || booking.id.slice(0, 8)}</span>
        <StatusPill status={effectiveStatus} size="sm" />
      </div>

      <div className="admin-bookings-queue-row-title">
        {booking.customer.name || booking.customer.email || "(no name)"}
      </div>

      <div className="admin-bookings-queue-row-chips">
        <span className="admin-bookings-chip admin-bookings-chip-gold">
          {slotCount} slot{slotCount === 1 ? "" : "s"}
        </span>
        {showPayTag ? <PaymentTag tone={tone} size="sm" /> : null}
        {hasConflict ? <span className="admin-bookings-chip admin-bookings-chip-danger">⚠ Conflict</span> : null}
        <span className="admin-bookings-queue-row-sport">{eventName}</span>
      </div>

      <div className="admin-bookings-queue-row-slot">
        {firstSlot ? (
          <>
            <span className="admin-bookings-queue-row-slot-date">
              {formatSlotDate(firstSlot.date)}
            </span>
            <span className="admin-bookings-queue-row-slot-time">
              {" · "}{firstSlot.startTime}–{firstSlot.endTime}
            </span>
            {slotCount > 1 ? (
              <span className="admin-bookings-queue-row-slot-more">{" · +"}{slotCount - 1} more</span>
            ) : null}
          </>
        ) : (
          <span className="admin-bookings-queue-row-slot-empty">no slots</span>
        )}
      </div>

      <div className="admin-bookings-queue-row-bottom">
        <span className="admin-bookings-queue-row-org">↳ {booking.customer.email || "—"}</span>
        <div className="admin-bookings-queue-row-stamp">
          <div className="ac-mono">SUBMITTED</div>
          <div>{fmtTimeShort(booking.createdAt).split(" · ")[1]}</div>
          <div>{relTime(booking.createdAt, now)}</div>
        </div>
      </div>
    </button>
  );
}

/* ── Detail panel (right) ────────────────────────────────────────────────── */

type DetailActions = {
  onSlotApprove: (b: Booking, slot: Slot) => void;
  onSlotTentative: (b: Booking, slot: Slot) => void;
  onSlotReject: (b: Booking, slot: Slot) => void;
  onSlotClear: (b: Booking, slot: Slot) => void;
  onSaveStaged: (b: Booking) => void;
  onDiscardStaged: (b: Booking) => void;
  onBulkApprove: (b: Booking, reason: string) => void;
  onBulkTentative: (b: Booking, reason: string) => void;
  onBulkReject: (b: Booking) => void;
  onAddLedger: () => void;
};

function DetailPanel({
  booking,
  rawBooking,
  stagedChanges,
  isSaving,
  conflictMap,
  bookingError,
  onDismissError,
  roomNameMap,
  eventNameMap,
  eventTypes,
  bulkReason,
  setBulkReason,
  ledgerOpen,
  setLedgerOpen,
  ledgerForm,
  setLedgerForm,
  ledgerError,
  actions,
  session,
  now,
}: {
  booking: Booking | null;
  rawBooking: Booking | null;
  stagedChanges: StagedSlotChange[];
  isSaving: boolean;
  conflictMap: Map<string, string[]>;
  bookingError: string | null;
  onDismissError: (id: string) => void;
  roomNameMap: Record<string, string>;
  eventNameMap: Record<string, string>;
  eventTypes: EventType[];
  bulkReason: string;
  setBulkReason: (v: string) => void;
  ledgerOpen: boolean;
  setLedgerOpen: (v: boolean) => void;
  ledgerForm: { type: PaymentEntry["type"]; date: string; amountLkr: string; receiptNo: string; notes: string };
  setLedgerForm: (v: { type: PaymentEntry["type"]; date: string; amountLkr: string; receiptNo: string; notes: string }) => void;
  ledgerError: string;
  actions: DetailActions;
  session: { email: string; isSuperAdmin: boolean };
  now: Date;
}) {
  if (!booking || !rawBooking) {
    return (
      <div className="admin-bookings-detail-empty">
        <p className="ac-mono">{"// SELECT A BOOKING"}</p>
        <p>Pick a request from the queue to review and take action.</p>
      </div>
    );
  }

  const effectiveStatus = computeBookingEffectiveStatus(booking);
  const eventName = eventNameMap[booking.eventTypeId] ?? "?";
  const roomName = roomNameMap[booking.roomTypeId] ?? "?";
  const eventType = eventTypes.find((e) => e.id === booking.eventTypeId);
  const totalHrs = booking.slots.reduce((sum, s) => {
    const [sh, sm] = s.startTime.split(":").map(Number);
    const [eh, em] = s.endTime.split(":").map(Number);
    return sum + (eh * 60 + em - (sh * 60 + sm)) / 60;
  }, 0);
  const conflicts = conflictMap.get(booking.id) ?? [];
  const hasStaged = stagedChanges.length > 0;
  const openCount = booking.slots.filter(
    (s) => (s.slotStatus ?? booking.status) === "pending" || (s.slotStatus ?? booking.status) === "tentative",
  ).length;
  // Recovery / refund headline — what the desk needs to act on. Uses the
  // active-slot total so rejected slots don't inflate the figure.
  const recoveryTotals = computePaymentTotals(booking.paymentEntries);
  const recoveryDue = computeAmountDue(activeBookingTotalLkr(booking), recoveryTotals);
  const recoveryPaid = effectivePaidLkr(booking);
  const outstandingLkr = Math.max(0, recoveryDue - recoveryPaid);
  const refundDueLkr = Math.max(0, recoveryPaid - recoveryDue);
  const recoveryLabel =
    refundDueLkr > 0 ? "REFUND DUE" : outstandingLkr > 0 ? "OUTSTANDING" : "SETTLED";
  const recoveryValue =
    refundDueLkr > 0 ? fmtLkr(refundDueLkr) : outstandingLkr > 0 ? fmtLkr(outstandingLkr) : "—";
  const recoveryTone =
    refundDueLkr > 0 ? "refund" : outstandingLkr > 0 ? "owed" : "settled";
  const title = bookingTitle(booking, eventName);

  return (
    <div className="admin-bookings-detail">
      <div className="admin-bookings-detail-header">
        <div>
          <div className="admin-bookings-detail-header-row">
            <span className="ac-mono admin-bookings-detail-ref">{booking.reference || booking.id.slice(0, 8)}</span>
            <StatusPill status={effectiveStatus} />
            {conflicts.length > 0 ? (
              <span className="admin-bookings-chip admin-bookings-chip-danger">
                ⚠ Conflicts with {conflicts.length} booking{conflicts.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          <h2 className="admin-bookings-detail-title ac-display">
            {title.toUpperCase()}<span className="punct">.</span>
          </h2>
          <p className="admin-bookings-detail-subline">
            {roomName} · {eventName} · {booking.acMode === "with_ac" ? "With A/C" : "Without A/C"}
          </p>
        </div>
        <div className="admin-bookings-detail-stamp">
          <p className="ac-mono">SUBMITTED</p>
          <div className="admin-bookings-detail-stamp-abs">{fmtDateTime(booking.createdAt)}</div>
          <div className="admin-bookings-detail-stamp-rel">{relTime(booking.createdAt, now)}</div>
        </div>
      </div>

      {bookingError ? (
        <div className="admin-bookings-detail-error">
          <span>{bookingError}</span>
          <button onClick={() => onDismissError(booking.id)} type="button" aria-label="Dismiss">×</button>
        </div>
      ) : null}

      <div className="admin-bookings-detail-grid">
        <div>
          <SubHeading title="Booking slots" accent={`· ${booking.slots.length}`} meta="Each slot can be actioned individually" />

          <div className="admin-bookings-summary-strip">
            <div>
              <p className="ac-mono">SPORT / USE</p>
              <p>{eventName}</p>
            </div>
            <div>
              <p className="ac-mono">TOTAL HOURS</p>
              <p>{totalHrs.toFixed(1).replace(/\.0$/, "")} hrs</p>
            </div>
            <div>
              <p className="ac-mono">FEE</p>
              <p>{fmtLkr(booking.totalAmountLkr)}</p>
            </div>
            <div className={`admin-bookings-summary-recovery tone-${recoveryTone}`}>
              <p className="ac-mono">{recoveryLabel}</p>
              <p className="admin-bookings-summary-recovery-value">{recoveryValue}</p>
            </div>
          </div>

          <div className="admin-bookings-slot-table">
            {(() => {
              const allocations = computeSlotAllocations(booking);
              const allocByKey = new Map(allocations.map((a) => [a.key, a]));
              return booking.slots.map((slot, idx) => {
                const slotStatus = slot.slotStatus ?? booking.status;
                const isApproved = slotStatus === "confirmed";
                const isTentative = slotStatus === "tentative";
                const isRejected = slotStatus === "rejected";
                const staged = stagedChanges.find((c) => c.slotDate === slot.date && c.slotStartTime === slot.startTime);
                const allocation = allocByKey.get(`${slot.date}|${slot.startTime}`);
                return (
                <div key={`${slot.date}|${slot.startTime}`} className={`admin-bookings-slot-row${staged ? " is-staged" : ""}`}>
                  <div className="admin-bookings-slot-idx ac-mono">{String(idx + 1).padStart(2, "0")}</div>
                  <div className="admin-bookings-slot-body">
                    <div className="admin-bookings-slot-label">{formatSlotDate(slot.date)}</div>
                    <div className="admin-bookings-slot-meta ac-mono">
                      {slot.startTime}–{slot.endTime}
                      {eventType?.cleanupDurationMinutes
                        ? ` · +${eventType.cleanupDurationMinutes}min cleanup`
                        : ""}
                    </div>
                    <div className="admin-bookings-slot-where">
                      {roomName} · {booking.acMode === "with_ac" ? "With A/C" : "Without A/C"}
                    </div>
                    {isRejected && slot.rejectReason ? (
                      <div className="admin-bookings-slot-reject-reason">↳ {slot.rejectReason}</div>
                    ) : null}
                  </div>
                  <SlotPriceCell allocation={allocation} />
                  <div className="admin-bookings-slot-status">
                    <StatusPill status={slotStatus} size="sm" />
                  </div>
                  <div className="admin-bookings-slot-actions">
                    <SlotBtn
                      tone="ok"
                      active={isApproved}
                      onClick={() => (isApproved ? actions.onSlotClear(booking, slot) : actions.onSlotApprove(booking, slot))}
                      title="Approve"
                    >
                      ✓
                    </SlotBtn>
                    <SlotBtn
                      tone="info"
                      active={isTentative}
                      onClick={() => (isTentative ? actions.onSlotClear(booking, slot) : actions.onSlotTentative(booking, slot))}
                      title="Tentative"
                    >
                      ?
                    </SlotBtn>
                    <SlotBtn
                      tone="danger"
                      active={isRejected}
                      onClick={() => actions.onSlotReject(booking, slot)}
                      title="Reject"
                    >
                      ✕
                    </SlotBtn>
                  </div>
                </div>
                );
              });
            })()}
          </div>
        </div>

        <div>
          <SubHeading title="Requester" />
          <div className="admin-bookings-requester">
            <div className="admin-bookings-requester-name">{booking.customer.name || "—"}</div>
            <div className="admin-bookings-requester-org">via public site</div>
            <div className="admin-bookings-requester-rows">
              <div className="ac-mono">@ {booking.customer.email || "—"}</div>
              <div className="ac-mono">☎ {booking.customer.phone || "—"}</div>
            </div>
          </div>

          {booking.customer.purpose ? (
            <>
              <SubHeading title="Purpose of booking" />
              <blockquote className="admin-bookings-purpose">{booking.customer.purpose}</blockquote>
            </>
          ) : null}
        </div>
      </div>

      {/* Bulk actions */}
      <div className="admin-bookings-bulk">
        <SubHeading title="Bulk actions" accent="· applies to all slots" meta={`Signed in as ${session.email}`} />

        <div className="admin-bookings-bulk-grid">
          <div>
            <p className="ac-mono admin-bookings-bulk-label">NOTE / REASON (LOGGED TO HISTORY)</p>
            <textarea
              className="admin-bookings-bulk-textarea"
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              placeholder="e.g. Approved under school priority window. PA tech assigned: N. Silva."
            />
            <p className="ac-mono admin-bookings-bulk-foot">
              For per-slot decisions use the inline buttons in the slots table above.
            </p>
          </div>
          <div className="admin-bookings-bulk-buttons">
            <button
              className="admin-bookings-bulk-btn tone-ok"
              type="button"
              onClick={() => {
                actions.onBulkApprove(booking, bulkReason);
                setBulkReason("");
              }}
            >
              ✓ APPROVE ALL SLOTS
            </button>
            <button
              className="admin-bookings-bulk-btn tone-info"
              type="button"
              onClick={() => {
                actions.onBulkTentative(booking, bulkReason);
                setBulkReason("");
              }}
            >
              ? MARK ALL TENTATIVE
            </button>
            <button
              className="admin-bookings-bulk-btn tone-danger"
              type="button"
              onClick={() => actions.onBulkReject(booking)}
            >
              ✕ REJECT ALL SLOTS
            </button>
            <div className="admin-bookings-bulk-count ac-mono">
              {openCount} of {booking.slots.length} slot{booking.slots.length === 1 ? "" : "s"} still open
            </div>
          </div>
        </div>

        {hasStaged ? (
          <div className="admin-bookings-staged-bar">
            <div>
              <strong>{stagedChanges.length} staged change{stagedChanges.length === 1 ? "" : "s"}</strong>
              <span> awaiting save</span>
            </div>
            <div className="admin-bookings-staged-actions">
              <button
                className="admin-bookings-staged-save"
                type="button"
                disabled={isSaving}
                onClick={() => actions.onSaveStaged(booking)}
              >
                {isSaving ? "Saving…" : `Save Changes (${stagedChanges.length})`}
              </button>
              <button
                className="admin-bookings-staged-discard"
                type="button"
                disabled={isSaving}
                onClick={() => actions.onDiscardStaged(booking)}
              >
                Discard ({stagedChanges.length})
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Payment ledger */}
      <PaymentLedger
        booking={booking}
        ledgerOpen={ledgerOpen}
        setLedgerOpen={setLedgerOpen}
        ledgerForm={ledgerForm}
        setLedgerForm={setLedgerForm}
        ledgerError={ledgerError}
        onSubmit={actions.onAddLedger}
      />

      {/* History */}
      <HistoryPanel booking={booking} now={now} />
    </div>
  );
}

/* ── Payment ledger ──────────────────────────────────────────────────────── */

function PaymentLedger({
  booking,
  ledgerOpen,
  setLedgerOpen,
  ledgerForm,
  setLedgerForm,
  ledgerError,
  onSubmit,
}: {
  booking: Booking;
  ledgerOpen: boolean;
  setLedgerOpen: (v: boolean) => void;
  ledgerForm: { type: PaymentEntry["type"]; date: string; amountLkr: string; receiptNo: string; notes: string };
  setLedgerForm: (v: { type: PaymentEntry["type"]; date: string; amountLkr: string; receiptNo: string; notes: string }) => void;
  ledgerError: string;
  onSubmit: () => void;
}) {
  const totals = computePaymentTotals(booking.paymentEntries);
  const activeTotal = activeBookingTotalLkr(booking);
  const rejectedReduction = booking.totalAmountLkr - activeTotal;
  const amountDue = computeAmountDue(activeTotal, totals);
  const effectivePaid = effectivePaidLkr(booking);
  const balance = Math.max(0, amountDue - effectivePaid);
  const tone = paymentTone(booking);

  // Break out the per-bucket figures for display — computePaymentTotals only
  // exposes net cash and total deducted, but the ledger strip wants them split.
  let payments = 0;
  let refunds = 0;
  for (const entry of booking.paymentEntries) {
    if (entry.type === "payment") payments += entry.amountLkr;
    else if (entry.type === "refund") refunds += entry.amountLkr;
  }

  const tiles: Array<{ label: string; value: string; tone: "text" | "dim" | "ok" | "warn" | "danger" | "info" }> = [
    { label: "Invoice", value: fmtLkr(booking.totalAmountLkr), tone: "text" },
    ...(rejectedReduction > 0
      ? [{ label: "Less rejected slots", value: `− ${fmtLkr(rejectedReduction)}`, tone: "dim" as const }]
      : []),
    { label: "Less waiver / credit", value: `− ${fmtLkr(totals.totalDeducted)}`, tone: "dim" },
    { label: "Net owed", value: fmtLkr(amountDue), tone: "text" },
    { label: "Payments", value: fmtLkr(payments), tone: "ok" },
    { label: "Refunds", value: `− ${fmtLkr(refunds)}`, tone: refunds > 0 ? "danger" : "dim" },
    { label: "Balance", value: fmtLkr(balance), tone: tone === "paid" ? "ok" : tone === "overpaid" ? "info" : "danger" },
  ];

  const ledgerTypeOptions: Array<{ v: PaymentEntry["type"]; l: string; hint: string }> = [
    { v: "payment", l: "Payment", hint: "Customer paid us." },
    { v: "waiver", l: "Waiver", hint: "Amount written off — reduces what they owe." },
    { v: "credit_note", l: "Credit Note", hint: "Credit issued — reduces what they owe." },
    { v: "refund", l: "Refund", hint: "We returned money to the customer." },
  ];

  return (
    <section className="admin-bookings-ledger">
      <div className="admin-bookings-ledger-head">
        <SubHeading
          title="Payment ledger"
          accent={`· ${booking.paymentEntries.length} ${booking.paymentEntries.length === 1 ? "entry" : "entries"}`}
          meta={paymentLabel(tone).toUpperCase()}
        />
        <button
          className={`admin-bookings-ledger-add${ledgerOpen ? " is-open" : ""}`}
          type="button"
          onClick={() => setLedgerOpen(!ledgerOpen)}
        >
          {ledgerOpen ? "Cancel" : "+ Add entry"}
        </button>
      </div>

      <div className="admin-bookings-ledger-totals">
        {tiles.map((t) => (
          <div key={t.label}>
            <p className="ac-mono">{t.label}</p>
            <p className={`admin-bookings-ledger-totals-value tone-${t.tone}`}>{t.value}</p>
          </div>
        ))}
      </div>

      {ledgerOpen ? (
        <div className="admin-bookings-ledger-form">
          <p className="ac-mono admin-bookings-ledger-form-eyebrow">{"// NEW LEDGER ENTRY"}</p>
          <div className="admin-bookings-ledger-form-grid">
            <label>
              <span className="ac-mono">Type</span>
              <select
                value={ledgerForm.type}
                onChange={(e) =>
                  setLedgerForm({ ...ledgerForm, type: e.target.value as PaymentEntry["type"] })
                }
              >
                {ledgerTypeOptions.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
              <span className="admin-bookings-ledger-hint">{ledgerTypeOptions.find((o) => o.v === ledgerForm.type)?.hint}</span>
            </label>
            <label>
              <span className="ac-mono">Date</span>
              <input
                type="date"
                value={ledgerForm.date}
                onChange={(e) => setLedgerForm({ ...ledgerForm, date: e.target.value })}
              />
            </label>
            <label>
              <span className="ac-mono">Amount (LKR)</span>
              <input
                type="number"
                min="1"
                step="1"
                value={ledgerForm.amountLkr}
                onChange={(e) => setLedgerForm({ ...ledgerForm, amountLkr: e.target.value })}
                placeholder="0"
              />
            </label>
            <label>
              <span className="ac-mono">Receipt number</span>
              <input
                type="text"
                value={ledgerForm.receiptNo}
                onChange={(e) => setLedgerForm({ ...ledgerForm, receiptNo: e.target.value })}
                placeholder="RCT-26-..."
              />
            </label>
          </div>
          <label className="admin-bookings-ledger-form-notes">
            <span className="ac-mono">Notes · required</span>
            <textarea
              value={ledgerForm.notes}
              onChange={(e) => setLedgerForm({ ...ledgerForm, notes: e.target.value })}
              placeholder="e.g. Bank transfer received 19 May. Reference: SB-MAY24."
            />
          </label>
          {ledgerError ? <div className="admin-bookings-ledger-form-error">{ledgerError}</div> : null}
          <div className="admin-bookings-ledger-form-actions">
            <button className="admin-bookings-ledger-form-cancel" type="button" onClick={() => setLedgerOpen(false)}>
              Cancel
            </button>
            <button className="admin-bookings-ledger-form-submit" type="button" onClick={onSubmit}>
              Record entry
            </button>
          </div>
        </div>
      ) : null}

      {booking.paymentEntries.length > 0 ? (
        <table className="admin-bookings-ledger-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Receipt</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {booking.paymentEntries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.date}</td>
                <td className="admin-bookings-ledger-table-type">{entry.type.replace("_", " ")}</td>
                <td className={entry.type === "refund" ? "tone-danger" : entry.type === "payment" ? "tone-ok" : "tone-info"}>
                  {entry.type === "refund" ? "− " : ""}{fmtLkr(entry.amountLkr)}
                </td>
                <td className="ac-mono">{entry.receiptNo || "—"}</td>
                <td className="admin-bookings-ledger-table-notes">{entry.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="admin-bookings-ledger-empty">
          No ledger entries yet. Use <strong>+ Add entry</strong> to record a payment, waiver, credit note or refund.
        </p>
      )}
    </section>
  );
}

/* ── History timeline ────────────────────────────────────────────────────── */

const HISTORY_META: Record<HistoryEvent["action"], { label: string; glyph: string; tone: "ok" | "warn" | "danger" | "info" | "neutral" }> = {
  submitted: { label: "Submitted", glyph: "✱", tone: "neutral" },
  confirmed: { label: "Approved", glyph: "✓", tone: "ok" },
  tentative: { label: "Tentative", glyph: "?", tone: "info" },
  rejected: { label: "Rejected", glyph: "✕", tone: "danger" },
  "slot-rejected": { label: "Slot rejected", glyph: "✕", tone: "danger" },
  "slot-overridden": { label: "Slot overridden", glyph: "↪", tone: "warn" },
  payment: { label: "Payment", glyph: "$", tone: "ok" },
  refund: { label: "Refund", glyph: "↺", tone: "danger" },
  credit_note: { label: "Credit note", glyph: "₵", tone: "info" },
  waiver: { label: "Waiver", glyph: "•", tone: "warn" },
};

function HistoryPanel({ booking, now }: { booking: Booking; now: Date }) {
  const events = useMemo(() => deriveHistory(booking), [booking]);

  return (
    <section className="admin-bookings-history">
      <SubHeading
        title="History"
        accent={`· ${events.length} event${events.length === 1 ? "" : "s"}`}
        meta="Newest first · all times in Asia/Colombo"
      />

      <ol className="admin-bookings-history-list">
        {events.map((ev, idx) => {
          const meta = HISTORY_META[ev.action];
          return (
            <li key={`${ev.t}-${idx}`} className={`admin-bookings-history-event tone-${meta.tone}`}>
              <span className="admin-bookings-history-dot" aria-hidden>{meta.glyph}</span>
              <div>
                <div className="admin-bookings-history-head">
                  <span className="admin-bookings-history-label">{meta.label}</span>
                  <span className="ac-mono admin-bookings-history-time">
                    {fmtDateTime(ev.t)} · {relTime(ev.t, now)}
                  </span>
                </div>
                <div className="admin-bookings-history-meta">
                  <span className={`admin-bookings-history-who role-${ev.whoRole}`}>{ev.who}</span>
                  <span> · </span>
                  <span>{ev.note}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ── Small UI primitives ─────────────────────────────────────────────────── */

function StatusPill({ status, size = "md" }: { status: BookingStatus; size?: "sm" | "md" }) {
  return (
    <span className={`admin-bookings-status tone-${status} size-${size}`}>
      <span aria-hidden className="admin-bookings-status-dot" />
      {bookingStatusLabel(status)}
    </span>
  );
}

function PaymentTag({ tone, size = "md" }: { tone: ReturnType<typeof paymentTone>; size?: "sm" | "md" }) {
  return <span className={`admin-bookings-paytag tone-${tone} size-${size}`}>{paymentLabel(tone)}</span>;
}

const SLOT_CHIP_TONE: Record<SlotAllocation["status"], string> = {
  paid: "paid",
  part_paid: "part",
  unpaid: "unpaid",
  waived: "waived",
  rejected: "",
};

const SLOT_CHIP_LABEL: Record<SlotAllocation["status"], string> = {
  paid: "Paid",
  part_paid: "Part paid",
  unpaid: "Unpaid",
  waived: "Waived",
  rejected: "",
};

function SlotPriceCell({ allocation }: { allocation: SlotAllocation | undefined }) {
  if (!allocation) {
    return <div className="admin-bookings-slot-price" aria-hidden />;
  }
  const isRejected = allocation.status === "rejected";
  const covered = allocation.paidLkr + allocation.waiverLkr + allocation.creditNoteLkr;
  return (
    <div className="admin-bookings-slot-price">
      <div className={`admin-bookings-slot-price-amount${isRejected ? " is-struck" : ""}`}>
        {fmtLkr(allocation.amountLkr)}
      </div>
      {isRejected ? null : (
        <div className={`admin-bookings-slot-price-chip tone-${SLOT_CHIP_TONE[allocation.status]}`}>
          <span className="admin-bookings-slot-price-chip-label">{SLOT_CHIP_LABEL[allocation.status]}</span>
          {allocation.status !== "unpaid" ? (
            <span className="admin-bookings-slot-price-chip-amount ac-mono">
              {fmtLkr(covered)}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SubHeading({ title, accent, meta }: { title: string; accent?: string; meta?: string }) {
  return (
    <div className="admin-bookings-subheading">
      <div>
        <h3>
          {title}
          {accent ? <span className="admin-bookings-subheading-accent">{accent}</span> : null}
        </h3>
        <span aria-hidden className="admin-bookings-subheading-rule" />
      </div>
      {meta ? <span className="ac-mono admin-bookings-subheading-meta">{meta}</span> : null}
    </div>
  );
}

function SlotBtn({
  tone,
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  tone: "ok" | "info" | "danger";
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`admin-bookings-slot-btn tone-${tone}${active ? " is-active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      type="button"
    >
      {children}
    </button>
  );
}

function RejectModal({
  title,
  desc,
  value,
  onChange,
  onCancel,
  onConfirm,
}: {
  title: string;
  desc: string;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      className="admin-bookings-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <div className="admin-bookings-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3 className="admin-bookings-modal-title">{title}</h3>
        <p className="admin-bookings-modal-desc">{desc}</p>
        <label className="admin-bookings-modal-label">
          <span className="ac-mono">Reason · required</span>
          <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} rows={4} placeholder="e.g. Clashes with school priority slot — offered Thu 21 May 19:00 alternative." />
        </label>
        <div className="admin-bookings-modal-actions">
          <button className="admin-bookings-modal-cancel" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="admin-bookings-modal-confirm"
            type="button"
            disabled={!value.trim()}
            onClick={onConfirm}
          >
            Confirm rejection
          </button>
        </div>
      </div>
    </div>
  );
}
