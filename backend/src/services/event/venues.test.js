import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { createEventVenueService } from "./venues.js";

// B10 / SCRUM-101.
const askForVenues = async ({ role = "EVENT_ORGANISER", uid = "o1", event = { organiser_id: "o1" }, token = "valid-token", names = ["Harbour Hall", "Pier Room"] } = {}) => {
  const stored = { [`users/${uid}`]: { role }, ...(event ? { "events/e1": event } : {}) };
  const asked = [];
  const firestore = {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              const data = stored[`${name}/${id}`];
              return { exists: Boolean(data), data: () => data };
            }
          };
        }
      };
    }
  };
  const app = express();
  app.use("/api/events", createEventVenueService({
    firestore,
    verifyIdToken: async (given) => {
      if (given !== "valid-token") throw new Error("bad token");
      return { uid };
    },
    venueNamesFor: async (eventId) => { asked.push(eventId); return names; }
  }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events/e1/venues`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    return { status: response.status, body: await response.json(), asked };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test("TC-0280 B10 the organiser gets the names of the venues their event has secured, and nothing else", async () => {
  const { status, body, asked } = await askForVenues();
  assert.equal(status, 200);
  assert.deepEqual(body, { venue_names: ["Harbour Hall", "Pier Room"] });
  assert.deepEqual(asked, ["e1"]);
});

test("TC-0281 B10 AC5 another organiser's event, or one that does not exist, is refused with no venues", async () => {
  for (const event of [{ organiser_id: "o2" }, null]) {
    const { status, body, asked } = await askForVenues({ event });
    assert.equal(status, 403);
    assert.equal(body.error, "You are not authorised to view this event.");
    assert.deepEqual(asked, []);
  }
});

test("TC-0282 only a signed-in organiser may ask", async () => {
  assert.equal((await askForVenues({ token: null })).status, 401);
  assert.equal((await askForVenues({ token: "forged" })).status, 401);
  const coordinator = await askForVenues({ role: "EVENT_COORDINATOR" });
  assert.equal(coordinator.status, 403);
  assert.deepEqual(coordinator.asked, []);
});

import { fakeFirestore } from "../../../testing/fakeFirestore.js";

const venuesVia = async (firestore) => {
  const app = express();
  app.use("/api/events", createEventVenueService({ firestore, verifyIdToken: async () => ({ uid: "o1" }) }));
  app.use((_error, _request, response, _next) => response.status(500).json({ error: "Internal server error" }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events/e1/venues`, { headers: { Authorization: "Bearer t" } });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

test("TC-1051 [normal] F12 B10 by default the names come from the venue service's approved bookings only", async () => {
  const firestore = fakeFirestore({
    users: { o1: { role: "EVENT_ORGANISER" } },
    events: { e1: { organiser_id: "o1" } },
    venue_bookings: {
      b1: { event_id: "e1", venue_id: "V1", status: "APPROVED" },
      b2: { event_id: "e1", venue_id: "V2", status: "HELD" },
      b3: { event_id: "e1", venue_id: "V3", status: "APPROVED" }
    },
    venues: { V1: { name: "Harbour Hall" }, V2: { name: "Held Room" } }
  });
  assert.deepEqual(await venuesVia(firestore), { status: 200, body: { venue_names: ["Harbour Hall", "V3"] } });
});

test("TC-0283 [failure] B10 a Firestore failure is passed on as a 500", async () => {
  const firestore = { collection: () => ({ doc: () => ({ get: async () => { throw new Error("unavailable"); } }) }) };
  assert.deepEqual(await venuesVia(firestore), { status: 500, body: { error: "Internal server error" } });
});
