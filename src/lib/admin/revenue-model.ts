// Revenue model builder for the admin dashboard / revenue page.
// Extracted from admin-calendar-console.tsx — pure function, no side effects.

import { computeAmountDue, computePaymentTotals } from "@/lib/payments";
import type {
  AcMode,
  BookingStatus,
  DayType,
  PaymentEntry,
  ReconciliationStatus,
} from "@/lib/calendar-types";
import {
  activeBookingTotalLkr,
  computeBookingEffectiveStatus,
  effectivePaidLkr,
} from "@/lib/admin/booking-utils";
import {
  addDays,
  inDateRange,
  monthKey,
  monthLabel,
  startOfMonth,
  toYmd,
  ymdToDate,
} from "@/lib/admin/date-utils";

export type RevenueRangePreset = "last_30_days" | "last_90_days" | "current_month";

export type RevenueFilters = {
  rangePreset: RevenueRangePreset;
  roomTypeId: string;
  eventTypeId: string;
  acMode: "all" | AcMode;
};

export type RevenueBucket = {
  key: string;
  label: string;
  recognizedLkr: number;
  collectedLkr: number;
  receivableLkr: number;
};

export type BreakdownRow = {
  key: string;
  amountLkr: number;
};

export type CollectionsRow = {
  id: string;
  reference: string;
  customerName: string;
  totalAmountLkr: number;
  paidAmountLkr: number;
  outstandingLkr: number;
  reconciliationStatus: ReconciliationStatus;
  ageDays: number;
};

export type RefundRow = {
  id: string;
  customerName: string;
  totalAmountLkr: number;
  paidAmountLkr: number;
  reconciliationStatus: ReconciliationStatus;
};

// Minimal Booking shape required by the revenue model. Generic so both the
// canonical Booking and any admin-local shape are accepted.
type BookingForRevenue = {
  id: string;
  reference: string;
  roomTypeId: string;
  eventTypeId: string;
  acMode: AcMode;
  status: BookingStatus;
  totalAmountLkr: number;
  paidAmountLkr: number;
  reconciliationStatus: ReconciliationStatus;
  paymentEntries: Array<Pick<PaymentEntry, "type" | "amountLkr">>;
  customer: { name: string };
  slots: Array<{ date: string; startTime: string; endTime: string; slotStatus?: BookingStatus }>;
  amountBreakdown: Array<{ date: string; slot: string; amountLkr: number; dayType: DayType | string }>;
  createdAt: string;
};

export function buildRevenueModel<B extends BookingForRevenue>(
  sourceBookings: B[],
  startYmd: string,
  endYmd: string,
) {
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
    const effectiveStatus = computeBookingEffectiveStatus(booking);

    if (effectiveStatus === "cancelled_override") {
      cancelledOverrideValueLkr += booking.totalAmountLkr;
      continue;
    }

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

    confirmedCount += 1;
    recognizedRevenueLkr += booking.totalAmountLkr;
    collectedRevenueLkr += paid;

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

    recognizedByRoom.set(booking.roomTypeId, (recognizedByRoom.get(booking.roomTypeId) ?? 0) + booking.totalAmountLkr);
    recognizedByEvent.set(booking.eventTypeId, (recognizedByEvent.get(booking.eventTypeId) ?? 0) + booking.totalAmountLkr);
    recognizedByAcMode.set(booking.acMode, (recognizedByAcMode.get(booking.acMode) ?? 0) + booking.totalAmountLkr);
    for (const item of booking.amountBreakdown) {
      if (item.dayType === "weekend") weekendRevenueLkr += item.amountLkr;
      else weekdayRevenueLkr += item.amountLkr;
    }

    // Trend bucketing: attribute the full booking to its createdAt month
    // (cohort view — matches buildRevenueInsightsModel).
    const bookingCreatedYmd = (booking.createdAt || "").slice(0, 10);
    if (inDateRange(bookingCreatedYmd, startYmd, endYmd)) {
      const bKey = monthKey(bookingCreatedYmd);
      const bucket = trendMap.get(bKey);
      if (bucket) {
        bucket.recognizedLkr += booking.totalAmountLkr;
        bucket.collectedLkr += paid;
        if (outstanding > 0 && booking.reconciliationStatus !== "waived") {
          bucket.receivableLkr += outstanding;
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

export type RevenueModel = ReturnType<typeof buildRevenueModel>;

// ---------------------------------------------------------------------------
// Revenue Insights model (new redesigned page)
// ---------------------------------------------------------------------------

export type RevenueGranularity = "daily" | "weekly" | "monthly";

export type RevenueInsightsRangePreset =
  | "last_30_days"
  | "last_60_days"
  | "last_90_days"
  | "calendar_year"
  | "last_12_months"
  | "last_24_months";

export type RevenueInsightsBreakdownBy = "venue" | "event_type";

export type RevenueInsightsFilters = {
  rangePreset: RevenueInsightsRangePreset;
  granularity: RevenueGranularity;
  breakdownBy: RevenueInsightsBreakdownBy;
};

export type RevenuePeriodBucket = {
  key: string;       // canonical bucket key (YYYY-MM-DD for daily/weekly, YYYY-MM for monthly)
  label: string;     // axis label
  invoicedLkr: number;
  collectedLkr: number;
  waiverLkr: number;
  creditNoteLkr: number;
  adjustmentsLkr: number;
  netRevenueLkr: number;
  collectionRatePct: number;
  bySegmentLkr: Record<string, number>; // collected per segment (venue or event type)
};

export type RevenueInsightsTotals = {
  invoicedLkr: number;
  collectedLkr: number;
  receivableLkr: number;
  adjustmentsLkr: number;
  waiverLkr: number;
  creditNoteLkr: number;
  netRevenueLkr: number;
  collectionRatePct: number;
};

export type RevenueSegment = {
  key: string;
  label: string;
  totalLkr: number;
};

export type RevenueInsightsRange = {
  startYmd: string;
  endYmd: string;
  prevStartYmd: string;
  prevEndYmd: string;
};

export type RevenueInsightsModel = {
  filters: RevenueInsightsFilters;
  range: RevenueInsightsRange;
  totals: RevenueInsightsTotals;
  prevTotals: RevenueInsightsTotals;
  netRevenueDeltaPct: number | null;
  buckets: RevenuePeriodBucket[];
  segments: RevenueSegment[];
  maxBucketStackLkr: number;
  maxBucketAdjustmentLkr: number;
};

// --- Range + bucket helpers --------------------------------------------------

export function resolveInsightsRange(
  preset: RevenueInsightsRangePreset,
  today: Date,
): RevenueInsightsRange {
  const todayYmd = toYmd(today);

  let startYmd: string;
  let endYmd: string;
  if (preset === "last_30_days") {
    startYmd = toYmd(addDays(today, -29));
    endYmd = todayYmd;
  } else if (preset === "last_60_days") {
    startYmd = toYmd(addDays(today, -59));
    endYmd = todayYmd;
  } else if (preset === "last_90_days") {
    startYmd = toYmd(addDays(today, -89));
    endYmd = todayYmd;
  } else if (preset === "calendar_year") {
    const y = today.getFullYear();
    startYmd = toYmd(new Date(y, 0, 1));
    endYmd = toYmd(new Date(y, 11, 31));
  } else if (preset === "last_12_months") {
    const start = startOfMonth(today);
    start.setMonth(start.getMonth() - 11);
    startYmd = toYmd(start);
    endYmd = todayYmd;
  } else {
    const start = startOfMonth(today);
    start.setMonth(start.getMonth() - 23);
    startYmd = toYmd(start);
    endYmd = todayYmd;
  }

  const start = ymdToDate(startYmd);
  const end = ymdToDate(endYmd);
  const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));

  return {
    startYmd,
    endYmd,
    prevStartYmd: toYmd(prevStart),
    prevEndYmd: toYmd(prevEnd),
  };
}

function startOfIsoWeek(date: Date): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day; // shift Sunday back, Mon=0
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function bucketKeyFor(ymd: string, granularity: RevenueGranularity): string {
  if (granularity === "monthly") return monthKey(ymd);
  if (granularity === "weekly") return toYmd(startOfIsoWeek(ymdToDate(ymd)));
  return ymd;
}

function bucketLabelFor(key: string, granularity: RevenueGranularity): string {
  if (granularity === "monthly") return monthLabel(key);
  const d = ymdToDate(key);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildBucketSkeleton(
  startYmd: string,
  endYmd: string,
  granularity: RevenueGranularity,
): RevenuePeriodBucket[] {
  const seen = new Map<string, RevenuePeriodBucket>();
  const order: string[] = [];

  const start = ymdToDate(startYmd);
  const end = ymdToDate(endYmd);

  if (granularity === "monthly") {
    const cursor = startOfMonth(start);
    const stop = startOfMonth(end);
    while (cursor <= stop) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      if (!seen.has(key)) {
        order.push(key);
        seen.set(key, emptyBucket(key, bucketLabelFor(key, granularity)));
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else if (granularity === "weekly") {
    const cursor = startOfIsoWeek(start);
    while (cursor <= end) {
      const key = toYmd(cursor);
      if (!seen.has(key)) {
        order.push(key);
        seen.set(key, emptyBucket(key, bucketLabelFor(key, granularity)));
      }
      cursor.setDate(cursor.getDate() + 7);
    }
  } else {
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = toYmd(cursor);
      if (!seen.has(key)) {
        order.push(key);
        seen.set(key, emptyBucket(key, bucketLabelFor(key, granularity)));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return order.map((k) => seen.get(k) as RevenuePeriodBucket);
}

function emptyBucket(key: string, label: string): RevenuePeriodBucket {
  return {
    key,
    label,
    invoicedLkr: 0,
    collectedLkr: 0,
    waiverLkr: 0,
    creditNoteLkr: 0,
    adjustmentsLkr: 0,
    netRevenueLkr: 0,
    collectionRatePct: 0,
    bySegmentLkr: {},
  };
}

// --- Insights model ----------------------------------------------------------

// The insights model needs `date` on payment entries (for bucket attribution),
// which BookingForRevenue's Pick<"type" | "amountLkr"> doesn't include.
type BookingForInsights = Omit<BookingForRevenue, "paymentEntries"> & {
  paymentEntries: Array<Pick<PaymentEntry, "type" | "amountLkr" | "date">>;
};

type SegmentLookup = { id: string; name: string };

function emptyTotals(): RevenueInsightsTotals {
  return {
    invoicedLkr: 0,
    collectedLkr: 0,
    receivableLkr: 0,
    adjustmentsLkr: 0,
    waiverLkr: 0,
    creditNoteLkr: 0,
    netRevenueLkr: 0,
    collectionRatePct: 0,
  };
}

function aggregateBookings<B extends BookingForInsights>(
  bookings: B[],
  startYmd: string,
  endYmd: string,
  breakdownBy: RevenueInsightsBreakdownBy,
  granularity: RevenueGranularity,
  bucketMap: Map<string, RevenuePeriodBucket>,
  segmentTotals: Map<string, number>,
): RevenueInsightsTotals {
  const totals = emptyTotals();

  for (const booking of bookings) {
    const effective = computeBookingEffectiveStatus(booking);

    // Cohort attribution: everything for this booking (Invoiced + Collected +
    // Adjustments) is bucketed by booking.createdAt. Reflects the business
    // semantic "for month M, what was booked in M and how much have customers
    // paid for those bookings (regardless of slot or payment date)?".
    const bookingCreatedYmd = (booking.createdAt || "").slice(0, 10);
    if (!inDateRange(bookingCreatedYmd, startYmd, endYmd)) continue;

    const bKey = bucketKeyFor(bookingCreatedYmd, granularity);
    let bucket = bucketMap.get(bKey);
    if (!bucket) {
      bucket = emptyBucket(bKey, bucketLabelFor(bKey, granularity));
      bucketMap.set(bKey, bucket);
    }
    const segmentKey = breakdownBy === "venue" ? booking.roomTypeId : booking.eventTypeId;

    // Invoiced: sum of active slot amounts (rejected/cancelled slots skipped).
    if (effective === "confirmed" || effective === "tentative" || effective === "pending") {
      let invoicedForBooking = 0;
      for (const item of booking.amountBreakdown) {
        const slot = booking.slots.find(
          (s) => s.date === item.date && `${s.startTime}-${s.endTime}` === item.slot,
        );
        const slotEff = slot?.slotStatus ?? booking.status;
        if (slotEff === "rejected" || slotEff === "cancelled_override") continue;
        invoicedForBooking += item.amountLkr;
      }
      bucket.invoicedLkr += invoicedForBooking;
      totals.invoicedLkr += invoicedForBooking;
    }

    // Collected / Adjustments: every payment entry on this booking, regardless
    // of its own .date — attributed to the booking's createdAt cohort.
    for (const entry of booking.paymentEntries) {
      if (entry.type === "payment") {
        bucket.collectedLkr += entry.amountLkr;
        bucket.bySegmentLkr[segmentKey] = (bucket.bySegmentLkr[segmentKey] ?? 0) + entry.amountLkr;
        segmentTotals.set(segmentKey, (segmentTotals.get(segmentKey) ?? 0) + entry.amountLkr);
        totals.collectedLkr += entry.amountLkr;
      } else if (entry.type === "refund") {
        bucket.collectedLkr -= entry.amountLkr;
        bucket.bySegmentLkr[segmentKey] = (bucket.bySegmentLkr[segmentKey] ?? 0) - entry.amountLkr;
        segmentTotals.set(segmentKey, (segmentTotals.get(segmentKey) ?? 0) - entry.amountLkr);
        totals.collectedLkr -= entry.amountLkr;
      } else if (entry.type === "waiver") {
        bucket.waiverLkr += entry.amountLkr;
        bucket.adjustmentsLkr += entry.amountLkr;
        totals.waiverLkr += entry.amountLkr;
        totals.adjustmentsLkr += entry.amountLkr;
      } else if (entry.type === "credit_note") {
        bucket.creditNoteLkr += entry.amountLkr;
        bucket.adjustmentsLkr += entry.amountLkr;
        totals.creditNoteLkr += entry.amountLkr;
        totals.adjustmentsLkr += entry.amountLkr;
      }
    }
  }

  totals.netRevenueLkr = totals.invoicedLkr - totals.adjustmentsLkr;
  const denom = totals.invoicedLkr - totals.adjustmentsLkr;
  totals.collectionRatePct = denom > 0 ? totals.collectedLkr / denom : 0;
  return totals;
}

function computeReceivable<B extends BookingForInsights>(bookings: B[]): number {
  let receivable = 0;
  for (const booking of bookings) {
    const effective = computeBookingEffectiveStatus(booking);
    if (effective !== "confirmed" && effective !== "tentative" && effective !== "pending") continue;
    const activeTotal = activeBookingTotalLkr(booking);
    const totals = computePaymentTotals(booking.paymentEntries);
    const amountDue = computeAmountDue(activeTotal, totals);
    const paid = effectivePaidLkr(booking);
    const outstanding = Math.max(0, amountDue - paid);
    receivable += outstanding;
  }
  return receivable;
}

export function buildRevenueInsightsModel<B extends BookingForInsights>(
  bookings: B[],
  filters: RevenueInsightsFilters,
  today: Date,
  segmentLookup: { rooms: SegmentLookup[]; eventTypes: SegmentLookup[] },
): RevenueInsightsModel {
  const range = resolveInsightsRange(filters.rangePreset, today);

  // Build skeleton so empty periods still render as 0-height bars
  const skeletonBuckets = buildBucketSkeleton(range.startYmd, range.endYmd, filters.granularity);
  const bucketMap = new Map<string, RevenuePeriodBucket>(skeletonBuckets.map((b) => [b.key, b]));
  const segmentTotals = new Map<string, number>();

  const totals = aggregateBookings(
    bookings,
    range.startYmd,
    range.endYmd,
    filters.breakdownBy,
    filters.granularity,
    bucketMap,
    segmentTotals,
  );

  // Receivable is "as of today", not range-bound
  totals.receivableLkr = computeReceivable(bookings);

  // Prev-period totals (no buckets needed)
  const prevBucketMap = new Map<string, RevenuePeriodBucket>();
  const prevSegmentTotals = new Map<string, number>();
  const prevTotals = aggregateBookings(
    bookings,
    range.prevStartYmd,
    range.prevEndYmd,
    filters.breakdownBy,
    filters.granularity,
    prevBucketMap,
    prevSegmentTotals,
  );

  // Finalise per-bucket derived numbers
  for (const bucket of bucketMap.values()) {
    bucket.netRevenueLkr = bucket.invoicedLkr - bucket.adjustmentsLkr;
    const denom = bucket.invoicedLkr - bucket.adjustmentsLkr;
    bucket.collectionRatePct = denom > 0 ? bucket.collectedLkr / denom : 0;
  }

  const buckets = skeletonBuckets.map((b) => bucketMap.get(b.key) as RevenuePeriodBucket);

  // Resolve segment names from lookup
  const lookupMap = new Map<string, string>();
  for (const r of segmentLookup.rooms) lookupMap.set(r.id, r.name);
  for (const e of segmentLookup.eventTypes) lookupMap.set(e.id, e.name);
  const segments: RevenueSegment[] = [...segmentTotals.entries()]
    .map(([key, totalLkr]) => ({ key, label: lookupMap.get(key) ?? key, totalLkr }))
    .sort((a, b) => b.totalLkr - a.totalLkr);

  const maxBucketStackLkr = Math.max(
    1,
    ...buckets.map((b) => Object.values(b.bySegmentLkr).reduce((sum, v) => sum + Math.max(0, v), 0)),
  );
  const maxBucketAdjustmentLkr = Math.max(1, ...buckets.map((b) => b.adjustmentsLkr));

  const netRevenueDeltaPct =
    prevTotals.netRevenueLkr > 0
      ? (totals.netRevenueLkr - prevTotals.netRevenueLkr) / prevTotals.netRevenueLkr
      : null;

  return {
    filters,
    range,
    totals,
    prevTotals,
    netRevenueDeltaPct,
    buckets,
    segments,
    maxBucketStackLkr,
    maxBucketAdjustmentLkr,
  };
}
