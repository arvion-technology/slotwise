/**
 * ICS (RFC 5545) serialisation for bookings.
 *
 * Three details are what make an exported calendar file open in Google
 * Calendar, Apple Calendar and Outlook rather than one of them:
 *
 *   - every line ends with CRLF, not LF;
 *   - long lines are folded at 75 octets, with continuation lines beginning
 *     with a single space;
 *   - commas, semicolons, backslashes and newlines inside text values are
 *     escaped, because those characters are structural in the format.
 *
 * Times are written in UTC (`...Z`). A booking at 09:00 in New York therefore
 * exports as 13:00Z or 14:00Z depending on the date, and the receiving calendar
 * displays it correctly for its own zone.
 */

export const CRLF = "\r\n";

const encoder = new TextEncoder();
const byteLength = (text) => encoder.encode(text).length;

/** Escape a TEXT value per RFC 5545 §3.3.11. */
export function escapeText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold a logical line into 75-octet physical lines (UTF-8 safe). */
export function foldLine(line) {
  if (byteLength(line) <= 75) return line;
  const chunks = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = byteLength(char);
    const limit = chunks.length === 0 ? 75 : 74; // continuation lines carry a leading space
    if (bytes + size > limit) {
      chunks.push(current);
      current = char;
      bytes = size;
    } else {
      current += char;
      bytes += size;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((chunk, index) => (index === 0 ? chunk : ` ${chunk}`)).join(CRLF);
}

/** UTC timestamp as required by DATE-TIME: 20261028T090000Z. */
export function formatICSDate(instant) {
  const d = new Date(instant);
  if (Number.isNaN(+d)) throw new TypeError("invalid instant");
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function parseICSDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
}

function eventFor(booking, { now, domain, organizer }) {
  const serviceName = booking.serviceName || booking.summary || "Appointment";
  const staffName = booking.staffName || null;
  const customer = booking.customer || {};
  const description = [
    serviceName,
    staffName ? `With ${staffName}` : null,
    booking.notes ? booking.notes : null,
    booking.id ? `Booking ${booking.id}` : null,
  ].filter(Boolean).join("\n");
  const lines = [
    "BEGIN:VEVENT",
    `UID:${booking.id}@${domain}`,
    `DTSTAMP:${formatICSDate(now)}`,
    `DTSTART:${formatICSDate(booking.start)}`,
    `DTEND:${formatICSDate(booking.end)}`,
    `SUMMARY:${escapeText(`${serviceName}${customer.name ? ` — ${customer.name}` : ""}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(booking.location || "Studio")}`,
    `STATUS:${booking.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
  ];
  if (organizer?.email) {
    lines.push(`ORGANIZER;CN=${escapeText(organizer.name || "Studio")}:mailto:${organizer.email}`);
  }
  if (customer.email) {
    lines.push(`ATTENDEE;CN=${escapeText(customer.name || "Guest")};RSVP=TRUE:mailto:${customer.email}`);
  }
  lines.push("END:VEVENT");
  return lines;
}

/** Build a complete VCALENDAR string. */
export function buildICS(bookings, {
  now = Date.now(),
  domain = "slotwise.arviontech.net",
  calendarName = "Slotwise bookings",
  organizer = { name: "Northline Studio", email: "studio@northline.example" },
  productId = "-//Arvion Technologies//Slotwise//EN",
} = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${productId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    ...bookings.flatMap((booking) => eventFor(booking, { now, domain, organizer })),
    "END:VCALENDAR",
  ];
  return lines.map((line) => foldLine(line)).join(CRLF) + CRLF;
}

/** Unfold physical lines into logical lines. */
export function unfoldLines(text) {
  return String(text).replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

/**
 * A deliberately small reader: enough to verify our own export in tests and to
 * show the structure on screen. It does not handle VTIMEZONE, recurrence or
 * parameters beyond the simple KEY;PARAM=value form.
 */
export function parseICS(text) {
  const lines = unfoldLines(text).filter(Boolean);
  const events = [];
  let calendarName = null;
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { current = {}; continue; }
    if (line === "END:VEVENT") { if (current) events.push(current); current = null; continue; }
    if (line === "BEGIN:VCALENDAR" || line === "END:VCALENDAR") continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const rawKey = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const key = rawKey.split(";")[0];
    if (!current) {
      if (key === "X-WR-CALNAME") calendarName = unescapeText(value);
      continue;
    }
    if (key === "DTSTART" || key === "DTEND") current[key] = parseICSDate(value);
    else if (key === "UID") current.uid = value;
    else if (key === "SUMMARY") current.summary = unescapeText(value);
    else if (key === "DESCRIPTION") current.description = unescapeText(value);
    else if (key === "LOCATION") current.location = unescapeText(value);
    else if (key === "STATUS") current.status = value;
    else if (key === "ORGANIZER") current.organizer = value;
    else if (key === "ATTENDEE") current.attendee = value;
  }
  return { calendarName, events };
}

export function unescapeText(value) {
  return String(value)
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}
