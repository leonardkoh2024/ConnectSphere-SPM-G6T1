// Shared harness for Firestore emulator integration tests.
// Repo location: backend/testing/firestoreEmulator.js
// (Folder is "testing", NOT "test", on purpose: `node --test` auto-scans folders named
//  "test", which would run this helper as if it were a test file.)
//
// Every integration test imports these helpers, so the per-service test only says WHAT to
// seed and WHAT to assert. Unit tests use an in-memory fake; these connect the REAL Admin
// SDK to the local Firestore EMULATOR — a throwaway database, no credentials, nothing shared.

import admin from "firebase-admin";

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
    admin.initializeApp({
      projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "demo-connectsphere",
    });
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

/** Seed documents. docs: [{ path: "coordinators/c1", data: { coordinator_seq: 1 } }, ...] */
export async function seed(db, docs) {
  const batch = db.batch();
  for (const { path, data } of docs) batch.set(db.doc(path), data);
  await batch.commit();
}
