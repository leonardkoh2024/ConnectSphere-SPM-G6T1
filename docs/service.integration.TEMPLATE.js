// TEMPLATE — an emulator integration test for one service.
//
// Copy this to:  backend/src/services/<yourService>/<yourService>.integration.js
// IMPORTANT: name it "<yourService>.integration.js" — do NOT end it in ".test.js", or the
// default `node --test` unit run will auto-discover it and fail (it needs the emulator).
//
// Run every integration test (from the repo root) — starts the emulator, runs, shuts it down:
//   npm run test:integration
//
// The import path below (../../../testing/...) assumes the file sits at
// backend/src/services/<yourService>/. Adjust the ../ count if you place it elsewhere.

import test from "node:test";
import assert from "node:assert/strict";

import { emulatorFirestore, serverTimestamp, seed, useFreshBaseline } from "../../../testing/firestoreEmulator.js";
import { baseline } from "../../../testing/fixtures.js";

// TODO 1 — import the REAL service factory you want to test (not a fake/mock).
// import { createYourService } from "./yourService.js";

const db = emulatorFirestore();

// TODO 2 — data EVERY test needs goes in baseline() (backend/testing/fixtures.js). Before each
// test the whole database is cleared and baseline() re-seeded; after the file it is cleared again.
useFreshBaseline(db, baseline);

test("SCRUM-XXX / TC-XXX — <plain description of the behaviour being proven>", async () => {
  // TODO 3a — seed anything only THIS test needs, on top of the baseline.
  await seed(db, [
    { path: "events/e1", data: { status: "SUBMITTED", coordinator_id: null } },
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
