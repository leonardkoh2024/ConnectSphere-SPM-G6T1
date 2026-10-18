// J1 / SCRUM-150 — reads and the one write the inbox makes. Like the rest of the
// frontend this is the browser Firebase SDK; firestore.rules lets a user read
// only notifications addressed to them and change nothing but the read marker.

import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { newestFirst } from "../../domain/notifications";

const asIso = (value) => value?.toDate?.().toISOString?.() || value || null;

const record = (snapshot) => {
  const data = snapshot.data();
  return { id: snapshot.id, ...data, created_at: asIso(data.created_at), read_at: asIso(data.read_at) };
};

// Live, so the badge moves the moment something arrives. Filtered on user_id
// alone and sorted here, which needs no composite index.
export const watchNotifications = (userId, onChange, onError) => onSnapshot(
  query(collection(db, "notifications"), where("user_id", "==", userId)),
  (snapshot) => onChange(newestFirst(snapshot.docs.map(record))),
  onError
);

export const markNotificationRead = (notificationId) => updateDoc(doc(db, "notifications", notificationId), {
  is_read: true,
  read_at: serverTimestamp()
});

// AC1 — the related events, for their names and for View. Each is read on its
// own so one that is gone is just null. J4 — one the rules refuse is false, not
// null: Venue Staff are told about events they may not read, and that event is
// not gone. The record is returned as stored, the shape the event screens open.
export const eventsFor = async (eventIds) => {
  const unique = [...new Set(eventIds.filter(Boolean))];
  const entries = await Promise.all(unique.map(async (eventId) => {
    try {
      const snapshot = await getDoc(doc(db, "events", eventId));
      return [eventId, snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null];
    } catch (error) {
      return [eventId, error?.code === "permission-denied" ? false : null];
    }
  }));
  return Object.fromEntries(entries);
};
