// F12 — one event may book several venues at once, so each booking carries its
// own label, expected attendance and layout rather than borrowing the event's.
// No React, no Firebase: the form, venuesApi and the tests all call these.

import { LIVE_BOOKING_STATUSES } from "./venueSuitability";

const ATTENDANCE_SHAPE = "Expected attendance must be a whole number greater than zero.";

// A single-venue event is the common case, so a new booking starts from the
// venue's name and the event's own figures; the coordinator changes them for a
// breakout room.
export const bookingDetailsDefaults = (event = {}, venue = {}) => ({
  label: venue.name || "",
  expected_attendance: event.expected_attendance == null ? "" : String(event.expected_attendance),
  layout: event.required_layout || ""
});

// AC2 and AC3. Returns one message per field that is wrong, and {} when the
// booking may be raised.
export const bookingDetailsErrors = (details = {}, event = {}) => {
  const errors = {};
  if (!String(details.label ?? "").trim()) {
    errors.label = "Give this booking a label, such as Main programme or Breakout 1.";
  }
  const raw = String(details.expected_attendance ?? "").trim();
  const attendance = Number(raw);
  const eventAttendance = Number(event.expected_attendance);
  if (!/^\d+$/.test(raw) || attendance <= 0) {
    errors.expected_attendance = ATTENDANCE_SHAPE;
  } else if (Number.isFinite(eventAttendance) && attendance > eventAttendance) {
    errors.expected_attendance = `Expected attendance cannot be more than the event's ${eventAttendance}.`;
  }
  if (!String(details.layout ?? "").trim()) errors.layout = "Choose the layout this venue needs.";
  return errors;
};

const asTime = (value) => {
  if (!value) return null;
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
};

// AC4 — the live booking this event already holds for the same venue at an
// overlapping time, or null. Windows that only touch do not overlap. A clash
// with another event's booking is F6's concern, decided when Venue Staff approve.
export const clashingEventBooking = (bookings = [], { eventId, venueId, start, end }) => {
  const from = asTime(start);
  const to = asTime(end);
  if (from == null || to == null) return null;
  return bookings.find((booking) => {
    if (booking.event_id !== eventId || booking.venue_id !== venueId) return false;
    if (!LIVE_BOOKING_STATUSES.includes(String(booking.status || "").toUpperCase())) return false;
    const otherFrom = asTime(booking.occupied_start || booking.start_datetime);
    const otherTo = asTime(booking.occupied_end || booking.end_datetime);
    return otherFrom != null && otherTo != null && from < otherTo && otherFrom < to;
  }) || null;
};
