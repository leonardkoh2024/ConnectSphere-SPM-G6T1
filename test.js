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
 *
 * Run from the repo root (no extra install — Node's built-in runner):
 *   node --test test.js
 *
 * These stories have no screens yet. The helpers below are the domain rules
 * the screens must call; when those land, move the helpers into
 * frontend/src/domain/ and keep these assertions.
 *
 * Last Updated: 2026-09-30
 * ================================================================
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const ROLES = {
  ORGANISER: "EVENT_ORGANISER",
  COORDINATOR: "EVENT_COORDINATOR",
  VENUE_STAFF: "VENUE_STAFF",
  TECH_SUPPORT: "TECHNICAL_SUPPORT_STAFF",
  ATTENDEE: "ATTENDEE"
};

const STATUS = {
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
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
