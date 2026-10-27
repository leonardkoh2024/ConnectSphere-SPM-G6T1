// H5 / SCRUM-143 — Withdraw from an event. The registration service's transaction: the
// attendee's Registered place is marked Withdrawn, which gives the place back to the event.
//
// Withdrawing is a service call, not a browser write: no browser may update `registrations`
// (H3), and AC6 needs the attendee's own record checked before anything changes. The freed
// place shows at once in the count H3 registers against (AC4). Inviting the next person on
// the waiting list is H7's; nothing here touches the waiting list.
// Runs under node's test runner: `npm run test:backend`.

import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { fakeFirestore } from "../../../testing/fakeFirestore.js";
import { createAttendeeRegistration } from "./register.js";
import { createRegistrationService } from "./service.js";

const NOW = new Date("2026-11-05T12:00:00+08:00");
const STAMP = { serverTimestamp: true };

const event = (changes = {}) => ({
  organiser_id: "organiser-1",
  name: "Harbour Tech Forum",
  description: "A day of talks on port technology.",
  event_date: "2026-11-12",
  start_time: "09:00",
  end_time: "17:00",
  status: "CONFIRMED",
  registration_required: true,
  registration_capacity: 2,
  registration_open_date: "2026-11-01",
  registration_open_time: "09:00",
  registration_close_date: "2026-11-10",
  registration_close_time: "17:00",
  ...changes
});

const record = (eventId, attendeeId, status = "REGISTERED", changes = {}) => ({
  registration_id: `${eventId}_${attendeeId}`,
  event_id: eventId,
  attendee_id: attendeeId,
  status,
  registered_at: "2026-11-02T01:00:00.000Z",
  withdrawn_at: null,
  waitlist_position: null,
  ...changes
});

const setup = ({ eventChanges = {}, registrations, now = NOW } = {}) => {
  const firestore = fakeFirestore({
    events: { e1: event(eventChanges) },
    registrations: registrations || { "e1_attendee-1": record("e1", "attendee-1"), "e1_other": record("e1", "other") }
  });
  const actions = createAttendeeRegistration({ firestore, serverTimestamp: () => STAMP, now: () => now });
  return {
    firestore,
    withdraw: (attendeeId = "attendee-1", eventId = "e1") => actions.withdraw({ eventId, attendeeId }),
    register: (attendeeId, eventId = "e1") => actions.register({ eventId, attendeeId })
  };
};

const refusedWith = async (promise, statusCode, reason, message) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.reason, reason);
    if (message) assert.match(error.message, message);
    return true;
  });
};

// ---- AC2, AC4: the place is given back ---------------------------------------------

test("TC-648 H5 AC2 a Registered attendee withdraws: their record becomes Withdrawn, with the time", async () => {
  const { firestore, withdraw } = setup();
  await withdraw();
  assert.deepEqual(firestore.store.registrations["e1_attendee-1"], {
    ...record("e1", "attendee-1"),
    status: "WITHDRAWN",
    withdrawn_at: STAMP
  });
  assert.deepEqual(firestore.log.writes, ["registrations/e1_attendee-1"]);
  assert.equal(firestore.store.registrations.e1_other.status, "REGISTERED");
});

test("TC-649 H5 AC4 the withdrawn place is free again for the next attendee", async () => {
  const { register, withdraw } = setup();
  await refusedWith(register("newcomer"), 409, "full");
  const result = await withdraw();
  assert.equal(result.remaining_places, 1);
  assert.equal((await register("newcomer")).registration.status, "REGISTERED");
});

test("TC-650 H5 AC3 the reply describes the registration as the attendee now sees it", async () => {
  const { withdraw } = setup();
  const result = await withdraw();
  assert.equal(result.registration.registration_id, "e1_attendee-1");
  assert.equal(result.registration.status, "WITHDRAWN");
  assert.equal(result.registration.withdrawn_at, NOW.toISOString());
  assert.equal(result.registration.active, false);
  assert.equal(result.registration.can_withdraw, false);
  assert.equal(result.registration.name, "Harbour Tech Forum");
  for (const field of ["organiser_id", "attendee_id", "registration_capacity"]) {
    assert.equal(Object.hasOwn(result.registration, field), false, `${field} leaked`);
  }
});

test("TC-651 H5 a registration under an older record id is withdrawn in that record", async () => {
  const { firestore, withdraw } = setup({ registrations: { "e1-attendee-1-MOCKDATA": record("e1", "attendee-1") } });
  await withdraw();
  assert.equal(firestore.store.registrations["e1-attendee-1-MOCKDATA"].status, "WITHDRAWN");
  assert.deepEqual(firestore.log.writes, ["registrations/e1-attendee-1-MOCKDATA"]);
});

test("TC-652 H5 the check and the write are one transaction", async () => {
  const { firestore, withdraw } = setup();
  await withdraw();
  assert.equal(firestore.log.transactions, 1);
  assert.ok(firestore.log.reads.includes("events/e1"));
  assert.ok(firestore.log.reads.includes("registrations/e1_attendee-1"));
});

// ---- AC6 and the event's own state: refused, nothing written -----------------------

test("TC-653 H5 AC6 an attendee with no registration for the event is refused", async () => {
  const { firestore, withdraw } = setup();
  await refusedWith(withdraw("stranger"), 409, "not_registered", /not registered for this event/i);
  assert.deepEqual(firestore.log.writes, []);
});

for (const status of ["WITHDRAWN", "CANCELLED"]) {
  test(`TC-654 H5 AC6 a ${status} attendee holds no place, so is refused`, async () => {
    const { firestore, withdraw } = setup({ registrations: { "e1_attendee-1": record("e1", "attendee-1", status) } });
    await refusedWith(withdraw(), 409, "not_registered");
    assert.deepEqual(firestore.log.writes, []);
  });
}

test("TC-655 H5 AC6 withdrawing twice is refused the second time", async () => {
  const { firestore, withdraw } = setup();
  await withdraw();
  await refusedWith(withdraw(), 409, "not_registered");
  assert.deepEqual(firestore.log.writes, ["registrations/e1_attendee-1"]);
});

test("TC-656 H5 one attendee cannot withdraw another's place", async () => {
  const { firestore, withdraw } = setup({ registrations: { e1_other: record("e1", "other") } });
  await refusedWith(withdraw("attendee-1"), 409, "not_registered");
  assert.equal(firestore.store.registrations.e1_other.status, "REGISTERED");
});

test("TC-657 H5 once the event has started there is nothing to withdraw from", async () => {
  const { firestore, withdraw } = setup({ now: new Date("2026-11-12T09:00:00+08:00") });
  await refusedWith(withdraw(), 409, "event_started", /already started/i);
  assert.deepEqual(firestore.log.writes, []);
});

for (const status of ["CANCELLED", "COMPLETED", "REJECTED"]) {
  test(`TC-658 H5 a ${status} event cannot be withdrawn from`, async () => {
    const { firestore, withdraw } = setup({ eventChanges: { status } });
    await refusedWith(withdraw(), 409, "event_closed");
    assert.deepEqual(firestore.log.writes, []);
  });
}

test("TC-659 H5 withdrawal is allowed after registration has closed, until the event starts", async () => {
  const { withdraw } = setup({ now: new Date("2026-11-11T20:00:00+08:00") });
  assert.equal((await withdraw()).registration.status, "WITHDRAWN");
});

test("TC-660 H5 an event that does not exist is refused as not found", async () => {
  const { firestore, withdraw } = setup();
  await refusedWith(withdraw("attendee-1", "missing"), 404, "not_found");
  assert.deepEqual(firestore.log.writes, []);
});

// ---- the route --------------------------------------------------------------------

const call = async ({ firestore, uid = "attendee-1", authorization = "Bearer valid-token" }) => {
  const app = express();
  app.use(express.json());
  app.use("/api/registrations", createRegistrationService({
    firestore,
    verifyIdToken: async (token) => {
      if (token !== "valid-token") throw new Error("invalid");
      return { uid };
    },
    now: () => NOW,
    serverTimestamp: () => STAMP,
    venueNamesFor: async () => ["Harbour Hall"]
  }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const headers = authorization ? { Authorization: authorization } : {};
    const response = await fetch(`http://127.0.0.1:${port}/api/registrations/events/e1/withdraw`, { method: "POST", headers });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

const routeStore = (registrations = { "e1_attendee-1": record("e1", "attendee-1") }) => fakeFirestore({
  users: { "attendee-1": { role: "ATTENDEE" }, "organiser-1": { role: "EVENT_ORGANISER" } },
  events: { e1: event() },
  registrations
});

test("TC-661 H5 AC2 AC3 POST withdraw answers 200 with the updated registration, venues included", async () => {
  const { status, body } = await call({ firestore: routeStore() });
  assert.equal(status, 200);
  assert.equal(body.registration.status, "WITHDRAWN");
  assert.deepEqual(body.registration.venue_names, ["Harbour Hall"]);
  assert.equal(body.remaining_places, 2);
});

test("TC-662 H5 AC6 a refusal is answered with its reason and message", async () => {
  const { status, body } = await call({ firestore: routeStore({}) });
  assert.equal(status, 409);
  assert.equal(body.reason, "not_registered");
  assert.match(body.error, /not registered/i);
});

test("TC-663 H5 only a signed-in Attendee may withdraw; nothing is written otherwise", async () => {
  const firestore = routeStore();
  assert.equal((await call({ firestore, authorization: null })).status, 401);
  assert.equal((await call({ firestore, authorization: "Bearer junk" })).status, 401);
  const organiser = await call({ firestore, uid: "organiser-1" });
  assert.equal(organiser.status, 403);
  assert.match(organiser.body.error, /only attendees/i);
  assert.equal(firestore.log.transactions, 0);
  assert.equal(firestore.store.registrations["e1_attendee-1"].status, "REGISTERED");
});

// ---- H6 — leaving the waiting list ------------------------------------------------

const queue = () => ({
  e1_x1: record("e1", "x1"),
  e1_x2: record("e1", "x2"),
  e1_first: record("e1", "first", "WAITLISTED", { waitlisted_at: "2026-11-04T01:00:00.000Z", registered_at: null }),
  "e1_attendee-1": record("e1", "attendee-1", "WAITLISTED", { waitlisted_at: "2026-11-04T02:00:00.000Z", registered_at: null }),
  e1_last: record("e1", "last", "WAITLISTED", { waitlisted_at: "2026-11-04T03:00:00.000Z", registered_at: null })
});

test("TC-711 H6 a waitlisted attendee withdraws: their record becomes Withdrawn and no place is freed", async () => {
  const { firestore, withdraw } = setup({ registrations: queue() });
  const result = await withdraw();
  assert.equal(firestore.store.registrations["e1_attendee-1"].status, "WITHDRAWN");
  assert.equal(firestore.store.registrations["e1_attendee-1"].withdrawn_at, STAMP);
  assert.deepEqual(firestore.log.writes, ["registrations/e1_attendee-1"]);
  assert.equal(result.registration.status, "WITHDRAWN");
  assert.equal(result.remaining_places, 0);
});

test("TC-712 H6 AC2 everyone behind the one who left moves up the waiting list", async () => {
  const firestore = fakeFirestore({
    users: { last: { role: "ATTENDEE" }, "attendee-1": { role: "ATTENDEE" } },
    events: { e1: event() },
    registrations: queue()
  });
  const app = express();
  app.use("/api/registrations", createRegistrationService({
    firestore,
    verifyIdToken: async (token) => ({ uid: token }),
    now: () => NOW,
    serverTimestamp: () => STAMP,
    venueNamesFor: async () => []
  }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/registrations`;
    const positionOfLast = async () => (await (await fetch(`${base}/mine`, { headers: { Authorization: "Bearer last" } })).json())
      .registrations.find((entry) => entry.event_id === "e1").waitlist_position;

    assert.equal(await positionOfLast(), 3);
    const left = await fetch(`${base}/events/e1/withdraw`, { method: "POST", headers: { Authorization: "Bearer attendee-1" } });
    assert.equal(left.status, 200);
    assert.equal(await positionOfLast(), 2);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("TC-713 H6 an attendee who left the waiting list may join it again, at the back", async () => {
  const actions = setup({ registrations: queue() });
  await actions.withdraw();
  const { joinWaitlist } = createAttendeeRegistration({ firestore: actions.firestore, serverTimestamp: () => STAMP, now: () => NOW });
  const rejoined = await joinWaitlist({ eventId: "e1", attendeeId: "attendee-1" });
  assert.equal(rejoined.registration.waitlist_position, 3);
});
