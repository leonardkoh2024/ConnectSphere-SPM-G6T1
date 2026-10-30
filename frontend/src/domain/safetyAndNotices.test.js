// L1 / SCRUM-187, L2 / SCRUM-188, L3 / SCRUM-189, L4 / SCRUM-190 — the safety check
// rules in domain/safetyAndNotices.js — plus the J7 / J8 / J9 notice helpers that live
// in the same module. These replace the L1–L4 suites that used to sit in the root
// test.js. The multi-venue readiness cases (F11/F13 for L1) stay in
// safetyAndNotices.multiVenue.test.js.

const {
  REVIEW_REQUIRED,
  outstandingForSafetyCheck,
  sendForSafetyCheck,
  safetyReviewQueue,
  recordSafetyOutcome,
  attendeeChangeNotices,
  unassignedQueue,
  eventEnteredUnassignedQueue,
  openLeadAssignmentNotice,
  cancelUnassignedEvent,
  cancelSafetyReview,
  openSafetyReviewNotice
} = require("./safetyAndNotices");

const planningEvent = {
  event_id: "EVT-001",
  name: "Partner Summit",
  status: "PLANNING",
  coordinator_id: "USR-COORD-001",
  organiser_id: "USR-ORG-001",
  event_date: "2026-11-20",
  expected_attendance: 80
};
const approvedBooking = {
  booking_id: "VB-001", event_id: "EVT-001", venue_id: "VEN-001", venue_name: "Main Hall", status: "APPROVED"
};
const officers = [
  { user_id: "USR-SAFE-001", role: "SAFETY_OFFICER", active: true },
  { user_id: "USR-SAFE-002", role: "SAFETY_OFFICER", active: false },
  { user_id: "USR-COORD-009", role: "EVENT_COORDINATOR", active: true },
  { role: "SAFETY_OFFICER", active: true }
];
const inReview = { ...planningEvent, status: "SAFETY_REVIEW" };

describe("L1 / SCRUM-187 send an event for its safety check", () => {
  describe("normal", () => {
    test("TC-2429 AC1 every active booking approved and no technical arrangement requested makes the event sendable", () => {
      const result = sendForSafetyCheck({
        event: planningEvent,
        bookings: [approvedBooking, { booking_id: "VB-OLD", event_id: "EVT-001", status: "RELEASED" }],
        technicalArrangements: [],
        safetyOfficers: officers
      });
      expect(result.ok).toBe(true);
      expect(result.outstanding).toEqual([]);
    });

    test("TC-2430 AC1 a requested arrangement must be confirmed; one marked not requested does not block", () => {
      expect(sendForSafetyCheck({
        event: planningEvent,
        bookings: [approvedBooking],
        technicalArrangements: [
          { arrangement_id: "TA-001", label: "Sound", status: "confirmed" },
          { arrangement_id: "TA-002", label: "Lighting", status: "PENDING", requested: false }
        ]
      }).ok).toBe(true);
    });

    test("TC-2431 AC3 sending moves the event to Safety Review, stamps the time and notifies each active Safety Officer", () => {
      const result = sendForSafetyCheck({
        event: planningEvent, bookings: [approvedBooking], safetyOfficers: officers, now: "2026-10-26T02:00:00.000Z"
      });
      expect(result.event).toMatchObject({ status: "SAFETY_REVIEW", safety_review_requested_at: "2026-10-26T02:00:00.000Z" });
      expect(result.notifications).toEqual([{
        user_id: "USR-SAFE-001",
        event_id: "EVT-001",
        type: "SAFETY_REVIEW_WAITING",
        message: "Partner Summit on 2026-11-20 at Main Hall for 80 is waiting for its safety check.",
        is_read: false,
        link: { screen: "Safety review", event_id: "EVT-001" },
        checked_before: false
      }]);
    });

    test("TC-2432 AC3 an event checked before says so in the Safety Officer's notice", () => {
      const afterReturn = sendForSafetyCheck({
        event: { ...planningEvent, returned_to_planning_at: "2026-10-20T00:00:00.000Z" },
        bookings: [approvedBooking],
        safetyOfficers: officers
      });
      expect(afterReturn.notifications[0]).toMatchObject({ checked_before: true, message: expect.stringMatching(/checked before\.$/) });
      const withHistory = sendForSafetyCheck({
        event: planningEvent, bookings: [approvedBooking], safetyOfficers: officers, previousReviews: [{ outcome: "REJECT" }]
      });
      expect(withHistory.notifications[0].checked_before).toBe(true);
    });
  });

  describe("boundary", () => {
    test("TC-2434 AC1 an Approved event (not yet Planning) may also be sent", () => {
      expect(sendForSafetyCheck({ event: { ...planningEvent, status: "APPROVED" }, bookings: [approvedBooking] }).ok).toBe(true);
    });

    test("TC-2435 AC3 the notice reads sensibly when name, date, venue and attendance were never recorded", () => {
      const result = sendForSafetyCheck({
        event: { event_id: "EVT-X", status: "PLANNING" },
        bookings: [{ status: "APPROVED" }],
        safetyOfficers: officers
      });
      expect(result.notifications[0].message)
        .toBe("An event on a date not recorded at no venue for an unrecorded number is waiting for its safety check.");
    });

    test("TC-2436 AC3 a venue is named by its id when it has no name, and each venue is named once", () => {
      const result = sendForSafetyCheck({
        event: { ...planningEvent, expected_attendance: 0 },
        bookings: [{ venue_id: "VEN-9", status: "APPROVED" }, { venue_id: "VEN-9", status: "APPROVED" }],
        safetyOfficers: officers
      });
      expect(result.notifications[0].message).toBe("Partner Summit on 2026-11-20 at VEN-9 for 0 is waiting for its safety check.");
    });

    test("TC-2437 AC3 with no Safety Officer on record the event still moves, with no notices", () => {
      const result = sendForSafetyCheck({ event: planningEvent, bookings: [approvedBooking] });
      expect(result.ok).toBe(true);
      expect(result.notifications).toEqual([]);
      expect(result.event.safety_review_requested_at).toBe("SERVER_TIMESTAMP");
    });

    test("TC-2439 AC2 outstanding items are labelled by the best name each record has", () => {
      expect(outstandingForSafetyCheck({
        bookings: [
          { booking_label: "Breakout", status: "PENDING" },
          { venue_name: "Annex", status: "PENDING" },
          { booking_id: "VB-7", status: "PENDING" },
          { venue_id: "VEN-8", status: "PENDING" },
          { status: "PENDING" },
          { status: "REJECTED", replacement_needed: true, booking_label: "Lost room" },
          { booking_label: "No status yet" }
        ],
        technicalArrangements: [
          { arrangement_id: "TA-9", status: "PENDING" },
          { status: "PENDING" },
          { label: "Unstarted" }
        ]
      })).toEqual(["Breakout", "Annex", "VB-7", "VEN-8", "venue booking", "Lost room", "No status yet", "TA-9", "technical arrangement", "Unstarted"]);
      expect(outstandingForSafetyCheck()).toEqual(["an approved venue booking"]);
    });
  });

  describe("conflict", () => {
    test("TC-2440 AC1 an event in the wrong status cannot be sent", () => {
      ["SUBMITTED", "SAFETY_REVIEW", "CONFIRMED", "CANCELLED"].forEach((status) => {
        const event = { ...planningEvent, status };
        expect(sendForSafetyCheck({ event, bookings: [approvedBooking] })).toEqual({ ok: false, reason: "status", event });
      });
    });

    test("TC-2441 AC2 a pending booking or an unconfirmed arrangement keeps the event in Planning and is named", () => {
      const result = sendForSafetyCheck({
        event: planningEvent,
        bookings: [{ ...approvedBooking, status: "PENDING", venue_name: "Breakout" }],
        technicalArrangements: [{ arrangement_id: "TA-001", label: "Sound", status: "PENDING" }],
        safetyOfficers: officers
      });
      expect(result).toMatchObject({ ok: false, reason: "outstanding", outstanding: ["Breakout", "Sound"] });
      expect(result.event.status).toBe("PLANNING");
      expect(result.notifications).toBeUndefined();
    });
  });

  describe("failure", () => {
    test("TC-2443 a missing event is refused rather than sent", () => {
      expect(sendForSafetyCheck()).toEqual({ ok: false, reason: "required" });
      expect(sendForSafetyCheck({ bookings: [approvedBooking] })).toEqual({ ok: false, reason: "required" });
    });
  });
});

describe("L2 / SCRUM-188 review an event's operational safety", () => {
  const waiting = (id, requestedAt, fields = {}) => ({
    event_id: id,
    name: id,
    status: "SAFETY_REVIEW",
    event_date: "2026-11-20",
    venues: ["Main Hall"],
    expected_attendance: 80,
    safety_review_requested_at: requestedAt,
    ...fields
  });

  describe("normal", () => {
    test("TC-2453 AC1 the queue holds Safety Review events only, oldest first, with name, date, venues and attendance", () => {
      const queue = safetyReviewQueue([
        waiting("EVT-NEW", "2026-10-12T00:00:00.000Z", { name: "Later Forum" }),
        { event_id: "EVT-PLAN", name: "Still planning", status: "PLANNING", safety_review_requested_at: "2026-10-01T00:00:00.000Z" },
        waiting("EVT-OLD", "2026-10-10T00:00:00.000Z", { name: "Earlier Forum", venues: ["Main Hall", "Annex"], expected_attendance: 40 })
      ]);
      expect(queue).toEqual([
        { event_id: "EVT-OLD", name: "Earlier Forum", date: "2026-11-20", venues: ["Main Hall", "Annex"], expected_attendance: 40 },
        { event_id: "EVT-NEW", name: "Later Forum", date: "2026-11-20", venues: ["Main Hall"], expected_attendance: 80 }
      ]);
    });
  });

  describe("boundary", () => {
    test("TC-2455 AC1 an event without a send time waits from its last change; missing details read as empty", () => {
      const queue = safetyReviewQueue([
        { event_id: "EVT-B", status: "SAFETY_REVIEW", updated_at: "2026-10-11T00:00:00.000Z" },
        { event_id: "EVT-A", status: "SAFETY_REVIEW" }
      ]);
      expect(queue).toEqual([
        { event_id: "EVT-A", name: "Untitled event", date: null, venues: [], expected_attendance: null },
        { event_id: "EVT-B", name: "Untitled event", date: null, venues: [], expected_attendance: null }
      ]);
      expect(safetyReviewQueue()).toEqual([]);
    });
  });
});

describe("L3 / SCRUM-189 record the outcome of a safety check", () => {
  const record = (overrides = {}) => recordSafetyOutcome({
    event: inReview, outcome: "APPROVE", officerId: "USR-SAFE-001", now: "2026-10-26T03:00:00.000Z", ...overrides
  });

  describe("normal", () => {
    test("TC-2468 AC1 Approve, Reject and Request changes are each accepted", () => {
      expect(record().review.outcome).toBe("APPROVE");
      expect(record({ outcome: "REJECT", comment: "Exit blocked." }).review.outcome).toBe("REJECT");
      expect(record({ outcome: "REQUEST_CHANGES", comment: "Move the stage.", marked: ["venue"] }).review.outcome).toBe("REQUEST_CHANGES");
    });

    test("TC-2469 AC3 the outcome, trimmed comment, officer and time go on the review and the event history", () => {
      const result = record({ outcome: "REJECT", comment: " Exit blocked. " });
      const expected = {
        event_id: "EVT-001", outcome: "REJECT", comment: "Exit blocked.", safety_officer_id: "USR-SAFE-001", decided_at: "2026-10-26T03:00:00.000Z"
      };
      expect(result.review).toEqual(expected);
      expect(result.history).toEqual({ ...expected, record: "event_history" });
    });

    test("TC-2470 AC4 Approve confirms the event and notifies the coordinator and the organiser", () => {
      const result = record();
      expect(result.event).toMatchObject({ status: "CONFIRMED", last_safety_review_id: "2026-10-26T03:00:00.000Z" });
      expect(result.notifications.map((notice) => notice.user_id)).toEqual(["USR-COORD-001", "USR-ORG-001"]);
      expect(result.notifications[0]).toMatchObject({
        type: "SAFETY_CHECK_APPROVED", message: "Partner Summit passed its safety check and is now Confirmed.", is_read: false
      });
    });
  });

  describe("boundary", () => {
    test("TC-2471 AC2 AC4 Approve needs no comment, and with no organiser only the coordinator is told", () => {
      const result = record({ event: { ...inReview, organiser_id: undefined, name: undefined }, comment: null, now: undefined });
      expect(result.review).toMatchObject({ comment: "", decided_at: "SERVER_TIMESTAMP" });
      expect(result.notifications).toEqual([expect.objectContaining({
        user_id: "USR-COORD-001", message: "Your event passed its safety check and is now Confirmed."
      })]);
    });
  });

  describe("conflict", () => {
    test("TC-2472 AC5 no outcome can be recorded once the event has left Safety Review", () => {
      ["PLANNING", "CONFIRMED", "CANCELLED"].forEach((status) => {
        const event = { ...inReview, status };
        expect(record({ event })).toEqual({ ok: false, reason: "not_in_review", event });
      });
    });
  });

  describe("failure", () => {
    test("TC-2473 AC1 any other outcome is refused", () => {
      expect(record({ outcome: "CONFIRM" })).toEqual({ ok: false, reason: "outcome" });
      expect(record({ outcome: undefined })).toEqual({ ok: false, reason: "outcome" });
    });

    test("TC-2474 AC2 Reject and Request changes without a comment are refused", () => {
      expect(record({ outcome: "REJECT", comment: "  " })).toMatchObject({ ok: false, reason: "comment_required" });
      expect(record({ outcome: "REQUEST_CHANGES" })).toMatchObject({ ok: false, reason: "comment_required" });
    });

    test("TC-2475 a missing event is refused", () => {
      expect(recordSafetyOutcome()).toEqual({ ok: false, reason: "required" });
      expect(recordSafetyOutcome({ outcome: "APPROVE" })).toEqual({ ok: false, reason: "required" });
    });
  });
});

describe("L4 / SCRUM-190 return an event to planning after a safety concern", () => {
  const bookings = [
    { booking_id: "VB-001", event_id: "EVT-001", status: "APPROVED", assigned_staff_id: "USR-VENUE-001", venue_name: "Main Hall" },
    { booking_id: "VB-OLD", event_id: "EVT-001", status: "RELEASED", assigned_staff_id: "USR-VENUE-002", venue_name: "Old Hall" }
  ];
  const technical = [
    { arrangement_id: "TA-001", label: "Sound", status: "CONFIRMED", assigned_staff_id: "USR-TECH-001" },
    { arrangement_id: "TA-002", label: "Spare", status: "PENDING", requested: false, assigned_staff_id: "USR-TECH-002" }
  ];
  const concern = (overrides = {}) => recordSafetyOutcome({
    event: inReview,
    outcome: "REQUEST_CHANGES",
    comment: "Move the stage.",
    marked: ["venue"],
    officerId: "USR-SAFE-001",
    bookings,
    technicalArrangements: technical,
    now: "2026-10-26T04:00:00.000Z",
    ...overrides
  });

  describe("normal", () => {
    test("TC-2478 AC1 Request changes returns the event to Planning and tells the coordinator the comment", () => {
      const result = concern();
      expect(result.event).toMatchObject({
        status: "PLANNING", returned_to_planning_at: "2026-10-26T04:00:00.000Z", last_safety_review_id: "2026-10-26T04:00:00.000Z"
      });
      expect(result.notifications[0]).toEqual({
        user_id: "USR-COORD-001",
        event_id: "EVT-001",
        type: "SAFETY_CHANGES_REQUESTED",
        message: "Partner Summit is back in Planning. Comment: Move the stage.",
        is_read: false
      });
    });

    test("TC-2479 AC1 AC2 Reject returns the event to Planning and flags every venue and technical arrangement", () => {
      const result = concern({ outcome: "REJECT", comment: "Exit blocked.", marked: [] });
      expect(result.event.status).toBe("PLANNING");
      expect(result.notifications[0].type).toBe("SAFETY_CHECK_REJECTED");
      expect(result.bookings[0].review_status).toBe(REVIEW_REQUIRED);
      expect(result.technicalArrangements[0].review_status).toBe(REVIEW_REQUIRED);
    });

    test("TC-2480 AC2 AC3 only the marked arrangement is flagged and its staff told; the rest keep their approval", () => {
      const result = concern({ marked: ["technical"] });
      expect(result.bookings[0]).toEqual(bookings[0]);
      expect(result.technicalArrangements[0]).toEqual({ ...technical[0], review_status: REVIEW_REQUIRED });
      const staff = result.notifications.filter((notice) => notice.type === "ARRANGEMENT_REVIEW_REQUIRED");
      expect(staff).toEqual([{
        user_id: "USR-TECH-001",
        role: "TECHNICAL_SUPPORT_STAFF",
        event_id: "EVT-001",
        type: "ARRANGEMENT_REVIEW_REQUIRED",
        message: `Partner Summit: Sound is marked ${REVIEW_REQUIRED}. Move the stage.`,
        is_read: false
      }]);

      const venueOnly = concern({ marked: ["venue"] });
      expect(venueOnly.technicalArrangements[0].review_status).toBeUndefined();
      expect(venueOnly.notifications.filter((notice) => notice.type === "ARRANGEMENT_REVIEW_REQUIRED"))
        .toEqual([expect.objectContaining({ user_id: "USR-VENUE-001", role: "VENUE_STAFF", message: expect.stringMatching(/^Partner Summit: Main Hall is marked/) })]);
    });

    test("TC-2481 AC2 Request changes marked both flags venue and technical", () => {
      const result = concern({ marked: ["both"] });
      expect(result.bookings[0].review_status).toBe(REVIEW_REQUIRED);
      expect(result.technicalArrangements[0].review_status).toBe(REVIEW_REQUIRED);
    });

    test("TC-2482 AC4 once every flag is cleared a new check may be sent", () => {
      const returned = concern().event;
      expect(sendForSafetyCheck({ event: returned, bookings: [bookings[0]], technicalArrangements: [technical[0]] }).ok).toBe(true);
    });
  });

  describe("boundary", () => {
    test("TC-2483 AC2 inactive bookings and unrequested arrangements are never flagged", () => {
      const result = concern({ outcome: "REJECT", comment: "Exit blocked." });
      expect(result.bookings[1].review_status).toBeUndefined();
      expect(result.technicalArrangements[1].review_status).toBeUndefined();
      expect(result.notifications.map((notice) => notice.user_id)).toEqual(["USR-COORD-001", "USR-VENUE-001", "USR-TECH-001"]);
    });

    test("TC-2484 AC2 Request changes with nothing (or nothing known) marked flags nothing", () => {
      [[], ["catering"], undefined].forEach((marked) => {
        const result = concern({ marked });
        expect(result.bookings.some((booking) => booking.review_status)).toBe(false);
        expect(result.technicalArrangements.some((item) => item.review_status)).toBe(false);
      });
    });

    test("TC-2485 AC1 an unnamed event's return notice still names it plainly", () => {
      expect(concern({ event: { ...inReview, name: undefined } }).notifications[0].message)
        .toBe("Your event is back in Planning. Comment: Move the stage.");
    });

    test("TC-2486 AC3 a flagged arrangement with no assigned staff, and an unnamed event, still read sensibly", () => {
      const result = concern({
        event: { ...inReview, name: undefined, coordinator_id: undefined },
        marked: ["both"],
        bookings: [{ booking_id: "VB-9", status: "APPROVED" }, { booking_id: "VB-10", assigned_staff_id: "USR-VENUE-003" }],
        technicalArrangements: [{ status: "CONFIRMED", assigned_staff_id: "USR-TECH-003" }],
        now: undefined
      });
      expect(result.event.returned_to_planning_at).toBe("SERVER_TIMESTAMP");
      expect(result.bookings.map((booking) => booking.review_status)).toEqual([REVIEW_REQUIRED, REVIEW_REQUIRED]);
      expect(result.notifications.map((notice) => [notice.user_id, notice.message])).toEqual([
        ["USR-VENUE-003", `An event: VB-10 is marked ${REVIEW_REQUIRED}. Move the stage.`],
        ["USR-TECH-003", `An event: technical arrangement is marked ${REVIEW_REQUIRED}. Move the stage.`]
      ]);
    });
  });

  describe("conflict", () => {
    test("TC-2487 AC4 a new check is refused while any arrangement is still marked for review", () => {
      const returned = concern({ marked: ["both"] });
      const blocked = sendForSafetyCheck({
        event: returned.event, bookings: returned.bookings, technicalArrangements: returned.technicalArrangements
      });
      expect(blocked).toMatchObject({
        ok: false, reason: "outstanding", outstanding: ["Main Hall still needs review", "Sound still needs review"]
      });
    });
  });
});

describe("J7 / SCRUM-156 attendee change notices", () => {
  const attendees = [
    { user_id: "A1", status: "REGISTERED" },
    { user_id: "A2", status: "WAITLISTED" },
    { user_id: "A3", status: "WITHDRAWN" }
  ];
  const event = { event_id: "EVT-001", name: "Partner Summit" };

  test("TC-2239 [normal] each change kind tells registered attendees, and a freed place invites the waiting list", () => {
    expect(attendeeChangeNotices({ event, attendees, change: { kind: "DATE", detail: " 21 Nov " } })).toEqual([{
      user_id: "A1", event_id: "EVT-001", type: "DATE", message: "Partner Summit: the date changed to 21 Nov.", is_read: false
    }]);
    expect(attendeeChangeNotices({ event, attendees, change: { kind: "TIME", detail: "10:00" } })[0].message).toBe("Partner Summit: the time changed to 10:00.");
    expect(attendeeChangeNotices({ event, attendees, change: { kind: "VENUE", detail: "Annex" } })[0].message).toBe("Partner Summit: the venue changed to Annex.");
    expect(attendeeChangeNotices({ event, attendees, change: { kind: "CANCELLED" } })[0].message).toBe("Partner Summit was cancelled.");
    expect(attendeeChangeNotices({ event, attendees, change: { kind: "REGISTRATION_CONFIRMED" } })[0].message).toBe("Partner Summit: your registration is confirmed.");
    const invited = attendeeChangeNotices({ event, attendees, change: { kind: "PLACE_OPENED" } });
    expect(invited).toEqual([expect.objectContaining({ user_id: "A2", message: "Partner Summit: a place has opened and you are invited to apply." })]);
  });

  test("TC-2240 [boundary] an unnamed event and a missing detail still read sensibly; nobody to tell gives no notices", () => {
    expect(attendeeChangeNotices({ event: { event_id: "E" }, attendees, change: { kind: "DATE" } })[0].message).toBe("An event: the date changed to .");
    expect(attendeeChangeNotices({ event, change: { kind: "CANCELLED" } })).toEqual([]);
  });

  test("TC-2241 [failure] an unknown or missing change produces no notices", () => {
    expect(attendeeChangeNotices({ event, attendees, change: { kind: "PRICE" } })).toEqual([]);
    expect(attendeeChangeNotices()).toEqual([]);
  });
});

describe("J8 / SCRUM-191 events waiting for a coordinator", () => {
  const submitted = {
    event_id: "EVT-001", name: "Partner Summit", status: "SUBMITTED", organiser_name: "Org A",
    event_date: "2026-11-20", submitted_at: "2026-10-26 10:00"
  };
  const leads = [
    { user_id: "LEAD-1", role: "EVENT_COORDINATOR_LEAD" },
    { user_id: "LEAD-2", role: "EVENT_COORDINATOR_LEAD", active: false },
    { user_id: "COORD-1", role: "EVENT_COORDINATOR" }
  ];

  test("TC-2246 [normal] a submitted, unassigned event tells each active Lead and links read-only to the queue", () => {
    expect(eventEnteredUnassignedQueue({ event: submitted, leads })).toEqual({
      ok: true,
      notifications: [{
        user_id: "LEAD-1",
        event_id: "EVT-001",
        type: "UNASSIGNED_EVENT",
        message: "Partner Summit submitted by Org A for 2026-11-20 at 2026-10-26 10:00 is waiting for a coordinator.",
        is_read: false,
        link: { screen: "Unassigned queue", event_id: "EVT-001", read_only: true }
      }]
    });
    expect(unassignedQueue([submitted, { ...submitted, event_id: "E2", coordinator_id: "C" }, { ...submitted, event_id: "E3", status: "DRAFT" }]))
      .toEqual([submitted]);
  });

  test("TC-2247 [normal] AC1 every active Lead is told, not just the first", () => {
    const twoLeads = [...leads, { user_id: "LEAD-3", role: "EVENT_COORDINATOR_LEAD", active: true }];
    expect(eventEnteredUnassignedQueue({ event: submitted, leads: twoLeads }).notifications.map((notice) => notice.user_id))
      .toEqual(["LEAD-1", "LEAD-3"]);
  });

  test("TC-2248 [normal] opening the notice offers assignment only while nobody holds the event", () => {
    expect(openLeadAssignmentNotice({ event: submitted })).toEqual({ current_coordinator_id: null, offer_assignment: true });
    expect(openLeadAssignmentNotice({ event: { ...submitted, coordinator_id: "C1" } })).toEqual({ current_coordinator_id: "C1", offer_assignment: false });
    expect(openLeadAssignmentNotice()).toEqual({ current_coordinator_id: null, offer_assignment: true });
  });

  test("TC-2249 [normal] cancelling an unassigned event empties it from the queue and tells the Leads", () => {
    const result = cancelUnassignedEvent({ event: submitted, leads });
    expect(result.event.status).toBe("CANCELLED");
    expect(result.queue).toEqual([]);
    expect(result.notifications).toEqual([expect.objectContaining({
      user_id: "LEAD-1", type: "UNASSIGNED_EVENT_CANCELLED", message: "Partner Summit was cancelled and has left the unassigned queue."
    })]);
    expect(cancelUnassignedEvent({ event: submitted }).notifications).toEqual([]);
  });

  test("TC-2250 [conflict] an assigned or non-submitted event is not in the unassigned queue", () => {
    [{ ...submitted, coordinator_id: "C1" }, { ...submitted, status: "UNDER_REVIEW" }].forEach((event) => {
      expect(eventEnteredUnassignedQueue({ event, leads })).toEqual({ ok: false, reason: "not_unassigned", notifications: [] });
      expect(cancelUnassignedEvent({ event, leads })).toEqual({ ok: false, reason: "not_unassigned", event });
    });
  });

  test("TC-2251 [failure] a missing event is refused", () => {
    expect(eventEnteredUnassignedQueue()).toEqual({ ok: false, reason: "not_unassigned", notifications: [] });
    expect(cancelUnassignedEvent()).toEqual({ ok: false, reason: "not_unassigned", event: undefined });
    expect(unassignedQueue()).toEqual([]);
  });
});

describe("J9 / SCRUM-192 events waiting for their safety check", () => {
  test("TC-2257 [normal] cancelling an event in Safety Review removes it from the queue and tells each active Safety Officer", () => {
    const result = cancelSafetyReview({ event: inReview, safetyOfficers: officers });
    expect(result.event.status).toBe("CANCELLED");
    expect(result.queue).toEqual([]);
    expect(result.notifications).toEqual([{
      user_id: "USR-SAFE-001",
      event_id: "EVT-001",
      type: "SAFETY_REVIEW_CANCELLED",
      message: "Partner Summit was cancelled and has left the safety review queue.",
      is_read: false,
      link: { screen: "Safety review", event_id: "EVT-001" },
      checked_before: false
    }]);
  });

  test("TC-2258 [normal] AC1 AC3 every active Safety Officer is told, including when the event is sent again", () => {
    const twoOfficers = [...officers, { user_id: "USR-SAFE-003", role: "SAFETY_OFFICER" }];
    const first = sendForSafetyCheck({ event: planningEvent, bookings: [approvedBooking], safetyOfficers: twoOfficers });
    expect(first.notifications.map((notice) => notice.user_id)).toEqual(["USR-SAFE-001", "USR-SAFE-003"]);
    const resent = sendForSafetyCheck({
      event: { ...planningEvent, returned_to_planning_at: "2026-10-20T00:00:00.000Z" },
      bookings: [approvedBooking],
      safetyOfficers: twoOfficers,
      previousReviews: [{ event_id: "EVT-001", outcome: "REQUEST_CHANGES" }]
    });
    expect(resent.notifications.map((notice) => notice.checked_before)).toEqual([true, true]);
  });

  test("TC-2259 [normal] opening the notice while the event waits shows its details and offers an outcome", () => {
    expect(openSafetyReviewNotice({ event: { ...inReview, venues: ["Main Hall"] } })).toEqual({
      left_queue: false,
      message: null,
      details: { name: "Partner Summit", date: "2026-11-20", venues: ["Main Hall"], expected_attendance: 80 },
      offer_outcome: true
    });
  });

  test("TC-2260 [boundary] an unnamed event, with no venues or attendance, still reads sensibly", () => {
    const bare = { event_id: "E", status: "SAFETY_REVIEW" };
    expect(openSafetyReviewNotice({ event: bare }).details).toEqual({ name: undefined, date: undefined, venues: [], expected_attendance: null });
    expect(cancelSafetyReview({ event: bare, safetyOfficers: officers }).notifications[0].message)
      .toBe("An event was cancelled and has left the safety review queue.");
    expect(cancelSafetyReview({ event: bare }).notifications).toEqual([]);
  });

  test("TC-2261 [conflict] an event that has left Safety Review cannot be cancelled from it, and its notice says it left", () => {
    const planning = { ...inReview, status: "PLANNING" };
    expect(cancelSafetyReview({ event: planning, safetyOfficers: officers })).toEqual({ ok: false, reason: "not_in_review", event: planning });
    expect(openSafetyReviewNotice({ event: planning })).toEqual({
      left_queue: true, message: "Partner Summit has left the safety review queue.", details: null, offer_outcome: false
    });
  });

  test("TC-2262 [failure] a missing event is refused and its notice reads plainly", () => {
    expect(cancelSafetyReview()).toEqual({ ok: false, reason: "not_in_review", event: undefined });
    expect(openSafetyReviewNotice()).toMatchObject({ left_queue: true, message: "This event has left the safety review queue." });
  });
});
