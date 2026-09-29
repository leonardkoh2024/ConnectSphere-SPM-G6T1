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
    const date = blockDate(block);
    if (window.event_date && date && date !== window.event_date) return false;
    const { start, end } = blockTimes(block);
    if (!start || !end) return false;
    return timesOverlap(window.start_time, window.end_time, start, end);
  });
};

export const capacityFits = (venue, attendance) => venue.max_capacity >= attendance;

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
