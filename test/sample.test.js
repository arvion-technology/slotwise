import test from "node:test";
import assert from "node:assert/strict";

import { buildSampleData, BUSINESS_TIMEZONE, serviceById, staffById } from "../src/sample.js";
import { generateDayAvailability, intervalsOverlap } from "../src/availability.js";
import { dateKeyInZone, startOfWeekKey, weekdayOfKey, addDaysToKey } from "../src/timezone.js";

const NOW = Date.UTC(2026, 9, 28, 12, 0);
const sample = buildSampleData({ now: NOW });

test("the seeded studio is internally consistent", () => {
  assert.equal(sample.timeZone, BUSINESS_TIMEZONE);
  assert.equal(sample.bookings.length, 8);
  assert.equal(new Set(sample.bookings.map((booking) => booking.id)).size, 8);
  assert.equal(weekdayOfKey(sample.weekStartKey), 1, "the sample week starts on Monday");
  for (const booking of sample.bookings) {
    assert.ok(booking.end > booking.start, `${booking.id} ends after it starts`);
    assert.ok(serviceById(sample.services, booking.serviceId), `${booking.id} has a real service`);
    assert.ok(staffById(sample.staff, booking.staffId), `${booking.id} has a real staff member`);
    assert.ok(booking.customer.name && booking.customer.email, `${booking.id} has a customer`);
  }
  for (const blackout of sample.blackouts) assert.ok(blackout.end > blackout.start);
});

test("generated slots never collide with seeded bookings or blackouts", () => {
  const service = serviceById(sample.services, "svc-strategy");
  const future = addDaysToKey(sample.weekStartKey, 9);
  const slots = generateDayAvailability({
    dateKey: future, timeZone: sample.timeZone, service,
    staffList: sample.staff, bookings: sample.bookings, blackouts: sample.blackouts, now: NOW,
  });
  assert.ok(slots.length > 0, "the future Tuesday has availability");
  for (const slot of slots) {
    const paddedStart = slot.start - service.bufferBeforeMinutes * 60_000;
    const paddedEnd = slot.end + service.bufferAfterMinutes * 60_000;
    for (const booking of sample.bookings.filter((row) => row.staffId === slot.staffId)) {
      assert.equal(intervalsOverlap(paddedStart, paddedEnd, booking.start, booking.end), false, `${slot.id} collides with ${booking.id}`);
    }
    for (const blackout of sample.blackouts) {
      assert.equal(intervalsOverlap(paddedStart, paddedEnd, blackout.start, blackout.end), false, `${slot.id} is inside ${blackout.id}`);
    }
  }
});

test("the offsite blackout closes a whole day", () => {
  const offsite = addDaysToKey(startOfWeekKey(dateKeyInZone(NOW, sample.timeZone), 1), 7);
  const service = serviceById(sample.services, "svc-discovery");
  // The next Monday is only partially covered by Priya's hours; nothing should be generated.
  const slots = generateDayAvailability({
    dateKey: offsite, timeZone: sample.timeZone, service,
    staffList: sample.staff, bookings: sample.bookings, blackouts: sample.blackouts, now: NOW,
  });
  assert.equal(slots.length, 0);
});
