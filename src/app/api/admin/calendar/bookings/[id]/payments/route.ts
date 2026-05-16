import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth-guards";

const VALID_TYPES = ["payment", "refund", "credit_note"] as const;
type EntryType = (typeof VALID_TYPES)[number];

function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00");
  return !isNaN(d.getTime());
}

function deriveReconciliationStatus(net: number, total: number) {
  if (net <= 0) return "unpaid" as const;
  if (net >= total) return "paid" as const;
  return "part_paid" as const;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const { id: bookingId } = await params;
  const body = await req.json() as Record<string, unknown>;

  const type = String(body.type ?? "") as EntryType;
  const date = String(body.date ?? "").trim();
  const amountLkr = Math.floor(Number(body.amountLkr));
  const receiptNo = String(body.receiptNo ?? "").trim();
  const notes = String(body.notes ?? "").trim();

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { message: "Invalid type. Must be payment, refund, or credit_note." },
      { status: 400 },
    );
  }
  if (!isValidYmd(date)) {
    return NextResponse.json(
      { message: "Invalid date. Use YYYY-MM-DD format." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(amountLkr) || amountLkr <= 0) {
    return NextResponse.json(
      { message: "amountLkr must be a positive whole number." },
      { status: 400 },
    );
  }
  if (!notes) {
    return NextResponse.json({ message: "Notes are required." }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
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

    const net = [...booking.paymentEntries, entry].reduce(
      (sum, e) => (e.type === "payment" ? sum + e.amountLkr : sum - e.amountLkr),
      0,
    );
    const clamped = Math.max(0, net);
    const reconciliationStatus = deriveReconciliationStatus(clamped, booking.totalAmountLkr);

    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: { paidAmountLkr: clamped, reconciliationStatus, updatedAt: new Date() },
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
