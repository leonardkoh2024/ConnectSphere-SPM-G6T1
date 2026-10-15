/**
 * ================================================================
 * TESTCASE.JS - AUTOMATED TEST SUITE
 * ================================================================
 *
 * A1 / SCRUM-82   Self-register as an Event Organiser      TC-001 – TC-004
 * A2 / SCRUM-83   Register an Attendee account             TC-005 – TC-008
 * A3 / SCRUM-84   Sign in and sign out                     TC-009 – TC-013
 * B2 / SCRUM-93   State the venue requirements             TC-022 – TC-024
 * B3 / SCRUM-94   State the accessibility needs            TC-025 – TC-026
 * C4               Request clarification or amendments
 * C7               Reject a request with a reason
 * C8               Understand the decision on my request
 * C9               Reassign an event to another coordinator
 * C5 / SCRUM-106  Respond to a request for clarification   TC-081 – TC-088
 * E2 / SCRUM-118  Browse the venue catalogue               TC-089 – TC-094
 * E5 / SCRUM-121  Find venues that fit my event            TC-095 – TC-103
 * E6 / SCRUM-122  Narrow the shortlist                     TC-104 – TC-111
 * F1 / SCRUM-125  Request a venue for an event
 * F3 / SCRUM-127  See booking requests waiting on me
 * F4 / SCRUM-128  Approve a venue booking request
 * F7 / SCRUM-131  Track the status of my booking requests
 * F8 / SCRUM-132  Release a venue when it is no longer needed
 * E9 / SCRUM-171  Set a venue's setup and turnaround time
 * E10 / SCRUM-172 Record a venue's safety information
 * F2 / SCRUM-126  Assign a submitted booking to venue staff
 * F6 / SCRUM-130  Never double-book a venue
 * E11 / SCRUM-173 Take a venue out of use even when events are booked
 * F9 / SCRUM-174  Count setup and turnaround time in clash checks
 *
 * Run from the repo root (no extra install — Node's built-in runner):
 *   node --test test.js
 *
 * These stories have no screens yet. The helpers below are the domain rules
 * the screens must call; when those land, move the helpers into
 * frontend/src/domain/ and keep these assertions.
 *
 * Last Updated: 2026-10-15
 * ================================================================
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

// node:test does not provide Jest's test.each helper. This tiny equivalent
// keeps boundary and role matrices readable without adding a test dependency.
function testEach(cases) {
  return (name, callback) => cases.forEach((entry) => {
    const args = Array.isArray(entry) ? entry : [entry];
    let placeholder = 0;
    const caseName = name.replace(/%s/g, () => String(args[placeholder++]));
    test(caseName, () => callback(...args));
  });
}

const ROLES = {
  ORGANISER: "EVENT_ORGANISER",
  COORDINATOR: "EVENT_COORDINATOR",
  VENUE_STAFF: "VENUE_STAFF",
  SAFETY_OFFICER: "SAFETY_OFFICER",
  TECH_SUPPORT: "TECHNICAL_SUPPORT_STAFF",
  ATTENDEE: "ATTENDEE"
};

const STATUS = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  PLANNING: "PLANNING",
  SAFETY_REVIEW: "SAFETY_REVIEW",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED"
};
const SERVER_TIMESTAMP = "SERVER_TIMESTAMP";

// -----------------------------------------------------------------------------
// A1 / A2 / A3 helpers
// -----------------------------------------------------------------------------

const PORTALS = { CORPORATE: "corporate", INDIVIDUAL: "individual" };
const ROLE_PORTAL = {
  [ROLES.ORGANISER]: PORTALS.CORPORATE,
  [ROLES.COORDINATOR]: PORTALS.CORPORATE,
  [ROLES.VENUE_STAFF]: PORTALS.CORPORATE,
  [ROLES.TECH_SUPPORT]: PORTALS.CORPORATE,
  [ROLES.ATTENDEE]: PORTALS.INDIVIDUAL
};
const GENERIC_REGISTRATION_ERROR = "We could not create an account with those details. Please check them and try again.";
const GENERIC_LOGIN_ERROR = "We could not sign you in with those details. Please check them and try again.";
const WRONG_PORTAL_ERROR = "This account cannot be used in this portal. Please use the correct sign-in area.";

function isStrongPassword(password) {
  return String(password).length >= 12
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

function isValidMobileNumber(number) {
  return /^\d{7,15}$/.test(String(number));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

function validateRegistration(input) {
  const missing = [];
  if (!String(input.name || "").trim()) missing.push("name");
  if (input.portal === PORTALS.CORPORATE && !String(input.organisationName || "").trim()) missing.push("organisation_name");
  if (!String(input.mobileNumber || "").trim()) missing.push("mobile_number");
  if (!input.preferredContactMethod) missing.push("preferred_contact_method");
  if (!String(input.email || "").trim()) missing.push("email");
  if (!String(input.password || "")) missing.push("password");
  if (!String(input.confirmPassword || "")) missing.push("confirm_password");

  if (missing.length) return { ok: false, reason: "required", fields: missing };
  if (!isValidEmail(input.email)) return { ok: false, reason: "email" };
  if (!isValidMobileNumber(input.mobileNumber)) return { ok: false, reason: "mobile_number" };
  if (!isStrongPassword(input.password)) return { ok: false, reason: "password" };
  if (input.password !== input.confirmPassword) return { ok: false, reason: "confirm_password" };
  return { ok: true };
}

function registrationInput(portal, overrides = {}) {
  return {
    portal,
    name: portal === PORTALS.CORPORATE ? "Alice Tan" : "Ben Lee",
    organisationName: portal === PORTALS.CORPORATE ? "ABC Events" : "",
    mobileNumber: portal === PORTALS.CORPORATE ? "12345678" : "91234567",
    preferredContactMethod: "EMAIL",
    email: portal === PORTALS.CORPORATE ? "alice+eo@test.com" : "ben@test.com",
    password: "qwerty12345!",
    confirmPassword: "qwerty12345!",
    ...overrides
  };
}

function createUserRecord(uid, input, now = SERVER_TIMESTAMP) {
  const validation = validateRegistration(input);
  if (!validation.ok) return { ok: false, validation };
  const corporate = input.portal === PORTALS.CORPORATE;
  return {
    ok: true,
    signedIn: true,
    approvalRequired: false,
    user: {
      user_id: uid,
      name: input.name.trim(),
      email: input.email.trim(),
      role: corporate ? ROLES.ORGANISER : ROLES.ATTENDEE,
      organisation_name: corporate ? input.organisationName.trim() : null,
      mobile_number: input.mobileNumber.trim(),
      preferred_contact_method: input.preferredContactMethod,
      is_active: true,
      created_at: now,
      updated_at: now
    }
  };
}

function registrationError() {
  return GENERIC_REGISTRATION_ERROR;
}

function canAccessRole(userRole, requiredRole) {
  return userRole === requiredRole;
}

function signInAccount(account, { email, password, portal, requestedPath = null }) {
  if (!account || account.email !== email || account.password !== password) {
    return { ok: false, error: GENERIC_LOGIN_ERROR, signedIn: false };
  }
  if (ROLE_PORTAL[account.role] !== portal) {
    return { ok: false, error: WRONG_PORTAL_ERROR, signedIn: false };
  }
  return { ok: true, signedIn: true, destination: requestedPath || "#/" };
}

function signOutSession(session) {
  return { ...session, signedIn: false, destination: "#/sign-in" };
}

function protectedRoute(session, requestedPath) {
  return session?.signedIn
    ? { protectedContent: true, destination: requestedPath }
    : { protectedContent: false, destination: "#/sign-in", requestedPath };
}

// -----------------------------------------------------------------------------
// B2 / B3 helpers
// -----------------------------------------------------------------------------

// Mirrors the three Firestore writes made by EventRequestForm. Catalogue values
// are stable identifiers (for example CENTRAL and THEATRE); display labels are
// deliberately not persisted.
function buildRequirementWrites({
  eventId,
  preferredLocation = "",
  requiredLayout = "",
  facilitiesRequired = false,
  facilities = [],
  accessibilityRequired = false,
  accessibility = [],
  accessibilityNotes = ""
}) {
  return {
    event_venue_requirements: {
      event_id: eventId,
      preferred_location: preferredLocation,
      required_layout: requiredLayout,
      facilities_required: facilitiesRequired,
      accessibility_needed: accessibilityRequired,
      accessibility_notes: accessibilityNotes
    },
    event_facilities: facilitiesRequired
      ? facilities.map((facilityId) => ({ event_id: eventId, facility_id: facilityId }))
      : [],
    event_accessibility: accessibilityRequired
      ? accessibility.map((accessibilityId) => ({ event_id: eventId, accessibility_id: accessibilityId }))
      : []
  };
}

// -----------------------------------------------------------------------------
// C4 / C7 / C8 / C9 helpers
// -----------------------------------------------------------------------------

function cleanRequiredText(value) {
  return String(value || "").trim();
}

function isCurrentCoordinator(event, userId) {
  return Boolean(event && userId && event.coordinator_id === userId);
}

function canRequestClarification(event, userId) {
  return isCurrentCoordinator(event, userId)
    && event.status === STATUS.UNDER_REVIEW
    && !event.open_clarification_id;
}

function requestClarification({ event, userId, message, clarificationId, now = SERVER_TIMESTAMP }) {
  const cleaned = cleanRequiredText(message);
  if (!cleaned) return { ok: false, reason: "empty", event };
  if (!canRequestClarification(event, userId)) return { ok: false, reason: "not_allowed", event };

  const clarification = {
    clarification_id: clarificationId,
    event_id: event.event_id,
    created_by: userId,
    message: cleaned,
    status: "OPEN",
    created_at: now,
    responded_at: null
  };
  return {
    ok: true,
    event: { ...event, status: STATUS.UNDER_REVIEW, open_clarification_id: clarificationId },
    clarification,
    history: {
      event_id: event.event_id,
      actor_id: userId,
      action_type: "CLARIFICATION_REQUESTED",
      description: cleaned,
      created_at: now
    }
  };
}

function canRejectEvent(event, userId) {
  return canRequestClarification(event, userId);
}

function canApproveEvent(event, userId) {
  return canRequestClarification(event, userId);
}

function rejectEvent({ event, userId, reason, now = SERVER_TIMESTAMP }) {
  const cleaned = cleanRequiredText(reason);
  if (!cleaned) return { ok: false, reason: "empty", event };
  if (!canRejectEvent(event, userId)) return { ok: false, reason: "not_allowed", event };

  return {
    ok: true,
    event: { ...event, status: STATUS.REJECTED },
    history: {
      event_id: event.event_id,
      actor_id: userId,
      action_type: "EVENT_REJECTED",
      field_name: "status",
      old_value: event.status,
      new_value: STATUS.REJECTED,
      description: cleaned,
      created_at: now
    }
  };
}

function canEditOrResubmit(event) {
  return Boolean(event && event.status !== STATUS.REJECTED);
}

function decisionDetails(event, history, coordinator) {
  const decisions = history
    .filter((item) => ["EVENT_APPROVED", "EVENT_REJECTED"].includes(item.action_type))
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const latest = decisions.at(-1);
  return {
    decision: latest?.new_value || event.status,
    reason: latest?.description || null,
    decided_at: latest?.created_at || null,
    decided_by: latest?.actor_id || null,
    coordinator_name: coordinator?.name || null
  };
}

const TERMINAL_EVENT_STATUSES = new Set([STATUS.COMPLETED, STATUS.CANCELLED, STATUS.REJECTED]);

function canReassignEvent(event, userId, targetCoordinator) {
  return isCurrentCoordinator(event, userId)
    && !TERMINAL_EVENT_STATUSES.has(event.status)
    && Boolean(targetCoordinator?.id)
    && targetCoordinator.active !== false
    && targetCoordinator.id !== userId;
}

function reassignEvent({ event, assignments = [], userId, targetCoordinator, now = SERVER_TIMESTAMP }) {
  if (!canReassignEvent(event, userId, targetCoordinator)) {
    return { ok: false, reason: "not_allowed", event, assignments };
  }

  const previous = assignments.find((item) => item.coordinator_id === userId && item.ended_at == null) || {
    assignment_id: `${event.event_id}_${userId}`,
    event_id: event.event_id,
    coordinator_id: userId,
    assigned_at: event.assigned_at || null
  };
  const endedAssignments = assignments
    .filter((item) => item !== previous && item.coordinator_id !== targetCoordinator.id)
    .map((item) => ({ ...item }));
  const nextAssignments = [
    ...endedAssignments,
    { ...previous, ended_at: now },
    {
      assignment_id: `${event.event_id}_${targetCoordinator.id}`,
      event_id: event.event_id,
      coordinator_id: targetCoordinator.id,
      assigned_at: now,
      ended_at: null
    }
  ];

  return {
    ok: true,
    event: { ...event, coordinator_id: targetCoordinator.id, assigned_at: now },
    assignments: nextAssignments,
    history: {
      event_id: event.event_id,
      actor_id: userId,
      action_type: "COORDINATOR_REASSIGNED",
      field_name: "coordinator_id",
      old_value: userId,
      new_value: targetCoordinator.id,
      created_at: now
    }
  };
}

function assignmentAccess(event, assignments, userId) {
  const current = event.coordinator_id === userId;
  const previouslyAssigned = assignments.some((item) => item.coordinator_id === userId);
  return { canView: current || previouslyAssigned, canEdit: current };
}

// -----------------------------------------------------------------------------
// C5 helpers
// -----------------------------------------------------------------------------

function canRespondToClarification(event, clarification, userId) {
  if (!event || !clarification) return false;
  if (clarification.status !== "OPEN") return false;
  if (event.open_clarification_id !== clarification.clarification_id) return false;
  if (event.organiser_id !== userId) return false;
  return true;
}

function submitClarificationResponse({
  event,
  clarification,
  responses = [],
  userId,
  message,
  fieldEdits = {},
  now = SERVER_TIMESTAMP
}) {
  if (!canRespondToClarification(event, clarification, userId)) {
    return { ok: false, event, clarification, responses };
  }
  if (!String(message || "").trim()) {
    return { ok: false, reason: "empty", event, clarification, responses };
  }

  const response = {
    clarification_id: clarification.clarification_id,
    responder_id: userId,
    message: String(message).trim(),
    created_at: now
  };

  return {
    ok: true,
    event: {
      ...event,
      ...fieldEdits,
      open_clarification_id: null,
      status: STATUS.UNDER_REVIEW
    },
    clarification: {
      ...clarification,
      status: "ANSWERED",
      responded_at: now
    },
    responses: [...responses, response]
  };
}

function chronologicalExchange(questions, responses) {
  const items = [
    ...questions.map((q) => ({ kind: "question", ...q })),
    ...responses.map((r) => ({ kind: "response", ...r }))
  ];
  return items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

function openEvent(overrides = {}) {
  return {
    event_id: "EVT-1",
    organiser_id: "u1",
    status: STATUS.UNDER_REVIEW,
    expected_attendance: 100,
    open_clarification_id: "CLR-001",
    ...overrides
  };
}

function openClarification(overrides = {}) {
  return {
    clarification_id: "CLR-001",
    event_id: "EVT-1",
    created_by: "coord-1",
    message: "Confirm expected attendance",
    status: "OPEN",
    created_at: "2026-09-23T10:00:00",
    responded_at: null,
    ...overrides
  };
}

// -----------------------------------------------------------------------------
// E2 helpers
// -----------------------------------------------------------------------------

const CATALOGUE_ROLES = [ROLES.COORDINATOR, ROLES.VENUE_STAFF];
const SEARCH_ROLES = [ROLES.COORDINATOR];

function canViewCatalogue(role) {
  return CATALOGUE_ROLES.includes(role);
}

function canSearchVenues(role) {
  return SEARCH_ROLES.includes(role);
}

function listCatalogue(venues) {
  return venues.map((venue) => ({
    venue_id: venue.venue_id,
    name: venue.name,
    location: venue.location,
    max_capacity: venue.max_capacity,
    headline_facilities: venue.facilities || []
  }));
}

function venueRecord(venue) {
  return {
    ...listCatalogue([venue])[0],
    layouts: venue.layouts || [],
    accessibility: venue.accessibility || [],
    operating_hours: venue.operating_hours || []
  };
}

function facilitiesLabel(facilities) {
  return facilities.length ? facilities.join(", ") : "None listed";
}

// -----------------------------------------------------------------------------
// E5 / E6 helpers
// -----------------------------------------------------------------------------

function daysFromToday(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function prefillSearch(event) {
  return {
    event_date: event.event_date,
    start_time: event.start_time,
    end_time: event.end_time,
    expected_attendance: event.expected_attendance
  };
}

// Touching endpoints do not overlap (07:00–09:00 vs 09:00–17:00 is free).
// Revisit if Session 3 adds setup / turnaround time (TC-097).
function timesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function isOccupied(venue, window, bookings = [], unavailability = []) {
  const blocks = [
    ...bookings.filter((b) => b.venue_id === venue.venue_id && String(b.status || "").toUpperCase() === "APPROVED"),
    ...unavailability.filter((u) => u.venue_id === venue.venue_id)
  ];
  return blocks.some((block) =>
    timesOverlap(window.start_time, window.end_time, block.start_time, block.end_time)
  );
}

function capacityFits(venue, attendance) {
  return venue.max_capacity >= attendance;
}

function searchVenues({ venues, window, bookings = [], unavailability = [] }) {
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
}

function emptyFilters() {
  return {
    location: null,
    min_capacity: null,
    max_capacity: null,
    facilities: [],
    accessibility: [],
    layout: null
  };
}

function activeFilters(filters) {
  const active = [];
  if (filters.location) active.push({ key: "location", value: filters.location });
  if (filters.min_capacity != null || filters.max_capacity != null) {
    active.push({ key: "capacity_range", value: [filters.min_capacity, filters.max_capacity] });
  }
  if (filters.facilities.length) active.push({ key: "facilities", value: filters.facilities });
  if (filters.accessibility.length) active.push({ key: "accessibility", value: filters.accessibility });
  if (filters.layout) active.push({ key: "layout", value: filters.layout });
  return active;
}

function applyFilters(venues, filters) {
  return venues.filter((venue) => {
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
}

function venue(id, fields) {
  return { venue_id: id, ...fields };
}

// -----------------------------------------------------------------------------
// E9 / E10 / F1 / F3 / F4 / F7 / F8 helpers
// -----------------------------------------------------------------------------

const BOOKING_STATUS = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
  RELEASED: "RELEASED",
  REPLACED: "REPLACED"
};

const VENUE_REQUESTABLE_STATUSES = new Set([STATUS.APPROVED, STATUS.PLANNING]);
const ACTIVE_BOOKING_STATUSES = new Set([BOOKING_STATUS.PENDING, BOOKING_STATUS.APPROVED]);
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

function makeVenueBookingRequest({
  event,
  venue: selectedVenue,
  coordinatorId,
  requiredLayout,
  requiredFacilities,
  existingBookings = [],
  bookingId = "VB-NEW",
  now = SERVER_TIMESTAMP
}) {
  if (!event || !selectedVenue) return { ok: false, reason: "required" };
  if (event.coordinator_id !== coordinatorId) return { ok: false, reason: "not_assigned" };
  if (!VENUE_REQUESTABLE_STATUSES.has(asUpper(event.status))) {
    return { ok: false, reason: "event_status" };
  }
  const required = [event.event_id, selectedVenue.venue_id, event.event_date,
    event.start_time, event.end_time, requiredLayout];
  if (required.some((value) => !String(value || "").trim()) || !Array.isArray(requiredFacilities)) {
    return { ok: false, reason: "required" };
  }
  const attendance = Number(event.expected_attendance);
  if (!Number.isInteger(attendance) || attendance <= 0) return { ok: false, reason: "attendance" };
  const start = `${event.event_date}T${event.start_time}:00+08:00`;
  const end = `${event.event_date}T${event.end_time}:00+08:00`;
  if (!validInstant(start) || !validInstant(end) || instant(end) <= instant(start)) {
    return { ok: false, reason: "time_range" };
  }
  const duplicate = existingBookings.some((booking) =>
    booking.event_id === event.event_id
      && booking.venue_id === selectedVenue.venue_id
      && asUpper(booking.status) === BOOKING_STATUS.PENDING);
  if (duplicate) return { ok: false, reason: "duplicate_pending" };

  const window = occupiedBookingWindow({ start_datetime: start, end_datetime: end }, selectedVenue);
  return {
    ok: true,
    booking: {
      booking_id: bookingId,
      event_id: event.event_id,
      venue_id: selectedVenue.venue_id,
      event_name: event.name,
      start_datetime: start,
      end_datetime: end,
      occupied_start: new Date(window.start).toISOString(),
      occupied_end: new Date(window.end).toISOString(),
      expected_attendance: attendance,
      requested_layout_id: requiredLayout,
      required_facilities: [...requiredFacilities],
      status: BOOKING_STATUS.PENDING,
      submitted_at: now,
      decided_at: null,
      decision_reason: null,
      requested_by: coordinatorId
    },
    routedVenueId: selectedVenue.venue_id
  };
}

function venueStaffQueue({ bookings, assignedVenueIds, sortBy = "submitted_at" }) {
  const allowed = new Set(assignedVenueIds);
  const field = sortBy === "requested_date" ? "start_datetime" : "submitted_at";
  return bookings
    .filter((booking) => allowed.has(booking.venue_id) && asUpper(booking.status) === BOOKING_STATUS.PENDING)
    .map((booking) => ({
      ...booking,
      event_name: booking.event_name,
      requested_date: String(booking.start_datetime || "").slice(0, 10),
      requested_window: `${booking.start_datetime}–${booking.end_datetime}`,
      expected_attendance: booking.expected_attendance,
      submitted_at: booking.submitted_at
    }))
    .sort((left, right) => {
      const primary = instant(left[field]) - instant(right[field]);
      if (primary) return primary;
      const secondary = instant(left.submitted_at) - instant(right.submitted_at);
      return secondary || String(left.booking_id).localeCompare(String(right.booking_id));
    });
}

function canApproveBooking(booking, assignedVenueIds) {
  return asUpper(booking?.status) === BOOKING_STATUS.PENDING
    && new Set(assignedVenueIds).has(booking.venue_id);
}

function approveBooking({
  booking,
  bookings,
  venue: selectedVenue,
  unavailability = [],
  staffId,
  assignedVenueIds,
  now = SERVER_TIMESTAMP
}) {
  if (!canApproveBooking(booking, assignedVenueIds)) return { ok: false, reason: "not_allowed" };
  const requested = occupiedBookingWindow(booking, selectedVenue);
  const conflicts = bookings.filter((other) => other.booking_id !== booking.booking_id
    && other.venue_id === booking.venue_id
    && windowsOverlap(requested, occupiedBookingWindow(other, selectedVenue)));
  const approved = conflicts.find((other) => asUpper(other.status) === BOOKING_STATUS.APPROVED);
  if (approved) {
    return { ok: false, reason: "approved_conflict", conflict: approved.booking_label || approved.booking_id };
  }
  const blocked = unavailability.find((period) => period.venue_id === booking.venue_id
    && windowsOverlap(requested, { start: instant(period.start_datetime), end: instant(period.end_datetime) }));
  if (blocked) return { ok: false, reason: "unavailable", conflict: blocked.reason };
  const submitted = instant(booking.submitted_at);
  const earlier = conflicts.find((other) => asUpper(other.status) === BOOKING_STATUS.PENDING
    && instant(other.submitted_at) < submitted);
  if (earlier) return { ok: false, reason: "earlier_pending", conflict: earlier.booking_id };

  const approvedBooking = {
    ...booking,
    status: BOOKING_STATUS.APPROVED,
    assigned_staff_id: staffId,
    decided_by: staffId,
    decided_at: now,
    occupied_start: new Date(requested.start).toISOString(),
    occupied_end: new Date(requested.end).toISOString()
  };
  return {
    ok: true,
    booking: approvedBooking,
    history: {
      event_id: booking.event_id,
      booking_id: booking.booking_id,
      actor_id: staffId,
      old_value: BOOKING_STATUS.PENDING,
      new_value: BOOKING_STATUS.APPROVED,
      created_at: now
    }
  };
}

function bookingStatusView({ event, coordinatorId, bookings }) {
  if (!event || event.coordinator_id !== coordinatorId) return { ok: false, reason: "not_allowed" };
  return {
    ok: true,
    bookings: bookings.filter((booking) => booking.event_id === event.event_id).map((booking) => ({
      booking_id: booking.booking_id,
      venue_id: booking.venue_id,
      venue_name: booking.venue_name,
      start_datetime: booking.start_datetime,
      end_datetime: booking.end_datetime,
      status: booking.status,
      decision_reason: booking.decision_reason || null,
      decided_at: booking.decided_at || null,
      release_reason: booking.release_reason || null
    }))
  };
}

function canConfirmEvent({ bookings, safetyRequired = false, safetyApproved = false }) {
  const hasApprovedVenue = bookings.some((booking) => asUpper(booking.status) === BOOKING_STATUS.APPROVED);
  return hasApprovedVenue && (!safetyRequired || safetyApproved);
}

function releaseCancelledBookings({ event, bookings, coordinatorId, reason = "Event cancelled", now = SERVER_TIMESTAMP }) {
  if (event.coordinator_id !== coordinatorId || asUpper(event.status) !== STATUS.CANCELLED) {
    return { ok: false, reason: "not_allowed", bookings, history: [] };
  }
  const history = [];
  const released = bookings.map((booking) => {
    if (booking.event_id !== event.event_id || !ACTIVE_BOOKING_STATUSES.has(asUpper(booking.status))) return booking;
    const status = asUpper(booking.status) === BOOKING_STATUS.APPROVED
      ? BOOKING_STATUS.RELEASED : BOOKING_STATUS.WITHDRAWN;
    history.push({
      event_id: event.event_id,
      booking_id: booking.booking_id,
      old_value: booking.status,
      new_value: status,
      release_reason: reason,
      created_at: now
    });
    return { ...booking, status, released_at: now, release_reason: reason };
  });
  return { ok: true, bookings: released, history };
}

function venueWindowAvailable({ venueId, start, end, bookings }) {
  const requested = { start: instant(start), end: instant(end) };
  return !bookings.some((booking) => booking.venue_id === venueId
    && asUpper(booking.status) === BOOKING_STATUS.APPROVED
    && windowsOverlap(requested, {
      start: instant(booking.occupied_start || booking.start_datetime),
      end: instant(booking.occupied_end || booking.end_datetime)
    }));
}

function venueWithPlanningDefaults(input = {}) {
  return {
    setup_minutes: 0,
    turnaround_minutes: 0,
    emergency_access_notes: "",
    known_restrictions: "",
    ...input
  };
}

function saveVenuePlanning({ venue: current, role, staffId, assignedVenueIds = [], changes, now = SERVER_TIMESTAMP }) {
  if (role !== ROLES.VENUE_STAFF || !new Set(assignedVenueIds).has(current.venue_id)) {
    return { ok: false, reason: "not_allowed", venue: current, history: [] };
  }
  for (const field of ["setup_minutes", "turnaround_minutes"]) {
    if (!(field in changes)) continue;
    const value = Number(changes[field]);
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, reason: field, message: "Value must be a whole number of minutes at least zero.", venue: current, history: [] };
    }
  }
  const normalized = { ...changes };
  if ("setup_minutes" in normalized) normalized.setup_minutes = Number(normalized.setup_minutes);
  if ("turnaround_minutes" in normalized) normalized.turnaround_minutes = Number(normalized.turnaround_minutes);
  if ("emergency_access_notes" in normalized) normalized.emergency_access_notes = String(normalized.emergency_access_notes || "").trim();
  if ("known_restrictions" in normalized) normalized.known_restrictions = String(normalized.known_restrictions || "").trim();
  const history = Object.entries(normalized)
    .filter(([field, value]) => current[field] !== value)
    .map(([field, value]) => ({
      venue_id: current.venue_id,
      actor_id: staffId,
      field_name: field,
      old_value: current[field],
      new_value: value,
      created_at: now
    }));
  return { ok: true, venue: { ...current, ...normalized }, history };
}

function canViewVenueSafety(role) {
  return [ROLES.VENUE_STAFF, ROLES.COORDINATOR, ROLES.SAFETY_OFFICER].includes(role);
}

const UNAVAILABILITY_REASONS = ["Maintenance", "Equipment failure", "Renovation", "Safety concern", "Other"];
const REPLACEMENT_NEEDED = "Venue unavailable - replacement needed";

function activeVenueStaff(staff = []) {
  return staff
    .filter((person) => person.active !== false && person.role === ROLES.VENUE_STAFF)
    .sort((left, right) => String(left.staff_id).localeCompare(String(right.staff_id)));
}

function nextVenueStaff(staff, priorAssignments = []) {
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
  return bookings.filter((booking) => !booking.assigned_staff_id && asUpper(booking.status) === BOOKING_STATUS.PENDING);
}

function sameCalendarDate(left, right) {
  return String(left || "").slice(0, 10) === String(right || "").slice(0, 10);
}

function approvedConflicts(booking, bookings, venueRecord) {
  const requested = occupiedBookingWindow(booking, venueRecord);
  return bookings.filter((other) => other.booking_id !== booking.booking_id
    && other.venue_id === booking.venue_id
    && asUpper(other.status) === BOOKING_STATUS.APPROVED
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
    && asUpper(booking.status) === BOOKING_STATUS.APPROVED
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


// =============================================================================
// A1 / SCRUM-82 — Self-register as an Event Organiser
// =============================================================================

describe("A1 / SCRUM-82 Self-register as an Event Organiser", () => {
  test("TC-001 AC1 positive — all required organiser details are stored", () => {
    const result = createUserRecord("user-organiser-1", registrationInput(PORTALS.CORPORATE));

    assert.equal(result.ok, true);
    assert.deepEqual(result.user, {
      user_id: "user-organiser-1",
      name: "Alice Tan",
      email: "alice+eo@test.com",
      role: ROLES.ORGANISER,
      organisation_name: "ABC Events",
      mobile_number: "12345678",
      preferred_contact_method: "EMAIL",
      is_active: true,
      created_at: SERVER_TIMESTAMP,
      updated_at: SERVER_TIMESTAMP
    });
  });

  test("TC-002 AC2 security — a self-registered corporate account receives only the organiser role", () => {
    const result = createUserRecord("user-organiser-1", registrationInput(PORTALS.CORPORATE));

    assert.equal(result.user.role, ROLES.ORGANISER);
    assert.equal(canAccessRole(result.user.role, ROLES.ORGANISER), true);
    assert.equal(canAccessRole(result.user.role, ROLES.ATTENDEE), false);
    assert.equal(canAccessRole(result.user.role, ROLES.COORDINATOR), false);
    assert.equal(canAccessRole(result.user.role, ROLES.VENUE_STAFF), false);
    assert.equal(canAccessRole(result.user.role, ROLES.TECH_SUPPORT), false);
  });

  test("TC-003 AC3 negative — duplicate-email registration returns a non-disclosing error", () => {
    const message = registrationError("auth/email-already-in-use");

    assert.equal(message, GENERIC_REGISTRATION_ERROR);
    assert.equal(/already|exists|organiser|attendee|role/i.test(message), false);
  });

  test("TC-004 AC4 positive — successful organiser registration starts a session without approval", () => {
    const result = createUserRecord(
      "user-organiser-2",
      registrationInput(PORTALS.CORPORATE, { email: "alice+eo2@test.com" })
    );

    assert.equal(result.ok, true);
    assert.equal(result.signedIn, true);
    assert.equal(result.approvalRequired, false);
    assert.equal(result.user.is_active, true);
  });

  test("A1 required-fields negative — missing organiser fields block submission", () => {
    const fields = ["name", "organisationName", "mobileNumber", "email", "password", "confirmPassword"];

    for (const field of fields) {
      const result = validateRegistration(registrationInput(PORTALS.CORPORATE, { [field]: "" }));
      assert.equal(result.ok, false, `${field} should be required`);
      assert.equal(result.reason, "required");
    }
  });

  test("A1 password boundaries — 11 is rejected while 12 and 13 characters are accepted", () => {
    assert.equal(isStrongPassword("PassWord1!a"), false);
    assert.equal(isStrongPassword("PassWord1!ab"), true);
    assert.equal(isStrongPassword("PassWord1!abc"), true);
  });

  test("A1 mobile boundaries — only 7 through 15 digits are accepted", () => {
    assert.equal(isValidMobileNumber("123456"), false);
    assert.equal(isValidMobileNumber("1234567"), true);
    assert.equal(isValidMobileNumber("912345678901234"), true);
    assert.equal(isValidMobileNumber("9123456789012345"), false);
  });

  test("A1 password composition — a number and special character are both required", () => {
    assert.equal(isStrongPassword("Password!abcde"), false);
    assert.equal(isStrongPassword("Password1234"), false);
  });

  test("A1 confirmation boundary — matching passwords pass and mismatched passwords fail", () => {
    const matching = validateRegistration(registrationInput(PORTALS.CORPORATE, {
      password: "Password123!",
      confirmPassword: "Password123!"
    }));
    const different = validateRegistration(registrationInput(PORTALS.CORPORATE, {
      password: "Password123!",
      confirmPassword: "Password123?"
    }));

    assert.equal(matching.ok, true);
    assert.equal(different.ok, false);
    assert.equal(different.reason, "confirm_password");
  });
});


// =============================================================================
// A2 / SCRUM-83 — Register an Attendee account
// =============================================================================

describe("A2 / SCRUM-83 Register an Attendee account", () => {
  test("TC-005 AC1-AC5 positive — valid attendee details create an attendee profile", () => {
    const result = createUserRecord("user-attendee-1", registrationInput(PORTALS.INDIVIDUAL));

    assert.equal(result.ok, true);
    assert.deepEqual(result.user, {
      user_id: "user-attendee-1",
      name: "Ben Lee",
      email: "ben@test.com",
      role: ROLES.ATTENDEE,
      organisation_name: null,
      mobile_number: "91234567",
      preferred_contact_method: "EMAIL",
      is_active: true,
      created_at: SERVER_TIMESTAMP,
      updated_at: SERVER_TIMESTAMP
    });
  });

  test("TC-006 AC6 negative — missing or invalid attendee fields block submission", () => {
    const missingMobile = validateRegistration(registrationInput(PORTALS.INDIVIDUAL, { mobileNumber: "" }));
    const invalidEmail = validateRegistration(registrationInput(PORTALS.INDIVIDUAL, { email: "not-an-email" }));

    assert.equal(missingMobile.ok, false);
    assert.equal(missingMobile.reason, "required");
    assert.equal(invalidEmail.ok, false);
    assert.equal(invalidEmail.reason, "email");
  });

  test("TC-007 AC7 negative — duplicate attendee email uses the same non-disclosing error", () => {
    const message = registrationError("auth/email-already-in-use");

    assert.equal(message, GENERIC_REGISTRATION_ERROR);
    assert.equal(/already|exists|organiser|attendee|role/i.test(message), false);
  });

  test("TC-008 AC8 negative — an invalid attendee password blocks account creation", () => {
    const result = createUserRecord(
      "user-attendee-2",
      registrationInput(PORTALS.INDIVIDUAL, { password: "weak", confirmPassword: "weak" })
    );

    assert.equal(result.ok, false);
    assert.equal(result.validation.reason, "password");
  });

  test("A2 password boundaries — 11 is rejected while 12 and 13 characters are accepted", () => {
    assert.equal(isStrongPassword("PassWord1!a"), false);
    assert.equal(isStrongPassword("PassWord1!ab"), true);
    assert.equal(isStrongPassword("PassWord1!abc"), true);
  });

  test("A2 mobile boundaries — only 7 through 15 digits are accepted", () => {
    assert.equal(isValidMobileNumber("123456"), false);
    assert.equal(isValidMobileNumber("1234567"), true);
    assert.equal(isValidMobileNumber("912345678901234"), true);
    assert.equal(isValidMobileNumber("9123456789012345"), false);
  });

  test("A2 password composition and confirmation rules are enforced", () => {
    assert.equal(isStrongPassword("Password!abcde"), false);
    assert.equal(isStrongPassword("Password1234"), false);

    const matching = validateRegistration(registrationInput(PORTALS.INDIVIDUAL, {
      password: "Password123!",
      confirmPassword: "Password123!"
    }));
    const different = validateRegistration(registrationInput(PORTALS.INDIVIDUAL, {
      password: "Password123!",
      confirmPassword: "Password123?"
    }));
    assert.equal(matching.ok, true);
    assert.equal(different.reason, "confirm_password");
  });
});


// =============================================================================
// A3 / SCRUM-84 — Sign in and sign out
// =============================================================================

describe("A3 / SCRUM-84 Sign in and sign out", () => {
  const organiser = {
    email: "imevent@gmail.com",
    password: "qwerty12345!",
    role: ROLES.ORGANISER
  };
  const attendee = {
    email: "imattendee@gmail.com",
    password: "qwerty12345!",
    role: ROLES.ATTENDEE
  };

  test("TC-009 AC1 positive — valid credentials start an authenticated session", () => {
    const result = signInAccount(organiser, {
      email: organiser.email,
      password: organiser.password,
      portal: PORTALS.CORPORATE
    });

    assert.equal(result.ok, true);
    assert.equal(result.signedIn, true);
  });

  test("TC-010 AC2 negative — invalid credentials return a generic error", () => {
    const wrongPassword = signInAccount(organiser, {
      email: organiser.email,
      password: "qwerty123456!",
      portal: PORTALS.CORPORATE
    });
    const unknownAccount = signInAccount(null, {
      email: "unknown@test.com",
      password: "qwerty123456!",
      portal: PORTALS.CORPORATE
    });

    assert.equal(wrongPassword.error, GENERIC_LOGIN_ERROR);
    assert.equal(unknownAccount.error, GENERIC_LOGIN_ERROR);
    assert.equal(wrongPassword.signedIn, false);
    assert.equal(unknownAccount.signedIn, false);
  });

  test("TC-011 AC3 security — signing out prevents browser Back from restoring protected content", () => {
    const signedOut = signOutSession({ signedIn: true, destination: "#/event_organiser/my-events" });
    const afterBack = protectedRoute(signedOut, "#/event_organiser/my-events");

    assert.equal(signedOut.signedIn, false);
    assert.equal(afterBack.protectedContent, false);
    assert.equal(afterBack.destination, "#/sign-in");
  });

  test("TC-012 AC4 security — an unauthenticated protected request goes to sign-in", () => {
    const result = protectedRoute(
      { signedIn: false },
      "#/event_organiser/my-events"
    );

    assert.equal(result.protectedContent, false);
    assert.equal(result.destination, "#/sign-in");
    assert.equal(result.requestedPath, "#/event_organiser/my-events");
  });

  test("TC-013 AC5 positive — successful sign-in returns to the requested protected page", () => {
    const requestedPath = "#/event_organiser/notifications";
    const result = signInAccount(organiser, {
      email: organiser.email,
      password: organiser.password,
      portal: PORTALS.CORPORATE,
      requestedPath
    });

    assert.equal(result.ok, true);
    assert.equal(result.destination, requestedPath);
  });

  test("A3 wrong-portal negative — an organiser cannot use the attendee portal", () => {
    const result = signInAccount(organiser, {
      email: organiser.email,
      password: organiser.password,
      portal: PORTALS.INDIVIDUAL
    });

    assert.equal(result.ok, false);
    assert.equal(result.signedIn, false);
    assert.equal(result.error, WRONG_PORTAL_ERROR);
  });

  test("A3 wrong-portal negative — an attendee cannot use the corporate portal", () => {
    const result = signInAccount(attendee, {
      email: attendee.email,
      password: attendee.password,
      portal: PORTALS.CORPORATE
    });

    assert.equal(result.ok, false);
    assert.equal(result.signedIn, false);
    assert.equal(result.error, WRONG_PORTAL_ERROR);
  });
});


// =============================================================================
// B2 / SCRUM-93 — State the venue requirements for my event
// =============================================================================

describe("B2 / SCRUM-93 State the venue requirements for my event", () => {
  test("TC-022 AC1 positive — location, layout and one facility are stored exactly as selected", () => {
    const writes = buildRequirementWrites({
      eventId: "EVT-1",
      preferredLocation: "CENTRAL",
      requiredLayout: "THEATRE",
      facilitiesRequired: true,
      facilities: ["AIR_CONDITIONING"]
    });

    assert.deepEqual(writes.event_venue_requirements, {
      event_id: "EVT-1",
      preferred_location: "CENTRAL",
      required_layout: "THEATRE",
      facilities_required: true,
      accessibility_needed: false,
      accessibility_notes: ""
    });
    assert.deepEqual(writes.event_facilities, [
      { event_id: "EVT-1", facility_id: "AIR_CONDITIONING" }
    ]);
  });

  test("TC-023 AC1 positive — multiple facility selections are all retained", () => {
    const selected = [
      "AIR_CONDITIONING",
      "TABLES_AND_CHAIRS",
      "TOILETS",
      "WIFI",
      "POWER_POINTS"
    ];
    const writes = buildRequirementWrites({
      eventId: "EVT-2",
      preferredLocation: "CENTRAL",
      requiredLayout: "THEATRE",
      facilitiesRequired: true,
      facilities: selected
    });

    assert.deepEqual(
      writes.event_facilities.map((row) => row.facility_id),
      selected
    );
    assert.equal(writes.event_facilities.every((row) => row.event_id === "EVT-2"), true);
  });

  test("TC-024 AC3 positive — an incomplete venue draft saves and completed values carry into submission", () => {
    const draft = buildRequirementWrites({
      eventId: "EVT-3",
      preferredLocation: "",
      requiredLayout: "",
      facilitiesRequired: true,
      facilities: []
    });

    assert.equal(draft.event_venue_requirements.preferred_location, "");
    assert.equal(draft.event_venue_requirements.required_layout, "");
    assert.equal(draft.event_venue_requirements.facilities_required, true);
    assert.deepEqual(draft.event_facilities, []);

    const submitted = buildRequirementWrites({
      eventId: "EVT-3",
      preferredLocation: "CENTRAL",
      requiredLayout: "THEATRE",
      facilitiesRequired: true,
      facilities: ["AIR_CONDITIONING"]
    });

    assert.equal(submitted.event_venue_requirements.event_id, draft.event_venue_requirements.event_id);
    assert.equal(submitted.event_venue_requirements.preferred_location, "CENTRAL");
    assert.equal(submitted.event_venue_requirements.required_layout, "THEATRE");
    assert.deepEqual(submitted.event_facilities, [
      { event_id: "EVT-3", facility_id: "AIR_CONDITIONING" }
    ]);
  });
});


// =============================================================================
// B3 / SCRUM-94 — State the accessibility needs of my event
// =============================================================================

describe("B3 / SCRUM-94 State the accessibility needs of my event", () => {
  test("TC-025 AC1 positive — one accessibility requirement and its free-text note are stored", () => {
    const writes = buildRequirementWrites({
      eventId: "EVT-4",
      accessibilityRequired: true,
      accessibility: ["WHEELCHAIR_ACCESS"],
      accessibilityNotes: "Accessible seating needed"
    });

    assert.equal(writes.event_venue_requirements.accessibility_needed, true);
    assert.equal(writes.event_venue_requirements.accessibility_notes, "Accessible seating needed");
    assert.deepEqual(writes.event_accessibility, [
      { event_id: "EVT-4", accessibility_id: "WHEELCHAIR_ACCESS" }
    ]);
  });

  test("TC-026 AC2 positive — multiple accessibility requirements are accepted and retained", () => {
    const selected = ["WHEELCHAIR_ACCESS", "HEARING_LOOP"];
    const writes = buildRequirementWrites({
      eventId: "EVT-5",
      accessibilityRequired: true,
      accessibility: selected
    });

    assert.deepEqual(
      writes.event_accessibility.map((row) => row.accessibility_id),
      selected
    );
    assert.equal(writes.event_accessibility.every((row) => row.event_id === "EVT-5"), true);
  });
});


// =============================================================================
// C4 — Request clarification or amendments from the organiser
// =============================================================================

describe("C4 Request clarification or amendments from the organiser", () => {
  const reviewEvent = (changes = {}) => ({
    event_id: "EVT-001",
    organiser_id: "ORG-001",
    coordinator_id: "USR-COORD-001",
    status: STATUS.UNDER_REVIEW,
    open_clarification_id: null,
    ...changes
  });

  test("C4 AC1 positive — a non-empty clarification message creates the request", () => {
    const result = requestClarification({
      event: reviewEvent(),
      userId: "USR-COORD-001",
      message: " Please confirm expected attendance. ",
      clarificationId: "CLR-001",
      now: "2026-09-30T10:00:00Z"
    });

    assert.equal(result.ok, true);
    assert.equal(result.event.open_clarification_id, "CLR-001");
    assert.deepEqual(result.clarification, {
      clarification_id: "CLR-001",
      event_id: "EVT-001",
      created_by: "USR-COORD-001",
      message: "Please confirm expected attendance.",
      status: "OPEN",
      created_at: "2026-09-30T10:00:00Z",
      responded_at: null
    });
  });

  test("C4 AC1 negative — an empty clarification message is refused", () => {
    const result = requestClarification({
      event: reviewEvent(),
      userId: "USR-COORD-001",
      message: "   ",
      clarificationId: "CLR-001"
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "empty");
    assert.equal(result.event.open_clarification_id, null);
  });

  test("C4 AC2 negative — approve and reject remain unavailable while clarification is open", () => {
    const awaitingOrganiser = reviewEvent({ open_clarification_id: "CLR-001" });

    assert.equal(awaitingOrganiser.status, STATUS.UNDER_REVIEW);
    assert.equal(canApproveEvent(awaitingOrganiser, "USR-COORD-001"), false);
    assert.equal(canRejectEvent(awaitingOrganiser, "USR-COORD-001"), false);
  });

  test("C4 AC3-AC4 negative — only one request is open and the answered exchange remains in history", () => {
    const first = requestClarification({
      event: reviewEvent(),
      userId: "USR-COORD-001",
      message: "Please confirm expected attendance.",
      clarificationId: "CLR-001",
      now: "2026-09-30T10:00:00Z"
    });
    const duplicate = requestClarification({
      event: first.event,
      userId: "USR-COORD-001",
      message: "A second open request",
      clarificationId: "CLR-002"
    });
    const answered = submitClarificationResponse({
      event: first.event,
      clarification: first.clarification,
      userId: "ORG-001",
      message: "Attendance is 150.",
      now: "2026-09-30T11:00:00Z"
    });
    const nextRound = requestClarification({
      event: answered.event,
      userId: "USR-COORD-001",
      message: "Please also confirm the layout.",
      clarificationId: "CLR-002",
      now: "2026-09-30T12:00:00Z"
    });
    const retained = chronologicalExchange([first.clarification], answered.responses);

    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.reason, "not_allowed");
    assert.equal(answered.clarification.status, "ANSWERED");
    assert.equal(nextRound.ok, true);
    assert.equal(retained[0].message, "Please confirm expected attendance.");
    assert.equal(retained[0].created_at, "2026-09-30T10:00:00Z");
    assert.equal(retained[1].message, "Attendance is 150.");
  });
});


// =============================================================================
// C7 — Reject a request with a reason
// =============================================================================

describe("C7 Reject a request with a reason", () => {
  const reviewEvent = (changes = {}) => ({
    event_id: "EVT-001",
    organiser_id: "ORG-001",
    coordinator_id: "USR-COORD-001",
    status: STATUS.UNDER_REVIEW,
    open_clarification_id: null,
    ...changes
  });

  test("C7 AC1 negative — rejection without a reason is blocked", () => {
    const result = rejectEvent({
      event: reviewEvent(),
      userId: "USR-COORD-001",
      reason: ""
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "empty");
    assert.equal(result.event.status, STATUS.UNDER_REVIEW);
  });

  test("C7 AC2 positive — rejection records status, reason, coordinator and timestamp", () => {
    const result = rejectEvent({
      event: reviewEvent(),
      userId: "USR-COORD-001",
      reason: "No suitable venue can be secured.",
      now: "2026-09-30T13:00:00Z"
    });

    assert.equal(result.ok, true);
    assert.equal(result.event.status, STATUS.REJECTED);
    assert.equal(result.history.description, "No suitable venue can be secured.");
    assert.equal(result.history.actor_id, "USR-COORD-001");
    assert.equal(result.history.created_at, "2026-09-30T13:00:00Z");
    assert.equal(result.history.action_type, "EVENT_REJECTED");
  });

  test("C7 AC3 negative — a rejected event cannot be edited, resubmitted or rejected again", () => {
    const rejected = reviewEvent({ status: STATUS.REJECTED });

    assert.equal(canEditOrResubmit(rejected), false);
    assert.equal(canRejectEvent(rejected, "USR-COORD-001"), false);
  });

  test("C7 AC4 business rule — an unfulfillable event is rejected instead of remaining under review", () => {
    const noSuitableVenue = true;
    const result = noSuitableVenue
      ? rejectEvent({
          event: reviewEvent(),
          userId: "USR-COORD-001",
          reason: "No suitable venue can be secured."
        })
      : { event: reviewEvent() };

    assert.equal(result.ok, true);
    assert.equal(result.event.status, STATUS.REJECTED);
    assert.notEqual(result.event.status, STATUS.UNDER_REVIEW);
  });
});


// =============================================================================
// C8 — Understand the decision on my request
// =============================================================================

describe("C8 Understand the decision on my request", () => {
  test("C8 AC1-AC2 positive — organiser sees decision metadata and assigned coordinator", () => {
    const event = { event_id: "EVT-001", status: STATUS.APPROVED, coordinator_id: "USR-COORD-001" };
    const history = [
      {
        event_id: "EVT-001",
        actor_id: "USR-COORD-001",
        action_type: "EVENT_APPROVED",
        new_value: STATUS.APPROVED,
        description: "All requirements can be fulfilled.",
        created_at: "2026-09-30T14:00:00Z"
      }
    ];
    const summary = decisionDetails(event, history, { id: "USR-COORD-001", name: "Sam" });

    assert.deepEqual(summary, {
      decision: STATUS.APPROVED,
      reason: "All requirements can be fulfilled.",
      decided_at: "2026-09-30T14:00:00Z",
      decided_by: "USR-COORD-001",
      coordinator_name: "Sam"
    });
  });

  test("C8 AC1-AC2 positive — a rejection reason is shown from the latest decision record", () => {
    const event = { event_id: "EVT-002", status: STATUS.REJECTED, coordinator_id: "USR-COORD-001" };
    const summary = decisionDetails(event, [{
      actor_id: "USR-COORD-001",
      action_type: "EVENT_REJECTED",
      new_value: STATUS.REJECTED,
      description: "No suitable venue can be secured.",
      created_at: "2026-09-30T15:00:00Z"
    }], { name: "Sam" });

    assert.equal(summary.decision, STATUS.REJECTED);
    assert.equal(summary.reason, "No suitable venue can be secured.");
    assert.equal(summary.decided_at, "2026-09-30T15:00:00Z");
    assert.equal(summary.coordinator_name, "Sam");
  });
});


// =============================================================================
// C9 — Reassign an event to a different coordinator
// =============================================================================

describe("C9 Reassign an event to a different coordinator", () => {
  const event = {
    event_id: "EVT-001",
    organiser_id: "ORG-001",
    coordinator_id: "USR-COORD-001",
    status: STATUS.UNDER_REVIEW,
    assigned_at: "2026-09-29T09:00:00Z"
  };
  const assignments = [{
    assignment_id: "EVT-001_USR-COORD-001",
    event_id: "EVT-001",
    coordinator_id: "USR-COORD-001",
    assigned_at: "2026-09-29T09:00:00Z",
    ended_at: null
  }];
  const target = { id: "USR-COORD-002", name: "Alex", active: true };

  test("C9 AC1-AC2 positive — reassignment leaves one current coordinator and retains prior timestamps", () => {
    const result = reassignEvent({
      event,
      assignments,
      userId: "USR-COORD-001",
      targetCoordinator: target,
      now: "2026-09-30T16:00:00Z"
    });
    const current = result.assignments.filter((item) => item.ended_at == null);
    const prior = result.assignments.find((item) => item.coordinator_id === "USR-COORD-001");

    assert.equal(result.ok, true);
    assert.equal(result.event.coordinator_id, "USR-COORD-002");
    assert.equal(current.length, 1);
    assert.equal(current[0].coordinator_id, "USR-COORD-002");
    assert.equal(prior.assigned_at, "2026-09-29T09:00:00Z");
    assert.equal(prior.ended_at, "2026-09-30T16:00:00Z");
    assert.equal(result.history.old_value, "USR-COORD-001");
    assert.equal(result.history.new_value, "USR-COORD-002");
  });

  test("C9 AC3 security — outgoing coordinator retains view access but loses edit access", () => {
    const result = reassignEvent({
      event,
      assignments,
      userId: "USR-COORD-001",
      targetCoordinator: target
    });
    const access = assignmentAccess(result.event, result.assignments, "USR-COORD-001");

    assert.equal(access.canView, true);
    assert.equal(access.canEdit, false);
  });

  test("C9 AC5 security — a non-current coordinator cannot reassign the event", () => {
    const result = reassignEvent({
      event,
      assignments,
      userId: "USR-COORD-003",
      targetCoordinator: target
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_allowed");
    assert.equal(result.event.coordinator_id, "USR-COORD-001");
  });
});


// =============================================================================
// C5 / SCRUM-106 — Respond to a request for clarification
// =============================================================================

describe("C5 / SCRUM-106 Respond to a request for clarification", () => {
  test("TC-081 AC1 happy path — organiser amends a field and answers while the clarification is open", () => {
    const event = openEvent();
    const clarification = openClarification();

    const result = submitClarificationResponse({
      event,
      clarification,
      userId: "u1",
      message: "Confirmed, 150 people.",
      fieldEdits: { expected_attendance: 150 }
    });

    assert.equal(result.ok, true);
    assert.equal(result.event.expected_attendance, 150);
    assert.equal(result.responses.length, 1);
    assert.equal(result.responses[0].clarification_id, "CLR-001");
    assert.equal(result.responses[0].message, "Confirmed, 150 people.");
  });

  test("TC-082 AC1 negative — an empty response cannot be submitted", () => {
    const event = openEvent();
    const clarification = openClarification();

    const result = submitClarificationResponse({
      event,
      clarification,
      userId: "u1",
      message: "   "
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "empty");
    assert.equal(result.clarification.status, "OPEN");
    assert.equal(result.responses.length, 0);
    assert.equal(result.event.open_clarification_id, "CLR-001");
  });

  test("TC-083 AC2 happy path — submitting the response closes the clarification and records it", () => {
    const result = submitClarificationResponse({
      event: openEvent(),
      clarification: openClarification(),
      userId: "u1",
      message: "Confirmed, 150 people."
    });

    assert.equal(result.ok, true);
    assert.equal(result.clarification.status, "ANSWERED");
    assert.equal(result.event.open_clarification_id, null);
    assert.equal(result.responses[0].responder_id, "u1");
    assert.equal(result.responses[0].created_at, SERVER_TIMESTAMP);
    assert.equal(result.clarification.responded_at, SERVER_TIMESTAMP);
  });

  test("TC-084 AC2 domain — the event stays Under Review across the whole exchange", () => {
    const event = openEvent();
    const clarification = openClarification();

    assert.equal(event.status, STATUS.UNDER_REVIEW);

    const result = submitClarificationResponse({
      event,
      clarification,
      userId: "u1",
      message: "Confirmed."
    });

    assert.equal(result.event.status, STATUS.UNDER_REVIEW);
  });

  test("TC-085 AC2 negative — there is nothing to respond to", () => {
    const closed = openClarification({ status: "ANSWERED" });
    const event = openEvent({ open_clarification_id: null });

    assert.equal(canRespondToClarification(event, closed, "u1"), false);

    const result = submitClarificationResponse({
      event,
      clarification: closed,
      userId: "u1",
      message: "Second answer"
    });

    assert.equal(result.ok, false);
    assert.equal(result.responses.length, 0);
    assert.equal(result.clarification.status, "ANSWERED");
  });

  test("TC-086 AC1 security — only the organiser the question was asked of may answer it", () => {
    const result = submitClarificationResponse({
      event: openEvent({ organiser_id: "u1" }),
      clarification: openClarification(),
      userId: "u2",
      message: "I am not the organiser."
    });

    assert.equal(result.ok, false);
    assert.equal(result.responses.length, 0);
    assert.equal(result.clarification.status, "OPEN");
  });

  test("TC-087 AC3 happy path — both parties see the exchange oldest first", () => {
    const questions = [openClarification({ created_at: "2026-09-23T10:00:00" })];
    const responses = [
      {
        clarification_id: "CLR-001",
        responder_id: "u1",
        message: "Confirmed, 150 people.",
        created_at: "2026-09-23T11:00:00"
      }
    ];

    const coordinatorView = chronologicalExchange(questions, responses);
    const organiserView = chronologicalExchange(questions, responses);

    assert.deepEqual(
      coordinatorView.map((item) => item.kind),
      ["question", "response"]
    );
    assert.deepEqual(
      organiserView.map((item) => item.kind),
      ["question", "response"]
    );
    assert.equal(coordinatorView[0].created_by, "coord-1");
    assert.equal(organiserView[1].responder_id, "u1");
  });

  test("TC-088 AC3 happy path — history survives, and a second round appends to it", () => {
    const first = submitClarificationResponse({
      event: openEvent(),
      clarification: openClarification({ created_at: "2026-09-23T10:00:00" }),
      userId: "u1",
      message: "First answer",
      now: "2026-09-23T11:00:00"
    });

    const secondQuestion = openClarification({
      clarification_id: "CLR-002",
      message: "Also confirm the layout",
      created_at: "2026-09-23T12:00:00"
    });
    const eventRoundTwo = {
      ...first.event,
      open_clarification_id: "CLR-002"
    };

    const second = submitClarificationResponse({
      event: eventRoundTwo,
      clarification: secondQuestion,
      responses: first.responses,
      userId: "u1",
      message: "Second answer",
      now: "2026-09-23T13:00:00"
    });

    const thread = chronologicalExchange(
      [openClarification({ created_at: "2026-09-23T10:00:00" }), secondQuestion],
      second.responses
    );

    assert.equal(thread.length, 4);
    assert.deepEqual(
      thread.map((item) => item.kind),
      ["question", "response", "question", "response"]
    );
    assert.equal(second.responses[0].message, "First answer");
    assert.equal(second.responses[1].message, "Second answer");
  });
});


// =============================================================================
// E2 / SCRUM-118 — Browse the venue catalogue
// =============================================================================

describe("E2 / SCRUM-118 Browse the venue catalogue", () => {
  const hallA = venue("VEN-001", {
    name: "Hall A",
    location: "CENTRAL",
    max_capacity: 500,
    facilities: ["WIFI", "STAGE"],
    layouts: ["THEATRE", "CLASSROOM"],
    accessibility: ["WHEELCHAIR_ACCESS"],
    operating_hours: [{ weekday: "MONDAY", opens_at: "09:00", closes_at: "18:00" }]
  });
  const studioB = venue("VEN-002", {
    name: "Studio B",
    location: "EAST",
    max_capacity: 40,
    facilities: ["WIFI"]
  });
  const atrium = venue("VEN-003", {
    name: "Atrium",
    location: "WEST",
    max_capacity: 120,
    facilities: ["AIR_CONDITIONING"]
  });
  const emptyFacilities = venue("VEN-004", {
    name: "Annex",
    location: "NORTH",
    max_capacity: 20,
    facilities: []
  });

  test("TC-089 AC1 happy path — every venue is listed with its four summary fields", () => {
    const rows = listCatalogue([hallA, studioB, atrium]);

    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((row) => row.venue_id),
      ["VEN-001", "VEN-002", "VEN-003"]
    );
    for (const row of rows) {
      assert.ok(row.name);
      assert.ok(row.location);
      assert.equal(typeof row.max_capacity, "number");
      assert.ok(Array.isArray(row.headline_facilities));
    }
  });

  test("TC-090 AC1 edge — a venue with no facilities recorded still lists cleanly", () => {
    const [row] = listCatalogue([emptyFacilities]);

    assert.equal(row.venue_id, "VEN-004");
    assert.equal(row.name, "Annex");
    assert.equal(row.location, "NORTH");
    assert.equal(row.max_capacity, 20);
    assert.deepEqual(row.headline_facilities, []);
    assert.equal(facilitiesLabel(row.headline_facilities), "None listed");
  });

  test("TC-091 AC2 happy path — a venue's full record opens", () => {
    const record = venueRecord(hallA);

    assert.equal(record.name, "Hall A");
    assert.deepEqual(record.layouts, ["THEATRE", "CLASSROOM"]);
    assert.deepEqual(record.accessibility, ["WHEELCHAIR_ACCESS"]);
    assert.deepEqual(record.operating_hours, [
      { weekday: "MONDAY", opens_at: "09:00", closes_at: "18:00" }
    ]);
  });

  test("TC-092 AC3 happy path — both permitted roles can reach the catalogue", () => {
    assert.equal(canViewCatalogue(ROLES.COORDINATOR), true);
    assert.equal(canViewCatalogue(ROLES.VENUE_STAFF), true);
  });

  test("TC-093 AC3 security — the other three roles cannot reach it, even by URL", () => {
    assert.equal(canViewCatalogue(ROLES.ORGANISER), false);
    assert.equal(canViewCatalogue(ROLES.ATTENDEE), false);
    assert.equal(canViewCatalogue(ROLES.TECH_SUPPORT), false);
  });

  test("TC-094 AC3 security — catalogue reads are refused unless the role is permitted", () => {
    const allowed = [ROLES.COORDINATOR, ROLES.VENUE_STAFF];
    const refused = [ROLES.ORGANISER, ROLES.ATTENDEE, ROLES.TECH_SUPPORT];

    for (const role of allowed) assert.equal(canViewCatalogue(role), true);
    for (const role of refused) assert.equal(canViewCatalogue(role), false);
  });
});


// =============================================================================
// E5 / SCRUM-121 — Find venues that fit my event
// =============================================================================

describe("E5 / SCRUM-121 Find venues that fit my event", () => {
  const window = {
    event_date: daysFromToday(30),
    start_time: "09:00",
    end_time: "17:00",
    expected_attendance: 180
  };

  test("TC-095 AC1 happy path — search opened from an event arrives pre-filled", () => {
    const event = {
      event_id: "EVT-1",
      status: "APPROVED",
      event_date: daysFromToday(30),
      start_time: "09:00",
      end_time: "17:00",
      expected_attendance: 180
    };

    assert.deepEqual(prefillSearch(event), {
      event_date: event.event_date,
      start_time: "09:00",
      end_time: "17:00",
      expected_attendance: 180
    });
  });

  test("TC-096 AC2 negative — a venue occupied for part of the window is excluded", () => {
    const venues = [venue("VEN-001", { name: "Hall A", max_capacity: 500 })];
    const bookings = [
      { venue_id: "VEN-001", start_time: "10:00", end_time: "12:00", status: "Approved" }
    ];

    const result = searchVenues({ venues, window, bookings });
    assert.deepEqual(
      result.matches.map((v) => v.venue_id),
      []
    );
  });

  test("TC-097 AC2 boundary — a booking that ends exactly when the window starts does not exclude", () => {
    // OPEN QUESTION: setup / turnaround time. If Session 3 adds it, this case changes.
    const venues = [venue("VEN-001", { name: "Hall A", max_capacity: 500 })];
    const bookings = [
      { venue_id: "VEN-001", start_time: "07:00", end_time: "09:00", status: "Approved" }
    ];

    const result = searchVenues({ venues, window, bookings });
    assert.deepEqual(
      result.matches.map((v) => v.venue_id),
      ["VEN-001"]
    );
  });

  test("TC-098 AC2 negative — a venue blocked for maintenance is excluded", () => {
    const venues = [venue("VEN-002", { name: "Studio B", max_capacity: 200 })];
    const unavailability = [
      { venue_id: "VEN-002", start_time: "08:00", end_time: "18:00", reason: "Maintenance" }
    ];

    const result = searchVenues({ venues, window, unavailability });
    assert.deepEqual(
      result.matches.map((v) => v.venue_id),
      []
    );
  });

  test("TC-099 AC3 boundary — capacity exactly equal to expected attendance is a fit", () => {
    const venues = [venue("VEN-003", { name: "Atrium", max_capacity: 180 })];
    const result = searchVenues({ venues, window });
    assert.deepEqual(
      result.matches.map((v) => v.venue_id),
      ["VEN-003"]
    );
  });

  test("TC-100 AC3 boundary — one seat short is excluded", () => {
    const venues = [venue("VEN-004", { name: "Annex", max_capacity: 179 })];
    const result = searchVenues({ venues, window });
    assert.deepEqual(
      result.matches.map((v) => v.venue_id),
      []
    );
  });

  test("TC-101 AC2+AC3 happy path — the shortlist is exactly those venues passing both tests", () => {
    const venues = [
      venue("VEN-OCC", { name: "Occupied", max_capacity: 400 }),
      venue("VEN-SMALL", { name: "Too small", max_capacity: 50 }),
      venue("VEN-BOTH", { name: "Occupied and small", max_capacity: 10 }),
      venue("VEN-OK", { name: "Clear", max_capacity: 200 })
    ];
    const bookings = [
      { venue_id: "VEN-OCC", start_time: "10:00", end_time: "12:00", status: "Approved" },
      { venue_id: "VEN-BOTH", start_time: "09:00", end_time: "17:00", status: "Approved" }
    ];

    const result = searchVenues({ venues, window, bookings });
    assert.deepEqual(
      result.matches.map((v) => v.venue_id),
      ["VEN-OK"]
    );
  });

  test("TC-102 AC4 negative — nothing matches, so the reason is reported", () => {
    const venues = [
      venue("VEN-OCC", { name: "Occupied", max_capacity: 400 }),
      venue("VEN-SMALL", { name: "Too small", max_capacity: 50 }),
      venue("VEN-BOTH", { name: "Occupied and small", max_capacity: 10 })
    ];
    const bookings = [
      { venue_id: "VEN-OCC", start_time: "10:00", end_time: "12:00", status: "Approved" },
      { venue_id: "VEN-BOTH", start_time: "09:00", end_time: "17:00", status: "Approved" }
    ];

    const result = searchVenues({ venues, window, bookings });

    assert.equal(result.count, 0);
    assert.deepEqual(result.matches, []);
    assert.equal(result.excluded.occupied, 2);
    assert.equal(result.excluded.capacity_below, 2);
    // A venue failing two criteria is counted under both, so the counts
    // must not be assumed to sum to the catalogue size.
    assert.notEqual(result.excluded.occupied + result.excluded.capacity_below, venues.length);
  });

  test("TC-103 security — venue search belongs to coordinators", () => {
    assert.equal(canSearchVenues(ROLES.COORDINATOR), true);
    assert.equal(canSearchVenues(ROLES.ORGANISER), false);
    assert.equal(canSearchVenues(ROLES.ATTENDEE), false);
    assert.equal(canSearchVenues(ROLES.VENUE_STAFF), false);
    assert.equal(canSearchVenues(ROLES.TECH_SUPPORT), false);
  });
});


// =============================================================================
// E6 / SCRUM-122 — Narrow the shortlist
// =============================================================================

describe("E6 / SCRUM-122 Narrow the shortlist", () => {
  const catalogue = [
    venue("X", {
      name: "Location only",
      location: "CENTRAL",
      max_capacity: 80,
      facilities: ["WIFI"],
      accessibility: [],
      layouts: ["BOARDROOM"]
    }),
    venue("Y", {
      name: "Layout only",
      location: "EAST",
      max_capacity: 200,
      facilities: ["POWER_POINTS"],
      accessibility: ["WHEELCHAIR_ACCESS"],
      layouts: ["THEATRE"]
    }),
    venue("Z", {
      name: "Both",
      location: "CENTRAL",
      max_capacity: 180,
      facilities: ["WIFI", "POWER_POINTS"],
      accessibility: ["WHEELCHAIR_ACCESS"],
      layouts: ["THEATRE"]
    }),
    venue("P", {
      name: "Wifi only",
      location: "WEST",
      max_capacity: 99,
      facilities: ["WIFI"],
      accessibility: [],
      layouts: ["CLASSROOM"]
    }),
    venue("Q", {
      name: "Power only",
      location: "NORTH",
      max_capacity: 301,
      facilities: ["POWER_POINTS"],
      accessibility: [],
      layouts: ["CLASSROOM"]
    }),
    venue("R", {
      name: "Wifi and power",
      location: "SOUTH",
      max_capacity: 300,
      facilities: ["WIFI", "POWER_POINTS"],
      accessibility: ["LIFT"],
      layouts: ["BANQUET"]
    }),
    venue("S99", { name: "99", location: "EAST", max_capacity: 99, facilities: [], accessibility: [], layouts: [] }),
    venue("S100", { name: "100", location: "EAST", max_capacity: 100, facilities: [], accessibility: [], layouts: [] }),
    venue("S300", { name: "300", location: "EAST", max_capacity: 300, facilities: [], accessibility: [], layouts: [] }),
    venue("S301", { name: "301", location: "EAST", max_capacity: 301, facilities: [], accessibility: [], layouts: [] })
  ];

  test("TC-104 AC1 happy path — each of the five filters works on its own", () => {
    const cases = [
      { filters: { ...emptyFilters(), location: "CENTRAL" }, expectIds: ["X", "Z"] },
      {
        filters: { ...emptyFilters(), min_capacity: 100, max_capacity: 300 },
        expectIds: ["Y", "Z", "R", "S100", "S300"]
      },
      { filters: { ...emptyFilters(), facilities: ["WIFI"] }, expectIds: ["X", "Z", "P", "R"] },
      {
        filters: { ...emptyFilters(), accessibility: ["WHEELCHAIR_ACCESS"] },
        expectIds: ["Y", "Z"]
      },
      { filters: { ...emptyFilters(), layout: "THEATRE" }, expectIds: ["Y", "Z"] }
    ];

    for (const { filters, expectIds } of cases) {
      assert.deepEqual(
        applyFilters(catalogue, filters).map((v) => v.venue_id),
        expectIds
      );
    }
  });

  test("TC-105 AC2 happy path — filters are AND, not OR", () => {
    const filters = { ...emptyFilters(), location: "CENTRAL", layout: "THEATRE" };
    assert.deepEqual(
      applyFilters(catalogue, filters).map((v) => v.venue_id),
      ["Z"]
    );
  });

  test("TC-106 AC1 boundary — a capacity range includes both its ends", () => {
    const ranged = [catalogue.find((v) => v.venue_id === "S99"), catalogue.find((v) => v.venue_id === "S100"), catalogue.find((v) => v.venue_id === "S300"), catalogue.find((v) => v.venue_id === "S301")];
    const filters = { ...emptyFilters(), min_capacity: 100, max_capacity: 300 };

    assert.deepEqual(
      applyFilters(ranged, filters).map((v) => v.venue_id),
      ["S100", "S300"]
    );
  });

  test("TC-107 AC1+AC2 boundary — two required facilities means both, not either", () => {
    const trio = catalogue.filter((v) => ["P", "Q", "R"].includes(v.venue_id));
    const filters = { ...emptyFilters(), facilities: ["WIFI", "POWER_POINTS"] };

    assert.deepEqual(
      applyFilters(trio, filters).map((v) => v.venue_id),
      ["R"]
    );

    const accessFilters = { ...emptyFilters(), accessibility: ["WHEELCHAIR_ACCESS", "LIFT"] };
    assert.deepEqual(
      applyFilters(catalogue, accessFilters).map((v) => v.venue_id),
      []
    );
  });

  test("TC-108 AC3 happy path — the coordinator can see what is currently applied", () => {
    const filters = { ...emptyFilters(), location: "CENTRAL", layout: "THEATRE" };
    const active = activeFilters(filters);

    assert.deepEqual(active, [
      { key: "location", value: "CENTRAL" },
      { key: "layout", value: "THEATRE" }
    ]);
  });

  test("TC-109 AC3 happy path — one action clears everything", () => {
    const filters = {
      location: "CENTRAL",
      min_capacity: 100,
      max_capacity: 300,
      facilities: ["WIFI"],
      accessibility: ["WHEELCHAIR_ACCESS"],
      layout: "THEATRE"
    };
    const cleared = emptyFilters();

    assert.equal(activeFilters(filters).length, 5);
    assert.deepEqual(activeFilters(cleared), []);
    assert.equal(applyFilters(catalogue, cleared).length, catalogue.length);
  });

  test("TC-110 AC4 happy path — the count tracks every change, in both directions", () => {
    const shortlist = catalogue.slice(0, 8);
    const start = applyFilters(shortlist, emptyFilters()).length;

    const afterLocation = applyFilters(shortlist, { ...emptyFilters(), location: "CENTRAL" });
    const afterBoth = applyFilters(shortlist, {
      ...emptyFilters(),
      location: "CENTRAL",
      layout: "THEATRE"
    });
    const afterRemoveLayout = applyFilters(shortlist, { ...emptyFilters(), location: "CENTRAL" });

    assert.equal(start, 8);
    assert.ok(afterLocation.length < start);
    assert.ok(afterBoth.length < afterLocation.length);
    assert.equal(afterRemoveLayout.length, afterLocation.length);
  });

  test("TC-111 AC3+AC4 edge — filters can exclude everything, and it is recoverable", () => {
    const filters = { ...emptyFilters(), location: "CENTRAL", layout: "BANQUET" };
    const narrowed = applyFilters(catalogue, filters);
    const restored = applyFilters(catalogue, emptyFilters());

    assert.equal(narrowed.length, 0);
    assert.equal(restored.length, catalogue.length);
    assert.deepEqual(activeFilters(emptyFilters()), []);
  });
});


// =============================================================================
// E9 / SCRUM-171 — Set a venue's setup and turnaround time
// =============================================================================

describe("E9 / SCRUM-171 Set a venue's setup and turnaround time", () => {
  const staffId = "USR-VENUE-001";
  const existing = venueWithPlanningDefaults({ venue_id: "VEN-001", name: "Harbour Hall" });
  const save = (changes, overrides = {}) => saveVenuePlanning({
    venue: existing,
    role: ROLES.VENUE_STAFF,
    staffId,
    assignedVenueIds: ["VEN-001"],
    changes,
    now: "2026-10-14T09:00:00.000Z",
    ...overrides
  });

  test("AC1+AC4 positive — valid setup and turnaround times are saved and available to the detail view", () => {
    const result = save({ setup_minutes: 30, turnaround_minutes: 45 });
    assert.equal(result.ok, true);
    assert.equal(result.venue.setup_minutes, 30);
    assert.equal(result.venue.turnaround_minutes, 45);
  });

  test("AC2 boundary — zero is accepted for both timing values", () => {
    const result = save({ setup_minutes: 0, turnaround_minutes: 0 });
    assert.equal(result.ok, true);
    assert.equal(result.venue.setup_minutes, 0);
    assert.equal(result.venue.turnaround_minutes, 0);
  });

  testEach([
    ["negative setup", { setup_minutes: -1 }, "setup_minutes"],
    ["negative turnaround", { turnaround_minutes: -1 }, "turnaround_minutes"],
    ["decimal setup", { setup_minutes: 30.5 }, "setup_minutes"],
    ["non-numeric turnaround", { turnaround_minutes: "abc" }, "turnaround_minutes"]
  ])("AC2 validation — %s is refused with a validation message", (_label, changes, field) => {
    const result = save(changes);
    assert.equal(result.ok, false);
    assert.equal(result.reason, field);
    assert.match(result.message, /whole number/i);
    assert.deepEqual(result.venue, existing);
  });

  testEach([ROLES.COORDINATOR, ROLES.SAFETY_OFFICER])(
    "AC3 authorization — %s cannot edit venue timings",
    (role) => {
      const result = save({ setup_minutes: 60 }, { role });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "not_allowed");
      assert.equal(result.venue.setup_minutes, 0);
    }
  );

  testEach([
    ["setup_minutes", 30, 60],
    ["turnaround_minutes", 45, 30]
  ])("AC3 audit — changing %s records actor, timestamp, previous value and new value", (field, oldValue, newValue) => {
    const current = { ...existing, [field]: oldValue };
    const result = saveVenuePlanning({
      venue: current,
      role: ROLES.VENUE_STAFF,
      staffId,
      assignedVenueIds: [current.venue_id],
      changes: { [field]: newValue },
      now: "2026-10-14T09:00:00.000Z"
    });
    assert.deepEqual(result.history, [{
      venue_id: "VEN-001",
      actor_id: staffId,
      field_name: field,
      old_value: oldValue,
      new_value: newValue,
      created_at: "2026-10-14T09:00:00.000Z"
    }]);
  });

  test("AC4 display — saved timings remain in the venue detail model", () => {
    const result = save({ setup_minutes: 30, turnaround_minutes: 45 });
    assert.deepEqual(
      { setup: result.venue.setup_minutes, turnaround: result.venue.turnaround_minutes },
      { setup: 30, turnaround: 45 }
    );
  });

  test("AC1 default — a new venue defaults both timing values to zero", () => {
    const created = venueWithPlanningDefaults({ venue_id: "VEN-NEW" });
    assert.equal(created.setup_minutes, 0);
    assert.equal(created.turnaround_minutes, 0);
  });
});


// =============================================================================
// E10 / SCRUM-172 — Record a venue's safety information
// =============================================================================

describe("E10 / SCRUM-172 Record a venue's safety information", () => {
  const staffId = "USR-VENUE-001";
  const existing = venueWithPlanningDefaults({ venue_id: "VEN-001", name: "Harbour Hall" });
  const save = (changes, overrides = {}) => saveVenuePlanning({
    venue: existing,
    role: ROLES.VENUE_STAFF,
    staffId,
    assignedVenueIds: ["VEN-001"],
    changes,
    now: "2026-10-14T09:00:00.000Z",
    ...overrides
  });

  test("AC1 positive — emergency access notes are saved", () => {
    const note = "Emergency exit beside loading bay";
    assert.equal(save({ emergency_access_notes: note }).venue.emergency_access_notes, note);
  });

  test("AC1 positive — known restrictions are saved", () => {
    const restrictions = "No open flames; max stage height 1.5m";
    assert.equal(save({ known_restrictions: restrictions }).venue.known_restrictions, restrictions);
  });

  test("AC1 positive — both safety fields can be saved together", () => {
    const result = save({
      emergency_access_notes: "Emergency access via Door B",
      known_restrictions: "Keep loading bay clear"
    });
    assert.equal(result.ok, true);
    assert.equal(result.venue.emergency_access_notes, "Emergency access via Door B");
    assert.equal(result.venue.known_restrictions, "Keep loading bay clear");
  });

  test("AC1 free text — spaces, punctuation and multiple sentences are preserved", () => {
    const note = "Emergency access via Door B. Keep 2m clear.";
    assert.equal(save({ emergency_access_notes: note }).venue.emergency_access_notes, note);
  });

  testEach([ROLES.COORDINATOR, ROLES.SAFETY_OFFICER])(
    "AC2 authorization — %s cannot edit safety fields",
    (role) => {
      const result = save({ emergency_access_notes: "Changed text" }, { role });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "not_allowed");
      assert.equal(result.venue.emergency_access_notes, "");
    }
  );

  testEach([
    ["emergency_access_notes", "Old emergency note", "New emergency note"],
    ["known_restrictions", "Old restriction", "New restriction"]
  ])("AC2 audit — changing %s records actor, timestamp, old value and new value", (field, oldValue, newValue) => {
    const current = { ...existing, [field]: oldValue };
    const result = saveVenuePlanning({
      venue: current,
      role: ROLES.VENUE_STAFF,
      staffId,
      assignedVenueIds: [current.venue_id],
      changes: { [field]: newValue },
      now: "2026-10-14T09:00:00.000Z"
    });
    assert.deepEqual(result.history[0], {
      venue_id: "VEN-001",
      actor_id: staffId,
      field_name: field,
      old_value: oldValue,
      new_value: newValue,
      created_at: "2026-10-14T09:00:00.000Z"
    });
  });

  testEach([ROLES.SAFETY_OFFICER, ROLES.COORDINATOR])(
    "AC3 access — %s can view venue safety information",
    (role) => assert.equal(canViewVenueSafety(role), true)
  );

  test("AC2+AC3 access control — visible safety fields do not grant edit permission", () => {
    assert.equal(canViewVenueSafety(ROLES.COORDINATOR), true);
    const result = save({ known_restrictions: "Changed" }, { role: ROLES.COORDINATOR });
    assert.equal(result.ok, false);
  });

  test("AC1 persistence — saved safety information survives a reload of the stored record", () => {
    const result = save({
      emergency_access_notes: "Emergency access via Door B",
      known_restrictions: "No open flames"
    });
    const reloaded = structuredClone(result.venue);
    assert.equal(reloaded.emergency_access_notes, "Emergency access via Door B");
    assert.equal(reloaded.known_restrictions, "No open flames");
  });
});


// =============================================================================
// F1 / SCRUM-125 — Request a venue for an event
// =============================================================================

describe("F1 / SCRUM-125 Request a venue for an event", () => {
  const coordinatorId = "USR-COORD-001";
  const selectedVenue = venueWithPlanningDefaults({ venue_id: "VEN-001", name: "Harbour Hall", max_capacity: 400 });
  const event = {
    event_id: "EVT-001",
    coordinator_id: coordinatorId,
    name: "Sustainability Forum",
    status: STATUS.APPROVED,
    event_date: "2026-11-20",
    start_time: "09:00",
    end_time: "17:00",
    expected_attendance: 180
  };
  const request = (overrides = {}) => makeVenueBookingRequest({
    event,
    venue: selectedVenue,
    coordinatorId,
    requiredLayout: "THEATRE",
    requiredFacilities: ["WIFI", "POWER_POINTS"],
    now: "2026-10-14T09:00:00.000Z",
    ...overrides
  });

  test("AC1 positive — a valid request captures every required booking field", () => {
    const result = request();
    assert.equal(result.ok, true);
    assert.deepEqual({
      event_id: result.booking.event_id,
      venue_id: result.booking.venue_id,
      date: result.booking.start_datetime.slice(0, 10),
      start: result.booking.start_datetime,
      end: result.booking.end_datetime,
      attendance: result.booking.expected_attendance,
      layout: result.booking.requested_layout_id,
      facilities: result.booking.required_facilities
    }, {
      event_id: "EVT-001",
      venue_id: "VEN-001",
      date: "2026-11-20",
      start: "2026-11-20T09:00:00+08:00",
      end: "2026-11-20T17:00:00+08:00",
      attendance: 180,
      layout: "THEATRE",
      facilities: ["WIFI", "POWER_POINTS"]
    });
  });

  testEach([STATUS.DRAFT, STATUS.SUBMITTED, STATUS.SAFETY_REVIEW, STATUS.CONFIRMED,
    STATUS.COMPLETED, STATUS.CANCELLED, STATUS.REJECTED])(
    "AC2 negative — %s events cannot request a venue",
    (status) => {
      const result = request({ event: { ...event, status } });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "event_status");
    }
  );

  testEach([STATUS.APPROVED, STATUS.PLANNING])(
    "AC2 positive — %s events can request a venue",
    (status) => assert.equal(request({ event: { ...event, status } }).ok, true)
  );

  test("AC3 positive — submission is Pending and routed by selected venue", () => {
    const result = request();
    assert.equal(result.booking.status, BOOKING_STATUS.PENDING);
    assert.equal(result.routedVenueId, "VEN-001");
  });

  test("AC4 negative — a duplicate Pending request for the event and venue is blocked", () => {
    const result = request({
      existingBookings: [{ booking_id: "VB-001", event_id: "EVT-001", venue_id: "VEN-001", status: BOOKING_STATUS.PENDING }]
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "duplicate_pending");
  });

  testEach([
    ["event", { event: { ...event, event_id: "" } }],
    ["venue", { venue: { ...selectedVenue, venue_id: "" } }],
    ["date", { event: { ...event, event_date: "" } }],
    ["start time", { event: { ...event, start_time: "" } }],
    ["end time", { event: { ...event, end_time: "" } }],
    ["layout", { requiredLayout: "" }],
    ["facility requirement", { requiredFacilities: undefined }]
  ])("AC1 validation — missing %s is refused", (_field, override) => {
    const result = request(override);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "required");
  });

  testEach([0, -1])("AC1 boundary — attendance %s is refused", (attendance) => {
    const result = request({ event: { ...event, expected_attendance: attendance } });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "attendance");
  });

  testEach([["14:00", "13:00"], ["14:00", "14:00"]])(
    "AC1 validation — time range %s to %s is refused",
    (start, end) => {
      const result = request({ event: { ...event, start_time: start, end_time: end } });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "time_range");
    }
  );

  test("AC2 authorization — a coordinator cannot request for another coordinator's event", () => {
    const result = request({ coordinatorId: "USR-COORD-OTHER" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_assigned");
  });

  testEach([BOOKING_STATUS.REJECTED, BOOKING_STATUS.WITHDRAWN])(
    "AC4 positive — a new request is allowed after the prior request is %s",
    (status) => {
      const prior = [{ booking_id: "VB-001", event_id: "EVT-001", venue_id: "VEN-001", status }];
      const result = request({ existingBookings: prior });
      assert.equal(result.ok, true);
      assert.equal(result.booking.status, BOOKING_STATUS.PENDING);
    }
  );
});


// =============================================================================
// F3 / SCRUM-127 — See booking requests waiting on me
// =============================================================================

describe("F3 / SCRUM-127 See booking requests waiting on me", () => {
  const pending = (id, fields = {}) => ({
    booking_id: id,
    venue_id: "VEN-001",
    event_name: `Event ${id}`,
    start_datetime: "2026-11-20T10:00:00.000Z",
    end_datetime: "2026-11-20T12:00:00.000Z",
    expected_attendance: 100,
    submitted_at: "2026-10-14T09:00:00.000Z",
    status: BOOKING_STATUS.PENDING,
    ...fields
  });

  test("AC1-2 positive — the queue contains only assigned venues and exposes required fields", () => {
    const rows = venueStaffQueue({
      bookings: [pending("VB-001"), pending("VB-002", { venue_id: "VEN-002" })],
      assignedVenueIds: ["VEN-001"]
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_name, "Event VB-001");
    assert.equal(rows[0].requested_date, "2026-11-20");
    assert.match(rows[0].requested_window, /10:00.*12:00/);
    assert.equal(rows[0].expected_attendance, 100);
    assert.equal(rows[0].submitted_at, "2026-10-14T09:00:00.000Z");
  });

  testEach([
    ["requested_date", ["VB-EARLY", "VB-LATE"]],
    ["submitted_at", ["VB-LATE", "VB-EARLY"]]
  ])("AC3 positive — the queue sorts by %s", (sortBy, expected) => {
    const rows = venueStaffQueue({
      bookings: [
        pending("VB-EARLY", { start_datetime: "2026-11-10T10:00:00.000Z", submitted_at: "2026-10-14T10:00:00.000Z" }),
        pending("VB-LATE", { start_datetime: "2026-11-20T10:00:00.000Z", submitted_at: "2026-10-14T09:00:00.000Z" })
      ],
      assignedVenueIds: ["VEN-001"],
      sortBy
    });
    assert.deepEqual(rows.map((row) => row.booking_id), expected);
  });

  test("AC1 security — another staff member's venue is not exposed", () => {
    const rows = venueStaffQueue({ bookings: [pending("VB-002", { venue_id: "VEN-002" })], assignedVenueIds: ["VEN-001"] });
    assert.deepEqual(rows, []);
  });

  test("AC1 negative — Approved and Rejected requests are excluded", () => {
    const rows = venueStaffQueue({
      bookings: [pending("P"), pending("A", { status: BOOKING_STATUS.APPROVED }), pending("R", { status: BOOKING_STATUS.REJECTED })],
      assignedVenueIds: ["VEN-001"]
    });
    assert.deepEqual(rows.map((row) => row.booking_id), ["P"]);
  });

  test("AC2 display — event, date, window, attendance and submission time remain exact", () => {
    const source = pending("VB-001");
    const [row] = venueStaffQueue({ bookings: [source], assignedVenueIds: ["VEN-001"] });
    assert.equal(row.event_name, source.event_name);
    assert.equal(row.start_datetime, source.start_datetime);
    assert.equal(row.end_datetime, source.end_datetime);
    assert.equal(row.expected_attendance, source.expected_attendance);
    assert.equal(row.submitted_at, source.submitted_at);
  });

  test("AC3 boundary — equal requested dates use deterministic submission-time ordering", () => {
    const rows = venueStaffQueue({
      bookings: [
        pending("VB-002", { submitted_at: "2026-10-14T10:00:00.000Z" }),
        pending("VB-001", { submitted_at: "2026-10-14T09:00:00.000Z" })
      ],
      assignedVenueIds: ["VEN-001"],
      sortBy: "requested_date"
    });
    assert.deepEqual(rows.map((row) => row.booking_id), ["VB-001", "VB-002"]);
  });

  test("AC1 empty state — no assigned Pending work produces an empty queue", () => {
    assert.deepEqual(venueStaffQueue({ bookings: [], assignedVenueIds: ["VEN-001"] }), []);
  });
});


// =============================================================================
// F4 / SCRUM-128 — Approve a venue booking request
// =============================================================================

describe("F4 / SCRUM-128 Approve a venue booking request", () => {
  const staffId = "USR-VENUE-001";
  const managedVenue = venueWithPlanningDefaults({ venue_id: "VEN-001", name: "Harbour Hall" });
  const booking = (id, fields = {}) => ({
    booking_id: id,
    booking_label: `Booking ${id}`,
    event_id: `EVT-${id}`,
    venue_id: "VEN-001",
    start_datetime: "2026-11-20T10:00:00.000Z",
    end_datetime: "2026-11-20T12:00:00.000Z",
    submitted_at: "2026-10-14T09:00:00.000Z",
    status: BOOKING_STATUS.PENDING,
    ...fields
  });
  const approve = (target, all = [target], overrides = {}) => approveBooking({
    booking: target,
    bookings: all,
    venue: managedVenue,
    staffId,
    assignedVenueIds: ["VEN-001"],
    now: "2026-10-14T11:00:00.000Z",
    ...overrides
  });

  testEach([
    [BOOKING_STATUS.PENDING, true],
    [BOOKING_STATUS.APPROVED, false],
    [BOOKING_STATUS.REJECTED, false]
  ])("AC1 — Approve availability for %s is %s", (status, expected) => {
    assert.equal(canApproveBooking(booking("VB-001", { status }), ["VEN-001"]), expected);
  });

  test("AC2 negative — an approved overlap is refused and the clashing booking is named", () => {
    const target = booking("VB-002", { start_datetime: "2026-11-20T11:00:00.000Z", end_datetime: "2026-11-20T13:00:00.000Z" });
    const conflict = booking("VB-001", { status: BOOKING_STATUS.APPROVED, booking_label: "Annual Dinner", start_datetime: "2026-11-20T10:00:00.000Z", end_datetime: "2026-11-20T12:00:00.000Z" });
    const result = approve(target, [target, conflict]);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "approved_conflict");
    assert.equal(result.conflict, "Annual Dinner");
  });

  test("AC3 positive — a conflict-free request becomes Approved and occupies its window", () => {
    const target = booking("VB-001");
    const result = approve(target);
    assert.equal(result.ok, true);
    assert.equal(result.booking.status, BOOKING_STATUS.APPROVED);
    assert.equal(result.booking.occupied_start, "2026-11-20T10:00:00.000Z");
    assert.equal(result.booking.occupied_end, "2026-11-20T12:00:00.000Z");
  });

  test("AC4 negative — a later competing request cannot be approved first", () => {
    const earlier = booking("VB-001", { submitted_at: "2026-10-14T09:00:00.000Z" });
    const later = booking("VB-002", { submitted_at: "2026-10-14T10:00:00.000Z" });
    const result = approve(later, [earlier, later]);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "earlier_pending");
    assert.equal(result.conflict, "VB-001");
    assert.equal(approve(earlier, [earlier, later]).ok, true);
  });

  test("AC2 boundary — touching occupied windows do not clash", () => {
    const existing = booking("VB-001", { status: BOOKING_STATUS.APPROVED, end_datetime: "2026-11-20T12:45:00.000Z" });
    const target = booking("VB-002", { start_datetime: "2026-11-20T12:45:00.000Z", end_datetime: "2026-11-20T14:00:00.000Z" });
    assert.equal(approve(target, [existing, target]).ok, true);
  });

  test("AC2 negative — overlapping venue unavailability refuses approval", () => {
    const target = booking("VB-001");
    const result = approve(target, [target], {
      unavailability: [{ venue_id: "VEN-001", start_datetime: "2026-11-20T09:00:00.000Z", end_datetime: "2026-11-20T13:00:00.000Z", reason: "Maintenance" }]
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unavailable");
    assert.equal(result.conflict, "Maintenance");
  });

  test("AC1 authorization — unassigned Venue Staff cannot approve", () => {
    const target = booking("VB-001");
    const result = approve(target, [target], { assignedVenueIds: ["VEN-OTHER"] });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_allowed");
  });

  test("AC3 audit — approval records status, decision time and decision maker", () => {
    const result = approve(booking("VB-001"));
    assert.equal(result.booking.decided_by, staffId);
    assert.equal(result.booking.decided_at, "2026-10-14T11:00:00.000Z");
    assert.equal(result.history.old_value, BOOKING_STATUS.PENDING);
    assert.equal(result.history.new_value, BOOKING_STATUS.APPROVED);
  });

  test("AC2 concurrency — sequential transaction outcomes allow only one conflicting approval", () => {
    const first = booking("VB-001", { submitted_at: "2026-10-14T09:00:00.000Z" });
    const second = booking("VB-002", { submitted_at: "2026-10-14T09:00:00.000Z" });
    const firstResult = approve(first, [first, second]);
    assert.equal(firstResult.ok, true);
    const secondResult = approve(second, [firstResult.booking, second]);
    assert.equal(secondResult.ok, false);
    assert.equal(secondResult.reason, "approved_conflict");
  });

  testEach([BOOKING_STATUS.REJECTED, BOOKING_STATUS.WITHDRAWN])(
    "AC4 positive — a later request can proceed after the earlier request is %s",
    (status) => {
      const earlier = booking("VB-001", { status, submitted_at: "2026-10-14T09:00:00.000Z" });
      const later = booking("VB-002", { submitted_at: "2026-10-14T10:00:00.000Z" });
      assert.equal(approve(later, [earlier, later]).ok, true);
    }
  );

  test("AC2 regression — approval recalculates conflicts with the latest setup and turnaround", () => {
    const existing = booking("VB-001", { status: BOOKING_STATUS.APPROVED, start_datetime: "2026-11-20T10:00:00.000Z", end_datetime: "2026-11-20T12:00:00.000Z" });
    const target = booking("VB-002", { start_datetime: "2026-11-20T12:30:00.000Z", end_datetime: "2026-11-20T14:00:00.000Z" });
    const revisedVenue = { ...managedVenue, turnaround_minutes: 45 };
    const result = approve(target, [existing, target], { venue: revisedVenue });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "approved_conflict");
  });
});


// =============================================================================
// F7 / SCRUM-131 — Track the status of my booking requests
// =============================================================================

describe("F7 / SCRUM-131 Track the status of my booking requests", () => {
  const coordinatorId = "USR-COORD-001";
  const event = { event_id: "EVT-001", coordinator_id: coordinatorId };
  const booking = (id, fields = {}) => ({
    booking_id: id,
    event_id: "EVT-001",
    venue_id: `VEN-${id}`,
    venue_name: `Venue ${id}`,
    start_datetime: "2026-11-20T10:00:00.000Z",
    end_datetime: "2026-11-20T12:00:00.000Z",
    status: BOOKING_STATUS.PENDING,
    decision_reason: null,
    decided_at: null,
    ...fields
  });

  test("AC1-2 positive — every request shows venue, window, status, decision reason and timestamp", () => {
    const reason = "The loading bay is unavailable for the requested equipment delivery window.";
    const result = bookingStatusView({
      event,
      coordinatorId,
      bookings: [
        booking("A", { status: BOOKING_STATUS.APPROVED, decided_at: "2026-10-14T10:00:00.000Z" }),
        booking("P"),
        booking("R", { status: BOOKING_STATUS.REJECTED, decision_reason: reason, decided_at: "2026-10-14T11:00:00.000Z" })
      ]
    });
    assert.equal(result.bookings.length, 3);
    for (const row of result.bookings) {
      assert.ok(row.venue_name);
      assert.ok(row.start_datetime);
      assert.ok(row.end_datetime);
      assert.ok(row.status);
      assert.ok(Object.hasOwn(row, "decision_reason"));
      assert.ok(Object.hasOwn(row, "decided_at"));
    }
    assert.equal(result.bookings[2].decision_reason, reason);
  });

  testEach([
    ["none", []],
    ["Pending", [booking("P")]],
    ["Rejected", [booking("R", { status: BOOKING_STATUS.REJECTED })]]
  ])("AC3 negative — confirmation is blocked when venue booking is %s", (_label, bookings) => {
    assert.equal(canConfirmEvent({ bookings }), false);
  });

  test("AC2 positive — a long rejection reason is returned without truncation", () => {
    const reason = "No suitable access route is available because the east loading bay is closed throughout the requested setup and event window.";
    const result = bookingStatusView({ event, coordinatorId, bookings: [booking("R", { status: BOOKING_STATUS.REJECTED, decision_reason: reason })] });
    assert.equal(result.bookings[0].decision_reason, reason);
  });

  test("AC1 positive — multiple venue requests retain independent statuses", () => {
    const result = bookingStatusView({
      event,
      coordinatorId,
      bookings: [booking("MAIN", { status: BOOKING_STATUS.APPROVED }), booking("BREAKOUT")]
    });
    assert.deepEqual(result.bookings.map((row) => row.status), [BOOKING_STATUS.APPROVED, BOOKING_STATUS.PENDING]);
  });

  test("AC1 authorization — a coordinator cannot inspect another coordinator's event", () => {
    const result = bookingStatusView({ event, coordinatorId: "USR-COORD-OTHER", bookings: [booking("A")] });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_allowed");
  });

  test("AC1 display — decision timestamps appear only after a decision", () => {
    const result = bookingStatusView({
      event,
      coordinatorId,
      bookings: [booking("P"), booking("A", { status: BOOKING_STATUS.APPROVED, decided_at: "2026-10-14T10:00:00.000Z" })]
    });
    assert.equal(result.bookings[0].decided_at, null);
    assert.equal(result.bookings[1].decided_at, "2026-10-14T10:00:00.000Z");
  });

  test("AC3 negative — an approved venue does not bypass a required unapproved safety check", () => {
    assert.equal(canConfirmEvent({
      bookings: [booking("A", { status: BOOKING_STATUS.APPROVED })],
      safetyRequired: true,
      safetyApproved: false
    }), false);
  });

  test("AC1 regression — Released and Replaced requests remain visible with final details", () => {
    const result = bookingStatusView({
      event,
      coordinatorId,
      bookings: [
        booking("OLD", { status: BOOKING_STATUS.RELEASED, release_reason: "Event cancelled" }),
        booking("REPLACED", { status: BOOKING_STATUS.REPLACED, release_reason: "Venue changed" })
      ]
    });
    assert.deepEqual(result.bookings.map((row) => row.status), [BOOKING_STATUS.RELEASED, BOOKING_STATUS.REPLACED]);
    assert.deepEqual(result.bookings.map((row) => row.release_reason), ["Event cancelled", "Venue changed"]);
  });
});


// =============================================================================
// F8 / SCRUM-132 — Release a venue when it is no longer needed
// =============================================================================

describe("F8 / SCRUM-132 Release a venue when it is no longer needed", () => {
  const coordinatorId = "USR-COORD-001";
  const event = { event_id: "EVT-001", coordinator_id: coordinatorId, status: STATUS.CANCELLED };
  const booking = (id, status, fields = {}) => ({
    booking_id: id,
    event_id: "EVT-001",
    venue_id: `VEN-${id}`,
    start_datetime: "2026-11-20T10:00:00.000Z",
    end_datetime: "2026-11-20T12:00:00.000Z",
    occupied_start: "2026-11-20T09:30:00.000Z",
    occupied_end: "2026-11-20T12:45:00.000Z",
    status,
    ...fields
  });
  const release = (bookings) => releaseCancelledBookings({
    event,
    bookings,
    coordinatorId,
    now: "2026-10-14T12:00:00.000Z"
  });

  test("AC1-2 positive — cancellation releases Approved and withdraws Pending requests immediately", () => {
    const result = release([booking("A", BOOKING_STATUS.APPROVED), booking("P", BOOKING_STATUS.PENDING)]);
    assert.deepEqual(result.bookings.map((row) => row.status), [BOOKING_STATUS.RELEASED, BOOKING_STATUS.WITHDRAWN]);
    assert.equal(venueWindowAvailable({
      venueId: "VEN-A",
      start: "2026-11-20T09:30:00.000Z",
      end: "2026-11-20T12:45:00.000Z",
      bookings: result.bookings
    }), true);
  });

  test("AC3 audit — release history retains the reason and exact timestamp", () => {
    const result = release([booking("A", BOOKING_STATUS.APPROVED)]);
    assert.equal(result.history[0].release_reason, "Event cancelled");
    assert.equal(result.history[0].created_at, "2026-10-14T12:00:00.000Z");
    assert.equal(result.bookings[0].released_at, "2026-10-14T12:00:00.000Z");
  });

  test("AC1 multi-venue — all Approved bookings are released", () => {
    const result = release([booking("A", BOOKING_STATUS.APPROVED), booking("B", BOOKING_STATUS.APPROVED), booking("C", BOOKING_STATUS.APPROVED)]);
    assert.deepEqual(result.bookings.map((row) => row.status), [BOOKING_STATUS.RELEASED, BOOKING_STATUS.RELEASED, BOOKING_STATUS.RELEASED]);
  });

  test("AC1 multi-venue — mixed Approved and Pending requests receive the correct final status", () => {
    const result = release([
      booking("A", BOOKING_STATUS.APPROVED), booking("B", BOOKING_STATUS.APPROVED),
      booking("C", BOOKING_STATUS.PENDING), booking("D", BOOKING_STATUS.PENDING)
    ]);
    assert.deepEqual(result.bookings.map((row) => row.status), [
      BOOKING_STATUS.RELEASED, BOOKING_STATUS.RELEASED,
      BOOKING_STATUS.WITHDRAWN, BOOKING_STATUS.WITHDRAWN
    ]);
  });

  test("AC2 positive — a released venue is immediately searchable for the same slot", () => {
    const result = release([booking("A", BOOKING_STATUS.APPROVED)]);
    assert.equal(venueWindowAvailable({
      venueId: "VEN-A",
      start: "2026-11-20T10:00:00.000Z",
      end: "2026-11-20T12:00:00.000Z",
      bookings: result.bookings
    }), true);
  });

  test("AC2 positive — the entire setup-to-turnaround occupied window is freed", () => {
    const result = release([booking("A", BOOKING_STATUS.APPROVED)]);
    assert.equal(venueWindowAvailable({
      venueId: "VEN-A",
      start: "2026-11-20T09:30:00.000Z",
      end: "2026-11-20T12:45:00.000Z",
      bookings: result.bookings
    }), true);
  });

  test("AC1 idempotency — releasing twice does not duplicate history or alter final state", () => {
    const first = release([booking("A", BOOKING_STATUS.APPROVED)]);
    const second = release(first.bookings);
    assert.equal(first.history.length, 1);
    assert.equal(second.history.length, 0);
    assert.equal(second.bookings[0].status, BOOKING_STATUS.RELEASED);
  });

  test("AC3 audit — every released booking receives its own history record", () => {
    const result = release([booking("A", BOOKING_STATUS.APPROVED), booking("B", BOOKING_STATUS.APPROVED)]);
    assert.deepEqual(result.history.map((row) => row.booking_id), ["A", "B"]);
  });

  test("AC1 negative — a completed cancellation leaves no active Approved or Pending booking", () => {
    const result = release([booking("A", BOOKING_STATUS.APPROVED), booking("P", BOOKING_STATUS.PENDING)]);
    assert.equal(result.bookings.some((row) => ACTIVE_BOOKING_STATUSES.has(row.status)), false);
  });
});


// =============================================================================
// F2 / SCRUM-126 — Have submitted event bookings assigned to a venue staff automatically
// =============================================================================

describe("F2 / SCRUM-126 Have submitted event bookings assigned to a venue staff automatically", () => {
  const now = "2026-10-15T09:00:00.000Z";
  const staff = (id, active = true) => ({ staff_id: id, role: ROLES.VENUE_STAFF, active });
  const pending = (id) => ({ booking_id: id, status: BOOKING_STATUS.PENDING, assigned_staff_id: null });
  const assign = (booking, people, prior = []) => assignVenueStaff({
    booking, staff: people, priorAssignments: prior, now
  });

  test("AC1 positive — submission assigns exactly one venue staff member", () => {
    const result = assign(pending("VB-001"), [staff("STAFF-A"), staff("STAFF-B")]);
    assert.equal(result.ok, true);
    assert.equal(result.booking.assigned_staff_id, "STAFF-A");
    assert.equal(typeof result.booking.assigned_staff_id, "string");
  });

  test("AC1 negative — a booking that already has a staff member is not assigned a second one", () => {
    const first = assign(pending("VB-001"), [staff("STAFF-A"), staff("STAFF-B")]);
    const second = assign(first.booking, [staff("STAFF-A"), staff("STAFF-B")], ["STAFF-A"]);
    assert.equal(second.ok, false);
    assert.equal(second.reason, "already_assigned");
    assert.equal(second.booking.assigned_staff_id, "STAFF-A");
  });

  test("AC2 positive — the assigned staff identity and timestamp are stored on the booking", () => {
    const result = assign(pending("VB-001"), [staff("STAFF-A")]);
    assert.equal(result.booking.assigned_staff_id, "STAFF-A");
    assert.equal(result.booking.assigned_at, now);
  });

  test("AC3 positive — assignment rotates across active venue staff", () => {
    const people = [staff("STAFF-B"), staff("STAFF-A")];
    const first = assign(pending("VB-001"), people);
    const second = assign(pending("VB-002"), people, [first.booking.assigned_staff_id]);
    const third = assign(pending("VB-003"), people, [first.booking.assigned_staff_id, second.booking.assigned_staff_id]);
    assert.deepEqual(
      [first.booking.assigned_staff_id, second.booking.assigned_staff_id, third.booking.assigned_staff_id],
      ["STAFF-A", "STAFF-B", "STAFF-A"]
    );
  });

  test("AC3 negative — inactive venue staff are left out of the rotation", () => {
    const result = assign(pending("VB-001"), [staff("STAFF-A", false), staff("STAFF-B")]);
    assert.equal(result.booking.assigned_staff_id, "STAFF-B");
  });

  test("AC4 positive — one venue staff member can hold more than one booking", () => {
    const people = [staff("STAFF-A")];
    const first = assign(pending("VB-001"), people);
    const second = assign(pending("VB-002"), people, [first.booking.assigned_staff_id]);
    assert.equal(first.booking.assigned_staff_id, "STAFF-A");
    assert.equal(second.booking.assigned_staff_id, "STAFF-A");
  });

  test("AC5 positive — with no active venue staff the booking stays in the unassigned queue", () => {
    const booking = pending("VB-001");
    const result = assign(booking, [staff("STAFF-A", false)]);
    assert.equal(result.queue, "unassigned");
    assert.equal(result.booking.assigned_staff_id, null);
    assert.deepEqual(unassignedBookingQueue([result.booking]).map((row) => row.booking_id), ["VB-001"]);
  });

  test("AC5 negative — an assigned booking does not appear in the unassigned queue", () => {
    const result = assign(pending("VB-001"), [staff("STAFF-A")]);
    assert.deepEqual(unassignedBookingQueue([result.booking]), []);
  });
});


// =============================================================================
// F6 / SCRUM-130 — Never double-book a venue
// =============================================================================

describe("F6 / SCRUM-130 Never double-book a venue", () => {
  const hall = venueWithPlanningDefaults({ venue_id: "VEN-001", setup_minutes: 0, turnaround_minutes: 0 });
  const booking = (id, fields = {}) => ({
    booking_id: id,
    booking_label: `Booking ${id}`,
    event_id: `EVT-${id}`,
    venue_id: "VEN-001",
    start_datetime: "2026-11-20T10:00:00.000Z",
    end_datetime: "2026-11-20T12:00:00.000Z",
    submitted_at: "2026-10-15T09:00:00.000Z",
    status: BOOKING_STATUS.PENDING,
    ...fields
  });
  const approve = (target, all, overrides = {}) => approveBooking({
    booking: target,
    bookings: all,
    venue: hall,
    staffId: "USR-VENUE-001",
    assignedVenueIds: ["VEN-001"],
    now: "2026-10-15T11:00:00.000Z",
    ...overrides
  });

  test("AC1 positive — any overlap on the same date is a conflict", () => {
    const existing = booking("VB-001", { status: BOOKING_STATUS.APPROVED, end_datetime: "2026-11-20T12:00:00.000Z" });
    const incoming = booking("VB-002", { start_datetime: "2026-11-20T11:59:00.000Z", end_datetime: "2026-11-20T13:00:00.000Z" });
    assert.equal(approvedConflicts(incoming, [existing, incoming], hall).length, 1);
    assert.equal(approve(incoming, [existing, incoming]).reason, "approved_conflict");
  });

  test("AC1 negative — the same clock times on a different date do not conflict", () => {
    const existing = booking("VB-001", { status: BOOKING_STATUS.APPROVED });
    const incoming = booking("VB-002", {
      start_datetime: "2026-11-21T10:00:00.000Z",
      end_datetime: "2026-11-21T12:00:00.000Z"
    });
    assert.deepEqual(approvedConflicts(incoming, [existing, incoming], hall), []);
    assert.equal(approve(incoming, [existing, incoming]).ok, true);
  });

  test("AC1 negative — a different venue at the same time is not a double booking", () => {
    const existing = booking("VB-001", { status: BOOKING_STATUS.APPROVED, venue_id: "VEN-002" });
    const incoming = booking("VB-002");
    assert.deepEqual(approvedConflicts(incoming, [existing, incoming], hall), []);
  });

  test("AC2 positive — windows that only touch are approved", () => {
    const existing = booking("VB-001", { status: BOOKING_STATUS.APPROVED, end_datetime: "2026-11-20T12:00:00.000Z" });
    const incoming = booking("VB-002", { start_datetime: "2026-11-20T12:00:00.000Z", end_datetime: "2026-11-20T14:00:00.000Z" });
    assert.deepEqual(approvedConflicts(incoming, [existing, incoming], hall), []);
    assert.equal(approve(incoming, [existing, incoming]).ok, true);
  });

  test("AC3 positive — an approved booking blocks that window in search and on the calendar", () => {
    const approved = approve(booking("VB-001"), [booking("VB-001")]).booking;
    assert.equal(venueWindowAvailable({
      venueId: "VEN-001",
      start: approved.occupied_start,
      end: approved.occupied_end,
      bookings: [approved]
    }), false);
    assert.equal(venueWindowAvailable({
      venueId: "VEN-001",
      start: "2026-11-20T12:00:00.000Z",
      end: "2026-11-20T14:00:00.000Z",
      bookings: [approved]
    }), true);
  });

  test("AC4 positive — a maintenance block conflicts with an overlapping request", () => {
    const incoming = booking("VB-001");
    const blocks = unavailabilityConflicts(incoming, [{
      venue_id: "VEN-001",
      start_datetime: "2026-11-20T11:00:00.000Z",
      end_datetime: "2026-11-20T15:00:00.000Z",
      reason: "Maintenance"
    }], hall);
    assert.equal(blocks[0].reason, "Maintenance");
    const result = approve(incoming, [incoming], { unavailability: blocks });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unavailable");
  });

  test("AC5 positive — approval itself refuses the clash, with no separate override", () => {
    const existing = booking("VB-001", { status: BOOKING_STATUS.APPROVED });
    const incoming = booking("VB-002", { start_datetime: "2026-11-20T11:00:00.000Z", end_datetime: "2026-11-20T13:00:00.000Z" });
    const result = approve(incoming, [existing, incoming]);
    assert.equal(result.ok, false);
    assert.equal(result.booking, undefined);
    assert.equal(existing.status, BOOKING_STATUS.APPROVED);
  });
});


// =============================================================================
// F9 / SCRUM-174 — Count setup and turnaround time when checking for clashes
// =============================================================================

describe("F9 / SCRUM-174 Count setup and turnaround time when checking for clashes", () => {
  const hall = venueWithPlanningDefaults({ venue_id: "VEN-001", setup_minutes: 30, turnaround_minutes: 45 });
  const booking = (id, fields = {}) => ({
    booking_id: id,
    booking_label: `Booking ${id}`,
    event_id: `EVT-${id}`,
    venue_id: "VEN-001",
    start_datetime: "2026-11-20T10:00:00.000Z",
    end_datetime: "2026-11-20T12:00:00.000Z",
    submitted_at: "2026-10-15T09:00:00.000Z",
    status: BOOKING_STATUS.APPROVED,
    ...fields
  });

  test("AC1 positive — 10:00–12:00 with 30 minutes setup and 45 minutes turnaround occupies 09:30–12:45", () => {
    const window = occupiedBookingWindow(booking("VB-001"), hall);
    assert.equal(new Date(window.start).toISOString(), "2026-11-20T09:30:00.000Z");
    assert.equal(new Date(window.end).toISOString(), "2026-11-20T12:45:00.000Z");
  });

  test("AC1 positive — the check uses the venue times supplied at that moment", () => {
    const revised = { ...hall, setup_minutes: 0, turnaround_minutes: 15 };
    const window = occupiedBookingWindow(booking("VB-001"), revised);
    assert.equal(new Date(window.start).toISOString(), "2026-11-20T10:00:00.000Z");
    assert.equal(new Date(window.end).toISOString(), "2026-11-20T12:15:00.000Z");
  });

  test("AC3 positive — occupied windows that overlap conflict, and windows that only touch do not", () => {
    const first = booking("VB-001");
    const overlapping = booking("VB-002", { status: BOOKING_STATUS.PENDING, start_datetime: "2026-11-20T12:30:00.000Z", end_datetime: "2026-11-20T14:00:00.000Z" });
    const touching = booking("VB-003", { status: BOOKING_STATUS.PENDING, start_datetime: "2026-11-20T13:15:00.000Z", end_datetime: "2026-11-20T15:00:00.000Z" });
    assert.equal(approvedConflicts(overlapping, [first, overlapping], hall).length, 1);
    assert.deepEqual(approvedConflicts(touching, [first, touching], hall), []);
  });

  test("AC3 negative — event times that do not overlap still clash when setup and turnaround do", () => {
    const first = booking("VB-001");
    const later = booking("VB-002", {
      status: BOOKING_STATUS.PENDING,
      start_datetime: "2026-11-20T12:15:00.000Z",
      end_datetime: "2026-11-20T13:15:00.000Z"
    });
    assert.equal(timesOverlap("12:15", "13:15", "10:00", "12:00"), false);
    assert.equal(approvedConflicts(later, [first, later], hall).length, 1);
  });

  test("AC4 positive — search and approval use the occupied window rather than the event clock times", () => {
    const approved = {
      ...booking("VB-001"),
      occupied_start: "2026-11-20T09:30:00.000Z",
      occupied_end: "2026-11-20T12:45:00.000Z"
    };
    assert.equal(venueWindowAvailable({
      venueId: "VEN-001",
      start: "2026-11-20T12:15:00.000Z",
      end: "2026-11-20T12:40:00.000Z",
      bookings: [approved]
    }), false);
    const incoming = booking("VB-002", {
      status: BOOKING_STATUS.PENDING,
      start_datetime: "2026-11-20T12:30:00.000Z",
      end_datetime: "2026-11-20T14:00:00.000Z"
    });
    const result = approveBooking({
      booking: incoming,
      bookings: [approved, incoming],
      venue: hall,
      staffId: "USR-VENUE-001",
      assignedVenueIds: ["VEN-001"]
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "approved_conflict");
  });

  test("AC5 positive — the calendar shows setup, the event, and turnaround as separate segments", () => {
    const segments = calendarSegments(booking("VB-001"), hall);
    assert.deepEqual(segments.map((segment) => segment.kind), ["setup", "event", "turnaround"]);
    assert.equal(new Date(segments[0].start).toISOString(), "2026-11-20T09:30:00.000Z");
    assert.equal(new Date(segments[0].end).toISOString(), "2026-11-20T10:00:00.000Z");
    assert.equal(new Date(segments[2].start).toISOString(), "2026-11-20T12:00:00.000Z");
    assert.equal(new Date(segments[2].end).toISOString(), "2026-11-20T12:45:00.000Z");
  });

  test("AC6 positive — the clash is refused at approval time", () => {
    const existing = booking("VB-001");
    const incoming = booking("VB-002", {
      status: BOOKING_STATUS.PENDING,
      start_datetime: "2026-11-20T12:30:00.000Z",
      end_datetime: "2026-11-20T14:00:00.000Z"
    });
    const result = approveBooking({
      booking: incoming,
      bookings: [existing, incoming],
      venue: hall,
      staffId: "USR-VENUE-001",
      assignedVenueIds: ["VEN-001"],
      now: "2026-10-15T11:00:00.000Z"
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "approved_conflict");
    assert.equal(existing.status, BOOKING_STATUS.APPROVED);
  });
});


// =============================================================================
// E11 / SCRUM-173 — Take a venue out of use even when events are booked there
// =============================================================================

describe("E11 / SCRUM-173 Take a venue out of use even when events are booked there", () => {
  const now = "2026-10-15T09:30:00.000Z";
  const start = "2026-11-20T09:00:00.000Z";
  const end = "2026-11-20T13:00:00.000Z";
  const event = {
    event_id: "EVT-001",
    status: STATUS.PLANNING,
    coordinator_id: "USR-COORD-001",
    name: "Partner Summit"
  };
  const approved = {
    booking_id: "VB-001",
    event_id: "EVT-001",
    venue_id: "VEN-001",
    status: BOOKING_STATUS.APPROVED,
    start_datetime: "2026-11-20T10:00:00.000Z",
    end_datetime: "2026-11-20T12:00:00.000Z",
    occupied_start: "2026-11-20T09:30:00.000Z",
    occupied_end: "2026-11-20T12:45:00.000Z"
  };
  const record = (overrides = {}) => recordVenueUnavailability({
    venueId: "VEN-001",
    start,
    end,
    reason: "Maintenance",
    bookings: [approved],
    events: [event],
    confirmed: true,
    staffId: "USR-VENUE-001",
    now,
    ...overrides
  });

  test("AC1 positive — the period stores venue, window, reason and optional note", () => {
    const result = record({ note: "Lift inspection" });
    assert.equal(result.ok, true);
    assert.equal(result.period.venue_id, "VEN-001");
    assert.equal(result.period.start_datetime, start);
    assert.equal(result.period.end_datetime, end);
    assert.equal(result.period.reason, "Maintenance");
    assert.equal(result.period.note, "Lift inspection");
  });

  testEach(UNAVAILABILITY_REASONS.filter((reason) => reason !== "Other"))(
    "AC1 positive — %s is an accepted reason without a note",
    (reason) => {
      assert.equal(record({ reason, note: "" }).ok, true);
    }
  );

  test("AC1 negative — Other without a note is refused", () => {
    const result = record({ reason: "Other", note: "   " });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "note_required");
  });

  test("AC1 negative — a reason outside the allowed list is refused", () => {
    assert.equal(record({ reason: "Holiday" }).reason, "reason");
  });

  test("AC1 negative — a period that ends before it starts is refused", () => {
    assert.equal(record({ start: end, end: start }).reason, "time_range");
  });

  test("AC2 positive — overlapping approved bookings are listed and must be confirmed before saving", () => {
    const preview = record({ confirmed: false });
    assert.equal(preview.ok, false);
    assert.equal(preview.reason, "confirmation_required");
    assert.deepEqual(preview.affected.map((row) => row.booking_id), ["VB-001"]);
    assert.equal(record({ confirmed: true }).ok, true);
  });

  test("AC2 positive — a period with no approved overlap saves without confirmation", () => {
    const result = record({
      confirmed: false,
      bookings: [{ ...approved, start_datetime: "2026-11-21T10:00:00.000Z", end_datetime: "2026-11-21T12:00:00.000Z", occupied_start: "2026-11-21T09:30:00.000Z", occupied_end: "2026-11-21T12:45:00.000Z" }]
    });
    assert.equal(result.ok, true);
    assert.equal(result.notifications.length, 0);
  });

  test("AC3 positive — affected bookings are marked for replacement and the event and booking details stay as they were", () => {
    const result = record();
    const saved = result.bookings[0];
    assert.equal(saved.replacement_status, "Venue unavailable - replacement needed");
    assert.equal(saved.status, BOOKING_STATUS.APPROVED);
    assert.equal(saved.start_datetime, approved.start_datetime);
    assert.equal(saved.end_datetime, approved.end_datetime);
    assert.equal(result.events[0].status, STATUS.PLANNING);
    assert.equal(result.events[0].event_id, event.event_id);
  });

  test("AC3 negative — a pending request on the same window is not marked or cancelled", () => {
    const pending = { ...approved, booking_id: "VB-002", status: BOOKING_STATUS.PENDING };
    const result = record({ bookings: [pending], confirmed: false });
    assert.equal(result.ok, true);
    assert.equal(result.bookings[0].status, BOOKING_STATUS.PENDING);
    assert.equal(result.bookings[0].replacement_status, undefined);
  });

  test("AC4 positive — the assigned coordinator is notified with the event, venue, period and reason", () => {
    const notice = record().notifications[0];
    assert.equal(notice.user_id, "USR-COORD-001");
    assert.equal(notice.event_id, "EVT-001");
    assert.equal(notice.venue_id, "VEN-001");
    assert.equal(notice.start_datetime, start);
    assert.equal(notice.end_datetime, end);
    assert.equal(notice.reason, "Maintenance");
  });

  test("AC5 positive — the period blocks the calendar and excludes overlapping venue search", () => {
    const period = record().period;
    assert.equal(period.venue_id, "VEN-001");
    assert.equal(period.start_datetime, start);
    assert.equal(searchBlockedByUnavailability({
      venueId: "VEN-001",
      start: "2026-11-20T10:00:00.000Z",
      end: "2026-11-20T11:00:00.000Z",
      unavailability: [period]
    }), true);
    assert.equal(searchBlockedByUnavailability({
      venueId: "VEN-001",
      start: "2026-11-20T13:00:00.000Z",
      end: "2026-11-20T15:00:00.000Z",
      unavailability: [period]
    }), false);
  });
});
