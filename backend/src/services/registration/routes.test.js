// Functional tests for the registration routes' shared failure paths and defaults (H1, H3–H8):
// each request goes through a real Express app over the shared in-memory Firestore.
import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { fakeFirestore } from "../../../testing/fakeFirestore.js";
import { createRegistrationService } from "./service.js";

const NOW = new Date("2026-11-05T12:00:00+08:00");

const event = (changes = {}) => ({
  organiser_id: "organiser-1",
  name: "Harbour Tech Forum",
  description: "Talks.",
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

const collections = (changes = {}) => ({
  users: { "attendee-1": { role: "ATTENDEE" }, "organiser-1": { role: "EVENT_ORGANISER" } },
  events: { e1: event() },
  venue_bookings: { b1: { event_id: "e1", venue_id: "V1", status: "APPROVED" } },
  venues: { V1: { name: "Harbour Hall", max_capacity: 10 } },
  registrations: {},
  notifications: {},
  ...changes
});

const TOKENS = { "t-attendee": "attendee-1", "t-organiser": "organiser-1" };

const withServer = async (firestore, run, { parseJson = true, injectNow = true } = {}) => {
  const app = express();
  if (parseJson) app.use(express.json());
  app.use("/api/registrations", createRegistrationService({
    firestore,
    verifyIdToken: async (token) => ({ uid: TOKENS[token] }),
    ...(injectNow ? { now: () => NOW } : {}),
    serverTimestamp: () => ({ serverTimestamp: true })
  }));
  // Mirrors backend/src/index.js: an unhandled error becomes a JSON 500.
  app.use((_error, _request, response, _next) => response.status(500).json({ error: "Internal server error" }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const call = async (method, path, { token, body: given } = {}) => {
      const body = method === "GET" ? undefined : given;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/registrations${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    };
    await run(call);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const ATTENDEE_ROUTES = [
  ["POST", "/events/e1/register"],
  ["POST", "/events/e1/withdraw"],
  ["POST", "/events/e1/waitlist"],
  ["POST", "/events/e1/invitation/accept"],
  ["POST", "/events/e1/invitation/decline"]
];
const ORGANISER_ROUTES = [
  ["GET", "/events/e1/settings"],
  ["PUT", "/events/e1/settings"],
  ["GET", "/events/e1/attendees"]
];

test("TC-1707 [failure] a failing profile read is a 500 on every attendee and organiser route", async () => {
  const firestore = fakeFirestore(collections());
  firestore.collection = () => ({ doc: () => ({ get: async () => { throw new Error("unavailable"); } }) });
  await withServer(firestore, async (call) => {
    for (const [method, path] of ATTENDEE_ROUTES) {
      assert.deepEqual(await call(method, path, { token: "t-attendee" }), { status: 500, body: { error: "Internal server error" } }, path);
    }
    for (const [method, path] of ORGANISER_ROUTES) {
      assert.deepEqual(await call(method, path, { token: "t-organiser", body: {} }), { status: 500, body: { error: "Internal server error" } }, path);
    }
  });
});

test("TC-1708 [failure] a failing transaction is a 500 on every attendee and organiser route, not a refusal", async () => {
  const firestore = fakeFirestore(collections());
  firestore.runTransaction = async () => { throw new Error("aborted"); };
  await withServer(firestore, async (call) => {
    for (const [method, path] of ATTENDEE_ROUTES) {
      assert.equal((await call(method, path, { token: "t-attendee" })).status, 500, path);
    }
    for (const [method, path] of ORGANISER_ROUTES.slice(0, 2)) {
      assert.equal((await call(method, path, { token: "t-organiser", body: {} })).status, 500, path);
    }
  });
});

test("TC-0041 [conflict] A4 organiser routes refuse an attendee, and attendee routes refuse an organiser", async () => {
  await withServer(fakeFirestore(collections()), async (call) => {
    for (const [method, path] of ORGANISER_ROUTES) {
      assert.deepEqual(await call(method, path, { token: "t-attendee", body: {} }), { status: 403, body: { error: "Only an Event Organiser can manage registration." } });
    }
    assert.deepEqual(await call("POST", "/events/e1/invitation/accept", { token: "t-organiser" }), {
      status: 403, body: { error: "Only attendees can answer an offered place." }
    });
  });
});

test("TC-1709 [failure] H7 answering an offer for an event that does not exist is a 404", async () => {
  await withServer(fakeFirestore(collections()), async (call) => {
    for (const action of ["accept", "decline"]) {
      const response = await call("POST", `/events/gone/invitation/${action}`, { token: "t-attendee" });
      assert.deepEqual(response, { status: 404, body: { error: "That event could not be found.", reason: "not_found" } }, action);
    }
  });
});

test("TC-1710 [boundary] H7 My registrations skips handing on places for an event that has since gone", async () => {
  const firestore = fakeFirestore(collections({
    registrations: { gone_attendee: { event_id: "gone", attendee_id: "attendee-1", status: "WAITLISTED", waitlisted_at: "2026-11-04T01:00:00.000Z" } }
  }));
  await withServer(firestore, async (call) => {
    const response = await call("GET", "/mine", { token: "t-attendee" });
    assert.equal(response.status, 200);
    assert.equal(firestore.log.writes.length, 0);
  });
});

test("TC-1327 [normal] H1 the organiser's saved settings are checked against the venue's approved booking by default", async () => {
  const firestore = fakeFirestore(collections({ events: { e1: event({ registration_capacity: null }) } }));
  await withServer(firestore, async (call) => {
    const loaded = await call("GET", "/events/e1/settings", { token: "t-organiser" });
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.venue_capacity, 10);
    assert.equal(loaded.body.settings.registration_capacity, null);
    const tooMany = await call("PUT", "/events/e1/settings", { token: "t-organiser", body: { ...event(), registration_capacity: 11 } });
    assert.equal(tooMany.status, 422);
    assert.ok(tooMany.body.fields);
  });
});

test("TC-1328 [boundary] H1 a settings save without a JSON body is validated as empty, not crashed on", async () => {
  await withServer(fakeFirestore(collections()), async (call) => {
    const response = await call("PUT", "/events/e1/settings", { token: "t-organiser" });
    assert.equal(response.status, 422);
  }, { parseJson: false });
});

test("TC-1513 [boundary] H3 AC8 a Registered place wins over a stale Waitlisted record, and the real clock is used by default", async () => {
  const firestore = fakeFirestore(collections({
    events: { e1: event({ event_date: "2099-11-12", registration_open_date: "2020-01-01", registration_close_date: "2099-11-10" }) },
    registrations: {
      a: { event_id: "e1", attendee_id: "attendee-1", status: "REGISTERED" },
      b: { event_id: "e1", attendee_id: "attendee-1", status: "WAITLISTED" }
    }
  }));
  await withServer(firestore, async (call) => {
    const response = await call("GET", "/open-events", { token: "t-attendee" });
    assert.equal(response.status, 200);
    assert.equal(response.body.events[0].registration_status, "REGISTERED");
    assert.equal(response.body.events[0].waitlist_position, null);
  }, { injectNow: false });
});
