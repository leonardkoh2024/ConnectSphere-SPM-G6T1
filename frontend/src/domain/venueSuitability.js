// E8 — the suitability gate in front of a venue booking request.
// No React, no Firebase: the screen assembles the event and venue and calls these.
//
// Capacity is the one criterion a coordinator cannot talk their way past: a room
// that physically cannot hold the pax is refused outright. Facility, accessibility
// and layout shortfalls are judgement calls — the coordinator may proceed, but the
// decision is written onto the booking so Venue Staff assess it with eyes open.

import { capacityFits } from "./venueSearch";

export const CRITERIA = {
  CAPACITY: "CAPACITY",
  FACILITY: "FACILITY",
  ACCESSIBILITY: "ACCESSIBILITY",
  LAYOUT: "LAYOUT",
  OPERATING_HOURS: "OPERATING_HOURS"
};

// E7 AC4 — a venue shut for the requested time cannot host the event, so it is a
// hard stop beside capacity rather than something to acknowledge past. This goes
// further than E8 AC1, which names only capacity; the deviation is deliberate.
export const BLOCKING_CRITERIA = [CRITERIA.CAPACITY, CRITERIA.OPERATING_HOURS];
export const ACKNOWLEDGEABLE_CRITERIA = [CRITERIA.FACILITY, CRITERIA.ACCESSIBILITY, CRITERIA.LAYOUT];

export const CRITERION_LABEL = {
  [CRITERIA.CAPACITY]: "Capacity",
  [CRITERIA.FACILITY]: "Required facilities",
  [CRITERIA.ACCESSIBILITY]: "Accessibility features",
  [CRITERIA.LAYOUT]: "Room layout",
  [CRITERIA.OPERATING_HOURS]: "Operating hours"
};

// Events store `required_layout` and answer the facility / accessibility sections
// with a list that is empty when the organiser answered No (B9 AC2).
const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

export const weekdayOf = (isoDate) => {
  const parts = String(isoDate || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return date.getMonth() === parts[1] - 1 && date.getDate() === parts[2] ? WEEKDAYS[date.getDay()] : null;
};

// A venue that states no hours at all is treated as open at any time: that is
// missing data, not a closure. One that states hours and is shut then is not.
export const opensFor = (venue, requirements) => {
  const stated = venue.operating_hours || [];
  if (!stated.length) return true;
  const weekday = weekdayOf(requirements.event_date);
  if (!weekday) return true;
  const onDay = stated.filter((row) => String(row.weekday).toUpperCase() === weekday);
  if (!onDay.length) return false;
  if (!requirements.start_time || !requirements.end_time) return true;
  return onDay.some((row) => requirements.start_time >= row.opens_at && requirements.end_time <= row.closes_at);
};

// F12 — with a booking's own details, a venue is judged on that booking's
// attendance and layout; facilities, accessibility and the date stay the event's.
export const bookingRequirements = (event = {}, booking = null) => ({
  expected_attendance: Number(booking ? booking.expected_attendance : event.expected_attendance) || 0,
  event_date: event.event_date || "",
  start_time: event.start_time || "",
  end_time: event.end_time || "",
  facilities: event.facilities || [],
  accessibility: event.accessibility || [],
  layout: (booking ? booking.layout : event.required_layout) || null
});

const missingFrom = (required, available) =>
  required.filter((item) => !available.includes(item));

export const assessVenue = (venue, requirements) => {
  const evaluated = [CRITERIA.CAPACITY];
  const blocking = [];
  const warnings = [];

  if (!capacityFits(venue, requirements.expected_attendance)) {
    blocking.push({
      criterion: CRITERIA.CAPACITY,
      required: requirements.expected_attendance,
      available: venue.max_capacity
    });
  }

  // Only judged when a date was actually stated.
  if (requirements.event_date) {
    evaluated.push(CRITERIA.OPERATING_HOURS);
    if (!opensFor(venue, requirements)) {
      blocking.push({
        criterion: CRITERIA.OPERATING_HOURS,
        weekday: weekdayOf(requirements.event_date),
        available: venue.operating_hours
          .filter((row) => String(row.weekday).toUpperCase() === weekdayOf(requirements.event_date))
          .map((row) => `${row.opens_at}–${row.closes_at}`)
      });
    }
  }

  const shortfall = (criterion, required, available) => {
    if (!required.length) return;
    evaluated.push(criterion);
    const missing = missingFrom(required, available);
    if (missing.length) warnings.push({ criterion, missing });
  };

  shortfall(CRITERIA.FACILITY, requirements.facilities, venue.facilities || []);
  shortfall(CRITERIA.ACCESSIBILITY, requirements.accessibility, venue.accessibility || []);
  shortfall(CRITERIA.LAYOUT, requirements.layout ? [requirements.layout] : [], venue.layouts || []);

  return {
    venue_id: venue.venue_id,
    suitable: blocking.length === 0 && warnings.length === 0,
    evaluated,
    blocking,
    warnings
  };
};

export const isBlocked = (assessment) => assessment.blocking.length > 0;

// F1 AC4 — the same event and venue cannot be requested twice while a request is
// still live. A rejected or cancelled one leaves the pairing free to try again.
export const LIVE_BOOKING_STATUSES = ["PENDING", "APPROVED"];

export const existingBookingFor = (bookings = [], { eventId, venueId }) =>
  bookings.find((booking) =>
    booking.event_id === eventId &&
    booking.venue_id === venueId &&
    LIVE_BOOKING_STATUSES.includes(String(booking.status || "").toUpperCase())) || null;

// One line per thing the event actually asked for, each judged on its own, so a
// venue can be read down a list rather than inferred from a comma-separated
// summary. The venue picker and the booking gate both render from this, which is
// what keeps the two views from disagreeing.
export const requirementLines = (venue, requirements) => {
  const lines = [{
    criterion: CRITERIA.CAPACITY,
    label: `${requirements.expected_attendance} pax`,
    met: capacityFits(venue, requirements.expected_attendance)
  }];

  const held = (available = []) => (item) => available.includes(item);

  (requirements.facilities || []).forEach((item) => lines.push({
    criterion: CRITERIA.FACILITY, label: item, met: held(venue.facilities)(item)
  }));
  (requirements.accessibility || []).forEach((item) => lines.push({
    criterion: CRITERIA.ACCESSIBILITY, label: item, met: held(venue.accessibility)(item)
  }));
  if (requirements.layout) lines.push({
    criterion: CRITERIA.LAYOUT, label: requirements.layout, met: held(venue.layouts)(requirements.layout)
  });
  if (requirements.event_date) {
    const weekday = weekdayOf(requirements.event_date) || requirements.event_date;
    lines.push({
      criterion: CRITERIA.OPERATING_HOURS,
      label: requirements.start_time && requirements.end_time
        ? `${weekday} ${requirements.start_time}–${requirements.end_time}`
        : weekday,
      met: opensFor(venue, requirements)
    });
  }

  return lines;
};

// The same lines, gathered under the criterion they belong to, for rendering.
export const groupedRequirementLines = (venue, requirements) => {
  const lines = requirementLines(venue, requirements);
  return [CRITERIA.CAPACITY, CRITERIA.OPERATING_HOURS, CRITERIA.FACILITY, CRITERIA.ACCESSIBILITY, CRITERIA.LAYOUT]
    .map((criterion) => ({ criterion, lines: lines.filter((line) => line.criterion === criterion) }))
    .filter((group) => group.lines.length);
};

export const outstandingAcknowledgements = ({ assessment, acknowledged = [] }) =>
  assessment.warnings
    .map((warning) => warning.criterion)
    .filter((criterion) => !acknowledged.includes(criterion));

export const canSubmitBooking = ({ assessment, acknowledged = [] }) =>
  !isBlocked(assessment) && outstandingAcknowledgements({ assessment, acknowledged }).length === 0;

export const submissionBlockReason = ({ assessment, acknowledged = [] }) => {
  const capacity = assessment.blocking.find((item) => item.criterion === CRITERIA.CAPACITY);
  if (capacity) {
    return `Capacity is ${capacity.available}; this event expects ${capacity.required}. This venue cannot be requested.`;
  }
  const hours = assessment.blocking.find((item) => item.criterion === CRITERIA.OPERATING_HOURS);
  if (hours) {
    return hours.available.length
      ? `This venue opens ${hours.available.join(", ")} on ${hours.weekday}. The requested time falls outside that, so it cannot be requested.`
      : `This venue does not open on ${hours.weekday}, so it cannot be requested.`;
  }
  const outstanding = outstandingAcknowledgements({ assessment, acknowledged });
  if (outstanding.length) {
    return `Acknowledge ${outstanding.map((item) => CRITERION_LABEL[item].toLowerCase()).join(" and ")} before requesting this venue.`;
  }
  return null;
};

export const acknowledgementRecord = ({ assessment, acknowledged = [], userId, at }) => {
  const outstanding = outstandingAcknowledgements({ assessment, acknowledged });
  if (outstanding.length) {
    throw new Error(`Cannot record an acknowledgement while ${outstanding.join(", ")} is unacknowledged.`);
  }
  if (!assessment.warnings.length) {
    return { acknowledged: false, criteria: [], missing: {}, acknowledged_by: null, acknowledged_at: null };
  }
  return {
    acknowledged: true,
    criteria: assessment.warnings.map((warning) => warning.criterion),
    missing: Object.fromEntries(assessment.warnings.map((warning) => [warning.criterion, warning.missing])),
    acknowledged_by: userId,
    acknowledged_at: at
  };
};
