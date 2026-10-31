import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { createEventCompletionService } from "./completion.js";

const runCompletion = async ({ event, role = "EVENT_COORDINATOR", now = new Date("2026-10-25T00:00:00Z") }) => {
  const writes = { updates: [], sets: [] };
  const stored = {
    "events/e1": event,
    "users/c1": { role }
  };
  const firestore = {
    collection(name) {
      return {
        doc(id = "history-1") {
          const ref = { path: `${name}/${id}`, id };
          return {
            ...ref,
            async get() {
              const data = stored[ref.path];
              return { exists: Boolean(data), data: () => data };
            }
          };
        }
      };
    },
    async runTransaction(work) {
      return work({
        async get(ref) {
          const data = stored[ref.path];
          return { exists: Boolean(data), data: () => data };
        },
        update(ref, data) { writes.updates.push([ref.path, data]); },
        set(ref, data) { writes.sets.push([ref.path, data]); }
      });
    }
  };
  const app = express();
  app.use(express.json());
  app.use("/api/events", createEventCompletionService({
    firestore,
    verifyIdToken: async (token) => {
      assert.equal(token, "valid-token");
      return { uid: "c1" };
    },
    now: () => now,
    serverTimestamp: () => "SERVER_TIME"
  }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events/e1/complete`, {
      method: "POST",
      headers: { Authorization: "Bearer valid-token" }
    });
    return { response, writes };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

const confirmedEvent = {
  coordinator_id: "c1",
  status: "CONFIRMED",
  event_date: "2026-10-24",
  end_time: "17:00"
};

test("TC-0530 D5 AC1 rejects completion unless the event end has passed on the server clock", async () => {
  const { response, writes } = await runCompletion({
    event: confirmedEvent,
    now: new Date("2026-10-24T09:00:00Z")
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /end date and time have not passed/i);
  assert.deepEqual(writes.updates, []);
  assert.deepEqual(writes.sets, []);
});

test("TC-0531 D5 AC1 rejects non-confirmed events and non-coordinator callers", async () => {
  const notConfirmed = await runCompletion({ event: { ...confirmedEvent, status: "PLANNING" } });
  assert.equal(notConfirmed.response.status, 409);
  assert.deepEqual(notConfirmed.writes.updates, []);

  const wrongCoordinator = await runCompletion({ event: { ...confirmedEvent, coordinator_id: "c2" } });
  assert.equal(wrongCoordinator.response.status, 403);
  assert.deepEqual(wrongCoordinator.writes.updates, []);

  const wrongRole = await runCompletion({ event: confirmedEvent, role: "EVENT_COORDINATOR_LEAD" });
  assert.equal(wrongRole.response.status, 403);
  assert.deepEqual(wrongRole.writes.updates, []);
});

test("TC-0532 D5 AC2/AC3 changes only status timestamps and appends a completion history row", async () => {
  const { response, writes } = await runCompletion({ event: confirmedEvent });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(writes.updates, [[
    "events/e1",
    { status: "COMPLETED", completed_at: "SERVER_TIME", updated_at: "SERVER_TIME" }
  ]]);
  assert.deepEqual(writes.sets, [[
    "event_history/history-1",
    {
      history_id: "history-1",
      event_id: "e1",
      actor_id: "c1",
      action_type: "EVENT_COMPLETED",
      field_name: "status",
      old_value: "CONFIRMED",
      new_value: "COMPLETED",
      description: "Coordinator marked the event completed after its scheduled end.",
      created_at: "SERVER_TIME"
    }
  ]]);
});

// Functional cases over the shared in-memory Firestore, with the real clock where noted.
import { fakeFirestore } from "../../../testing/fakeFirestore.js";

const completeVia = async ({ collections, token = "valid-token", uid = "c1", now, failRead = false }) => {
  const firestore = fakeFirestore(collections);
  if (failRead) firestore.collection = () => ({ doc: () => ({ get: async () => { throw new Error("unavailable"); } }) });
  const app = express();
  app.use("/api/events", createEventCompletionService({
    firestore,
    verifyIdToken: async (given) => { if (given !== "valid-token") throw new Error("bad token"); return { uid }; },
    ...(now ? { now: () => now } : {}),
    serverTimestamp: () => "SERVER_TIME"
  }));
  app.use((_error, _request, response, _next) => response.status(500).json({ error: "Internal server error" }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events/e1/complete`, {
      method: "POST",
      headers: token ? { Authorization: token.startsWith("Basic") ? token : `Bearer ${token}` } : {}
    });
    return { status: response.status, body: await response.json(), firestore };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};
const coordinatorAnd = (events) => ({ users: { c1: { role: "EVENT_COORDINATOR" } }, events });

test("TC-0533 [normal] D5 the server's own clock is used when no clock is injected", async () => {
  const { status, firestore } = await completeVia({ collections: coordinatorAnd({ e1: { ...confirmedEvent, event_date: "2020-01-01" } }) });
  assert.equal(status, 200);
  assert.equal(firestore.store.events.e1.status, "COMPLETED");
});

test("TC-0534 [boundary] D5 exactly at the scheduled end (Singapore time) is still too early; one millisecond later completes", async () => {
  const end = new Date("2026-10-24T17:00:00+08:00");
  const atEnd = await completeVia({ collections: coordinatorAnd({ e1: confirmedEvent }), now: end });
  assert.equal(atEnd.status, 409);
  const after = await completeVia({ collections: coordinatorAnd({ e1: confirmedEvent }), now: new Date(end.getTime() + 1) });
  assert.equal(after.status, 200);
});

test("TC-0535 [failure] D5 completion needs a Bearer token that verifies", async () => {
  for (const token of [null, "Basic abc"]) {
    assert.deepEqual((await completeVia({ collections: coordinatorAnd({ e1: confirmedEvent }), token })).body, { error: "Sign in is required." });
  }
  const forged = await completeVia({ collections: coordinatorAnd({ e1: confirmedEvent }), token: "forged" });
  assert.deepEqual(forged, { ...forged, status: 401, body: { error: "Your sign-in session is invalid or expired." } });
});

test("TC-0536 [failure] D5 a missing profile is refused and a missing event is a 404", async () => {
  const noProfile = await completeVia({ collections: { users: {}, events: { e1: confirmedEvent } } });
  assert.deepEqual(noProfile.body, { error: "Only an Event Coordinator can complete an event." });
  assert.equal(noProfile.status, 403);
  const noEvent = await completeVia({ collections: coordinatorAnd({}) });
  assert.deepEqual([noEvent.status, noEvent.body], [404, { error: "Event not found." }]);
});

test("TC-0537 [conflict] D5 an event in a later or ended status cannot be completed again", async () => {
  for (const status of ["COMPLETED", "CANCELLED", "SAFETY_REVIEW"]) {
    const result = await completeVia({ collections: coordinatorAnd({ e1: { ...confirmedEvent, status } }), now: new Date("2027-01-01T00:00:00Z") });
    assert.deepEqual([result.status, result.body], [409, { error: "Only a confirmed event can be completed." }], status);
    assert.equal(result.firestore.log.writes.length, 0);
  }
});

test("TC-0538 [failure] D5 a Firestore failure is passed on as a 500", async () => {
  const result = await completeVia({ collections: coordinatorAnd({ e1: confirmedEvent }), failRead: true });
  assert.deepEqual([result.status, result.body], [500, { error: "Internal server error" }]);
});
