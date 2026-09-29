/**
 * ================================================================
 * TESTCASE.JS - AUTOMATED TEST SUITE
 * ================================================================
 *
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
 * Last Updated: 2026-09-23
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

const STATUS = { UNDER_REVIEW: "UNDER_REVIEW" };
const SERVER_TIMESTAMP = "SERVER_TIMESTAMP";

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
