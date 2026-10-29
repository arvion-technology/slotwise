// Slotwise, demo application.
// All slot generation, timezone conversion, ICS output and cancellation quotes
// come from ../src/*.js. This file renders them and handles the booking flow.
import {
  addDaysToKey, dateKeyInZone, dayLabel, longDayLabel, minutesOfDay, offsetLabel,
  parseDateKey, startOfWeekKey, startOfZonedDay, timeLabel, tryZonedTimeToInstant,
  weekDayKeys, zonedParts,
} from "../src/timezone.js";
import {
  generateRangeAvailability, generateSlots, groupSlotsByStart, hasConflict, parseClock,
} from "../src/availability.js";
import { buildICS } from "../src/ics.js";
import { cancellationQuote, policyTable, rescheduleQuote } from "../src/policy.js";
import { buildSampleData } from "../src/sample.js";

const $ = A.$, $$ = A.$$, el = A.el;
const STORE_KEY = "slotwise:v1";
const MINUTE = 60_000;
const DISPLAY_START_HOUR = 7;
const DISPLAY_END_HOUR = 20;
const HOUR_PX = 44;
const DISPLAY_HEIGHT = (DISPLAY_END_HOUR - DISPLAY_START_HOUR) * HOUR_PX;

const SAMPLE = buildSampleData({ now: Date.now() });
const saved = A.store.get(STORE_KEY);
let DB = {
  ...SAMPLE,
  bookings: Array.isArray(saved?.bookings) && saved.bookings.length ? saved.bookings : SAMPLE.bookings,
};

const state = {
  view: "week",
  timeZone: DB.timeZone,
  weekOffset: 0,
  selectedDayKey: null,
  serviceId: DB.services[1].id,
  staffId: "all",
  autoPick: true,
  bookingScope: "upcoming",
  bookingService: "all",
};

const now = () => Date.now();
const serviceById = (id) => DB.services.find((service) => service.id === id) || DB.services[0];
const staffById = (id) => DB.staff.find((member) => member.id === id) || DB.staff[0];
const selectedService = () => serviceById(state.serviceId);
const selectedStaffList = () => (state.staffId === "all" ? DB.staff : DB.staff.filter((member) => member.id === state.staffId));
const viewerTodayKey = () => dateKeyInZone(now(), state.timeZone);
const displayWeekStart = () => addDaysToKey(startOfWeekKey(viewerTodayKey(), 1), state.weekOffset * 7);

function persist() {
  if (!A.store.set(STORE_KEY, { bookings: DB.bookings })) A.toast("Could not save bookings in this browser", "error");
}

function money(minor) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);
}

function keyToDate(key) {
  return new Date(`${key}T00:00:00Z`);
}

function shortKey(key) {
  return keyToDate(key).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function weekRangeLabel(startKey) {
  const start = keyToDate(startKey);
  const end = keyToDate(addDaysToKey(startKey, 6));
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${startLabel}, ${endLabel} ${end.getUTCFullYear()}`;
}

function wallInstant(dateKey, minutesFromMidnight, timeZone) {
  const shift = Math.floor(minutesFromMidnight / 1440);
  const targetKey = shift ? addDaysToKey(dateKey, shift) : dateKey;
  const inDay = ((minutesFromMidnight % 1440) + 1440) % 1440;
  const { year, month, day } = parseDateKey(targetKey);
  return tryZonedTimeToInstant({ year, month, day, hour: Math.floor(inDay / 60), minute: inDay % 60 }, timeZone);
}

/* --------------------------------------------------------------- week data */

function slotsAroundWeek() {
  const service = selectedService();
  const start = addDaysToKey(displayWeekStart(), -2);
  const range = generateRangeAvailability({
    startKey: start,
    days: 11,
    timeZone: DB.timeZone,
    service,
    staffList: selectedStaffList(),
    bookings: DB.bookings,
    blackouts: DB.blackouts,
    now: now(),
  });
  return range.flatMap((day) => day.slots);
}

function slotsForViewerDay(dayKey) {
  return slotsAroundWeek().filter((slot) => dateKeyInZone(slot.start, state.timeZone) === dayKey);
}

function viewerMinutes(instant) {
  const parts = zonedParts(instant, state.timeZone);
  return parts.hour * 60 + parts.minute;
}

function visibleTop(instant) {
  return ((viewerMinutes(instant) - DISPLAY_START_HOUR * 60) / 60) * HOUR_PX;
}

/**
 * Working-hour bands, merged across staff. A viewer day can be fed by two
 * business dates when the zones are far apart, so the two neighbouring dates
 * are converted too and only the pieces that land on this viewer date survive.
 */
function availabilityBandsForDay(dayKey) {
  const bands = [];
  for (const staff of selectedStaffList()) {
    for (let offset = -1; offset <= 1; offset += 1) {
      const businessDate = addDaysToKey(dayKey, offset);
      const weekday = ((keyToDate(businessDate).getUTCDay() + 6) % 7) + 1;
      for (const window of staff.availability[weekday] || []) {
        const [openClock, closeClock] = Array.isArray(window) ? window : [window.start, window.end];
        const open = parseClock(openClock);
        let close = parseClock(closeClock);
        if (close <= open) close += 1440;
        const start = wallInstant(businessDate, open, DB.timeZone);
        const end = wallInstant(businessDate, close, DB.timeZone);
        if (start === null || end === null) continue;
        if (dateKeyInZone(start, state.timeZone) !== dayKey || dateKeyInZone(end, state.timeZone) !== dayKey) continue;
        bands.push({ start: viewerMinutes(start), end: viewerMinutes(end) });
      }
    }
  }
  bands.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const band of bands) {
    const last = merged[merged.length - 1];
    if (last && band.start <= last.end) last.end = Math.max(last.end, band.end);
    else merged.push({ ...band });
  }
  return merged;
}

/* ------------------------------------------------------------------ chrome */

function renderChrome() {
  $$("[data-view]").forEach((link) => link.classList.toggle("active", link.dataset.view === state.view));
  const upcoming = DB.bookings.filter((booking) => booking.start >= now()).length;
  $("#nav-booking-count").textContent = String(upcoming);
  $("#topbar-meta").textContent = `${DB.services.length} services · ${DB.staff.length} practitioners · ${DB.bookings.length} bookings`;
  $("#business-zone-badge").textContent = `${DB.timeZone} · ${offsetLabel(now(), DB.timeZone)}`;
  $("#sidebar-stats").replaceChildren(
    el("span", { text: `${upcoming} upcoming sessions` }),
    el("br"),
    el("span", { text: `Business hours in ${DB.timeZone}` }),
  );
  const viewer = $("#viewer-zone");
  if (!viewer.options.length) {
    viewer.replaceChildren(...DB.viewerZones.map((zone) => el("option", { value: zone, text: zone })));
  }
  viewer.value = state.timeZone;
}

/* -------------------------------------------------------------- week view */

function selectDay(dayKey) {
  state.selectedDayKey = dayKey;
  state.autoPick = false;
  renderWeek();
}

function shiftWeek(delta) {
  state.weekOffset += delta;
  state.autoPick = true;
  const start = displayWeekStart();
  const today = viewerTodayKey();
  state.selectedDayKey = delta === 0 && today >= start && today <= addDaysToKey(start, 6)
    ? today
    : addDaysToKey(start, 1);
  renderWeek();
}

function renderWeekGrid(startKey) {
  const days = weekDayKeys(startKey, 7);
  const today = viewerTodayKey();
  const hourCount = DISPLAY_END_HOUR - DISPLAY_START_HOUR;
  const head = el("div", { class: "week-head" }, el("div", { class: "wd-spacer" }),
    ...days.map((dayKey) => {
      const date = keyToDate(dayKey);
      return el("div", {
        class: `wd-head ${state.selectedDayKey === dayKey ? "active" : ""} ${dayKey === today ? "today" : ""}`,
        "data-day": dayKey,
        onclick: () => selectDay(dayKey),
      },
      el("div", { class: "dow", text: date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }) }),
      el("div", { class: "dnum", text: String(date.getUTCDate()) }));
    }));

  const timeColumn = el("div", { class: "week-times" },
    ...Array.from({ length: hourCount }, (_, index) => el("span", {
      style: `top:${index * HOUR_PX}px`,
      text: `${String(DISPLAY_START_HOUR + index).padStart(2, "0")}:00`,
    })));

  const bookingColour = {};
  DB.services.forEach((service, index) => {
    bookingColour[service.id] = ["gold", "blue", "green", "purple"][index % 4];
  });

  const columns = days.map((dayKey) => {
    const column = el("div", {
      class: `week-col ${state.selectedDayKey === dayKey ? "active" : ""}`,
      "data-day": dayKey,
      onclick: () => selectDay(dayKey),
    });

    for (const band of availabilityBandsForDay(dayKey)) {
      const top = ((band.start - DISPLAY_START_HOUR * 60) / 60) * HOUR_PX;
      const height = ((band.end - band.start) / 60) * HOUR_PX;
      if (top + height <= 0 || top >= DISPLAY_HEIGHT) continue;
      const clampedTop = Math.max(0, top);
      const clampedBottom = Math.min(DISPLAY_HEIGHT, top + height);
      column.append(el("div", {
        class: "avail-band",
        style: `top:${clampedTop}px;height:${Math.max(2, clampedBottom - clampedTop)}px`,
      }));
    }

    for (const booking of DB.bookings.filter((row) => dateKeyInZone(row.start, state.timeZone) === dayKey)) {
      const top = visibleTop(booking.start);
      const height = ((booking.end - booking.start) / MINUTE / 60) * HOUR_PX;
      if (top + height <= 0 || top >= DISPLAY_HEIGHT) continue;
      column.append(el("div", {
        class: `booking-block ${bookingColour[booking.serviceId] || "gold"}`,
        style: `top:${Math.max(0, top)}px;height:${Math.max(20, height)}px`,
        onclick: (event) => { event.stopPropagation(); openBookingDetail(booking); },
      },
      el("span", { class: "b-time", text: `${timeLabel(booking.start, state.timeZone)} · ${money(booking.priceMinor)}` }),
      el("span", { class: "b-title", text: booking.serviceName }),
      el("span", { class: "b-who", text: booking.customer.name })));
    }

    if (dayKey === today) {
      const top = visibleTop(now());
      if (top >= 0 && top <= DISPLAY_HEIGHT) column.append(el("div", { class: "now-line", style: `top:${top}px` }));
    }
    return column;
  });

  return el("div", { class: "week-grid-inner" }, head, el("div", { class: "week-body" }, timeColumn, ...columns));
}

function renderSlotPanel(slots) {
  const groups = groupSlotsByStart(slots).filter((group) => {
    const minutes = viewerMinutes(group.start);
    return minutes >= DISPLAY_START_HOUR * 60 && minutes < DISPLAY_END_HOUR * 60;
  });

  if (!groups.length) {
    return el("div", { class: "slot-empty" },
      el("div", { text: "No open slots on this day." }),
      el("button", {
        class: "btn sm", style: "margin-top:10px",
        onclick: () => {
          const start = displayWeekStart();
          for (let offset = 0; offset < 7; offset += 1) {
            const candidate = addDaysToKey(start, offset);
            if (slotsForViewerDay(candidate).length) { selectDay(candidate); return; }
          }
        },
        text: "Find the next open day",
      }));
  }

  return el("div", { class: "slot-panel" },
    ...groups.map((group) => {
      const service = serviceById(group.slots[0].serviceId);
      return el("div", { class: "slot-group" },
        el("div", { class: "slot-time", text: `${timeLabel(group.start, state.timeZone)}, ${timeLabel(group.start + service.durationMinutes * MINUTE, state.timeZone)}` }),
        el("div", { class: "slot-staff" },
          ...group.slots.map((slot) => {
            const staff = staffById(slot.staffId);
            return el("button", { class: "slot-chip", onclick: () => openBooking(slot) },
              el("span", { class: "dot-person" }),
              el("span", { text: staff.name.split(" ")[0] }),
              el("b", { text: money(serviceById(slot.serviceId).priceMinor) }));
          })));
    }));
}

function renderWeekSide(slots, startKey) {
  const groups = groupSlotsByStart(slots).filter((group) => {
    const minutes = viewerMinutes(group.start);
    return minutes >= DISPLAY_START_HOUR * 60 && minutes < DISPLAY_END_HOUR * 60;
  });
  $("#selected-day-label").textContent = longDayLabel(startOfZonedDay(state.selectedDayKey, state.timeZone), state.timeZone);
  $("#selected-slot-count").textContent = `${groups.length} time${groups.length === 1 ? "" : "s"}`;
  $("#slot-panel").replaceChildren(renderSlotPanel(slots));

  const weekBookings = DB.bookings.filter((booking) => {
    const key = dateKeyInZone(booking.start, state.timeZone);
    return key >= startKey && key <= addDaysToKey(startKey, 6);
  });
  const bookedMinutes = weekBookings.reduce((sum, booking) => sum + (booking.end - booking.start) / MINUTE, 0);
  const openSlots = slotsAroundWeek().filter((slot) => {
    const key = dateKeyInZone(slot.start, state.timeZone);
    return key >= startKey && key <= addDaysToKey(startKey, 6) && viewerMinutes(slot.start) >= DISPLAY_START_HOUR * 60;
  }).length;
  const capacity = (openSlots + weekBookings.length) * selectedService().durationMinutes;
  const utilisation = capacity ? Math.round((bookedMinutes / capacity) * 100) : 0;

  $("#week-stats").replaceChildren(
    ...[
      ["Bookings", weekBookings.length, "sessions"],
      ["Hours booked", (bookedMinutes / 60).toFixed(1), "hours"],
      ["Open slots", openSlots, selectedService().name.toLowerCase()],
      ["Utilisation", utilisation, "% of shown capacity"],
    ].map(([label, value, unit]) => el("div", { class: "week-stat" },
      el("span", { text: label }),
      el("span", { class: "spacer" }),
      el("b", { text: String(value) }),
      el("span", { class: "unit", text: unit }))));

  $("#policy-card").replaceChildren(...policyTable(DB.policy).map((tier) => el("div", { class: "policy-row" },
    el("span", { class: "fee", text: tier.feePercent === 0 ? "free" : `${tier.feePercent}%` }),
    el("span", { class: "window", text: tier.window }))));
}

function renderWeek() {
  const startKey = displayWeekStart();
  const weekDays = weekDayKeys(startKey, 7);
  if (!state.selectedDayKey || !weekDays.includes(state.selectedDayKey)) {
    const today = viewerTodayKey();
    state.selectedDayKey = weekDays.includes(today) ? today : addDaysToKey(startKey, 1);
    state.autoPick = true;
  }
  let slots = slotsForViewerDay(state.selectedDayKey);
  if (state.autoPick && slots.length === 0) {
    for (const dayKey of weekDays) {
      const candidate = slotsForViewerDay(dayKey);
      if (candidate.length) {
        state.selectedDayKey = dayKey;
        slots = candidate;
        break;
      }
    }
    state.autoPick = false;
  }

  $("#service-select").replaceChildren(...DB.services.map((service) => el("option", {
    value: service.id, selected: service.id === state.serviceId ? "" : null,
    text: `${service.name} · ${service.durationMinutes}m`,
  })));
  $("#staff-select").replaceChildren(
    el("option", { value: "all", selected: state.staffId === "all" ? "" : null, text: "All practitioners" }),
    ...DB.staff.map((staff) => el("option", {
      value: staff.id, selected: staff.id === state.staffId ? "" : null,
      text: `${staff.name} · ${staff.role}`,
    })));
  $("#week-label").textContent = weekRangeLabel(startKey);
  $("#week-zone-label").textContent = `${DB.timeZone} → ${state.timeZone}`;
  $("#week-grid").replaceChildren(renderWeekGrid(startKey));
  renderWeekSide(slots, startKey);
}

/* ------------------------------------------------------------- booking flow */

function openBooking(slot) {
  const service = serviceById(slot.serviceId);
  const staff = staffById(slot.staffId);
  const nameInput = el("input", { class: "input", placeholder: "Dana Whitfield", "aria-label": "Your name" });
  const emailInput = el("input", { class: "input", type: "email", placeholder: "dana@company.example", "aria-label": "Email" });
  const notesInput = el("textarea", { class: "textarea", rows: "2", placeholder: "Anything the practitioner should know before the call?" });

  A.modal({
    title: `${service.name}, ${dayLabel(slot.start, state.timeZone)}`,
    body: el("div", { class: "col", style: "gap:14px" },
      el("div", { class: "row wrap" },
        el("span", { class: "badge gold", text: `${timeLabel(slot.start, state.timeZone)}, ${timeLabel(slot.end, state.timeZone)}` }),
        el("span", { class: "badge", text: `${service.durationMinutes} minutes` }),
        el("span", { class: "badge", text: money(service.priceMinor) }),
        el("span", { class: "badge blue", text: staff.name })),
      el("p", { class: "small muted mb-0", text: `${longDayLabel(slot.start, state.timeZone)} in ${state.timeZone}. The booking is stored as an absolute instant and exported to ICS in UTC.` }),
      el("label", { class: "field" }, "Your name", nameInput),
      el("label", { class: "field" }, "Email", emailInput),
      el("label", { class: "field" }, "Notes", notesInput)),
    actions: [
      { label: "Cancel" },
      {
        label: "Confirm booking",
        kind: "primary",
        onClick: () => {
          const name = nameInput.value.trim();
          const email = emailInput.value.trim();
          if (name.length < 2) { A.toast("Add your name", "error"); return false; }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { A.toast("Add a valid email", "error"); return false; }
          const conflict = hasConflict({
            staffId: slot.staffId,
            start: slot.start,
            end: slot.end,
            bookings: DB.bookings,
            blackouts: DB.blackouts,
            paddedStart: slot.start - service.bufferBeforeMinutes * MINUTE,
            paddedEnd: slot.end + service.bufferAfterMinutes * MINUTE,
          });
          if (conflict) { A.toast("That slot was just taken, pick another", "error"); renderWeek(); return false; }
          const booking = {
            id: `bk-${Date.now().toString(36)}`,
            dateKey: dateKeyInZone(slot.start, DB.timeZone),
            serviceId: service.id,
            serviceName: service.name,
            staffId: staff.id,
            staffName: staff.name,
            start: slot.start,
            end: slot.end,
            priceMinor: service.priceMinor,
            currency: service.currency,
            customer: { name, email, company: "" },
            notes: notesInput.value.trim(),
            status: "confirmed",
          };
          DB.bookings.push(booking);
          persist();
          A.toast(`Booked · ${timeLabel(booking.start, state.timeZone)} with ${staff.name}`, "success", 2600);
          renderChrome();
          renderWeek();
          setTimeout(() => openConfirmation(booking), 40);
        },
      },
    ],
  });
}

function downloadICS(bookings, filename) {
  const ics = buildICS(bookings.map((booking) => ({
    ...booking,
    serviceName: booking.serviceName || serviceById(booking.serviceId).name,
    staffName: booking.staffName || staffById(booking.staffId).name,
  })), {
    now: now(),
    calendarName: "Northline Studio, bookings",
    organizer: { name: DB.studio.name, email: DB.studio.email },
  });
  A.download(filename, ics, "text/calendar");
}

function openConfirmation(booking) {
  const stamp = new Date(booking.start).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  A.modal({
    title: "Booking confirmed",
    body: el("div", { class: "col", style: "gap:12px" },
      el("p", { class: "small mb-0" }, el("b", { text: booking.serviceName }), " with ", el("b", { text: booking.staffName })),
      el("div", { class: "row wrap" },
        el("span", { class: "badge gold", text: longDayLabel(booking.start, state.timeZone) }),
        el("span", { class: "badge", text: `${timeLabel(booking.start, state.timeZone)}, ${timeLabel(booking.end, state.timeZone)}` }),
        el("span", { class: "badge blue", text: money(booking.priceMinor) })),
      el("div", { class: "code-note", text: `DTSTART:${stamp}` }),
      el("p", { class: "small muted mb-0", text: "The .ics file stores the booking in UTC, so the receiving calendar shows the right hour in whatever zone your guest uses." })),
    actions: [
      { label: "Close" },
      { label: "Download .ics", kind: "primary", onClick: () => downloadICS([booking], `northline-${booking.id}.ics`) },
    ],
  });
}

function openBookingDetail(booking) {
  const quote = cancellationQuote({ start: booking.start, now: now(), priceMinor: booking.priceMinor, policy: DB.policy });
  const reschedule = rescheduleQuote({ start: booking.start, now: now(), policy: DB.policy });
  const actions = [{ label: "Close" }];
  actions.push({ label: "Download .ics", onClick: () => downloadICS([booking], `northline-${booking.id}.ics`) });
  if (quote.allowed) {
    actions.push({
      label: `Cancel · ${quote.feePercent === 0 ? "no fee" : `${quote.feePercent}% fee`}`,
      kind: "danger",
      onClick: () => {
        DB.bookings = DB.bookings.filter((row) => row.id !== booking.id);
        persist();
        A.toast(`Cancelled · refund ${money(quote.refundMinor)}`, "success", 2600);
        renderChrome();
        renderWeek();
        if (state.view === "bookings") renderBookings();
      },
    });
  }
  A.modal({
    title: `${booking.serviceName} · ${booking.id}`,
    body: el("div", { class: "col", style: "gap:12px" },
      el("div", { class: "row wrap" },
        el("span", { class: "badge gold", text: longDayLabel(booking.start, state.timeZone) }),
        el("span", { class: "badge", text: `${timeLabel(booking.start, state.timeZone)}, ${timeLabel(booking.end, state.timeZone)}` }),
        el("span", { class: "badge blue", text: booking.staffName }),
        el("span", { class: "badge", text: booking.status })),
      el("div", { class: "kv", style: "grid-template-columns:110px 1fr" },
        el("dt", { text: "Customer" }), el("dd", { text: `${booking.customer.name} · ${booking.customer.email}` }),
        el("dt", { text: "Price" }), el("dd", { text: money(booking.priceMinor) }),
        el("dt", { text: "Notes" }), el("dd", { text: booking.notes || ", " }),
        el("dt", { text: "Stored start" }), el("dd", { class: "mono", style: "font-size:10.5px", text: new Date(booking.start).toISOString() })),
      el("div", { class: "divider", style: "margin:4px 0" }),
      el("div", { class: "row wrap" },
        el("span", { class: "badge", text: `${Math.max(0, quote.hoursUntilStart).toFixed(1)}h before start` }),
        el("span", { class: `badge ${quote.feePercent === 0 ? "green" : quote.feePercent === 100 ? "red" : "gold"}`, text: quote.feePercent === 0 ? "free cancellation" : `${quote.feePercent}% fee · ${money(quote.feeMinor)}` }),
        el("span", { class: "badge", text: reschedule.allowed ? "reschedule allowed" : "reschedule window passed" })),
      el("p", { class: "small muted mb-0", text: quote.allowed ? quote.reason : "This session has already started; cancellation is handled by the studio." })),
    actions,
  });
}

/* --------------------------------------------------------------- bookings */

function renderBookings() {
  const future = DB.bookings.filter((booking) => booking.start >= now()).sort((a, b) => a.start - b.start);
  const past = DB.bookings.filter((booking) => booking.start < now()).sort((a, b) => b.start - a.start);
  const upcoming = DB.bookings.filter((booking) => booking.start >= now());
  const weekStart = displayWeekStart();
  const weekEnd = addDaysToKey(weekStart, 6);
  const thisWeek = DB.bookings.filter((booking) => {
    const key = dateKeyInZone(booking.start, state.timeZone);
    return key >= weekStart && key <= weekEnd;
  });
  const hours = thisWeek.reduce((sum, booking) => sum + (booking.end - booking.start) / MINUTE / 60, 0);
  const next = future[0];

  $("#booking-kpis").replaceChildren(
    ...[
      ["Upcoming", String(upcoming.length), "confirmed sessions", "gold"],
      ["Next session", next ? dayLabel(next.start, state.timeZone) : ", ", next ? `${timeLabel(next.start, state.timeZone)} · ${next.staffName}` : "nothing booked", "blue"],
      ["This week", `${hours.toFixed(1)}h`, `${thisWeek.length} sessions`, "green"],
      ["Pipeline", money(upcoming.reduce((sum, booking) => sum + booking.priceMinor, 0)), "booked value", "gold"],
    ].map(([label, value, sub, tone]) => el("div", { class: "card" },
      el("div", { class: "stat" },
        el("div", { class: "stat-label", text: label }),
        el("div", { class: `stat-value ${tone}`, style: "font-size:24px", text: value }),
        el("div", { class: "small muted", text: sub })))),
  );

  $("#booking-service").replaceChildren(
    el("option", { value: "all", text: "All services" }),
    ...DB.services.map((service) => el("option", { value: service.id, selected: service.id === state.bookingService ? "" : null, text: service.name })));
  $("#booking-scope").value = state.bookingScope;

  let rows = state.bookingScope === "upcoming" ? future : state.bookingScope === "past" ? past : [...future, ...past];
  if (state.bookingService !== "all") rows = rows.filter((booking) => booking.serviceId === state.bookingService);
  $("#booking-count").textContent = `${rows.length} booking${rows.length === 1 ? "" : "s"} shown`;

  $("#bookings-table").replaceChildren(A.dataTable({
    columns: [
      {
        label: "When",
        render: (booking) => el("div", { class: "booking-when" },
          el("span", { class: "day", text: dayLabel(booking.start, state.timeZone) }),
          el("span", { class: "time", text: `${timeLabel(booking.start, state.timeZone)}, ${timeLabel(booking.end, state.timeZone)}` })),
      },
      { label: "Service", render: (booking) => el("span", { style: "color:var(--text);font-weight:600", text: booking.serviceName }) },
      { label: "With", render: (booking) => el("span", { class: "small muted", text: booking.staffName }) },
      {
        label: "Customer",
        render: (booking) => el("div", { class: "booking-customer" },
          el("span", { class: "name", text: booking.customer.name }),
          el("span", { class: "company", text: booking.customer.company || booking.customer.email })),
      },
      { label: "Price", align: "right", render: (booking) => el("span", { class: "booking-price", text: money(booking.priceMinor) }) },
      {
        label: "",
        align: "right",
        render: (booking) => el("div", { class: "action-row" },
          el("button", {
            class: "btn ghost sm",
            onclick: (event) => { event.stopPropagation(); downloadICS([booking], `northline-${booking.id}.ics`); },
            text: "ICS",
          }),
          el("button", {
            class: "btn sm",
            onclick: (event) => { event.stopPropagation(); openBookingDetail(booking); },
            text: "Details",
          })),
      },
    ],
    rows,
    empty: "No bookings in this filter.",
    onRowClick: (booking) => openBookingDetail(booking),
  }));
}

/* ----------------------------------------------------------------- engine */

function renderEngine() {
  const zone = DB.timeZone;
  const spring = "2026-03-08";
  const fall = "2026-11-01";
  const dayHours = (key) => (startOfZonedDay(addDaysToKey(key, 1), zone) - startOfZonedDay(key, zone)) / 3_600_000;
  $("#engine-zone").textContent = `${zone} · ${offsetLabel(now(), zone)}`;
  $("#engine-cards").replaceChildren(
    ...[
      ["Zone", "America/New_York", "IANA rules, not a fixed offset"],
      ["Offset now", offsetLabel(now(), zone), "EDT/EST is chosen by the date"],
      ["8 March 2026", `${dayHours(spring)}h`, "spring forward, one hour shorter"],
      ["1 November 2026", `${dayHours(fall)}h`, "fall back, one hour longer"],
    ].map(([label, value, sub]) => el("div", { class: "card" },
      el("div", { class: "stat" },
        el("div", { class: "stat-label", text: label }),
        el("div", { class: "stat-value gold", style: "font-size:22px", text: value }),
        el("div", { class: "small muted", text: sub })))),
  );

  $("#engine-steps").replaceChildren(...[
    "Read the staff member's weekly windows for the calendar date, in the studio's IANA zone.",
    "Turn each wall-clock window into an instant with Intl, not new Date(year, month, day).",
    "Skip a start time that falls in a spring-forward gap; choose the earlier instant in a fall-back overlap.",
    "Step by the service's slot interval and drop any slot whose duration does not fit the window.",
    "Reject a slot when its buffered interval overlaps a booking or a blackout for that staff member.",
    "Bucket the resulting instants by the viewer's zone for display; the booking keeps its absolute instant.",
  ].map((text) => el("li", { text })));

  const nightStaff = {
    id: "demo-night", name: "Night desk", timeZone: zone,
    availability: { 1: [["22:00", "06:00"]], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] },
  };
  const monday = displayWeekStart();
  const nightSlots = generateSlots({
    dateKey: monday, timeZone: zone,
    service: { ...DB.services[0], durationMinutes: 60, slotIntervalMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minNoticeMinutes: 0 },
    staff: nightStaff, now: 0,
  });
  $("#overnight-demo").replaceChildren(el("div", { class: "overnight-slots" },
    ...nightSlots.map((slot) => el("span", {
      class: dateKeyInZone(slot.start, zone) !== monday ? "crosses" : "",
      text: timeLabel(slot.start, zone),
    })),
    el("span", { style: "border:0;color:var(--muted)", text: `${nightSlots.length} slots · service date stays ${monday}` })));

  $("#dst-table").replaceChildren(A.dataTable({
    columns: [
      { label: "Date", render: (row) => el("span", { class: "mono", text: row.date }) },
      { label: "Length", align: "right", render: (row) => `${row.hours} hours` },
      { label: "Offset before", align: "right", render: (row) => el("span", { class: "mono", text: row.before }) },
      { label: "Offset after", align: "right", render: (row) => el("span", { class: "mono", text: row.after }) },
      { label: "Transition", render: (row) => el("span", { class: "small muted", text: row.note }) },
    ],
    rows: [
      { date: spring, hours: dayHours(spring), before: offsetLabel(Date.UTC(2026, 2, 8, 6), zone), after: offsetLabel(Date.UTC(2026, 2, 8, 8), zone), note: "02:00 → 03:00, 02:30 does not exist" },
      { date: fall, hours: dayHours(fall), before: offsetLabel(Date.UTC(2026, 10, 1, 5), zone), after: offsetLabel(Date.UTC(2026, 10, 1, 7), zone), note: "02:00 → 01:00, 01:30 happens twice" },
    ],
  }));
}

/* --------------------------------------------------------------- settings */

function renderSettings() {
  $("#services-table").replaceChildren(A.dataTable({
    columns: [
      { label: "Service", render: (service) => el("span", { style: "color:var(--text);font-weight:600", text: service.name }) },
      { label: "Duration", align: "right", render: (service) => `${service.durationMinutes}m` },
      { label: "Buffers", align: "right", render: (service) => `${service.bufferBeforeMinutes}/${service.bufferAfterMinutes}m` },
      { label: "Slot step", align: "right", render: (service) => `${service.slotIntervalMinutes}m` },
      { label: "Notice", align: "right", render: (service) => `${service.minNoticeMinutes}m` },
      { label: "Price", align: "right", render: (service) => money(service.priceMinor) },
    ],
    rows: DB.services,
  }));

  const dayNames = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" };
  $("#rota-zone").textContent = DB.timeZone;
  $("#rota-table").replaceChildren(...DB.staff.map((staff) => {
    const parts = [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
      const windows = staff.availability[weekday] || [];
      if (!windows.length) return null;
      const label = windows.map((window) => {
        const [open, close] = Array.isArray(window) ? window : [window.start, window.end];
        return `${open}, ${close}`;
      }).join(", ");
      return `${dayNames[weekday]} ${label}`;
    }).filter(Boolean);
    return el("div", { class: "rota-row" },
      el("span", { class: "who", text: staff.name }),
      el("span", { class: "days", text: parts.join(" · ") }));
  }));

  $("#blackouts-list").replaceChildren(...DB.blackouts.map((blackout) => el("div", { class: "blackout-row" },
    el("span", { class: "reason", text: blackout.reason }),
    el("span", { class: "when", text: `${dayLabel(blackout.start, state.timeZone)} · ${timeLabel(blackout.start, state.timeZone)}, ${timeLabel(blackout.end, state.timeZone)}` }))));

  $("#policy-table").replaceChildren(...policyTable(DB.policy).map((tier) => el("div", { class: "policy-row" },
    el("span", { class: "fee", text: tier.feePercent === 0 ? "free" : `${tier.feePercent}%` }),
    el("span", { class: "window", text: tier.window }))));
}

/* ---------------------------------------------------------------- routing */

const VIEWS = ["week", "bookings", "engine", "settings"];

function route() {
  const raw = location.hash.replace(/^#/, "") || "week";
  const [name] = raw.split("/");
  state.view = VIEWS.includes(name) ? name : "week";
  $$("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== state.view; });
  renderChrome();
  if (state.view === "week") renderWeek();
  else if (state.view === "bookings") renderBookings();
  else if (state.view === "engine") renderEngine();
  else renderSettings();
  window.scrollTo({ top: 0 });
}

/* ------------------------------------------------------------------- wire */

function nextAvailableSlot() {
  const service = selectedService();
  return generateRangeAvailability({
    startKey: viewerTodayKey(),
    days: 14,
    timeZone: DB.timeZone,
    service,
    staffList: selectedStaffList(),
    bookings: DB.bookings,
    blackouts: DB.blackouts,
    now: now(),
  }).flatMap((day) => day.slots).filter((slot) => viewerMinutes(slot.start) >= DISPLAY_START_HOUR * 60)[0] || null;
}

function wire() {
  $("#service-select").addEventListener("change", (event) => {
    state.serviceId = event.target.value;
    state.autoPick = true;
    renderWeek();
  });
  $("#staff-select").addEventListener("change", (event) => {
    state.staffId = event.target.value;
    state.autoPick = true;
    renderWeek();
  });
  $("#prev-week").addEventListener("click", () => shiftWeek(-1));
  $("#next-week").addEventListener("click", () => shiftWeek(1));
  $("#today-week").addEventListener("click", () => shiftWeek(0));
  $("#viewer-zone").addEventListener("change", (event) => {
    state.timeZone = event.target.value;
    state.weekOffset = 0;
    state.selectedDayKey = dateKeyInZone(now(), state.timeZone);
    state.autoPick = true;
    renderChrome();
    renderWeek();
    if (state.view === "bookings") renderBookings();
    A.toast(`Slots re-rendered in ${state.timeZone}`, "success", 2000);
  });
  $("#booking-scope").addEventListener("change", (event) => { state.bookingScope = event.target.value; renderBookings(); });
  $("#booking-service").addEventListener("change", (event) => { state.bookingService = event.target.value; renderBookings(); });
  $("#download-all-ics").addEventListener("click", () => {
    const upcoming = DB.bookings.filter((booking) => booking.start >= now());
    if (!upcoming.length) return A.toast("No upcoming bookings to export", "error");
    downloadICS(upcoming, "northline-upcoming.ics");
  });
  const bookNext = () => {
    const slot = nextAvailableSlot();
    if (slot) openBooking(slot);
    else A.toast("No open slots in the next two weeks", "error");
  };
  $("#topbar-book").addEventListener("click", bookNext);
  $("#bookings-new").addEventListener("click", () => {
    location.hash = "#week";
    setTimeout(bookNext, 80);
  });

  $("#reset-demo").addEventListener("click", () => {
    A.modal({
      title: "Reset the sample studio?",
      body: el("p", { class: "small", text: "Bookings made in this browser will be replaced by the seeded week." }),
      actions: [
        { label: "Cancel" },
        {
          label: "Reset",
          kind: "danger",
          onClick: () => {
            DB = buildSampleData({ now: Date.now() });
            persist();
            state.timeZone = DB.timeZone;
            state.weekOffset = 0;
            state.selectedDayKey = dateKeyInZone(now(), DB.timeZone);
            state.autoPick = true;
            A.toast("Sample studio restored", "success");
            location.hash = "#week";
            route();
          },
        },
      ],
    });
  });

  window.addEventListener("hashchange", route);
}

wire();
route();
