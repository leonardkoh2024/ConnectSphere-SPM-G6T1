// H6 / SCRUM-144 — Join the waiting list when an event is full. The registration service's
// transaction: an attendee joins only a full event that is still taking registrations, and
// their one record for the event becomes Waitlisted. The position is worked out from the
// time each attendee joined (first come, first served), never stored, so it stays exact.
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

const record = (attendeeId, status, changes = {}) => ({
  registration_id: `e1_${attendeeId}`,
  event_id: "e1",
  attendee_id: attendeeId,
  status,
  ...changes
});

// Full: two places, both taken.
const full = () => ({ e1_x1: record("x1", "REGISTERED"), e1_x2: record("x2", "REGISTERED") });

const setup = ({ eventChanges = {}, registrations = full() } = {}) => {
  const firestore = fakeFirestore({ events: { e1: event(eventChanges) }, registrations });
  const actions = createAttendeeRegistration({ firestore, serverTimestamp: () => STAMP, now: () => NOW });
  return {
    firestore,
    join: (attendeeId = "attendee-1", eventId = "e1") => actions.joinWaitlist({ eventId, attendeeId }),
    register: (attendeeId = "attendee-1", eventId = "e1") => actions.register({ eventId, attendeeId })
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

// ---- AC1: joining a full event ------------------------------------------------------

test("TC-686 H6 AC1 an attendee joins the waiting list of a full event and is Waitlisted at once", async () => {
  const { firestore, join } = setup();
  const result = await join();

  assert.deepEqual(firestore.store.registrations["e1_attendee-1"], {
    registration_id: "e1_attendee-1",
    event_id: "e1",
    attendee_id: "attendee-1",
    status: "WAITLISTED",
    waitlisted_at: STAMP,
    registered_at: null,
    withdrawn_at: null,
    waitlist_position: null
  });
  assert.deepEqual(firestore.log.writes, ["registrations/e1_attendee-1"]);
  assert.equal(result.registration.status, "WAITLISTED");
  assert.equal(result.registration.waitlist_position, 1);
});

test("TC-687 H6 AC2 each later joiner is placed behind everyone already waiting", async () => {
  const { join } = setup({
    registrations: { ...full(), e1_w1: record("w1", "WAITLISTED", { waitlisted_at: "2026-11-04T01:00:00.000Z" }) }
  });
  assert.equal((await join("a1")).registration.waitlist_position, 2);
  assert.equal((await join("a2")).registration.waitlist_position, 3);
});

test("TC-688 H6 AC1 while a place is free the attendee is told to register instead, and nothing is written", async () => {
  const { firestore, join } = setup({ registrations: { e1_x1: record("x1", "REGISTERED") } });
  await refusedWith(join(), 409, "places_available", /a place is free/i);
  assert.deepEqual(firestore.log.writes, []);
});

test("TC-689 H6 the join, the count and the check are one transaction", async () => {
  const { firestore, join } = setup();
  await join();
  assert.equal(firestore.log.transactions, 1);
  assert.ok(firestore.log.reads.includes("events/e1"));
  // One read of the event's registrations gives the places taken and the waiting list.
  assert.ok(firestore.log.reads.includes("registrations?event_id=e1"));
});

test("TC-690 H6 an attendee who withdrew may join the waiting list, in the same record", async () => {
  const { firestore, join } = setup({
    registrations: { ...full(), "e1_attendee-1": record("attendee-1", "WITHDRAWN", { withdrawn_at: "earlier" }) }
  });
  await join();
  assert.equal(firestore.store.registrations["e1_attendee-1"].status, "WAITLISTED");
  assert.equal(firestore.store.registrations["e1_attendee-1"].withdrawn_at, null);
});

// ---- AC3: never both Registered and Waitlisted --------------------------------------

test("TC-691 H6 AC3 an attendee already registered cannot also join the waiting list", async () => {
  const { firestore, join } = setup({ registrations: { "e1_attendee-1": record("attendee-1", "REGISTERED"), e1_x2: record("x2", "REGISTERED") } });
  await refusedWith(join(), 409, "already_registered", /already registered/i);
  assert.deepEqual(firestore.log.writes, []);
});

test("TC-692 H6 AC3 an attendee already waiting cannot join twice, even under an older record id", async () => {
  const { firestore, join } = setup();
  await join();
  await refusedWith(join(), 409, "already_waitlisted", /already on the waiting list/i);

  const legacy = setup({ registrations: { ...full(), "e1-attendee-1-MOCKDATA": record("attendee-1", "WAITLISTED") } });
  await refusedWith(legacy.join(), 409, "already_waitlisted");
  assert.deepEqual(legacy.firestore.log.writes, []);
  assert.deepEqual(firestore.log.writes, ["registrations/e1_attendee-1"]);
});

test("TC-693 H6 AC3 a waitlisted attendee cannot register past the queue, even when a place frees", async () => {
  const { firestore, register } = setup({
    registrations: { e1_x1: record("x1", "REGISTERED"), "e1_attendee-1": record("attendee-1", "WAITLISTED") }
  });
  await refusedWith(register(), 409, "waitlisted", /on the waiting list/i);
  assert.equal(firestore.store.registrations["e1_attendee-1"].status, "WAITLISTED");
  assert.deepEqual(firestore.log.writes, []);
});

// ---- the event must still be taking registrations (H1 AC4's window) -----------------

test("TC-694 H6 the waiting list closes with registration", async () => {
  const closed = setup({ eventChanges: { registration_close_date: "2026-11-04" } });
  await refusedWith(closed.join(), 409, "closed");
  const early = setup({ eventChanges: { registration_open_date: "2026-11-06" } });
  await refusedWith(early.join(), 409, "not_open_yet");
  const cancelled = setup({ eventChanges: { status: "CANCELLED" } });
  await refusedWith(cancelled.join(), 409, "status");
  const off = setup({ eventChanges: { registration_required: false } });
  await refusedWith(off.join(), 409, "not_enabled");
  for (const { firestore } of [closed, early, cancelled, off]) assert.deepEqual(firestore.log.writes, []);
});

test("TC-695 H6 an event that does not exist, or has no usable capacity, is refused", async () => {
  const { firestore, join } = setup();
  await refusedWith(join("attendee-1", "missing"), 404, "not_found");
  const noCapacity = setup({ eventChanges: { registration_capacity: null } });
  await refusedWith(noCapacity.join(), 409, "no_capacity");
  assert.deepEqual(firestore.log.writes, []);
});

// ---- AC2 in the lists: the live position --------------------------------------------

const serviceApp = (firestore, uid = "attendee-1") => {
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
  return app;
};

const call = async ({ firestore, uid, path, method = "GET", authorization = "Bearer valid-token" }) => {
  const server = serviceApp(firestore, uid).listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const headers = authorization ? { Authorization: authorization } : {};
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

const waitingStore = () => fakeFirestore({
  users: { "attendee-1": { role: "ATTENDEE" }, "organiser-1": { role: "EVENT_ORGANISER" } },
  events: { e1: event() },
  registrations: {
    ...full(),
    e1_first: record("first", "WAITLISTED", { waitlisted_at: "2026-11-04T01:00:00.000Z" }),
    "e1_attendee-1": record("attendee-1", "WAITLISTED", { waitlisted_at: "2026-11-04T02:00:00.000Z" }),
    e1_last: record("last", "WAITLISTED", { waitlisted_at: "2026-11-04T03:00:00.000Z" })
  }
});

test("TC-696 H6 AC2 My registrations gives the attendee's exact position, worked out from join times", async () => {
  const { status, body } = await call({ firestore: waitingStore(), path: "/api/registrations/mine" });
  assert.equal(status, 200);
  const entry = body.registrations.find((item) => item.event_id === "e1");
  assert.equal(entry.status, "WAITLISTED");
  assert.equal(entry.waitlist_position, 2);
});

test("TC-697 H6 AC2 the open-events list gives the attendee's status and position on the event", async () => {
  const { body } = await call({ firestore: waitingStore(), path: "/api/registrations/open-events" });
  const entry = body.events.find((item) => item.id === "e1");
  assert.equal(entry.registration_status, "WAITLISTED");
  assert.equal(entry.waitlist_position, 2);
  assert.equal(entry.remaining_places, 0);
});

test("TC-698 H6 AC1 POST waitlist answers 201 with the Waitlisted registration and its position", async () => {
  const firestore = fakeFirestore({
    users: { "attendee-1": { role: "ATTENDEE" } },
    events: { e1: event() },
    registrations: full()
  });
  const { status, body } = await call({ firestore, path: "/api/registrations/events/e1/waitlist", method: "POST" });
  assert.equal(status, 201);
  assert.equal(body.registration.status, "WAITLISTED");
  assert.equal(body.registration.waitlist_position, 1);
  assert.deepEqual(body.registration.venue_names, ["Harbour Hall"]);
});

test("TC-699 H6 a refusal is answered with its reason; only a signed-in Attendee may join", async () => {
  const firestore = fakeFirestore({
    users: { "attendee-1": { role: "ATTENDEE" }, "organiser-1": { role: "EVENT_ORGANISER" } },
    events: { e1: event() },
    registrations: { e1_x1: record("x1", "REGISTERED") }
  });
  const refused = await call({ firestore, path: "/api/registrations/events/e1/waitlist", method: "POST" });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.reason, "places_available");

  assert.equal((await call({ firestore, path: "/api/registrations/events/e1/waitlist", method: "POST", authorization: null })).status, 401);
  const organiser = await call({ firestore, uid: "organiser-1", path: "/api/registrations/events/e1/waitlist", method: "POST" });
  assert.equal(organiser.status, 403);
  assert.match(organiser.body.error, /only attendees/i);
  assert.equal(firestore.log.transactions, 1);
});
