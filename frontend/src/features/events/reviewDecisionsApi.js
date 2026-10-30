// A coordinator's decisions on an event request, and the organiser's answer to a
// clarification. Each writes the event, its history and its notices together.

import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { EVENT_STATUS, canApproveEvent, canOpenReview, canRejectEvent, canRequestClarification, canRespondToClarification, canCancelEvent, cleanRequiredText } from "../../domain/eventReview";
import { clarificationRecord, clarificationResponseRecord, eventHistoryRecord, notificationRecord } from "../../domain/eventReviewRecords";
import { ROLES } from "../../domain/roles";
import { decisionReasonProblem, eventCancelledMessage, eventDecisionMessage } from "../../domain/notifications";
import { cancelSafetyReview, cancelUnassignedEvent } from "../../domain/safetyAndNotices";
import { requireUser } from "../../lib/apiSupport";

export const openReview = async (eventId) => {
  const user = requireUser();
  const eventRef = doc(db, "events", eventId);
  const historyRef = doc(collection(db, "event_history"));
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(eventRef);
    if (!snapshot.exists() || !canOpenReview(snapshot.data(), user.uid)) throw new Error("Only the assigned coordinator can open this submitted request.");
    const changedAt = serverTimestamp();
    tx.update(eventRef, { status: EVENT_STATUS.UNDER_REVIEW, updated_at: changedAt });
    tx.set(historyRef, eventHistoryRecord({ historyId: historyRef.id, eventId, actorId: user.uid, actionType: "REVIEW_STARTED", fieldName: "status", oldValue: EVENT_STATUS.SUBMITTED, newValue: EVENT_STATUS.UNDER_REVIEW, description: "Coordinator opened the request for review.", createdAt: changedAt }));
  });
  return { ok: true };
};

export const clarify = async (eventId, value) => {
  const user = requireUser();
  const message = cleanRequiredText(value);
  if (!message) throw new Error("Clarification message is required.");
  const eventRef = doc(db, "events", eventId);
  const clarificationRef = doc(collection(db, "clarification_requests"));
  const historyRef = doc(collection(db, "event_history"));
  const notificationRef = doc(collection(db, "notifications"));
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(eventRef);
    if (!snapshot.exists() || !canRequestClarification(snapshot.data(), user.uid)) throw new Error("A clarification cannot be requested for this event.");
    const event = snapshot.data();
    const changedAt = serverTimestamp();
    tx.set(clarificationRef, clarificationRecord({ clarificationId: clarificationRef.id, eventId, createdBy: user.uid, message, createdAt: changedAt }));
    tx.update(eventRef, { status: EVENT_STATUS.UNDER_REVIEW, open_clarification_id: clarificationRef.id, updated_at: changedAt });
    tx.set(historyRef, eventHistoryRecord({ historyId: historyRef.id, eventId, actorId: user.uid, actionType: "CLARIFICATION_REQUESTED", description: message, createdAt: changedAt }));
    tx.set(notificationRef, notificationRecord({ notificationId: notificationRef.id, userId: event.organiser_id, eventId, type: "CLARIFICATION_REQUESTED", message: `${event.name || event.reference_no}: clarification requested — ${message}`, createdAt: changedAt }));
  });
  return { ok: true, clarificationId: clarificationRef.id };
};

export const reject = async (eventId, value) => {
  const user = requireUser();
  const problem = decisionReasonProblem("reject", value);
  if (problem) throw new Error(problem);
  const reason = cleanRequiredText(value);
  const eventRef = doc(db, "events", eventId);
  const historyRef = doc(collection(db, "event_history"));
  const notificationRef = doc(collection(db, "notifications"));
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(eventRef);
    if (!snapshot.exists() || !canRejectEvent(snapshot.data(), user.uid)) throw new Error("This event cannot be rejected now.");
    const event = snapshot.data();
    const changedAt = serverTimestamp();
    tx.update(eventRef, { status: EVENT_STATUS.REJECTED, updated_at: changedAt });
    tx.set(historyRef, eventHistoryRecord({ historyId: historyRef.id, eventId, actorId: user.uid, actionType: "EVENT_REJECTED", fieldName: "status", oldValue: event.status, newValue: EVENT_STATUS.REJECTED, description: reason, createdAt: changedAt }));
    tx.set(notificationRef, notificationRecord({ notificationId: notificationRef.id, userId: event.organiser_id, eventId, type: "EVENT_REJECTED", message: eventDecisionMessage({ eventName: event.name || event.reference_no, approved: false, reason }), createdAt: changedAt }));
  });
  return { ok: true };
};

export const cancel = async (eventId, value) => {
  const user = requireUser();
  const reason = cleanRequiredText(value);
  if (!reason) throw new Error("Cancellation reason is required.");

  const eventRef = doc(db, "events", eventId);
  const currentEvent = await getDoc(eventRef);
  if (!currentEvent.exists() || !canCancelEvent(currentEvent.data(), user.uid)) {
    throw new Error("Only the current coordinator may cancel an active event.");
  }
  const registrationSnapshot = await getDocs(query(
    collection(db, "registrations"),
    where("event_id", "==", eventId)
  ));
  const officerSnapshot = currentEvent.data().status === EVENT_STATUS.SAFETY_REVIEW
    ? await getDocs(query(collection(db, "users"), where("role", "==", ROLES.SAFETY_OFFICER), where("is_active", "==", true)))
    : { docs: [] };
  const safetyOfficers = officerSnapshot.docs.map((item) => ({
    user_id: item.id, role: item.data().role, active: item.data().is_active !== false
  }));
  const attendees = registrationSnapshot.docs
    .filter((item) => String(item.data().status || "").toUpperCase() === "REGISTERED")
    .map((item) => ({
      registrationId: item.id,
      userId: item.data().user_id || item.data().attendee_id
    }))
    .filter((item) => item.userId);

  const historyRef = doc(collection(db, "event_history"));
  const notificationRef = doc(collection(db, "notifications"));
  let eventName = "Your event";
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(eventRef);
    if (!snapshot.exists() || !canCancelEvent(snapshot.data(), user.uid)) {
      throw new Error("Only the current coordinator may cancel an active event.");
    }
    const event = snapshot.data();
    eventName = event.name || event.reference_no || eventName;
    const cancelledAt = serverTimestamp();
    tx.update(eventRef, {
      status: EVENT_STATUS.CANCELLED,
      cancellation_reason: reason,
      cancelled_at: cancelledAt,
      last_cancellation_id: historyRef.id,
      updated_at: cancelledAt
    });
    tx.set(historyRef, eventHistoryRecord({
      historyId: historyRef.id,
      eventId,
      actorId: user.uid,
      actionType: "EVENT_CANCELLED",
      fieldName: "status",
      oldValue: event.status,
      newValue: EVENT_STATUS.CANCELLED,
      description: reason,
      createdAt: cancelledAt
    }));
    tx.set(notificationRef, notificationRecord({
      notificationId: notificationRef.id,
      userId: event.organiser_id,
      eventId,
      type: "EVENT_CANCELLED",
      message: eventCancelledMessage({ eventName, reason }),
      createdAt: cancelledAt
    }));
    const leftReview = cancelSafetyReview({ event: { event_id: eventId, ...event }, safetyOfficers });
    (leftReview.notifications || []).forEach((notice) => {
      const officerRef = doc(collection(db, "notifications"));
      tx.set(officerRef, notificationRecord({
        notificationId: officerRef.id, userId: notice.user_id, eventId, type: notice.type, message: notice.message, createdAt: cancelledAt
      }));
    });
  });
  return { eventId, eventName, reason, attendees };
};

export const cancelUnassigned = async (eventId, value) => {
  const user = requireUser();
  const reason = cleanRequiredText(value);
  if (!reason) throw new Error("Cancellation reason is required.");
  const eventRef = doc(db, "events", eventId);
  const leadSnapshot = await getDocs(query(
    collection(db, "users"),
    where("role", "==", ROLES.COORDINATOR_LEAD),
    where("is_active", "==", true)
  ));
  const leads = leadSnapshot.docs.map((item) => ({
    user_id: item.id, role: item.data().role, active: item.data().is_active !== false
  }));
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(eventRef);
    if (!snapshot.exists() || snapshot.data().organiser_id !== user.uid) throw new Error("Only the organiser can cancel this request.");
    const event = { event_id: eventId, ...snapshot.data() };
    const decision = cancelUnassignedEvent({ event, leads });
    if (!decision.ok) throw new Error("Only an unassigned submitted request can be cancelled this way.");
    const cancelledAt = serverTimestamp();
    tx.update(eventRef, {
      status: EVENT_STATUS.CANCELLED,
      cancellation_reason: reason,
      cancelled_at: cancelledAt,
      updated_at: cancelledAt
    });
    decision.notifications.forEach((notice) => {
      const notificationRef = doc(collection(db, "notifications"));
      tx.set(notificationRef, notificationRecord({
        notificationId: notificationRef.id, userId: notice.user_id, eventId, type: notice.type, message: notice.message, createdAt: cancelledAt
      }));
    });
  });
  return { ok: true };
};

export const complete = async (eventId) => {
  const user = requireUser();
  const token = await user.getIdToken();
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The event could not be marked completed.");
  return result;
};

export const notifyCancelledAttendees = async ({ eventId, eventName, reason, attendees = [] }) => {
  const uniqueAttendees = [...new Map(attendees.map((attendee) => [attendee.registrationId, attendee])).values()];
  const chunkSize = 400;
  for (let offset = 0; offset < uniqueAttendees.length; offset += chunkSize) {
    const batch = writeBatch(db);
    uniqueAttendees.slice(offset, offset + chunkSize).forEach(({ registrationId, userId }) => {
      const notificationId = `cancel-${eventId}-${registrationId}`;
      const notificationRef = doc(db, "notifications", notificationId);
      batch.set(notificationRef, notificationRecord({
        notificationId,
        userId,
        eventId,
        type: "EVENT_CANCELLED",
        message: eventCancelledMessage({ eventName, reason }),
        createdAt: serverTimestamp(),
        eventName,
        registrationId
      }));
    });
    await batch.commit();
  }
  return { notified: uniqueAttendees.length };
};

export const respond = async (eventId, clarificationId, value) => {
  const user = requireUser();
  const message = cleanRequiredText(value);
  if (!message) throw new Error("Response message is required.");
  const eventRef = doc(db, "events", eventId);
  const clarificationRef = doc(db, "clarification_requests", clarificationId);
  const responseRef = doc(collection(db, "clarification_responses"));
  const historyRef = doc(collection(db, "event_history"));
  const notificationRef = doc(collection(db, "notifications"));
  await runTransaction(db, async (tx) => {
    const [eventSnapshot, clarificationSnapshot] = await Promise.all([tx.get(eventRef), tx.get(clarificationRef)]);
    if (!eventSnapshot.exists() || !clarificationSnapshot.exists()) throw new Error("Clarification not found.");
    const event = eventSnapshot.data();
    const clarification = { clarification_id: clarificationId, ...clarificationSnapshot.data() };
    if (!canRespondToClarification(event, clarification, user.uid)) throw new Error("You cannot answer this clarification.");
    const changedAt = serverTimestamp();
    tx.set(responseRef, clarificationResponseRecord({ responseId: responseRef.id, clarificationId, responderId: user.uid, message, createdAt: changedAt }));
    tx.update(clarificationRef, { status: "ANSWERED", responded_at: changedAt });
    tx.update(eventRef, { open_clarification_id: null, updated_at: changedAt });
    tx.set(historyRef, eventHistoryRecord({ historyId: historyRef.id, eventId, actorId: user.uid, actionType: "CLARIFICATION_RESPONDED", description: message, createdAt: changedAt }));
    tx.set(notificationRef, notificationRecord({ notificationId: notificationRef.id, userId: event.coordinator_id, eventId, type: "CLARIFICATION_RESPONDED", message: `${event.name || event.reference_no}: the organiser answered your clarification.`, createdAt: changedAt }));
  });
  return { ok: true };
};

// C6 / SCRUM-107 — approve a submitted request. Same shape as reject: guard with
// canApproveEvent (AC1 under review, AC3 assigned coordinator, AC4 no open
// clarification), set the event Approved (AC2), and write an EVENT_APPROVED history
// entry (AC5) whose actor_id + created_at are the deciding coordinator + timestamp.
// J2 / SCRUM-151 — an approval now needs a reason (AC3), which is kept in the history
// entry and told to the organiser in the same transaction (AC1, AC2).
export const approve = async (eventId, value) => {
  const user = requireUser();
  const problem = decisionReasonProblem("approve", value);
  if (problem) throw new Error(problem);
  const reason = cleanRequiredText(value);
  const eventRef = doc(db, "events", eventId);
  const historyRef = doc(collection(db, "event_history"));
  const notificationRef = doc(collection(db, "notifications"));
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(eventRef);
    if (!snapshot.exists() || !canApproveEvent(snapshot.data(), user.uid)) throw new Error("This event cannot be approved now.");
    const event = snapshot.data();
    const changedAt = serverTimestamp();
    tx.update(eventRef, { status: EVENT_STATUS.APPROVED, updated_at: changedAt });
    tx.set(historyRef, eventHistoryRecord({ historyId: historyRef.id, eventId, actorId: user.uid, actionType: "EVENT_APPROVED", fieldName: "status", oldValue: event.status, newValue: EVENT_STATUS.APPROVED, description: reason, createdAt: changedAt }));
    tx.set(notificationRef, notificationRecord({ notificationId: notificationRef.id, userId: event.organiser_id, eventId, type: "EVENT_APPROVED", message: eventDecisionMessage({ eventName: event.name || event.reference_no, approved: true, reason }), createdAt: changedAt }));
  });
  return { ok: true };
};
