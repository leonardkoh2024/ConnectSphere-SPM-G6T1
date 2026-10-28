// H3 / SCRUM-141 — Register for an event. The registration service's transaction: one
// record per attendee and event, the place counted and taken in the same transaction.
//
// Registering is a service call, not a browser write: firestore.rules cannot count the
// registrations an event already has, nor see an attendee's other registration, so AC5
// (full), AC7 (capacity goes down) and AC8 (no duplicate) can only hold here. The same
// transaction keeps H1 AC4 — a registration outside the open window is refused, by the
// server's clock — now that the browser create rule is gone.
// Runs under node's test runner: `npm run test:backend`.

import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { fakeFirestore } from "../../../testing/fakeFirestore.js";
import { createAttendeeRegistration, registrationIdFor } from "./register.js";
import { createRegistrationService } from "./service.js";

const NOW = new Date("2026-11-05T12:00:00+08:00");
const STAMP = { serverTimestamp: true };

const event = (changes = {}) => ({
  organiser_id: "organiser-1",
  coordinator_id: "coordinator-1",
  reference_no: "EVT-0001",
  name: "Harbour Tech Forum",
  description: "A day of talks on port technology.",
  event_date: "2026-11-12",
  start_time: "09:00",
  end_time: "17:00",
  status: "CONFIRMED",
  registration_required: true,
  registration_capacity: 3,
  registration_open_date: "2026-11-01",
  registration_open_time: "09:00",
  registration_close_date: "2026-11-10",
  registration_close_time: "17:00",
  ...changes
});

const registered = (eventId, attendeeId, status = "REGISTERED") => ({ event_id: eventId, attendee_id: attendeeId, status });

const setup = ({ eventChanges = {}, registrations = {} } = {}) => {
  const firestore = fakeFirestore({ events: { e1: event(eventChanges) }, registrations });
  const actions = createAttendeeRegistration({ firestore, serverTimestamp: () => STAMP, now: () => NOW });
  return { firestore, register: (attendeeId = "attendee-1", eventId = "e1") => actions.register({ eventId, attendeeId }) };
};

const refusedWith = async (promise, statusCode, reason, message) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.reason, reason);
    if (message) assert.match(error.message, message);
    return true;
  });
};

// ---- AC2, AC7: a place is taken and the count goes down ---------------------------

test("TC-573 H3 AC2 an attendee registers for an open event with a place free", async () => {
  const { firestore, register } = setup();
  const result = await register();

  assert.deepEqual(firestore.store.registrations["e1_attendee-1"], {
    registration_id: "e1_attendee-1",
    event_id: "e1",
    attendee_id: "attendee-1",
    status: "REGISTERED",
    registered_at: STAMP,
    withdrawn_at: null,
    waitlist_position: null
  });
  assert.deepEqual(firestore.log.writes, [
    "registrations/e1_attendee-1",
    "notifications/REGISTRATION_CONFIRMED-e1-attendee-1"
  ]);
  assert.equal(
    firestore.store.notifications["REGISTRATION_CONFIRMED-e1-attendee-1"].message,
    "Harbour Tech Forum: your registration is confirmed."
  );
  assert.equal(result.registration.registration_id, "e1_attendee-1");
  assert.equal(result.registration.status, "REGISTERED");
});

test("TC-574 H3 the record id is one per attendee and event", () => {
  assert.equal(registrationIdFor("e1", "attendee-1"), "e1_attendee-1");
  assert.notEqual(registrationIdFor("e1", "attendee-1"), registrationIdFor("e2", "attendee-1"));
});

test("TC-575 H3 AC7 each registration reduces the places left by one", async () => {
  const { register } = setup();
  assert.equal((await register("a1")).event.remaining_places, 2);
  assert.equal((await register("a2")).event.remaining_places, 1);
  assert.equal((await register("a3")).event.remaining_places, 0);
});

test("TC-576 H3 AC7 only Registered places count; withdrawn, waitlisted and cancelled do not", async () => {
  const { register } = setup({
    registrations: {
      r1: registered("e1", "x1"),
      r2: registered("e1", "x2", "WITHDRAWN"),
      r3: registered("e1", "x3", "WAITLISTED"),
      r4: registered("e1", "x4", "CANCELLED"),
      r5: registered("other-event", "x5")
    }
  });
  const result = await register();
  assert.equal(result.event.remaining_places, 1);
});

test("TC-577 H3 the count, the duplicate check and the write are one transaction", async () => {
  const { firestore, register } = setup();
  await register();
  assert.equal(firestore.log.transactions, 1);
  assert.ok(firestore.log.reads.includes("events/e1"));
  assert.ok(firestore.log.reads.includes("registrations/e1_attendee-1"));
  assert.ok(firestore.log.reads.includes("registrations?event_id=e1&status=REGISTERED"));
});

// ---- AC3, AC4: confirmation and the event's details -------------------------------

test("TC-578 H3 AC3 AC4 the reply confirms the registration and carries the event's public details", async () => {
  const { register } = setup();
  const result = await register();
  assert.deepEqual(result.event, {
    id: "e1",
    name: "Harbour Tech Forum",
    description: "A day of talks on port technology.",
    event_date: "2026-11-12",
    start_time: "09:00",
    end_time: "17:00",
    venue_names: [],
    capacity: 3,
    remaining_places: 2,
    registration_closes_at: "2026-11-10T09:00:00.000Z"
  });
  assert.equal(result.registration.registered_at, NOW.toISOString());
  for (const field of ["organiser_id", "coordinator_id", "reference_no", "status"]) {
    assert.equal(Object.hasOwn(result.event, field), false, `${field} leaked`);
  }
});

// ---- AC5: full ------------------------------------------------------------------

test("TC-579 H3 AC5 a full event is refused as full, and nothing is written", async () => {
  const { firestore, register } = setup({
    registrations: { r1: registered("e1", "x1"), r2: registered("e1", "x2"), r3: registered("e1", "x3") }
  });
  await refusedWith(register(), 409, "full", /this event is full/i);
  assert.deepEqual(firestore.log.writes, []);
});

test("TC-579 H3 AC5 the last place goes to the first; the next attendee is told it is full", async () => {
  const { register } = setup({ registrations: { r1: registered("e1", "x1"), r2: registered("e1", "x2") } });
  await register("a1");
  await refusedWith(register("a2"), 409, "full");
});

// ---- AC8: no duplicate ----------------------------------------------------------

test("TC-580 H3 AC8 an attendee already registered is refused, and nothing is written", async () => {
  const { firestore, register } = setup();
  await register();
  await refusedWith(register(), 409, "already_registered", /already registered/i);
  assert.deepEqual(firestore.log.writes, [
    "registrations/e1_attendee-1",
    "notifications/REGISTRATION_CONFIRMED-e1-attendee-1"
  ]);
});

test("TC-580 H3 AC8 a registration under an older record id still counts as a duplicate", async () => {
  const { firestore, register } = setup({ registrations: { "e1-attendee-1-MOCKDATA": registered("e1", "attendee-1") } });
  await refusedWith(register(), 409, "already_registered");
  assert.deepEqual(firestore.log.writes, []);
});

test("TC-581 H3 AC8 a duplicate is refused even when the event is also full", async () => {
  const { register } = setup({
    registrations: { "e1_attendee-1": registered("e1", "attendee-1"), r2: registered("e1", "x2"), r3: registered("e1", "x3") }
  });
  await refusedWith(register(), 409, "already_registered");
});

test("TC-582 H3 an attendee who withdrew may register again, into the same record", async () => {
  const { firestore, register } = setup({
    registrations: { "e1_attendee-1": { ...registered("e1", "attendee-1", "WITHDRAWN"), withdrawn_at: "earlier" } }
  });
  await register();
  assert.equal(firestore.store.registrations["e1_attendee-1"].status, "REGISTERED");
  assert.equal(firestore.store.registrations["e1_attendee-1"].withdrawn_at, null);
});

// ---- AC6 and H1 AC4: outside the window, or not registrable at all ---------------

test("TC-583 H3 AC6 H1 AC4 registration after the window has closed is refused, and nothing is written", async () => {
  const { firestore, register } = setup({ eventChanges: { registration_close_date: "2026-11-04" } });
  await refusedWith(register(), 409, "closed", /registration has closed/i);
  assert.deepEqual(firestore.log.writes, []);
});

test("TC-584 H1 AC4 registration before the window opens is refused, and nothing is written", async () => {
  const { firestore, register } = setup({ eventChanges: { registration_open_date: "2026-11-06" } });
  await refusedWith(register(), 409, "not_open_yet", /not open yet/i);
  assert.deepEqual(firestore.log.writes, []);
});

test("TC-585 H1 AC4 the window opens at its opening minute and closes at its closing minute, by the server clock", async () => {
  const at = (iso) => createAttendeeRegistration({
    firestore: fakeFirestore({ events: { e1: event() }, registrations: {} }),
    serverTimestamp: () => STAMP,
    now: () => new Date(iso)
  }).register({ eventId: "e1", attendeeId: "attendee-1" });
  await refusedWith(at("2026-11-01T08:59:59+08:00"), 409, "not_open_yet");
  assert.equal((await at("2026-11-01T09:00:00+08:00")).registration.status, "REGISTERED");
  assert.equal((await at("2026-11-10T16:59:59+08:00")).registration.status, "REGISTERED");
  await refusedWith(at("2026-11-10T17:00:00+08:00"), 409, "closed");
});

test("TC-586 H1 AC4 an event with no window set is refused as not open", async () => {
  const { firestore, register } = setup({ eventChanges: { registration_open_date: null, registration_close_date: null } });
  await refusedWith(register(), 409, "not_open_yet");
  assert.deepEqual(firestore.log.writes, []);
});

for (const status of ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "COMPLETED", "CANCELLED", "REJECTED"]) {
  test(`TC-587 H1 AC4 an event in ${status} takes no registration, even inside its window`, async () => {
    const { firestore, register } = setup({ eventChanges: { status } });
    await refusedWith(register(), 409, "status");
    assert.deepEqual(firestore.log.writes, []);
  });
}

for (const status of ["APPROVED", "PLANNING", "SAFETY_REVIEW", "CONFIRMED"]) {
  test(`TC-587 H1 AC4 an event in ${status} takes registrations inside its window`, async () => {
    const { register } = setup({ eventChanges: { status } });
    assert.equal((await register()).registration.status, "REGISTERED");
  });
}

test("TC-588 H1 AC4 an event that does not use registration is refused", async () => {
  const { firestore, register } = setup({ eventChanges: { registration_required: false } });
  await refusedWith(register(), 409, "not_enabled", /does not use attendee registration/i);
  assert.deepEqual(firestore.log.writes, []);
});

test("TC-589 H3 an event without a usable capacity is refused, since no place can be counted", async () => {
  const { firestore, register } = setup({ eventChanges: { registration_capacity: null } });
  await refusedWith(register(), 409, "no_capacity");
  assert.deepEqual(firestore.log.writes, []);
});

test("TC-590 H3 an event that does not exist is refused as not found", async () => {
  const { firestore, register } = setup();
  await refusedWith(register("attendee-1", "missing"), 404, "not_found");
  assert.deepEqual(firestore.log.writes, []);
});

// ---- the route ------------------------------------------------------------------

const call = async ({ firestore, uid = "attendee-1", authorization = "Bearer valid-token", path = "/api/registrations/events/e1/register", method = "POST" }) => {
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
    venueNamesFor: async (eventId) => (eventId === "e1" ? ["Harbour Hall", "Pier Room"] : [])
  }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const headers = { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) };
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

const routeStore = (registrations = {}) => fakeFirestore({
  users: { "attendee-1": { role: "ATTENDEE" }, "organiser-1": { role: "EVENT_ORGANISER" } },
  events: { e1: event() },
  registrations
});

test("TC-591 H3 AC2 AC3 AC4 POST register answers 201 with the registration and the event's details, venues included", async () => {
  const firestore = routeStore();
  const { status, body } = await call({ firestore });
  assert.equal(status, 201);
  assert.equal(body.registration.status, "REGISTERED");
  assert.deepEqual(body.event.venue_names, ["Harbour Hall", "Pier Room"]);
  assert.equal(body.event.remaining_places, 2);
});

test("TC-592 H3 AC5 AC8 a refusal is answered with its reason and message", async () => {
  const firestore = routeStore({ "e1_attendee-1": registered("e1", "attendee-1") });
  const { status, body } = await call({ firestore });
  assert.equal(status, 409);
  assert.equal(body.reason, "already_registered");
  assert.match(body.error, /already registered/i);
});

test("TC-593 H3 only a signed-in Attendee may register; nothing is written otherwise", async () => {
  const firestore = routeStore();
  assert.equal((await call({ firestore, authorization: null })).status, 401);
  assert.equal((await call({ firestore, authorization: "Bearer junk" })).status, 401);
  const organiser = await call({ firestore, uid: "organiser-1" });
  assert.equal(organiser.status, 403);
  assert.match(organiser.body.error, /only attendees/i);
  assert.equal(firestore.log.transactions, 0);
  assert.deepEqual(firestore.log.writes, []);
});

test("TC-594 H3 AC8 the open-events list tells the attendee which events they are already registered for", async () => {
  const firestore = fakeFirestore({
    users: { "attendee-1": { role: "ATTENDEE" } },
    events: { e1: event(), e2: event({ name: "Second", event_date: "2026-11-13" }) },
    registrations: { "e1_attendee-1": registered("e1", "attendee-1"), "e2_attendee-1": registered("e2", "attendee-1", "WITHDRAWN") }
  });
  const { status, body } = await call({ firestore, path: "/api/registrations/open-events", method: "GET" });
  assert.equal(status, 200);
  assert.deepEqual(body.events.map((entry) => [entry.id, entry.registration_status]), [["e1", "REGISTERED"], ["e2", null]]);
});
