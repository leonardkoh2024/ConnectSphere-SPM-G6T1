// H1 / SCRUM-139 — the registration service's front door: who may reach the settings
// transaction at all. Same checks as the equipment service (TC-304): a bearer token that
// verifies, then a profile holding the right role, before any transaction starts.

import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { createRegistrationService } from "./service.js";

const exercise = async ({ authorization = "Bearer valid-token", role = "EVENT_ORGANISER", method = "GET", body } = {}) => {
  let transactionCalls = 0;
  const firestore = {
    collection(name) {
      return {
        doc(id) {
          return {
            id,
            path: `${name}/${id}`,
            async get() {
              assert.equal(name, "users");
              return { exists: true, data: () => ({ role }) };
            }
          };
        }
      };
    },
    async runTransaction() {
      transactionCalls += 1;
      throw new Error("stop here: the transaction was reached");
    }
  };
  const app = express();
  app.use(express.json());
  app.use("/api/registrations", createRegistrationService({
    firestore,
    verifyIdToken: async (token) => {
      if (token !== "valid-token") throw new Error("bad token");
      return { uid: "user-1" };
    },
    serverTimestamp: () => ({ serverTimestamp: true }),
    getApprovedEventBookings: async () => []
  }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const headers = { "Content-Type": "application/json" };
    if (authorization) headers.Authorization = authorization;
    const response = await fetch(`http://127.0.0.1:${port}/api/registrations/events/e1/settings`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    return { response, transactionCalls };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test("H1-TC45 AC1 a request with no sign-in is refused before anything is read", async () => {
  const { response, transactionCalls } = await exercise({ authorization: null });
  assert.equal(response.status, 401);
  assert.equal(transactionCalls, 0);
});

test("H1-TC46 AC1 a token that does not verify is refused", async () => {
  const { response, transactionCalls } = await exercise({ authorization: "Bearer forged" });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /invalid or expired/i);
  assert.equal(transactionCalls, 0);
});

for (const role of ["EVENT_COORDINATOR", "EVENT_COORDINATOR_LEAD", "VENUE_STAFF", "TECHNICAL_SUPPORT_STAFF", "SAFETY_OFFICER", "ATTENDEE"]) {
  for (const method of ["GET", "PUT"]) {
    test(`H1-TC47 AC1 a ${role} cannot ${method} an event's registration settings`, async () => {
      const { response, transactionCalls } = await exercise({ role, method, body: method === "PUT" ? { registration_capacity: 10 } : undefined });
      assert.equal(response.status, 403);
      assert.match((await response.json()).error, /only an event organiser/i);
      assert.equal(transactionCalls, 0);
    });
  }
}

test("H1-TC48 AC1 an Event Organiser reaches the settings transaction", async () => {
  const { transactionCalls } = await exercise({ role: "EVENT_ORGANISER" });
  assert.equal(transactionCalls, 1);
});
