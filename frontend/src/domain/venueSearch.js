// E2 / E5 / E6 — catalogue listing, occupancy/capacity shortlist, and AND filters.
// No React, no Firebase: the screens assemble venue records and call these.

import { ROLES } from "./roles";

export const CATALOGUE_ROLES = [ROLES.COORDINATOR, ROLES.VENUE_STAFF];
export const SEARCH_ROLES = [ROLES.COORDINATOR];

export const canViewCatalogue = (role) => CATALOGUE_ROLES.includes(role);
export const canSearchVenues = (role) => SEARCH_ROLES.includes(role);

export const listCatalogue = (venues = []) =>
  venues.map((venue) => ({
    venue_id: venue.venue_id,
    name: venue.name,
    location: venue.location,
    max_capacity: venue.max_capacity,
    headline_facilities: venue.facilities || []
  }));

export const venueRecord = (venue) => ({
  ...listCatalogue([venue])[0],
  layouts: venue.layouts || [],
  accessibility: venue.accessibility || [],
  operating_hours: venue.operating_hours || []
});

export const facilitiesLabel = (facilities = []) =>
  facilities.length ? facilities.map((item) => String(item).replaceAll("_", " ")).join(", ") : "None listed";

export const daysFromToday = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export const prefillSearch = (event) => ({
  event_date: event.event_date,
  start_time: event.start_time,
  end_time: event.end_time,
  expected_attendance: event.expected_attendance
});

const pad = (value) => String(value).padStart(2, "0");

const asDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const asHHmm = (value) => {
  if (typeof value === "string" && /^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const date = asDate(value);
  if (!date) return null;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const asIsoDate = (value) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = asDate(value);
  if (!date) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// Touching endpoints do not overlap (07:00–09:00 vs 09:00–17:00 is free).
// Revisit if Session 3 adds setup / turnaround time (TC-097).
export const timesOverlap = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

const isApproved = (status) => String(status || "").toUpperCase() === "APPROVED";

const blockDate = (block) => block.event_date || block.date || asIsoDate(block.start_datetime);

const blockTimes = (block) => ({
  start: block.start_time || asHHmm(block.start_datetime),
  end: block.end_time || asHHmm(block.end_datetime)
});

export const isOccupied = (venue, window, bookings = [], unavailability = []) => {
  const blocks = [
    ...bookings.filter((item) => item.venue_id === venue.venue_id && isApproved(item.status)),
    ...unavailability.filter((item) => item.venue_id === venue.venue_id)
  ];
  return blocks.some((block) => {
    const requestedStart = asDate(`${window.event_date || ""}T${window.start_time || ""}`);
    const requestedEnd = asDate(`${window.event_date || ""}T${window.end_time || ""}`);
    const blockStart = asDate(block.start_datetime);
    const blockEnd = asDate(block.end_datetime);
    if (requestedStart && requestedEnd && blockStart && blockEnd) {
      return requestedStart < blockEnd && blockStart < requestedEnd;
    }

    const date = blockDate(block);
    if (window.event_date && date && date !== window.event_date) return false;
    const { start, end } = blockTimes(block);
    if (!start || !end) return false;
    return timesOverlap(window.start_time, window.end_time, start, end);
  });
};

export const capacityFits = (venue, attendance) => venue.max_capacity >= attendance;

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const isValidTime = (value) => {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours <= 23 && minutes <= 59;
};

export const assessVenueSuitability = ({ venue, event }) => {
  const criteria = [];
  const attendance = Number(event.expected_attendance);
  const capacity = Number(venue.max_capacity);
  const validAttendance = Number.isInteger(attendance) && attendance > 0;
  const validCapacity = Number.isFinite(capacity) && capacity >= 0;

  criteria.push({
    key: "capacity",
    label: "Attendance and capacity",
    passed: validAttendance && validCapacity && attendance <= capacity,
    detail: validAttendance && validCapacity
      ? `${capacity} places for ${attendance} expected attendees.`
      : "Expected attendance or venue capacity is missing or invalid."
  });

  const requirements = [
    {
      key: "facility",
      label: "Required facility",
      pluralLabel: "Required facilities",
      emptyDetail: "No facilities required.",
      requested: event.facilities || [],
      available: venue.facilities || []
    },
    {
      key: "accessibility",
      label: "Accessibility feature",
      pluralLabel: "Accessibility features",
      emptyDetail: "No accessibility features required.",
      requested: event.accessibility || [],
      available: venue.accessibility || []
    }
  ];
  requirements.forEach(({ key, label, pluralLabel, emptyDetail, requested, available }) => {
    if (requested.length === 0) {
      criteria.push({ key, label: pluralLabel, passed: true, detail: emptyDetail });
      return;
    }
    requested.forEach((item) => {
      const present = available.includes(item);
      criteria.push({
        key: `${key}-${item}`,
        label: `${label}: ${String(item).replaceAll("_", " ")}`,
        passed: present,
        detail: present ? "Available at this venue." : "Required but not listed for this venue."
      });
    });
  });

  const requestedLayout = event.layout || "";
  criteria.push({
    key: "layout",
    label: "Required room layout",
    passed: !requestedLayout || (venue.layouts || []).includes(requestedLayout),
    detail: requestedLayout
      ? (venue.layouts || []).includes(requestedLayout)
        ? `${String(requestedLayout).replaceAll("_", " ")} is supported.`
        : `${String(requestedLayout).replaceAll("_", " ")} is not listed for this venue.`
      : "No room layout required."
  });

  const dateParts = typeof event.event_date === "string" ? event.event_date.split("-").map(Number) : [];
  const date = dateParts.length === 3 ? new Date(dateParts[0], dateParts[1] - 1, dateParts[2]) : null;
  const validDate = date && date.getFullYear() === dateParts[0] && date.getMonth() === dateParts[1] - 1 && date.getDate() === dateParts[2];
  const weekday = validDate ? WEEKDAYS[date.getDay()] : null;
  const hours = weekday
    ? (venue.operating_hours || []).filter((row) => String(row.weekday).toUpperCase() === weekday)
    : [];
  const validWindow = isValidTime(event.start_time) && isValidTime(event.end_time) && event.start_time < event.end_time;
  const withinHours = validWindow && hours.some((row) =>
    isValidTime(row.opens_at) && isValidTime(row.closes_at) &&
    event.start_time >= row.opens_at && event.end_time <= row.closes_at
  );
  criteria.push({
    key: "operating-hours",
    label: "Requested time within operating hours",
    passed: withinHours,
    detail: withinHours
      ? `${event.start_time}–${event.end_time} is within ${weekday} operating hours.`
      : !validDate
        ? "The event date is missing or invalid."
        : !validWindow
          ? "The requested start and end times are missing or invalid."
          : hours.length
            ? `${event.start_time}–${event.end_time} is outside ${weekday} operating hours (${hours.map((row) => `${row.opens_at}–${row.closes_at}`).join(", ")}).`
            : `No operating hours are listed for ${weekday}.`
  });

  return { suitable: criteria.every((criterion) => criterion.passed), criteria };
};

export const searchVenues = ({ venues, window, bookings = [], unavailability = [] }) => {
  const occupied = [];
  const tooSmall = [];
  const matches = [];

  for (const venue of venues) {
    const occupiedHit = isOccupied(venue, window, bookings, unavailability);
    const smallHit = !capacityFits(venue, window.expected_attendance);
    if (occupiedHit) occupied.push(venue);
    if (smallHit) tooSmall.push(venue);
    if (!occupiedHit && !smallHit) matches.push(venue);
  }

  return {
    matches,
    count: matches.length,
    excluded: {
      occupied: occupied.length,
      capacity_below: tooSmall.length
    }
  };
};

export const emptyFilters = () => ({
  location: null,
  min_capacity: null,
  max_capacity: null,
  facilities: [],
  accessibility: [],
  layout: null
});

export const activeFilters = (filters) => {
  const active = [];
  if (filters.location) active.push({ key: "location", value: filters.location });
  if (filters.min_capacity != null || filters.max_capacity != null) {
    active.push({ key: "capacity_range", value: [filters.min_capacity, filters.max_capacity] });
  }
  if (filters.facilities.length) active.push({ key: "facilities", value: filters.facilities });
  if (filters.accessibility.length) active.push({ key: "accessibility", value: filters.accessibility });
  if (filters.layout) active.push({ key: "layout", value: filters.layout });
  return active;
};

export const applyFilters = (venues, filters) =>
  venues.filter((venue) => {
    if (filters.location && venue.location !== filters.location) return false;
    if (filters.min_capacity != null && venue.max_capacity < filters.min_capacity) return false;
    if (filters.max_capacity != null && venue.max_capacity > filters.max_capacity) return false;
    if (
      filters.facilities.length &&
      !filters.facilities.every((item) => (venue.facilities || []).includes(item))
    ) {
      return false;
    }
    if (
      filters.accessibility.length &&
      !filters.accessibility.every((item) => (venue.accessibility || []).includes(item))
    ) {
      return false;
    }
    if (filters.layout && !(venue.layouts || []).includes(filters.layout)) return false;
    return true;
  });
