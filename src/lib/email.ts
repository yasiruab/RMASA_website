import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import type { BookingStatus } from "@/lib/calendar-types";

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? process.env._AMPLIFY_RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM ?? process.env._AMPLIFY_RESEND_FROM ?? "onboarding@resend.dev";
const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL ?? process.env._AMPLIFY_ADMIN_NOTIFICATION_EMAIL ?? "";

// HTML-escape any user- or admin-supplied value before interpolating into an
// email body. Customer fields arrive from the public booking POST without any
// sanitisation, and the rendered HTML is also stored in EmailLog.htmlBody, so
// missing this would create a social-engineering vector in admin inboxes and
// a latent XSS sink if EmailLog is ever rendered in the admin UI.
function esc(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

function formatSlots(slots: Array<{ date: string; startTime: string; endTime: string }>): string {
  return slots
    .map((s) => `<li>${s.date} &nbsp;${s.startTime}–${s.endTime}</li>`)
    .join("\n");
}

function formatLkr(amount: number): string {
  return `LKR ${amount.toLocaleString("en-LK")}`;
}

type SlotWithStatus = { date: string; startTime: string; endTime: string; status: BookingStatus; rejectReason?: string };

function slotStatusLabel(status: BookingStatus): string {
  switch (status) {
    case "confirmed": return "✓ Confirmed";
    case "tentative": return "On Hold";
    case "rejected":
    case "cancelled_override": return "✗ Not Available";
    default: return status;
  }
}

function slotStatusColor(status: BookingStatus): string {
  switch (status) {
    case "confirmed": return "#2e7d32";
    case "tentative": return "#e65100";
    default: return "#c62828";
  }
}

function formatSlotsWithStatus(slots: SlotWithStatus[]): string {
  const hasReasons = slots.some((s) => s.rejectReason);
  const rows = slots.map((s) => `
    <tr style="border-top:1px solid #dfe3e8;">
      <td style="padding:6px 8px;font-size:13px;color:#31343a;">${s.date}</td>
      <td style="padding:6px 8px;font-size:13px;color:#31343a;">${s.startTime}–${s.endTime}</td>
      <td style="padding:6px 8px;font-size:13px;font-weight:600;color:${slotStatusColor(s.status)};">${slotStatusLabel(s.status)}</td>
      ${hasReasons ? `<td style="padding:6px 8px;font-size:13px;color:#6f737a;">${esc(s.rejectReason ?? "")}</td>` : ""}
    </tr>`).join("\n");
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr style="background:#f0f2f4;">
        <th style="padding:6px 8px;font-size:12px;text-align:left;color:#6f737a;font-weight:600;">Date</th>
        <th style="padding:6px 8px;font-size:12px;text-align:left;color:#6f737a;font-weight:600;">Time</th>
        <th style="padding:6px 8px;font-size:12px;text-align:left;color:#6f737a;font-weight:600;">Status</th>
        ${hasReasons ? '<th style="padding:6px 8px;font-size:12px;text-align:left;color:#6f737a;font-weight:600;">Reason</th>' : ""}
      </tr>
      ${rows}
    </table>`;
}

function paymentDeadline24h(): string {
  // Sri Lanka Standard Time is UTC+5:30
  const deadlineMs = Date.now() + 24 * 60 * 60 * 1000;
  const sriLanka = new Date(deadlineMs + (5 * 60 + 30) * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${sriLanka.getUTCFullYear()}-${pad(sriLanka.getUTCMonth() + 1)}-${pad(sriLanka.getUTCDate())} at ${pad(sriLanka.getUTCHours())}:${pad(sriLanka.getUTCMinutes())} (Sri Lanka Time)`;
}

function card(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Royal Masa Arena</title>
</head>
<body style="margin:0;padding:0;background:#eef0f2;font-family:'Lato','Helvetica Neue',Arial,sans-serif;color:#31343a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #dfe3e8;">
        <tr>
          <td style="background:#b26c5e;padding:20px 32px;">
            <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">Royal Masa Arena</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 32px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;background:#f7f8f9;border-top:1px solid #dfe3e8;">
            <p style="margin:0;font-size:12px;color:#6f737a;">
              Royal Masa Arena &bull; Colombo, Sri Lanka<br/>
              For enquiries contact us at <a href="mailto:info@royalmasarena.lk" style="color:#b26c5e;">info@royalmasarena.lk</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Internal send + log ───────────────────────────────────────────────────────

type EmailLogType =
  | "booking_acknowledgement"
  | "booking_status"
  | "admin_notification"
  | "unpaid_reminder_customer"
  | "unpaid_reminder_admin_digest";

async function sendEmail(params: {
  bookingReference: string;
  type: EmailLogType;
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  let status: "sent" | "failed" = "failed";
  let errorMessage: string | undefined;

  if (!resend) {
    errorMessage = "RESEND_API_KEY is not configured";
    console.error(`[email] ${errorMessage}`);
  } else {
    try {
      await resend.emails.send({
        from: FROM,
        to: params.to,
        subject: params.subject,
        html: params.html,
      });
      status = "sent";
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[email] Failed to send "${params.subject}" to ${params.to}:`, errorMessage);
    }
  }

  try {
    await prisma.emailLog.create({
      data: {
        bookingReference: params.bookingReference,
        type: params.type,
        toEmail: params.to,
        fromEmail: FROM,
        subject: params.subject,
        htmlBody: params.html,
        status,
        errorMessage: errorMessage ?? null,
      },
    });
  } catch (logErr) {
    console.error("[email] Failed to write EmailLog:", logErr);
  }

  return status === "sent";
}

// ─── Public send functions ─────────────────────────────────────────────────────

type SlotList = Array<{ date: string; startTime: string; endTime: string }>;

export async function sendBookingAcknowledgement(params: {
  to: string;
  customerName: string;
  reference: string;
  roomName: string;
  eventTypeName: string;
  slots: SlotList;
  totalAmountLkr: number;
}): Promise<void> {
  const subject = `Booking Request Received – ${esc(params.reference)}`;
  const html = card(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#31343a;">Hi ${esc(params.customerName)},</p>
    <p style="margin:0 0 20px;line-height:1.6;">
      Thank you for your booking request. We have received it and will review it shortly.
      You will receive another email once a decision has been made.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f9;border:1px solid #dfe3e8;border-radius:6px;padding:16px 20px;margin-bottom:20px;">
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;width:140px;">Reference</td><td style="padding:4px 0;font-size:13px;font-weight:700;color:#31343a;">${esc(params.reference)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Venue</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.roomName)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Event Type</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.eventTypeName)}</td></tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#6f737a;vertical-align:top;">Date(s) &amp; Time</td>
        <td style="padding:4px 0;font-size:13px;color:#31343a;"><ul style="margin:0;padding-left:16px;">${formatSlots(params.slots)}</ul></td>
      </tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Total Amount</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${formatLkr(params.totalAmountLkr)} <span style="color:#6f737a;">(indicative, pending confirmation)</span></td></tr>
    </table>
    <p style="margin:0;font-size:13px;color:#6f737a;line-height:1.6;">
      If you have any questions, please contact us at
      <a href="mailto:info@royalmasarena.lk" style="color:#b26c5e;">info@royalmasarena.lk</a>.
    </p>
  `);

  await sendEmail({ bookingReference: params.reference, type: "booking_acknowledgement", to: params.to, subject, html });
}

export async function sendBookingStatusNotification(params: {
  to: string;
  customerName: string;
  reference: string;
  roomName: string;
  eventTypeName: string;
  slots: SlotList;
  slotStatuses?: SlotWithStatus[]; // when provided, renders per-slot status table
  totalAmountLkr: number;
  newStatus: "confirmed" | "tentative" | "rejected" | "partial_update";
  rejectReason?: string; // included in rejection email body
}): Promise<void> {
  const { slotStatuses } = params;
  const hasRejectedAmongConfirmed =
    params.newStatus === "confirmed" &&
    slotStatuses != null &&
    slotStatuses.some((s) => s.status === "rejected" || s.status === "cancelled_override");
  const isPartial = hasRejectedAmongConfirmed || params.newStatus === "partial_update";
  const displayStatus = isPartial ? "confirmed" : params.newStatus;

  const slotTable = slotStatuses
    ? formatSlotsWithStatus(slotStatuses)
    : `<ul style="margin:0;padding-left:16px;">${formatSlots(params.slots)}</ul>`;

  const subject = isPartial
    ? `Booking Update – ${esc(params.reference)}`
    : params.newStatus === "confirmed"
    ? `Your Booking ${esc(params.reference)} is Confirmed`
    : params.newStatus === "tentative"
    ? `Your Booking ${esc(params.reference)} is On Hold`
    : `Update on Your Booking ${esc(params.reference)}`;

  const deadline = paymentDeadline24h();

  const confirmedIntro = isPartial
    ? `We have reviewed your booking request. Some of your requested slots have been updated. Please see the details below.`
    : `Great news! Your booking has been <strong style="color:#2e7d32;">confirmed</strong>.`;

  const rejectReasonBlock = params.rejectReason
    ? `<p style="margin:0 0 16px;font-size:13px;background:#fff3f3;border:1px solid #f5c6c6;border-radius:4px;padding:10px 14px;color:#c62828;">
        <strong>Reason:</strong> ${esc(params.rejectReason)}
       </p>`
    : "";

  const bodyMap: Record<string, string> = {
    confirmed: `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#31343a;">Hi ${esc(params.customerName)},</p>
      <p style="margin:0 0 20px;line-height:1.6;">${confirmedIntro}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f9;border:1px solid #dfe3e8;border-radius:6px;padding:16px 20px;margin-bottom:20px;">
        <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;width:140px;">Reference</td><td style="padding:4px 0;font-size:13px;font-weight:700;color:#31343a;">${esc(params.reference)}</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Venue</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.roomName)}</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Event Type</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.eventTypeName)}</td></tr>
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#6f737a;vertical-align:top;padding-right:12px;">Booking Slots</td>
          <td style="padding:4px 0;">${slotTable}</td>
        </tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Amount Due</td><td style="padding:4px 0;font-size:13px;font-weight:700;color:#b26c5e;">${formatLkr(params.totalAmountLkr)}</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Payment Due By</td><td style="padding:4px 0;font-size:13px;font-weight:600;color:#31343a;">${deadline}</td></tr>
      </table>
      <p style="margin:0 0 8px;font-size:13px;color:#31343a;font-weight:600;">Payment Instructions</p>
      <p style="margin:0;font-size:13px;color:#6f737a;line-height:1.6;">
        Please contact us at <a href="mailto:info@royalmasarena.lk" style="color:#b26c5e;">info@royalmasarena.lk</a>
        to arrange payment within 24 hours. Please quote your booking reference <strong>${esc(params.reference)}</strong> in all correspondence.
      </p>
    `,
    tentative: `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#31343a;">Hi ${esc(params.customerName)},</p>
      <p style="margin:0 0 20px;line-height:1.6;">
        Your booking <strong>${esc(params.reference)}</strong> is currently <strong style="color:#e65100;">on hold (tentative)</strong>.
        We are reviewing the details and will confirm or update you shortly.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f9;border:1px solid #dfe3e8;border-radius:6px;padding:16px 20px;margin-bottom:20px;">
        <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;width:140px;">Reference</td><td style="padding:4px 0;font-size:13px;font-weight:700;color:#31343a;">${esc(params.reference)}</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Venue</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.roomName)}</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Event Type</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.eventTypeName)}</td></tr>
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#6f737a;vertical-align:top;padding-right:12px;">Booking Slots</td>
          <td style="padding:4px 0;">${slotTable}</td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6f737a;line-height:1.6;">
        If you have any questions, contact us at
        <a href="mailto:info@royalmasarena.lk" style="color:#b26c5e;">info@royalmasarena.lk</a>.
      </p>
    `,
    rejected: `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#31343a;">Hi ${esc(params.customerName)},</p>
      <p style="margin:0 0 20px;line-height:1.6;">
        Thank you for your interest in Royal Masa Arena. Unfortunately, we are unable to accommodate
        your booking request <strong>${esc(params.reference)}</strong> at this time.
      </p>
      ${rejectReasonBlock}
      ${slotStatuses ? `<div style="margin-bottom:20px;">${slotTable}</div>` : ""}
      <p style="margin:0;font-size:13px;color:#6f737a;line-height:1.6;">
        If you would like to explore alternative dates or have any questions, please contact us at
        <a href="mailto:info@royalmasarena.lk" style="color:#b26c5e;">info@royalmasarena.lk</a>.
        We hope to welcome you to Royal Masa Arena on another occasion.
      </p>
    `,
    partial_update: `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#31343a;">Hi ${esc(params.customerName)},</p>
      <p style="margin:0 0 20px;line-height:1.6;">
        There has been an update to your booking <strong>${esc(params.reference)}</strong>.
        Some of your requested slots have been reviewed. Please see the details below.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f9;border:1px solid #dfe3e8;border-radius:6px;padding:16px 20px;margin-bottom:20px;">
        <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;width:140px;">Reference</td><td style="padding:4px 0;font-size:13px;font-weight:700;color:#31343a;">${esc(params.reference)}</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Venue</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.roomName)}</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Event Type</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.eventTypeName)}</td></tr>
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#6f737a;vertical-align:top;padding-right:12px;">Booking Slots</td>
          <td style="padding:4px 0;">${slotTable}</td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6f737a;line-height:1.6;">
        If you have any questions, contact us at
        <a href="mailto:info@royalmasarena.lk" style="color:#b26c5e;">info@royalmasarena.lk</a>.
      </p>
    `,
  };

  const html = card(bodyMap[displayStatus]);
  await sendEmail({ bookingReference: params.reference, type: "booking_status", to: params.to, subject, html });
}

export async function sendAdminNewBookingNotification(params: {
  reference: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  roomName: string;
  eventTypeName: string;
  slots: SlotList;
  totalAmountLkr: number;
}): Promise<void> {
  if (!ADMIN_EMAIL) return;

  const subject = `New Booking Request – ${esc(params.reference)}`;
  const adminPortalUrl = process.env.NEXTAUTH_URL ? `${process.env.NEXTAUTH_URL}/admin/calendar` : "/admin/calendar";
  const html = card(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#31343a;">New Booking Request</p>
    <p style="margin:0 0 20px;line-height:1.6;">
      A new booking has been submitted and is awaiting your review.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f9;border:1px solid #dfe3e8;border-radius:6px;padding:16px 20px;margin-bottom:20px;">
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;width:140px;">Reference</td><td style="padding:4px 0;font-size:13px;font-weight:700;color:#31343a;">${esc(params.reference)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Customer</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.customerName)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Email</td><td style="padding:4px 0;font-size:13px;color:#31343a;"><a href="mailto:${esc(params.customerEmail)}" style="color:#b26c5e;">${esc(params.customerEmail)}</a></td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Phone</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.customerPhone)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Venue</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.roomName)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Event Type</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.eventTypeName)}</td></tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#6f737a;vertical-align:top;">Date(s) &amp; Time</td>
        <td style="padding:4px 0;font-size:13px;color:#31343a;"><ul style="margin:0;padding-left:16px;">${formatSlots(params.slots)}</ul></td>
      </tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Total</td><td style="padding:4px 0;font-size:13px;font-weight:700;color:#31343a;">${formatLkr(params.totalAmountLkr)}</td></tr>
    </table>
    <a href="${adminPortalUrl}" style="display:inline-block;background:#b26c5e;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:5px;font-size:14px;font-weight:600;">
      View in Admin Portal
    </a>
  `);

  await sendEmail({ bookingReference: params.reference, type: "admin_notification", to: ADMIN_EMAIL, subject, html });
}

export async function sendAdminRejectionNotification(params: {
  reference: string;
  customerName: string;
  customerEmail: string;
  roomName: string;
  eventTypeName: string;
  slots: SlotList;
  rejectReason: string;
}): Promise<void> {
  if (!ADMIN_EMAIL) return;

  const subject = `Booking Rejected – ${esc(params.reference)}`;
  const html = card(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#c62828;">Booking Rejected</p>
    <p style="margin:0 0 20px;line-height:1.6;">
      A booking has been rejected. Details below.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f9;border:1px solid #dfe3e8;border-radius:6px;padding:16px 20px;margin-bottom:20px;">
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;width:140px;">Reference</td><td style="padding:4px 0;font-size:13px;font-weight:700;color:#31343a;">${esc(params.reference)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Customer</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.customerName)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Email</td><td style="padding:4px 0;font-size:13px;color:#31343a;"><a href="mailto:${esc(params.customerEmail)}" style="color:#b26c5e;">${esc(params.customerEmail)}</a></td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Venue</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.roomName)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Event Type</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.eventTypeName)}</td></tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#6f737a;vertical-align:top;">Date(s) &amp; Time</td>
        <td style="padding:4px 0;font-size:13px;color:#31343a;"><ul style="margin:0;padding-left:16px;">${formatSlots(params.slots)}</ul></td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#6f737a;vertical-align:top;">Reject Reason</td>
        <td style="padding:4px 0;font-size:13px;color:#c62828;font-style:italic;">${esc(params.rejectReason)}</td>
      </tr>
    </table>
  `);

  await sendEmail({ bookingReference: params.reference, type: "admin_notification", to: ADMIN_EMAIL, subject, html });
}

// ─── Unpaid-booking reminders ──────────────────────────────────────────────────

function overdueLabel(daysOverdue: number): string {
  if (daysOverdue <= 1) return "24 hours overdue";
  if (daysOverdue < 30) return "1 week overdue";
  if (daysOverdue < 60) return "1 month overdue";
  const months = Math.floor(daysOverdue / 30);
  return `${months} months overdue`;
}

export async function sendBookingUnpaidReminder(params: {
  to: string;
  customerName: string;
  reference: string;
  roomName: string;
  eventTypeName: string;
  slots: SlotList;
  totalAmountLkr: number;
  paidAmountLkr: number;
  /** Invoice total minus waivers + credit_notes. Caller must compute this via
   *  computeAmountDue() so waivers are reflected in the balance shown to the
   *  customer; without it, the email would dun customers for already-waived fees. */
  amountDueLkr: number;
  daysOverdue: number;
}): Promise<boolean> {
  const balance = Math.max(0, params.amountDueLkr - params.paidAmountLkr);
  const label = overdueLabel(params.daysOverdue);
  const subject = `Payment Reminder – ${esc(params.reference)} (${label})`;
  const html = card(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#31343a;">Hi ${esc(params.customerName)},</p>
    <p style="margin:0 0 20px;line-height:1.6;">
      Your booking <strong>${esc(params.reference)}</strong> has an outstanding balance of
      <strong style="color:#b26c5e;">${formatLkr(balance)}</strong>
      (paid ${formatLkr(params.paidAmountLkr)} of ${formatLkr(params.totalAmountLkr)}).
      This booking is currently <strong>${label}</strong>.
    </p>
    <p style="margin:0 0 20px;line-height:1.6;">
      Please settle the balance at your earliest convenience by replying to this email or
      contacting us at <a href="mailto:info@royalmasarena.lk" style="color:#b26c5e;">info@royalmasarena.lk</a>.
      Quote your booking reference <strong>${esc(params.reference)}</strong> in all correspondence.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f9;border:1px solid #dfe3e8;border-radius:6px;padding:16px 20px;margin-bottom:20px;">
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;width:140px;">Reference</td><td style="padding:4px 0;font-size:13px;font-weight:700;color:#31343a;">${esc(params.reference)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Venue</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.roomName)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Event Type</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${esc(params.eventTypeName)}</td></tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#6f737a;vertical-align:top;">Date(s) &amp; Time</td>
        <td style="padding:4px 0;font-size:13px;color:#31343a;"><ul style="margin:0;padding-left:16px;">${formatSlots(params.slots)}</ul></td>
      </tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Total Amount</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${formatLkr(params.totalAmountLkr)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Paid To Date</td><td style="padding:4px 0;font-size:13px;color:#31343a;">${formatLkr(params.paidAmountLkr)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#6f737a;">Balance Due</td><td style="padding:4px 0;font-size:13px;font-weight:700;color:#b26c5e;">${formatLkr(balance)}</td></tr>
    </table>
    <p style="margin:0;font-size:13px;color:#6f737a;line-height:1.6;">
      If you have already paid, please disregard this reminder.
    </p>
  `);

  return sendEmail({
    bookingReference: params.reference,
    type: "unpaid_reminder_customer",
    to: params.to,
    subject,
    html,
  });
}

export async function sendAdminUnpaidDigest(params: {
  runDate: string;
  bookings: Array<{
    reference: string;
    customerName: string;
    customerEmail: string;
    roomName: string;
    confirmedAt: string;
    daysOverdue: number;
    balanceLkr: number;
  }>;
}): Promise<boolean> {
  if (!ADMIN_EMAIL) return false;
  if (params.bookings.length === 0) return false;

  const adminPortalUrl = process.env.NEXTAUTH_URL
    ? `${process.env.NEXTAUTH_URL}/admin/calendar`
    : "/admin/calendar";

  const rows = params.bookings
    .map(
      (b) => `
    <tr style="border-top:1px solid #dfe3e8;">
      <td style="padding:6px 8px;font-size:13px;font-weight:700;color:#31343a;">${esc(b.reference)}</td>
      <td style="padding:6px 8px;font-size:13px;color:#31343a;">${esc(b.customerName)}<br/><span style="color:#6f737a;font-size:12px;">${esc(b.customerEmail)}</span></td>
      <td style="padding:6px 8px;font-size:13px;color:#31343a;">${esc(b.roomName)}</td>
      <td style="padding:6px 8px;font-size:13px;color:#31343a;">${esc(b.confirmedAt)}</td>
      <td style="padding:6px 8px;font-size:13px;color:#31343a;">${b.daysOverdue}</td>
      <td style="padding:6px 8px;font-size:13px;font-weight:600;color:#b26c5e;">${formatLkr(b.balanceLkr)}</td>
    </tr>`,
    )
    .join("\n");

  const subject = `Unpaid Booking Reminders – ${params.bookings.length} bookings – ${esc(params.runDate)}`;
  const html = card(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#31343a;">Unpaid Booking Reminders</p>
    <p style="margin:0 0 20px;line-height:1.6;">
      The following ${params.bookings.length} booking(s) hit a reminder milestone today and had a customer reminder dispatched.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
      <tr style="background:#f0f2f4;">
        <th style="padding:6px 8px;font-size:12px;text-align:left;color:#6f737a;font-weight:600;">Reference</th>
        <th style="padding:6px 8px;font-size:12px;text-align:left;color:#6f737a;font-weight:600;">Customer</th>
        <th style="padding:6px 8px;font-size:12px;text-align:left;color:#6f737a;font-weight:600;">Venue</th>
        <th style="padding:6px 8px;font-size:12px;text-align:left;color:#6f737a;font-weight:600;">Confirmed</th>
        <th style="padding:6px 8px;font-size:12px;text-align:left;color:#6f737a;font-weight:600;">Days Overdue</th>
        <th style="padding:6px 8px;font-size:12px;text-align:left;color:#6f737a;font-weight:600;">Balance</th>
      </tr>
      ${rows}
    </table>
    <a href="${adminPortalUrl}" style="display:inline-block;background:#b26c5e;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:5px;font-size:14px;font-weight:600;">
      Open Admin Portal
    </a>
  `);

  return sendEmail({
    bookingReference: "DIGEST",
    type: "unpaid_reminder_admin_digest",
    to: ADMIN_EMAIL,
    subject,
    html,
  });
}
