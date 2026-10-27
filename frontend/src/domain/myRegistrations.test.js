// H4 / SCRUM-142 — "See the status of my registrations". The rules for what an
// attendee's own list says about each registration. The registration service runs
// these same functions, so these cases are the server's rules too.

import {
  REGISTRATION_STATUS_LABELS,
  listMyRegistrations,
  myRegistrationEntry,
  registrationDisplayStatus,
  registrationStatusTone
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

describe("H4 AC1 / AC3 the status shown", () => {
  test("TC-606 the four statuses read Registered, Waitlisted, Withdrawn and Cancelled", () => {
    expect(REGISTRATION_STATUS_LABELS).toEqual({
      REGISTERED: "Registered",
      WAITLISTED: "Waitlisted",
      WITHDRAWN: "Withdrawn",
      CANCELLED: "Cancelled"
    });
  });

  test.each(["REGISTERED", "WAITLISTED", "WITHDRAWN", "CANCELLED"])("TC-607 a %s registration on a running event keeps its own status", (status) => {
    expect(registrationDisplayStatus(registration({ status }), event())).toBe(status);
  });

  test.each(["REGISTERED", "WAITLISTED", "WITHDRAWN"])("TC-608 any registration on a cancelled event shows Cancelled (was %s)", (status) => {
    expect(registrationDisplayStatus(registration({ status }), event({ status: "CANCELLED" }))).toBe("CANCELLED");
  });

  test("TC-608 the status is read whatever its case", () => {
    expect(registrationDisplayStatus(registration({ status: "waitlisted" }), event({ status: "confirmed" }))).toBe("WAITLISTED");
    expect(registrationDisplayStatus(registration(), event({ status: "cancelled" }))).toBe("CANCELLED");
  });

  test("TC-609 a status the attendee list does not know is not shown", () => {
    expect(registrationDisplayStatus(registration({ status: "SOMETHING_ELSE" }), event())).toBeNull();
    expect(registrationDisplayStatus(registration({ status: undefined }), event())).toBeNull();
  });

  test("TC-610 each status has a tone: Registered positive, Waitlisted warning, Withdrawn neutral, Cancelled danger", () => {
    expect(registrationStatusTone("REGISTERED")).toBe("positive");
    expect(registrationStatusTone("WAITLISTED")).toBe("warning");
    expect(registrationStatusTone("WITHDRAWN")).toBe("neutral");
    expect(registrationStatusTone("CANCELLED")).toBe("danger");
    expect(registrationStatusTone("UNKNOWN")).toBe("neutral");
  });
});

describe("H4 AC1 / AC2 what an attendee is shown for each entry", () => {
  test("TC-611 an entry carries the event's name, date, window, venue and the status, with the registration's times", () => {
    expect(myRegistrationEntry(registration(), event(), { venueNames: ["Harbour Hall"] })).toEqual({
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
      waitlist_position: null
    });
  });

  test("TC-612 internal event fields never reach the attendee, including a cancellation's reason", () => {
    const entry = myRegistrationEntry(registration(), event({ status: "CANCELLED" }), {});
    ["organiser_id", "coordinator_id", "reference_no", "cancellation_reason", "registration_capacity", "attendee_id"].forEach((field) => {
      expect(entry).not.toHaveProperty(field);
    });
    expect(entry.status).toBe("CANCELLED");
  });

  test("TC-613 Firestore timestamps, dates and text all come back as ISO text, or null", () => {
    const stamp = { toDate: () => new Date("2026-11-06T01:30:00Z") };
    const entry = myRegistrationEntry(registration({ registered_at: stamp, withdrawn_at: "2026-11-07T02:00:00.000Z", status: "WITHDRAWN" }), event(), {});
    expect(entry.registered_at).toBe("2026-11-06T01:30:00.000Z");
    expect(entry.withdrawn_at).toBe("2026-11-07T02:00:00.000Z");
    expect(myRegistrationEntry(registration({ registered_at: null }), event(), {}).registered_at).toBeNull();
  });

  test("TC-614 a waitlisted entry keeps its place in the queue", () => {
    expect(myRegistrationEntry(registration({ status: "WAITLISTED", waitlist_position: 3 }), event(), {}).waitlist_position).toBe(3);
  });

  test("TC-615 a registration id falls back to the document's own fields", () => {
    const entry = myRegistrationEntry({ registration_id: "r-9", event_id: "e1", status: "REGISTERED" }, event(), {});
    expect(entry.registration_id).toBe("r-9");
    expect(entry.venue_names).toEqual([]);
  });
});

describe("H4 AC1 / AC3 the list", () => {
  test("TC-616 the list is ordered by event date and time, soonest first, and cancelled events stay in it", () => {
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

  test("TC-617 a registration whose event cannot be found, or whose status is unknown, is left out", () => {
    const listed = listMyRegistrations([
      { registration: registration({ id: "kept" }), event: event() },
      { registration: registration({ id: "orphan", event_id: "gone" }), event: null },
      { registration: registration({ id: "odd", status: "SOMETHING_ELSE" }), event: event() }
    ]);
    expect(listed.map((entry) => entry.registration_id)).toEqual(["kept"]);
  });

  test("TC-617 venue names are attached by event", () => {
    const listed = listMyRegistrations([{ registration: registration(), event: event() }], { venueNamesByEvent: { e1: ["Harbour Hall", "Pier Room"] } });
    expect(listed[0].venue_names).toEqual(["Harbour Hall", "Pier Room"]);
  });

  test("TC-617 no registrations gives an empty list", () => {
    expect(listMyRegistrations([])).toEqual([]);
  });
});
