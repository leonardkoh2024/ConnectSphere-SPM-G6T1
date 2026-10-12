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
