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
  computeBookingEffectiveStatus,
  effectivePaidLkr,
} from "@/lib/admin/booking-utils";
import {
  inDateRange,
  monthKey,
  monthLabel,
  startOfMonth,
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

export type RevenueModel = ReturnType<typeof buildRevenueModel>;
