// H8 / SCRUM-146 — "See who has registered for my event": the organiser's registration list.
//
// The list is built by the registration service, never read by the browser: an organiser has no
// Firestore read on `registrations` (only the event's current coordinator does) and none on
// attendees' profiles, so names and contact details can only reach an organiser through this
// route, after it has checked the event is theirs.
//
// Oracle (traced to the AC wording, not to the code):
//   AC1 names, contact details (email, mobile) and registration timestamps, for the organiser's
//       own events only; the people coming are the REGISTERED ones.
//   AC2 aggregate counts of registered, waitlisted and withdrawn attendees.
//   AC3 no other role, and no unrelated organiser, can reach it.
//
// Decisions (Shi Han, 2026-10-27): the timestamp field is `registered_at`; waitlisted and
// withdrawn people are rows of the same `registrations` collection (status WAITLISTED /
// WITHDRAWN) and appear only as counts; the attendee id is `attendee_id`, falling back to
// `user_id` (D4's notice rule accepts either).

import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { createRegistrationService } from "./service.js";

const at = (iso) => ({ toDate: () => new Date(iso) });

// A Firestore stand-in that refuses what the real service must never do: reading registrations
// without naming the event. It records every document and collection touched.
const fakeFirestore = (collections, { failOn = null } = {}) => {
  const touched = [];
  const queryOf = (name, filters = []) => ({
    where(field, op, value) {
      assert.equal(op, "==", "Only equality filters are expected.");
      return queryOf(name, [...filters, [field, value]]);
    },
    async get() {
      if (failOn === name) throw new Error("unavailable");
      if (name === "registrations") {
        assert.ok(filters.some(([field]) => field === "event_id"), "registrations must be read for one event");
      }
      touched.push(name);
      const docs = Object.entries(collections[name] || {})
        .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
        .map(([id, data]) => ({ id, data: () => data }));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
    doc(id) {
      return {
        id,
        async get() {
          if (failOn === name) throw new Error("unavailable");
          touched.push(`${name}/${id}`);
          const data = (collections[name] || {})[id];
          return { id, exists: Boolean(data), data: () => data };
        }
      };
    }
  });
  return { collection: (name) => queryOf(name), touched };
};

const data = () => ({
  users: {
    "organiser-1": { role: "EVENT_ORGANISER" },
    "organiser-2": { role: "EVENT_ORGANISER" },
    "coordinator-1": { role: "EVENT_COORDINATOR" },
    "lead-1": { role: "EVENT_COORDINATOR_LEAD" },
    "venue-1": { role: "VENUE_STAFF" },
    "tech-1": { role: "TECHNICAL_SUPPORT_STAFF" },
    "safety-1": { role: "SAFETY_OFFICER" },
    "attendee-1": { role: "ATTENDEE" },
    a1: { role: "ATTENDEE", name: "Alicia Tan", email: "alicia@example.com", mobile_number: "91234567", preferred_contact_method: "SMS", is_active: true },
    a2: { role: "ATTENDEE", name: "Bala Raj", email: "bala@example.com", mobile_number: "98765432" },
    a3: { role: "ATTENDEE", name: "Chen Wei", email: "chen@example.com", mobile_number: "81112222" },
    a4: { role: "ATTENDEE", name: "Dana Lim", email: "dana@example.com", mobile_number: "82223333" },
    a5: { role: "ATTENDEE", name: "Eli Koh", email: "eli@example.com", mobile_number: "83334444" },
    a6: { role: "ATTENDEE", name: "Farah Ali", email: "farah@example.com", mobile_number: "84445555" }
  },
  events: {
    e1: { organiser_id: "organiser-1", name: "Harbour Tech Forum", status: "CONFIRMED", registration_required: true },
    e2: { organiser_id: "organiser-2", name: "Pier Open Day", status: "CONFIRMED", registration_required: true },
    empty: { organiser_id: "organiser-1", name: "Quiet Workshop", status: "CONFIRMED", registration_required: true }
  },
  registrations: {
    r1: { event_id: "e1", attendee_id: "a1", status: "REGISTERED", registered_at: at("2026-11-03T02:00:00Z") },
    r2: { event_id: "e1", attendee_id: "a2", status: "REGISTERED", registered_at: at("2026-11-03T01:00:00Z") },
    r3: { event_id: "e1", user_id: "a3", status: "REGISTERED", registered_at: at("2026-11-03T03:00:00Z") },
    r4: { event_id: "e1", attendee_id: "a4", status: "WAITLISTED", registered_at: at("2026-11-03T04:00:00Z") },
    r5: { event_id: "e1", attendee_id: "a5", status: "WITHDRAWN", registered_at: at("2026-11-03T05:00:00Z") },
    r6: { event_id: "e1", attendee_id: "a6", status: "WAITLISTED", registered_at: at("2026-11-03T06:00:00Z") },
    r7: { event_id: "e2", attendee_id: "a1", status: "REGISTERED", registered_at: at("2026-11-03T07:00:00Z") },
    r8: { event_id: "e1", attendee_id: "ghost", status: "REGISTERED", registered_at: at("2026-11-03T08:00:00Z") }
  }
});

const call = async ({ firestore, eventId = "e1", uid = "organiser-1", authorization = "Bearer valid-token", method = "GET", verifyIdToken }) => {
  const app = express();
  app.use(express.json());
  app.use("/api/registrations", createRegistrationService({
    firestore,
    verifyIdToken: verifyIdToken || (async (token) => {
      assert.equal(token, "valid-token");
      return { uid };
    }),
    serverTimestamp: () => ({ serverTimestamp: true }),
    getApprovedEventBookings: async () => []
  }));
  app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const headers = authorization ? { Authorization: authorization } : {};
    const response = await fetch(`http://127.0.0.1:${port}/api/registrations/events/${eventId}/attendees`, { method, headers });
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test("H8-TC1 AC1 the organiser of the event is given the names, contact details and registration times of those registered", async () => {
  const { status, body } = await call({ firestore: fakeFirestore(data()) });
  assert.equal(status, 200);
  const byAttendee = Object.fromEntries(body.attendees.map((entry) => [entry.attendee_id, entry]));
  assert.deepEqual(byAttendee.a1, {
    registration_id: "r1",
    attendee_id: "a1",
    name: "Alicia Tan",
    email: "alicia@example.com",
    mobile_number: "91234567",
    registered_at: "2026-11-03T02:00:00.000Z"
  });
  assert.deepEqual(byAttendee.a2, {
    registration_id: "r2",
    attendee_id: "a2",
    name: "Bala Raj",
    email: "bala@example.com",
    mobile_number: "98765432",
    registered_at: "2026-11-03T01:00:00.000Z"
  });
});

test("H8-TC2 AC1 the list is the registered attendees only, earliest registration first", async () => {
  const { body } = await call({ firestore: fakeFirestore(data()) });
  assert.deepEqual(body.attendees.map((entry) => entry.registration_id), ["r2", "r1", "r3", "r8"]);
});

test("H8-TC3 AC1 only this event's registrations are listed: another organiser's event never leaks in", async () => {
  const { body } = await call({ firestore: fakeFirestore(data()) });
  assert.ok(!body.attendees.some((entry) => entry.registration_id === "r7"));
  const other = await call({ firestore: fakeFirestore(data()), eventId: "e2", uid: "organiser-2" });
  assert.deepEqual(other.body.attendees.map((entry) => entry.registration_id), ["r7"]);
});

test("H8-TC4 AC1 a registration that names its attendee as user_id (not attendee_id) is still listed with that person's details", async () => {
  const { body } = await call({ firestore: fakeFirestore(data()) });
  const chen = body.attendees.find((entry) => entry.registration_id === "r3");
  assert.equal(chen.attendee_id, "a3");
  assert.equal(chen.name, "Chen Wei");
  assert.equal(chen.email, "chen@example.com");
});

test("H8-TC5 AC1 an attendee whose profile cannot be found is still listed, with no name or contact details, instead of failing the whole list", async () => {
  const { status, body } = await call({ firestore: fakeFirestore(data()) });
  assert.equal(status, 200);
  const ghost = body.attendees.find((entry) => entry.registration_id === "r8");
  assert.deepEqual(ghost, {
    registration_id: "r8",
    attendee_id: "ghost",
    name: null,
    email: null,
    mobile_number: null,
    registered_at: "2026-11-03T08:00:00.000Z"
  });
});

test("H8-TC6 AC1 each entry carries only name, email, mobile number, id and time: no role, preference or other profile field is sent", async () => {
  const { body } = await call({ firestore: fakeFirestore(data()) });
  for (const entry of body.attendees) {
    assert.deepEqual(Object.keys(entry).sort(), ["attendee_id", "email", "mobile_number", "name", "registered_at", "registration_id"]);
  }
});

test("H8-TC7 AC1 a registration time already stored as text is passed through as it is", async () => {
  const collections = data();
  collections.registrations.r2.registered_at = "2026-11-03T01:00:00.000Z";
  const { body } = await call({ firestore: fakeFirestore(collections) });
  assert.equal(body.attendees.find((entry) => entry.registration_id === "r2").registered_at, "2026-11-03T01:00:00.000Z");
});

test("H8-TC8 AC2 the counts are registered, waitlisted and withdrawn for this event", async () => {
  const { body } = await call({ firestore: fakeFirestore(data()) });
  assert.deepEqual(body.counts, { registered: 4, waitlisted: 2, withdrawn: 1 });
  assert.equal(body.attendees.length, body.counts.registered);
});

test("H8-TC9 AC2 an event nobody has registered for returns an empty list and zero counts, not an error", async () => {
  const { status, body } = await call({ firestore: fakeFirestore(data()), eventId: "empty" });
  assert.equal(status, 200);
  assert.deepEqual(body, { event_id: "empty", counts: { registered: 0, waitlisted: 0, withdrawn: 0 }, attendees: [] });
});

test("H8-TC10 AC1 waitlisted and withdrawn people appear only as counts: their profiles are never read", async () => {
  const firestore = fakeFirestore(data());
  const { status, body } = await call({ firestore });
  assert.equal(status, 200);
  const everyone = JSON.stringify(body);
  for (const hidden of ["Dana Lim", "dana@example.com", "82223333", "Eli Koh", "eli@example.com", "Farah Ali", "84445555"]) {
    assert.ok(!everyone.includes(hidden), `${hidden} leaked`);
  }
  for (const id of ["a4", "a5", "a6"]) assert.ok(!firestore.touched.includes(`users/${id}`), `users/${id} was read`);
});

test("H8-TC11 AC3 an Event Organiser who does not own the event is refused, and no registration or profile is read", async () => {
  const firestore = fakeFirestore(data());
  const { status, body } = await call({ firestore, uid: "organiser-2" });
  assert.equal(status, 403);
  assert.match(body.error, /your own events/i);
  assert.ok(!firestore.touched.includes("registrations"));
  assert.ok(!firestore.touched.some((name) => /^users\/a/.test(name)));
  assert.ok(!JSON.stringify(body).includes("Alicia"));
});

test("H8-TC12 AC3 an event that does not exist is refused with the same answer as someone else's event, so ids cannot be probed", async () => {
  const someoneElses = await call({ firestore: fakeFirestore(data()), uid: "organiser-2" });
  const missing = await call({ firestore: fakeFirestore(data()), eventId: "nope" });
  assert.equal(someoneElses.status, 403);
  assert.equal(missing.status, 403);
  assert.deepEqual(missing.body, someoneElses.body);
});

for (const uid of ["coordinator-1", "lead-1", "venue-1", "tech-1", "safety-1", "attendee-1"]) {
  test(`H8-TC13 AC3 a caller who is not an Event Organiser (${uid}) is refused before the event or any registration is read`, async () => {
    const firestore = fakeFirestore(data());
    const { status, body } = await call({ firestore, uid });
    assert.equal(status, 403);
    assert.match(body.error, /only an event organiser/i);
    assert.ok(!firestore.touched.includes("events"));
    assert.ok(!firestore.touched.includes("registrations"));
  });
}

test("H8-TC14 AC3 a caller with no profile is refused", async () => {
  const firestore = fakeFirestore(data());
  const { status } = await call({ firestore, uid: "nobody" });
  assert.equal(status, 403);
  assert.ok(!firestore.touched.includes("registrations"));
});

test("H8-TC15 AC3 a request with no sign-in is refused before anything is read", async () => {
  const firestore = fakeFirestore(data());
  const { status, body } = await call({ firestore, authorization: null });
  assert.equal(status, 401);
  assert.match(body.error, /sign in/i);
  assert.deepEqual(firestore.touched, []);
});

test("H8-TC16 AC3 a token that does not verify is refused", async () => {
  const firestore = fakeFirestore(data());
  const { status } = await call({ firestore, verifyIdToken: async () => { throw new Error("expired"); } });
  assert.equal(status, 401);
  assert.deepEqual(firestore.touched, []);
});

test("H8-TC17 the list is read-only: nothing can be added to or removed from it through this route", async () => {
  assert.equal((await call({ firestore: fakeFirestore(data()) })).status, 200);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const { status } = await call({ firestore: fakeFirestore(data()), method });
    assert.equal(status, 404, `${method} should not exist`);
  }
});

test("H8-TC18 a failed read is reported as a server error, never as an empty list or zero counts", async () => {
  const { status, body } = await call({ firestore: fakeFirestore(data(), { failOn: "registrations" }) });
  assert.equal(status, 500);
  assert.equal(body.attendees, undefined);
  assert.equal(body.counts, undefined);
});
