import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { createRegistrationService } from "./service.js";

// A Firestore stand-in holding plain documents per collection. It answers the
// reads the open-events listing makes: equality `where` chains, `get`, `count`,
// and single-document `get` — and records every collection touched.
const fakeFirestore = (collections) => {
  const touched = [];
  const queryOf = (name, filters = []) => {
    const rows = () => Object.entries(collections[name] || {})
      .filter(([, data]) => filters.every(([field, value]) => data[field] === value));
    return {
      where(field, op, value) {
        assert.equal(op, "==", "Only equality filters are expected.");
        return queryOf(name, [...filters, [field, value]]);
      },
      async get() {
        touched.push(name);
        const docs = rows().map(([id, data]) => ({ id, data: () => data }));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
      count() {
        return { get: async () => { touched.push(`${name}:count`); return { data: () => ({ count: rows().length }) }; } };
      },
      doc(id) {
        return {
          async get() {
            touched.push(`${name}/${id}`);
            const data = (collections[name] || {})[id];
            return { id, exists: Boolean(data), data: () => data };
          }
        };
      }
    };
  };
  return { collection: (name) => queryOf(name), touched };
};

const event = (changes = {}) => ({
  reference_no: "EVT-0001",
  organiser_id: "organiser-1",
  coordinator_id: "coordinator-1",
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

const NOW = new Date("2026-11-05T12:00:00+08:00");

const data = () => ({
  users: {
    "attendee-1": { role: "ATTENDEE" },
    "organiser-1": { role: "EVENT_ORGANISER" },
    "coordinator-1": { role: "EVENT_COORDINATOR" }
  },
  events: {
    open: event(),
    multi: event({ name: "Multi-venue Expo", event_date: "2026-11-20" }),
    draft: event({ status: "DRAFT" }),
    cancelled: event({ status: "CANCELLED" }),
    rejected: event({ status: "REJECTED" }),
    closed: event({ registration_close_date: "2026-11-02" }),
    unregistered: event({ registration_required: false })
  },
  venue_bookings: {
    b1: { event_id: "open", venue_id: "V1", status: "APPROVED" },
    b2: { event_id: "open", venue_id: "V2", status: "REJECTED" },
    b3: { event_id: "multi", venue_id: "V1", status: "APPROVED" },
    b4: { event_id: "multi", venue_id: "V2", status: "APPROVED" },
    b5: { event_id: "multi", venue_id: "V3", status: "PENDING" }
  },
  venues: {
    V1: { name: "Harbour Hall" },
    V2: { name: "Pier Room" },
    V3: { name: "Annex" }
  },
  registrations: {
    r1: { event_id: "open", user_id: "a1", status: "REGISTERED" },
    r2: { event_id: "open", user_id: "a2", status: "REGISTERED" },
    r3: { event_id: "open", user_id: "a3", status: "WITHDRAWN" },
    r4: { event_id: "open", user_id: "a4", status: "WAITLISTED" },
    r5: { event_id: "multi", user_id: "a1", status: "REGISTERED" }
  }
});

const request = async ({ firestore, authorization = "Bearer valid-token", uid = "attendee-1", verifyIdToken }) => {
  const app = express();
  app.use(express.json());
  app.use("/api/registrations", createRegistrationService({
    firestore,
    verifyIdToken: verifyIdToken || (async (token) => {
      assert.equal(token, "valid-token");
      return { uid };
    }),
    now: () => NOW
  }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const headers = authorization ? { Authorization: authorization } : {};
    const response = await fetch(`http://127.0.0.1:${port}/api/registrations/open-events`, { headers });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test("TC-557 an attendee is given only the events open for registration now, soonest first", async () => {
  const { status, body } = await request({ firestore: fakeFirestore(data()) });
  assert.equal(status, 200);
  assert.deepEqual(body.events.map((entry) => entry.id), ["open", "multi"]);
});

test("TC-558 each entry names its approved venues and counts only Registered places", async () => {
  const { body } = await request({ firestore: fakeFirestore(data()) });
  const [open, multi] = body.events;
  assert.deepEqual(open, {
    id: "open",
    name: "Harbour Tech Forum",
    description: "A day of talks on port technology.",
    event_date: "2026-11-12",
    start_time: "09:00",
    end_time: "17:00",
    venue_names: ["Harbour Hall"],
    capacity: 3,
    remaining_places: 1,
    registration_closes_at: "2026-11-10T09:00:00.000Z",
    registration_status: null,
    waitlist_position: null,
    invitation_active: false
  });
  assert.deepEqual(multi.venue_names, ["Harbour Hall", "Pier Room"]);
  assert.equal(multi.remaining_places, 2);
});

test("TC-559 no internal event field is sent to the attendee", async () => {
  const { body } = await request({ firestore: fakeFirestore(data()) });
  for (const entry of body.events) {
    for (const field of ["organiser_id", "coordinator_id", "reference_no", "status", "registration_required"]) {
      assert.equal(Object.hasOwn(entry, field), false, `${field} leaked`);
    }
  }
});

test("TC-560 venues and registrations are read only for events that are open", async () => {
  const firestore = fakeFirestore(data());
  await request({ firestore });
  // Two open events of seven: one booking lookup and one count each, no more.
  assert.equal(firestore.touched.filter((name) => name === "venue_bookings").length, 2);
  assert.equal(firestore.touched.filter((name) => name === "registrations:count").length, 2);
});

test("TC-561 a request without a bearer token is refused before anything is read", async () => {
  const firestore = fakeFirestore(data());
  const { status, body } = await request({ firestore, authorization: null });
  assert.equal(status, 401);
  assert.match(body.error, /sign in/i);
  assert.deepEqual(firestore.touched, []);
});

test("TC-561 an invalid or expired token is refused", async () => {
  const firestore = fakeFirestore(data());
  const { status } = await request({ firestore, verifyIdToken: async () => { throw new Error("expired"); } });
  assert.equal(status, 401);
  assert.ok(!firestore.touched.includes("events"));
});

for (const uid of ["organiser-1", "coordinator-1", "nobody"]) {
  test(`TC-562 a caller who is not an Attendee (${uid}) is refused`, async () => {
    const firestore = fakeFirestore(data());
    const { status, body } = await request({ firestore, uid });
    assert.equal(status, 403);
    assert.match(body.error, /only attendees/i);
    assert.ok(!firestore.touched.includes("events"));
  });
}

test("TC-563 a failed read is reported as a server error rather than an empty list", async () => {
  const firestore = fakeFirestore(data());
  const broken = {
    collection(name) {
      if (name === "events") return { where: () => ({ get: async () => { throw new Error("unavailable"); } }) };
      return firestore.collection(name);
    }
  };
  const app = express();
  app.use("/api/registrations", createRegistrationService({
    firestore: broken,
    verifyIdToken: async () => ({ uid: "attendee-1" }),
    now: () => NOW
  }));
  app.use((_error, _request, response, _next) => response.status(500).json({ error: "Internal server error" }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/registrations/open-events`, { headers: { Authorization: "Bearer t" } });
    assert.equal(response.status, 500);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
