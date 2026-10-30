// Helpers every feature's *Api.js modules need. Nothing feature-specific belongs
// here; a helper only one feature uses stays in that feature's *ApiSupport.js.

import { auth } from "./firebase";

// A Firestore Timestamp as an ISO string. A value that is already a string (or a
// test double) passes through, and a missing one becomes null.
export const asIso = (value) => value?.toDate?.().toISOString?.() || value || null;

// The signed-in user, for calls the browser SDK makes on their behalf.
export const requireUser = () => {
  if (!auth.currentUser) throw new Error("Please sign in again.");
  return auth.currentUser;
};
