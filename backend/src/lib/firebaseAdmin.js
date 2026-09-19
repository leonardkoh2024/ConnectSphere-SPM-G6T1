// The one module in the backend that talks to Firebase Admin. Everything else
// that needs Firestore goes through `db()` here, the same way frontend/src/lib
// /firebase.js is the only module on the client side that imports firebase/*.
//
// Credentials: GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key
// file is the standard Admin SDK lookup and needs no code here — see
// backend/README.md for how to get one. Against the Firestore emulator
// (FIRESTORE_EMULATOR_HOST set) no credentials are read at all.

import admin from "firebase-admin";

let app;

export function firebaseAdmin() {
  if (!app) {
    app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID });
  }
  return app;
}

export function db() {
  return firebaseAdmin().firestore();
}

export { admin };
