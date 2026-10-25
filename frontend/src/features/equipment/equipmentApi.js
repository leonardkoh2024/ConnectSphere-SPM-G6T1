import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { EQUIPMENT_TYPES } from "../../domain/events";
import {
  equipmentRequestLines,
  onSiteSupportProblem,
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
  return Promise.all(activeEvents.map(async (item, index) => {
    const equipmentRequest = requests[index].exists() ? requestRecord(requests[index]) : null;
    const history = equipmentRequest
      ? await getDocs(query(
        collection(db, "equipment_request_history"),
        where("event_id", "==", item.id)
      ))
      : { docs: [] };
    return {
      id: item.id,
      ...item.data(),
      equipment_request: equipmentRequest
        ? { ...equipmentRequest, support_history: history.docs.map(requestRecord) }
        : null
    };
  })).then((items) => items.sort((left, right) =>
    String(left.event_date || "").localeCompare(String(right.event_date || ""))
  ));
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

export const submitEquipmentRequest = async ({ eventId, lines, onSiteSupport = false, onSiteSupportDetails = "" }) => {
  if (!eventId) throw new Error("Choose an event before submitting an equipment request.");
  const onSiteProblem = onSiteSupportProblem(onSiteSupport, onSiteSupportDetails);
  if (onSiteProblem) throw new Error(onSiteProblem);
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
    if (existingRequest.exists()
      && (existingRequest.data().status !== "PENDING" || existingRequest.data().has_support_decisions === true)) {
      throw new Error("This equipment request is already being handled by Technical Support and cannot be amended.");
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
      // J5 / SCRUM-154 — whether the event needs on-site support, and what. Details
      // are kept only while the box is ticked.
      on_site_support: Boolean(onSiteSupport),
      on_site_support_details: onSiteSupport ? String(onSiteSupportDetails).trim() : "",
      status: "PENDING",
      submitted_at: existingRequest.exists() && existingRequest.data().submitted_at
        ? existingRequest.data().submitted_at
        : submittedAt,
      updated_at: submittedAt,
      created_at: existingRequest.exists() ? existingRequest.data().created_at : submittedAt
    });
  });
  // J5 / SCRUM-154 — now the request is saved, ask the equipment service to tell
  // Technical Support. It compares the saved request with what they were last told
  // and speaks only if it changed. If it cannot be reached the request stays saved,
  // and the coordinator is told it was not announced; saving again retries.
  let notified = true;
  try {
    await callEquipmentService(
      user,
      `/api/equipment/requests/${encodeURIComponent(eventId)}/notify-technical-support`,
      "POST",
      {},
      "Technical Support could not be notified."
    );
  } catch (notifyError) {
    console.error("Technical Support could not be notified about the equipment request.", notifyError);
    notified = false;
  }
  // I3 / SCRUM-149 — a saved equipment request is a change to the event's equipment
  // arrangements. Ask the arrangements service to re-request them (it compares the request
  // with what it last applied, so an unchanged save re-requests nothing). Like the notice
  // above, a failure leaves the request saved; saving again retries.
  let rerequested = true;
  try {
    await callEquipmentService(
      user,
      `/api/events/${encodeURIComponent(eventId)}/rerequest-arrangements`,
      "POST",
      { source: "EQUIPMENT" },
      "The arrangements could not be marked for re-request."
    );
  } catch (rerequestError) {
    console.error("The arrangements could not be marked for re-request after the equipment request.", rerequestError);
    rerequested = false;
  }
  return { ok: true, status: "PENDING", notified, rerequested };
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
  const names = await coordinatorNames(items.map((item) => item.coordinator_id));
  return items
    .map((item) => ({ ...item, coordinator_name: names.get(item.coordinator_id) || null }))
    .sort((left, right) => String(left.event_date || "").localeCompare(String(right.event_date || "")));
};

// Technical Support see who coordinates each event. Firestore rules let any
// signed-in user read an active coordinator's profile; one that cannot be read
// (inactive or removed) leaves the name blank rather than failing the queue.
const coordinatorNames = async (coordinatorIds) => {
  const ids = [...new Set(coordinatorIds.filter(Boolean))];
  const entries = await Promise.all(ids.map((id) => getDoc(doc(db, "users", id))
    .then((snapshot) => [id, snapshot.exists() ? snapshot.data().name || snapshot.data().email || null : null])
    .catch(() => [id, null])));
  return new Map(entries);
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

const SERVICE_UNREACHABLE =
  "The equipment service is not responding. Check that the backend is running (npm start), then try again.";

// Every equipment action goes through the backend. When it is down, CRA's dev
// proxy replies with a plain-text "Proxy error" page, so a reply that is not
// JSON (or no reply at all) means the service could not be reached.
const callEquipmentService = async (user, path, method, body, fallbackError) => {
  const token = await user.getIdToken();
  let response;
  let result;
  try {
    response = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
    result = await response.json();
  } catch (_error) {
    throw new Error(SERVICE_UNREACHABLE);
  }
  if (!response.ok) throw new Error(result?.error || fallbackError);
  return result;
};

export const reserveEquipmentForEvent = async ({ eventId, equipmentType, quantity, lineIndex }) => {
  const user = currentUser();
  const userProfile = await profile(user.uid);
  if (userProfile.role !== ROLES.TECH_SUPPORT) {
    throw new Error("Only Technical Support Staff can reserve equipment.");
  }
  if (!EQUIPMENT_TYPES.includes(equipmentType)) throw new Error("Choose a supported equipment type.");
  const result = await callEquipmentService(user, "/api/equipment/reservations", "POST", {
    event_id: eventId,
    equipment_type: equipmentType,
    quantity,
    line_index: lineIndex
  }, "The equipment reservation could not be saved.");
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

const equipmentAction = (user, path, method, body) =>
  callEquipmentService(user, path, method, body, "The equipment request could not be updated.");

export const amendEquipmentRequestLine = async ({ eventId, lineIndex, equipmentType, quantity, note }) => {
  const user = currentUser();
  const userProfile = await profile(user.uid);
  if (userProfile.role !== ROLES.TECH_SUPPORT) {
    throw new Error("Only Technical Support Staff can amend equipment requests.");
  }
  return equipmentAction(
    user,
    `/api/equipment/requests/${encodeURIComponent(eventId)}/lines/${lineIndex}`,
    "PATCH",
    { equipment_type: equipmentType, quantity, note }
  );
};

export const markEquipmentLineUnableToFulfill = async ({ eventId, lineIndex, reason }) => {
  const user = currentUser();
  const userProfile = await profile(user.uid);
  if (userProfile.role !== ROLES.TECH_SUPPORT) {
    throw new Error("Only Technical Support Staff can resolve equipment requests.");
  }
  return equipmentAction(
    user,
    `/api/equipment/requests/${encodeURIComponent(eventId)}/lines/${lineIndex}/unable-to-fulfill`,
    "POST",
    { reason }
  );
};

// G2 / G3 / G5 — stock, unavailability and every reservation with its event,
// from the equipment service. `userId` lets the screen pick out the caller's own.
export const loadEquipmentCatalogue = async () => {
  const user = currentUser();
  const userProfile = await profile(user.uid);
  if (userProfile.role !== ROLES.TECH_SUPPORT) {
    throw new Error("Only Technical Support Staff can view the equipment catalogue.");
  }
  const catalogue = await callEquipmentService(
    user, "/api/equipment/catalogue", "GET", undefined, "The equipment catalogue could not be loaded."
  );
  return { ...catalogue, userId: user.uid };
};

export const releaseEquipmentReservation = async ({ reservationId, reason = "No longer required" }) => {
  const user = currentUser();
  const userProfile = await profile(user.uid);
  if (userProfile.role !== ROLES.TECH_SUPPORT) {
    throw new Error("Only Technical Support Staff can release equipment reservations.");
  }
  if (!reservationId) throw new Error("Choose an equipment reservation to release.");
  return equipmentAction(
    user,
    `/api/equipment/reservations/${encodeURIComponent(reservationId)}/release`,
    "POST",
    { reason }
  );
};

export const releaseCancelledEventReservations = async ({ eventId, reason }) => {
  const user = currentUser();
  const userProfile = await profile(user.uid);
  if (userProfile.role !== ROLES.COORDINATOR) {
    throw new Error("Only an Event Coordinator can release equipment for a cancelled event.");
  }
  return equipmentAction(
    user,
    `/api/equipment/events/${encodeURIComponent(eventId)}/cancel-reservations`,
    "POST",
    { reason }
  );
};
