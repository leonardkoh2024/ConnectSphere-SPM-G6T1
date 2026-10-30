// F2 / SCRUM-126, F6 / SCRUM-130, F9 / SCRUM-174, E11 / SCRUM-173.
// Plain functions: no React, no Firebase. Screens and the venue service call these.

const VENUE_STAFF = "VENUE_STAFF";
const PENDING = "PENDING";
const APPROVED = "APPROVED";
const SERVER_TIMESTAMP = "SERVER_TIMESTAMP";

const UNAVAILABILITY_REASONS = ["Maintenance", "Equipment failure", "Renovation", "Safety concern", "Other"];
const REPLACEMENT_NEEDED = "Venue unavailable - replacement needed";

const asUpper = (value) => String(value || "").toUpperCase();
const instant = (value) => new Date(value).getTime();
const validInstant = (value) => Number.isFinite(instant(value));

function occupiedBookingWindow(booking, venueRecord = {}) {
  const start = instant(booking.start_datetime) - (Number(venueRecord.setup_minutes) || 0) * 60000;
  const end = instant(booking.end_datetime) + (Number(venueRecord.turnaround_minutes) || 0) * 60000;
  return { start, end };
}

function windowsOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

function activeVenueStaff(staff) {
  return staff
    .filter((person) => person.active !== false && person.role === VENUE_STAFF)
    .sort((left, right) => String(left.staff_id).localeCompare(String(right.staff_id)));
}

function nextVenueStaff(staff, priorAssignments) {
  const active = activeVenueStaff(staff);
  if (!active.length) return null;
  const last = [...priorAssignments].reverse().find((staffId) => active.some((person) => person.staff_id === staffId));
  if (!last) return active[0];
  const index = active.findIndex((person) => person.staff_id === last);
  return active[(index + 1) % active.length];
}

function assignVenueStaff({ booking, staff = [], priorAssignments = [], now = SERVER_TIMESTAMP }) {
  if (!booking) return { ok: false, reason: "required" };
  if (booking.assigned_staff_id) {
    return { ok: false, reason: "already_assigned", booking, queue: null };
  }
  const chosen = nextVenueStaff(staff, priorAssignments);
  if (!chosen) {
    return {
      ok: true,
      booking: { ...booking, assigned_staff_id: null, assigned_at: null },
      queue: "unassigned"
    };
  }
  return {
    ok: true,
    booking: {
      ...booking,
      assigned_staff_id: chosen.staff_id,
      assigned_at: now
    },
    queue: null
  };
}

function unassignedBookingQueue(bookings = []) {
  return bookings.filter((booking) => !booking.assigned_staff_id && asUpper(booking.status) === PENDING);
}

function sameCalendarDate(left, right) {
  return String(left || "").slice(0, 10) === String(right || "").slice(0, 10);
}

function approvedConflicts(booking, bookings, venueRecord) {
  const requested = occupiedBookingWindow(booking, venueRecord);
  return bookings.filter((other) => other.booking_id !== booking.booking_id
    && other.venue_id === booking.venue_id
    && asUpper(other.status) === APPROVED
    && sameCalendarDate(other.start_datetime, booking.start_datetime)
    && windowsOverlap(requested, occupiedBookingWindow(other, venueRecord)));
}

function unavailabilityConflicts(booking, unavailability, venueRecord) {
  const requested = occupiedBookingWindow(booking, venueRecord);
  return unavailability.filter((period) => period.venue_id === booking.venue_id
    && windowsOverlap(requested, { start: instant(period.start_datetime), end: instant(period.end_datetime) }));
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

function recordVenueUnavailability({
  venueId,
  start,
  end,
  reason,
  note = "",
  bookings = [],
  events = [],
  confirmed = false,
  staffId,
  now = SERVER_TIMESTAMP
}) {
  if (!UNAVAILABILITY_REASONS.includes(reason)) return { ok: false, reason: "reason" };
  if (reason === "Other" && !String(note || "").trim()) return { ok: false, reason: "note_required" };
  if (!validInstant(start) || !validInstant(end) || instant(end) <= instant(start)) {
    return { ok: false, reason: "time_range" };
  }
  const affected = affectedApprovedBookings({ venueId, start, end, bookings });
  if (affected.length && !confirmed) {
    return { ok: false, reason: "confirmation_required", affected };
  }
  const markedIds = new Set(affected.map((booking) => booking.booking_id));
  return {
    ok: true,
    period: {
      venue_id: venueId,
      start_datetime: start,
      end_datetime: end,
      reason,
      note: String(note || "").trim(),
      created_by: staffId,
      created_at: now
    },
    bookings: bookings.map((booking) => markedIds.has(booking.booking_id)
      ? { ...booking, replacement_status: REPLACEMENT_NEEDED }
      : booking),
    events: events.map((event) => ({ ...event })),
    notifications: affected.map((booking) => {
      const event = events.find((item) => item.event_id === booking.event_id);
      return {
        user_id: event?.coordinator_id || null,
        event_id: booking.event_id,
        venue_id: venueId,
        start_datetime: start,
        end_datetime: end,
        reason,
        type: "VENUE_UNAVAILABLE"
      };
    })
  };
}

function searchBlockedByUnavailability({ venueId, start, end, unavailability = [] }) {
  const requested = { start: instant(start), end: instant(end) };
  return unavailability.some((period) => period.venue_id === venueId
    && windowsOverlap(requested, { start: instant(period.start_datetime), end: instant(period.end_datetime) }));
}

module.exports = {
  UNAVAILABILITY_REASONS,
  REPLACEMENT_NEEDED,
  occupiedBookingWindow,
  windowsOverlap,
  assignVenueStaff,
  unassignedBookingQueue,
  approvedConflicts,
  unavailabilityConflicts,
  calendarSegments,
  affectedApprovedBookings,
  recordVenueUnavailability,
  searchBlockedByUnavailability
};
