// H2 / SCRUM-140 — the missing-field and omitted-argument cases of the open-events rules.

import {
  isOpenForRegistration,
  listOpenEvents,
  openEventListing,
  registrationWindow,
  remainingPlaces,
  venueLabel
} from "./openRegistration.mjs";

const openEvent = (overrides = {}) => ({
  id: "e1",
  name: "Alpha",
  description: "A talk",
  status: "APPROVED",
  event_date: "2099-12-31",
  start_time: "10:00",
  end_time: "12:00",
  registration_required: true,
  registration_capacity: 10,
  registration_open_date: "2000-01-01",
  registration_open_time: "09:00",
  registration_close_date: "2099-12-30",
  registration_close_time: "17:00",
  ...overrides
});

describe("H2 open registration fallbacks", () => {
  test("TC-2714 a registration window with an impossible date has no opening or closing time", () => {
    expect(registrationWindow(openEvent({ registration_open_date: "2026-13-45" })).opensAt).toBeNull();
    expect(registrationWindow().closesAt).toBeNull();
  });

  test("TC-2715 an event with no status is not open for registration", () => {
    expect(isOpenForRegistration(openEvent({ status: undefined }))).toBe(false);
  });

  test("TC-2716 registration is judged against the current time when none is given", () => {
    expect(isOpenForRegistration(openEvent())).toBe(true);
  });

  test("TC-2717 remaining places treat a missing or non-numeric count as zero", () => {
    expect(remainingPlaces(5)).toBe(5);
    expect(remainingPlaces(undefined, 2)).toBe(0);
    expect(remainingPlaces("x", "y")).toBe(0);
  });

  test("TC-2718 an empty venue list reads as to be confirmed", () => {
    expect(venueLabel([])).toBe("Venue to be confirmed");
    expect(venueLabel()).toBe("Venue to be confirmed");
  });

  test("TC-2719 a listing for a bare event shows empty text and no times", () => {
    expect(openEventListing({ id: "e2", registration_capacity: 4 })).toEqual({
      id: "e2",
      name: "",
      description: "",
      event_date: null,
      start_time: null,
      end_time: null,
      venue_names: [],
      capacity: 4,
      remaining_places: 4,
      registration_closes_at: null
    });
  });

  test("TC-2720 listing with no options uses the current time and no venues or counts", () => {
    const [listing] = listOpenEvents([openEvent()]);
    expect(listing).toMatchObject({ id: "e1", venue_names: [], remaining_places: 10 });
  });

  test("TC-2721 events starting together are ordered by name", () => {
    const listings = listOpenEvents([
      openEvent({ id: "b", name: "Beta" }),
      openEvent({ id: "a", name: "Alpha" })
    ]);
    expect(listings.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  test("TC-2722 an event with no date or start time sorts after dated ones", () => {
    const listings = listOpenEvents([
      openEvent({ id: "dated" }),
      openEvent({ id: "undated", event_date: undefined, start_time: undefined })
    ]);
    expect(listings.map((entry) => entry.id)).toEqual(["dated", "undated"]);
  });
});
