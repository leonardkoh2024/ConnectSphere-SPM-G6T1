// B8 / SCRUM-99 — deleting a draft.
//
// A request is spread over five collections, so removing the event document alone
// would leave its requirements, facilities, equipment, accessibility answers and
// history behind as orphans. B8 AC3 asks for the draft to be unretrievable by ID,
// which means all six go.
//
// Order matters: the child rules authorise by looking the parent event up, so the
// children have to go while the event is still there to prove ownership.

import { collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";

// Keyed by the event's own id, one document per event.
const KEYED_BY_EVENT_ID = ["event_venue_requirements"];

// Queried by an event_id field, any number of documents per event.
const LINKED_BY_EVENT_ID = ["event_facilities", "event_equipment", "event_accessibility", "event_history"];

export default async function deleteEventRequest(eventId) {
  const linked = await Promise.all(
    LINKED_BY_EVENT_ID.map((name) => getDocs(query(collection(db, name), where("event_id", "==", eventId))))
  );

  await Promise.all([
    ...KEYED_BY_EVENT_ID.map((name) => deleteDoc(doc(db, name, eventId))),
    ...linked.flatMap((snapshot) => snapshot.docs.map((item) => deleteDoc(item.ref)))
  ]);

  await deleteDoc(doc(db, "events", eventId));
}
