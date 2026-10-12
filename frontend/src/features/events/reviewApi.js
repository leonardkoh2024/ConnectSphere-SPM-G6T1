// C4/C7/C8/C9 use the browser Firebase SDK, like the rest of the frontend.
// Firebase attaches the signed-in user and firestore.rules is the permission
// boundary for every read and atomic workflow write.

import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { EVENT_STATUS, canApproveEvent, canOpenReview, canRejectEvent, canReassignEvent, canRequestClarification, canRespondToClarification, cleanRequiredText } from "../../domain/eventReview";
import { clarificationRecord, clarificationResponseRecord, coordinatorAssignmentRecord, eventHistoryRecord, notificationRecord } from "../../domain/eventReviewRecords";
import { ROLES } from "../../domain/roles";
import {
  editableEventStatuses,
  significantEventChanges,
  significantEventValues,
  validateSignificantEventValues
} from "../../domain/significantEventChanges";

const requireUser = () => {
  if (!auth.currentUser) throw new Error("Please sign in again.");
  return auth.currentUser;
};

const asIso = (value) => value?.toDate?.().toISOString?.() || value || null;
const record = (snapshot) => {
  const data = snapshot.data();
  return {
    id: snapshot.id, ...data,
    created_at: asIso(data.created_at), updated_at: asIso(data.updated_at),
    assigned_at: asIso(data.assigned_at), submitted_at: asIso(data.submitted_at),
    responded_at: asIso(data.responded_at), ended_at: asIso(data.ended_at), read_at: asIso(data.read_at)
  };
};

const profileFor = async (userId) => {
  const snapshot = await getDoc(doc(db, "users", userId));
  if (!snapshot.exists()) throw new Error("Your user profile could not be found.");
  return { id: snapshot.id, ...snapshot.data() };
};

const coordinatorFor = async (userId) => {
  if (!userId) return null;
  const snapshot = await getDoc(doc(db, "users", userId));
  if (!snapshot.exists()) return { id: userId, name: userId, active: false };
  const data = snapshot.data();
  return { id: snapshot.id, name: data.name || data.email || snapshot.id, active: data.is_active !== false };
};

const activeCoordinators = async () => {
  const snapshot = await getDocs(query(
    collection(db, "users"),
    where("role", "==", ROLES.COORDINATOR),
    where("is_active", "==", true)
  ));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.is_active !== false)
    .map((item) => ({ id: item.id, name: item.name || item.email || item.id, active: true }));
};

// C2 / SCRUM-103 — AC2 asks each row to show the organiser. The event stores an
// organiser_id, so resolve the unique ids to display names in one batch and
// attach organiser_name to each event. The screen falls back to the id, then
// "Unknown", so a missing profile never leaves the column blank.
const withOrganiserNames = async (events) => {
  const organiserIds = [...new Set(events.map((event) => event.organiser_id).filter(Boolean))];
  const snapshots = await Promise.all(organiserIds.map((id) => getDoc(doc(db, "users", id))));
  const nameById = new Map(snapshots.filter((snapshot) => snapshot.exists()).map((snapshot) => {
    const data = snapshot.data();
    return [snapshot.id, data.name || data.email || snapshot.id];
  }));
  return events.map((event) => ({
    ...event,
    organiser_name: event.organiser_name || nameById.get(event.organiser_id) || null
  }));
};

const list = async () => {
  const user = requireUser();
  const profile = await profileFor(user.uid);
  let snapshots;
  if (profile.role === ROLES.ORGANISER) {
    snapshots = (await getDocs(query(collection(db, "events"), where("organiser_id", "==", user.uid)))).docs;
  } else if (profile.role === ROLES.COORDINATOR) {
    const [current, assignments] = await Promise.all([
      getDocs(query(collection(db, "events"), where("coordinator_id", "==", user.uid))),
      getDocs(query(collection(db, "coordinator_assignments"), where("coordinator_id", "==", user.uid)))
    ]);
    const currentIds = new Set(current.docs.map((item) => item.id));
    const priorIds = [...new Set(assignments.docs.map((item) => item.data().event_id))]
      .filter((eventId) => eventId && !currentIds.has(eventId));
    const prior = await Promise.all(priorIds.map((eventId) => getDoc(doc(db, "events", eventId))));
    snapshots = [...current.docs, ...prior.filter((item) => item.exists())];
  } else throw new Error("This role cannot review event requests.");
  const unique = [...new Map(snapshots.map((item) => [item.id, item])).values()];
  const events = unique.map((item) => ({ ...record(item), editable: item.data().coordinator_id === user.uid }));
  return { events: await withOrganiserNames(events) };
};

const detail = async (eventId) => {
  const user = requireUser();
  const eventSnapshot = await getDoc(doc(db, "events", eventId));
  if (!eventSnapshot.exists()) throw new Error("Event not found.");
  const event = record(eventSnapshot);
  const [questions, assignments, history, coordinator, profile, requirement, facilities, accessibility, equipment, organiserSnapshot] = await Promise.all([
    getDocs(query(collection(db, "clarification_requests"), where("event_id", "==", eventId))),
    getDocs(query(collection(db, "coordinator_assignments"), where("event_id", "==", eventId))),
    getDocs(query(collection(db, "event_history"), where("event_id", "==", eventId))),
    coordinatorFor(event.coordinator_id), profileFor(user.uid),
    // B2/B3 — the venue requirements the coordinator matches a venue against.
    // Without these the suitability gate (E7/E8) only ever sees capacity.
    getDoc(doc(db, "event_venue_requirements", eventId)),
    getDocs(query(collection(db, "event_facilities"), where("event_id", "==", eventId))),
    getDocs(query(collection(db, "event_accessibility"), where("event_id", "==", eventId))),
    // C3 — equipment lines (AC1) and the organiser's profile for contact details (AC2).
    getDocs(query(collection(db, "event_equipment"), where("event_id", "==", eventId))),
    event.organiser_id ? getDoc(doc(db, "users", event.organiser_id)) : Promise.resolve(null)
  ]);
  const [coordinators, responseSnapshots] = await Promise.all([
    profile.role === ROLES.COORDINATOR ? activeCoordinators() : Promise.resolve([]),
    Promise.all(questions.docs.map((question) => getDocs(query(collection(db, "clarification_responses"), where("clarification_id", "==", question.id)))))
  ]);
  const byCreated = (a, b) => String(a.created_at || "").localeCompare(String(b.created_at || ""));
  const historyRecords = history.docs.map(record).sort(byCreated);
  const decisions = historyRecords.filter((item) => ["EVENT_APPROVED", "EVENT_REJECTED"].includes(item.action_type));
  const decision = decisions.length ? decisions[decisions.length - 1] : null;
  // C3 — the organiser's own contact details (AC2).
  const organiserData = organiserSnapshot && organiserSnapshot.exists?.() ? organiserSnapshot.data() : null;
  const organiser = organiserData
    ? { id: event.organiser_id, name: organiserData.name || null, email: organiserData.email || null, phone: organiserData.phone || organiserData.contact_number || null }
    : null;
  return {
    event: {
      ...event,
      preferred_location: requirement.data()?.preferred_location || null,
      required_layout: requirement.data()?.required_layout || null,
      facilities_required: requirement.data()?.facilities_required ?? null,
      accessibility_needed: requirement.data()?.accessibility_needed ?? null,
      accessibility_notes: requirement.data()?.accessibility_notes || "",
      facilities: facilities.docs.map((item) => item.data().facility_id).filter(Boolean),
      accessibility: accessibility.docs.map((item) => item.data().accessibility_id).filter(Boolean),
      // C3 — the equipment lines the organiser requested (AC1).
      equipment: equipment.docs.map((item) => ({
        equipment_type: item.data().equipment_type,
        quantity: item.data().quantity || 1,
        notes: item.data().technical_note || item.data().notes || null
      })),
      editable: event.coordinator_id === user.uid, decision: decision?.new_value || null, decision_reason: decision?.description || null, decided_by: decision?.actor_id || null, decided_at: decision?.created_at || null
    },
    coordinator, coordinators, organiser,
    clarifications: questions.docs.map(record).sort(byCreated),
    responses: responseSnapshots.flatMap((snapshot) => snapshot.docs.map(record)).sort(byCreated),
    assignments: assignments.docs.map(record).sort(byCreated)
  };
};

const significantChangeImpact = async (eventId) => {
  const user = requireUser();
  const [eventSnapshot, profile] = await Promise.all([
    getDoc(doc(db, "events", eventId)),
    profileFor(user.uid)
  ]);
  if (!eventSnapshot.exists()
    || profile.role !== ROLES.COORDINATOR
    || eventSnapshot.data().coordinator_id !== user.uid
    || !editableEventStatuses.includes(eventSnapshot.data().status)) {
    throw new Error("Only the current coordinator may review the impact of a significant change to this event.");
  }
  const [bookings, reservations, registrations] = await Promise.all([
    getDocs(query(collection(db, "venue_bookings"), where("event_id", "==", eventId))),
    getDocs(query(collection(db, "equipment_reservations"), where("event_id", "==", eventId))),
    getDocs(query(collection(db, "registrations"), where("event_id", "==", eventId)))
  ]);
  const venueIds = [...new Set(bookings.docs.map((item) => item.data().venue_id).filter(Boolean))];
  const venues = await Promise.all(venueIds.map((venueId) => getDoc(doc(db, "venues", venueId))));
  const venueNames = new Map(venues.filter((item) => item.exists()).map((item) => [item.id, item.data().name]));
  return {
    venueBookings: bookings.docs.map((item) => {
      const booking = item.data();
      return {
        id: item.id,
        label: booking.booking_label || booking.venue_name || venueNames.get(booking.venue_id)
          || `Venue booking ${booking.booking_id || item.id}`,
        status: booking.status || "Status not recorded"
      };
    }),
    equipmentReservations: reservations.docs.map((item) => {
      const reservation = item.data();
      return {
        id: item.id,
        label: reservation.equipment_name || reservation.equipment_type || reservation.item_name
          || `Equipment reservation ${reservation.reservation_id || item.id}`,
        status: reservation.status || "Status not recorded"
      };
    }),
    registrationsCount: registrations.size
  };
};

const saveSignificantChange = async ({ eventId, before, values, impact, acknowledged }) => {
  const user = requireUser();
  if (acknowledged !== true) throw new Error("Acknowledge the impact warning before saving.");
  const currentImpact = await significantChangeImpact(eventId);
  if (JSON.stringify(currentImpact) !== JSON.stringify(impact)) {
    throw new Error("The existing arrangements changed while you were editing. Reopen the editor and review the updated warning before saving.");
  }
  const cleaned = {
    ...values,
    expected_attendance: Number(values.expected_attendance),
    preferred_location: String(values.preferred_location || ""),
    required_layout: String(values.required_layout || ""),
    facilities: [...new Set(values.facilities || [])].sort(),
    accessibility: [...new Set(values.accessibility || [])].sort(),
    facilities_required: Boolean(values.facilities_required),
    accessibility_needed: Boolean(values.accessibility_needed),
    accessibility_notes: String(values.accessibility_notes || "").trim()
  };
  const validationError = validateSignificantEventValues(cleaned);
  if (validationError) throw new Error(validationError);

  const eventRef = doc(db, "events", eventId);
  const requirementRef = doc(db, "event_venue_requirements", eventId);
  const [existingFacilities, existingAccessibility] = await Promise.all([
    getDocs(query(collection(db, "event_facilities"), where("event_id", "==", eventId))),
    getDocs(query(collection(db, "event_accessibility"), where("event_id", "==", eventId)))
  ]);
  const historyRef = doc(collection(db, "event_history"));
  await runTransaction(db, async (tx) => {
    const snapshots = await Promise.all([
      tx.get(eventRef),
      tx.get(requirementRef),
      ...existingFacilities.docs.map((item) => tx.get(item.ref)),
      ...existingAccessibility.docs.map((item) => tx.get(item.ref))
    ]);
    const [eventSnapshot, requirementSnapshot] = snapshots;
    const facilitiesSnapshot = snapshots.slice(2, 2 + existingFacilities.docs.length);
    const accessibilitySnapshot = snapshots.slice(2 + existingFacilities.docs.length);
    const facilityRows = facilitiesSnapshot.filter((item) => item.exists());
    const accessibilityRows = accessibilitySnapshot.filter((item) => item.exists());
    if (!eventSnapshot.exists()) throw new Error("Event not found.");
    const event = eventSnapshot.data();
    if (event.coordinator_id !== user.uid || !editableEventStatuses.includes(event.status)) {
      throw new Error("Only the current coordinator may edit significant event details in this status.");
    }
    if (event.open_clarification_id) throw new Error("Significant event details cannot be edited while a clarification is open.");

    const current = significantEventValues({
      ...event,
      ...requirementSnapshot.data(),
      facilities: facilityRows.map((item) => item.data().facility_id).filter(Boolean),
      accessibility: accessibilityRows.map((item) => item.data().accessibility_id).filter(Boolean)
    });
    if (JSON.stringify(current) !== JSON.stringify(significantEventValues(before))) {
      throw new Error("The event changed while you were editing it. Reload the event and review the warning again.");
    }
    const changes = significantEventChanges(current, cleaned);
    if (!Object.keys(changes).length) throw new Error("There are no significant changes to save.");

    const changedAt = serverTimestamp();
    tx.update(eventRef, {
      expected_attendance: cleaned.expected_attendance,
      event_date: cleaned.event_date,
      start_time: cleaned.start_time,
      end_time: cleaned.end_time,
      last_significant_change_id: historyRef.id,
      updated_at: changedAt
    });
    tx.set(requirementRef, {
      ...(requirementSnapshot.exists() ? requirementSnapshot.data() : {}),
      event_id: eventId,
      preferred_location: cleaned.preferred_location || null,
      required_layout: cleaned.required_layout || null,
      facilities_required: cleaned.facilities_required,
      accessibility_needed: cleaned.accessibility_needed,
      accessibility_notes: cleaned.accessibility_needed ? cleaned.accessibility_notes : ""
    });

    const facilityIds = new Set(cleaned.facilities_required ? cleaned.facilities : []);
    facilityRows.forEach((item) => {
      if (!facilityIds.has(item.data().facility_id)) tx.delete(item.ref);
      else facilityIds.delete(item.data().facility_id);
    });
    facilityIds.forEach((facilityId) => {
      const facilityRef = doc(db, "event_facilities", `${eventId}_${facilityId}`);
      tx.set(facilityRef, { event_id: eventId, facility_id: facilityId });
    });

    const accessibilityIds = new Set(cleaned.accessibility_needed ? cleaned.accessibility : []);
    accessibilityRows.forEach((item) => {
      if (!accessibilityIds.has(item.data().accessibility_id)) tx.delete(item.ref);
      else accessibilityIds.delete(item.data().accessibility_id);
    });
    accessibilityIds.forEach((accessibilityId) => {
      const accessibilityRef = doc(db, "event_accessibility", `${eventId}_${accessibilityId}`);
      tx.set(accessibilityRef, { event_id: eventId, accessibility_id: accessibilityId });
    });

    tx.set(historyRef, {
      ...eventHistoryRecord({
        historyId: historyRef.id,
        eventId,
        actorId: user.uid,
        actionType: "SIGNIFICANT_EVENT_DETAILS_CHANGED",
        fieldName: "significant_event_details",
        oldValue: Object.fromEntries(Object.entries(changes).map(([field, valuesForField]) => [field, valuesForField.old_value])),
        newValue: Object.fromEntries(Object.entries(changes).map(([field, valuesForField]) => [field, valuesForField.new_value])),
        description: "Coordinator acknowledged the impact warning before changing significant event details.",
        createdAt: changedAt
      }),
      warning_acknowledged: true,
      affected_arrangements: currentImpact
    });
  });
  return { ok: true };
};

const openReview = async (eventId) => {
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

const clarify = async (eventId, value) => {
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

const reject = async (eventId, value) => {
  const user = requireUser();
  const reason = cleanRequiredText(value);
  if (!reason) throw new Error("Rejection reason is required.");
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
    tx.set(notificationRef, notificationRecord({ notificationId: notificationRef.id, userId: event.organiser_id, eventId, type: "EVENT_REJECTED", message: `${event.name || event.reference_no} was rejected — ${reason}`, createdAt: changedAt }));
  });
  return { ok: true };
};

const reassign = async (eventId, coordinatorId) => {
  const user = requireUser();
  const eventRef = doc(db, "events", eventId);
  const targetRef = doc(db, "users", coordinatorId);
  const previousRef = doc(db, "coordinator_assignments", `${eventId}_${user.uid}`);
  const nextRef = doc(db, "coordinator_assignments", `${eventId}_${coordinatorId}`);
  const historyRef = doc(collection(db, "event_history"));
  const notificationRefs = [doc(collection(db, "notifications")), doc(collection(db, "notifications")), doc(collection(db, "notifications"))];
  await runTransaction(db, async (tx) => {
    const [eventSnapshot, targetSnapshot, previousSnapshot] = await Promise.all([tx.get(eventRef), tx.get(targetRef), tx.get(previousRef)]);
    if (!eventSnapshot.exists() || !targetSnapshot.exists()) throw new Error("Event or coordinator not found.");
    const event = eventSnapshot.data();
    const targetData = targetSnapshot.data();
    const target = targetData.role === ROLES.COORDINATOR ? { id: targetSnapshot.id, ...targetData, active: targetData.is_active !== false } : null;
    if (!canReassignEvent(event, user.uid, target)) throw new Error("Only the current coordinator can reassign this event to another active coordinator.");
    const changedAt = serverTimestamp();
    tx.update(eventRef, { coordinator_id: coordinatorId, assigned_at: changedAt, updated_at: changedAt });
    tx.set(previousRef, coordinatorAssignmentRecord({ assignmentId: previousRef.id, eventId, coordinatorId: user.uid, assignedAt: previousSnapshot.exists() ? previousSnapshot.data().assigned_at : event.assigned_at || null, endedAt: changedAt }));
    tx.set(nextRef, coordinatorAssignmentRecord({ assignmentId: nextRef.id, eventId, coordinatorId, assignedAt: changedAt }));
    tx.set(historyRef, eventHistoryRecord({ historyId: historyRef.id, eventId, actorId: user.uid, actionType: "COORDINATOR_REASSIGNED", fieldName: "coordinator_id", oldValue: user.uid, newValue: coordinatorId, description: `Event reassigned to ${target.name || targetData.email || coordinatorId}.`, createdAt: changedAt }));
    const note = `${event.name || event.reference_no} was reassigned to ${target.name || targetData.email || coordinatorId}.`;
    [user.uid, coordinatorId, event.organiser_id].forEach((recipient, index) => tx.set(notificationRefs[index], notificationRecord({ notificationId: notificationRefs[index].id, userId: recipient, eventId, type: "COORDINATOR_REASSIGNED", message: note, createdAt: changedAt })));
  });
  return { ok: true };
};

const respond = async (eventId, clarificationId, value) => {
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
const approve = async (eventId) => {
  const user = requireUser();
  const eventRef = doc(db, "events", eventId);
  const historyRef = doc(collection(db, "event_history"));
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(eventRef);
    if (!snapshot.exists() || !canApproveEvent(snapshot.data(), user.uid)) throw new Error("This event cannot be approved now.");
    const event = snapshot.data();
    const changedAt = serverTimestamp();
    tx.update(eventRef, { status: EVENT_STATUS.APPROVED, updated_at: changedAt });
    tx.set(historyRef, eventHistoryRecord({ historyId: historyRef.id, eventId, actorId: user.uid, actionType: "EVENT_APPROVED", fieldName: "status", oldValue: event.status, newValue: EVENT_STATUS.APPROVED, description: "Coordinator approved the request.", createdAt: changedAt }));
  });
  return { ok: true };
};

export const reviewApi = {
  list, detail, openReview, clarify, reject, reassign, respond, approve,
  significantChangeImpact, saveSignificantChange
};
