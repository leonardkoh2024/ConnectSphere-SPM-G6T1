// C1 / SCRUM-102 — the transactional half. The rotation *decision* is
// frontend/src/domain/coordinatorAssignment.js; everything here is Firestore
// plumbing: read the cursor and the coordinator list, guard against a second
// assignment, write, advance the cursor — all inside one transaction so two
// concurrent submissions cannot double-assign or skip a coordinator (TC-077).
//
// `firestore` and `serverTimestamp` are injected rather than imported from
// ../../lib/firebaseAdmin so this can be unit-tested against a mocked Firestore
// without the emulator — see backend/README.md and
// frontend/src/security/firestoreRules.test.js for why this repo does not run
// one (no Java runtime added). A transaction is still the right tool for a real
// deployment; the mock in the test file stands in for what the emulator would
// otherwise verify.

import { pickNextCoordinator } from "../../../../frontend/src/domain/coordinatorAssignment.mjs";

const CURSOR_DOC_ID = "default";

export class EventNotFoundError extends Error {
  constructor(eventId) {
    super(`No event ${eventId}`);
    this.name = "EventNotFoundError";
  }
}

export function createAssignCoordinator({ firestore, serverTimestamp }) {
  return async function assignCoordinator(eventId) {
    return firestore.runTransaction(async (tx) => {
      const eventRef = firestore.collection("events").doc(eventId);
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) throw new EventNotFoundError(eventId);

      // AC7 / TC-079 — assignment runs once. A second call (a re-save, a retry,
      // two racing requests for the same event) finds coordinator_id already set
      // and returns it unchanged rather than assigning again.
      const existing = eventSnap.data().coordinator_id;
      if (existing) return { alreadyAssigned: true, coordinatorId: existing };

      const coordinatorsSnap = await tx.get(firestore.collection("coordinators"));
      const coordinators = coordinatorsSnap.docs.map((doc) => ({ id: doc.id, coordinator_seq: doc.data().coordinator_seq }));

      const cursorRef = firestore.collection("assignment_cursor").doc(CURSOR_DOC_ID);
      const cursorSnap = await tx.get(cursorRef);
      const lastAssignedSeq = cursorSnap.exists ? cursorSnap.data().last_assigned_seq : null;

      const picked = pickNextCoordinator(coordinators, lastAssignedSeq);

      tx.update(eventRef, { coordinator_id: picked.id, assigned_at: serverTimestamp() });
      tx.set(cursorRef, { last_assigned_seq: picked.coordinator_seq }, { merge: true });

      return { alreadyAssigned: false, coordinatorId: picked.id };
    });
  };
}
