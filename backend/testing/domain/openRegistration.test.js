// H2 — frontend/src/domain/openRegistration.mjs, which events an attendee may find.
import assert from "node:assert/strict";
import test from "node:test";

import {
  isOpenForRegistration,
  listOpenEvents,
  openEventListing,
  placesLabel,
  registrationWindow,
  remainingPlaces,
  venueLabel
} from "../../../frontend/src/domain/openRegistration.mjs";

const event = (changes = {}) => ({
  id: "e1", name: "Forum", event_date: "2026-11-12", start_time: "09:00", end_time: "17:00",
  status: "CONFIRMED", registration_required: true, registration_capacity: 3,
  registration_open_date: "2026-11-01", registration_open_time: "09:00",
  registration_close_date: "2026-11-10", registration_close_time: "17:00", ...changes
});
const sgt = (iso) => new Date(`${iso}+08:00`);

test("TC-1454 [boundary] H2 registration is open from the opening minute up to, not including, the closing minute", () => {
  assert.equal(isOpenForRegistration(event(), sgt("2026-11-01T08:59:59")), false);
  assert.equal(isOpenForRegistration(event(), sgt("2026-11-01T09:00:00")), true);
  assert.equal(isOpenForRegistration(event(), sgt("2026-11-10T16:59:59")), true);
  assert.equal(isOpenForRegistration(event(), sgt("2026-11-10T17:00:00")), false);
  assert.equal(isOpenForRegistration(event({ registration_open_date: "2020-01-01", registration_close_date: "2099-01-01" })), true);
});

test("TC-1357 [conflict] H1 AC1 no flag, a status outside Approved-Confirmed, no capacity or a bad window is never open", () => {
  const at = sgt("2026-11-05T12:00:00");
  for (const changes of [
    { registration_required: "yes" }, { status: "SUBMITTED" }, { status: undefined }, { status: "COMPLETED" },
    { registration_capacity: 0 }, { registration_capacity: "3" },
    { registration_open_date: undefined }, { registration_open_time: undefined }, { registration_close_time: "5pm" }, { registration_close_date: "2026-13-01" },
    { registration_close_date: "2026-11-01" }
  ]) {
    assert.equal(isOpenForRegistration(event(changes), at), false, JSON.stringify(changes));
  }
  assert.equal(isOpenForRegistration(null, at), false);
  assert.equal(isOpenForRegistration(event({ status: "safety_review" }), at), true);
});

test("TC-1455 [boundary] H2 places left never go below zero and read Full, 1 place, n places", () => {
  assert.equal(remainingPlaces(3, 5), 0);
  assert.equal(remainingPlaces("x"), 0);
  assert.equal(remainingPlaces(3, undefined), 3);
  assert.equal(remainingPlaces(3, "x"), 3);
  assert.deepEqual([placesLabel(0), placesLabel(-1), placesLabel(1), placesLabel(4)], ["Full", "Full", "1 place left", "4 places left"]);
});

test("TC-1456 [boundary] H2 the venue reads as the names, or 'to be confirmed' with none", () => {
  assert.equal(venueLabel(["Hall", "Room"]), "Hall, Room");
  assert.equal(venueLabel([]), "Venue to be confirmed");
  assert.equal(venueLabel(undefined), "Venue to be confirmed");
});

test("TC-1457 [normal] H2 a listing holds only public fields; a bare event gives blanks and no closing time", () => {
  const listing = openEventListing(event({ organiser_id: "secret", reference_no: "EVT-1" }), { venueNames: ["Hall"], registeredCount: 1 });
  assert.equal(listing.remaining_places, 2);
  assert.equal(listing.registration_closes_at, "2026-11-10T09:00:00.000Z");
  assert.equal("organiser_id" in listing, false);
  const bare = openEventListing({ id: "x" });
  assert.deepEqual([bare.name, bare.description, bare.event_date, bare.start_time, bare.end_time, bare.registration_closes_at], ["", "", null, null, null, null]);
  assert.deepEqual(registrationWindow(), { opensAt: null, closesAt: null });
});

test("TC-1458 [normal] H2 only open events are listed, soonest first then by name, each with its own counts", () => {
  const at = sgt("2026-11-05T12:00:00");
  const listed = listOpenEvents([
    event({ id: "late", name: "Late", event_date: "2026-11-20" }),
    event({ id: "b", name: "Beta" }),
    event({ id: "a", name: "Alpha" }),
    event({ id: "shut", status: "CANCELLED" })
  ], { now: at, venueNamesByEvent: { a: ["Hall"] }, registeredCountByEvent: { b: 3 } });
  assert.deepEqual(listed.map((entry) => entry.id), ["a", "b", "late"]);
  assert.deepEqual(listed[0].venue_names, ["Hall"]);
  assert.equal(listed[1].remaining_places, 0);
  const always = { registration_open_date: "2020-01-01", registration_close_date: "2099-01-01" };
  const undated = listOpenEvents([
    event({ id: "dated", ...always }),
    event({ id: "bare", name: undefined, event_date: undefined, start_time: undefined, ...always })
  ]);
  assert.deepEqual(undated.map((entry) => [entry.id, entry.name]), [["dated", "Forum"], ["bare", ""]]);
});
