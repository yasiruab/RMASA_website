import { strict as assert } from "node:assert";
import { test } from "node:test";
import { csvCell, csvRow } from "./csv.ts";

test("plain text and numbers pass through", () => {
  assert.equal(csvCell("Nimal Perera"), "Nimal Perera");
  assert.equal(csvCell(12500), "12500");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("negative numbers are not prefixed", () => {
  assert.equal(csvCell(-500), "-500");
});

test("formula triggers in text are neutralised", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+94771234567"), "'+94771234567");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("\tcmd"), "'\tcmd");
});

test("a HYPERLINK payload is both neutralised and quoted", () => {
  assert.equal(
    csvCell('=HYPERLINK("https://evil.example","Receipt")'),
    `"'=HYPERLINK(""https://evil.example"",""Receipt"")"`,
  );
});

test("commas, quotes and newlines are quoted", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
});

test("csvRow joins encoded cells", () => {
  assert.equal(csvRow(["Jan 5, 2026", 100, "=x"]), `"Jan 5, 2026",100,'=x`);
});
