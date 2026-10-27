// H1 / SCRUM-139 — Open registration for my event. The rules for setting an event's
// registration capacity and window, and for refusing a registration made outside it.
// No React, no Firebase: the registration service (backend) and the Registration tab
// (frontend) both read these, so what the organiser is told on screen is what the
// server enforces. It is an .mjs file so the backend can import it unchanged, the same
// way equipmentAvailability.mjs is shared; registrationWindow.js re-exports it for CRA.
//
// Times are Singapore time (UTC+8, no daylight saving), as in venueHolds.js. The window is
// half-open: registration is open from the open instant and closed from the close instant.
// The registration service applies the window check when an attendee registers (H3); no
// browser can create a registration, so firestore.rules carry no copy of it.

// AC1 — Approved or later. Completed, Cancelled and Rejected are past or ended, so they never
// take registration.
export const REGISTRATION_OPENABLE_STATUSES = ["APPROVED", "PLANNING", "SAFETY_REVIEW", "CONFIRMED"];
const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "REJECTED"];

// AC5 — only attendees holding a place count towards the capacity floor.
export const REGISTERED_STATUS = "REGISTERED";

const MESSAGES = {
  flagOff: "This event does not use attendee registration.",
  notApproved: "Registration can be opened once your event is approved.",
  ended: "Registration cannot be changed for a completed, cancelled or rejected event.",
  closed: "Registration has closed, so its capacity and window can no longer be changed.",
  capacityNumber: "Registration capacity must be a whole number greater than zero.",
  noVenue: "Capacity can be set once a venue booking has been approved.",
  windowRequired: "Registration open and close date/time are required when registration is enabled.",
  closeAfterOpen: "Registration close date/time must be after registration open date/time.",
  closeBeforeStart: "Registration close date/time must be at or before the event start.",
  closeInFuture: "Registration close date/time must be in the future.",
  notOpenYet: "Registration is not open yet.",
  attemptClosed: "Registration has closed."
};

const venueLimitMessage = (ceiling) => `Registration capacity cannot exceed the venue capacity of ${ceiling}.`;
export const registeredFloorMessage = (count) =>
  `Registration capacity cannot be less than the ${count} ${count === 1 ? "person" : "people"} already registered.`;

const blank = (value) => !String(value ?? "").trim();
const upper = (value) => String(value || "").toUpperCase();

// "2026-12-01" + "17:00" in Singapore time, or null when either half is missing or invalid.
export const registrationInstant = (date, time) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? "").trim()) || !/^\d{2}:\d{2}$/.test(String(time ?? "").trim())) return null;
  const instant = new Date(`${String(date).trim()}T${String(time).trim()}:00+08:00`);
  return Number.isNaN(instant.getTime()) ? null : instant;
};

export const registrationWindowOf = (event = {}) => ({
  opensAt: registrationInstant(event.registration_open_date, event.registration_open_time),
  closesAt: registrationInstant(event.registration_close_date, event.registration_close_time)
});

// AC2 — Not set up, Scheduled, Open or Closed.
export const registrationPhase = (event, now = new Date()) => {
  const { opensAt, closesAt } = registrationWindowOf(event);
  if (!opensAt || !closesAt) return "NOT_SET";
  if (now < opensAt) return "SCHEDULED";
  if (now < closesAt) return "OPEN";
  return "CLOSED";
};

// AC1, AC2 — why registration cannot be set up (or changed) now, or null. The flag is judged
// first, then the status, then whether the window has already closed.
export const registrationSetupRefusal = (event, now = new Date()) => {
  if (event?.registration_required !== true) return { reason: "flag_off", message: MESSAGES.flagOff };
  const status = upper(event.status);
  if (!REGISTRATION_OPENABLE_STATUSES.includes(status)) {
    return { reason: "status", message: TERMINAL_STATUSES.includes(status) ? MESSAGES.ended : MESSAGES.notApproved };
  }
  if (registrationPhase(event, now) === "CLOSED") return { reason: "closed", message: MESSAGES.closed };
  return null;
};

// AC4 — why a registration attempted at `now` must be refused, or null when it may go ahead.
export const registrationAttemptRefusal = (event, now = new Date()) => {
  if (event?.registration_required !== true) return { reason: "not_enabled", message: MESSAGES.flagOff };
  if (!REGISTRATION_OPENABLE_STATUSES.includes(upper(event.status))) return { reason: "status", message: MESSAGES.notApproved };
  const phase = registrationPhase(event, now);
  if (phase === "NOT_SET" || phase === "SCHEDULED") return { reason: "not_open_yet", message: MESSAGES.notOpenYet };
  if (phase === "CLOSED") return { reason: "closed", message: MESSAGES.attemptClosed };
  return null;
};

// AC3 — the combined max_capacity of the venues of the event's APPROVED bookings. A venue booked
// twice for the same event counts once; null when no booking is approved yet.
export const venueCapacityCeiling = (bookings = [], venues = {}) => {
  const venueIds = [...new Set(bookings.filter((booking) => upper(booking?.status) === "APPROVED").map((booking) => booking.venue_id))];
  const known = venueIds.filter((id) => Number.isFinite(Number(venues[id]?.max_capacity)));
  if (!known.length) return null;
  return known.reduce((total, id) => total + Number(venues[id].max_capacity), 0);
};

// AC2, AC3, AC5 — check what the organiser entered. `input` holds the form's strings;
// `ceiling` is the venue limit (null when no booking is approved), `registeredCount` the
// number of REGISTERED attendees. Every problem is reported together, keyed by form field;
// on success `values` holds the fields to store.
export const validateRegistrationSettings = (input = {}, { event = {}, ceiling = null, registeredCount = 0, now = new Date() } = {}) => {
  const errors = {};

  const rawCapacity = String(input.registrationCapacity ?? "").trim();
  if (!/^\d+$/.test(rawCapacity) || Number(rawCapacity) < 1) {
    errors.registrationCapacity = MESSAGES.capacityNumber;
  } else {
    const capacity = Number(rawCapacity);
    if (ceiling === null || ceiling === undefined) {
      // No approved venue: the capacity the request carried may stay, but it cannot change.
      if (String(capacity) !== String(event.registration_capacity ?? "")) errors.registrationCapacity = MESSAGES.noVenue;
    } else if (capacity > ceiling) {
      errors.registrationCapacity = venueLimitMessage(ceiling);
    } else if (capacity < registeredCount) {
      errors.registrationCapacity = registeredFloorMessage(registeredCount);
    }
  }

  const opensAt = registrationInstant(input.registrationOpenDate, input.registrationOpenTime);
  const closesAt = registrationInstant(input.registrationCloseDate, input.registrationCloseTime);
  if (!opensAt || !closesAt) {
    errors.registrationWindow = MESSAGES.windowRequired;
  } else {
    const eventStart = registrationInstant(event.event_date, event.start_time);
    if (closesAt <= opensAt) errors.registrationCloseDate = MESSAGES.closeAfterOpen;
    else if (eventStart && closesAt > eventStart) errors.registrationCloseDate = MESSAGES.closeBeforeStart;
    else if (closesAt <= now) errors.registrationCloseDate = MESSAGES.closeInFuture;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    errors: {},
    values: {
      registration_capacity: Number(rawCapacity),
      registration_open_date: String(input.registrationOpenDate).trim(),
      registration_open_time: String(input.registrationOpenTime).trim(),
      registration_close_date: String(input.registrationCloseDate).trim(),
      registration_close_time: String(input.registrationCloseTime).trim(),
      registration_opens_at: opensAt,
      registration_closes_at: closesAt
    }
  };
};

// I3 / SCRUM-149 AC4 — lowering the registration capacity below the number of attendees
// already registered is allowed, but only with an explicit acknowledgement. Nobody is
// unregistered: the capacity only limits new places. A capacity that was never set has
// nothing to reduce.
export const capacityReductionNeedsAcknowledgement = ({ oldCapacity, newCapacity, registeredCount = 0 } = {}) => {
  if (oldCapacity === null || oldCapacity === undefined || oldCapacity === "") return false;
  const before = Number(oldCapacity);
  const after = Number(newCapacity);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return false;
  return after < before && after < Number(registeredCount);
};

// I3 / SCRUM-149 AC5 — the registration window and capacity are re-checked when an applied
// change alters the date, start time, expected attendance or venue. (The venue is the
// preferred location and the layout the venue must offer.)
const REGISTRATION_RECHECK_FIELDS = ["event_date", "start_time", "expected_attendance", "preferred_location", "required_layout"];

export const registrationRecheckApplies = (significantChanges = {}) =>
  REGISTRATION_RECHECK_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(significantChanges || {}, field));

export const REGISTRATION_REVIEW_REASONS = {
  CLOSES_AFTER_START: "CLOSES_AFTER_START",
  CAPACITY_ABOVE_VENUE: "CAPACITY_ABOVE_VENUE"
};

// I3 / SCRUM-149 AC5 — does the registration now need the organiser's review? It only says
// so: nothing here edits, closes or cancels a registration. Closing exactly at the start is
// not after it. With no approved booking there is no venue limit to compare with.
export const registrationReview = ({ event = {}, bookings = [], venues = {} } = {}) => {
  const reasons = [];
  if (event?.registration_required !== true) return { needsReview: false, reasons };

  const { closesAt } = registrationWindowOf(event);
  const eventStart = registrationInstant(event.event_date, event.start_time);
  if (closesAt && eventStart && closesAt > eventStart) reasons.push(REGISTRATION_REVIEW_REASONS.CLOSES_AFTER_START);

  const ceiling = venueCapacityCeiling(bookings, venues);
  const capacity = Number(event.registration_capacity);
  if (ceiling !== null && Number.isFinite(capacity) && capacity > ceiling) reasons.push(REGISTRATION_REVIEW_REASONS.CAPACITY_ABOVE_VENUE);

  return { needsReview: reasons.length > 0, reasons };
};
