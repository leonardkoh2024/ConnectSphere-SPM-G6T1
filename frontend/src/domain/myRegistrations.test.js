// H4 / SCRUM-142 — "See the status of my registrations". The rules for what an
// attendee's own list says about each registration. The registration service runs
// these same functions, so these cases are the server's rules too.

import {
  REGISTRATION_STATUS_LABELS,
  listMyRegistrations,
  myRegistrationEntry,
  registrationDisplayStatus,
  registrationStatusTone,
  withdrawalRefusal
} from "./myRegistrations";

const event = (changes = {}) => ({
  id: "e1",
  organiser_id: "organiser-1",
  coordinator_id: "coordinator-1",
  reference_no: "EVT-0001",
  name: "Harbour Tech Forum",
  description: "A day of talks on port technology.",
  event_date: "2026-11-12",
  start_time: "09:00",
  end_time: "17:00",
  status: "CONFIRMED",
  cancellation_reason: "Internal reason",
  registration_capacity: 150,
  ...changes
});

const registration = (changes = {}) => ({
  id: "e1_attendee-1",
  event_id: "e1",
  attendee_id: "attendee-1",
  status: "REGISTERED",
  registered_at: new Date("2026-11-05T04:00:00Z"),
  withdrawn_at: null,
  waitlist_position: null,
  ...changes
});

// The event above starts 12 Nov 09:00 Singapore time.
const BEFORE = new Date("2026-11-05T12:00:00+08:00");

describe("H4 AC1 / AC3 the status shown", () => {
  test("TC-1546 the four statuses read Registered, Waitlisted, Withdrawn and Cancelled", () => {
    expect(REGISTRATION_STATUS_LABELS).toEqual({
      REGISTERED: "Registered",
      WAITLISTED: "Waitlisted",
      WITHDRAWN: "Withdrawn",
      CANCELLED: "Cancelled"
    });
  });

  test.each(["REGISTERED", "WAITLISTED", "WITHDRAWN", "CANCELLED"])("TC-1547 a %s registration on a running event keeps its own status", (status) => {
    expect(registrationDisplayStatus(registration({ status }), event())).toBe(status);
  });

  test.each(["REGISTERED", "WAITLISTED", "WITHDRAWN"])("TC-1548 any registration on a cancelled event shows Cancelled (was %s)", (status) => {
    expect(registrationDisplayStatus(registration({ status }), event({ status: "CANCELLED" }))).toBe("CANCELLED");
  });

  test("TC-1549 the status is read whatever its case", () => {
    expect(registrationDisplayStatus(registration({ status: "waitlisted" }), event({ status: "confirmed" }))).toBe("WAITLISTED");
    expect(registrationDisplayStatus(registration(), event({ status: "cancelled" }))).toBe("CANCELLED");
  });

  test("TC-1550 a status the attendee list does not know is not shown", () => {
    expect(registrationDisplayStatus(registration({ status: "SOMETHING_ELSE" }), event())).toBeNull();
    expect(registrationDisplayStatus(registration({ status: undefined }), event())).toBeNull();
  });

  test("TC-1551 each status has a tone: Registered positive, Waitlisted warning, Withdrawn neutral, Cancelled danger", () => {
    expect(registrationStatusTone("REGISTERED")).toBe("positive");
    expect(registrationStatusTone("WAITLISTED")).toBe("warning");
    expect(registrationStatusTone("WITHDRAWN")).toBe("neutral");
    expect(registrationStatusTone("CANCELLED")).toBe("danger");
    expect(registrationStatusTone("UNKNOWN")).toBe("neutral");
  });
});

describe("H4 AC1 / AC2 what an attendee is shown for each entry", () => {
  test("TC-1552 an entry carries the event's name, date, window, venue and the status, with the registration's times", () => {
    expect(myRegistrationEntry(registration(), event(), { venueNames: ["Harbour Hall"], now: BEFORE })).toEqual({
      registration_id: "e1_attendee-1",
      event_id: "e1",
      name: "Harbour Tech Forum",
      description: "A day of talks on port technology.",
      event_date: "2026-11-12",
      start_time: "09:00",
      end_time: "17:00",
      venue_names: ["Harbour Hall"],
      status: "REGISTERED",
      registered_at: "2026-11-05T04:00:00.000Z",
      withdrawn_at: null,
      waitlist_position: null,
      active: true,
      can_withdraw: true,
      invitation_expires_at: null,
      invitation_active: false,
      invitation_lapsed: false,
      can_accept: false
    });
  });

  test("TC-1553 internal event fields never reach the attendee, including a cancellation's reason", () => {
    const entry = myRegistrationEntry(registration(), event({ status: "CANCELLED" }), {});
    ["organiser_id", "coordinator_id", "reference_no", "cancellation_reason", "registration_capacity", "attendee_id"].forEach((field) => {
      expect(entry).not.toHaveProperty(field);
    });
    expect(entry.status).toBe("CANCELLED");
  });

  test("TC-1554 Firestore timestamps, dates and text all come back as ISO text, or null", () => {
    const stamp = { toDate: () => new Date("2026-11-06T01:30:00Z") };
    const entry = myRegistrationEntry(registration({ registered_at: stamp, withdrawn_at: "2026-11-07T02:00:00.000Z", status: "WITHDRAWN" }), event(), {});
    expect(entry.registered_at).toBe("2026-11-06T01:30:00.000Z");
    expect(entry.withdrawn_at).toBe("2026-11-07T02:00:00.000Z");
    expect(myRegistrationEntry(registration({ registered_at: null }), event(), {}).registered_at).toBeNull();
  });

  test("TC-1555 a waitlisted entry keeps its place in the queue", () => {
    expect(myRegistrationEntry(registration({ status: "WAITLISTED", waitlist_position: 3 }), event(), {}).waitlist_position).toBe(3);
  });

  test("TC-1556 a registration id falls back to the document's own fields", () => {
    const entry = myRegistrationEntry({ registration_id: "r-9", event_id: "e1", status: "REGISTERED" }, event(), {});
    expect(entry.registration_id).toBe("r-9");
    expect(entry.venue_names).toEqual([]);
  });
});

describe("H4 AC1 / AC3 the list", () => {
  test("TC-1557 the list is ordered by event date and time, soonest first, and cancelled events stay in it", () => {
    const pairs = [
      { registration: registration({ id: "late", event_id: "late" }), event: event({ id: "late", name: "Later", event_date: "2026-12-01" }) },
      { registration: registration({ id: "cancelled", event_id: "cancelled" }), event: event({ id: "cancelled", name: "Called off", status: "CANCELLED", event_date: "2026-11-20" }) },
      { registration: registration({ id: "pm", event_id: "pm" }), event: event({ id: "pm", name: "Afternoon", start_time: "14:00" }) },
      { registration: registration({ id: "am", event_id: "am" }), event: event({ id: "am", name: "Morning" }) }
    ];
    const listed = listMyRegistrations(pairs);
    expect(listed.map((entry) => entry.registration_id)).toEqual(["am", "pm", "cancelled", "late"]);
    expect(listed[2].status).toBe("CANCELLED");
  });

  test("TC-1558 a registration whose event cannot be found, or whose status is unknown, is left out", () => {
    const listed = listMyRegistrations([
      { registration: registration({ id: "kept" }), event: event() },
      { registration: registration({ id: "orphan", event_id: "gone" }), event: null },
      { registration: registration({ id: "odd", status: "SOMETHING_ELSE" }), event: event() }
    ]);
    expect(listed.map((entry) => entry.registration_id)).toEqual(["kept"]);
  });

  test("TC-1559 venue names are attached by event", () => {
    const listed = listMyRegistrations([{ registration: registration(), event: event() }], { venueNamesByEvent: { e1: ["Harbour Hall", "Pier Room"] } });
    expect(listed[0].venue_names).toEqual(["Harbour Hall", "Pier Room"]);
  });

  test("TC-1560 no registrations gives an empty list", () => {
    expect(listMyRegistrations([])).toEqual([]);
  });
});

// ---- H5 / SCRUM-143 — Withdraw from an event ------------------------------------

const START = new Date("2026-11-12T09:00:00+08:00");

describe("H5 AC1 / AC5 which registrations are active", () => {
  test("TC-1592 a Registered or Waitlisted place on an event still to come is active", () => {
    expect(myRegistrationEntry(registration(), event(), { now: BEFORE }).active).toBe(true);
    expect(myRegistrationEntry(registration({ status: "WAITLISTED" }), event(), { now: BEFORE }).active).toBe(true);
  });

  test("TC-1593 a withdrawn registration is not active, so it leaves the active list", () => {
    expect(myRegistrationEntry(registration({ status: "WITHDRAWN" }), event(), { now: BEFORE }).active).toBe(false);
  });

  test("TC-1594 a cancelled, completed or rejected event's registration is not active", () => {
    ["CANCELLED", "COMPLETED", "REJECTED"].forEach((status) => {
      expect(myRegistrationEntry(registration(), event({ status }), { now: BEFORE }).active).toBe(false);
    });
  });

  test("TC-1595 once the event has started, its registration is no longer active", () => {
    expect(myRegistrationEntry(registration(), event(), { now: new Date(START.getTime() - 1000) }).active).toBe(true);
    expect(myRegistrationEntry(registration(), event(), { now: START }).active).toBe(false);
  });

  test("TC-1596 an event without a usable start is not treated as upcoming", () => {
    expect(myRegistrationEntry(registration(), event({ start_time: null }), { now: BEFORE }).active).toBe(false);
  });
});

describe("H5 AC2 / AC6 who may withdraw", () => {
  test("TC-1597 a Registered attendee may withdraw from an event still to come", () => {
    expect(withdrawalRefusal(registration(), event(), BEFORE)).toBeNull();
    expect(myRegistrationEntry(registration(), event(), { now: BEFORE }).can_withdraw).toBe(true);
  });

  test.each([
    ["no registration at all", null],
    ["a withdrawn registration", { status: "WITHDRAWN" }],
    ["a cancelled registration", { status: "CANCELLED" }]
  ])("TC-1598 %s cannot be withdrawn: the attendee holds no place", (_label, changes) => {
    const refusal = withdrawalRefusal(changes ? registration(changes) : null, event(), BEFORE);
    expect(refusal).toEqual({ reason: "not_registered", message: "You are not registered for this event." });
    if (changes) expect(myRegistrationEntry(registration(changes), event(), { now: BEFORE }).can_withdraw).toBe(false);
  });

  test.each(["CANCELLED", "COMPLETED", "REJECTED"])("TC-1599 nothing can be withdrawn from a %s event", (status) => {
    expect(withdrawalRefusal(registration(), event({ status }), BEFORE)).toMatchObject({ reason: "event_closed" });
    expect(myRegistrationEntry(registration(), event({ status }), { now: BEFORE }).can_withdraw).toBe(false);
  });

  test("TC-1600 withdrawal closes when the event starts, by the Singapore start time", () => {
    expect(withdrawalRefusal(registration(), event(), new Date(START.getTime() - 1000))).toBeNull();
    expect(withdrawalRefusal(registration(), event(), START)).toMatchObject({ reason: "event_started", message: "This event has already started." });
  });

  test("TC-1601 a missing event cannot be withdrawn from", () => {
    expect(withdrawalRefusal(registration(), null, BEFORE)).toMatchObject({ reason: "not_found" });
  });

  test("TC-1602 the status is read whatever its case", () => {
    expect(withdrawalRefusal(registration({ status: "registered" }), event({ status: "confirmed" }), BEFORE)).toBeNull();
  });
});

describe("H6 leaving the waiting list", () => {
  test("TC-1657 a waitlisted attendee may withdraw from an event still to come, giving up their place in the queue", () => {
    expect(withdrawalRefusal(registration({ status: "WAITLISTED" }), event(), BEFORE)).toBeNull();
    expect(myRegistrationEntry(registration({ status: "WAITLISTED" }), event(), { now: BEFORE }).can_withdraw).toBe(true);
  });

  test("TC-1658 the same limits apply: not once the event has started, nor from an event that has ended", () => {
    expect(withdrawalRefusal(registration({ status: "WAITLISTED" }), event(), START)).toMatchObject({ reason: "event_started" });
    expect(withdrawalRefusal(registration({ status: "WAITLISTED" }), event({ status: "CANCELLED" }), BEFORE)).toMatchObject({ reason: "event_closed" });
  });
});
