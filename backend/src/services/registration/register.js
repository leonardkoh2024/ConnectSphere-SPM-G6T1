// H3 / SCRUM-141 — an attendee registers for an event.
//
// Why this is a service and not a browser write: firestore.rules cannot count the places an
// event has already given out, nor see another registration by the same attendee, so AC5
// (full), AC7 (the place is taken) and AC8 (no duplicate) can only hold here. The browser has
// no create on `registrations` at all. Everything is read and written in one transaction, so
// two attendees racing for the last place cannot both get it, and a double click cannot
// register anyone twice.
//
// It also keeps H1 AC4: a registration outside the open window is refused by the server's
// clock, through the same rule the organiser's Registration tab shows (registrationWindow.mjs).

import {
  REGISTERED_STATUS,
  registrationAttemptRefusal
} from "../../../../frontend/src/domain/registrationWindow.mjs";
import { openEventListing } from "../../../../frontend/src/domain/openRegistration.mjs";

class RegistrationRefused extends Error {
  constructor(statusCode, reason, message) {
    super(message);
    this.name = "RegistrationRefused";
    this.statusCode = statusCode;
    this.reason = reason;
  }
}

// One record per attendee and event, so a second attempt lands on the same document.
export const registrationIdFor = (eventId, attendeeId) => `${eventId}_${attendeeId}`;

const usableCapacity = (value) => Number.isInteger(value) && value > 0;

export const createAttendeeRegistration = ({ firestore, serverTimestamp, now = () => new Date() }) => {
  const register = ({ eventId, attendeeId }) => firestore.runTransaction(async (transaction) => {
    const at = now();
    const registrations = firestore.collection("registrations");
    const own = registrations.doc(registrationIdFor(eventId, attendeeId));

    const [eventSnapshot, ownSnapshot, attendeeSnapshot, registeredSnapshot] = await Promise.all([
      transaction.get(firestore.collection("events").doc(eventId)),
      transaction.get(own),
      // AC8 — a registration made under an older record id (the mock data's) still counts.
      transaction.get(registrations.where("event_id", "==", eventId).where("attendee_id", "==", attendeeId)),
      transaction.get(registrations.where("event_id", "==", eventId).where("status", "==", REGISTERED_STATUS))
    ]);

    if (!eventSnapshot.exists) throw new RegistrationRefused(404, "not_found", "That event could not be found.");
    const event = { id: eventId, ...eventSnapshot.data() };

    // AC6 and H1 AC4 — the flag, the status, and the window, by the server's clock.
    // The status message is written for the organiser, so an attendee gets a plainer one.
    const refusal = registrationAttemptRefusal(event, at);
    if (refusal) {
      const message = refusal.reason === "status" ? "Registration is not open for this event." : refusal.message;
      throw new RegistrationRefused(409, refusal.reason, message);
    }
    if (!usableCapacity(event.registration_capacity)) {
      throw new RegistrationRefused(409, "no_capacity", "Registration is not open for this event.");
    }

    // AC8 — checked before capacity, so someone already holding a place is told that.
    const alreadyRegistered = (ownSnapshot.exists && ownSnapshot.data().status === REGISTERED_STATUS)
      || attendeeSnapshot.docs.some((item) => item.data().status === REGISTERED_STATUS);
    if (alreadyRegistered) {
      throw new RegistrationRefused(409, "already_registered", "You are already registered for this event.");
    }

    // AC5, AC7 — only REGISTERED holds a place.
    const taken = registeredSnapshot.docs.filter((item) => item.data().status === REGISTERED_STATUS).length;
    if (taken >= event.registration_capacity) throw new RegistrationRefused(409, "full", "This event is full.");

    // A withdrawn attendee who registers again reuses their record.
    const registrationId = registrationIdFor(eventId, attendeeId);
    transaction.set(own, {
      registration_id: registrationId,
      event_id: eventId,
      attendee_id: attendeeId,
      status: REGISTERED_STATUS,
      registered_at: serverTimestamp(),
      withdrawn_at: null,
      waitlist_position: null
    });

    return {
      registration: { registration_id: registrationId, status: REGISTERED_STATUS, registered_at: at.toISOString() },
      event: openEventListing(event, { registeredCount: taken + 1 })
    };
  });

  return { register };
};
