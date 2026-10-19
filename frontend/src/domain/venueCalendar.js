// E4 / SCRUM-120 — See when a venue is free. Two views over the same entries:
//   - buildMonthCalendar: a Monday-first month grid across every venue (or the
//     ones the filters keep), each day listing its bookings, requests and blocks.
//   - buildVenueCalendar: one venue's days split hour by hour into free, booked,
//     blocked and closed time — the detail shown when a day is chosen.
// No React, no Firebase.
//
// Days are bucketed in local time: a coordinator reads "Mon 12 Oct" as their own
// Monday, and every booking is entered in the same local time.

import { ROLES } from "./roles";
import { isActiveHold } from "./venueHolds";

export const SLOT = {
  FREE: "free",
  BOOKED: "booked",
  // F15 AC4 — an active tentative hold: kept for an event, not yet booked.
  HELD: "held",
  PENDING: "pending",
  BLOCKED: "blocked",
  CLOSED: "closed",
  // A venue with no operating hours recorded: occupancy is known, free time is not.
  UNKNOWN: "unknown"
};

// The kinds of entry a month cell can list, and the order the filter offers them.
export const ENTRY_KINDS = [SLOT.BOOKED, SLOT.HELD, SLOT.PENDING, SLOT.BLOCKED];

// AC5 — a booked period spans the event plus its setup and teardown. How long
// those are is still an open customer question (CLAUDE.md: setup/turnaround
// time), so the defaults are zero rather than an invented number. Change these
// two values once Session 3 answers; the calendar already widens bookings by them.
export const SETUP_MINUTES = 0;
export const TEARDOWN_MINUTES = 0;

export const MAX_RANGE_DAYS = 31;

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_MINUTES = 24 * 60;

// AC4 — event names are for ConnectSphere's own staff. Organisers and attendees
// see that a slot is taken, not whose event it is.
const INTERNAL_ROLES = [ROLES.COORDINATOR, ROLES.VENUE_STAFF, ROLES.TECH_SUPPORT];
export const isInternalRole = (role) => INTERNAL_ROLES.includes(role);

const pad = (value) => String(value).padStart(2, "0");

export const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const parseDay = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getDate() === day ? date : null;
};

const addDays = (date, count) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);

export const weekdayOf = (date) => WEEKDAYS[parseDay(date).getDay()];

const asDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toMinutes = (hhmm) => {
  const match = /^(\d{2}):(\d{2})/.exec(hhmm || "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const toClock = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

const byName = (left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" });

// ---- Months ----------------------------------------------------------------

export const monthOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

const monthStart = (month) => {
  const [year, number] = String(month).split("-").map(Number);
  return new Date(year, number - 1, 1);
};

export const shiftMonth = (month, delta) => {
  const start = monthStart(month);
  return monthOf(new Date(start.getFullYear(), start.getMonth() + delta, 1));
};

export const monthLabel = (month) => {
  const start = monthStart(month);
  return `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;
};

// Whole weeks, Monday first, from the week holding the 1st to the week holding
// the last day — four to six rows, as on a wall calendar.
export const monthGrid = (month) => {
  const first = monthStart(month);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  let day = addDays(first, -((first.getDay() + 6) % 7));
  const weeks = [];
  while (day <= last) {
    const week = [];
    for (let index = 0; index < 7; index += 1) { week.push(isoDay(day)); day = addDays(day, 1); }
    weeks.push(week);
  }
  return weeks;
};

// ---- Entries ---------------------------------------------------------------

// A booking is stored either as start/end datetimes or as a date plus two times.
const entryWindow = (item) => {
  const start = asDate(item.start_datetime);
  const end = asDate(item.end_datetime);
  if (start && end) return { start, end };
  const day = parseDay(item.event_date || item.date);
  const startMinutes = toMinutes(item.start_time);
  const endMinutes = toMinutes(item.end_time);
  if (!day || startMinutes == null || endMinutes == null) return null;
  return {
    start: new Date(day.getTime() + startMinutes * 60000),
    end: new Date(day.getTime() + endMinutes * 60000)
  };
};

const status = (item) => String(item.status || "").toUpperCase();

// Every booking, request and block for the given venues, as absolute windows.
// Rejected and withdrawn requests are not entries at all (AC1). A pending request
// is an entry but never occupies the venue: it may yet be rejected, and FCFS is
// applied at approval (AC2). F15 AC4 — an active hold occupies its recorded
// occupied window as Held; once expired it is nothing (F16 AC3).
const collectEntries = ({ venues, bookings, unavailability, role, setupMinutes, teardownMinutes, now }) => {
  const internal = isInternalRole(role);
  const named = new Map(venues.map((venue) => [venue.venue_id, venue.name]));
  const eventLabel = (item, fallback) => (internal ? item.event_name || item.reference_no || fallback : fallback);
  const venueOf = (item) => ({ venue_id: item.venue_id, venue_name: named.get(item.venue_id) });

  const blocked = unavailability
    .filter((item) => named.has(item.venue_id))
    .map((item) => ({ ...venueOf(item), kind: SLOT.BLOCKED, key: `blocked-${item.id}`, label: internal ? item.reason || "Unavailable" : "Unavailable", window: entryWindow(item) }));

  const booked = bookings
    .filter((item) => named.has(item.venue_id) && status(item) === "APPROVED")
    .map((item) => {
      const window = entryWindow(item);
      return {
        ...venueOf(item),
        kind: SLOT.BOOKED,
        key: `booked-${item.booking_id || item.id}`,
        label: eventLabel(item, "Booked"),
        window: window && {
          start: new Date(window.start.getTime() - setupMinutes * 60000),
          end: new Date(window.end.getTime() + teardownMinutes * 60000)
        }
      };
    });

  const held = bookings
    .filter((item) => named.has(item.venue_id) && isActiveHold(item, now))
    .map((item) => {
      const start = asDate(item.occupied_start);
      const end = asDate(item.occupied_end);
      return {
        ...venueOf(item),
        kind: SLOT.HELD,
        key: `held-${item.booking_id || item.id}`,
        label: eventLabel(item, "Held"),
        window: start && end ? { start, end } : entryWindow(item)
      };
    });

  const pending = bookings
    .filter((item) => named.has(item.venue_id) && status(item) === "PENDING")
    .map((item) => ({ ...venueOf(item), kind: SLOT.PENDING, key: `pending-${item.booking_id || item.id}`, label: eventLabel(item, "Pending request"), window: entryWindow(item) }));

  return [...blocked, ...booked, ...held, ...pending].filter((item) => item.window);
};

// Clips an absolute window to one day, as minutes from that day's midnight.
const clip = (window, dayStart) => {
  const dayEnd = addDays(dayStart, 1);
  if (window.end <= dayStart || window.start >= dayEnd) return null;
  const start = Math.max(0, Math.round((window.start - dayStart) / 60000));
  const end = Math.min(DAY_MINUTES, Math.round((window.end - dayStart) / 60000));
  return end > start ? { start, end } : null;
};

// ---- Month view ------------------------------------------------------------

// No venue ticked means every venue: the calendar opens across the whole
// catalogue, and ticking venues narrows it to just those.
export const emptyCalendarFilters = () => ({ venueIds: [], location: "", kinds: [...ENTRY_KINDS] });

export const buildMonthCalendar = ({
  month,
  venues = [],
  bookings = [],
  unavailability = [],
  role,
  filters = {},
  setupMinutes = SETUP_MINUTES,
  teardownMinutes = TEARDOWN_MINUTES,
  now = new Date()
}) => {
  const { venueIds = [], location = "", kinds = ENTRY_KINDS } = filters;
  const shown = venues
    .filter((venue) => !venueIds.length || venueIds.includes(venue.venue_id))
    .filter((venue) => !location || venue.location === location)
    .sort(byName);
  // AC8 — a venue asked for by ID that is not in the catalogue is reported, not
  // silently dropped.
  const found = venueIds.every((id) => venues.some((venue) => venue.venue_id === id));
  // Whichever filters leave exactly one venue, its own hours apply to the grid.
  const single = shown.length === 1 ? shown[0] : null;
  const hasAvailabilityData = single ? (single.operating_hours || []).length > 0 : true;

  const entries = collectEntries({ venues: shown, bookings, unavailability, role, setupMinutes, teardownMinutes, now })
    .filter((entry) => kinds.includes(entry.kind));
  const inMonth = monthOf(monthStart(month));

  const weeks = monthGrid(month).map((week) => week.map((date) => {
    const dayStart = parseDay(date);
    const dayEntries = entries
      .map((entry) => ({ entry, span: clip(entry.window, dayStart) }))
      .filter(({ span }) => span)
      .map(({ entry: { window, ...entry }, span }) => ({
        ...entry,
        start: toClock(span.start),
        end: toClock(span.end),
        allDay: span.start === 0 && span.end === DAY_MINUTES
      }))
      .sort((left, right) => left.start.localeCompare(right.start) || String(left.venue_name).localeCompare(String(right.venue_name)));
    // Across several venues opening days differ, so only a single venue's
    // calendar can say a whole day is closed (AC3).
    const closed = Boolean(single && hasAvailabilityData && !(single.operating_hours || []).some((row) => row.weekday === WEEKDAYS[dayStart.getDay()]));
    return { date, day: dayStart.getDate(), inMonth: date.startsWith(inMonth), closed, entries: dayEntries };
  }));

  return { found, venues: found ? shown : [], hasAvailabilityData, weeks };
};

// ---- One venue, hour by hour -----------------------------------------------

export const calendarRange = (from, to) => {
  const start = parseDay(from);
  const end = parseDay(to);
  if (!start || !end) return { days: [], error: "Choose a start and end date." };
  if (end < start) return { days: [], error: "The end date must be on or after the start date." };
  const days = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(isoDay(day));
  if (days.length > MAX_RANGE_DAYS) return { days: [], error: `Choose a range of ${MAX_RANGE_DAYS} days or fewer.` };
  return { days, error: "" };
};

// Where two things claim the same minute, the stronger one is shown: a block
// outranks a booking (the booking is the anomaly worth seeing, but the venue is
// unusable either way) and anything occupied outranks closed hours.
const RANK = { [SLOT.BLOCKED]: 3, [SLOT.BOOKED]: 2, [SLOT.HELD]: 1 };

const buildDay = ({ date, hours, hasAvailabilityData, occupied, pending }) => {
  const dayStart = parseDay(date);
  const opens = hours ? toMinutes(hours.opens_at) : null;
  const closes = hours ? toMinutes(hours.closes_at) : null;
  const baseAt = (minute) => {
    if (!hasAvailabilityData) return SLOT.UNKNOWN;
    return opens != null && closes != null && minute >= opens && minute < closes ? SLOT.FREE : SLOT.CLOSED;
  };

  const clipped = occupied
    .map((item) => ({ ...item, ...clip(item.window, dayStart) }))
    .filter((item) => item.start != null);

  const cuts = new Set([0, DAY_MINUTES]);
  if (hasAvailabilityData && opens != null && closes != null) { cuts.add(opens); cuts.add(closes); }
  clipped.forEach((item) => { cuts.add(item.start); cuts.add(item.end); });
  const points = [...cuts].filter((minute) => minute >= 0 && minute <= DAY_MINUTES).sort((a, b) => a - b);

  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const owner = clipped
      .filter((item) => item.start <= start && item.end >= end)
      .sort((left, right) => RANK[right.kind] - RANK[left.kind] || left.window.start - right.window.start)[0];
    const segment = owner
      ? { kind: owner.kind, label: owner.label, key: owner.key }
      : { kind: baseAt(start), label: "", key: "" };
    const last = segments[segments.length - 1];
    if (last && last.kind === segment.kind && last.key === segment.key) last.endMinute = end;
    else segments.push({ ...segment, startMinute: start, endMinute: end });
  }

  return {
    date,
    weekday: WEEKDAYS[dayStart.getDay()],
    hours: hours ? { opens_at: hours.opens_at, closes_at: hours.closes_at } : null,
    segments: segments.map(({ startMinute, endMinute, ...segment }) => ({
      ...segment,
      start: toClock(startMinute),
      end: toClock(endMinute),
      minutes: endMinute - startMinute
    })),
    pending: pending
      .map((item) => ({ ...item, ...clip(item.window, dayStart) }))
      .filter((item) => item.start != null)
      .map(({ window, start, end, venue_id, venue_name, ...item }) => ({ ...item, start: toClock(start), end: toClock(end) }))
  };
};

export const buildVenueCalendar = ({
  venueId,
  venues = [],
  from,
  to,
  bookings = [],
  unavailability = [],
  role,
  setupMinutes = SETUP_MINUTES,
  teardownMinutes = TEARDOWN_MINUTES,
  now = new Date()
}) => {
  const venue = venues.find((item) => item.venue_id === venueId);
  const range = calendarRange(from, to);
  if (!venue) return { found: false, venue: null, hasAvailabilityData: false, days: [], error: range.error };

  const operatingHours = venue.operating_hours || [];
  const hasAvailabilityData = operatingHours.length > 0;
  const entries = collectEntries({ venues: [venue], bookings, unavailability, role, setupMinutes, teardownMinutes, now });
  const occupied = entries.filter((entry) => entry.kind !== SLOT.PENDING);
  const pending = entries.filter((entry) => entry.kind === SLOT.PENDING);

  const days = range.days.map((date) => buildDay({
    date,
    hours: operatingHours.find((row) => row.weekday === weekdayOf(date)) || null,
    hasAvailabilityData,
    occupied,
    pending
  }));

  return { found: true, venue, hasAvailabilityData, days, error: range.error };
};
