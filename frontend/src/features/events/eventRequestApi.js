// How an event request (epic B) is stored. EventRequestForm owns the form; this
// module owns the Firestore side of it.
//
// A request spans five collections — events, event_venue_requirements,
// event_facilities, event_equipment and event_accessibility — so every write here
// must keep them consistent with each other.

import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { NO, YES, createReferenceNo, equipmentLinesWithContent } from "../../domain/eventRequest";
import { notificationRecord } from "../../domain/eventReviewRecords";
import { eventSubmittedMessage } from "../../domain/notifications";
import { eventEnteredUnassignedQueue } from "../../domain/safetyAndNotices";
import { ROLES } from "../../domain/roles";

// Firestore stores a plain boolean, or null for a question nobody has answered yet.
const answeredAs = (answer) => (answer === YES ? true : answer === NO ? false : null);

// Keyed by the event's own id, one document per event.
const KEYED_BY_EVENT_ID = ["event_venue_requirements"];

// Queried by an event_id field, any number of documents per event.
const LINKED_BY_EVENT_ID = ["event_facilities", "event_equipment", "event_accessibility", "event_history"];

// A5 — the events this user is related to, newest first. scopeField is the event
// field that relates them (domain/roles.js, eventScopeField); firestore.rules is
// the real boundary.
const sortKey = (event) => event.updated_at?.toMillis?.() ?? event.created_at?.toMillis?.() ?? 0;
export const loadRelatedEvents = async ({ scopeField, userId }) => {
  const snapshot = await getDocs(query(collection(db, "events"), where(scopeField, "==", userId)));
  const records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  return records.sort((a, b) => sortKey(b) - sortKey(a));
};

// B8 / SCRUM-99 — deleting a draft.
//
// A request is spread over five collections, so removing the event document alone
// would leave its requirements, facilities, equipment, accessibility answers and
// history behind as orphans. B8 AC3 asks for the draft to be unretrievable by ID,
// which means all six go.
//
// Order matters: the child rules authorise by looking the parent event up, so the
// children have to go while the event is still there to prove ownership.
export const deleteEventRequest = async (eventId) => {
  const linked = await Promise.all(
    LINKED_BY_EVENT_ID.map((name) => getDocs(query(collection(db, name), where("event_id", "==", eventId))))
  );

  await Promise.all([
    ...KEYED_BY_EVENT_ID.map((name) => deleteDoc(doc(db, name, eventId))),
    ...linked.flatMap((snapshot) => snapshot.docs.map((item) => deleteDoc(item.ref)))
  ]);

  await deleteDoc(doc(db, "events", eventId));
};

// Everything a saved request holds outside its event document.
export const loadEventRequestDetails = async (eventId) => {
  const [venueRequirement, facilitySnapshot, equipmentSnapshot, accessibilitySnapshot] = await Promise.all([
    getDoc(doc(db, "event_venue_requirements", eventId)),
    getDocs(query(collection(db, "event_facilities"), where("event_id", "==", eventId))),
    getDocs(query(collection(db, "event_equipment"), where("event_id", "==", eventId))),
    getDocs(query(collection(db, "event_accessibility"), where("event_id", "==", eventId)))
  ]);
  return {
    requirement: venueRequirement.exists() ? venueRequirement.data() : {},
    facilities: facilitySnapshot.docs.map((item) => item.data().facility_id),
    equipment: equipmentSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    accessibility: accessibilitySnapshot.docs.map((item) => item.data().accessibility_id)
  };
};

// J2 / SCRUM-151 AC1 — submission received. Only a real submission tells the
// organiser (not a draft, and not an answer to a clarification), and only after the
// event itself is saved. If the notice cannot be written the request is still
// reported as submitted: the event exists, and an error here would invite a second
// submission of the same request.
const notifySubmission = async ({ user, eventId, eventName, eventDate }) => {
  try {
    const noticeRef = doc(collection(db, "notifications"));
    await setDoc(noticeRef, notificationRecord({ notificationId: noticeRef.id, userId: user.uid, eventId, type: "EVENT_SUBMITTED", message: eventSubmittedMessage({ eventName }), createdAt: serverTimestamp() }));
  } catch (noticeError) { console.error("Could not record the submission notice:", noticeError); }
  // J8 / SCRUM-191 — every active Lead is told the request is waiting, unassigned.
  try {
    const [profile, leadSnapshot] = await Promise.all([
      getDoc(doc(db, "users", user.uid)),
      getDocs(query(collection(db, "users"), where("role", "==", ROLES.COORDINATOR_LEAD), where("is_active", "==", true)))
    ]);
    const waiting = eventEnteredUnassignedQueue({
      event: {
        event_id: eventId,
        status: "SUBMITTED",
        name: eventName,
        organiser_name: profile.exists() ? (profile.data().name || user.email) : user.email,
        event_date: eventDate,
        submitted_at: new Date().toISOString()
      },
      leads: leadSnapshot.docs.map((item) => ({
        user_id: item.id, role: item.data().role, active: item.data().is_active !== false
      }))
    });
    await Promise.all(waiting.notifications.map(async (notice) => {
      const leadRef = doc(collection(db, "notifications"));
      await setDoc(leadRef, {
        ...notificationRecord({
          notificationId: leadRef.id, userId: notice.user_id, eventId,
          type: notice.type, message: notice.message, createdAt: serverTimestamp()
        }),
        link_screen: notice.link?.screen || "Unassigned queue"
      });
    }));
  } catch (leadError) { console.error("Could not tell the Event Coordinator Leads:", leadError); }
};

// Saves the form as a draft, a submission, or (isAmend) an organiser's amendment
// while answering a clarification. Returns what the form needs to report back.
export const saveEventRequest = async ({ user, draft, form, submit, isAmend }) => {
  const referenceNo = draft?.reference_no || createReferenceNo();
  const needsRegistration = form.registrationRequired === YES;
  const fieldData = {
    name: form.name.trim(),
    purpose: form.purpose.trim(),
    description: form.description.trim(),
    event_date: form.eventDate || null,
    start_time: form.startTime || null,
    end_time: form.endTime || null,
    expected_attendance: form.expectedAttendance ? Number(form.expectedAttendance) : null,
    equipment_required: answeredAs(form.equipmentRequired),
    registration_required: answeredAs(form.registrationRequired),
    registration_capacity: needsRegistration && form.registrationCapacity ? Number(form.registrationCapacity) : null,
    registration_open_date: needsRegistration ? form.registrationOpenDate || null : null,
    registration_open_time: needsRegistration ? form.registrationOpenTime || null : null,
    registration_close_date: needsRegistration ? form.registrationCloseDate || null : null,
    registration_close_time: needsRegistration ? form.registrationCloseTime || null : null,
    updated_at: serverTimestamp()
  };
  const eventData = isAmend
    ? fieldData
    : {
        reference_no: referenceNo,
        organiser_id: user.uid,
        coordinator_id: null,
        ...fieldData,
        status: submit ? "SUBMITTED" : "DRAFT",
        created_by: user.uid,
        ...(submit ? { submitted_at: serverTimestamp() } : {})
      };
  let eventRef;
  if (draft) {
    eventRef = doc(db, "events", draft.id);
    await updateDoc(eventRef, eventData);
  } else eventRef = await addDoc(collection(db, "events"), { ...eventData, created_at: serverTimestamp() });

  // Requirements are intentionally persisted for drafts too, including blank
  // values, so no information is lost when an organiser comes back later.
  await setDoc(doc(db, "event_venue_requirements", eventRef.id), {
    event_id: eventRef.id,
    preferred_location: form.preferredLocation.trim(),
    required_layout: form.requiredLayout || null,
    facilities_required: answeredAs(form.facilitiesRequired),
    accessibility_needed: answeredAs(form.accessibilityRequired),
    accessibility_notes: form.accessibilityNotes.trim()
  });
  // Only the sections answered Yes contribute rows; a No leaves none behind,
  // including when the answer has just been changed from Yes.
  const equipmentLines = form.equipmentRequired === YES ? equipmentLinesWithContent(form) : [];
  const facilities = form.facilitiesRequired === YES ? form.facilities : [];
  const accessibility = form.accessibilityRequired === YES ? form.accessibility : [];
  const [existingFacilities, existingEquipment, existingAccessibility] = await Promise.all([
    getDocs(query(collection(db, "event_facilities"), where("event_id", "==", eventRef.id))),
    getDocs(query(collection(db, "event_equipment"), where("event_id", "==", eventRef.id))),
    getDocs(query(collection(db, "event_accessibility"), where("event_id", "==", eventRef.id)))
  ]);
  await Promise.all([
    ...existingFacilities.docs.map((item) => deleteDoc(item.ref)),
    ...existingEquipment.docs.map((item) => deleteDoc(item.ref)),
    ...existingAccessibility.docs.map((item) => deleteDoc(item.ref)),
    ...facilities.map((facilityId) =>
      setDoc(doc(db, "event_facilities", `${eventRef.id}_${facilityId}`), { event_id: eventRef.id, facility_id: facilityId })
    ),
    ...equipmentLines.map((line, index) =>
      setDoc(doc(db, "event_equipment", `${eventRef.id}_${index}`), {
        event_id: eventRef.id,
        equipment_type: line.equipmentType.trim(),
        quantity: Number(line.quantity),
        technical_note: line.technicalNote.trim() || null
      })
    ),
    ...accessibility.map((accessibilityId) =>
      setDoc(doc(db, "event_accessibility", `${eventRef.id}_${accessibilityId}`), { event_id: eventRef.id, accessibility_id: accessibilityId })
    )
  ]);
  await addDoc(collection(db, "event_history"), {
    event_id: eventRef.id,
    actor_id: user.uid,
    action_type: isAmend ? "CLARIFICATION_AMENDED" : submit ? "EVENT_SUBMITTED" : "DRAFT_CREATED",
    description: isAmend
      ? "Organiser amended the request while answering a clarification."
      : submit ? "Event request submitted by organiser." : "Event draft created by organiser.",
    created_at: serverTimestamp()
  });
  // K1 / SCRUM-182 AC1 — a submitted event is NOT auto-assigned a coordinator.
  // It is written with coordinator_id: null above and now waits in the Event
  // Coordinator Lead's unassigned queue, where the Lead assigns it (A6). The old
  // auto-assign call to /api/coordinator-assignment (C1) is deliberately removed.
  if (submit && !isAmend) {
    await notifySubmission({ user, eventId: eventRef.id, eventName: fieldData.name || referenceNo, eventDate: fieldData.event_date });
  }
  return { eventId: eventRef.id, referenceNo, eventData };
};
