// LAST-MILE / live-Firestore proof for C1 (SCRUM-102).
//
// The in-memory fake in assignCoordinator.test.js proves the RULES but, as its
// own header says, cannot prove that requests racing over a real Firestore
// transaction truly serialise. This file does — by running the REAL production
// assignCoordinator against a REAL Firestore, and firing the assignments
// concurrently.
//
// It runs against the Firestore EMULATOR only (FIRESTORE_EMULATOR_HOST), so it
// needs no credentials and never touches the shared team project.
//
//   Terminal 1:  firebase emulators:start --only firestore --project demo-connectsphere
//   Terminal 2:  FIRESTORE_EMULATOR_HOST=localhost:8080 \
//                REACT_APP_FIREBASE_PROJECT_ID=demo-connectsphere \
//                node --test backend/src/services/coordinatorAssignment/assignCoordinator.integration.test.js
 
import test from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";
 
import { createAssignCoordinator } from "./assignCoordinator.js";
 
// --- Safety guard: refuse to run unless clearly pointed at an emulator. -------
// This test wipes collections, so it must NEVER hit a live project by accident.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "Refusing to run: FIRESTORE_EMULATOR_HOST is not set. This test deletes " +
    "documents and must only run against the Firestore emulator."
  );
}
 
const PROJECT_ID = process.env.REACT_APP_FIREBASE_PROJECT_ID || "demo-connectsphere";
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
 
const firestore = admin.firestore();
const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();
// The REAL production factory, wired to the REAL admin Firestore.
const assignCoordinator = createAssignCoordinator({ firestore, serverTimestamp });
 
async function wipe() {
  for (const name of ["events", "coordinators", "assignment_cursor"]) {
    const snap = await firestore.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}
 
async function seed(coordinatorCount, eventCount) {
  const batch = firestore.batch();
  for (let i = 1; i <= coordinatorCount; i++) {
    batch.set(firestore.collection("coordinators").doc(`c${i}`), {
      coordinator_seq: i,
      name: `Coordinator ${i}`,
    });
  }
  batch.set(firestore.collection("assignment_cursor").doc("default"), { last_assigned_seq: null });
  for (let i = 1; i <= eventCount; i++) {
    batch.set(firestore.collection("events").doc(`e${i}`), { status: "SUBMITTED", coordinator_id: null });
  }
  await batch.commit();
}
 
test("TC-077 (live) concurrent submissions serialise: one coordinator each, no skip, no double-use", async () => {
  const COORDINATORS = 3;
  const EVENTS = 30;
  await wipe();
  await seed(COORDINATORS, EVENTS);
 
  const eventIds = Array.from({ length: EVENTS }, (_, i) => `e${i + 1}`);
 
  // THE RACE: every assignment fires at once — real transactions contending
  // over the wire, exactly what the fake could not reproduce.
  const results = await Promise.all(eventIds.map((id) => assignCoordinator(id)));
 
  // 1. Every event was freshly assigned exactly one coordinator.
  assert.equal(results.length, EVENTS);
  for (const r of results) {
    assert.equal(r.alreadyAssigned, false);
    assert.ok(r.coordinatorId, "each event got a coordinator");
  }
 
  // 2. Re-read the source of truth: every event has one coordinator + a timestamp.
  const events = await firestore.collection("events").get();
  const counts = {};
  events.forEach((doc) => {
    const cid = doc.data().coordinator_id;
    assert.ok(cid, `${doc.id} has a coordinator_id`);
    assert.ok(doc.data().assigned_at, `${doc.id} has assigned_at`);
    counts[cid] = (counts[cid] || 0) + 1;
  });
 
  // 3. Perfectly even distribution. If two racing transactions had read the same
  //    cursor value, a coordinator would be double-used and another skipped, and
  //    these counts would be uneven. Even counts == the transaction serialised.
  const values = Object.values(counts);
  assert.equal(values.reduce((a, b) => a + b, 0), EVENTS);
  assert.ok(Math.max(...values) - Math.min(...values) <= 1, `even distribution, got ${JSON.stringify(counts)}`);
 
  // 4. The cursor advanced exactly once per assignment (never skipped a step).
  const cursor = (await firestore.collection("assignment_cursor").doc("default").get()).data();
  const expectedSeq = ((EVENTS - 1) % COORDINATORS) + 1;
  assert.equal(cursor.last_assigned_seq, expectedSeq, "cursor landed on the expected seq");
});
 
test("TC-079 (live) re-running on an already-assigned event does not reassign", async () => {
  await wipe();
  await seed(3, 1);
  const first = await assignCoordinator("e1");
  const second = await assignCoordinator("e1");
  assert.equal(second.alreadyAssigned, true);
  assert.equal(second.coordinatorId, first.coordinatorId);
});
 
test.after(async () => { await wipe(); });