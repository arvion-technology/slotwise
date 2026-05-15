/**
 * IANA timezone helpers for Slotwise.
 *
 * A booking engine cannot do "add 24 hours". A day is 23 hours long when a
 * zone springs forward and 25 when it falls back, and a wall time such as
 * 02:30 can exist zero times (spring gap) or twice (autumn overlap). Every
 * conversion here goes through Intl with an explicit IANA zone:
 *
 *   zonedParts(instant, zone)                 instant → wall clock parts
 *   offsetMinutes(instant, zone)              wall clock − UTC, in minutes
 *   zonedTimeToInstants(parts, zone)          wall clock → 0, 1 or 2 instants
 *   tryZonedTimeToInstant(parts, zone)        null on a spring-forward gap
 *   startOfZonedDay(dateKey, zone)            midnight, DST-safe
 *
 * The "0 or 2 instants" is the important part. A naive `new Date(y, m, d, h)`
 * hides both cases: it silently invents an instant in the gap and silently
 * picks one side of the overlap. The slot generator skips gaps and chooses the
 * earlier side of an overlap, which is the convention most calendars use.
 */

export const MINUTE = 60_000;
export const DAY = 86_400_000;

const formatterCache = new Map();

function formatter(timeZone) {
  let format = formatterCache.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    formatterCache.set(timeZone, format);
  }
  return format;
}

const WEEKDAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Calendar and clock parts of an instant in a zone. */
export function zonedParts(instant, timeZone) {
  if (!Number.isFinite(instant)) throw new TypeError("instant must be a timestamp");
  const parts = {};
  for (const part of formatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday] || 1,
  };
}

/** Offset from UTC in minutes at a given instant (positive east of Greenwich). */
export function offsetMinutes(instant, timeZone) {
  const p = zonedParts(instant, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - (instant - (instant % 1000))) / MINUTE);
}

/** Human offset, e.g. "UTC−04:00". */
export function offsetLabel(instant, timeZone) {
  const offset = offsetMinutes(instant, timeZone);
  const sign = offset < 0 ? "−" : "+";
  const abs = Math.abs(offset);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * All instants whose wall clock in `timeZone` reads the given parts.
 * Returns [] for a spring-forward gap, [one] normally, two in a fall-back overlap.
 */
export function zonedTimeToInstants({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsets = new Set();
  // Sample offsets on both sides of any plausible transition.
  for (const deltaHours of [-36, -24, -12, 0, 12, 24, 36]) {
    offsets.add(offsetMinutes(naive + deltaHours * 60 * MINUTE, timeZone));
  }
  const wanted = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  const matches = [];
  for (const offset of offsets) {
    const candidate = naive - offset * MINUTE;
    const p = zonedParts(candidate, timeZone);
    const seen = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
    if (seen === wanted) matches.push(candidate);
  }
  return [...new Set(matches)].sort((a, b) => a - b);
}

/**
 * Wall time → instant, or null when the wall time does not exist (spring gap).
 * `disambiguation: "later"` picks the second occurrence of an ambiguous time.
 */
export function tryZonedTimeToInstant(parts, timeZone, { disambiguation = "earlier" } = {}) {
  const list = zonedTimeToInstants(parts, timeZone);
  if (!list.length) return null;
  return disambiguation === "later" ? list[list.length - 1] : list[0];
}

export function dateKeyInZone(instant, timeZone) {
  const p = zonedParts(instant, timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateKey(key) {
  const match = DATE_RE.exec(key);
  if (!match) throw new TypeError(`invalid date key: ${key}`);
  const [, year, month, day] = match.map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError(`not a real date: ${key}`);
  }
  return { year, month, day };
}

export function formatDateKey(key) {
  const { year, month, day } = parseDateKey(key);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDaysToKey(key, days) {
  const { year, month, day } = parseDateKey(key);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function weekdayOfKey(key) {
  const { year, month, day } = parseDateKey(key);
  return ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
}

export function startOfWeekKey(key, startsOn = 1) {
  const shift = (weekdayOfKey(key) - startsOn + 7) % 7;
  return addDaysToKey(key, -shift);
}

export function weekDayKeys(startKey, count = 7) {
  return Array.from({ length: count }, (_, index) => addDaysToKey(startKey, index));
}

/** Midnight at the start of a calendar date in a zone. */
export function startOfZonedDay(dateKey, timeZone) {
  const { year, month, day } = parseDateKey(dateKey);
  for (let hour = 0; hour < 4; hour += 1) {
    const instant = tryZonedTimeToInstant({ year, month, day, hour }, timeZone);
    if (instant !== null) return instant;
  }
  throw new RangeError(`no valid midnight for ${dateKey} in ${timeZone}`);
}

/** Length of a calendar day in a zone: 23h, 24h or 25h. */
export function zonedDayLength(dateKey, timeZone) {
  const next = addDaysToKey(dateKey, 1);
  return startOfZonedDay(next, timeZone) - startOfZonedDay(dateKey, timeZone);
}

/** Minutes from midnight for an instant, in a zone. */
export function minutesOfDay(instant, timeZone) {
  const p = zonedParts(instant, timeZone);
  return p.hour * 60 + p.minute;
}

/** "09:30" in a zone, 24-hour clock. */
export function timeLabel(instant, timeZone) {
  const p = zonedParts(instant, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "Wed 28 Oct" in a zone. */
export function dayLabel(instant, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(new Date(instant));
}

/** "Wednesday, 28 October 2026" in a zone. */
export function longDayLabel(instant, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(instant));
}

export function shortTimeInZone(instant, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(instant));
}

export const VIEWER_ZONES = Object.freeze([
  "America/New_York",
  "Europe/London",
  "Asia/Kathmandu",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
]);
