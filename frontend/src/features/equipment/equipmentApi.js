import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { EQUIPMENT_TYPES } from "../../domain/events";
import {
  equipmentRequestLines,
  terminalEquipmentEventStatuses,
  validateEquipmentRequestLines
} from "../../domain/equipmentRequests";
import { ROLES } from "../../domain/roles";
import {
  calculateEquipmentAvailability,
  equipmentWindowFromVenueBookings
} from "../../domain/equipmentAvailability";

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

const approvedVenueBookings = async (eventId) => {
  const bookings = await getDocs(query(
    collection(db, "venue_bookings"),
    where("event_id", "==", eventId),
    where("status", "==", "APPROVED")
  ));
  return bookings.docs;
};

const equipmentEventWindow = async (eventId) => {
  if (!eventId) throw new Error("Choose an event before checking or reserving equipment.");
  const bookings = await approvedVenueBookings(eventId);
  return {
    docs: bookings,
    ...equipmentWindowFromVenueBookings(bookings.map((item) => item.data()))
  };
};

const availabilityRecords = async (equipmentType) => {
  const [inventory, reservations, unavailability] = await Promise.all([
    getDoc(doc(db, "equipment_inventory", equipmentType)),
    getDocs(query(
      collection(db, "equipment_reservations"),
      where("equipment_type", "==", equipmentType)
    )),
    getDocs(query(
      collection(db, "equipment_unavailability"),
      where("equipment_type", "==", equipmentType)
    ))
  ]);
  if (!inventory.exists()) {
    throw new Error(`No held inventory is recorded for ${equipmentType.replaceAll("_", " ")}.`);
  }
  return {
    inventory,
    reservations: reservations.docs,
    unavailability: unavailability.docs
  };
};

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
  const items = await Promise.all(requests.docs.map(async (item) => {
    const request = requestRecord(item);
    const reservations = await getDocs(query(
      collection(db, "equipment_reservations"),
      where("event_id", "==", request.event_id)
    ));
    return { ...request, reservations: reservations.docs.map(requestRecord) };
  }));
  return items.sort((left, right) => String(left.event_date || "").localeCompare(String(right.event_date || "")));
};

export const checkEquipmentAvailability = async ({
  equipmentType,
  windowStart,
  windowEnd,
  requestedQuantity,
  eventId = null
}) => {
  const user = currentUser();
  const userProfile = await profile(user.uid);
  if (userProfile.role !== ROLES.TECH_SUPPORT) {
    throw new Error("Only Technical Support Staff can check equipment availability.");
  }
  if (!EQUIPMENT_TYPES.includes(equipmentType)) throw new Error("Choose a supported equipment type.");
  const [records, eventWindow] = await Promise.all([
    availabilityRecords(equipmentType),
    eventId ? equipmentEventWindow(eventId) : Promise.resolve({ windowStart, windowEnd })
  ]);
  return calculateEquipmentAvailability({
    equipmentType,
    windowStart: eventWindow.windowStart,
    windowEnd: eventWindow.windowEnd,
    requestedQuantity,
    eventId,
    inventory: records.inventory.data(),
    reservations: records.reservations.map((item) => item.data()),
    unavailability: records.unavailability.map((item) => item.data())
  });
};

export const reserveEquipmentForEvent = async ({ eventId, equipmentType, quantity }) => {
  const user = currentUser();
  const userProfile = await profile(user.uid);
  if (userProfile.role !== ROLES.TECH_SUPPORT) {
    throw new Error("Only Technical Support Staff can reserve equipment.");
  }
  if (!EQUIPMENT_TYPES.includes(equipmentType)) throw new Error("Choose a supported equipment type.");
  const token = await user.getIdToken();
  const response = await fetch("/api/equipment/reservations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      event_id: eventId,
      equipment_type: equipmentType,
      quantity
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The equipment reservation could not be saved.");
  const reservation = result.reservation;
  return {
    id: reservation.id,
    eventId: reservation.event_id,
    equipmentType: reservation.equipment_type,
    quantity: reservation.quantity,
    windowStart: reservation.start_datetime,
    windowEnd: reservation.end_datetime,
    status: reservation.status
  };
};

export const releaseEquipmentReservation = async ({ reservationId, reason = "No longer required" }) => {
  const user = currentUser();
  const userProfile = await profile(user.uid);
  if (userProfile.role !== ROLES.TECH_SUPPORT) {
    throw new Error("Only Technical Support Staff can release equipment reservations.");
  }
  if (!reservationId) throw new Error("Choose an equipment reservation to release.");
  const token = await user.getIdToken();
  const response = await fetch(`/api/equipment/reservations/${encodeURIComponent(reservationId)}/release`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ reason })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The equipment reservation could not be released.");
  return result;
};
