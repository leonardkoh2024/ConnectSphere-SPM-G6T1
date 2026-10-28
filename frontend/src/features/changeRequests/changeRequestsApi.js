// I1 / SCRUM-147 — the organiser's reads and the one write a change request makes.
// Like the event request form this is the browser Firebase SDK; firestore.rules lets
// an organiser create a Pending request only on their own event while it is between
// Submitted and Confirmed, and read only their own requests.

import { collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  CHANGE_REQUEST_COLLECTION, CHANGE_REQUESTED, CHANGE_REQUEST_EVENT_STATUSES, PENDING,
  changeRequestedMessage, currentChangeValues, proposedChanges
} from "../../domain/changeRequests";
import { notificationRecord } from "../../domain/eventReviewRecords";

const asIso = (value) => value?.toDate?.().toISOString?.() || value || null;

const byNewest = (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""));

// AC1 — the organiser's events a change may be requested on, soonest first.
export const loadChangeableEvents = async (userId) => {
  const snapshot = await getDocs(query(collection(db, "events"), where("organiser_id", "==", userId)));
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((event) => CHANGE_REQUEST_EVENT_STATUSES.includes(event.status))
    .sort((a, b) => String(a.event_date || "").localeCompare(String(b.event_date || "")));
};

// The event's current values, read from every record its request spans.
export const loadCurrentValues = async (event) => {
  const [requirement, facilities, accessibility] = await Promise.all([
    getDoc(doc(db, "event_venue_requirements", event.id)),
    getDocs(query(collection(db, "event_facilities"), where("event_id", "==", event.id))),
    getDocs(query(collection(db, "event_accessibility"), where("event_id", "==", event.id)))
  ]);
  return currentChangeValues({
    event,
    requirement: requirement.exists() ? requirement.data() : {},
    facilities: facilities.docs.map((item) => item.data().facility_id),
    accessibility: accessibility.docs.map((item) => item.data().accessibility_id)
  });
};

// AC3 — every request the organiser has raised, newest first; there is no limit.
export const loadMyChangeRequests = async (userId) => {
  const snapshot = await getDocs(query(collection(db, CHANGE_REQUEST_COLLECTION), where("organiser_id", "==", userId)));
  return snapshot.docs
    .map((item) => {
      const data = item.data();
      return { id: item.id, ...data, created_at: asIso(data.created_at), decided_at: asIso(data.decided_at) };
    })
    .sort(byNewest);
};

// AC2, AC4 — the request is written Pending, with a history row on the event and, when
// the event has a coordinator, a notice to them, all in one commit so none can exist
// without the others. With no coordinator yet nobody is told; the coordinator finds the
// request when the event is assigned (an open question for Session 3).
export const submitChangeRequest = async ({ userId, event, current, proposed, fields, reason }) => {
  const batch = writeBatch(db);
  const requestRef = doc(collection(db, CHANGE_REQUEST_COLLECTION));
  const changes = proposedChanges(current, proposed, fields);
  const coordinatorId = event.coordinator_id || null;
  const record = {
    change_request_id: requestRef.id,
    event_id: event.id,
    event_name: event.name || "",
    reference_no: event.reference_no || "",
    organiser_id: userId,
    coordinator_id: coordinatorId,
    event_status: event.status,
    changes,
    reason: reason.trim(),
    status: PENDING,
    created_at: serverTimestamp()
  };
  batch.set(requestRef, record);
  batch.set(doc(collection(db, "event_history")), {
    event_id: event.id,
    actor_id: userId,
    action_type: CHANGE_REQUESTED,
    change_request_id: requestRef.id,
    description: `Organiser requested a change: ${Object.keys(changes).join(", ")}.`,
    created_at: serverTimestamp()
  });
  if (coordinatorId) {
    const noticeRef = doc(collection(db, "notifications"));
    batch.set(noticeRef, {
      ...notificationRecord({
        notificationId: noticeRef.id, userId: coordinatorId, eventId: event.id, type: CHANGE_REQUESTED,
        message: changeRequestedMessage({ eventName: event.name || event.reference_no, fields: Object.keys(changes) }),
        createdAt: serverTimestamp()
      }),
      change_request_id: requestRef.id
    });
  }
  await batch.commit();
  return { id: requestRef.id, ...record, created_at: new Date().toISOString(), notified: Boolean(coordinatorId) };
};
