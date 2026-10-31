// Self-test for the emulator harness: proves every test really starts from the same data.
// Runs with `npm run test:integration` alongside the service integration tests.

import test from "node:test";
import assert from "node:assert/strict";

import { emulatorFirestore, resetEmulator, seed, useFreshBaseline } from "./firestoreEmulator.js";

const db = emulatorFirestore();

// A small baseline of its own, so this file checks the harness, not the shared fixtures.
const harnessBaseline = () => [
  { path: "users/u1", data: { name: "User 1", role: "EVENT_ORGANISER" } },
  { path: "events/e1", data: { name: "Event 1", status: "DRAFT", organiser_id: "u1" } },
];
useFreshBaseline(db, harnessBaseline);

const count = async (collection) => (await db.collection(collection).get()).size;

// The next four run in order and each depends on the one before having made a mess.
test("TC-2506 a test can update, delete and add baseline data", async () => {
  await db.doc("events/e1").update({ status: "SUBMITTED" });
  await db.doc("users/u1").delete();
  await seed(db, [{ path: "venues/v1", data: { name: "Hall" } }]);
  await db.doc("events/e1").collection("notes").doc("n1").set({ text: "subcollection" });
  assert.equal(await count("users"), 0);
});

test("TC-2507 the next test sees the baseline again, untouched", async () => {
  assert.equal((await db.doc("events/e1").get()).data().status, "DRAFT");
  assert.ok((await db.doc("users/u1").get()).exists, "deleted doc is back");
  assert.equal(await count("venues"), 0, "added doc is gone");
  assert.equal((await db.doc("events/e1").collection("notes").get()).size, 0, "subcollection is gone");
});

test("TC-2508 mutating the baseline objects in memory does not leak into the next seed", async () => {
  const docs = harnessBaseline();
  docs[1].data.status = "CANCELLED";
  await seed(db, docs);
  assert.equal((await db.doc("events/e1").get()).data().status, "CANCELLED");
});

test("TC-2509 so the next test still starts from DRAFT", async () => {
  assert.equal((await db.doc("events/e1").get()).data().status, "DRAFT");
});

test("TC-2510 seed handles more than one batch (over 500 writes)", async () => {
  const many = Array.from({ length: 650 }, (_, i) => ({ path: `bulk/b${i}`, data: { i } }));
  await seed(db, many);
  assert.equal(await count("bulk"), 650);
});

test("TC-2511 reset refuses to run when not pointed at the emulator", async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  try {
    await assert.rejects(resetEmulator(), /FIRESTORE_EMULATOR_HOST is not set/);
  } finally {
    process.env.FIRESTORE_EMULATOR_HOST = host;
  }
});
