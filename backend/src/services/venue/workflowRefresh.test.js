import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { createVenueService } from "./index.js";

const createHarness = ({ role = "EVENT_COORDINATOR" } = {}) => {
  const calls = { heldQueries: 0, assignmentScans: 0 };
  const empty = { docs: [] };
  const firestore = {
    collection(name) {
      return {
        doc(id) {
          return {
            id,
            path: `${name}/${id}`,
            get: async () => ({
              exists: name === "users",
              data: () => name === "users" ? { role } : undefined
            })
          };
        },
        where(field, operator, value) {
          return {
            get: async () => {
              if (name === "venue_bookings" && field === "status" && operator === "==" && value === "HELD") {
                calls.heldQueries += 1;
              }
              return empty;
            }
          };
        },
        get: async () => {
          if (name === "venue_staff") calls.assignmentScans += 1;
          return empty;
        }
      };
    }
  };
  const app = express();
  app.use(express.json());
  app.use("/api/venues", createVenueService({
    firestore,
    verifyIdToken: async () => ({ uid: "USER-1" }),
    serverTimestamp: () => "SERVER_TIME"
  }));
  const server = app.listen(0);
  const listening = new Promise((resolve) => server.once("listening", resolve));
  return {
    calls,
    request: async () => {
      await listening;
      return fetch(`http://127.0.0.1:${server.address().port}/api/venues/workflows/refresh`, {
        method: "POST",
        headers: { Authorization: "Bearer valid-token" }
      });
    },
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
};

test("TC-1148 venue workflows run once when an authorised user refreshes them", async () => {
  const harness = createHarness();
  try {
    const response = await harness.request();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      holds_processed: 0,
      venues_checked: 0,
      active_conflicts: 0
    });
    assert.deepEqual(harness.calls, { heldQueries: 1, assignmentScans: 1 });
  } finally {
    await harness.close();
  }
});

test("TC-1149 venue workflow refresh is unavailable to unrelated roles", async () => {
  const harness = createHarness({ role: "EVENT_ORGANISER" });
  try {
    const response = await harness.request();
    assert.equal(response.status, 403);
    assert.deepEqual(harness.calls, { heldQueries: 0, assignmentScans: 0 });
  } finally {
    await harness.close();
  }
});
