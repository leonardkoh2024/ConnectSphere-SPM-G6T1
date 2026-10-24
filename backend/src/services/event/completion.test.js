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

test("D5 AC1 rejects completion unless the event end has passed on the server clock", async () => {
  const { response, writes } = await runCompletion({
    event: confirmedEvent,
    now: new Date("2026-10-24T09:00:00Z")
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /end date and time have not passed/i);
  assert.deepEqual(writes.updates, []);
  assert.deepEqual(writes.sets, []);
});

test("D5 AC1 rejects non-confirmed events and non-coordinator callers", async () => {
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

test("D5 AC2/AC3 changes only status timestamps and appends a completion history row", async () => {
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
