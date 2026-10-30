// Editing an event after submission: ordinary and significant changes, the
// registration capacity check, and re-requesting the arrangements a change affects.

import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { eventHistoryRecord, notificationRecord } from "../../domain/eventReviewRecords";
import { significantEventChanges, significantEventValues, validateSignificantEventValues } from "../../domain/significantEventChanges";
import { ORDINARY_CHANGE_ACTION, canEditOrdinaryDetails, cleanOrdinaryValues, ordinaryEventChanges, ordinaryEventValues, validateOrdinaryEventValues } from "../../domain/ordinaryEventChanges";
import { ACCEPTED, CHANGE_ACCEPTED, CHANGE_REQUEST_COLLECTION, PENDING, changeDecisionMessage } from "../../domain/changeRequests";
import { capacityReductionNeedsAcknowledgement } from "../../domain/registrationWindow";
import { attendeeChangeNotices } from "../../domain/safetyAndNotices";
import { significantChangeImpact } from "./reviewQueriesApi";
import { NOT_AUTHORISED } from "./reviewApiSupport";
import { requireUser } from "../../lib/apiSupport";

const cleanSignificantValues = (values) => ({
  expected_attendance: Number(values.expected_attendance),
  event_date: String(values.event_date || ""),
  start_time: String(values.start_time || ""),
  end_time: String(values.end_time || ""),
  preferred_location: String(values.preferred_location || ""),
  required_layout: String(values.required_layout || ""),
  facilities: [...new Set(values.facilities || [])].sort(),
  accessibility: [...new Set(values.accessibility || [])].sort(),
  facilities_required: Boolean(values.facilities_required),
  accessibility_needed: Boolean(values.accessibility_needed),
  accessibility_notes: String(values.accessibility_notes || "").trim()
});

// I3 / SCRUM-149 — the browser may not write venue bookings, equipment reservations or the
// Venue Staff and Technical Support notices, so after a significant change is saved it asks
// the arrangements service (Admin SDK) to re-request them. A lower registration capacity is
// also saved through the service, which counts who is registered. Both need the signed-in
// coordinator's token; the service checks they coordinate this event.
const ARRANGEMENTS_UNREACHABLE = "The arrangements service could not be reached.";

const callArrangementsService = async (user, eventId, action, body, fallbackError) => {
  const token = await user.getIdToken();
  let response;
  let result;
  try {
    response = await fetch(`/api/events/${encodeURIComponent(eventId)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    result = await response.json();
  } catch (_error) {
    throw new Error(ARRANGEMENTS_UNREACHABLE);
  }
  if (!response.ok) throw new Error(result?.error || fallbackError);
  return result;
};

const REREQUEST_FAILED = "The arrangements could not be marked for re-request.";

// Never throws: the change is already saved, so a failure is reported back for a Retry.
const requestRerequest = async (user, eventId, changeId) => {
  try {
    await callArrangementsService(user, eventId, "rerequest-arrangements", { source: "EVENT_EDIT", change_id: changeId }, REREQUEST_FAILED);
    return { sent: true, changeId };
  } catch (error) {
    console.error("The arrangements could not be marked for re-request.", error);
    return { sent: false, changeId, error: error.message || REREQUEST_FAILED };
  }
};

export const retryRerequest = async ({ eventId, changeId }) => {
  const user = requireUser();
  await callArrangementsService(user, eventId, "rerequest-arrangements", { source: "EVENT_EDIT", change_id: changeId }, REREQUEST_FAILED);
  return { sent: true, changeId };
};

const newCapacityOf = (values, before) => {
  const raw = values?.registration_capacity;
  if (raw === undefined || raw === null || raw === "") return null;
  const capacity = Number(raw);
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Registration capacity must be a whole number greater than zero.");
  return capacity === Number(before?.registration_capacity) ? null : capacity;
};

// I3 AC4, D1 and D2 — every refusal that needs no transaction, made before anything
// is written. Returns the current impact of a significant change, for its history row.
const checkEditBeforeSaving = async ({
  eventId, before, values, significant, hasOrdinary, hasSignificant,
  capacity, registered, capacityAcknowledged, acknowledged, impact
}) => {
  // I3 AC4 — a capacity below the people already registered is refused before anything is written.
  if (capacity !== null && capacityReductionNeedsAcknowledgement({
    oldCapacity: before?.registration_capacity, newCapacity: capacity, registeredCount: registered
  }) && capacityAcknowledged !== true) {
    throw new Error(`The new capacity of ${capacity} is below the ${registered} ${registered === 1 ? "person" : "people"} already registered. Acknowledge this to apply it; nobody will be unregistered.`);
  }

  if (hasOrdinary) {
    const ordinaryError = validateOrdinaryEventValues(values);
    if (ordinaryError) throw new Error(ordinaryError);
  }
  if (!hasSignificant) return null;
  const significantError = validateSignificantEventValues(significant);
  if (significantError) throw new Error(significantError);
  if (acknowledged !== true) throw new Error("Acknowledge the impact warning before saving.");
  const currentImpact = await significantChangeImpact(eventId);
  if (JSON.stringify(currentImpact) !== JSON.stringify(impact)) {
    throw new Error("The existing arrangements changed while you were editing. Review the updated warning before saving.");
  }
  return currentImpact;
};

// The significant changes registered attendees are told about: date, time and venue.
const attendeeChangesOf = (planned, significant) => {
  const changes = [];
  if (planned.event_date) changes.push({ kind: "DATE", detail: significant.event_date });
  if (planned.start_time || planned.end_time) {
    changes.push({ kind: "TIME", detail: `${significant.start_time}–${significant.end_time}` });
  }
  if (planned.preferred_location) changes.push({ kind: "VENUE", detail: significant.preferred_location });
  return changes;
};

const registeredAttendeesOf = async (eventId) => (await getDocs(query(
  collection(db, "registrations"),
  where("event_id", "==", eventId),
  where("status", "==", "REGISTERED")
))).docs.map((item) => ({
  user_id: item.data().attendee_id || item.data().user_id,
  status: "REGISTERED",
  registration_id: item.id
}));

// The significant values as stored now: the event, its venue requirement, and its
// facility and accessibility rows.
const storedSignificantValues = (event, requirementSnapshot, facilityRows, accessibilityRows) => significantEventValues({
  ...event,
  ...requirementSnapshot.data(),
  facilities: facilityRows.map((item) => item.data().facility_id).filter(Boolean),
  accessibility: accessibilityRows.map((item) => item.data().accessibility_id).filter(Boolean)
});

// I2 AC3 — an accepted change request is closed in this same commit as the values it
// applies, so the event can never change without the request recording it, or the reverse.
const readPendingChangeRequest = async (tx, changeRequest, eventId) => {
  if (!changeRequest) return { requestRef: null, requestSnapshot: null };
  const requestRef = doc(db, CHANGE_REQUEST_COLLECTION, changeRequest.id);
  const requestSnapshot = await tx.get(requestRef);
  if (!requestSnapshot.exists()
    || requestSnapshot.data().status !== PENDING
    || requestSnapshot.data().event_id !== eventId) {
    throw new Error("This change request has already been decided.");
  }
  return { requestRef, requestSnapshot };
};

// D1 AC2 — one event_history row per changed ordinary field, with old and new value.
const writeOrdinaryHistory = (tx, { refs, changes, eventId, userId, changedAt }) => {
  changes.forEach((change, index) => {
    tx.set(refs[index], eventHistoryRecord({
      historyId: refs[index].id,
      eventId,
      actorId: userId,
      actionType: ORDINARY_CHANGE_ACTION,
      fieldName: change.field,
      oldValue: change.old_value,
      newValue: change.new_value,
      description: "Coordinator updated ordinary event details.",
      createdAt: changedAt
    }));
  });
};

// Makes the event's rows in collectionName exactly the wanted ids: rows no longer
// wanted are deleted, and missing ones are added.
const syncLinkedRows = (tx, { rows, wanted, field, collectionName, eventId }) => {
  const missing = new Set(wanted);
  rows.forEach((item) => {
    if (!missing.has(item.data()[field])) tx.delete(item.ref);
    else missing.delete(item.data()[field]);
  });
  missing.forEach((id) => {
    tx.set(doc(db, collectionName, `${eventId}_${id}`), { event_id: eventId, [field]: id });
  });
};

// D2 — the venue requirement, facility and accessibility rows, and one acknowledged
// SIGNIFICANT_EVENT_DETAILS_CHANGED history row listing the arrangements affected.
const writeSignificantChange = (tx, {
  historyRef, requirementRef, requirementSnapshot, significant, changes,
  facilityRows, accessibilityRows, currentImpact, eventId, userId, changedAt
}) => {
  tx.set(requirementRef, {
    ...(requirementSnapshot.exists() ? requirementSnapshot.data() : {}),
    event_id: eventId,
    preferred_location: significant.preferred_location || null,
    required_layout: significant.required_layout || null,
    facilities_required: significant.facilities_required,
    accessibility_needed: significant.accessibility_needed,
    accessibility_notes: significant.accessibility_needed ? significant.accessibility_notes : ""
  });

  syncLinkedRows(tx, {
    rows: facilityRows, wanted: significant.facilities_required ? significant.facilities : [],
    field: "facility_id", collectionName: "event_facilities", eventId
  });
  syncLinkedRows(tx, {
    rows: accessibilityRows, wanted: significant.accessibility_needed ? significant.accessibility : [],
    field: "accessibility_id", collectionName: "event_accessibility", eventId
  });

  tx.set(historyRef, {
    ...eventHistoryRecord({
      historyId: historyRef.id,
      eventId,
      actorId: userId,
      actionType: "SIGNIFICANT_EVENT_DETAILS_CHANGED",
      fieldName: "significant_event_details",
      oldValue: Object.fromEntries(Object.entries(changes).map(([field, change]) => [field, change.old_value])),
      newValue: Object.fromEntries(Object.entries(changes).map(([field, change]) => [field, change.new_value])),
      description: "Coordinator acknowledged the impact warning before changing significant event details.",
      createdAt: changedAt
    }),
    warning_acknowledged: true,
    affected_arrangements: currentImpact
  });
};

const notifyRegisteredAttendees = (tx, { attendeeChanges, registeredAttendees, event, eventId, changedAt }) => {
  attendeeChanges.forEach((change) => {
    attendeeChangeNotices({ event: { event_id: eventId, name: event.name }, attendees: registeredAttendees, change })
      .forEach((notice) => {
        const person = registeredAttendees.find((item) => item.user_id === notice.user_id);
        const notificationRef = doc(collection(db, "notifications"));
        tx.set(notificationRef, notificationRecord({
          notificationId: notificationRef.id,
          userId: notice.user_id,
          eventId,
          type: notice.type,
          message: notice.message,
          createdAt: changedAt,
          registrationId: person?.registration_id
        }));
      });
  });
};

// I2 AC3 — marks the request Accepted with the values it changed (old values as they
// stood before this save), records the decision, and tells the organiser.
const acceptChangeRequest = (tx, {
  requestRef, requestSnapshot, changeRequest, nowValues, event, eventId, userId, changedAt
}) => {
  const requested = requestSnapshot.data().changes || {};
  const applied = Object.fromEntries(Object.entries(requested).map(([field, change]) => [field, { old_value: nowValues[field] ?? null, new_value: change.new_value }]));
  const decisionRef = doc(collection(db, "event_history"));
  const noticeRef = doc(collection(db, "notifications"));
  const note = String(changeRequest.reason || "").trim();
  tx.update(requestRef, {
    status: ACCEPTED, decided_by: userId, decided_at: changedAt,
    decision_reason: note, applied_changes: applied, decision_history_id: decisionRef.id
  });
  tx.set(decisionRef, {
    ...eventHistoryRecord({
      historyId: decisionRef.id, eventId, actorId: userId, actionType: CHANGE_ACCEPTED, fieldName: "change_request",
      oldValue: Object.fromEntries(Object.entries(applied).map(([field, change]) => [field, change.old_value])),
      newValue: Object.fromEntries(Object.entries(applied).map(([field, change]) => [field, change.new_value])),
      description: note || "Coordinator accepted the change request.", createdAt: changedAt
    }),
    change_request_id: changeRequest.id
  });
  tx.set(noticeRef, {
    ...notificationRecord({
      notificationId: noticeRef.id, userId: event.organiser_id, eventId, type: CHANGE_ACCEPTED,
      message: changeDecisionMessage({ eventName: event.name || event.reference_no, accepted: true, reason: note }), createdAt: changedAt
    }),
    change_request_id: changeRequest.id
  });
};

// D1 / SCRUM-111 and D2 / SCRUM-112 — one Edit event form, one save. `values` is
// the whole form: the ordinary fields (name, purpose, description, contact,
// internal notes) and the significant ones (pax, date, times, venue needs).
//
// Ordinary changes (D1) touch only the event document, so no booking or
// reservation moves (AC1), and each changed field gets its own event_history row
// with old and new value, actor and server time (AC2).
//
// Significant changes (D2) need the impact warning acknowledged, and the impact
// the coordinator saw must still be the current one; they are recorded in one
// acknowledged SIGNIFICANT_EVENT_DETAILS_CHANGED row with the arrangements affected.
//
// Both kinds commit together or not at all. `before` is the event the form was
// opened on and `organiser` the profile it fell back to for contact details, so an
// edit someone else made meanwhile is refused instead of overwritten.
export const saveEventEdit = async ({
  eventId, before, values, organiser = null, impact = null, acknowledged = false,
  registeredCount: registered = 0, capacityAcknowledged = false, changeRequest = null
}) => {
  const user = requireUser();
  const ordinaryBefore = ordinaryEventValues(before, organiser);
  const ordinaryPlanned = ordinaryEventChanges(ordinaryBefore, values);
  const significant = cleanSignificantValues(values);
  const significantPlanned = significantEventChanges(before, significant);
  const hasOrdinary = ordinaryPlanned.length > 0;
  const hasSignificant = Object.keys(significantPlanned).length > 0;
  const capacity = newCapacityOf(values, before);
  const capacityChanged = capacity !== null;
  if (!hasOrdinary && !hasSignificant && !capacityChanged) throw new Error("There are no changes to save.");

  const currentImpact = await checkEditBeforeSaving({
    eventId, before, values, significant, hasOrdinary, hasSignificant,
    capacity, registered, capacityAcknowledged, acknowledged, impact
  });
  const ordinary = cleanOrdinaryValues(values);
  const attendeeChanges = attendeeChangesOf(significantPlanned, significant);
  const registeredAttendees = attendeeChanges.length ? await registeredAttendeesOf(eventId) : [];

  // I3 AC4 — the capacity is saved by the service (it counts who is registered and enforces the
  // acknowledgement), before the rest of the form, so a refusal leaves everything unsaved.
  if (capacityChanged) {
    await callArrangementsService(user, eventId, "registration-capacity",
      { capacity, acknowledged: capacityAcknowledged === true }, "The registration capacity could not be saved.");
  }

  const eventRef = doc(db, "events", eventId);
  const requirementRef = doc(db, "event_venue_requirements", eventId);
  const [existingFacilities, existingAccessibility] = hasSignificant
    ? await Promise.all([
      getDocs(query(collection(db, "event_facilities"), where("event_id", "==", eventId))),
      getDocs(query(collection(db, "event_accessibility"), where("event_id", "==", eventId)))
    ])
    : [{ docs: [] }, { docs: [] }];
  let saved = 0;
  let significantChangeId = null;
  if (hasOrdinary || hasSignificant) await runTransaction(db, async (tx) => {
    const { requestRef, requestSnapshot } = await readPendingChangeRequest(tx, changeRequest, eventId);
    const snapshots = await Promise.all([
      tx.get(eventRef),
      ...(hasSignificant ? [
        tx.get(requirementRef),
        ...existingFacilities.docs.map((item) => tx.get(item.ref)),
        ...existingAccessibility.docs.map((item) => tx.get(item.ref))
      ] : [])
    ]);
    const [eventSnapshot, requirementSnapshot] = snapshots;
    if (!eventSnapshot.exists()) throw new Error(NOT_AUTHORISED);
    const event = eventSnapshot.data();
    // D1 AC3 / D2 — the current coordinator, in Approved, Planning or Confirmed only.
    if (!canEditOrdinaryDetails(event, user.uid)) {
      throw new Error("Only the current coordinator may edit this event while it is Approved, Planning or Confirmed.");
    }

    const changedAt = serverTimestamp();
    const eventUpdate = { updated_at: changedAt };

    // An edit someone else saved after the form opened is refused, not overwritten.
    let ordinaryChanges = [];
    if (hasOrdinary) {
      const current = ordinaryEventValues(event, organiser);
      if (ordinaryEventChanges(current, ordinaryBefore).length) {
        throw new Error("The event changed while you were editing it. Reload the event and try again.");
      }
      ordinaryChanges = ordinaryEventChanges(current, ordinary);
    }

    let significantChanges = {};
    let facilityRows = [];
    let accessibilityRows = [];
    if (hasSignificant) {
      if (event.open_clarification_id) throw new Error("Date, size and venue details cannot be edited while a clarification is open.");
      const rowsStart = 2;
      const facilitiesEnd = rowsStart + existingFacilities.docs.length;
      facilityRows = snapshots.slice(rowsStart, facilitiesEnd).filter((item) => item.exists());
      accessibilityRows = snapshots.slice(facilitiesEnd).filter((item) => item.exists());
      const current = storedSignificantValues(event, requirementSnapshot, facilityRows, accessibilityRows);
      if (JSON.stringify(current) !== JSON.stringify(significantEventValues(before))) {
        throw new Error("The event changed while you were editing it. Reload the event and review the warning again.");
      }
      significantChanges = significantEventChanges(current, significant);
    }
    if (!ordinaryChanges.length && !Object.keys(significantChanges).length) throw new Error("There are no changes to save.");

    const ordinaryRefs = ordinaryChanges.map(() => doc(collection(db, "event_history")));
    if (ordinaryChanges.length) {
      ordinaryChanges.forEach((change) => { eventUpdate[change.field] = change.new_value; });
      eventUpdate.last_detail_change_id = ordinaryRefs[0].id;
    }
    const significantRef = Object.keys(significantChanges).length ? doc(collection(db, "event_history")) : null;
    if (significantRef) {
      Object.assign(eventUpdate, {
        expected_attendance: significant.expected_attendance,
        event_date: significant.event_date,
        start_time: significant.start_time,
        end_time: significant.end_time,
        last_significant_change_id: significantRef.id
      });
    }
    significantChangeId = significantRef ? significantRef.id : null;
    tx.update(eventRef, eventUpdate);

    writeOrdinaryHistory(tx, { refs: ordinaryRefs, changes: ordinaryChanges, eventId, userId: user.uid, changedAt });
    if (significantRef) {
      writeSignificantChange(tx, {
        historyRef: significantRef, requirementRef, requirementSnapshot, significant, changes: significantChanges,
        facilityRows, accessibilityRows, currentImpact, eventId, userId: user.uid, changedAt
      });
    }
    notifyRegisteredAttendees(tx, { attendeeChanges, registeredAttendees, event, eventId, changedAt });
    saved = ordinaryChanges.length + Object.keys(significantChanges).length;
    if (requestSnapshot) {
      const nowValues = {
        ...significantEventValues(before),
        ...ordinaryEventValues(event, organiser),
        ...(hasSignificant ? storedSignificantValues(event, requirementSnapshot, facilityRows, accessibilityRows) : {})
      };
      acceptChangeRequest(tx, {
        requestRef, requestSnapshot, changeRequest, nowValues, event, eventId, userId: user.uid, changedAt
      });
    }
  });
  const result = { ok: true, changed: saved + (capacityChanged ? 1 : 0) };
  // I3 AC1 AC2 — only after the change is committed, never before: the service reads it.
  if (significantChangeId) result.rerequest = await requestRerequest(user, eventId, significantChangeId);
  return result;
};
