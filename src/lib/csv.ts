// CSV cell encoding for admin exports. Pure (no `@/` imports) so `npm test` can
// load it.

// Spreadsheet apps execute a cell that starts with one of these as a formula.
// Customer names / purposes come from the anonymous booking form, so a value
// like `=HYPERLINK("https://evil.example","Receipt")` would otherwise run when
// staff open the export in Excel (CSV / formula injection).
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** Encodes one value as a CSV cell: neutralises formula triggers, then quotes if needed. */
export function csvCell(value: string | number | null | undefined): string {
  let text = String(value ?? "");
  // Numbers are our own computed values (negative balances are legitimate),
  // so only free text gets the leading apostrophe.
  if (typeof value === "string" && FORMULA_TRIGGER.test(text)) {
    text = `'${text}`;
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Joins cells into one CSV line. */
export function csvRow(values: Array<string | number | null | undefined>): string {
  return values.map(csvCell).join(",");
}
