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
  LAYOUT: "LAYOUT"
};

export const BLOCKING_CRITERIA = [CRITERIA.CAPACITY];
export const ACKNOWLEDGEABLE_CRITERIA = [CRITERIA.FACILITY, CRITERIA.ACCESSIBILITY, CRITERIA.LAYOUT];

export const CRITERION_LABEL = {
  [CRITERIA.CAPACITY]: "Capacity",
  [CRITERIA.FACILITY]: "Required facilities",
  [CRITERIA.ACCESSIBILITY]: "Accessibility features",
  [CRITERIA.LAYOUT]: "Room layout"
};

// Events store `required_layout` and answer the facility / accessibility sections
// with a list that is empty when the organiser answered No (B9 AC2).
export const bookingRequirements = (event = {}) => ({
  expected_attendance: Number(event.expected_attendance) || 0,
  facilities: event.facilities || [],
  accessibility: event.accessibility || [],
  layout: event.required_layout || null
});

const missingFrom = (required = [], available = []) =>
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

  return lines;
};

// The same lines, gathered under the criterion they belong to, for rendering.
export const groupedRequirementLines = (venue, requirements) => {
  const lines = requirementLines(venue, requirements);
  return [CRITERIA.CAPACITY, CRITERIA.FACILITY, CRITERIA.ACCESSIBILITY, CRITERIA.LAYOUT]
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
  const [capacity] = assessment.blocking;
  if (capacity) {
    return `Capacity is ${capacity.available}; this event expects ${capacity.required}. This venue cannot be requested.`;
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
