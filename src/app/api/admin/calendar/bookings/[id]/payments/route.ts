import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth-guards";
import {
  computeAmountDue,
  computePaymentTotals,
  deriveReconciliationStatus,
  MAX_PAYMENT_ENTRY_LKR,
  parsePaymentAmount,
} from "@/lib/payments";

const VALID_TYPES = ["payment", "refund", "credit_note", "waiver"] as const;
type EntryType = (typeof VALID_TYPES)[number];

function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00");
  return !isNaN(d.getTime());
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const { id: bookingId } = await params;
  const body = await req.json() as Record<string, unknown>;

  const type = String(body.type ?? "") as EntryType;
  const date = String(body.date ?? "").trim();
  const amountLkr = parsePaymentAmount(body.amountLkr);
  const receiptNo = String(body.receiptNo ?? "").trim();
  const notes = String(body.notes ?? "").trim();

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { message: "Invalid type. Must be payment, refund, credit_note, or waiver." },
      { status: 400 },
    );
  }
  if (!isValidYmd(date)) {
    return NextResponse.json(
      { message: "Invalid date. Use YYYY-MM-DD format." },
      { status: 400 },
    );
  }
  if (amountLkr === null) {
    return NextResponse.json(
      { message: `amountLkr must be a positive whole number up to ${MAX_PAYMENT_ENTRY_LKR}.` },
      { status: 400 },
    );
  }
  if (!notes) {
    return NextResponse.json({ message: "Notes are required." }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Lock the booking row for the rest of the transaction. Without it, two
    // admins posting entries at the same moment (READ COMMITTED) each read the
    // ledger without the other's new entry, and the last write of the cached
    // paidAmountLkr / reconciliationStatus silently drops one of them.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE
    `;
    if (locked.length === 0) return null;

    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { paymentEntries: true },
    });
    if (!booking) return null;

    const entry = await tx.paymentEntry.create({
      data: {
        bookingId,
        type,
        date,
        amountLkr,
        receiptNo,
        notes,
        createdBy: auth.actor.email ?? "unknown",
      },
    });

    // Two streams, not one: cash collected (payment − refund) and amount due
    // (total − waiver − credit_note). Waivers reduce what's owed, not what's
    // been paid, so a fully-paid booking that later receives a fee waiver
    // stays "paid" rather than flipping to "part_paid".
    const totals = computePaymentTotals([...booking.paymentEntries, entry]);
    const amountDue = computeAmountDue(booking.totalAmountLkr, totals);
    const paidAmountLkr = Math.max(0, totals.netCash);
    const reconciliationStatus = deriveReconciliationStatus(paidAmountLkr, amountDue);

    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: { paidAmountLkr, reconciliationStatus, updatedAt: new Date() },
    });

    return {
      entry,
      paidAmountLkr: updated.paidAmountLkr,
      reconciliationStatus: updated.reconciliationStatus,
    };
  });

  if (!result) {
    return NextResponse.json({ message: "Booking not found." }, { status: 404 });
  }

  await logAuditEvent({
    actorUserId: auth.actor.userId,
    actorEmail: auth.actor.email,
    action: "ADMIN_PAYMENT_ENTRY_ADDED",
    resourceType: "booking",
    resourceId: bookingId,
    meta: { type, date, amountLkr, receiptNo, notes },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({
    message: "Payment entry added.",
    entry: result.entry,
    booking: {
      paidAmountLkr: result.paidAmountLkr,
      reconciliationStatus: result.reconciliationStatus,
    },
  });
}
