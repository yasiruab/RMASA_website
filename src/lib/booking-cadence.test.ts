import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  cadenceGapMinutes,
  isBookingCadence,
  isOnCadence,
  lastCadenceStart,
  nextCadenceStart,
  toBookingCadence,
} from "./booking-cadence.ts";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

test("only 30 and 60 are valid cadences", () => {
  assert.equal(isBookingCadence(30), true);
  assert.equal(isBookingCadence(60), true);
  assert.equal(isBookingCadence(15), false);
  assert.equal(isBookingCadence("60"), false);
  assert.equal(toBookingCadence(45), 30);
  assert.equal(toBookingCadence(60), 60);
});

test("60-min cadence from 08:30 allows 08:30, 09:30 … but not 09:00", () => {
  const opening = h(8, 30);
  assert.equal(isOnCadence(h(8, 30), opening, 60), true);
  assert.equal(isOnCadence(h(9, 30), opening, 60), true);
  assert.equal(isOnCadence(h(9), opening, 60), false);
  assert.equal(isOnCadence(h(10), opening, 60), false);
});

test("starts before opening are never on cadence", () => {
  assert.equal(isOnCadence(h(7, 30), h(8, 30), 60), false);
});

test("30-min cadence from 06:00 allows every :00 and :30 (previous behaviour)", () => {
  for (let m = h(6); m < h(18); m += 30) {
    assert.equal(isOnCadence(m, h(6), 30), true);
  }
  assert.equal(isOnCadence(h(6, 15), h(6), 30), false);
});

test("nextCadenceStart snaps forward, never back", () => {
  const opening = h(8, 30);
  assert.equal(nextCadenceStart(h(9), opening, 60), h(9, 30));
  assert.equal(nextCadenceStart(h(9, 30), opening, 60), h(9, 30));
  assert.equal(nextCadenceStart(h(8), opening, 60), opening);
});

test("lastCadenceStart is the last start that still ends by closing", () => {
  // 08:30–20:00, 60-min cadence, 60-min event: 19:30 would end 20:30.
  assert.equal(lastCadenceStart(h(8, 30), h(20), 60, 60), h(18, 30));
  // 30-min cadence fits right up to closing.
  assert.equal(lastCadenceStart(h(8, 30), h(20), 30, 60), h(19));
  // Event longer than the day: nothing fits.
  assert.equal(lastCadenceStart(h(8), h(10), 60, 180), null);
});

test("cadenceGapMinutes is the empty time before the next allowed start", () => {
  assert.equal(cadenceGapMinutes(60, 60), 0);
  assert.equal(cadenceGapMinutes(75, 60), 45); // 60 min + 15 cleanup
  assert.equal(cadenceGapMinutes(90, 60), 30);
  assert.equal(cadenceGapMinutes(90, 30), 0);
  assert.equal(cadenceGapMinutes(105, 30), 15);
});
