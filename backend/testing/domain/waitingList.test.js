// H6/H7 — frontend/src/domain/waitingList.mjs: FCFS queue order, and invitations to apply for a
// freed place (never automatic promotion).
import assert from "node:assert/strict";
import test from "node:test";

import {
  invitationExpiry,
  invitationState,
  invitationsToIssue,
  placeOfferedMessage,
  reservedPlaces,
  waitlistOrder,
  waitlistPosition
} from "../../../frontend/src/domain/waitingList.mjs";

const NOW = new Date("2026-11-05T04:00:00Z");
const event = (changes = {}) => ({
  status: "CONFIRMED", registration_required: true, registration_capacity: 2,
  event_date: "2026-11-12", start_time: "09:00", ...changes
});
const waiting = (id, joined, changes = {}) => ({ id, status: "WAITLISTED", waitlisted_at: joined, ...changes });

test("TC-1653 [normal] H6 the queue is first come, first served, whatever form the join time takes", () => {
  const order = waitlistOrder([
    waiting("c", "2026-11-03T00:00:00.000Z"),
    waiting("a", new Date("2026-11-01T00:00:00Z")),
    waiting("b", { toDate: () => new Date("2026-11-02T00:00:00Z") }),
    { id: "r", status: "REGISTERED", waitlisted_at: "2026-10-01T00:00:00.000Z" },
    null
  ].filter(Boolean));
  assert.deepEqual(order.map((record) => record.id), ["a", "b", "c"]);
});

test("TC-1654 [boundary] H6 without a join time the registration time stands in; with neither the record goes last", () => {
  const order = waitlistOrder([
    waiting("none", undefined),
    waiting("garbled", "not a date"),
    waiting("legacy", "", { registered_at: "2026-11-02T00:00:00.000Z" }),
    waiting("first", "2026-11-01T00:00:00.000Z")
  ]);
  assert.deepEqual(order.map((record) => record.id), ["first", "legacy", "garbled", "none"]);
});

test("TC-1655 [boundary] H6 equal join times are settled by stored position, then by record id", () => {
  const same = "2026-11-01T00:00:00.000Z";
  const order = waitlistOrder([
    waiting("z", same),
    { registration_id: "y", status: "waitlisted", waitlisted_at: same },
    waiting("p2", same, { waitlist_position: 2 }),
    waiting("p1", same, { waitlist_position: "1" }),
    waiting("pnull", same, { waitlist_position: null }),
    { status: "WAITLISTED", waitlisted_at: same }
  ]);
  assert.deepEqual(order.map((record) => record.id || record.registration_id || ""), ["p1", "p2", "", "pnull", "y", "z"]);
  assert.deepEqual(waitlistOrder(), []);
  assert.deepEqual(waitlistOrder([{ id: "no-status" }]), []);
  const dated = waiting("dated", same);
  const undated = waiting("undated", null);
  assert.deepEqual(waitlistOrder([undated, dated]).map((record) => record.id), ["dated", "undated"]);
  assert.deepEqual(waitlistOrder([dated, undated]).map((record) => record.id), ["dated", "undated"]);
});

test("TC-1656 [normal] H6 AC2 a position is 1-based, and null for a record not waiting", () => {
  const records = [waiting("a", "2026-11-01T00:00:00.000Z"), waiting("b", "2026-11-02T00:00:00.000Z"), { id: "r", status: "REGISTERED" }];
  assert.deepEqual([waitlistPosition(records, "a"), waitlistPosition(records, "b"), waitlistPosition(records, "r")], [1, 2, null]);
});

test("TC-1718 [boundary] H7 AC3 an offer lasts 48 hours or until the event starts, and none once it has started", () => {
  assert.deepEqual(invitationExpiry(event(), NOW), new Date(NOW.getTime() + 48 * 3600000));
  const soon = event({ event_date: "2026-11-05", start_time: "14:00" });
  assert.deepEqual(invitationExpiry(soon, NOW), new Date("2026-11-05T06:00:00Z"));
  assert.equal(invitationExpiry(soon, new Date("2026-11-05T06:00:00Z")), null);
  assert.equal(invitationExpiry(event({ start_time: undefined }), NOW), null);
  assert.equal(invitationExpiry(event({ event_date: undefined }), NOW), null);
  assert.notEqual(invitationExpiry(event({ event_date: "2099-01-01" })), null);
});

test("TC-1719 [boundary] H7 an offer is ACTIVE until its expiry instant, then LAPSED; only waiting records hold one", () => {
  const offered = waiting("a", null, { invitation_expires_at: "2026-11-05T04:00:00.000Z" });
  assert.equal(invitationState(offered, new Date(NOW.getTime() - 1)), "ACTIVE");
  assert.equal(invitationState(offered, NOW), "LAPSED");
  assert.equal(invitationState({ ...offered, status: "REGISTERED" }, NOW), "NONE");
  assert.equal(invitationState(waiting("b", null), NOW), "NONE");
  assert.equal(invitationState(undefined), "NONE");
  assert.equal(invitationState(waiting("c", null, { invitation_expires_at: "2099-01-01T00:00:00.000Z" })), "ACTIVE");
  assert.equal(reservedPlaces([offered, waiting("b", null)], new Date(NOW.getTime() - 1)), 1);
  assert.equal(reservedPlaces(), 0);
});

test("TC-1720 [conflict] H7 AC1 freed places are offered in queue order to people not already holding an offer, never promoted", () => {
  const records = [
    { id: "r1", status: "REGISTERED" },
    waiting("held", "2026-11-01T00:00:00.000Z", { invitation_expires_at: "2026-11-06T00:00:00.000Z" }),
    waiting("next", "2026-11-02T00:00:00.000Z"),
    waiting("after", "2026-11-03T00:00:00.000Z")
  ];
  // Capacity 3: one taken, one held by an active offer, so one place is offered to the next person.
  const offers = invitationsToIssue({ event: event({ registration_capacity: 3 }), records, now: NOW });
  assert.deepEqual(offers.map((offer) => offer.id), ["next"]);
  assert.equal(offers[0].record.status, "WAITLISTED");
  assert.deepEqual(invitationsToIssue({ event: event(), records, now: NOW }), [], "no free place, no offer");
});

test("TC-1721 [boundary] H7 AC4 a lapsed offer is renewed only after a place freed since it lapsed", () => {
  const lapsed = waiting("lapsed", "2026-11-01T00:00:00.000Z", { invitation_expires_at: "2026-11-04T00:00:00.000Z" });
  const before = { id: "w1", status: "withdrawn", withdrawn_from: "registered", withdrawn_at: "2026-11-03T00:00:00.000Z" };
  const after = { id: "w2", status: "WITHDRAWN", withdrawn_from: "REGISTERED", withdrawn_at: new Date("2026-11-04T12:00:00Z") };
  const waitlistLeaver = { id: "w3", status: "WITHDRAWN", withdrawn_from: "WAITLISTED", withdrawn_at: "2026-11-05T00:00:00.000Z" };
  const undated = { id: "w4", status: "WITHDRAWN", withdrawn_from: "REGISTERED" };
  const second = waiting("second", "2026-11-02T00:00:00.000Z");
  const skipped = invitationsToIssue({ event: event({ registration_capacity: 1 }), records: [lapsed, second, before, waitlistLeaver, undated], now: NOW });
  assert.deepEqual(skipped.map((offer) => offer.id), ["second"]);
  const renewed = invitationsToIssue({ event: event({ registration_capacity: 1 }), records: [lapsed, second, after], now: NOW });
  assert.deepEqual(renewed.map((offer) => offer.id), ["lapsed"]);
});

test("TC-1722 [failure] H7 nobody is offered a place on an event without registration, out of status, without capacity or started", () => {
  const records = [waiting("a", "2026-11-01T00:00:00.000Z")];
  for (const candidate of [null, event({ registration_required: false }), event({ status: "COMPLETED" }), event({ status: undefined }),
    event({ registration_capacity: 0 }), event({ registration_capacity: "2" }), event({ event_date: "2026-11-01" })]) {
    assert.deepEqual(invitationsToIssue({ event: candidate, records, now: NOW }), [], JSON.stringify(candidate));
  }
  assert.deepEqual(invitationsToIssue({ event: event({ event_date: "2099-01-01" }) }), []);
});

test("TC-1723 [normal] H7 the offer notice names the event and the Singapore deadline", () => {
  assert.equal(placeOfferedMessage({ eventName: "Forum", expiresAt: "2026-11-07T04:05:00.000Z" }),
    "A place has opened at Forum. Accept it in My registrations by 7 Nov 2026, 12:05, or it will be offered to the next person on the waiting list.");
  assert.match(placeOfferedMessage({ expiresAt: new Date("2026-12-31T16:00:00Z") }), /^A place has opened at your event\. Accept it in My registrations by 1 Jan 2027, 00:00,/);
});
