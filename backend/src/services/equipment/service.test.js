import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { createEquipmentService } from "./service.js";

const exerciseRequest = async ({ role, authorization = "Bearer valid-token" }) => {
  let transactionCalls = 0;
  const firestore = {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              assert.equal(name, "users");
              assert.equal(id, "user-1");
              return { exists: true, data: () => ({ role }) };
            }
          };
        }
      };
    },
    async runTransaction() {
      transactionCalls += 1;
      throw new Error("An unauthorized caller reached the reservation transaction.");
    }
  };
  const app = express();
  app.use(express.json());
  app.use("/api/equipment", createEquipmentService({
    firestore,
    verifyIdToken: async (token) => {
      assert.equal(token, "valid-token");
      return { uid: "user-1" };
    },
    serverTimestamp: () => ({ serverTimestamp: true }),
    getApprovedEventBookings: async () => []
  }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/equipment/reservations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization
      },
      body: JSON.stringify({ event_id: "event-1", equipment_type: "AUDIO", quantity: 1 })
    });
    return { response, transactionCalls };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test("TC-304 only Technical Support Staff can reach the reservation transaction", async () => {
  const { response, transactionCalls } = await exerciseRequest({ role: "EVENT_COORDINATOR" });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /only technical support staff/i);
  assert.equal(transactionCalls, 0);
});

test("TC-304 missing bearer credentials are rejected before profile access", async () => {
  let profileReads = 0;
  const app = express();
  app.use(express.json());
  app.use("/api/equipment", createEquipmentService({
    firestore: {
      collection() {
        return {
          doc() {
            return { get: async () => { profileReads += 1; return { exists: true, data: () => ({ role: "TECHNICAL_SUPPORT_STAFF" }) }; } };
          }
        };
      },
      runTransaction: async () => { throw new Error("Unauthenticated request reached Firestore."); }
    },
    verifyIdToken: async () => ({ uid: "user-1" }),
    serverTimestamp: () => ({ serverTimestamp: true }),
    getApprovedEventBookings: async () => []
  }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/equipment/reservations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: "event-1", equipment_type: "AUDIO", quantity: 1 })
    });
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /sign in is required/i);
    assert.equal(profileReads, 0);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

// J5 / SCRUM-154 — a coordinator asks the service to tell Technical Support about the
// request they have just saved. Only an Event Coordinator may ask, and the service
// itself checks they are the event's coordinator (supportNotifications.test.js).
const notifyRoute = async ({ role, authorization = "Bearer valid-token", runTransaction }) => {
  let transactionCalls = 0;
  const firestore = {
    collection() {
      return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ role }) }) }) };
    },
    async runTransaction(...args) {
      transactionCalls += 1;
      return runTransaction(...args);
    }
  };
  const app = express();
  app.use(express.json());
  app.use("/api/equipment", createEquipmentService({
    firestore,
    verifyIdToken: async () => ({ uid: "user-1" }),
    serverTimestamp: () => ({ serverTimestamp: true }),
    getApprovedEventBookings: async () => []
  }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/equipment/requests/event-1/notify-technical-support`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body: JSON.stringify({})
    });
    return { response, transactionCalls };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test("J5-TC16 AC1 only an Event Coordinator can ask the service to notify Technical Support", async () => {
  for (const role of ["TECHNICAL_SUPPORT_STAFF", "EVENT_ORGANISER", "VENUE_STAFF", "ATTENDEE"]) {
    const { response, transactionCalls } = await notifyRoute({
      role,
      runTransaction: async () => { throw new Error("An unauthorised caller reached the notice transaction."); }
    });
    assert.equal(response.status, 403, role);
    assert.match((await response.json()).error, /only an event coordinator/i);
    assert.equal(transactionCalls, 0);
  }
});

test("J5-TC17 AC1 a request with no bearer token is refused before any profile or notice work", async () => {
  const { response, transactionCalls } = await notifyRoute({
    role: "EVENT_COORDINATOR",
    authorization: "",
    runTransaction: async () => { throw new Error("Unauthenticated request reached Firestore."); }
  });
  assert.equal(response.status, 401);
  assert.equal(transactionCalls, 0);
});

test("J5-TC18 AC1 AC3 an Event Coordinator reaches the notifier, and its result is returned", async () => {
  const { response, transactionCalls } = await notifyRoute({
    role: "EVENT_COORDINATOR",
    runTransaction: async () => ({ eventId: "event-1", sent: 2, types: ["EQUIPMENT_REQUEST_RAISED"] })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { eventId: "event-1", sent: 2, types: ["EQUIPMENT_REQUEST_RAISED"] });
  assert.equal(transactionCalls, 1);
});
