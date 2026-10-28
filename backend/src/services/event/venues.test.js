import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { createEventVenueService } from "./venues.js";

// B10 / SCRUM-101 — TC-787 – TC-789 in docs/test-cases.md.
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

test("TC-787 B10 the organiser gets the names of the venues their event has secured, and nothing else", async () => {
  const { status, body, asked } = await askForVenues();
  assert.equal(status, 200);
  assert.deepEqual(body, { venue_names: ["Harbour Hall", "Pier Room"] });
  assert.deepEqual(asked, ["e1"]);
});

test("TC-788 B10 AC5 another organiser's event, or one that does not exist, is refused with no venues", async () => {
  for (const event of [{ organiser_id: "o2" }, null]) {
    const { status, body, asked } = await askForVenues({ event });
    assert.equal(status, 403);
    assert.equal(body.error, "You are not authorised to view this event.");
    assert.deepEqual(asked, []);
  }
});

test("TC-789 only a signed-in organiser may ask", async () => {
  assert.equal((await askForVenues({ token: null })).status, 401);
  assert.equal((await askForVenues({ token: "forged" })).status, 401);
  const coordinator = await askForVenues({ role: "EVENT_COORDINATOR" });
  assert.equal(coordinator.status, 403);
  assert.deepEqual(coordinator.asked, []);
});
