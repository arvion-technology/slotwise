/**
 * Availability and slot generation.
 *
 * Inputs are calendar-shaped (staff working hours per weekday, expressed as
 * wall-clock windows in the staff member's IANA zone). Outputs are instants.
 * The conversion between the two is the whole job, and it has three sharp
 * edges that are easy to get wrong:
 *
 *   1. A window can cross midnight ("22:00"–"06:00"). It belongs to the
 *      starting date, and the slots after midnight are on the next date.
 *   2. A wall time can be missing (spring forward) or repeated (fall back).
 *      Missing starts are skipped; repeated starts resolve to the earlier
 *      instant. Slot generation never invents a 02:30 that did not happen.
 *   3. A service has buffers. A 10-minute prep buffer before an appointment
 *      and a 15-minute reset after it are part of the occupied interval, so a
 *      slot only conflicts when the *buffered* interval overlaps.
 *
 * The slot must fit inside the working window; buffers may extend outside the
 * window because no other appointment sits there (prep before the first
 * meeting is still inside the day, just before opening).
 */

import {
  MINUTE, addDaysToKey, parseDateKey, tryZonedTimeToInstant, weekdayOfKey,
} from "./timezone.js";

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "09:30" → 570. Throws on anything that is not a wall clock time. */
export function parseClock(clock) {
  const match = CLOCK_RE.exec(String(clock));
  if (!match) throw new TypeError(`invalid clock time: ${clock}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatClock(minutes) {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** Normalise and validate a weekly availability object keyed by ISO weekday. */
export function normalizeAvailability(availability) {
  const out = {};
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const windows = availability?.[weekday] || [];
    out[weekday] = windows.map((window) => {
      const [start, end] = Array.isArray(window) ? window : [window.start, window.end];
      const startMinute = parseClock(start);
      const endMinute = parseClock(end);
      if (startMinute === endMinute) throw new RangeError(`zero-length window on weekday ${weekday}`);
      return { start: startMinute, end: endMinute };
    });
  }
  return out;
}

function windowLength(window) {
  return window.end > window.start ? window.end - window.start : window.end + 1440 - window.start;
}

function wallInstant(dateKey, minutesFromMidnight, timeZone) {
  const { year, month, day } = parseDateKey(dateKey);
  const shiftDays = Math.floor(minutesFromMidnight / 1440);
  const inDay = ((minutesFromMidnight % 1440) + 1440) % 1440;
  const targetKey = shiftDays ? addDaysToKey(dateKey, shiftDays) : dateKey;
  const parts = parseDateKey(targetKey);
  void year; void month; void day;
  return tryZonedTimeToInstant({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Math.floor(inDay / 60),
    minute: inDay % 60,
  }, timeZone);
}

export function windowsForDate(availability, dateKey) {
  return availability[weekdayOfKey(dateKey)] || [];
}

export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function conflicts(intervalStart, intervalEnd, blocks) {
  return blocks.some((block) => intervalsOverlap(intervalStart, intervalEnd, block.start, block.end));
}

/**
 * Generate bookable start instants for one staff member on one calendar date.
 *
 * @param {{dateKey:string, timeZone:string, service:object, staff:object,
 *          availability?:object, bookings?:object[], blackouts?:object[],
 *          now?:number}} input
 * @returns {object[]} slots with absolute start/end instants
 */
export function generateSlots({
  dateKey, timeZone, service, staff, availability = null, bookings = [], blackouts = [], now = Date.now(),
}) {
  const hours = normalizeAvailability(availability || staff.availability);
  const windows = windowsForDate(hours, dateKey);
  const duration = Number(service.durationMinutes);
  if (!Number.isInteger(duration) || duration <= 0) throw new RangeError("service.durationMinutes must be a positive integer");
  const interval = Number(service.slotIntervalMinutes || duration);
  if (!Number.isInteger(interval) || interval <= 0) throw new RangeError("slotIntervalMinutes must be a positive integer");
  const bufferBefore = Number(service.bufferBeforeMinutes || 0);
  const bufferAfter = Number(service.bufferAfterMinutes || 0);
  const minNotice = Number(service.minNoticeMinutes || 0);
  const earliest = now + minNotice * MINUTE;

  const staffBookings = bookings
    .filter((booking) => !booking.staffId || booking.staffId === staff.id)
    .map((booking) => ({ start: booking.start, end: booking.end }));
  const staffBlackouts = blackouts.filter((blackout) => !blackout.staffId || blackout.staffId === staff.id);

  const slots = [];
  for (const window of windows) {
    const length = windowLength(window);
    const latestStart = length - duration;
    for (let offset = 0; offset <= latestStart; offset += interval) {
      if (slots.length > 500) throw new RangeError("too many slots for one day");
      const start = wallInstant(dateKey, window.start + offset, timeZone);
      if (start === null) continue; // spring-forward gap: the wall time does not exist
      const end = start + duration * MINUTE;
      const windowEndMinutes = window.start + length;
      const windowEnd = wallInstant(dateKey, windowEndMinutes, timeZone);
      if (windowEnd !== null && end > windowEnd) continue;
      if (start < earliest) continue;
      const occupiedStart = start - bufferBefore * MINUTE;
      const occupiedEnd = end + bufferAfter * MINUTE;
      if (conflicts(occupiedStart, occupiedEnd, staffBookings)) continue;
      if (conflicts(occupiedStart, occupiedEnd, staffBlackouts)) continue;
      slots.push({
        id: `${staff.id}-${dateKey}-${offset}`,
        staffId: staff.id,
        serviceId: service.id,
        dateKey,
        start,
        end,
        durationMinutes: duration,
        bufferBeforeMinutes: bufferBefore,
        bufferAfterMinutes: bufferAfter,
      });
    }
  }
  return slots.sort((a, b) => a.start - b.start);
}

/** Slots for one date across several staff, flattened in start order. */
export function generateDayAvailability({
  dateKey, timeZone, service, staffList, bookings = [], blackouts = [], now = Date.now(),
}) {
  return staffList
    .flatMap((staff) => generateSlots({ dateKey, timeZone, service, staff, bookings, blackouts, now }))
    .sort((a, b) => a.start - b.start || a.staffId.localeCompare(b.staffId));
}

/** Slots for a run of dates, including dates with no availability. */
export function generateRangeAvailability({
  startKey, days = 7, timeZone, service, staffList, bookings = [], blackouts = [], now = Date.now(),
}) {
  return Array.from({ length: days }, (_, index) => {
    const dateKey = addDaysToKey(startKey, index);
    return {
      dateKey,
      slots: generateDayAvailability({ dateKey, timeZone, service, staffList, bookings, blackouts, now }),
    };
  });
}

/** Group slots by their start instant, useful for a time-first picker. */
export function groupSlotsByStart(slots) {
  const groups = new Map();
  for (const slot of slots) {
    if (!groups.has(slot.start)) groups.set(slot.start, { start: slot.start, slots: [] });
    groups.get(slot.start).slots.push(slot);
  }
  return [...groups.values()].sort((a, b) => a.start - b.start);
}

/** Does a proposed booking overlap an existing one for the same staff member? */
export function hasConflict({
  staffId, start, end, bookings = [], blackouts = [], paddedStart = start, paddedEnd = end,
}) {
  const bookingConflict = bookings.some((booking) =>
    (!booking.staffId || booking.staffId === staffId)
    && intervalsOverlap(paddedStart, paddedEnd, booking.start, booking.end));
  const blackoutConflict = blackouts.some((blackout) =>
    (!blackout.staffId || blackout.staffId === staffId)
    && intervalsOverlap(paddedStart, paddedEnd, blackout.start, blackout.end));
  return bookingConflict || blackoutConflict;
}
