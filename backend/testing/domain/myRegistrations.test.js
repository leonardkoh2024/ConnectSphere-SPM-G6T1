// H4/H5/H7 — frontend/src/domain/myRegistrations.mjs, what an attendee's own list says.
import assert from "node:assert/strict";
import test from "node:test";

import {
  listMyRegistrations,
  myRegistrationEntry,
  registrationDisplayStatus,
  registrationStatusTone,
  withdrawalRefusal
} from "../../../frontend/src/domain/myRegistrations.mjs";

const NOW = new Date("2026-11-05T04:00:00Z");
const event = (changes = {}) => ({ name: "Forum", event_date: "2026-11-12", start_time: "09:00", end_time: "17:00", status: "CONFIRMED", ...changes });

test("TC-1541 [normal] H4 each status has its tone, and an unknown one reads neutral", () => {
  assert.deepEqual(["REGISTERED", "WAITLISTED", "WITHDRAWN", "CANCELLED", "MYSTERY"].map(registrationStatusTone),
    ["positive", "warning", "neutral", "danger", "neutral"]);
});

test("TC-1542 [boundary] H4 AC3 a cancelled event shows Cancelled; an unknown or missing status is left out", () => {
  assert.equal(registrationDisplayStatus({ status: "registered" }, { status: "cancelled" }), "CANCELLED");
  assert.equal(registrationDisplayStatus({ status: "registered" }, null), "REGISTERED");
  assert.equal(registrationDisplayStatus({ status: "LOST" }, event()), null);
  assert.equal(registrationDisplayStatus(undefined, event()), null);
});

test("TC-1591 [conflict] H5 withdrawal is refused with no event, no place, an ended event, or once the event has started", () => {
  assert.equal(withdrawalRefusal({ status: "REGISTERED" }, null).reason, "not_found");
  assert.equal(withdrawalRefusal(undefined, event(), NOW).reason, "not_registered");
  assert.equal(withdrawalRefusal({ status: "WITHDRAWN" }, event(), NOW).reason, "not_registered");
  assert.equal(withdrawalRefusal({ status: "REGISTERED" }, event({ status: "COMPLETED" }), NOW).reason, "event_closed");
  const start = new Date("2026-11-12T01:00:00Z");
  assert.equal(withdrawalRefusal({ status: "WAITLISTED" }, event(), start).reason, "event_started");
  assert.equal(withdrawalRefusal({ status: "WAITLISTED" }, event(), new Date(start.getTime() - 1)), null);
  for (const broken of [{ event_date: undefined }, { start_time: undefined }, { start_time: "9am" }, { event_date: "2026-13-40" }]) {
    assert.equal(withdrawalRefusal({ status: "REGISTERED" }, event(broken), NOW).reason, "event_started", JSON.stringify(broken));
  }
  assert.equal(withdrawalRefusal({ status: "REGISTERED" }, event({ event_date: "2099-01-01" })), null);
});

test("TC-1543 [normal] H4 an entry carries only public fields, with dates as ISO text", () => {
  const entry = myRegistrationEntry(
    { registration_id: "r1", event_id: "e1", status: "REGISTERED", registered_at: { toDate: () => new Date("2026-11-01T00:00:00Z") }, withdrawn_at: "" },
    event({ organiser_id: "secret" }),
    { venueNames: ["Hall"], now: NOW }
  );
  assert.equal(entry.registration_id, "r1");
  assert.equal(entry.registered_at, "2026-11-01T00:00:00.000Z");
  assert.equal(entry.withdrawn_at, null);
  assert.equal(entry.active, true);
  assert.equal(entry.can_withdraw, true);
  assert.equal("organiser_id" in entry, false);
});

test("TC-1544 [boundary] H4 a bare event gives blank text and nulls; a withdrawn Date is converted, text kept", () => {
  const entry = myRegistrationEntry({ id: "r2", status: "WITHDRAWN", withdrawn_at: new Date("2026-11-02T00:00:00Z"), registered_at: "2026-11-01" }, {});
  assert.deepEqual([entry.name, entry.description, entry.event_date, entry.start_time, entry.end_time], ["", "", null, null, null]);
  assert.equal(entry.withdrawn_at, "2026-11-02T00:00:00.000Z");
  assert.equal(entry.registered_at, "2026-11-01");
  assert.equal(entry.active, false);
  assert.deepEqual(entry.venue_names, []);
});

test("TC-1717 [boundary] H7 an offer is active only while it stands and the event is still to come; a lapsed one says so", () => {
  const offer = (expires) => ({ id: "r3", status: "WAITLISTED", invitation_expires_at: expires, waitlist_position: 1 });
  const active = myRegistrationEntry(offer("2026-11-06T00:00:00.000Z"), event(), { now: NOW });
  assert.deepEqual([active.invitation_active, active.can_accept, active.invitation_lapsed, active.waitlist_position], [true, true, false, 1]);
  const lapsed = myRegistrationEntry(offer("2026-11-05T00:00:00.000Z"), event(), { now: NOW });
  assert.deepEqual([lapsed.invitation_active, lapsed.invitation_lapsed, lapsed.invitation_expires_at], [false, true, "2026-11-05T00:00:00.000Z"]);
  const ended = myRegistrationEntry(offer("2026-11-06T00:00:00.000Z"), event({ status: "CANCELLED" }), { now: NOW });
  assert.equal(ended.can_accept, false);
  assert.equal(myRegistrationEntry({ status: "WAITLISTED" }, event(), { now: NOW }).invitation_expires_at, null);
});

test("TC-1545 [boundary] H4 the list drops entries without an event or a known status and sorts by start, then name", () => {
  const list = listMyRegistrations([
    { registration: { id: "late", event_id: "e2", status: "REGISTERED" }, event: event({ name: "Zed", event_date: "2026-11-20" }) },
    { registration: { id: "b", event_id: "e1", status: "REGISTERED" }, event: event({ name: "Beta" }) },
    { registration: { id: "a", event_id: "e3", status: "REGISTERED" }, event: event({ name: "Alpha" }) },
    { registration: { id: "undated", event_id: "e4", status: "REGISTERED" }, event: event({ name: "Undated", event_date: undefined, start_time: undefined }) },
    { registration: { id: "gone", event_id: "e5", status: "REGISTERED" }, event: null },
    { registration: { id: "odd", event_id: "e6", status: "LOST" }, event: event() }
  ], { venueNamesByEvent: { e1: ["Hall"] }, now: NOW });
  assert.deepEqual(list.map((entry) => entry.registration_id), ["a", "b", "late", "undated"]);
  assert.deepEqual(list[1].venue_names, ["Hall"]);
  assert.deepEqual(listMyRegistrations([]), []);
});
