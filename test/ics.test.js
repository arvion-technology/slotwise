import test from "node:test";
import assert from "node:assert/strict";

import {
  buildICS, parseICS, escapeText, unescapeText, foldLine, formatICSDate, parseICSDate, unfoldLines,
} from "../src/ics.js";

const NOW = Date.UTC(2026, 9, 28, 12, 0);
const BOOKING = {
  id: "bk-1001",
  start: Date.UTC(2026, 10, 2, 14, 0),
  end: Date.UTC(2026, 10, 2, 15, 0),
  serviceName: "Strategy session",
  staffName: "Maya Chen",
  location: "12 Mercer Street, New York",
  customer: { name: "Dana Whitfield", email: "dana@kestrelhealth.example" },
  notes: "Bring the current onboarding flow, plus the pricing page.",
};

test("an exported calendar has the required envelope and CRLF line endings", () => {
  const ics = buildICS([BOOKING], { now: NOW });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /VERSION:2\.0\r\n/);
  assert.match(ics, /PRODID:-\/\/Arvion Technologies\/\/Slotwise\/\/EN\r\n/);
  assert.match(ics, /BEGIN:VEVENT\r\n/);
  assert.match(ics, /UID:bk-1001@slotwise\.arviontech\.net\r\n/);
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal(ics.includes("\n") && !ics.includes("\r\n"), false);
  assert.equal((ics.match(/\r\n/g) || []).length, ics.split("\r\n").length - 1);
});

test("UTC timestamps ignore the machine timezone", () => {
  assert.equal(formatICSDate(Date.UTC(2026, 9, 28, 12, 0)), "20261028T120000Z");
  assert.equal(parseICSDate("20261028T120000Z"), Date.UTC(2026, 9, 28, 12, 0));
  assert.equal(parseICSDate("2026-10-28"), null);
  assert.equal(formatICSDate(BOOKING.start), "20261102T140000Z");
});

test("text values escape structural characters and round-trip", () => {
  assert.equal(escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  assert.equal(unescapeText(escapeText("a,b;c\\d\ne")), "a,b;c\\d\ne");
  assert.equal(escapeText(""), "");
});

test("long lines fold at 75 octets and unfold back to the logical line", () => {
  const original = `DESCRIPTION:${"long description text ".repeat(8)}`;
  const folded = foldLine(original);
  const physical = folded.split("\r\n");
  assert.ok(physical.length > 1);
  for (const line of physical) assert.ok(new TextEncoder().encode(line).length <= 75, `too long: ${line.length}`);
  assert.equal(unfoldLines(`${folded}\r\nEND:VCALENDAR`)[0], original);
  const unicode = foldLine(`SUMMARY:${"é".repeat(60)}`);
  for (const line of unicode.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75);
});

test("the exported calendar parses back into the same booking", () => {
  const ics = buildICS([BOOKING], { now: NOW });
  const parsed = parseICS(ics);
  assert.equal(parsed.calendarName, "Slotwise bookings");
  assert.equal(parsed.events.length, 1);
  const [event] = parsed.events;
  assert.equal(event.uid, "bk-1001@slotwise.arviontech.net");
  assert.equal(event.DTSTART, BOOKING.start);
  assert.equal(event.DTEND, BOOKING.end);
  assert.match(event.summary, /Strategy session — Dana Whitfield/);
  assert.match(event.description, /Maya Chen/);
  assert.match(event.description, /Bring the current onboarding flow, plus the pricing page/);
  assert.equal(event.location, "12 Mercer Street, New York");
  assert.equal(event.status, "CONFIRMED");
  assert.equal(event.attendee, "mailto:dana@kestrelhealth.example");
});

test("cancelled bookings export as CANCELLED", () => {
  const ics = buildICS([{ ...BOOKING, status: "cancelled" }], { now: NOW });
  assert.match(ics, /STATUS:CANCELLED/);
});

test("multiple bookings produce multiple events", () => {
  const ics = buildICS([BOOKING, { ...BOOKING, id: "bk-2" }], { now: NOW });
  assert.equal(parseICS(ics).events.length, 2);
});
