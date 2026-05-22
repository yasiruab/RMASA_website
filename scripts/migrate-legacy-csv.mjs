#!/usr/bin/env node
// Transform legacy WordPress booking-plugin CSV → 4 normalized CSVs that match
// the new Prisma schema. Pure transform; no DB writes. Companion psql script
// imports the output via staging tables. See plan file and CLAUDE.md for the
// decisions baked in.
//
// Handles both Main Arena and Studio Room exports:
//   - Slot column count is detected from the header (9 for Main Arena,
//     up to 651 for Studio Room)
//   - Phone column is `Phone number` (Main Arena) or `Contact number`
//     (Studio Room) — detected automatically
//   - Slot dates accept both `MM/DD/YYYY` and `M/D/YYYY` (US M/D/Y)
//   - Per-legacy-label mapping in --event-types supports three shapes:
//       "label":  "eventTypeId"                                     (simple)
//       "label":  { eventTypeId, acMode, cleanupDurationMinutes }    (Studio Room AC variants)
//       "label":  { splitByDayType: true, weekday: "id", weekend: "id" }
//                                                                  (Main Arena legacy `Full Day`)

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// ---------- args ----------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      out[key] = argv[i + 1];
      i++;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const required = ["in", "out", "room-type-id", "event-types", "admin-email", "expected-form"];
for (const k of required) {
  if (!args[k]) {
    console.error(`Missing required arg: --${k}`);
    console.error(`Usage:
  node scripts/migrate-legacy-csv.mjs \\
    --in            ./db-migration/main_arena_20260521.csv \\
    --out           ./db-migration/main-arena/out/ \\
    --room-type-id  room-7w8g7m \\
    --expected-form "Main Arena" \\
    --admin-email   you@example.com \\
    --event-types   '{
      "6 Hours":             "evt-6hours-id",
      "Full Day (Weekday)":  "evt-fdwd-id",
      "Full Day (Week end)": "evt-fdwe-id",
      "Full Day":            { "splitByDayType": true, "weekday": "evt-fdwd-id", "weekend": "evt-fdwe-id" }
    }'

Studio Room example:
  --event-types '{
    "30 min - Non AC": { "eventTypeId": "evt-30m-id", "acMode": "without_ac", "cleanupDurationMinutes": 5 },
    "30 min - AC":     { "eventTypeId": "evt-30m-id", "acMode": "with_ac",    "cleanupDurationMinutes": 5 },
    "Full Day - Non AC": { "eventTypeId": "evt-fd-id", "acMode": "without_ac", "cleanupDurationMinutes": 0 },
    "Full Day - AC":     { "eventTypeId": "evt-fd-id", "acMode": "with_ac",    "cleanupDurationMinutes": 0 }
  }'`);
    process.exit(1);
  }
}

const inPath = resolve(args.in);
const outDir = resolve(args.out);
const roomTypeId = args["room-type-id"];
const adminEmail = args["admin-email"];
const expectedForm = args["expected-form"];
let eventTypeMap;
try {
  eventTypeMap = JSON.parse(args["event-types"]);
} catch (err) {
  console.error("--event-types must be valid JSON:", err.message);
  process.exit(1);
}
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// ---------- CSV parsing (state machine; quoted fields with embedded
// newlines + escaped "" + mixed quoted/unquoted) ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

function rowsToObjects(rows) {
  const [header, ...body] = rows;
  return body.map((row) => {
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = row[i] ?? "";
    return obj;
  });
}

// ---------- field helpers ----------
function htmlDecode(s) {
  return (s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

// Accept BOTH `MM/DD/YYYY` and `M/D/YYYY`. Validates that the resulting
// year/month/day is a real calendar date (rejects Feb 30 etc.).
function mdyToIso(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s ?? "").trim());
  if (!m) return null;
  const mo = +m[1];
  const d = +m[2];
  const y = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Construct via UTC to avoid local TZ DST shifts changing the day.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    // e.g. Feb 30 → JS rolled to Mar 2; reject.
    return null;
  }
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isValidTime(s) {
  // Accept both `H:mm` (single-digit hour, as seen in Studio Room) and `HH:mm`.
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? "").trim());
  if (!m) return false;
  const hh = +m[1];
  const mm = +m[2];
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}
// Normalize H:mm → HH:mm so downstream consumers always see a 2-digit hour.
function normalizeTime(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  return `${String(+m[1]).padStart(2, "0")}:${m[2]}`;
}
function timeToMinutes(s) {
  const [hh, mm] = s.split(":").map(Number);
  return hh * 60 + mm;
}

function isoDayType(ymd) {
  // Sat/Sun -> weekend, else weekday. Mirrors src/lib/calendar-core.ts.
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6 ? "weekend" : "weekday";
}

function parseLegacyTimestamp(s) {
  // "M/D/YYYY HH:MM:SS" (or zero-padded) interpreted as Asia/Colombo wall
  // clock (UTC+5:30, no DST). Returns ISO UTC string, or null on failure.
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((s ?? "").trim());
  if (!m) return null;
  const [, moS, dS, yS, hhS, mmS, ssS] = m;
  const mo = +moS, d = +dS, y = +yS, hh = +hhS, mm = +mmS, ss = ssS ? +ssS : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  // Validate calendar date
  const cal = new Date(Date.UTC(y, mo - 1, d));
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d) return null;
  const local = Date.UTC(y, mo - 1, d, hh, mm, ss);
  const utc = local - (5 * 60 + 30) * 60_000;
  return new Date(utc).toISOString();
}

function cleanPhone(raw) {
  // Strip spaces and separators, keep only digits and "+".
  const cleaned = (raw ?? "").replace(/[^\d+]/g, "");
  if (cleaned.length === 0 || cleaned.length > 16) return null;
  if (!/^[0-9+]+$/.test(cleaned)) return null;
  return cleaned;
}

function isEmail(s) {
  return /^\S+@\S+\.\S+$/.test((s ?? "").trim());
}

function truncate(s, max) {
  s = s ?? "";
  return s.length > max ? s.slice(0, max) : s;
}

// ---------- reference generation with dedup ----------
const usedRefs = new Set();
function generateReference() {
  for (let attempt = 0; attempt < 32; attempt++) {
    const r = "BK-" + randomBytes(3).toString("hex").toUpperCase();
    if (!usedRefs.has(r)) {
      usedRefs.add(r);
      return r;
    }
  }
  throw new Error("Could not generate unique BK reference after 32 attempts");
}

// ---------- legacy label → resolved {eventTypeId, acMode, cleanupDurationMinutes} ----------
function resolveLegacyLabel(label, slotDateIso) {
  const entry = eventTypeMap[label];
  if (entry === undefined) return null;
  if (typeof entry === "string") {
    return { eventTypeId: entry, acMode: "without_ac", cleanupDurationMinutes: 0 };
  }
  if (entry && typeof entry === "object") {
    if (entry.splitByDayType) {
      const dt = isoDayType(slotDateIso);
      const id = dt === "weekend" ? entry.weekend : entry.weekday;
      if (!id) return null;
      return { eventTypeId: id, acMode: "without_ac", cleanupDurationMinutes: 0 };
    }
    if (entry.eventTypeId) {
      return {
        eventTypeId: entry.eventTypeId,
        acMode: entry.acMode ?? "without_ac",
        cleanupDurationMinutes: Number.isFinite(entry.cleanupDurationMinutes)
          ? entry.cleanupDurationMinutes
          : 0,
      };
    }
  }
  return null;
}

// ---------- CSV writing ----------
function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function writeCsv(path, header, rows) {
  const lines = [header.map(csvEscape).join(",")];
  for (const row of rows) lines.push(header.map((col) => csvEscape(row[col])).join(","));
  writeFileSync(path, lines.join("\n") + "\n");
}

// ---------- transform ----------
// IMPORTANT: we deliberately do NOT trust the header layout for body rows.
// The legacy WordPress exporter has a structural bug visible in the Studio
// Room CSV: when a row has more than 3 slots, the body data omits the
// formid/formname/.../username block between slots 3 and 4 (which the header
// puts there) and instead places it AT THE END of the row, after all slot
// data. Main Arena CSVs happen to follow the header layout strictly, but
// rather than special-case the two files we use a single position-anchored
// parser that handles both: find the column where the value equals
// expectedForm (= formname), and infer the rest of the formid block + slot
// extents from that anchor.
const raw = readFileSync(inPath, "utf8");
const rawRows = parseCsv(raw);
if (rawRows.length < 2) {
  console.error("CSV has no data rows.");
  process.exit(1);
}
const header = rawRows[0];
const bodyRows = rawRows.slice(1);
console.error(`Read ${bodyRows.length} legacy rows from ${inPath}`);

// Header column index lookup (used only for the 7 leading well-positioned
// fields: ID, Form, Time, Email, final_price, request_timestamp).
const headerIdx = {};
for (let i = 0; i < header.length; i++) headerIdx[header[i]] = i;
function colIdx(name) {
  if (!(name in headerIdx)) {
    console.error(`Header missing required column: ${name}`);
    process.exit(1);
  }
  return headerIdx[name];
}
const IDX_ID = colIdx("ID");
const IDX_FORM = colIdx("Form");
const IDX_EMAIL = colIdx("Email");
const IDX_FINAL_PRICE = colIdx("final_price");
const IDX_REQUEST_TS = colIdx("request_timestamp");

// Slot data begins at col 8 (index 7), 9 cols per slot block, in this fixed
// per-slot order (matches the WordPress plugin export):
//   service, status, duration, price, date, slot, starttime, endtime, quantity
const SLOT_DATA_START = 7;
const SLOT_BLOCK_SIZE = 9;
const SLOT_OFFSET = {
  service: 0,
  status: 1,
  duration: 2,
  price: 3,
  date: 4,
  slot: 5,
  starttime: 6,
  endtime: 7,
  quantity: 8,
};
const FORMID_BLOCK_SIZE = 8; // formid, formname, referrer, Appointment, Name, phone, Purpose, username
const FORMID_OFFSET = {
  formid: 0,
  formname: 1,
  referrer: 2,
  appointment: 3,
  name: 4,
  phone: 5,
  purpose: 6,
  username: 7,
};

const bookings = [];
const slots = [];
const breakdowns = [];
const payments = [];
const skipped = [];

function skip(legacyId, reason, extra = "") {
  skipped.push({ legacyId, reason, extra });
}
function warn(legacyId, reason, extra = "") {
  // Warnings keep the row but are surfaced in skipped.log.
  skipped.push({ legacyId, reason: "WARN_" + reason, extra });
}

const legacyFinalPriceTotal = { confirmed: 0, all: 0 };
let earliestDate = null;
let latestDate = null;

for (const row of bodyRows) {
  const legacyId = (row[IDX_ID] || "").trim() || "(no-id)";

  // ---- Form column sanity ----
  const form = (row[IDX_FORM] || "").trim();
  if (form !== expectedForm) {
    skip(legacyId, "wrong_form", `Form="${form}" (expected "${expectedForm}")`);
    continue;
  }

  // ---- locate the formid block by anchoring on formname ----
  // Search from SLOT_DATA_START onwards for the column whose value equals
  // expectedForm. That's the formname position; from there we can derive
  // the rest of the formid block and the slot extents on either side.
  let fnIdx = -1;
  for (let k = SLOT_DATA_START; k < row.length; k++) {
    if ((row[k] || "").trim() === expectedForm) {
      fnIdx = k;
      break;
    }
  }
  if (fnIdx < 0) {
    skip(legacyId, "formname_not_found", `expected "${expectedForm}" somewhere after col ${SLOT_DATA_START + 1}`);
    continue;
  }
  const formidIdx = fnIdx - FORMID_OFFSET.formname; // formid = fnIdx - 1
  const formidEndIdx = formidIdx + FORMID_BLOCK_SIZE - 1; // inclusive

  // ---- iterate slot blocks, skipping the formid block when encountered ----
  // A slot block is 9 cols starting at SLOT_DATA_START, advancing by 9. If we
  // would step into the formid block, jump over it. A slot is "present" if
  // its `date` cell is non-empty.
  const rawSlots = [];
  let slotParseError = false;
  let cur = SLOT_DATA_START;
  let slotN = 0;
  while (cur + SLOT_BLOCK_SIZE - 1 < row.length) {
    // If this 9-col window overlaps the formid block, jump past it.
    if (cur <= formidEndIdx && cur + SLOT_BLOCK_SIZE - 1 >= formidIdx) {
      cur = formidEndIdx + 1;
      continue;
    }
    const sBlock = {
      service: (row[cur + SLOT_OFFSET.service] || "").trim(),
      status: (row[cur + SLOT_OFFSET.status] || "").trim(),
      date: (row[cur + SLOT_OFFSET.date] || "").trim(),
      starttime: (row[cur + SLOT_OFFSET.starttime] || "").trim(),
      endtime: (row[cur + SLOT_OFFSET.endtime] || "").trim(),
    };
    if (sBlock.date === "" && sBlock.service === "" && sBlock.starttime === "") {
      // empty slot block — stop scanning (legacy exporter trails with empty blocks).
      break;
    }
    slotN++;
    if (sBlock.date === "") {
      skip(legacyId, "empty_slot_date", `slot ${slotN} at col ${cur + 1 + SLOT_OFFSET.date}`);
      slotParseError = true;
      break;
    }
    const iso = mdyToIso(sBlock.date);
    if (!iso) {
      skip(legacyId, "bad_slot_date", `slot ${slotN}: "${sBlock.date}"`);
      slotParseError = true;
      break;
    }
    if (!isValidTime(sBlock.starttime) || !isValidTime(sBlock.endtime)) {
      skip(legacyId, "bad_slot_time", `slot ${slotN}: ${sBlock.starttime}/${sBlock.endtime}`);
      slotParseError = true;
      break;
    }
    const startTime = normalizeTime(sBlock.starttime);
    const endTime = normalizeTime(sBlock.endtime);
    if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
      skip(legacyId, "slot_start_not_before_end", `slot ${slotN}: ${startTime}-${endTime}`);
      slotParseError = true;
      break;
    }
    if (!sBlock.service) {
      skip(legacyId, "empty_service_label", `slot ${slotN}`);
      slotParseError = true;
      break;
    }
    const resolved = resolveLegacyLabel(sBlock.service, iso);
    if (!resolved) {
      skip(legacyId, "unmapped_event_type", `slot ${slotN}: "${sBlock.service}"`);
      slotParseError = true;
      break;
    }
    rawSlots.push({
      date: iso,
      startTime,
      endTime,
      legacyStatus: sBlock.status,
      legacyService: sBlock.service,
      resolved,
    });
    cur += SLOT_BLOCK_SIZE;
  }
  if (slotParseError) continue;
  if (rawSlots.length === 0) {
    skip(legacyId, "no_slots", "");
    continue;
  }

  // ---- pull customer fields from the formid block ----
  const customerEmail = (row[IDX_EMAIL] || "").trim();
  const customerNameRaw = (row[formidIdx + FORMID_OFFSET.name] || "").trim();
  const customerPhoneRaw = (row[formidIdx + FORMID_OFFSET.phone] || "").trim();
  const customerPurposeRaw = (row[formidIdx + FORMID_OFFSET.purpose] || "").trim();

  // ---- booking-level event-type / AC mode = first slot; warn if mixed ----
  const firstResolved = rawSlots[0].resolved;
  let mixedFlag = false;
  for (let i = 1; i < rawSlots.length; i++) {
    const r2 = rawSlots[i].resolved;
    if (
      r2.eventTypeId !== firstResolved.eventTypeId ||
      r2.acMode !== firstResolved.acMode
    ) {
      mixedFlag = true;
      break;
    }
  }
  if (mixedFlag) {
    const variantSet = new Set(
      rawSlots.map((s) => `${s.legacyService}`),
    );
    warn(legacyId, "mixed_within_booking", `variants: ${[...variantSet].join("|")}`);
  }
  const eventTypeId = firstResolved.eventTypeId;
  const acMode = firstResolved.acMode;
  const cleanupDurationMinutes = firstResolved.cleanupDurationMinutes;

  // ---- email ----
  let finalEmail = customerEmail;
  if (!isEmail(finalEmail)) {
    warn(legacyId, "bad_email_placeholder", customerEmail.slice(0, 60));
    finalEmail = "legacy-no-email@royalmasarena.local";
  }

  // ---- customer cleanup ----
  const customerName = truncate(htmlDecode(customerNameRaw), 100) || "Unknown";
  const purpose = truncate(htmlDecode(customerPurposeRaw), 1000) || "(no purpose)";
  let phone = cleanPhone(customerPhoneRaw);
  if (phone === null) {
    warn(legacyId, "bad_phone_fudged", customerPhoneRaw.slice(0, 40));
    phone = "0000000000";
  }

  // ---- timestamps ----
  const createdAtIso = parseLegacyTimestamp(row[IDX_REQUEST_TS]);
  if (!createdAtIso) {
    skip(legacyId, "bad_timestamp", row[IDX_REQUEST_TS] || "(empty)");
    continue;
  }

  // ---- status mapping ----
  const isApproved = (s) => s === "Approved";
  const isCancelled = (s) =>
    s === "Cancelled" || s === "Cancelled by customer" || s === "Rejected";
  const approvedCount = rawSlots.filter((s) => isApproved(s.legacyStatus)).length;
  const cancelledCount = rawSlots.filter((s) => isCancelled(s.legacyStatus)).length;
  if (approvedCount + cancelledCount !== rawSlots.length) {
    skip(legacyId, "unknown_slot_status", rawSlots.map((s) => s.legacyStatus).join("|"));
    continue;
  }
  let bookingStatus;
  let bookingRejectReason = null;
  let perSlotOverrides = false;
  if (approvedCount === rawSlots.length) {
    bookingStatus = "confirmed";
  } else if (cancelledCount === rawSlots.length) {
    bookingStatus = "rejected";
    bookingRejectReason = "Cancelled in legacy system";
  } else {
    bookingStatus = "confirmed";
    perSlotOverrides = true;
  }

  // ---- pricing: even split ----
  const totalAmountLkr = Math.round(parseFloat(row[IDX_FINAL_PRICE] || "0"));
  if (!Number.isFinite(totalAmountLkr) || totalAmountLkr < 0) {
    skip(legacyId, "bad_total_price", row[IDX_FINAL_PRICE] || "");
    continue;
  }
  const n = rawSlots.length;
  const baseSlotAmount = Math.floor(totalAmountLkr / n);
  const lastSlotAmount = totalAmountLkr - baseSlotAmount * (n - 1);

  // ---- compose Booking ----
  const bookingId = randomUUID();
  const reference = generateReference();
  const reconciliationStatus = bookingStatus === "confirmed" ? "paid" : "unpaid";
  const paidAmountLkr = bookingStatus === "confirmed" ? totalAmountLkr : 0;
  const confirmedAt = bookingStatus === "confirmed" ? createdAtIso : "";

  bookings.push({
    id: bookingId,
    reference,
    roomTypeId,
    eventTypeId,
    acMode,
    status: bookingStatus,
    customerName,
    customerEmail: finalEmail,
    customerPhone: phone,
    customerPurpose: purpose,
    cleanupDurationMinutes,
    totalAmountLkr,
    paidAmountLkr,
    reconciliationStatus,
    reconciliationNotes: "Imported from legacy CSV",
    rejectReason: bookingRejectReason ?? "",
    confirmedAt,
    lastReminderDays: "",
    createdAt: createdAtIso,
    updatedAt: createdAtIso,
  });

  // ---- compose BookingSlot rows + BookingAmountBreakdown rows ----
  for (let i = 0; i < rawSlots.length; i++) {
    const s = rawSlots[i];
    const amt = i === rawSlots.length - 1 ? lastSlotAmount : baseSlotAmount;

    let slotStatus = "";
    let slotRejectReason = "";
    if (perSlotOverrides && isCancelled(s.legacyStatus)) {
      slotStatus = "rejected";
      slotRejectReason = "Cancelled in legacy system";
    }

    slots.push({
      bookingId,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      slotStatus,
      rejectReason: slotRejectReason,
    });

    breakdowns.push({
      bookingId,
      date: s.date,
      slot: `${s.startTime}-${s.endTime}`,
      amountLkr: amt,
      dayType: isoDayType(s.date),
    });

    if (!earliestDate || s.date < earliestDate) earliestDate = s.date;
    if (!latestDate || s.date > latestDate) latestDate = s.date;
  }

  // ---- compose PaymentEntry (confirmed only) ----
  if (bookingStatus === "confirmed") {
    const datePart = createdAtIso.slice(0, 10);
    payments.push({
      bookingId,
      type: "payment",
      date: datePart,
      amountLkr: totalAmountLkr,
      receiptNo: "",
      notes: "Historical import 2022-2026 — marked as paid",
      createdAt: createdAtIso,
      createdBy: adminEmail,
    });
    legacyFinalPriceTotal.confirmed += totalAmountLkr;
  }
  legacyFinalPriceTotal.all += totalAmountLkr;
}

// ---------- write outputs ----------
writeCsv(
  join(outDir, "bookings.csv"),
  [
    "id",
    "reference",
    "roomTypeId",
    "eventTypeId",
    "acMode",
    "status",
    "customerName",
    "customerEmail",
    "customerPhone",
    "customerPurpose",
    "cleanupDurationMinutes",
    "totalAmountLkr",
    "paidAmountLkr",
    "reconciliationStatus",
    "reconciliationNotes",
    "rejectReason",
    "confirmedAt",
    "lastReminderDays",
    "createdAt",
    "updatedAt",
  ],
  bookings,
);

writeCsv(
  join(outDir, "booking-slots.csv"),
  ["bookingId", "date", "startTime", "endTime", "slotStatus", "rejectReason"],
  slots,
);

writeCsv(
  join(outDir, "booking-breakdown.csv"),
  ["bookingId", "date", "slot", "amountLkr", "dayType"],
  breakdowns,
);

writeCsv(
  join(outDir, "payment-entries.csv"),
  ["bookingId", "type", "date", "amountLkr", "receiptNo", "notes", "createdAt", "createdBy"],
  payments,
);

// ---------- skipped.log ----------
const reasonCounts = {};
for (const s of skipped) reasonCounts[s.reason] = (reasonCounts[s.reason] || 0) + 1;
const skippedLines = skipped
  .map((s) => `${s.legacyId}\t${s.reason}\t${s.extra}`)
  .join("\n");
writeFileSync(join(outDir, "skipped.log"), skippedLines + (skippedLines ? "\n" : ""));

// ---------- summary ----------
console.error("");
console.error("================ SUMMARY ================");
console.error(`Input CSV:               ${inPath}`);
console.error(`Output dir:              ${outDir}`);
console.error(`Legacy rows read:        ${rawRows.length}`);
console.error(`Bookings emitted:        ${bookings.length}`);
console.error(`  - confirmed:           ${bookings.filter((b) => b.status === "confirmed").length}`);
console.error(`  - rejected:            ${bookings.filter((b) => b.status === "rejected").length}`);
console.error(`BookingSlots emitted:    ${slots.length}`);
console.error(`Breakdown rows emitted:  ${breakdowns.length}`);
console.error(`PaymentEntries emitted:  ${payments.length}`);
console.error("");
console.error(`Skipped / warned rows:   ${skipped.length}`);
for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.error(`  - ${reason.padEnd(28)} ${count}`);
}
console.error("");
console.error(`Total final_price (confirmed): LKR ${legacyFinalPriceTotal.confirmed.toLocaleString()}`);
console.error(`Total final_price (all kept):  LKR ${legacyFinalPriceTotal.all.toLocaleString()}`);
if (earliestDate) console.error(`Slot date range:               ${earliestDate}  →  ${latestDate}`);
console.error("");
console.error(`Outputs: ${outDir}/bookings.csv, booking-slots.csv, booking-breakdown.csv, payment-entries.csv, skipped.log`);
