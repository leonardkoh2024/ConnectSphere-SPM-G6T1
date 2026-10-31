// H2 / SCRUM-140 — "Find events I can register for". The rules that decide which
// events an attendee may see and what each entry says. The backend's registration
// service runs these same functions, so these cases are the server's rules too.

import {
  REGISTRATION_OPEN_STATUSES,
  isOpenForRegistration,
  listOpenEvents,
  openEventListing,
  placesLabel,
  registrationWindow,
  remainingPlaces,
  venueLabel
} from "./openRegistration";

// Registration opens 1 Nov 09:00 and closes 10 Nov 17:00, Singapore time.
const openEvent = (changes = {}) => ({
  id: "e1",
  reference_no: "EVT-0001",
  organiser_id: "organiser-1",
  coordinator_id: "coordinator-1",
  name: "Harbour Tech Forum",
  purpose: "Internal purpose text",
  description: "A day of talks on port technology.",
  event_date: "2026-11-12",
  start_time: "09:00",
  end_time: "17:00",
  expected_attendance: 200,
  status: "CONFIRMED",
  registration_required: true,
  registration_capacity: 150,
  registration_open_date: "2026-11-01",
  registration_open_time: "09:00",
  registration_close_date: "2026-11-10",
  registration_close_time: "17:00",
  ...changes
});

const DURING = new Date("2026-11-05T12:00:00+08:00");

describe("H2 AC1 / AC3 which events are open for registration", () => {
  test("TC-1461 an event with registration on, an open status and the window around now is open", () => {
    expect(isOpenForRegistration(openEvent(), DURING)).toBe(true);
  });

  test("TC-1462 the statuses that can be open are Approved through Confirmed", () => {
    expect(REGISTRATION_OPEN_STATUSES).toEqual(["APPROVED", "PLANNING", "SAFETY_REVIEW", "CONFIRMED"]);
    REGISTRATION_OPEN_STATUSES.forEach((status) => {
      expect(isOpenForRegistration(openEvent({ status }), DURING)).toBe(true);
    });
  });

  test.each(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "COMPLETED", "CANCELLED", "REJECTED"])(
    "TC-1463 an event in %s is never open, even inside its window",
    (status) => {
      expect(isOpenForRegistration(openEvent({ status }), DURING)).toBe(false);
    }
  );

  test("TC-1464 a status in a different case is still recognised", () => {
    expect(isOpenForRegistration(openEvent({ status: "confirmed" }), DURING)).toBe(true);
    expect(isOpenForRegistration(openEvent({ status: "cancelled" }), DURING)).toBe(false);
  });

  test("TC-1465 an event that does not take registrations is not open", () => {
    expect(isOpenForRegistration(openEvent({ registration_required: false }), DURING)).toBe(false);
    expect(isOpenForRegistration(openEvent({ registration_required: null }), DURING)).toBe(false);
    expect(isOpenForRegistration(openEvent({ registration_required: "true" }), DURING)).toBe(false);
  });

  test("TC-1466 before the window opens the event is not listed; at the opening minute it is", () => {
    expect(isOpenForRegistration(openEvent(), new Date("2026-11-01T08:59:59+08:00"))).toBe(false);
    expect(isOpenForRegistration(openEvent(), new Date("2026-11-01T09:00:00+08:00"))).toBe(true);
  });

  test("TC-1467 the window closes at its closing minute", () => {
    expect(isOpenForRegistration(openEvent(), new Date("2026-11-10T16:59:59+08:00"))).toBe(true);
    expect(isOpenForRegistration(openEvent(), new Date("2026-11-10T17:00:00+08:00"))).toBe(false);
    expect(isOpenForRegistration(openEvent(), new Date("2026-11-11T09:00:00+08:00"))).toBe(false);
  });

  test("TC-1468 the window is read in Singapore time, whatever the server's clock zone", () => {
    const { opensAt, closesAt } = registrationWindow(openEvent());
    expect(opensAt.toISOString()).toBe("2026-11-01T01:00:00.000Z");
    expect(closesAt.toISOString()).toBe("2026-11-10T09:00:00.000Z");
  });

  test("TC-1469 an incomplete or impossible window is never open", () => {
    expect(isOpenForRegistration(openEvent({ registration_open_date: null }), DURING)).toBe(false);
    expect(isOpenForRegistration(openEvent({ registration_close_time: "" }), DURING)).toBe(false);
    expect(isOpenForRegistration(openEvent({ registration_open_time: "9am" }), DURING)).toBe(false);
    expect(isOpenForRegistration(openEvent({ registration_close_date: "2026-10-01" }), DURING)).toBe(false);
  });

  test("TC-1470 an event without a usable capacity is not open, since nobody could register", () => {
    expect(isOpenForRegistration(openEvent({ registration_capacity: null }), DURING)).toBe(false);
    expect(isOpenForRegistration(openEvent({ registration_capacity: 0 }), DURING)).toBe(false);
    expect(isOpenForRegistration(openEvent({ registration_capacity: 12.5 }), DURING)).toBe(false);
  });

  test("TC-1471 a missing event is not open", () => {
    expect(isOpenForRegistration(null, DURING)).toBe(false);
    expect(isOpenForRegistration(undefined, DURING)).toBe(false);
  });
});

describe("H2 AC2 remaining places", () => {
  test("TC-1472 remaining places are the capacity less the registered count", () => {
    expect(remainingPlaces(150, 0)).toBe(150);
    expect(remainingPlaces(150, 149)).toBe(1);
  });

  test("TC-1473 a full event has none left, never a negative number", () => {
    expect(remainingPlaces(150, 150)).toBe(0);
    expect(remainingPlaces(150, 151)).toBe(0);
  });

  test("TC-1474 places read as a count, singular for one, and Full at zero", () => {
    expect(placesLabel(150)).toBe("150 places left");
    expect(placesLabel(1)).toBe("1 place left");
    expect(placesLabel(0)).toBe("Full");
  });
});

describe("H2 AC2 venue", () => {
  test("TC-1475 every approved venue is named, so a multi-venue event lists them all", () => {
    expect(venueLabel(["Harbour Hall"])).toBe("Harbour Hall");
    expect(venueLabel(["Harbour Hall", "Pier Room"])).toBe("Harbour Hall, Pier Room");
  });

  test("TC-1476 an event with no approved venue yet says so rather than showing nothing", () => {
    expect(venueLabel([])).toBe("Venue to be confirmed");
    expect(venueLabel(undefined)).toBe("Venue to be confirmed");
  });
});

describe("H2 AC2 / AC3 what an attendee is shown", () => {
  test("TC-1477 an entry carries the name, description, date, window, venue and remaining places", () => {
    const entry = openEventListing(openEvent(), { venueNames: ["Harbour Hall"], registeredCount: 40 });
    expect(entry).toEqual({
      id: "e1",
      name: "Harbour Tech Forum",
      description: "A day of talks on port technology.",
      event_date: "2026-11-12",
      start_time: "09:00",
      end_time: "17:00",
      venue_names: ["Harbour Hall"],
      capacity: 150,
      remaining_places: 110,
      registration_closes_at: "2026-11-10T09:00:00.000Z"
    });
  });

  test("TC-1478 internal fields never reach the attendee", () => {
    const entry = openEventListing(openEvent(), { venueNames: [], registeredCount: 0 });
    ["organiser_id", "coordinator_id", "reference_no", "purpose", "expected_attendance", "status"].forEach((field) => {
      expect(entry).not.toHaveProperty(field);
    });
  });

  test("TC-1479 the list keeps only open events, soonest first", () => {
    const events = [
      openEvent({ id: "later", name: "Later", event_date: "2026-11-20" }),
      openEvent({ id: "draft", status: "DRAFT" }),
      openEvent({ id: "cancelled", status: "CANCELLED" }),
      openEvent({ id: "rejected", status: "REJECTED" }),
      openEvent({ id: "closed", registration_close_date: "2026-11-02" }),
      openEvent({ id: "no-reg", registration_required: false }),
      openEvent({ id: "afternoon", name: "Afternoon", start_time: "14:00", end_time: "16:00" }),
      openEvent({ id: "morning", name: "Morning" })
    ];
    const listed = listOpenEvents(events, {
      now: DURING,
      venueNamesByEvent: { morning: ["Harbour Hall"] },
      registeredCountByEvent: { morning: 150 }
    });
    expect(listed.map((entry) => entry.id)).toEqual(["morning", "afternoon", "later"]);
    expect(listed[0]).toMatchObject({ venue_names: ["Harbour Hall"], remaining_places: 0 });
    expect(listed[1]).toMatchObject({ venue_names: [], remaining_places: 150 });
  });

  test("TC-1480 nothing open gives an empty list", () => {
    expect(listOpenEvents([], { now: DURING })).toEqual([]);
    expect(listOpenEvents([openEvent({ status: "DRAFT" })], { now: DURING })).toEqual([]);
  });
});
