"use client";

import { useState } from "react";
import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";

type SlotRow = {
  slotDate: string;
  startTime: string;
  endTime: string;
  slotEffectiveStatus: string;
  rejectReason?: string;
  bookingReference: string;
  bookingId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerPurpose: string;
  roomName: string;
  eventTypeName: string;
  acMode: "with_ac" | "without_ac";
  bookingCreatedAt: string;
  slotAmountLkr: number;
  slotPaidLkr: number;
  slotWaiverLkr: number;
  slotCreditNoteLkr: number;
  slotBalanceLkr: number;
  slotPaymentStatus: "paid" | "part_paid" | "unpaid" | "waived";
  bookingTotalAmountLkr: number;
  bookingPaidAmountLkr: number;
  reconciliationStatus: string;
  paymentEntries: Array<{ type: string; date: string; amountLkr: number; receiptNo: string; notes: string }>;
};

function toYmd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-LK").format(Math.round(n));
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending: "Pending", confirmed: "Confirmed", tentative: "Tentative",
    rejected: "Rejected", cancelled_override: "Cancelled",
  };
  return map[s] ?? s;
}

function payStatusLabel(s: string) {
  const map: Record<string, string> = { paid: "Paid", part_paid: "Part Paid", unpaid: "Unpaid", waived: "Waived" };
  return map[s] ?? s;
}

function rowClass(row: SlotRow) {
  if (row.slotEffectiveStatus === "rejected" || row.slotEffectiveStatus === "cancelled_override") return "rpt-row-rejected";
  if (row.slotPaymentStatus === "paid") return "rpt-row-paid";
  if (row.slotPaymentStatus === "part_paid") return "rpt-row-part";
  if (row.slotPaymentStatus === "waived") return "rpt-row-waived";
  return "rpt-row-unpaid";
}

function exportCsv(rows: SlotRow[]) {
  const headers = [
    "Date", "Time", "Room", "Event Type", "Ref", "Customer", "Email", "Phone", "Purpose",
    "Status", "Pay Status", "Amount (LKR)", "Paid (LKR)", "Waiver (LKR)", "Credit Note (LKR)", "Balance (LKR)",
    "Reject Reason",
  ];
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.slotDate, `${r.startTime}–${r.endTime}`, r.roomName, r.eventTypeName,
        r.bookingReference, r.customerName, r.customerEmail, r.customerPhone, r.customerPurpose,
        statusLabel(r.slotEffectiveStatus), payStatusLabel(r.slotPaymentStatus),
        r.slotAmountLkr, r.slotPaidLkr, r.slotWaiverLkr, r.slotCreditNoteLkr, r.slotBalanceLkr,
        r.rejectReason ?? "",
      ].map(escape).join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rmasa-report.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const today = toYmd(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<SlotRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadReport() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/calendar/reports?from=${from}&to=${to}`);
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        setError(d.message ?? "Failed to load report.");
        setRows(null);
      } else {
        const d = (await res.json()) as { rows: SlotRow[] };
        setRows(d.rows);
      }
    } catch {
      setError("Network error.");
      setRows(null);
    } finally {
      setLoading(false);
    }
  }

  const totalBilled = rows?.reduce((s, r) => s + r.slotAmountLkr, 0) ?? 0;
  const totalPaid = rows?.reduce((s, r) => s + r.slotPaidLkr, 0) ?? 0;
  const totalWaived = rows?.reduce((s, r) => s + r.slotWaiverLkr, 0) ?? 0;
  const totalCredit = rows?.reduce((s, r) => s + r.slotCreditNoteLkr, 0) ?? 0;
  const totalBalance = rows?.reduce((s, r) => s + r.slotBalanceLkr, 0) ?? 0;

  return (
    <div className="admin-console">
      <AdminBreadcrumbs
        trail={[
          { label: "Admin", href: "/admin/calendar" },
          { label: "Reports" },
        ]}
      />
      <section className="admin-panel">
        <h2>Accounting Report</h2>

        <div className="rpt-filter-bar">
          <label>From</label>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <label>To</label>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          <button className="btn btn-primary" onClick={() => void loadReport()} disabled={loading} type="button">
            {loading ? "Loading…" : "Load Report"}
          </button>
          {rows && rows.length > 0 ? (
            <button className="btn btn-secondary" onClick={() => exportCsv(rows)} type="button">
              Export CSV
            </button>
          ) : null}
        </div>

        {error ? <p className="form-message error">{error}</p> : null}

        {rows !== null ? (
          <>
            <div className="rpt-summary">
              <div className="rpt-summary-item">
                <span className="rpt-summary-label">Slots</span>
                <span className="rpt-summary-value">{rows.length}</span>
              </div>
              <div className="rpt-summary-item">
                <span className="rpt-summary-label">Billed</span>
                <span className="rpt-summary-value">LKR {fmt(totalBilled)}</span>
              </div>
              <div className="rpt-summary-item">
                <span className="rpt-summary-label">Paid</span>
                <span className="rpt-summary-value rpt-summary-paid">LKR {fmt(totalPaid)}</span>
              </div>
              <div className="rpt-summary-item">
                <span className="rpt-summary-label">Waiver</span>
                <span className="rpt-summary-value">LKR {fmt(totalWaived)}</span>
              </div>
              <div className="rpt-summary-item">
                <span className="rpt-summary-label">Credit Notes</span>
                <span className="rpt-summary-value">LKR {fmt(totalCredit)}</span>
              </div>
              <div className="rpt-summary-item">
                <span className="rpt-summary-label">Balance Due</span>
                <span className="rpt-summary-value rpt-summary-balance">LKR {fmt(totalBalance)}</span>
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="admin-revenue-note">No slots found in this date range.</p>
            ) : (
              <div className="rpt-table-wrap">
                <table className="rpt-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Room</th>
                      <th>Event Type</th>
                      <th>Ref</th>
                      <th>Customer</th>
                      <th>Purpose</th>
                      <th>Status</th>
                      <th>Pay Status</th>
                      <th className="rpt-num">Amount</th>
                      <th className="rpt-num">Paid</th>
                      <th className="rpt-num">Waiver</th>
                      <th className="rpt-num">Credit Note</th>
                      <th className="rpt-num">Balance</th>
                      <th>Reject Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className={rowClass(row)}>
                        <td className="rpt-date">{formatDate(row.slotDate)}</td>
                        <td className="rpt-time">{row.startTime}–{row.endTime}</td>
                        <td>{row.roomName}</td>
                        <td>{row.eventTypeName}</td>
                        <td><code className="rpt-ref">{row.bookingReference}</code></td>
                        <td>
                          <div className="rpt-customer-name">{row.customerName}</div>
                          <div className="rpt-customer-sub">{row.customerEmail}</div>
                        </td>
                        <td className="rpt-purpose">{row.customerPurpose || "—"}</td>
                        <td><span className={`rpt-status rpt-status-${row.slotEffectiveStatus}`}>{statusLabel(row.slotEffectiveStatus)}</span></td>
                        <td><span className={`rpt-pay-status rpt-pay-${row.slotPaymentStatus}`}>{payStatusLabel(row.slotPaymentStatus)}</span></td>
                        <td className="rpt-num">{row.slotAmountLkr > 0 ? fmt(row.slotAmountLkr) : "—"}</td>
                        <td className="rpt-num rpt-paid">{row.slotPaidLkr > 0 ? fmt(row.slotPaidLkr) : "—"}</td>
                        <td className="rpt-num">{row.slotWaiverLkr > 0 ? fmt(row.slotWaiverLkr) : "—"}</td>
                        <td className="rpt-num">{row.slotCreditNoteLkr > 0 ? fmt(row.slotCreditNoteLkr) : "—"}</td>
                        <td className="rpt-num rpt-balance">{row.slotBalanceLkr > 0 ? fmt(row.slotBalanceLkr) : "—"}</td>
                        <td className="rpt-reject-reason">{row.rejectReason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
