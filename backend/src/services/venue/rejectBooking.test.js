import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { createVenueService } from "./index.js";

const createHarness = ({ role = "VENUE_STAFF", uid = "staff-1", assignedStaff = "staff-1", status = "PENDING" } = {}) => {
  const store = {
    [`users/${uid}`]: { role },
    "venue_staff/VEN-1": { venue_id: "VEN-1", user_id: assignedStaff },
    "venues/VEN-1": { name: "Main Hall" },
    "venue_bookings/BK-1": {
      booking_id: "BK-1",
      event_id: "EV-1",
      event_name: "Partner Summit",
      venue_id: "VEN-1",
      requested_by: "coordinator-1",
      status,
      occupied_start: "unchanged-start",
      occupied_end: "unchanged-end"
    }
  };
  let generatedId = 0;
  const firestore = {
    collection(name) {
      return {
        doc(id) {
          const documentId = id || `generated-${++generatedId}`;
          const reference = { id: documentId, path: `${name}/${documentId}` };
          reference.get = async () => {
            const data = store[reference.path];
            return { exists: data !== undefined, data: () => data };
          };
          return reference;
        }
      };
    },
    async runTransaction(operation) {
      const writes = [];
      const transaction = {
        async get(reference) {
          const data = store[reference.path];
          return { exists: data !== undefined, data: () => data };
        },
        update(reference, data) { writes.push(["update", reference.path, data]); },
        set(reference, data) { writes.push(["set", reference.path, data]); }
      };
      await operation(transaction);
      writes.forEach(([kind, path, data]) => {
        store[path] = kind === "update" ? { ...store[path], ...data } : data;
      });
    }
  };
  const app = express();
  app.use(express.json());
  app.use("/api/venues", createVenueService({
    firestore,
    verifyIdToken: async (token) => {
      assert.equal(token, "valid-token");
      return { uid };
    },
    serverTimestamp: () => "SERVER_TIME"
  }));
  const server = app.listen(0);
  const listening = new Promise((resolve) => server.once("listening", resolve));
  const request = async (body = { reason: "The requested layout is unavailable." }) => {
    await listening;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/venues/bookings/BK-1/reject`, {
      method: "POST",
      headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return { response, store };
  };
  return {
    request,
    store,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
};

test("F5 rejection requires Venue Staff and a non-empty reason", async () => {
  const harness = createHarness();
  try {
    const emptyReason = await harness.request({ reason: "  " });
    assert.equal(emptyReason.response.status, 400);
    assert.equal(harness.store["venue_bookings/BK-1"].status, "PENDING");

    const wrongRole = createHarness({ role: "EVENT_COORDINATOR" });
    try {
      const forbidden = await wrongRole.request();
      assert.equal(forbidden.response.status, 403);
    } finally {
      await wrongRole.close();
    }
  } finally {
    await harness.close();
  }
});

test("F5 records rejection, reason, timestamp, history and notice without changing occupancy", async () => {
  const harness = createHarness({ status: "HELD" });
  try {
    const { response, store } = await harness.request();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      booking_id: "BK-1",
      status: "REJECTED",
      decision_reason: "The requested layout is unavailable."
    });
    assert.deepEqual(store["venue_bookings/BK-1"], {
      booking_id: "BK-1",
      event_id: "EV-1",
      event_name: "Partner Summit",
      venue_id: "VEN-1",
      requested_by: "coordinator-1",
      status: "REJECTED",
      occupied_start: "unchanged-start",
      occupied_end: "unchanged-end",
      decision_reason: "The requested layout is unavailable.",
      assigned_staff_id: "staff-1",
      decided_by: "staff-1",
      decided_at: "SERVER_TIME",
      requires_re_request: true
    });
    assert.deepEqual(Object.values(store).find((item) => item.action_type === "VENUE_BOOKING_REJECTED"), {
      history_id: "generated-1",
      event_id: "EV-1",
      booking_id: "BK-1",
      venue_id: "VEN-1",
      actor_id: "staff-1",
      action_type: "VENUE_BOOKING_REJECTED",
      field_name: "venue_booking_status",
      old_value: "HELD",
      new_value: "REJECTED",
      description: "The requested layout is unavailable.",
      created_at: "SERVER_TIME"
    });
    assert.deepEqual(Object.values(store).find((item) => item.type === "VENUE_BOOKING_REJECTED"), {
      notification_id: "generated-2",
      user_id: "coordinator-1",
      event_id: "EV-1",
      event_name: "Partner Summit",
      type: "VENUE_BOOKING_REJECTED",
      message: "Partner Summit: the booking for Main Hall was rejected. Reason: The requested layout is unavailable.",
      decision_reason: "The requested layout is unavailable.",
      booking_id: "BK-1",
      venue_id: "VEN-1",
      is_read: false,
      created_at: "SERVER_TIME",
      read_at: null
    });
  } finally {
    await harness.close();
  }
});

test("F5 rejects only an assigned staff member and cannot overwrite a terminal rejection", async () => {
  const wrongStaff = createHarness({ assignedStaff: "staff-2" });
  try {
    const result = await wrongStaff.request();
    assert.equal(result.response.status, 403);
  } finally {
    await wrongStaff.close();
  }

  const alreadyRejected = createHarness({ status: "REJECTED" });
  try {
    const result = await alreadyRejected.request();
    assert.equal(result.response.status, 409);
    assert.equal(alreadyRejected.store["venue_bookings/BK-1"].status, "REJECTED");
  } finally {
    await alreadyRejected.close();
  }
});
