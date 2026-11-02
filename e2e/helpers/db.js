// Read-only lookups in the emulator database, for the few checks the screens do
// not expose (an event's document id, say). Refuses to run against anything but
// the emulator, like global-setup.
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { PROJECT_ID } from "../test-users.js";

const db = () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Refusing to read: FIRESTORE_EMULATOR_HOST is not set.");
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  return getFirestore();
};

export async function eventIdByReference(referenceNo) {
  const found = await db().collection("events").where("reference_no", "==", referenceNo).limit(1).get();
  if (found.empty) throw new Error(`No event with reference ${referenceNo}`);
  return found.docs[0].id;
}

// Stands in for time passing: moves an event's date (YYYY-MM-DD), for the stories
// that only apply after an event has happened (D5) or a deadline has passed.
export async function setEventDate(referenceNo, isoDate) {
  const id = await eventIdByReference(referenceNo);
  await db().collection("events").doc(id).update({ event_date: isoDate });
}

// Stands in for time passing on a tentative hold: puts its expiry in the past (F16).
export async function expireHoldsFor(referenceNo) {
  const id = await eventIdByReference(referenceNo);
  const holds = await db().collection("venue_bookings").where("event_id", "==", id).where("status", "==", "HELD").get();
  const past = new Date(Date.now() - 60_000);
  await Promise.all(holds.docs.map((item) => item.ref.update({ hold_expires_at: past })));
  return holds.size;
}

// A Firebase ID token for a test user, from the Auth emulator, so a test can call
// the backend as that user without going through the browser.
export async function idTokenFor(user) {
  db();
  const custom = await getAuth().createCustomToken(user.uid);
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true })
  });
  return (await response.json()).idToken;
}
