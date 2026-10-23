// H1 / SCRUM-139 — an event's registration capacity and window.
//
// Why this is a service and not a browser write: AC3 needs the venue capacity of the event's
// approved bookings and AC5 the number of registered attendees. An organiser may not read
// venue bookings or venues (A4), so the service (Admin SDK, which firestore.rules do not bind)
// reads them inside the same transaction as the write. That also means a booking approved or an
// attendee registering between the check and the save cannot slip past it. firestore.rules keep
// every browser away from these fields once the event is past the request stage.
//
// The rules themselves live in frontend/src/domain/registrationWindow.mjs, shared with the screen.

import {
  REGISTERED_STATUS,
  registrationPhase,
  registrationSetupRefusal,
  validateRegistrationSettings,
  venueCapacityCeiling
} from "../../../../frontend/src/domain/registrationWindow.mjs";

class RegistrationError extends Error {
  constructor(statusCode, message, fields) {
    super(message);
    this.name = "RegistrationError";
    this.statusCode = statusCode;
    if (fields) this.fields = fields;
  }
}

const SETTING_FIELDS = [
  "registration_capacity",
  "registration_open_date",
  "registration_open_time",
  "registration_close_date",
  "registration_close_time"
];

export const createRegistrationSettings = ({ firestore, serverTimestamp, getApprovedEventBookings, now = () => new Date() }) => {
  // The event, which must exist and belong to `userId`. Reads only; nothing is written here.
  const readOwnEvent = async (transaction, eventId, userId) => {
    const reference = firestore.collection("events").doc(eventId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new RegistrationError(404, "That event could not be found.");
    const event = snapshot.data();
    if (event.organiser_id !== userId) {
      throw new RegistrationError(403, "You can manage registration for your own events only.");
    }
    return { reference, event };
  };

  // AC3, AC5 — the venue ceiling and the REGISTERED count, read through the transaction.
  const readLimits = async (transaction, eventId) => {
    const bookings = await getApprovedEventBookings({ transaction, eventId });
    const venueIds = [...new Set(bookings.filter((booking) => booking.status === "APPROVED").map((booking) => booking.venue_id))];
    const venues = {};
    for (const venueId of venueIds) {
      const venue = await transaction.get(firestore.collection("venues").doc(venueId));
      if (venue.exists) venues[venueId] = venue.data();
    }
    const registrations = await transaction.get(
      firestore.collection("registrations")
        .where("event_id", "==", eventId)
        .where("status", "==", REGISTERED_STATUS)
    );
    const registeredCount = registrations.docs.filter((item) => item.data().status === REGISTERED_STATUS).length;
    return { ceiling: venueCapacityCeiling(bookings, venues), registeredCount };
  };

  // What the Registration tab needs: the saved values, the limits, the phase, and whether (and if
  // not, why not) the organiser can change anything.
  const describe = (event, limits, at) => {
    const refusal = registrationSetupRefusal(event, at);
    return {
      settings: Object.fromEntries(SETTING_FIELDS.map((field) => [field, event[field] ?? null])),
      venue_capacity: limits.ceiling,
      registered_count: limits.registeredCount,
      phase: registrationPhase(event, at),
      editable: refusal === null,
      refusal
    };
  };

  const load = ({ eventId, userId }) => firestore.runTransaction(async (transaction) => {
    const { event } = await readOwnEvent(transaction, eventId, userId);
    return describe(event, await readLimits(transaction, eventId), now());
  });

  const save = ({ eventId, userId, settings = {} }) => firestore.runTransaction(async (transaction) => {
    const at = now();
    const { reference, event } = await readOwnEvent(transaction, eventId, userId);

    // AC1, AC2 — the flag, the status, and a window that has not yet closed.
    const refusal = registrationSetupRefusal(event, at);
    if (refusal) throw new RegistrationError(409, refusal.message);

    const limits = await readLimits(transaction, eventId);
    const checked = validateRegistrationSettings({
      registrationCapacity: settings.registration_capacity,
      registrationOpenDate: settings.registration_open_date,
      registrationOpenTime: settings.registration_open_time,
      registrationCloseDate: settings.registration_close_date,
      registrationCloseTime: settings.registration_close_time
    }, { event, ceiling: limits.ceiling, registeredCount: limits.registeredCount, now: at });
    if (!checked.ok) throw new RegistrationError(422, "Check the registration settings.", checked.errors);

    transaction.update(reference, { ...checked.values, updated_at: serverTimestamp() });
    return describe({ ...event, ...checked.values }, limits, at);
  });

  return { load, save };
};
