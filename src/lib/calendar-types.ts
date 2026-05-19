export type PaymentEntryType = "payment" | "refund" | "credit_note" | "waiver";

export type PaymentEntry = {
  id: number;
  bookingId: string;
  type: PaymentEntryType;
  date: string;        // YYYY-MM-DD (admin-supplied)
  amountLkr: number;  // always positive; direction from type
  receiptNo: string;
  notes: string;
  createdAt: string;  // ISO string
  createdBy: string;  // admin email
};

export type AcMode = "with_ac" | "without_ac";
export type DayType = "weekday" | "weekend" | "any";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "tentative"
  | "rejected"
  | "cancelled_override";

export type ReconciliationStatus = "unpaid" | "part_paid" | "paid" | "waived";

export type RoomType = {
  id: string;
  name: string;
  workingHours: {
    startTime: string; // HH:mm
    endTime: string; // HH:mm
  };
  capacity?: number;
  description?: string;
};

export type EventType = {
  id: string;
  name: string;
  durationMinutes: number;
  cleanupDurationMinutes: number;
  maxAdvanceBookingDays: number;
  priority: number;
  roomTypeId?: string; // optional: when set, event type is restricted to that room
};

export type PricingRule = {
  id: string;
  roomTypeId: string;
  eventTypeId: string;
  acMode: AcMode;
  dayType: DayType;
  amountLkr: number;
};

export type BookingSlot = {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  slotStatus?: BookingStatus; // per-slot override; inherits booking status if absent
  rejectReason?: string;
};

export type Recurrence = {
  frequency: "none" | "daily" | "weekly" | "monthly";
  endDate?: string;
  occurrences?: number;
};

export type BookingCustomer = {
  name: string;
  email: string;
  phone: string;
  purpose: string;
};

export type Booking = {
  id: string;
  reference: string;   // BK-XXXXXX human-readable ID
  roomTypeId: string;
  eventTypeId: string;
  acMode: AcMode;
  status: BookingStatus;
  cleanupDurationMinutes: number;
  slots: BookingSlot[];
  customer: BookingCustomer;
  recurrence: Recurrence;
  totalAmountLkr: number;
  paidAmountLkr: number;
  amountBreakdown: Array<{
    date: string;
    slot: string;
    amountLkr: number;
    dayType: DayType;
  }>;
  reconciliationStatus: ReconciliationStatus;
  reconciliationNotes: string;
  rejectReason?: string;
  paymentEntries: PaymentEntry[];
  confirmedAt?: string;
  lastReminderDays?: number;
  createdAt: string;
  updatedAt: string;
  overriddenBookingIds: string[];
};

export type CalendarBlock = {
  id: string;
  roomTypeId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  createdAt: string;
};

export type CalendarDb = {
  rooms: RoomType[];
  eventTypes: EventType[];
  pricingRules: PricingRule[];
  bookings: Booking[];
  blocks: CalendarBlock[];
};

export type SlotStatus = "available" | "pending" | "confirmed" | "tentative" | "blocked" | "cleanup";

export type SlotAvailability = {
  date: string;
  startTime: string;
  endTime: string;
  status: SlotStatus;
  bookingId?: string;
  bookingStartTime?: string;
  bookingEndTime?: string;
  reason?: string;
};
