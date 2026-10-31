// The baseline every emulator integration test starts from. `useFreshBaseline` in
// firestoreEmulator.js wipes the database and re-seeds what `baseline()` returns before each
// test, so no test can see what an earlier one wrote. It is a function so each test gets
// brand-new objects.
//
// What is in it — one connected, realistic world, so a test that updates or deletes always
// has something to act on:
//   users      one per role (all seven), plus a second organiser, coordinator and venue staff,
//              and three attendees
//   venues     Hall A (200), Room B (40), Garden C (500), each with staff, hours, setup/turnaround
//   equipment  stock for every equipment type
//   events     one in EVERY status, linked to their bookings, assignments, reviews and records:
//                DRAFT · SUBMITTED (unassigned, in the Lead's queue) · UNDER_REVIEW (open
//                clarification) · APPROVED (ready to book) · PLANNING (pending + held bookings,
//                pending equipment, pending change request) · SAFETY_REVIEW · CONFIRMED (full,
//                with a waiting list) · COMPLETED · CANCELLED · REJECTED
//
// Field names and values follow what the app writes (snake_case, UPPER_CASE enums). Every
// date is fixed — never "now" — so each run is identical. Times are Singapore (UTC+8).
// Refer to documents by the IDs exported in `IDS` rather than retyping strings.
//
// Add documents here when a new service's tests need them. Data a single test needs only for
// itself belongs in that test, not here. fixtures.test.js checks this file stays consistent.

import admin from "firebase-admin";

const { Timestamp } = admin.firestore;

/** A Firestore Timestamp for a Singapore wall-clock date and time. */
export const sgt = (date, time = "00:00") => Timestamp.fromDate(new Date(`${date}T${time}:00+08:00`));
const minutes = (ts, delta) => Timestamp.fromMillis(ts.toMillis() + delta * 60_000);

export const IDS = {
  users: {
    organiser: "user-organiser-1",
    organiser2: "user-organiser-2",
    coordinator: "user-coordinator-1",
    coordinator2: "user-coordinator-2",
    lead: "user-lead-1",
    venueStaff: "user-venue-staff-1",
    venueStaff2: "user-venue-staff-2",
    techSupport: "user-tech-1",
    safetyOfficer: "user-safety-1",
    attendee: "user-attendee-1",
    attendee2: "user-attendee-2",
    attendee3: "user-attendee-3",
  },
  venues: { hallA: "venue-hall-a", roomB: "venue-room-b", gardenC: "venue-garden-c" },
  events: {
    draft: "event-draft",
    submitted: "event-submitted",
    underReview: "event-under-review",
    approved: "event-approved",
    planning: "event-planning",
    safetyReview: "event-safety-review",
    confirmed: "event-confirmed",
    completed: "event-completed",
    cancelled: "event-cancelled",
    rejected: "event-rejected",
  },
};

const U = IDS.users;
const V = IDS.venues;
const E = IDS.events;
const CREATED = sgt("2026-12-01", "09:00");

// ---------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------

const user = (id, name, role, extra = {}) => ({
  path: `users/${id}`,
  data: {
    user_id: id,
    name,
    email: `${id}@test.connectsphere.local`,
    role,
    organisation_name: role === "ATTENDEE" ? null : "ConnectSphere Event Services",
    mobile_number: "91234567",
    preferred_contact_method: "EMAIL",
    is_active: true,
    created_at: CREATED,
    updated_at: CREATED,
    ...extra,
  },
});

const users = () => [
  user(U.organiser, "Organiser One", "EVENT_ORGANISER", { organisation_name: "Harbour Arts Society" }),
  user(U.organiser2, "Organiser Two", "EVENT_ORGANISER", { organisation_name: "Northside Runners" }),
  user(U.coordinator, "Coordinator One", "EVENT_COORDINATOR"),
  user(U.coordinator2, "Coordinator Two", "EVENT_COORDINATOR"),
  user(U.lead, "Coordinator Lead", "EVENT_COORDINATOR_LEAD"),
  user(U.venueStaff, "Venue Staff One", "VENUE_STAFF"),
  user(U.venueStaff2, "Venue Staff Two", "VENUE_STAFF"),
  user(U.techSupport, "Tech Support One", "TECHNICAL_SUPPORT_STAFF"),
  user(U.safetyOfficer, "Safety Officer One", "SAFETY_OFFICER"),
  user(U.attendee, "Attendee One", "ATTENDEE"),
  user(U.attendee2, "Attendee Two", "ATTENDEE"),
  user(U.attendee3, "Attendee Three", "ATTENDEE", { preferred_contact_method: "MOBILE" }),
];

// ---------------------------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------------------------

const weekdayHours = (opens, closes, days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]) =>
  days.map((weekday) => ({ weekday, opens_at: opens, closes_at: closes }));

const VENUES = {
  [V.hallA]: {
    name: "Hall A", building: "Marina Exhibition Centre", location: "Marina Bay, Level 2",
    max_capacity: 200, setup_minutes: 30, turnaround_minutes: 30,
    layouts: ["THEATRE", "CLASSROOM", "BANQUET"],
    facilities: ["AIR_CONDITIONING", "WIFI", "STAGE", "POWER_POINTS", "TOILETS"],
    accessibility: ["WHEELCHAIR_ACCESS", "LIFT", "ACCESSIBLE_TOILET"],
    operating_hours: weekdayHours("08:00", "22:00"),
  },
  [V.roomB]: {
    name: "Room B", building: "Marina Exhibition Centre", location: "Marina Bay, Level 3",
    max_capacity: 40, setup_minutes: 15, turnaround_minutes: 15,
    layouts: ["BOARDROOM", "CLASSROOM", "U_SHAPE"],
    facilities: ["AIR_CONDITIONING", "WIFI", "POWER_POINTS"],
    accessibility: ["WHEELCHAIR_ACCESS", "LIFT"],
    operating_hours: weekdayHours("08:00", "22:00"),
  },
  [V.gardenC]: {
    name: "Garden C", building: "Fort Canning Park", location: "Fort Canning, Lawn C",
    max_capacity: 500, setup_minutes: 60, turnaround_minutes: 60,
    layouts: ["OPEN_SPACE", "STANDING_COCKTAIL", "EXHIBITION_BOOTHS"],
    facilities: ["TOILETS", "PARKING", "LOADING_AREA", "POWER_POINTS"],
    accessibility: ["STEP_FREE_ACCESS", "ACCESSIBLE_PARKING"],
    operating_hours: weekdayHours("07:00", "23:00", ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]),
  },
};

const VENUE_STAFF = { [V.hallA]: U.venueStaff, [V.roomB]: U.venueStaff, [V.gardenC]: U.venueStaff2 };

const venues = () => Object.entries(VENUES).flatMap(([id, venue]) => [
  {
    path: `venues/${id}`,
    data: {
      venue_id: id,
      ...venue,
      emergency_access_notes: `Fire exits clearly marked in ${venue.name}.`,
      known_restrictions: "No open flames.",
      special_space_availability: "",
      is_active: true,
      created_at: CREATED,
      updated_at: CREATED,
    },
  },
  {
    // The document id must equal the venue id; firestore.rules looks the staff member up by it.
    path: `venue_staff/${id}`,
    data: { venue_id: id, user_id: VENUE_STAFF[id], staff_name: id === V.gardenC ? "Venue Staff Two" : "Venue Staff One" },
  },
  ...venue.operating_hours.map((hours, n) => ({
    path: `venue_operating_hours/${id}-hrs-${n + 1}`,
    data: { operating_id: `${id}-hrs-${n + 1}`, venue_id: id, ...hours },
  })),
]);

const venueUnavailability = () => [
  {
    path: "venue_unavailability/unavail-garden-c-maintenance",
    data: {
      venue_id: V.gardenC,
      start_datetime: sgt("2027-05-03", "07:00"),
      end_datetime: sgt("2027-05-07", "23:00"),
      reason: "Maintenance",
      note: "Lawn re-turfing.",
      created_by: U.venueStaff2,
      created_at: CREATED,
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Equipment stock
// ---------------------------------------------------------------------------------------------

const STOCK = { AUDIO: 10, VISUAL: 8, LIGHTING: 12, STAGING: 6, FURNITURE: 200, OTHERS: 20 };

const equipmentInventory = () => Object.entries(STOCK).map(([type, total]) => ({
  path: `equipment_inventory/${type}`,
  data: { equipment_type: type, total_quantity: total, availability_revision: 0, updated_at: CREATED },
}));

// ---------------------------------------------------------------------------------------------
// Events, one per status
// ---------------------------------------------------------------------------------------------

const event = (id, status, fields) => ({
  path: `events/${id}`,
  data: {
    event_id: id,
    reference_no: `EVT-${id.replace("event-", "").toUpperCase().slice(0, 6).padEnd(6, "X")}-TEST1`,
    organiser_id: U.organiser,
    created_by: fields.organiser_id || U.organiser,
    coordinator_id: null,
    assigned_at: null,
    purpose: "Community engagement",
    description: "Seeded test event.",
    equipment_required: false,
    registration_required: false,
    registration_capacity: null,
    registration_open_date: null,
    registration_open_time: null,
    registration_close_date: null,
    registration_close_time: null,
    status,
    submitted_at: status === "DRAFT" ? null : sgt("2026-12-02", "10:00"),
    created_at: CREATED,
    updated_at: CREATED,
    ...fields,
  },
});

const ASSIGNED = sgt("2026-12-03", "10:00");

const events = () => [
  event(E.draft, "DRAFT", {
    name: "Spring Poetry Reading (draft)",
    event_date: "2027-04-20", start_time: null, end_time: null, expected_attendance: null,
    equipment_required: null, registration_required: null,
  }),
  event(E.submitted, "SUBMITTED", {
    name: "Charity Fun Run Briefing", organiser_id: U.organiser2, created_by: U.organiser2,
    event_date: "2027-04-12", start_time: "18:00", end_time: "20:00", expected_attendance: 120,
  }),
  event(E.underReview, "UNDER_REVIEW", {
    name: "Youth Coding Workshop",
    event_date: "2027-04-05", start_time: "10:00", end_time: "16:00", expected_attendance: 30,
    coordinator_id: U.coordinator, assigned_at: ASSIGNED,
    open_clarification_id: "clarification-under-review",
  }),
  event(E.approved, "APPROVED", {
    name: "Harbour Arts Showcase",
    event_date: "2027-03-22", start_time: "14:00", end_time: "17:00", expected_attendance: 150,
    coordinator_id: U.coordinator, assigned_at: ASSIGNED,
  }),
  event(E.planning, "PLANNING", {
    name: "Startup Pitch Night",
    event_date: "2027-03-10", start_time: "18:00", end_time: "21:00", expected_attendance: 35,
    equipment_required: true,
    coordinator_id: U.coordinator, assigned_at: ASSIGNED,
  }),
  event(E.safetyReview, "SAFETY_REVIEW", {
    name: "Community Food Fair", organiser_id: U.organiser2, created_by: U.organiser2,
    event_date: "2027-02-27", start_time: "10:00", end_time: "18:00", expected_attendance: 400,
    equipment_required: true,
    coordinator_id: U.coordinator2, assigned_at: ASSIGNED,
    approved_venue_booking_id: "booking-safety-review-garden-c",
    safety_review_requested_at: sgt("2027-01-20", "09:00"),
  }),
  event(E.confirmed, "CONFIRMED", {
    name: "Leadership Talk",
    event_date: "2027-03-15", start_time: "09:00", end_time: "12:00", expected_attendance: 30,
    registration_required: true, registration_capacity: 2,
    registration_open_date: "2027-01-04", registration_open_time: "09:00",
    registration_close_date: "2027-03-12", registration_close_time: "17:00",
    coordinator_id: U.coordinator, assigned_at: ASSIGNED,
    approved_venue_booking_id: "booking-confirmed-room-b",
    safety_review_requested_at: sgt("2027-01-10", "09:00"),
    last_safety_review_id: "safety-review-confirmed",
    confirmed_at: sgt("2027-01-11", "11:00"),
  }),
  event(E.completed, "COMPLETED", {
    name: "Autumn Networking Evening",
    event_date: "2026-10-15", start_time: "18:00", end_time: "21:00", expected_attendance: 80,
    submitted_at: sgt("2026-08-01", "10:00"), created_at: sgt("2026-08-01", "09:00"),
    coordinator_id: U.coordinator2, assigned_at: sgt("2026-08-02", "10:00"),
    approved_venue_booking_id: "booking-completed-hall-a",
    completed_at: sgt("2026-10-16", "09:00"),
  }),
  event(E.cancelled, "CANCELLED", {
    name: "Winter Craft Market",
    event_date: "2027-01-30", start_time: "10:00", end_time: "16:00", expected_attendance: 60,
    coordinator_id: U.coordinator, assigned_at: ASSIGNED,
    cancellation_reason: "Organiser could not secure vendors.",
    cancelled_at: sgt("2026-12-10", "15:00"),
  }),
  event(E.rejected, "REJECTED", {
    name: "Late-night Drone Show", organiser_id: U.organiser2, created_by: U.organiser2,
    event_date: "2027-02-14", start_time: "23:00", end_time: "23:59", expected_attendance: 300,
    coordinator_id: U.coordinator2, assigned_at: ASSIGNED,
  }),
];

const requirement = (eventId, location, layout, facilities, accessibility) => [
  {
    path: `event_venue_requirements/${eventId}`,
    data: {
      event_id: eventId, preferred_location: location, required_layout: layout,
      facilities_required: facilities.length > 0, accessibility_needed: accessibility.length > 0,
      accessibility_notes: "",
    },
  },
  ...facilities.map((facility) => ({
    path: `event_facilities/${eventId}_${facility}`, data: { event_id: eventId, facility_id: facility },
  })),
  ...accessibility.map((need) => ({
    path: `event_accessibility/${eventId}_${need}`, data: { event_id: eventId, accessibility_id: need },
  })),
];

const eventRequirements = () => [
  ...requirement(E.submitted, "CENTRAL", "THEATRE", ["WIFI"], []),
  ...requirement(E.underReview, "MARINA_BAY_SANDS", "CLASSROOM", ["WIFI", "POWER_POINTS"], ["WHEELCHAIR_ACCESS"]),
  ...requirement(E.approved, "MARINA_BAY_SANDS", "THEATRE", ["STAGE", "WIFI"], ["WHEELCHAIR_ACCESS"]),
  ...requirement(E.planning, "MARINA_BAY_SANDS", "BOARDROOM", ["WIFI", "POWER_POINTS"], []),
  ...requirement(E.safetyReview, "FORT_CANNING", "OPEN_SPACE", ["TOILETS", "LOADING_AREA"], ["STEP_FREE_ACCESS"]),
  ...requirement(E.confirmed, "MARINA_BAY_SANDS", "CLASSROOM", ["WIFI"], ["LIFT"]),
];

const eventEquipment = () => [
  { path: `event_equipment/${E.planning}_0`, data: { event_id: E.planning, equipment_type: "AUDIO", quantity: 2, technical_note: "Two handheld mics." } },
  { path: `event_equipment/${E.planning}_1`, data: { event_id: E.planning, equipment_type: "VISUAL", quantity: 1, technical_note: "Projector for slides." } },
  { path: `event_equipment/${E.safetyReview}_0`, data: { event_id: E.safetyReview, equipment_type: "FURNITURE", quantity: 40, technical_note: null } },
];

// ---------------------------------------------------------------------------------------------
// Venue bookings — occupied window = start − setup to end + turnaround (E9/F9)
// ---------------------------------------------------------------------------------------------

const booking = (id, eventId, venueId, date, start, end, status, attendance, extra = {}) => {
  const venue = VENUES[venueId];
  const startTs = sgt(date, start);
  const endTs = sgt(date, end);
  return {
    path: `venue_bookings/${id}`,
    data: {
      booking_id: id,
      event_id: eventId,
      venue_id: venueId,
      event_name: null, // filled below from the event
      event_reference_no: null,
      event_purpose: "Community engagement",
      event_description: "Seeded test event.",
      registration_required: false,
      assigned_staff_id: status === "PENDING" ? null : VENUE_STAFF[venueId],
      start_datetime: startTs,
      end_datetime: endTs,
      occupied_start: minutes(startTs, -venue.setup_minutes),
      occupied_end: minutes(endTs, venue.turnaround_minutes),
      expected_attendance: attendance,
      status,
      decision_reason: null,
      requested_layout_id: venue.layouts[0],
      layout_snapshot: venue.layouts[0],
      required_facilities_snapshot: [],
      booking_label: `${venue.name} booking`,
      submitted_at: sgt("2027-01-05", "10:00"),
      decided_at: null,
      decided_by: null,
      released_at: null,
      release_reason: null,
      requires_re_request: false,
      replacement_needed: false,
      replacement_for_booking_id: null,
      replacement_original_venue_id: null,
      replacement_original_label: null,
      replacement_reason: null,
      replaced_by_booking_id: null,
      replaced_at: null,
      safety_review_required: false,
      suitability_acknowledgement: { acknowledged: false, criteria: [], missing: {}, acknowledged_by: null, acknowledged_at: null },
      requested_by: U.coordinator,
      ...extra,
    },
  };
};

const approved = (staff) => ({ decided_by: staff, decided_at: sgt("2027-01-06", "11:00") });

const venueBookings = () => {
  const list = [
    // PLANNING: one pending request, and one tentative hold (expires 3 working days after it was placed).
    booking("booking-planning-room-b", E.planning, V.roomB, "2027-03-10", "18:00", "21:00", "PENDING", 35),
    booking("booking-planning-hall-a", E.planning, V.hallA, "2027-03-10", "18:00", "21:00", "HELD", 35, {
      held_by: U.venueStaff, held_at: sgt("2027-02-01", "10:00"), hold_expires_at: sgt("2027-02-04", "10:00"),
    }),
    booking("booking-safety-review-garden-c", E.safetyReview, V.gardenC, "2027-02-27", "10:00", "18:00", "APPROVED", 400, {
      ...approved(U.venueStaff2), requested_by: U.coordinator2,
    }),
    booking("booking-confirmed-room-b", E.confirmed, V.roomB, "2027-03-15", "09:00", "12:00", "APPROVED", 30, {
      ...approved(U.venueStaff), registration_required: true,
    }),
    booking("booking-completed-hall-a", E.completed, V.hallA, "2026-10-15", "18:00", "21:00", "APPROVED", 80, {
      decided_by: U.venueStaff, decided_at: sgt("2026-08-10", "11:00"), requested_by: U.coordinator2,
    }),
    // A rejected request on the cancelled event — rejections cannot be overridden.
    booking("booking-cancelled-hall-a", E.cancelled, V.hallA, "2027-01-30", "10:00", "16:00", "REJECTED", 60, {
      decision_reason: "Hall closed for a private function.", decided_by: U.venueStaff,
      decided_at: sgt("2026-12-05", "11:00"), requires_re_request: true,
    }),
  ];
  const byId = Object.fromEntries(events().map(({ data }) => [data.event_id, data]));
  for (const { data } of list) {
    data.event_name = byId[data.event_id].name;
    data.event_reference_no = byId[data.event_id].reference_no;
  }
  return list;
};

// ---------------------------------------------------------------------------------------------
// Equipment requests and reservations
// ---------------------------------------------------------------------------------------------

const equipmentRequests = () => {
  const byId = Object.fromEntries(events().map(({ data }) => [data.event_id, data]));
  const request = (eventId, coordinatorId, status, lines) => {
    const ev = byId[eventId];
    return {
      path: `equipment_requests/${eventId}`,
      data: {
        request_id: eventId, event_id: eventId, coordinator_id: coordinatorId,
        event_name: ev.name, reference_no: ev.reference_no, event_date: ev.event_date,
        start_time: ev.start_time, end_time: ev.end_time, expected_attendance: ev.expected_attendance,
        lines, on_site_support: false, on_site_support_details: "",
        status, has_support_decisions: status !== "PENDING",
        submitted_at: sgt("2027-01-07", "10:00"), created_at: sgt("2027-01-07", "10:00"), updated_at: sgt("2027-01-07", "10:00"),
      },
    };
  };
  return [
    request(E.planning, U.coordinator, "PENDING", [
      { equipment_type: "AUDIO", quantity: 2, technical_requirements: "Two handheld mics.", fulfillment_status: "PENDING" },
      { equipment_type: "VISUAL", quantity: 1, technical_requirements: "Projector for slides.", fulfillment_status: "PENDING" },
    ]),
    request(E.safetyReview, U.coordinator2, "ARRANGED", [
      { equipment_type: "FURNITURE", quantity: 40, technical_requirements: "", fulfillment_status: "RESERVED",
        reservation_id: "reservation-safety-review-furniture", fulfilled_at: sgt("2027-01-08", "10:00"), fulfilled_by: U.techSupport },
    ]),
  ];
};

const equipmentReservations = () => {
  const garden = VENUES[V.gardenC];
  return [{
    path: "equipment_reservations/reservation-safety-review-furniture",
    data: {
      reservation_id: "reservation-safety-review-furniture", event_id: E.safetyReview,
      equipment_type: "FURNITURE", quantity: 40, line_index: 0,
      start_datetime: minutes(sgt("2027-02-27", "10:00"), -garden.setup_minutes),
      end_datetime: minutes(sgt("2027-02-27", "18:00"), garden.turnaround_minutes),
      status: "RESERVED", reserved_by: U.techSupport,
      created_at: sgt("2027-01-08", "10:00"), updated_at: sgt("2027-01-08", "10:00"),
      released_at: null, released_by: null, release_reason: null,
    },
  }];
};

// ---------------------------------------------------------------------------------------------
// Review workflow records
// ---------------------------------------------------------------------------------------------

const ASSIGNED_EVENTS = [
  [E.underReview, U.coordinator], [E.approved, U.coordinator], [E.planning, U.coordinator],
  [E.safetyReview, U.coordinator2], [E.confirmed, U.coordinator], [E.completed, U.coordinator2],
  [E.cancelled, U.coordinator], [E.rejected, U.coordinator2],
];

const coordinatorAssignments = () => ASSIGNED_EVENTS.map(([eventId, coordinatorId]) => ({
  path: `coordinator_assignments/${eventId}_${coordinatorId}`,
  data: { assignment_id: `${eventId}_${coordinatorId}`, event_id: eventId, coordinator_id: coordinatorId, assigned_at: ASSIGNED, ended_at: null },
}));

const clarifications = () => [
  {
    path: "clarification_requests/clarification-under-review",
    data: {
      clarification_id: "clarification-under-review", event_id: E.underReview, created_by: U.coordinator,
      message: "How many laptops will participants bring?", status: "OPEN",
      created_at: sgt("2026-12-04", "10:00"), responded_at: null,
    },
  },
];

const changeRequests = () => [
  {
    path: "change_requests/change-request-planning",
    data: {
      change_request_id: "change-request-planning", event_id: E.planning, event_name: "Startup Pitch Night",
      reference_no: events().find(({ data }) => data.event_id === E.planning).data.reference_no,
      organiser_id: U.organiser, coordinator_id: U.coordinator, event_status: "PLANNING",
      changes: { expected_attendance: { old_value: 35, new_value: 38 } },
      reason: "Three more founders confirmed.", status: "PENDING", created_at: sgt("2027-01-09", "10:00"),
    },
  },
];

const safetyReviews = () => [
  {
    path: "safety_reviews/safety-review-confirmed",
    data: {
      review_id: "safety-review-confirmed", event_id: E.confirmed, reviewer_id: U.safetyOfficer,
      outcome: "APPROVE", comment: null, decided_at: sgt("2027-01-11", "11:00"),
    },
  },
];

const eventHistory = () => [
  ["history-submitted-submitted", E.submitted, U.organiser2, "EVENT_SUBMITTED", "Event submitted."],
  ["history-under-review-assigned", E.underReview, U.lead, "COORDINATOR_ASSIGNED", "Coordinator One assigned."],
  ["history-under-review-clarification", E.underReview, U.coordinator, "CLARIFICATION_REQUESTED", "Asked about laptops."],
  ["history-approved-approved", E.approved, U.coordinator, "EVENT_APPROVED", "Event approved."],
  ["history-confirmed-safety", E.confirmed, U.safetyOfficer, "SAFETY_CHECK_APPROVED", "Safety check passed."],
  ["history-cancelled-cancelled", E.cancelled, U.organiser, "EVENT_CANCELLED", "Cancelled by organiser."],
  ["history-rejected-rejected", E.rejected, U.coordinator2, "EVENT_REJECTED", "Outside venue operating hours."],
].map(([id, eventId, actor, action, description]) => ({
  path: `event_history/${id}`,
  data: {
    history_id: id, event_id: eventId, actor_id: actor, action_type: action,
    field_name: null, old_value: null, new_value: null, description, created_at: sgt("2026-12-05", "10:00"),
  },
}));

// ---------------------------------------------------------------------------------------------
// Registrations — the confirmed event is full (capacity 2), so the third attendee is waitlisted
// ---------------------------------------------------------------------------------------------

const registration = (attendeeId, status, at) => ({
  path: `registrations/${E.confirmed}_${attendeeId}`,
  data: {
    registration_id: `${E.confirmed}_${attendeeId}`, event_id: E.confirmed, attendee_id: attendeeId, status,
    registered_at: status === "REGISTERED" ? at : null,
    waitlisted_at: status === "WAITLISTED" ? at : null,
    waitlist_position: null,
    withdrawn_at: null,
  },
});

const registrations = () => [
  registration(U.attendee, "REGISTERED", sgt("2027-01-04", "09:05")),
  registration(U.attendee2, "REGISTERED", sgt("2027-01-04", "09:10")),
  registration(U.attendee3, "WAITLISTED", sgt("2027-01-04", "09:20")),
];

// ---------------------------------------------------------------------------------------------
// Notifications — one unread and one read, so both states can be tested
// ---------------------------------------------------------------------------------------------

const notification = (id, userId, eventId, type, message, readAt = null) => ({
  path: `notifications/${id}`,
  data: {
    notification_id: id, user_id: userId, event_id: eventId, type, message,
    is_read: readAt !== null, created_at: sgt("2026-12-05", "10:00"), read_at: readAt,
  },
});

const notifications = () => [
  notification("notification-lead-unassigned", U.lead, E.submitted, "UNASSIGNED_EVENT", "A new event is waiting to be assigned."),
  notification("notification-coordinator-assigned", U.coordinator, E.underReview, "COORDINATOR_ASSIGNED", "You have been assigned Youth Coding Workshop.", sgt("2026-12-03", "12:00")),
  notification("notification-staff-booking", U.venueStaff, E.planning, "VENUE_BOOKING_REQUESTED", "Room B requested for Startup Pitch Night."),
  notification("notification-organiser-confirmed", U.organiser, E.confirmed, "EVENT_APPROVED", "Leadership Talk was approved."),
];

// ---------------------------------------------------------------------------------------------

export function baseline() {
  return [
    ...users(),
    ...venues(),
    ...venueUnavailability(),
    ...equipmentInventory(),
    ...events(),
    ...eventRequirements(),
    ...eventEquipment(),
    ...venueBookings(),
    ...equipmentRequests(),
    ...equipmentReservations(),
    ...coordinatorAssignments(),
    ...clarifications(),
    ...changeRequests(),
    ...safetyReviews(),
    ...eventHistory(),
    ...registrations(),
    ...notifications(),
  ];
}
