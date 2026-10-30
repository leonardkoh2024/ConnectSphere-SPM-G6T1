// I2 / SCRUM-148 — the coordinator's side of a change request: the requests on the
// events assigned to them, what each would touch, and the decision. Accepting applies
// the values through reviewApi.saveEventEdit, which commits them together with the
// request's own update; declining is a batch of its own. firestore.rules lets only the
// event's current coordinator decide, once, and only with a matching history row.

import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import {
  CHANGE_DECLINED, CHANGE_REQUEST_COLLECTION, CHANGE_REQUEST_EVENT_STATUSES, DECLINED, PENDING,
  changeDecisionMessage, currentChangeValues, declineReasonProblem, valuesWithChanges
} from "../../domain/changeRequests";
import { eventHistoryRecord, notificationRecord } from "../../domain/eventReviewRecords";
import { ordinaryEventValues } from "../../domain/ordinaryEventChanges";
import { significantEventValues } from "../../domain/significantEventChanges";
import { reviewApi } from "../events/reviewApi";

const asIso = (value) => value?.toDate?.().toISOString?.() || value || null;

const requireUser = () => {
  if (!auth.currentUser) throw new Error("Please sign in again.");
  return auth.currentUser;
};

// Pending first, then the decided ones, each newest first.
const pendingFirst = (a, b) => (Number(b.status === PENDING) - Number(a.status === PENDING))
  || String(b.created_at || "").localeCompare(String(a.created_at || ""));

// Requests are read per event the coordinator holds, so a request raised while the event
// had no coordinator is found as soon as it is assigned, and one on an event since
// reassigned is no longer theirs to see (K5).
export const loadAssignedChangeRequests = async (userId) => {
  const events = await getDocs(query(collection(db, "events"), where("coordinator_id", "==", userId)));
  const held = events.docs.filter((item) => CHANGE_REQUEST_EVENT_STATUSES.includes(item.data().status));
  const batches = await Promise.all(held.map((item) =>
    getDocs(query(collection(db, CHANGE_REQUEST_COLLECTION), where("event_id", "==", item.id)))));
  return batches
    .flatMap((snapshot) => snapshot.docs.map((item) => {
      const data = item.data();
      return { id: item.id, ...data, created_at: asIso(data.created_at), decided_at: asIso(data.decided_at) };
    }))
    .sort(pendingFirst);
};

// AC1 — the event as it stands now, its current values in the change form's shapes, and
// the arrangements it holds, read together so the screen shows one moment.
export const loadChangeReview = async (request) => {
  const [detail, impact] = await Promise.all([reviewApi.detail(request.event_id), reviewApi.arrangementImpact(request.event_id)]);
  const { event, organiser } = detail;
  return {
    event, organiser, impact,
    current: currentChangeValues({ event, requirement: event, facilities: event.facilities, accessibility: event.accessibility })
  };
};

// AC3 — the new values go in through the coordinator's edit, so the same checks, history rows
// and attendee notices apply, and the request is closed in the same commit. `review` is what
// the screen showed; if the arrangements moved meanwhile the save is refused and the screen reloads.
export const acceptChangeRequest = async ({ request, review, note = "" }) => {
  const { event, organiser, impact } = review;
  const base = { ...ordinaryEventValues(event, organiser), ...significantEventValues(event) };
  const values = valuesWithChanges(base, request.changes);
  const result = await reviewApi.saveEventEdit({
    eventId: event.id,
    before: event,
    values: { ...values, expected_attendance: Number(values.expected_attendance) },
    organiser,
    impact,
    acknowledged: true,
    changeRequest: { id: request.id, reason: note }
  });
  return result;
};

// AC2, AC4 — declined only with a reason; the request, a history row and the organiser's
// notice are written together.
export const declineChangeRequest = async ({ request, reason }) => {
  const user = requireUser();
  const problem = declineReasonProblem(reason);
  if (problem) throw new Error(problem);
  const why = reason.trim();
  const batch = writeBatch(db);
  const decidedAt = serverTimestamp();
  const historyRef = doc(collection(db, "event_history"));
  const noticeRef = doc(collection(db, "notifications"));
  batch.update(doc(db, CHANGE_REQUEST_COLLECTION, request.id), {
    status: DECLINED, decided_by: user.uid, decided_at: decidedAt, decision_reason: why, decision_history_id: historyRef.id
  });
  batch.set(historyRef, {
    ...eventHistoryRecord({
      historyId: historyRef.id, eventId: request.event_id, actorId: user.uid, actionType: CHANGE_DECLINED,
      fieldName: "change_request", description: why, createdAt: decidedAt
    }),
    change_request_id: request.id
  });
  batch.set(noticeRef, {
    ...notificationRecord({
      notificationId: noticeRef.id, userId: request.organiser_id, eventId: request.event_id, type: CHANGE_DECLINED,
      message: changeDecisionMessage({ eventName: request.event_name || request.reference_no, accepted: false, reason: why }), createdAt: decidedAt
    }),
    change_request_id: request.id
  });
  await batch.commit();
  return { ...request, status: DECLINED, decision_reason: why, decided_by: user.uid, decided_at: new Date().toISOString() };
};
