// Local-time YYYY-MM-DD helpers used across admin views (booking date filter,
// revenue model month buckets, etc.). Local-time, not UTC, because admin work
// is anchored to Colombo calendar days.

export function toYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ymdToDate(ymd: string): Date {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function monthKey(ymd: string): string {
  return ymd.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function isWeekend(ymd: string): boolean {
  const day = ymdToDate(ymd).getDay();
  return day === 0 || day === 6;
}

export function inDateRange(date: string, startYmd: string, endYmd: string): boolean {
  return date >= startYmd && date <= endYmd;
}
