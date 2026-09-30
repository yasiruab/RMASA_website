import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildPriorityNotice, higherPriorityEventNames } from "./booking-priority.ts";

const badminton = { id: "b", name: "Badminton", priority: 1 };
const sixHours = { id: "6h", name: "6 Hours", priority: 10 };
const fullWeekday = { id: "fd", name: "Full Day (Weekday)", priority: 10 };
const fullWeekend = { id: "fe", name: "Full Day (Weekend)", priority: 20 };
const mainArena = [badminton, sixHours, fullWeekday, fullWeekend];

test("lists every event that outranks the selected one, highest first", () => {
  assert.deepEqual(higherPriorityEventNames(badminton, mainArena), [
    "Full Day (Weekend)",
    "6 Hours",
    "Full Day (Weekday)",
  ]);
});

test("equal priority does not outrank", () => {
  assert.deepEqual(higherPriorityEventNames(sixHours, [sixHours, fullWeekday]), []);
});

test("the top-priority event gets no notice", () => {
  assert.deepEqual(higherPriorityEventNames(fullWeekend, mainArena), []);
  assert.equal(buildPriorityNotice("Full Day (Weekend)", []), null);
});

test("notice wording joins names naturally", () => {
  const three = buildPriorityNotice("Badminton", ["6 Hours", "Full Day (Weekday)", "Full Day (Weekend)"]);
  assert.equal(three?.title, "Please note: Booking priority applies");
  assert.match(three!.paragraphs[0], /^Badminton bookings have lower priority than other events in this room\./);
  assert.match(three!.paragraphs[0], /books a 6 Hours, Full Day \(Weekday\), or Full Day \(Weekend\) session/);
  assert.equal(three!.paragraphs[1], "We’ll email you if this happens.");

  const two = buildPriorityNotice("Badminton", ["6 Hours", "Full Day"]);
  assert.match(two!.paragraphs[0], /books a 6 Hours or Full Day session/);

  const one = buildPriorityNotice("Badminton", ["6 Hours"]);
  assert.match(one!.paragraphs[0], /books a 6 Hours session/);
});
