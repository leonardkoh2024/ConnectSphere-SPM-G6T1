// Shared harness for Firestore emulator integration tests.
// Repo location: backend/testing/firestoreEmulator.js
// (Folder is "testing", NOT "test", on purpose: `node --test` auto-scans folders named
//  "test", which would run this helper as if it were a test file.)
//
// Every integration test imports these helpers, so the per-service test only says WHAT to
// seed and WHAT to assert. Unit tests use an in-memory fake; these connect the REAL Admin
// SDK to the local Firestore EMULATOR — a throwaway database, no credentials, nothing shared.

import test from "node:test";
import admin from "firebase-admin";

// `firebase emulators:exec --project demo-connectsphere` sets GCLOUD_PROJECT. A `demo-` ID means
// the emulator cannot reach any real Firebase service. Never fall back to the team's real ID.
const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-connectsphere";

/**
 * Real Admin Firestore handle pointed at the emulator.
 * Safety guard: refuses to run unless FIRESTORE_EMULATOR_HOST is set, so a test can never
 * touch a live project by accident. `firebase emulators:exec` sets it for you.
 */
export function emulatorFirestore() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "Refusing to run: FIRESTORE_EMULATOR_HOST is not set. Integration tests must run " +
      "against the Firestore emulator, never a live project. Use `firebase emulators:exec`."
    );
  }
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  return admin.firestore();
}

/** A real server timestamp, for services that take serverTimestamp as an injected dependency. */
export const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

/** Delete every document in each named collection (emulator-only). */
export async function wipe(db, collections) {
  for (const name of collections) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  }
}

/** Seed documents. docs: [{ path: "events/e1", data: { status: "Submitted" } }, ...] */
export async function seed(db, docs) {
  // A Firestore batch holds at most 500 writes.
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    for (const { path, data } of docs.slice(i, i + 500)) batch.set(db.doc(path), data);
    await batch.commit();
  }
}

/** Clear the ENTIRE emulator database — every collection and subcollection — in one call. */
export async function resetEmulator() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("Refusing to reset: FIRESTORE_EMULATOR_HOST is not set.");
  const res = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(`Emulator reset failed: ${res.status} ${await res.text()}`);
}

/**
 * Give every test in the calling file the same fresh starting data:
 *   before each test — clear the whole database, then seed `baseline`;
 *   after all tests  — clear it again and close the connection so the process exits.
 * Call it once at the top level of an integration test file. A test that needs more data
 * seeds it on top inside the test itself.
 *
 * `baseline` is a function returning the documents (see testing/fixtures.js), called afresh
 * before every test, so a test that mutates a fixture object in memory cannot leak that edit
 * into the next test's seed.
 */
export function useFreshBaseline(db, baseline) {
  test.beforeEach(async () => {
    await resetEmulator();
    await seed(db, baseline());
  });
  test.after(async () => {
    await resetEmulator();
    await db.terminate();
  });
}
