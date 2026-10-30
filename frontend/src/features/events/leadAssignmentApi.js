// The Event Coordinator Lead assigns each submitted event to one coordinator (K2)
// and is the one who reassigns it (K3).

import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { assignEvent, reassignEvent } from "../../domain/eventReview";
import { coordinatorAssignmentRecord, eventHistoryRecord, notificationRecord } from "../../domain/eventReviewRecords";
import { ROLES } from "../../domain/roles";
import { requireUser } from "../../lib/apiSupport";

// The Lead gives a brand-new (unassigned) event to an active coordinator.
// canAssignCoordinator refuses an already-assigned or terminal event and an
// inactive target; the acting user's role is read from their profile so only a
// Lead passes the guard.
// A change request records the event's coordinator when it is raised, which is null while
// the event waits for the Lead. The web SDK cannot query inside a transaction, so the
// Pending requests are found first and updated inside it with the event.
const pendingChangeRequestRefs = async (eventId) => {
  const snapshot = await getDocs(query(collection(db, "change_requests"), where("event_id", "==", eventId), where("status", "==", "PENDING")));
  return snapshot.docs.map((item) => item.ref);
};

export const assign = async (eventId, coordinatorId) => {
  const user = requireUser();
  const requestRefs = await pendingChangeRequestRefs(eventId);
  const eventRef = doc(db, "events", eventId);
  const targetRef = doc(db, "users", coordinatorId);
  const actorRef = doc(db, "users", user.uid);
  const nextRef = doc(db, "coordinator_assignments", `${eventId}_${coordinatorId}`);
  const historyRef = doc(collection(db, "event_history"));
  // K2 AC4 — the new coordinator and the organiser are both notified, so two refs.
  const notificationRefs = [doc(collection(db, "notifications")), doc(collection(db, "notifications"))];
  await runTransaction(db, async (tx) => {
    const [eventSnapshot, targetSnapshot, actorSnapshot] = await Promise.all([tx.get(eventRef), tx.get(targetRef), tx.get(actorRef)]);
    if (!eventSnapshot.exists() || !targetSnapshot.exists()) throw new Error("Event or coordinator not found.");
    const event = eventSnapshot.data();
    const actorRole = actorSnapshot.exists() ? actorSnapshot.data().role : null;
    const targetData = targetSnapshot.data();
    const target = targetData.role === ROLES.COORDINATOR ? { id: targetSnapshot.id, ...targetData, active: targetData.is_active !== false } : null;
    const changedAt = serverTimestamp();
    // K2 — one pure decision (AC5 guard, AC3 record, AC4 recipients) so the rule
    // for who may assign and who is notified lives in exactly one place.
    const outcome = assignEvent({ event, role: actorRole, leadId: user.uid, target, now: changedAt });
    if (!outcome.ok) throw new Error("This event cannot be assigned to that coordinator.");
    const describedTo = target.name || targetData.email || coordinatorId;
    tx.update(eventRef, { coordinator_id: coordinatorId, assigned_at: changedAt, updated_at: changedAt });
    requestRefs.forEach((ref) => tx.update(ref, { coordinator_id: coordinatorId }));
    tx.set(nextRef, coordinatorAssignmentRecord({ assignmentId: nextRef.id, eventId, coordinatorId, assignedAt: changedAt }));
    tx.set(historyRef, eventHistoryRecord({ historyId: historyRef.id, eventId, actorId: outcome.history.actorId, actionType: outcome.history.actionType, fieldName: outcome.history.fieldName, oldValue: outcome.history.oldValue, newValue: outcome.history.newValue, description: `Event assigned to ${describedTo}.`, createdAt: changedAt }));
    outcome.notifications.forEach((recipient, index) => tx.set(notificationRefs[index], notificationRecord({
      notificationId: notificationRefs[index].id,
      userId: recipient.userId,
      eventId,
      type: "COORDINATOR_ASSIGNED",
      message: recipient.userId === coordinatorId
        ? `${event.name || event.reference_no} was assigned to you.`
        : `${event.name || event.reference_no} was assigned to ${describedTo}.`,
      createdAt: changedAt
    })));
  });
  return { ok: true };
};

// The Lead moves an already-assigned event to a different active coordinator
// (K3 / SCRUM-184). reassignEvent is the one pure decision (AC1/AC2 guard, AC3 record,
// AC5 recipients), as assignEvent is for K2; this only turns it into one atomic
// transaction. The outgoing coordinator is the event's current one, and all three
// parties — outgoing coordinator, incoming coordinator and organiser — are told.
export const leadReassign = async (eventId, coordinatorId) => {
  const user = requireUser();
  const requestRefs = await pendingChangeRequestRefs(eventId);
  const eventRef = doc(db, "events", eventId);
  const targetRef = doc(db, "users", coordinatorId);
  const actorRef = doc(db, "users", user.uid);
  const nextRef = doc(db, "coordinator_assignments", `${eventId}_${coordinatorId}`);
  const historyRef = doc(collection(db, "event_history"));
  const notificationRefs = [doc(collection(db, "notifications")), doc(collection(db, "notifications")), doc(collection(db, "notifications"))];
  await runTransaction(db, async (tx) => {
    const [eventSnapshot, targetSnapshot, actorSnapshot] = await Promise.all([tx.get(eventRef), tx.get(targetRef), tx.get(actorRef)]);
    if (!eventSnapshot.exists() || !targetSnapshot.exists()) throw new Error("Event or coordinator not found.");
    const event = eventSnapshot.data();
    const actorRole = actorSnapshot.exists() ? actorSnapshot.data().role : null;
    const targetData = targetSnapshot.data();
    const target = targetData.role === ROLES.COORDINATOR ? { id: targetSnapshot.id, ...targetData, active: targetData.is_active !== false } : null;
    // The outgoing coordinator's original assignment time is the event's own assigned_at.
    // The coordinator_assignments record is deliberately NOT read: firestore.rules lets only
    // an event's owner or current coordinator read it, never the Lead, so a read here
    // would be refused with "Missing or insufficient permissions". Writing it is allowed.
    const previousRef = event.coordinator_id ? doc(db, "coordinator_assignments", `${eventId}_${event.coordinator_id}`) : null;
    const originalAssignedAt = event.assigned_at ?? null;
    const changedAt = serverTimestamp();
    const outcome = reassignEvent({ event: { ...event, assigned_at: originalAssignedAt }, role: actorRole, leadId: user.uid, target, now: changedAt });
    if (!outcome.ok) throw new Error("This event cannot be reassigned to that coordinator.");
    const describedTo = target.name || targetData.email || coordinatorId;
    const label = event.name || event.reference_no;
    const previous = outcome.previousAssignment;
    tx.update(eventRef, { coordinator_id: outcome.event.coordinator_id, assigned_at: changedAt, updated_at: changedAt });
    requestRefs.forEach((ref) => tx.update(ref, { coordinator_id: outcome.event.coordinator_id }));
    tx.set(previousRef, coordinatorAssignmentRecord({ assignmentId: previousRef.id, eventId, coordinatorId: previous.coordinatorId, assignedAt: previous.assignedAt, endedAt: previous.endedAt, reassignedBy: previous.reassignedBy }));
    tx.set(nextRef, coordinatorAssignmentRecord({ assignmentId: nextRef.id, eventId, coordinatorId, assignedAt: changedAt }));
    tx.set(historyRef, eventHistoryRecord({ historyId: historyRef.id, eventId, actorId: outcome.history.actorId, actionType: outcome.history.actionType, fieldName: outcome.history.fieldName, oldValue: outcome.history.oldValue, newValue: outcome.history.newValue, description: `Event reassigned to ${describedTo}.`, previousAssignedAt: outcome.history.previousAssignedAt, createdAt: changedAt }));
    const wording = {
      outgoing: `${label} was reassigned to ${describedTo}. You are no longer its coordinator.`,
      incoming: `${label} was reassigned to you.`,
      organiser: `${label} was reassigned to ${describedTo}.`
    };
    outcome.notifications.forEach((recipient, index) => tx.set(notificationRefs[index], notificationRecord({
      notificationId: notificationRefs[index].id,
      userId: recipient.userId,
      eventId,
      type: recipient.type,
      message: wording[recipient.audience],
      createdAt: changedAt
    })));
  });
  return { ok: true };
};
