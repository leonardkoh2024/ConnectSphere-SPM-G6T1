// F9 / SCRUM-174, E11 / SCRUM-173.
// Plain functions: no React, no Firebase. The Venue Staff availability screen calls these.

const APPROVED = "APPROVED";

const UNAVAILABILITY_REASONS = ["Maintenance", "Equipment failure", "Renovation", "Safety concern", "Other"];

const asUpper = (value) => String(value || "").toUpperCase();
const instant = (value) => new Date(value).getTime();

function occupiedBookingWindow(booking, venueRecord = {}) {
  const start = instant(booking.start_datetime) - (Number(venueRecord.setup_minutes) || 0) * 60000;
  const end = instant(booking.end_datetime) + (Number(venueRecord.turnaround_minutes) || 0) * 60000;
  return { start, end };
}

function windowsOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

function calendarSegments(booking, venueRecord) {
  const eventStart = instant(booking.start_datetime);
  const eventEnd = instant(booking.end_datetime);
  const occupied = occupiedBookingWindow(booking, venueRecord);
  return [
    { kind: "setup", start: occupied.start, end: eventStart },
    { kind: "event", start: eventStart, end: eventEnd },
    { kind: "turnaround", start: eventEnd, end: occupied.end }
  ].filter((segment) => segment.end > segment.start);
}

function affectedApprovedBookings({ venueId, start, end, bookings = [] }) {
  const window = { start: instant(start), end: instant(end) };
  return bookings.filter((booking) => booking.venue_id === venueId
    && asUpper(booking.status) === APPROVED
    && windowsOverlap(window, {
      start: instant(booking.occupied_start || booking.start_datetime),
      end: instant(booking.occupied_end || booking.end_datetime)
    }));
}

module.exports = {
  UNAVAILABILITY_REASONS,
  occupiedBookingWindow,
  windowsOverlap,
  calendarSegments,
  affectedApprovedBookings
};
