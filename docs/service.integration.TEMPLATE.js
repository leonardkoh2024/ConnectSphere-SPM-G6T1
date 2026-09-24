// TEMPLATE — an emulator integration test for one service.
//
// Copy this to:  backend/src/services/<yourService>/<yourService>.integration.js
// IMPORTANT: name it "<yourService>.integration.js" — do NOT end it in ".test.js", or the
// default `node --test` unit run will auto-discover it and fail (it needs the emulator).
//
// Run it (from the repo root):
//   npx firebase emulators:exec --only firestore --project demo-connectsphere "node --test backend/src/services/<yourService>/<yourService>.integration.js"
//
// The import path below (../../../testing/...) assumes the file sits at
// backend/src/services/<yourService>/. Adjust the ../ count if you place it elsewhere.

import test from "node:test";
import assert from "node:assert/strict";

import { emulatorFirestore, serverTimestamp, wipe, seed } from "../../../testing/firestoreEmulator.js";

// TODO 1 — import the REAL service factory you want to test (not a fake/mock).
// import { createYourService } from "./yourService.js";

const db = emulatorFirestore();

// TODO 2 — every collection this test reads or writes, so it starts clean.
const COLLECTIONS = ["events", "coordinators", "assignment_cursor"];

test("SCRUM-XXX / TC-XXX — <plain description of the behaviour being proven>", async () => {
  await wipe(db, COLLECTIONS);

  // TODO 3a — seed the fixture your service reads.
  await seed(db, [
    { path: "coordinators/c1", data: { coordinator_seq: 1 } },
    { path: "coordinators/c2", data: { coordinator_seq: 2 } },
    // ...add events, cursor docs, whatever this service needs...
  ]);

  // TODO 3b — build the real service, wired to the emulator db.
  // const doTheThing = createYourService({ firestore: db, serverTimestamp });

  // TODO 3c — exercise it. For a CONCURRENCY test, fire calls together with Promise.all:
  //   const results = await Promise.all(ids.map((id) => doTheThing(id)));
  // For a plain flow, just await it once.

  // TODO 3d — assert the invariants by RE-READING from Firestore (the source of truth),
  //           not just the return value.
  // const snap = await db.collection("events").get();
  // snap.forEach((docSnap) => { assert.ok(docSnap.data().coordinator_id); });

  assert.ok(true, "replace me with real assertions");
});

test.after(async () => { await wipe(db, COLLECTIONS); });
