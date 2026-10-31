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

test("TC-1253 only Technical Support Staff can reach the reservation transaction", async () => {
  const { response, transactionCalls } = await exerciseRequest({ role: "EVENT_COORDINATOR" });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /only technical support staff/i);
  assert.equal(transactionCalls, 0);
});

test("TC-1254 missing bearer credentials are rejected before profile access", async () => {
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

test("TC-2165 J5 AC1 only an Event Coordinator can ask the service to notify Technical Support", async () => {
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

test("TC-2166 J5 AC1 a request with no bearer token is refused before any profile or notice work", async () => {
  const { response, transactionCalls } = await notifyRoute({
    role: "EVENT_COORDINATOR",
    authorization: "",
    runTransaction: async () => { throw new Error("Unauthenticated request reached Firestore."); }
  });
  assert.equal(response.status, 401);
  assert.equal(transactionCalls, 0);
});

test("TC-2167 J5 AC1 AC3 an Event Coordinator reaches the notifier, and its result is returned", async () => {
  const { response, transactionCalls } = await notifyRoute({
    role: "EVENT_COORDINATOR",
    runTransaction: async () => ({ eventId: "event-1", sent: 2, types: ["EQUIPMENT_REQUEST_RAISED"] })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { eventId: "event-1", sent: 2, types: ["EQUIPMENT_REQUEST_RAISED"] });
  assert.equal(transactionCalls, 1);
});

const cancelReservationsRoute = async ({ role, authorization = "Bearer valid-token" }) => {
  let transactionCalls = 0;
  const firestore = {
    collection(name) {
      if (name === "users") {
        return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ role }) }) }) };
      }
      if (name === "equipment_reservations") {
        return { where: () => ({ collection: name, eventId: "event-1" }) };
      }
      return { doc: (id) => ({ collection: name, id }) };
    },
    async runTransaction(operation) {
      transactionCalls += 1;
      return operation({
        get: async (reference) => {
          if (reference.collection === "equipment_reservations") return { docs: [] };
          if (reference.collection === "events") {
            return { exists: true, data: () => ({ coordinator_id: "user-1", status: "CANCELLED" }) };
          }
          return { exists: false };
        }
      });
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
    const response = await fetch(`http://127.0.0.1:${port}/api/equipment/events/event-1/cancel-reservations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body: JSON.stringify({ reason: "Event cancelled" })
    });
    return { response, transactionCalls };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test("TC-0515 D4 only an Event Coordinator can release reservations after event cancellation", async () => {
  const { response, transactionCalls } = await cancelReservationsRoute({ role: "TECHNICAL_SUPPORT_STAFF" });
  assert.equal(response.status, 403);
  assert.equal(transactionCalls, 0);
});

test("TC-0516 D4 an authenticated coordinator reaches the cancellation release operation", async () => {
  const { response, transactionCalls } = await cancelReservationsRoute({ role: "EVENT_COORDINATOR" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { released: 0 });
  assert.equal(transactionCalls, 1);
});

// G6 / SCRUM-138 AC3 — the routes Technical Support use to reassess a flagged reservation.
// The rules themselves are in reservations.test.js (G6-TC1 to TC12); these pin who may call them.
const reassessRoute = async ({ role, path, body = {}, authorization = "Bearer valid-token", runTransaction, profileError }) => {
  let transactionCalls = 0;
  const firestore = {
    collection() {
      return { doc: () => ({ get: async () => { if (profileError) throw profileError; return { exists: true, data: () => ({ role }) }; } }) };
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
    const response = await fetch(`http://127.0.0.1:${port}/api/equipment${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body: JSON.stringify(body)
    });
    return { response, transactionCalls };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};
const G6_ROUTES = [
  ["/events/event-1/recheck-availability", {}],
  ["/reservations/res-1/keep", { note: "Fits" }],
  ["/reservations/res-1/amend", { quantity: 3, note: "More" }]
];

test("G6-TC18 AC3 only Technical Support Staff can re-check, keep or amend, and nothing is read or written for anyone else", async () => {
  for (const [path, body] of G6_ROUTES) {
    for (const role of ["EVENT_COORDINATOR", "EVENT_ORGANISER", "VENUE_STAFF", "ATTENDEE"]) {
      const { response, transactionCalls } = await reassessRoute({
        role, path, body,
        runTransaction: async () => { throw new Error("An unauthorised caller reached the reassessment transaction."); }
      });
      assert.equal(response.status, 403, `${role} ${path}`);
      assert.match((await response.json()).error, /only technical support staff/i);
      assert.equal(transactionCalls, 0);
    }
  }
});

test("G6-TC19 AC3 a request with no bearer token is refused before any profile or reservation is touched", async () => {
  for (const [path, body] of G6_ROUTES) {
    const { response, transactionCalls } = await reassessRoute({
      role: "TECHNICAL_SUPPORT_STAFF", path, body, authorization: "",
      runTransaction: async () => { throw new Error("Unauthenticated request reached Firestore."); }
    });
    assert.equal(response.status, 401, path);
    assert.equal(transactionCalls, 0);
  }
});

test("G6-TC20 AC3 a Technical Support member reaches each operation, and a refusal comes back with its status and reason", async () => {
  for (const [path, body] of G6_ROUTES) {
    const { response, transactionCalls } = await reassessRoute({
      role: "TECHNICAL_SUPPORT_STAFF", path, body,
      runTransaction: async () => { throw Object.assign(new Error("Nothing is waiting for reassessment."), { statusCode: 409 }); }
    });
    assert.equal(response.status, 409, path);
    assert.deepEqual(await response.json(), { error: "Nothing is waiting for reassessment." });
    assert.equal(transactionCalls, 1);
  }
});

test("G6-TC40 AC3 an unexpected failure, in the profile read or the reassessment itself, is a server error and not a hang", async () => {
  for (const [path, body] of G6_ROUTES) {
    const profile = await reassessRoute({ role: "TECHNICAL_SUPPORT_STAFF", path, body, profileError: new Error("unavailable"), runTransaction: async () => ({}) });
    assert.equal(profile.response.status, 500, path);
    assert.equal(profile.transactionCalls, 0);

    const aborted = await reassessRoute({
      role: "TECHNICAL_SUPPORT_STAFF", path, body,
      runTransaction: async () => { throw new Error("aborted"); }
    });
    assert.equal(aborted.response.status, 500, path);
  }
});

test("G6-TC41 AC3 a Technical Support member's successful re-check, keep or amend returns what the operation returned", async () => {
  for (const [path, body] of G6_ROUTES) {
    const { response, transactionCalls } = await reassessRoute({
      role: "TECHNICAL_SUPPORT_STAFF", path, body,
      runTransaction: async () => ({ done: path })
    });
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { done: path });
    assert.equal(transactionCalls, 1);
  }
});
