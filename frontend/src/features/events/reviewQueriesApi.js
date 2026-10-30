// The reads behind event review: each role's event list, one event's full
// detail, the Lead's board, and what a proposed change would affect.

import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { leadVisibleEvents, supervisesAllEvents } from "../../domain/eventReview";
import { ROLES } from "../../domain/roles";
import { editableEventStatuses } from "../../domain/significantEventChanges";
import { equipmentActivity, equipmentArrangements } from "../../domain/eventEquipment";
import { REGISTERED_STATUS } from "../../domain/registrationWindow";
import { NOT_AUTHORISED } from "./reviewApiSupport";
import { requireUser } from "../../lib/apiSupport";
import { asIso } from "../../lib/apiSupport";


const record = (snapshot) => {
  const data = snapshot.data();
  return {
    id: snapshot.id, ...data,
    created_at: asIso(data.created_at), updated_at: asIso(data.updated_at),
    assigned_at: asIso(data.assigned_at), submitted_at: asIso(data.submitted_at), confirmed_at: asIso(data.confirmed_at),
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
  // A profile this user may not read (or that no longer exists) must not fail the
  // whole list — that row just falls back to the organiser id instead of a name.
  const snapshots = await Promise.all(organiserIds.map((id) => getDoc(doc(db, "users", id)).catch(() => null)));
  const nameById = new Map(snapshots.filter((snapshot) => snapshot && snapshot.exists()).map((snapshot) => {
    const data = snapshot.data();
    return [snapshot.id, data.name || data.email || snapshot.id];
  }));
  return events.map((event) => ({
    ...event,
    organiser_name: event.organiser_name || nameById.get(event.organiser_id) || null
  }));
};

// Firestore's permission error never says which read it refused, so each step of
// the list load is named: "Missing or insufficient permissions" becomes
// "<step>: Missing or insufficient permissions" and points at the rule to look at.
const step = async (label, work) => {
  try { return await work(); } catch (error) { throw new Error(`${label}: ${error.message}`); }
};

export const list = async () => {
  const user = requireUser();
  const profile = await step("your profile", () => profileFor(user.uid));
  let snapshots;
  if (profile.role === ROLES.ORGANISER) {
    snapshots = (await getDocs(query(collection(db, "events"), where("organiser_id", "==", user.uid)))).docs;
  } else if (profile.role === ROLES.COORDINATOR) {
    // K5 / SCRUM-186 AC1 — only the events assigned to this coordinator now. The old
    // "previously assigned" rows (read through coordinator_assignments) are gone.
    snapshots = (await step("assigned events", () => getDocs(query(collection(db, "events"), where("coordinator_id", "==", user.uid))))).docs;
  } else throw new Error("This role cannot review event requests.");
  const unique = [...new Map(snapshots.map((item) => [item.id, item])).values()];
  let events = unique.map((item) => ({ ...record(item), editable: item.data().coordinator_id === user.uid }));
  // F11 AC1: only the current coordinator can load this list, and affected
  // events are visibly flagged without changing the event itself.
  if (profile.role === ROLES.COORDINATOR) {
    const bookingSnapshots = await Promise.all(events.map((event) =>
      getDocs(query(collection(db, "venue_bookings"), where("event_id", "==", event.id)))));
    events = events.map((event, index) => ({
      ...event,
      replacement_needed: bookingSnapshots[index].docs.some((item) => item.data().replacement_needed === true)
    }));
  }
  return { events: await withOrganiserNames(events) };
};

// The event's equipment request lines with Technical Support's status on each,
// and the reservation window of every approved line. Null when none was raised.
const equipmentView = (requestSnapshot, reservationsSnapshot) => {
  if (!requestSnapshot?.exists?.()) return null;
  const request = requestSnapshot.data();
  const lines = (request.lines || []).map((line) => ({
    ...line, fulfilled_at: asIso(line.fulfilled_at), resolved_at: asIso(line.resolved_at)
  }));
  const reservations = (reservationsSnapshot?.docs || []).map((item) => {
    const reservation = item.data();
    return { ...reservation, id: item.id, start_datetime: asIso(reservation.start_datetime), end_datetime: asIso(reservation.end_datetime) };
  });
  return equipmentArrangements({ ...request, lines }, reservations);
};

export const detail = async (eventId) => {
  const user = requireUser();
  // K5 / SCRUM-186 AC3 — a refused read, a missing event and (below) an event held by
  // another coordinator all answer the same way and read nothing further.
  const eventSnapshot = await getDoc(doc(db, "events", eventId)).catch(() => null);
  if (!eventSnapshot || !eventSnapshot.exists()) throw new Error(NOT_AUTHORISED);
  const event = record(eventSnapshot);
  // Organisers also use this shared detail loader. Resolve the profile before
  // starting role-specific reads so their existing event view never attempts a
  // venue_bookings query that Firestore correctly reserves for internal staff.
  const profile = await profileFor(user.uid);
  // The adapter's own check, behind firestore.rules: even if a read were permitted, a
  // coordinator is never handed an event that is not currently assigned to them.
  if (profile.role === ROLES.COORDINATOR && event.coordinator_id !== user.uid) throw new Error(NOT_AUTHORISED);
  const isCoordinator = profile.role === ROLES.COORDINATOR;
  // Technical Support's arrangements for this event, beside its venue bookings.
  // Supplementary: a refused or failed read leaves the section empty rather than
  // failing the whole detail.
  const none = { docs: [] };
  const [questions, assignments, history, coordinator, requirement, facilities, accessibility, equipment, organiserSnapshot, venueBookings,
    equipmentRequest, equipmentReservations, equipmentHistory] = await Promise.all([
    getDocs(query(collection(db, "clarification_requests"), where("event_id", "==", eventId))),
    getDocs(query(collection(db, "coordinator_assignments"), where("event_id", "==", eventId))),
    getDocs(query(collection(db, "event_history"), where("event_id", "==", eventId))),
    coordinatorFor(event.coordinator_id),
    // B2/B3 — the venue requirements the coordinator matches a venue against.
    // Without these the suitability gate (E7/E8) only ever sees capacity.
    getDoc(doc(db, "event_venue_requirements", eventId)),
    getDocs(query(collection(db, "event_facilities"), where("event_id", "==", eventId))),
    getDocs(query(collection(db, "event_accessibility"), where("event_id", "==", eventId))),
    // C3 — equipment lines (AC1) and the organiser's profile for contact details (AC2).
    getDocs(query(collection(db, "event_equipment"), where("event_id", "==", eventId))),
    // An unreadable profile leaves the contact blank; it never blocks the request.
    event.organiser_id ? getDoc(doc(db, "users", event.organiser_id)).catch(() => null) : Promise.resolve(null),
    // F7 — keep booking decisions with the event they belong to. Historical
    // Released/Replaced rows are deliberately retained for audit visibility.
    profile.role === ROLES.COORDINATOR
      ? getDocs(query(collection(db, "venue_bookings"), where("event_id", "==", eventId)))
      : Promise.resolve({ docs: [] }),
    isCoordinator ? getDoc(doc(db, "equipment_requests", eventId)).catch(() => null) : Promise.resolve(null),
    isCoordinator ? getDocs(query(collection(db, "equipment_reservations"), where("event_id", "==", eventId))).catch(() => none) : Promise.resolve(none),
    isCoordinator ? getDocs(query(collection(db, "equipment_request_history"), where("event_id", "==", eventId))).catch(() => none) : Promise.resolve(none)
  ]);
  const venueIds = [...new Set(venueBookings.docs.map((item) => item.data().venue_id).filter(Boolean))];
  const [coordinators, responseSnapshots, venueSnapshots] = await Promise.all([
    profile.role === ROLES.COORDINATOR ? activeCoordinators() : Promise.resolve([]),
    Promise.all(questions.docs.map((question) => getDocs(query(collection(db, "clarification_responses"), where("clarification_id", "==", question.id))))),
    Promise.all(venueIds.map((venueId) => getDoc(doc(db, "venues", venueId))))
  ]);
  const venueNames = new Map(venueSnapshots.filter((item) => item.exists()).map((item) => [item.id, item.data().name]));
  const byCreated = (a, b) => String(a.created_at || "").localeCompare(String(b.created_at || ""));
  const historyRecords = history.docs.map(record).sort(byCreated);
  const equipmentRows = (equipmentHistory?.docs || []).map(record);
  // D1 AC2 — the Activity tab names who made each change. A profile this user may
  // not read falls back to the id rather than failing the whole detail.
  const actorIds = [...new Set(historyRecords.map((item) => item.actor_id).filter(Boolean))];
  const actorSnapshots = await Promise.all(actorIds.map((id) => getDoc(doc(db, "users", id)).catch(() => null)));
  const actorNames = Object.fromEntries(actorSnapshots.filter((item) => item && item.exists?.()).map((item) => {
    const data = item.data();
    return [item.id, data.name || data.full_name || data.display_name || data.staff_name].filter(([, name]) => name);
  }));
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
    // The Activity tab lists Technical Support's decisions with the event's own history.
    history: [...historyRecords, ...equipmentActivity(equipmentRows)].sort(byCreated), actorNames,
    equipmentArrangements: equipmentView(equipmentRequest, equipmentReservations),
    clarifications: questions.docs.map(record).sort(byCreated),
    responses: responseSnapshots.flatMap((snapshot) => snapshot.docs.map(record)).sort(byCreated),
    assignments: assignments.docs.map(record).sort(byCreated),
    venueBookings: venueBookings.docs.map((item) => {
      const booking = item.data();
      return {
        booking_id: booking.booking_id || item.id,
        // F12 AC5 — an event may hold several bookings; each is told apart by its label.
        booking_label: booking.booking_label || null,
        expected_attendance: booking.expected_attendance ?? null,
        layout: booking.layout_snapshot || null,
        venue_id: booking.venue_id,
        venue_name: venueNames.get(booking.venue_id) || booking.venue_name || booking.venue_id,
        start_datetime: asIso(booking.start_datetime),
        end_datetime: asIso(booking.end_datetime),
        status: booking.status || "Status not recorded",
        decision_reason: booking.decision_reason || null,
        decided_at: asIso(booking.decided_at),
        released_at: asIso(booking.released_at),
        release_reason: booking.release_reason || null,
        replacement_needed: booking.replacement_needed === true,
        replacement_reason: booking.replacement_reason || null,
        replaced_by_booking_id: booking.replaced_by_booking_id || null,
        required_facilities_snapshot: booking.required_facilities_snapshot || []
      };
    }).sort((left, right) => String(left.start_datetime || "").localeCompare(String(right.start_datetime || "")))
  };
};

// The arrangements an event holds now, for the impact warning (D2) and for the coordinator
// weighing a change request (I2), who may be looking at an event that is not yet editable.
export const arrangementImpact = async (eventId) => {
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

export const significantChangeImpact = async (eventId) => {
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
  return arrangementImpact(eventId);
};

// I3 AC4 — people holding a place (status REGISTERED); waitlisted, withdrawn and cancelled do not.
export const registeredCount = async (eventId) => {
  const snapshot = await getDocs(query(collection(db, "registrations"), where("event_id", "==", eventId)));
  return snapshot.docs.filter((item) => String(item.data().status || "").toUpperCase() === REGISTERED_STATUS).length;
};

// A6 / Week 7 change #5 — resolve each coordinator_id on the Lead's board to a
// display name in one batch, so Oversight can name who is on every event without
// a round trip per row. Mirrors withOrganiserNames.
const withCoordinatorNames = async (events) => {
  const coordinatorIds = [...new Set(events.map((event) => event.coordinator_id).filter(Boolean))];
  // K4 / SCRUM-185 — as for organisers, a coordinator profile that cannot be read must
  // not fail the whole board: that row falls back to the coordinator id.
  const snapshots = await Promise.all(coordinatorIds.map((id) => getDoc(doc(db, "users", id)).catch(() => null)));
  const nameById = new Map(snapshots.filter((snapshot) => snapshot && snapshot.exists()).map((snapshot) => {
    const data = snapshot.data();
    return [snapshot.id, data.name || data.email || snapshot.id];
  }));
  return events.map((event) => ({
    ...event,
    coordinator_name: event.coordinator_id ? (nameById.get(event.coordinator_id) || event.coordinator_id) : null
  }));
};

// A6 / Week 7 change #5 — the Event Coordinator Lead's board. The Lead oversees
// every event (AC3), so this reads the whole events collection rather than a
// per-role scope, enriches each row with its organiser and coordinator names, and
// returns the active coordinators for the assign/reassign pickers. firestore.rules
// is what actually permits the Lead to read all events (AC5).
export const leadBoard = async () => {
  const user = requireUser();
  const profile = await profileFor(user.uid);
  if (!supervisesAllEvents(profile.role)) throw new Error("This role cannot oversee event assignments.");
  const [eventSnapshots, coordinators] = await Promise.all([
    getDocs(collection(db, "events")),
    activeCoordinators()
  ]);
  // K1 / SCRUM-182 — drafts are the organiser's unsubmitted work; drop them so the
  // Lead never sees a draft in the queue or the oversight view, only submitted events.
  const events = leadVisibleEvents(await withCoordinatorNames(await withOrganiserNames(eventSnapshots.docs.map(record))));
  return { events, coordinators };
};
