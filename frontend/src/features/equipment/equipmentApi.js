import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { EQUIPMENT_TYPES } from "../../domain/events";
import {
  equipmentRequestLines,
  terminalEquipmentEventStatuses,
  validateEquipmentRequestLines
} from "../../domain/equipmentRequests";
import { ROLES } from "../../domain/roles";

const currentUser = () => {
  if (!auth.currentUser) throw new Error("Please sign in again.");
  return auth.currentUser;
};

const profile = async (userId) => {
  const snapshot = await getDoc(doc(db, "users", userId));
  if (!snapshot.exists()) throw new Error("Your user profile could not be found.");
  return snapshot.data();
};

const requestRecord = (snapshot) => ({ id: snapshot.id, ...snapshot.data() });

export const listCoordinatorEquipmentEvents = async () => {
  const user = currentUser();
  const userProfile = await profile(user.uid);
  if (userProfile.role !== ROLES.COORDINATOR) throw new Error("Only an Event Coordinator can manage equipment requests.");
  const events = await getDocs(query(collection(db, "events"), where("coordinator_id", "==", user.uid)));
  const activeEvents = events.docs.filter((item) => !terminalEquipmentEventStatuses.includes(item.data().status));
  const requests = await Promise.all(activeEvents.map((item) => getDoc(doc(db, "equipment_requests", item.id))));
  return activeEvents.map((item, index) => ({
    id: item.id,
    ...item.data(),
    equipment_request: requests[index].exists() ? requestRecord(requests[index]) : null
  })).sort((left, right) => String(left.event_date || "").localeCompare(String(right.event_date || "")));
};

export const loadCoordinatorEquipmentEditor = async (eventId) => {
  if (!eventId) throw new Error("Choose an event before editing its equipment request.");
  const user = currentUser();
  const userProfile = await profile(user.uid);
  if (userProfile.role !== ROLES.COORDINATOR) throw new Error("Only an Event Coordinator can manage equipment requests.");
  const eventSnapshot = await getDoc(doc(db, "events", eventId));
  if (!eventSnapshot.exists()) throw new Error("Event not found.");
  const event = { id: eventSnapshot.id, ...eventSnapshot.data() };
  if (event.coordinator_id !== user.uid) throw new Error("Only the assigned Event Coordinator can edit this request.");
  if (terminalEquipmentEventStatuses.includes(event.status)) {
    throw new Error("Equipment requests cannot be changed for a completed, cancelled or rejected event.");
  }
  const requestSnapshot = await getDoc(doc(db, "equipment_requests", eventId));
  if (requestSnapshot.exists()) {
    const request = requestRecord(requestSnapshot);
    return { event, request, lines: equipmentRequestLines(request.lines) };
  }
  const originalLines = await getDocs(query(collection(db, "event_equipment"), where("event_id", "==", eventId)));
  return {
    event,
    request: null,
    lines: equipmentRequestLines(originalLines.docs.map((item) => item.data()))
  };
};

export const submitEquipmentRequest = async ({ eventId, lines }) => {
  if (!eventId) throw new Error("Choose an event before submitting an equipment request.");
  const user = currentUser();
  const userProfile = await profile(user.uid);
  if (userProfile.role !== ROLES.COORDINATOR) throw new Error("Only an Event Coordinator can submit an equipment request.");
  const normalizedLines = equipmentRequestLines(lines).map((line) => ({
    equipment_type: line.equipment_type,
    quantity: Number(line.quantity),
    technical_requirements: line.technical_requirements.trim()
  }));
  const validationError = validateEquipmentRequestLines(normalizedLines);
  if (validationError) throw new Error(validationError);
  normalizedLines.forEach((line) => {
    if (!EQUIPMENT_TYPES.includes(line.equipment_type)) throw new Error("Choose a supported equipment type for every line.");
  });
  const eventRef = doc(db, "events", eventId);
  const requestRef = doc(db, "equipment_requests", eventId);
  await runTransaction(db, async (transaction) => {
    const eventSnapshot = await transaction.get(eventRef);
    const existingRequest = await transaction.get(requestRef);
    if (!eventSnapshot.exists()) throw new Error("Event not found.");
    const event = eventSnapshot.data();
    if (event.coordinator_id !== user.uid) throw new Error("Only the assigned Event Coordinator can submit this request.");
    if (terminalEquipmentEventStatuses.includes(event.status)) {
      throw new Error("Equipment requests cannot be submitted for a completed, cancelled or rejected event.");
    }
    const submittedAt = serverTimestamp();
    transaction.set(requestRef, {
      request_id: eventId,
      event_id: eventId,
      coordinator_id: user.uid,
      event_name: event.name || "Untitled event",
      reference_no: event.reference_no || eventId,
      event_date: event.event_date || null,
      start_time: event.start_time || null,
      end_time: event.end_time || null,
      expected_attendance: event.expected_attendance ?? null,
      lines: normalizedLines,
      status: "PENDING",
      submitted_at: existingRequest.exists() && existingRequest.data().submitted_at
        ? existingRequest.data().submitted_at
        : submittedAt,
      updated_at: submittedAt,
      created_at: existingRequest.exists() ? existingRequest.data().created_at : submittedAt
    });
  });
  return { ok: true, status: "PENDING" };
};

export const listPendingEquipmentRequests = async () => {
  const user = currentUser();
  const userProfile = await profile(user.uid);
  if (userProfile.role !== ROLES.TECH_SUPPORT) throw new Error("Only Technical Support Staff can view the equipment queue.");
  const requests = await getDocs(query(
    collection(db, "equipment_requests"),
    where("status", "==", "PENDING")
  ));
  return requests.docs.map(requestRecord)
    .sort((left, right) => String(left.event_date || "").localeCompare(String(right.event_date || "")));
};
