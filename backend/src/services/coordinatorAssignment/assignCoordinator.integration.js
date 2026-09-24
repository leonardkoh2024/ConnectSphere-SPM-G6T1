// LAST-MILE / live-Firestore proof for C1 (SCRUM-102), using the shared emulator harness.
//
// Named *.integration.js (NOT *.test.js) so the default `node --test` unit run does NOT
// auto-discover it — it must only run under the emulator. Run it with:
//   npx firebase emulators:exec --only firestore --project demo-connectsphere \
//     "node --test backend/src/services/coordinatorAssignment/assignCoordinator.integration.js"
//
// Proves what the in-memory fake cannot: that concurrent submissions racing over a REAL
// Firestore transaction each get exactly one distinct-in-rotation coordinator, with no skip
// and no double-use.

import test from "node:test";
import assert from "node:assert/strict";

import { emulatorFirestore, serverTimestamp, wipe, seed } from "../../../testing/firestoreEmulator.js";
import { createAssignCoordinator } from "./assignCoordinator.js";

const db = emulatorFirestore();
const assignCoordinator = createAssignCoordinator({ firestore: db, serverTimestamp });

const COLLECTIONS = ["events", "coordinators", "assignment_cursor"];

async function seedFixture(coordinatorCount, eventCount) {
  const docs = [];
  for (let i = 1; i <= coordinatorCount; i++) {
    docs.push({ path: `coordinators/c${i}`, data: { coordinator_seq: i, name: `Coordinator ${i}` } });
  }
  docs.push({ path: "assignment_cursor/default", data: { last_assigned_seq: null } });
  for (let i = 1; i <= eventCount; i++) {
    docs.push({ path: `events/e${i}`, data: { status: "SUBMITTED", coordinator_id: null } });
  }
  await seed(db, docs);
}

test("TC-077 (live) concurrent submissions serialise: one coordinator each, no skip, no double-use", async () => {
  const COORDINATORS = 3;
  const EVENTS = 30;
  await wipe(db, COLLECTIONS);
  await seedFixture(COORDINATORS, EVENTS);

  const eventIds = Array.from({ length: EVENTS }, (_, i) => `e${i + 1}`);

  // THE RACE: all assignments fire at once — real transactions contending over the wire.
  const results = await Promise.all(eventIds.map((id) => assignCoordinator(id)));

  // 1. Every event freshly assigned exactly one coordinator.
  assert.equal(results.length, EVENTS);
  for (const r of results) {
    assert.equal(r.alreadyAssigned, false);
    assert.ok(r.coordinatorId, "each event got a coordinator");
  }

  // 2. Re-read the source of truth: one coordinator + a timestamp per event.
  const events = await db.collection("events").get();
  const counts = {};
  events.forEach((doc) => {
    const cid = doc.data().coordinator_id;
    assert.ok(cid, `${doc.id} has a coordinator_id`);
    assert.ok(doc.data().assigned_at, `${doc.id} has assigned_at`);
    counts[cid] = (counts[cid] || 0) + 1;
  });

  // 3. Perfectly even distribution — uneven counts would mean a cursor value was read twice
  //    (a coordinator double-used, another skipped). Even == the transaction serialised.
  const values = Object.values(counts);
  assert.equal(values.reduce((a, b) => a + b, 0), EVENTS);
  assert.ok(Math.max(...values) - Math.min(...values) <= 1, `even distribution, got ${JSON.stringify(counts)}`);

  // 4. Cursor advanced exactly once per assignment.
  const cursor = (await db.collection("assignment_cursor").doc("default").get()).data();
  const expectedSeq = ((EVENTS - 1) % COORDINATORS) + 1;
  assert.equal(cursor.last_assigned_seq, expectedSeq, "cursor landed on the expected seq");
});

test("TC-079 (live) re-running on an already-assigned event does not reassign", async () => {
  await wipe(db, COLLECTIONS);
  await seedFixture(3, 1);
  const first = await assignCoordinator("e1");
  const second = await assignCoordinator("e1");
  assert.equal(second.alreadyAssigned, true);
  assert.equal(second.coordinatorId, first.coordinatorId);
});

test.after(async () => { await wipe(db, COLLECTIONS); });
