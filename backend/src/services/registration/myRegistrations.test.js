// H4 / SCRUM-142 — See the status of my registrations. The registration service's read of
// the signed-in attendee's own registrations, each with the public details of its event.
//
// Why this is a service and not a browser read: an attendee has no Firestore read on
// `registrations` or `events` (A4/A5), and an event carries far more than an attendee should
// see. So the list is built here with the Admin SDK, and only the attendee's own records leave.
// Runs under node's test runner: `npm run test:backend`.

import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { createRegistrationService } from "./service.js";

const NOW = new Date("2026-11-05T12:00:00+08:00");

// A plain-document Firestore stand-in: equality `where` chains, `get`, `count` and single
// documents, recording every read so the tests can say what was and was not touched.
const fakeFirestore = (collections) => {
  const reads = [];
  const query = (name, filters = []) => ({
    where(field, op, value) {
      assert.equal(op, "==");
      return query(name, [...filters, [field, value]]);
    },
    async get() {
      reads.push(`${name}?${filters.map(([f, v]) => `${f}=${v}`).join("&")}`);
      const docs = Object.entries(collections[name] || {})
        .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
        .map(([id, data]) => ({ id, data: () => data }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
    count() {
      return { get: async () => ({ data: () => ({ count: 0 }) }) };
    }
  });
  return {
    reads,
    collection: (name) => ({
      where: (field, op, value) => query(name).where(field, op, value),
      doc: (id) => ({
        async get() {
          reads.push(`${name}/${id}`);
          const data = (collections[name] || {})[id];
          return { id, exists: Boolean(data), data: () => data };
        }
      })
    })
  };
};

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
  cancellation_reason: null,
  registration_required: true,
  registration_capacity: 150,
  ...changes
});

const data = () => ({
  users: {
    "attendee-1": { role: "ATTENDEE" },
    "attendee-2": { role: "ATTENDEE" },
    "organiser-1": { role: "EVENT_ORGANISER" }
  },
  events: {
    forum: event(),
    expo: event({ name: "Harbour Expo", event_date: "2026-11-20" }),
    gala: event({ name: "Winter Gala", event_date: "2026-12-10", status: "CANCELLED", cancellation_reason: "Venue flooded" }),
    talk: event({ name: "Evening Talk", event_date: "2026-11-15" }),
    others: event({ name: "Someone Else's Event", event_date: "2026-11-13" })
  },
  registrations: {
    "forum_attendee-1": { registration_id: "forum_attendee-1", event_id: "forum", attendee_id: "attendee-1", status: "REGISTERED", registered_at: "2026-11-01T02:00:00.000Z" },
    "expo_attendee-1": { registration_id: "expo_attendee-1", event_id: "expo", attendee_id: "attendee-1", status: "WAITLISTED", waitlist_position: 2 },
    "gala_attendee-1": { registration_id: "gala_attendee-1", event_id: "gala", attendee_id: "attendee-1", status: "REGISTERED" },
    "talk-attendee-1-MOCKDATA": { registration_id: "talk-attendee-1-MOCKDATA", event_id: "talk", attendee_id: "attendee-1", status: "WITHDRAWN", withdrawn_at: "2026-11-02T03:00:00.000Z" },
    "others_attendee-2": { registration_id: "others_attendee-2", event_id: "others", attendee_id: "attendee-2", status: "REGISTERED" },
    "ghost_attendee-1": { registration_id: "ghost_attendee-1", event_id: "deleted-event", attendee_id: "attendee-1", status: "REGISTERED" }
  },
  venue_bookings: {
    b1: { event_id: "forum", venue_id: "V1", status: "APPROVED" },
    b2: { event_id: "gala", venue_id: "V2", status: "APPROVED" }
  },
  venues: { V1: { name: "Harbour Hall" }, V2: { name: "Pier Room" } }
});

const request = async ({ firestore, uid = "attendee-1", authorization = "Bearer valid-token" }) => {
  const app = express();
  app.use(express.json());
  app.use("/api/registrations", createRegistrationService({
    firestore,
    verifyIdToken: async (token) => {
      if (token !== "valid-token") throw new Error("invalid");
      return { uid };
    },
    now: () => NOW
  }));
  app.use((_error, _request, response, _next) => response.status(500).json({ error: "Internal server error" }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const headers = authorization ? { Authorization: authorization } : {};
    const response = await fetch(`http://127.0.0.1:${port}/api/registrations/mine`, { headers });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test("TC-618 H4 AC1 an attendee is given their own registrations, soonest event first", async () => {
  const { status, body } = await request({ firestore: fakeFirestore(data()) });
  assert.equal(status, 200);
  assert.deepEqual(body.registrations.map((entry) => entry.event_id), ["forum", "talk", "expo", "gala"]);
});

test("TC-619 H4 AC1 each entry shows the event's name, date, window, venue and the attendee's status", async () => {
  const { body } = await request({ firestore: fakeFirestore(data()) });
  const forum = body.registrations.find((entry) => entry.event_id === "forum");
  assert.deepEqual(forum, {
    registration_id: "forum_attendee-1",
    event_id: "forum",
    name: "Harbour Tech Forum",
    description: "A day of talks on port technology.",
    event_date: "2026-11-12",
    start_time: "09:00",
    end_time: "17:00",
    venue_names: ["Harbour Hall"],
    status: "REGISTERED",
    registered_at: "2026-11-01T02:00:00.000Z",
    withdrawn_at: null,
    waitlist_position: null
  });
  const statuses = Object.fromEntries(body.registrations.map((entry) => [entry.event_id, entry.status]));
  assert.deepEqual(statuses, { forum: "REGISTERED", talk: "WITHDRAWN", expo: "WAITLISTED", gala: "CANCELLED" });
});

test("TC-620 H4 AC3 a registration on a cancelled event stays in the list, marked Cancelled, without the internal reason", async () => {
  const { body } = await request({ firestore: fakeFirestore(data()) });
  const gala = body.registrations.find((entry) => entry.event_id === "gala");
  assert.equal(gala.status, "CANCELLED");
  assert.deepEqual(gala.venue_names, ["Pier Room"]);
  assert.equal(JSON.stringify(gala).includes("Venue flooded"), false);
});

test("TC-621 H4 AC2 no internal event field is sent", async () => {
  const { body } = await request({ firestore: fakeFirestore(data()) });
  for (const entry of body.registrations) {
    for (const field of ["organiser_id", "coordinator_id", "reference_no", "cancellation_reason", "registration_capacity", "attendee_id"]) {
      assert.equal(Object.hasOwn(entry, field), false, `${field} leaked`);
    }
  }
});

test("TC-622 H4 another attendee's registrations are never read into the list", async () => {
  const firestore = fakeFirestore(data());
  const { body } = await request({ firestore });
  assert.ok(!body.registrations.some((entry) => entry.event_id === "others"));
  assert.ok(!firestore.reads.includes("events/others"));
  assert.ok(firestore.reads.every((read) => !read.startsWith("registrations?") || read.includes("attendee_id=attendee-1")));
});

test("TC-623 H4 a registration whose event no longer exists is left out rather than failing the list", async () => {
  const { status, body } = await request({ firestore: fakeFirestore(data()) });
  assert.equal(status, 200);
  assert.ok(!body.registrations.some((entry) => entry.event_id === "deleted-event"));
});

test("TC-624 H4 an attendee with no registrations gets an empty list", async () => {
  const { status, body } = await request({ firestore: fakeFirestore(data()), uid: "attendee-2" });
  assert.equal(status, 200);
  assert.deepEqual(body.registrations.map((entry) => entry.event_id), ["others"]);
  const none = await request({ firestore: fakeFirestore({ ...data(), users: { "attendee-3": { role: "ATTENDEE" } } }), uid: "attendee-3" });
  assert.deepEqual(none.body.registrations, []);
});

test("TC-625 H4 only a signed-in Attendee may read the list; nothing is read otherwise", async () => {
  for (const [options, expected] of [[{ authorization: null }, 401], [{ authorization: "Bearer junk" }, 401], [{ uid: "organiser-1" }, 403]]) {
    const firestore = fakeFirestore(data());
    const { status, body } = await request({ firestore, ...options });
    assert.equal(status, expected);
    if (expected === 403) assert.match(body.error, /only attendees/i);
    assert.ok(!firestore.reads.some((read) => read.startsWith("registrations") || read.startsWith("events")));
  }
});

test("TC-626 H4 a failed read is a server error, not an empty list", async () => {
  const base = fakeFirestore(data());
  const broken = {
    collection(name) {
      if (name === "registrations") return { where: () => ({ where: () => ({ get: async () => { throw new Error("unavailable"); } }), get: async () => { throw new Error("unavailable"); } }) };
      return base.collection(name);
    }
  };
  const { status } = await request({ firestore: broken });
  assert.equal(status, 500);
});
