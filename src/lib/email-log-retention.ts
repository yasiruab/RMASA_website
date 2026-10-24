// EmailLog retention policy. Pure (no `@/` imports) so `npm test` can load it.
//
// Every EmailLog row stores the full rendered email (htmlBody) — customer
// names, phones, purposes, amounts — plus the recipient address. Kept forever,
// that table is the largest pile of customer PII in the database and a breach
// multiplier. Rows older than EMAIL_LOG_RETENTION_MONTHS are *redacted*, not
// deleted: the personal fields are blanked, while type, status, booking
// reference and timestamps stay for troubleshooting and audit.

export const EMAIL_LOG_RETENTION_MONTHS = 18;

/** Stored in toEmail once a row is redacted; also marks it as already done. */
export const REDACTED_EMAIL = "[redacted]";

/** Field values that replace the PII on a redacted row. */
export const REDACTED_FIELDS = {
  toEmail: REDACTED_EMAIL,
  subject: "[redacted]",
  htmlBody: "",
  errorMessage: null,
} as const;

/** Rows created before this instant are past retention. Calendar months, UTC;
 *  a day that doesn't exist in the target month (31 Aug − 18 months) clamps to
 *  that month's last day rather than rolling over. */
export function emailLogRetentionCutoff(now: Date, months: number = EMAIL_LOG_RETENTION_MONTHS): Date {
  const cutoff = new Date(now);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const lastDayOfMonth = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDayOfMonth));
  return cutoff;
}
