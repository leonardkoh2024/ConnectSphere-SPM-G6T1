// I3 / SCRUM-149 — a significant change forces affected arrangements back into re-request.
//
// A coordinator's browser saves the applied change itself (reviewApi.saveEventEdit, or the
// equipment request), then asks this service to carry out what the browser may not write:
// it cannot update a venue booking or an equipment reservation, and cannot read Venue Staff
// or Technical Support accounts to tell them. So this service, using the Admin SDK:
//
//   AC1  marks the live venue bookings, equipment reservations and equipment request with a
//        `rerequest_*` flag, and moves a Confirmed event back to Planning;
//   AC2  tells the Venue Staff and Technical Support Staff who hold them;
//   AC3  never cancels, releases, deletes or changes the status of any of them: the flag is
//        the "re-request needed" signal and the booking stays as the reference point;
//   AC4  saves a lower registration capacity only with an explicit acknowledgement;
//   AC5  re-checks the registration window and capacity and, if they no longer fit, flags the
//        event's registration for review and tells the organiser. It never edits, closes or
//        cancels the registration.
//
// What it has applied is remembered in `arrangement_rerequests/{eventId}`, so a change
// applies once however many times the browser asks (a retry after a failure is safe).

import {
  REGISTERED_STATUS,
  capacityReductionNeedsAcknowledgement,
  registrationRecheckApplies,
  registrationReview,
  venueCapacityCeiling
} from "../../../../frontend/src/domain/registrationWindow.mjs";

const TECHNICAL_SUPPORT_ROLE = "TECHNICAL_SUPPORT_STAFF";
const EDITABLE_STATUSES = ["APPROVED", "PLANNING", "CONFIRMED"];
const LIVE_BOOKING_STATUSES = ["PENDING", "HELD", "APPROVED"];
const LIVE_RESERVATION_STATUSES = ["RESERVED", "APPROVED"];
const SOURCES = ["EVENT_EDIT", "EQUIPMENT"];

export const REREQUEST_NOTICE_TYPES = {
  ARRANGEMENT: "ARRANGEMENT_REREQUEST_REQUIRED",
  REGISTRATION_REVIEW: "REGISTRATION_NEEDS_REVIEW"
};

// ---- errors, carrying the HTTP status the router answers with -------------------------------

export class ArrangementError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "ArrangementError";
    this.statusCode = statusCode;
  }
}

// ---- the rules (pure) ----------------------------------------------------------------------------

const upper = (value) => String(value || "").toUpperCase();
const trimmed = (value) => String(value ?? "").trim();
const hasKeys = (value) => Boolean(value) && Object.keys(value).length > 0;

// The Edit event form lists attendance first, then when, then where, then what is needed.
const FIELD_LABELS = [
  ["expected_attendance", "Expected attendance"],
  ["event_date", "Event date"],
  ["start_time", "Start time"],
  ["end_time", "End time"],
  ["preferred_location", "Preferred location"],
  ["required_layout", "Required layout"],
  ["facilities_required", "Facilities required"],
  ["facilities", "Facilities"],
  ["accessibility_needed", "Accessibility needed"],
  ["accessibility", "Accessibility"],
  ["accessibility_notes", "Accessibility notes"]
];

// AC1 — any applied change to the date, time, duration, attendance, venue requirements or
// equipment requirements. Every field the Edit event form treats as significant is one.
export const changeTriggersReRequest = ({ significantChanges, equipmentChanged } = {}) =>
  hasKeys(significantChanges) || equipmentChanged === true;

// AC1 — a Confirmed event goes back to Planning; every other status stays as it is.
export const statusAfterChange = (status, triggered) =>
  triggered && upper(status) === "CONFIRMED" ? "PLANNING" : status;

// AC1 — a change to the event's own details can invalidate its venue booking and its
// equipment; a change to the equipment requirement invalidates the equipment alone.
export const affectedKinds = ({ significantChanges, equipmentChanged } = {}) => {
  const venue = hasKeys(significantChanges);
  return { venue, equipment: venue || equipmentChanged === true };
};

export const changedFieldLabels = (significantChanges = {}, equipmentChanged = false) => {
  const keys = Object.keys(significantChanges || {});
  const known = FIELD_LABELS.filter(([key]) => keys.includes(key)).map(([, label]) => label);
  const unknown = keys
    .filter((key) => !FIELD_LABELS.some(([known]) => known === key))
    .map((key) => key.replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase()));
  return [...known, ...unknown, ...(equipmentChanged ? ["Equipment"] : [])];
};

export const affectedVenueBookings = (bookings = []) =>
  bookings.filter((booking) => LIVE_BOOKING_STATUSES.includes(upper(booking?.status)));

export const affectedEquipmentReservations = (reservations = []) =>
  reservations.filter((reservation) => LIVE_RESERVATION_STATUSES.includes(upper(reservation?.status)));

// AC3 — the flag and its reason, and nothing that could cancel, release or approve. The
// service adds the time it was flagged.
export const reRequestMarker = ({ changeId, reason }) => ({
  rerequest_required: true,
  rerequest_change_id: changeId,
  rerequest_reason: reason
});

const named = (eventName) => eventName || "An event";

export const arrangementReRequestMessage = ({ eventName, changed = [] }) =>
  `${named(eventName)}: ${changed.join(", ")} changed, so this arrangement needs to be re-requested. `
  + "The existing booking or reservation has not been cancelled; it stays as a reference until the new request is decided.";

const REVIEW_REASON_TEXT = {
  CLOSES_AFTER_START: "Registration closes after the new event start.",
  CAPACITY_ABOVE_VENUE: "The registration capacity is above the venue capacity of the approved bookings."
};

export const registrationReviewMessage = ({ eventName, reasons = [] }) =>
  `${named(eventName)}: the registration needs review after a change to the event. `
  + `${reasons.map((reason) => REVIEW_REASON_TEXT[reason] || reason).join(" ")} `
  + "Please review the registration window and capacity. Nothing has been changed automatically.";

// The equipment request as Technical Support see it: type, quantity and requirement.
// Whitespace around a requirement does not make a change.
export const equipmentSignature = (request) => JSON.stringify(
  (request?.lines || []).map((line) => [
    String(line.equipment_type || ""),
    Number(line.quantity),
    trimmed(line.technical_requirements)
  ])
);

const changesFromHistory = (history) => {
  const before = history?.old_value && typeof history.old_value === "object" ? history.old_value : {};
  const after = history?.new_value && typeof history.new_value === "object" ? history.new_value : {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].reduce((changes, key) => {
    changes[key] = { old_value: before[key], new_value: after[key] };
    return changes;
  }, {});
};

const wholeNumber = (value) => {
  if (typeof value === "number") return Number.isInteger(value) && value >= 1 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value.trim()) && Number(value) >= 1) return Number(value);
  return null;
};

// ---- the service ----------------------------------------------------------------------------------

export const createArrangementReRequester = ({ firestore, serverTimestamp }) => {
  const requireEventId = (eventId) => {
    if (typeof eventId !== "string" || !eventId.trim()) throw new ArrangementError(400, "Choose an event first.");
    return eventId.trim();
  };

  const loadEvent = async (transaction, eventRef, userId) => {
    const snapshot = await transaction.get(eventRef);
    if (!snapshot.exists) throw new ArrangementError(404, "Event not found.");
    const event = snapshot.data();
    if (event.coordinator_id !== userId) {
      throw new ArrangementError(403, "Only the event's coordinator can do this.");
    }
    return event;
  };

  const idsOf = (snapshots) => snapshots.docs.map((item) => ({ id: item.id, ref: item.ref, ...item.data() }));

  const nothingApplied = (event) => ({
    applied: false,
    status: event.status,
    venueBookings: 0,
    equipment: 0,
    notified: { venueStaff: 0, technicalSupport: 0 },
    registrationReview: []
  });

  const apply = async ({ eventId: rawEventId, userId, changeId, source = "EVENT_EDIT" }) => {
    const eventId = requireEventId(rawEventId);
    if (!SOURCES.includes(source)) throw new ArrangementError(400, "Unknown source for the re-request.");
    if (source === "EVENT_EDIT" && (typeof changeId !== "string" || !changeId.trim())) {
      throw new ArrangementError(400, "Say which saved change to re-request for.");
    }

    const eventRef = firestore.collection("events").doc(eventId);
    const stateRef = firestore.collection("arrangement_rerequests").doc(eventId);
    const requestRef = firestore.collection("equipment_requests").doc(eventId);

    return firestore.runTransaction(async (transaction) => {
      // ---- every read first ----
      const event = await loadEvent(transaction, eventRef, userId);
      if (!EDITABLE_STATUSES.includes(upper(event.status))) return nothingApplied(event);

      const stateSnapshot = await transaction.get(stateRef);
      const state = stateSnapshot.exists ? stateSnapshot.data() : null;

      let significantChanges = {};
      if (source === "EVENT_EDIT") {
        if (event.last_significant_change_id !== changeId) {
          throw new ArrangementError(409, "That is no longer the event's latest significant change.");
        }
        const historySnapshot = await transaction.get(firestore.collection("event_history").doc(changeId));
        const history = historySnapshot.exists ? historySnapshot.data() : null;
        if (!history || history.event_id !== eventId || history.action_type !== "SIGNIFICANT_EVENT_DETAILS_CHANGED") {
          throw new ArrangementError(409, "That change is not a significant change to this event.");
        }
        if (state?.significant_change_id === changeId) return nothingApplied(event);
        significantChanges = changesFromHistory(history);
      }

      const requestSnapshot = await transaction.get(requestRef);
      const equipmentRequest = requestSnapshot.exists ? requestSnapshot.data() : null;
      const signature = equipmentSignature(equipmentRequest);

      const bookingSnapshots = await transaction.get(firestore.collection("venue_bookings").where("event_id", "==", eventId));
      const reservationSnapshots = await transaction.get(firestore.collection("equipment_reservations").where("event_id", "==", eventId));
      const allBookings = idsOf(bookingSnapshots);
      const liveReservations = affectedEquipmentReservations(idsOf(reservationSnapshots));

      let equipmentChanged = false;
      if (source === "EQUIPMENT") {
        if (!equipmentRequest) return nothingApplied(event);
        equipmentChanged = state?.equipment_signature !== undefined
          ? state.equipment_signature !== signature
          // Never recorded: only a reservation already made on the earlier request can be invalidated.
          : liveReservations.length > 0;
        if (!equipmentChanged) return nothingApplied(event);
      }

      const triggered = changeTriggersReRequest({ significantChanges, equipmentChanged });
      if (!triggered) return nothingApplied(event);
      const kinds = affectedKinds({ significantChanges, equipmentChanged });
      const changed = changedFieldLabels(significantChanges, equipmentChanged);

      const liveBookings = kinds.venue ? affectedVenueBookings(allBookings) : [];
      // Every triggered change affects equipment (affectedKinds), so its live reservations always are.
      const reservations = liveReservations;
      const requestAffected = kinds.equipment && Boolean(equipmentRequest);
      const equipmentCount = reservations.length + (requestAffected ? 1 : 0);

      // Venue Staff holding a live booking, once each.
      const venueStaffIds = [];
      for (const venueId of [...new Set(liveBookings.map((booking) => booking.venue_id).filter(Boolean))]) {
        const staff = await transaction.get(firestore.collection("venue_staff").doc(venueId));
        const userIdOfStaff = staff.exists ? staff.data().user_id : null;
        if (userIdOfStaff && !venueStaffIds.includes(userIdOfStaff)) venueStaffIds.push(userIdOfStaff);
      }

      let supportIds = [];
      if (equipmentCount > 0) {
        const users = await transaction.get(firestore.collection("users").where("role", "==", TECHNICAL_SUPPORT_ROLE));
        supportIds = users.docs.filter((item) => item.data().is_active !== false).map((item) => item.id);
      }

      // AC5 — the registration is re-checked only for a change to the date, start time,
      // attendance or venue, and only when the event takes registration.
      let reviewReasons = [];
      if (kinds.venue && registrationRecheckApplies(significantChanges) && event.registration_required === true) {
        const venueIds = [...new Set(allBookings.filter((booking) => upper(booking.status) === "APPROVED").map((booking) => booking.venue_id))];
        const venues = {};
        for (const venueId of venueIds) {
          const venue = await transaction.get(firestore.collection("venues").doc(venueId));
          if (venue.exists) venues[venueId] = venue.data();
        }
        reviewReasons = registrationReview({ event, bookings: allBookings, venues }).reasons;
      }

      // ---- then the writes ----
      const now = serverTimestamp();
      const status = statusAfterChange(event.status, true);
      const historyRef = firestore.collection("event_history").doc();
      const appliedChangeId = source === "EVENT_EDIT" ? changeId : historyRef.id;
      const reason = `${changed.join(", ")} changed`;
      const marker = { ...reRequestMarker({ changeId: appliedChangeId, reason }), rerequest_flagged_at: now };

      const eventUpdate = { updated_at: now };
      if (status !== event.status) eventUpdate.status = status;
      if (reviewReasons.length) {
        eventUpdate.registration_needs_review = true;
        eventUpdate.registration_review_reasons = reviewReasons;
        eventUpdate.registration_review_flagged_at = now;
      }
      transaction.update(eventRef, eventUpdate);

      transaction.set(historyRef, {
        history_id: historyRef.id,
        event_id: eventId,
        actor_id: userId,
        action_type: "ARRANGEMENTS_REREQUESTED",
        old_value: event.status,
        new_value: status,
        rerequest_change_id: appliedChangeId,
        created_at: now
      });

      liveBookings.forEach((booking) => transaction.update(booking.ref, marker));
      reservations.forEach((reservation) => transaction.update(reservation.ref, marker));
      if (requestAffected) transaction.update(requestRef, marker);

      const notify = (recipientId, type, message) => {
        const notificationRef = firestore.collection("notifications").doc();
        transaction.create(notificationRef, {
          notification_id: notificationRef.id,
          user_id: recipientId,
          event_id: eventId,
          type,
          message,
          is_read: false,
          created_at: now,
          read_at: null
        });
      };
      const arrangementMessage = arrangementReRequestMessage({ eventName: event.name, changed });
      venueStaffIds.forEach((recipient) => notify(recipient, REREQUEST_NOTICE_TYPES.ARRANGEMENT, arrangementMessage));
      supportIds.forEach((recipient) => notify(recipient, REREQUEST_NOTICE_TYPES.ARRANGEMENT, arrangementMessage));
      if (reviewReasons.length && event.organiser_id) {
        notify(event.organiser_id, REREQUEST_NOTICE_TYPES.REGISTRATION_REVIEW,
          registrationReviewMessage({ eventName: event.name, reasons: reviewReasons }));
      }

      transaction.set(stateRef, {
        event_id: eventId,
        significant_change_id: source === "EVENT_EDIT" ? changeId : (state?.significant_change_id ?? null),
        equipment_signature: signature,
        applied_at: now
      });

      return {
        applied: true,
        status,
        venueBookings: liveBookings.length,
        equipment: equipmentCount,
        notified: { venueStaff: venueStaffIds.length, technicalSupport: supportIds.length },
        registrationReview: reviewReasons
      };
    });
  };

  // AC4 — save a new registration capacity, counting who is registered inside the same
  // transaction as the write, and requiring the acknowledgement when it goes below them.
  const setRegistrationCapacity = async ({ eventId: rawEventId, userId, capacity: rawCapacity, acknowledged }) => {
    const eventId = requireEventId(rawEventId);
    const capacity = wholeNumber(rawCapacity);
    if (capacity === null) throw new ArrangementError(400, "Registration capacity must be a whole number greater than zero.");

    const eventRef = firestore.collection("events").doc(eventId);
    return firestore.runTransaction(async (transaction) => {
      const event = await loadEvent(transaction, eventRef, userId);
      if (event.registration_required !== true) throw new ArrangementError(409, "This event does not use attendee registration.");
      if (!EDITABLE_STATUSES.includes(upper(event.status))) {
        throw new ArrangementError(409, "Registration capacity can only be changed while the event is Approved, Planning or Confirmed.");
      }

      const bookings = idsOf(await transaction.get(firestore.collection("venue_bookings").where("event_id", "==", eventId)));
      const venues = {};
      for (const venueId of [...new Set(bookings.filter((booking) => upper(booking.status) === "APPROVED").map((booking) => booking.venue_id))]) {
        const venue = await transaction.get(firestore.collection("venues").doc(venueId));
        if (venue.exists) venues[venueId] = venue.data();
      }
      const registered = await transaction.get(
        firestore.collection("registrations").where("event_id", "==", eventId).where("status", "==", REGISTERED_STATUS)
      );
      const registeredCount = registered.size ?? registered.docs.length;

      const previousCapacity = event.registration_capacity ?? null;
      const result = { eventId, changed: capacity !== Number(previousCapacity), capacity, previousCapacity, registeredCount };
      if (!result.changed) return result;

      const ceiling = venueCapacityCeiling(bookings, venues);
      if (ceiling === null) throw new ArrangementError(409, "Capacity can be set once a venue booking has been approved.");
      if (capacity > ceiling) throw new ArrangementError(400, `Registration capacity cannot exceed the venue capacity of ${ceiling}.`);

      const belowRegistered = capacityReductionNeedsAcknowledgement({ oldCapacity: previousCapacity, newCapacity: capacity, registeredCount });
      if (belowRegistered && acknowledged !== true) {
        throw new ArrangementError(409,
          // Below the registered count means at least two registered, since a capacity is at least 1.
          `The new capacity of ${capacity} is below the ${registeredCount} people already registered. `
          + "Acknowledge this to apply it; nobody will be unregistered.");
      }

      const now = serverTimestamp();
      const historyRef = firestore.collection("event_history").doc();
      transaction.update(eventRef, { registration_capacity: capacity, updated_at: now });
      transaction.set(historyRef, {
        history_id: historyRef.id,
        event_id: eventId,
        actor_id: userId,
        action_type: "REGISTRATION_CAPACITY_CHANGED",
        field_name: "registration_capacity",
        old_value: previousCapacity,
        new_value: capacity,
        acknowledged_below_registered: belowRegistered && acknowledged === true,
        registered_count: registeredCount,
        created_at: now
      });
      return result;
    });
  };

  return { apply, setRegistrationCapacity };
};
