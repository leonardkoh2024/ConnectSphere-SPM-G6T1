import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { PROJECT_ID, USERS } from "./test-users.js";

export default async function globalSetup() {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

  // Safety guard: never seed the shared team project.
  if (!firestoreHost || !authHost) {
    throw new Error("Refusing to run: start the tests with `npm run e2e` so the emulators are running.");
  }

  // Start every run from an empty database and no accounts.
  await fetch(`http://${firestoreHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });

  initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth();
  const db = getFirestore();

  for (const u of Object.values(USERS)) {
    await auth.createUser({ uid: u.uid, email: u.email, password: u.password, displayName: u.name });
    await db.collection("users").doc(u.uid).set({
      user_id: u.uid,
      name: u.name,
      email: u.email,
      role: u.role,
      organisation_name: "E2E Org",
      mobile_number: "91234567",
      preferred_contact_method: "EMAIL",
      is_active: true,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp()
    });
  }
}