/**
 * The sample studio.
 *
 * Four services, three practitioners, an eight-booking week and two blackout
 * blocks. The business runs on America/New_York on purpose: it has DST, which
 * is the case most booking demos quietly get wrong.
 *
 * All seeded dates are relative to the current week so the calendar always has
 * something in it, including at least one booking far enough in the future to
 * exercise the free-cancellation tier.
 */

import {
  addDaysToKey, dateKeyInZone, parseDateKey, startOfWeekKey, startOfZonedDay,
  tryZonedTimeToInstant, VIEWER_ZONES,
} from "./timezone.js";
import { DEFAULT_POLICY } from "./policy.js";
import { parseClock } from "./availability.js";

export const BUSINESS_TIMEZONE = "America/New_York";

export const STUDIO = Object.freeze({
  name: "Northline Studio",
  location: "12 Mercer Street, New York",
  email: "studio@northline.example",
  phone: "+1 212 555 0177",
});

export const SERVICES = Object.freeze([
  {
    id: "svc-discovery", name: "Discovery call", durationMinutes: 30,
    bufferBeforeMinutes: 0, bufferAfterMinutes: 10, slotIntervalMinutes: 15,
    minNoticeMinutes: 120, priceMinor: 15000, currency: "USD",
    description: "A short call to scope the work and decide whether we are a fit.",
  },
  {
    id: "svc-strategy", name: "Strategy session", durationMinutes: 60,
    bufferBeforeMinutes: 10, bufferAfterMinutes: 15, slotIntervalMinutes: 30,
    minNoticeMinutes: 240, priceMinor: 24000, currency: "USD",
    description: "Positioning, roadmap and the decisions that come before design.",
  },
  {
    id: "svc-review", name: "Design review", durationMinutes: 90,
    bufferBeforeMinutes: 15, bufferAfterMinutes: 15, slotIntervalMinutes: 30,
    minNoticeMinutes: 480, priceMinor: 36000, currency: "USD",
    description: "A structured critique of an existing product or design system.",
  },
  {
    id: "svc-workshop", name: "Half-day workshop", durationMinutes: 180,
    bufferBeforeMinutes: 15, bufferAfterMinutes: 30, slotIntervalMinutes: 60,
    minNoticeMinutes: 1440, priceMinor: 72000, currency: "USD",
    description: "Three hours with the team: mapping, sketching and a plan.",
  },
]);

export const STAFF = Object.freeze([
  {
    id: "st-maya", name: "Maya Chen", initials: "MC", role: "Design director",
    timeZone: BUSINESS_TIMEZONE,
    availability: {
      1: [["09:00", "12:00"], ["13:00", "17:00"]],
      2: [["09:00", "12:00"], ["13:00", "17:00"]],
      3: [["09:00", "12:00"], ["13:00", "17:00"]],
      4: [["09:00", "12:00"], ["13:00", "17:00"]],
      5: [["09:00", "13:00"]],
      6: [],
      7: [],
    },
  },
  {
    id: "st-jonas", name: "Jonas Berg", initials: "JB", role: "Strategy lead",
    timeZone: BUSINESS_TIMEZONE,
    availability: {
      1: [],
      2: [["10:00", "14:00"], ["15:00", "18:00"]],
      3: [["10:00", "14:00"], ["15:00", "18:00"]],
      4: [["10:00", "14:00"], ["15:00", "18:00"]],
      5: [["10:00", "14:00"], ["15:00", "18:00"]],
      6: [["10:00", "14:00"]],
      7: [],
    },
  },
  {
    id: "st-priya", name: "Priya Nair", initials: "PN", role: "Product engineer",
    timeZone: BUSINESS_TIMEZONE,
    availability: {
      1: [["08:00", "12:00"]],
      2: [["14:00", "19:00"]],
      3: [["08:00", "12:00"]],
      4: [["14:00", "19:00"]],
      5: [["08:00", "12:00"]],
      6: [],
      7: [],
    },
  },
]);

export function serviceById(services, id) {
  return services.find((service) => service.id === id) || services[0];
}

export function staffById(staffList, id) {
  return staffList.find((member) => member.id === id) || staffList[0];
}

function wallInstant(dateKey, clock, timeZone) {
  const { year, month, day } = parseDateKey(dateKey);
  const minutes = parseClock(clock);
  return tryZonedTimeToInstant({ year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60 }, timeZone);
}

function makeBooking({ id, dateKey, clock, service, staff, customer, notes = "" }) {
  const start = wallInstant(dateKey, clock, BUSINESS_TIMEZONE);
  if (start === null) throw new Error(`seed booking ${id} falls in a DST gap`);
  return {
    id,
    dateKey,
    serviceId: service.id,
    serviceName: service.name,
    staffId: staff.id,
    staffName: staff.name,
    start,
    end: start + service.durationMinutes * 60_000,
    priceMinor: service.priceMinor,
    currency: service.currency,
    customer,
    notes,
    status: "confirmed",
  };
}

export function buildSampleData({ now = Date.now() } = {}) {
  const todayKey = dateKeyInZone(now, BUSINESS_TIMEZONE);
  const weekStartKey = startOfWeekKey(todayKey, 1);
  const day = (offset) => addDaysToKey(weekStartKey, offset);

  const maya = staffById(STAFF, "st-maya");
  const jonas = staffById(STAFF, "st-jonas");
  const priya = staffById(STAFF, "st-priya");
  const discovery = serviceById(SERVICES, "svc-discovery");
  const strategy = serviceById(SERVICES, "svc-strategy");
  const review = serviceById(SERVICES, "svc-review");
  const workshop = serviceById(SERVICES, "svc-workshop");

  const bookings = [
    makeBooking({
      id: "bk-1001", dateKey: day(0), clock: "10:00", service: strategy, staff: maya,
      customer: { name: "Dana Whitfield", email: "dana@kestrelhealth.example", company: "Kestrel Health" },
      notes: "Bring the current onboarding flow.",
    }),
    makeBooking({
      id: "bk-1002", dateKey: day(1), clock: "10:00", service: workshop, staff: jonas,
      customer: { name: "Maya Trudeau", email: "maya@beaconlearning.example", company: "Beacon Learning" },
      notes: "Half-day planning workshop with the curriculum team.",
    }),
    makeBooking({
      id: "bk-1003", dateKey: day(1), clock: "14:00", service: review, staff: jonas,
      customer: { name: "Anish Shrestha", email: "anish@sundara.example", company: "Sundara Coffee" },
      notes: "Review the packaging system before print.",
    }),
    makeBooking({
      id: "bk-1004", dateKey: day(2), clock: "09:30", service: discovery, staff: maya,
      customer: { name: "Harriet Ellis", email: "harriet@loomledger.example", company: "Loom & Ledger" },
      notes: "Inbound from the pricing page.",
    }),
    makeBooking({
      id: "bk-1005", dateKey: day(4), clock: "10:00", service: discovery, staff: priya,
      customer: { name: "Jonas Berg", email: "jonas@atlasfield.example", company: "Atlas Field Co" },
      notes: "Technical scoping call.",
    }),
    makeBooking({
      id: "bk-1006", dateKey: day(7), clock: "09:00", service: strategy, staff: priya,
      customer: { name: "Aiko Tanaka", email: "aiko@hoshino.example", company: "Hoshino Works" },
      notes: "First session after the audit.",
    }),
    makeBooking({
      id: "bk-1007", dateKey: day(8), clock: "15:00", service: discovery, staff: maya,
      customer: { name: "Ben Okafor", email: "ben@trellis.example", company: "Trellis Labs" },
      notes: "",
    }),
    makeBooking({
      id: "bk-1008", dateKey: day(3), clock: "10:30", service: review, staff: maya,
      customer: { name: "Rupa Gurung", email: "rupa@kanchen.example", company: "Kanchen Studio" },
      notes: "Accessibility review of the new booking widget.",
    }),
  ];

  const deepWorkStart = wallInstant(day(3), "13:00", BUSINESS_TIMEZONE);
  const deepWorkEnd = wallInstant(day(3), "17:00", BUSINESS_TIMEZONE);
  const offsiteDay = day(7);
  const blackouts = [
    {
      id: "bl-deep-work",
      start: deepWorkStart,
      end: deepWorkEnd,
      staffId: null,
      reason: "Studio deep-work block",
    },
    {
      id: "bl-offsite",
      start: startOfZonedDay(offsiteDay, BUSINESS_TIMEZONE),
      end: startOfZonedDay(addDaysToKey(offsiteDay, 1), BUSINESS_TIMEZONE),
      staffId: null,
      reason: "Team offsite",
    },
  ];

  return {
    timeZone: BUSINESS_TIMEZONE,
    viewerZones: [...new Set([BUSINESS_TIMEZONE, "Europe/London", "Asia/Kathmandu", "Asia/Tokyo", "Australia/Sydney", "UTC"])],
    studio: STUDIO,
    services: SERVICES,
    staff: STAFF,
    bookings,
    blackouts,
    policy: DEFAULT_POLICY,
    todayKey,
    weekStartKey,
    now,
    meta: {
      label: "Sample studio, three practitioners, four services, one week",
      generatedAt: now,
    },
  };
}
