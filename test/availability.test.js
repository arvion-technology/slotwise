import test from "node:test";
import assert from "node:assert/strict";

import {
  parseClock, formatClock, normalizeAvailability, windowsForDate, generateSlots,
  generateDayAvailability, generateRangeAvailability, groupSlotsByStart, hasConflict,
  intervalsOverlap,
} from "../src/availability.js";
import { offsetMinutes, timeLabel, dateKeyInZone } from "../src/timezone.js";

const NY = "America/New_York";
const SERVICE = { id: "svc", name: "Session", durationMinutes: 60, slotIntervalMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minNoticeMinutes: 0, priceMinor: 10000 };
const STAFF = {
  id: "st", name: "Test", timeZone: NY,
  availability: {
    1: [["09:00", "12:00"], ["13:00", "17:00"]],
    2: [["09:00", "17:00"]], 3: [["09:00", "17:00"]], 4: [["09:00", "17:00"]],
    5: [["09:00", "17:00"]], 6: [], 7: [],
  },
};
const MONDAY = "2026-10-26";
const EARLY = Date.UTC(2026, 0, 1);

function slotsFor(dateKey, overrides = {}) {
  return generateSlots({
    dateKey, timeZone: NY, service: { ...SERVICE, ...overrides.service },
    staff: { ...STAFF, ...overrides.staff }, bookings: overrides.bookings || [],
    blackouts: overrides.blackouts || [], now: overrides.now ?? EARLY,
  });
}

test("clock parsing and normalisation are strict", () => {
  assert.equal(parseClock("09:30"), 570);
  assert.equal(parseClock("00:00"), 0);
  assert.throws(() => parseClock("24:00"), TypeError);
  assert.throws(() => parseClock("9:30"), TypeError);
  assert.equal(formatClock(570), "09:30");
  assert.equal(formatClock(1440 + 60), "01:00");
  const availability = normalizeAvailability({ 1: [["09:00", "12:00"]], 2: [{ start: "10:00", end: "11:00" }] });
  assert.deepEqual(availability[1], [{ start: 540, end: 720 }]);
  assert.deepEqual(availability[2], [{ start: 600, end: 660 }]);
  assert.deepEqual(availability[3], []);
  assert.throws(() => normalizeAvailability({ 1: [["10:00", "10:00"]] }), RangeError);
});

test("a lunch break produces two windows and no slots in the gap", () => {
  const slots = slotsFor(MONDAY);
  assert.equal(slots.length, 7, "three morning slots plus four afternoon slots");
  assert.deepEqual(slots.map((slot) => timeLabel(slot.start, NY)), ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"]);
  assert.equal(windowsForDate(normalizeAvailability(STAFF.availability), MONDAY).length, 2);
});

test("a slot must fit inside the working window", () => {
  const slots = slotsFor(MONDAY, { service: { durationMinutes: 90 } });
  assert.equal(slots.at(-1).start !== undefined, true);
  const lastLabel = timeLabel(slots.at(-1).start, NY);
  assert.equal(lastLabel, "15:00", "a 90-minute slot cannot start at 16:00");
});

test("buffers block the slot that would run into a booking", () => {
  const booking = { id: "b1", staffId: "st", start: Date.UTC(2026, 9, 26, 18, 0), end: Date.UTC(2026, 9, 26, 19, 0) }; // 14:00-15:00 New York
  const slots = slotsFor(MONDAY, { bookings: [booking], service: { bufferAfterMinutes: 15, bufferBeforeMinutes: 15 } });
  const labels = slots.map((slot) => timeLabel(slot.start, NY));
  assert.deepEqual(labels, ["09:00", "10:00", "11:00", "16:00"], "13:00, 14:00 and 15:00 all violate a buffer");
  assert.equal(labels.includes("12:00"), false, "12:00 is a lunch-break start");
});

test("blackouts remove slots and can be staff-specific", () => {
  const blackout = { id: "x", staffId: null, start: Date.UTC(2026, 9, 26, 17, 0), end: Date.UTC(2026, 9, 26, 19, 0) }; // 13:00-15:00 New York
  const slots = slotsFor(MONDAY, { blackouts: [blackout] });
  assert.deepEqual(slots.map((slot) => timeLabel(slot.start, NY)), ["09:00", "10:00", "11:00", "15:00", "16:00"]);
  const otherStaff = slotsFor(MONDAY, { blackouts: [{ ...blackout, staffId: "someone-else" }] });
  assert.equal(otherStaff.length, 7);
});

test("minimum notice filters slots too close to now", () => {
  const now = Date.UTC(2026, 9, 26, 9, 30); // 05:30 New York
  const slots = slotsFor(MONDAY, { now, service: { minNoticeMinutes: 240 } });
  assert.equal(slots[0].start >= now + 240 * 60_000, true);
  assert.equal(slots.length, 6, "05:30 New York plus four hours notice keeps 10:00 onward");
  assert.equal(timeLabel(slots[0].start, NY), "10:00");
});

test("an overnight window belongs to its starting date and crosses midnight", () => {
  const nightStaff = { ...STAFF, availability: { 1: [["22:00", "06:00"]] } };
  const slots = slotsFor(MONDAY, { staff: nightStaff });
  assert.equal(slots.length, 8);
  assert.deepEqual(slots.map((slot) => timeLabel(slot.start, NY)), ["22:00", "23:00", "00:00", "01:00", "02:00", "03:00", "04:00", "05:00"]);
  assert.equal(dateKeyInZone(slots[0].start, NY), MONDAY, "the first slot is on Monday");
  assert.equal(dateKeyInZone(slots[2].start, NY), "2026-10-27", "midnight is Tuesday in New York");
  assert.equal(slots.every((slot) => slot.dateKey === MONDAY), true, "the service date stays Monday");
});

test("spring-forward gaps are skipped, not invented", () => {
  const sundayStaff = { ...STAFF, availability: { 7: [["01:00", "04:00"]] } };
  const slots = slotsFor("2026-03-08", { staff: sundayStaff });
  assert.deepEqual(slots.map((slot) => timeLabel(slot.start, NY)), ["01:00", "03:00"]);
  assert.equal(slots.every((slot) => new Date(slot.start).getUTCMinutes() !== 30), true);
});

test("fall-back ambiguous starts resolve to the earlier instant", () => {
  const sundayStaff = { ...STAFF, availability: { 7: [["01:00", "03:00"]] } };
  const slots = slotsFor("2026-11-01", { staff: sundayStaff, service: { durationMinutes: 30, slotIntervalMinutes: 30 } });
  const labels = slots.map((slot) => timeLabel(slot.start, NY));
  assert.deepEqual(labels, ["01:00", "01:30", "02:00", "02:30"]);
  const oneThirty = slots.find((slot) => timeLabel(slot.start, NY) === "01:30");
  assert.equal(offsetMinutes(oneThirty.start, NY), -240, "the earlier occurrence is still EDT");
});

test("multi-staff availability flattens and sorts by start", () => {
  const second = { ...STAFF, id: "st2", name: "Second", availability: { 1: [["10:00", "13:00"]] } };
  const slots = generateDayAvailability({
    dateKey: MONDAY, timeZone: NY, service: SERVICE, staffList: [STAFF, second], now: EARLY,
  });
  assert.equal(slots[0].start <= slots[1].start, true);
  assert.equal(new Set(slots.map((slot) => slot.staffId)).size, 2);
  const groups = groupSlotsByStart(slots);
  assert.equal(groups.some((group) => group.slots.length === 2), true, "10:00 and 11:00 exist for both staff");
});

test("range availability keeps empty days in the result", () => {
  const range = generateRangeAvailability({
    startKey: "2026-10-24", days: 3, timeZone: NY, service: SERVICE, staffList: [STAFF], now: EARLY,
  });
  assert.deepEqual(range.map((day) => day.dateKey), ["2026-10-24", "2026-10-25", "2026-10-26"]);
  assert.equal(range[0].slots.length, 0, "Saturday");
  assert.equal(range[1].slots.length, 0, "Sunday");
  assert.equal(range[2].slots.length, 7, "Monday");
});

test("conflict detection uses half-open intervals", () => {
  assert.equal(intervalsOverlap(0, 10, 10, 20), false, "touching edges do not overlap");
  assert.equal(intervalsOverlap(0, 10, 9, 20), true);
  assert.equal(hasConflict({
    staffId: "st", start: 100, end: 200, paddedStart: 100, paddedEnd: 200,
    bookings: [{ staffId: "st", start: 200, end: 300 }],
  }), false);
  assert.equal(hasConflict({
    staffId: "st", start: 100, end: 200, paddedStart: 90, paddedEnd: 200,
    bookings: [{ staffId: "st", start: 200, end: 300 }],
  }), false, "padding before does not reach a booking that starts at the end");
  assert.equal(hasConflict({
    staffId: "st", start: 100, end: 200, paddedStart: 100, paddedEnd: 210,
    bookings: [{ staffId: "other", start: 200, end: 300 }],
  }), false, "another staff member's booking is not a conflict");
});
