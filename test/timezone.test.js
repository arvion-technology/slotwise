import test from "node:test";
import assert from "node:assert/strict";

import {
  offsetMinutes, offsetLabel, zonedParts, zonedTimeToInstants, tryZonedTimeToInstant,
  dateKeyInZone, startOfZonedDay, zonedDayLength, addDaysToKey, startOfWeekKey,
  weekDayKeys, timeLabel, dayLabel, longDayLabel, parseDateKey, VIEWER_ZONES,
} from "../src/timezone.js";

const NY = "America/New_York";

test("offsets follow DST in the target zone, not the machine zone", () => {
  assert.equal(offsetMinutes(Date.UTC(2026, 0, 15, 12), NY), -300, "January is EST");
  assert.equal(offsetMinutes(Date.UTC(2026, 6, 15, 12), NY), -240, "July is EDT");
  assert.equal(offsetLabel(Date.UTC(2026, 6, 15, 12), NY), "UTC−04:00");
  assert.equal(offsetMinutes(Date.UTC(2026, 6, 15, 12), "Asia/Kathmandu"), 345);
  assert.equal(offsetMinutes(Date.UTC(2026, 6, 15, 12), "UTC"), 0);
});

test("a spring-forward wall time exists zero times", () => {
  const instants = zonedTimeToInstants({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NY);
  assert.deepEqual(instants, [], "02:30 never happens on 8 March 2026 in New York");
  assert.equal(tryZonedTimeToInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NY), null);
});

test("a fall-back wall time exists twice and disambiguation is explicit", () => {
  const instants = zonedTimeToInstants({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NY);
  assert.equal(instants.length, 2);
  assert.equal(new Date(instants[0]).toISOString(), "2026-11-01T05:30:00.000Z", "first is EDT");
  assert.equal(new Date(instants[1]).toISOString(), "2026-11-01T06:30:00.000Z", "second is EST");
  assert.equal(tryZonedTimeToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NY), instants[0]);
  assert.equal(tryZonedTimeToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NY, { disambiguation: "later" }), instants[1]);
});

test("days are 23 and 25 hours long across DST transitions", () => {
  assert.equal(zonedDayLength("2026-03-08", NY) / 3_600_000, 23);
  assert.equal(zonedDayLength("2026-11-01", NY) / 3_600_000, 25);
  assert.equal(zonedDayLength("2026-03-08", "Asia/Kathmandu") / 3_600_000, 24, "Nepal has no DST");
});

test("date keys are calculated in the zone, not in UTC", () => {
  const instant = Date.UTC(2026, 2, 9, 2, 0);
  assert.equal(dateKeyInZone(instant, NY), "2026-03-08");
  assert.equal(dateKeyInZone(instant, "Asia/Kathmandu"), "2026-03-09");
  assert.equal(new Date(startOfZonedDay("2026-03-08", NY)).toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(new Date(startOfZonedDay("2026-03-09", NY)).toISOString(), "2026-03-09T04:00:00.000Z");
});

test("calendar labels read in the requested zone", () => {
  const instant = Date.UTC(2026, 9, 28, 18, 45);
  assert.equal(timeLabel(instant, NY), "14:45");
  assert.equal(timeLabel(instant, "Asia/Kathmandu"), "00:30", "crosses into the next day");
  assert.equal(dateKeyInZone(instant, "Asia/Kathmandu"), "2026-10-29");
  assert.match(dayLabel(instant, NY), /Wed/);
  assert.match(longDayLabel(instant, NY), /Wednesday, October 28, 2026/);
});

test("week and date arithmetic stays on calendar dates", () => {
  assert.equal(addDaysToKey("2026-10-31", 1), "2026-11-01");
  assert.equal(addDaysToKey("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysToKey("2028-03-01", -1), "2028-02-29", "leap year");
  assert.equal(startOfWeekKey("2026-10-28", 1), "2026-10-26");
  assert.deepEqual(weekDayKeys("2026-10-26", 3), ["2026-10-26", "2026-10-27", "2026-10-28"]);
  assert.equal(startOfWeekKey("2026-10-28", 7), "2026-10-25", "Sunday week start");
  assert.equal(zonedParts(Date.UTC(2026, 0, 1, 5), NY).weekday, 4, "1 Jan 2026 is a Thursday");
});

test("invalid calendar dates are rejected", () => {
  assert.throws(() => parseDateKey("2026-02-30"), RangeError);
  assert.throws(() => parseDateKey("28-10-2026"), TypeError);
  assert.equal(VIEWER_ZONES.includes("Asia/Kathmandu"), true);
});
