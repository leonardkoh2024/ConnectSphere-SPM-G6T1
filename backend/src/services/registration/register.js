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
//
// H5 (withdraw) and H6 (join the waiting list) change the same one record per attendee and
// event, and start from the same reads, so all three live here.

import { createRequire } from "node:module";
import {
  REGISTERED_STATUS,
  registrationAttemptRefusal
} from "../../../../frontend/src/domain/registrationWindow.mjs";
import { myRegistrationEntry, withdrawalRefusal } from "../../../../frontend/src/domain/myRegistrations.mjs";
import { openEventListing, remainingPlaces } from "../../../../frontend/src/domain/openRegistration.mjs";

const { attendeeChangeNotices } = createRequire(import.meta.url)("../../../../frontend/src/domain/safetyAndNotices.js");

const WAITLISTED_STATUS = "WAITLISTED";

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
  // Everything an action needs to know about the attendee's place on the event, read through
  // the transaction before anything is written: the event, the attendee's own record, any
  // record of theirs under an older id (the mock data's), the Registered places and, when
  // asked for, the waiting list.
  const readPlace = async (transaction, eventId, attendeeId, { withWaitlist = false } = {}) => {
    const registrations = firestore.collection("registrations");
    const own = registrations.doc(registrationIdFor(eventId, attendeeId));
    const [eventSnapshot, ownSnapshot, attendeeSnapshot, registeredSnapshot, waitlistSnapshot] = await Promise.all([
      transaction.get(firestore.collection("events").doc(eventId)),
      transaction.get(own),
      transaction.get(registrations.where("event_id", "==", eventId).where("attendee_id", "==", attendeeId)),
      transaction.get(registrations.where("event_id", "==", eventId).where("status", "==", REGISTERED_STATUS)),
      withWaitlist ? transaction.get(registrations.where("event_id", "==", eventId).where("status", "==", WAITLISTED_STATUS)) : null
    ]);
    const records = [
      ...(ownSnapshot.exists ? [{ ref: own, id: own.id, data: ownSnapshot.data() }] : []),
      ...attendeeSnapshot.docs
        .filter((item) => item.id !== own.id)
        .map((item) => ({ ref: registrations.doc(item.id), id: item.id, data: item.data() }))
    ];
    return {
      own,
      event: eventSnapshot.exists ? { id: eventId, ...eventSnapshot.data() } : null,
      // The attendee's record holding `status`, their own first; null when there is none.
      holding: (status) => records.find((record) => record.data.status === status) || null,
      taken: registeredSnapshot.docs.filter((item) => item.data().status === REGISTERED_STATUS).length,
      waiting: waitlistSnapshot ? waitlistSnapshot.docs.filter((item) => item.data().status === WAITLISTED_STATUS).length : 0,
      waitingPeople: waitlistSnapshot
        ? waitlistSnapshot.docs
          .filter((item) => item.data().status === WAITLISTED_STATUS)
          .map((item) => ({ user_id: item.data().attendee_id, status: WAITLISTED_STATUS }))
        : []
    };
  };

  const tellAttendees = (transaction, event, attendees, change) => {
    const named = { ...event, event_id: event.event_id || event.id };
    attendeeChangeNotices({ event: named, attendees, change }).forEach((notice) => {
      const notificationId = `${change.kind}-${named.event_id}-${notice.user_id}`;
      transaction.set(firestore.collection("notifications").doc(notificationId), {
        notification_id: notificationId,
        user_id: notice.user_id,
        event_id: notice.event_id,
        type: notice.type,
        message: notice.message,
        is_read: false,
        created_at: serverTimestamp(),
        read_at: null
      });
    });
  };

  // The flag, the status and the window, by the server's clock (H1 AC4), then a usable capacity.
  // The status message is written for the organiser, so an attendee gets a plainer one.
  const refuseUnlessTakingRegistrations = (event, at) => {
    if (!event) throw new RegistrationRefused(404, "not_found", "That event could not be found.");
    const refusal = registrationAttemptRefusal(event, at);
    if (refusal) {
      const message = refusal.reason === "status" ? "Registration is not open for this event." : refusal.message;
      throw new RegistrationRefused(409, refusal.reason, message);
    }
    if (!usableCapacity(event.registration_capacity)) {
      throw new RegistrationRefused(409, "no_capacity", "Registration is not open for this event.");
    }
  };

  const register = ({ eventId, attendeeId }) => firestore.runTransaction(async (transaction) => {
    const at = now();
    const place = await readPlace(transaction, eventId, attendeeId);
    const { event } = place;
    refuseUnlessTakingRegistrations(event, at);

    // AC8 — checked before capacity, so someone already holding a place is told that.
    if (place.holding(REGISTERED_STATUS)) {
      throw new RegistrationRefused(409, "already_registered", "You are already registered for this event.");
    }
    // H6 AC3 — never Registered and Waitlisted at once, and no stepping past the queue: a freed
    // place goes to the waiting list in turn (H7).
    if (place.holding(WAITLISTED_STATUS)) {
      throw new RegistrationRefused(409, "waitlisted", "You are on the waiting list for this event, so a freed place will be offered to you in turn.");
    }

    // AC5, AC7 — only REGISTERED holds a place.
    if (place.taken >= event.registration_capacity) throw new RegistrationRefused(409, "full", "This event is full.");

    // A withdrawn attendee who registers again reuses their record.
    const registrationId = registrationIdFor(eventId, attendeeId);
    transaction.set(place.own, {
      registration_id: registrationId,
      event_id: eventId,
      attendee_id: attendeeId,
      status: REGISTERED_STATUS,
      registered_at: serverTimestamp(),
      withdrawn_at: null,
      waitlist_position: null
    });
    tellAttendees(transaction, event, [{ user_id: attendeeId, status: REGISTERED_STATUS }], { kind: "REGISTRATION_CONFIRMED" });

    return {
      registration: { registration_id: registrationId, status: REGISTERED_STATUS, registered_at: at.toISOString() },
      event: openEventListing(event, { registeredCount: place.taken + 1 })
    };
  });

  // H5 / SCRUM-143 — the attendee's Registered place becomes Withdrawn, which gives it back to
  // the event at once (AC4): H3 counts only REGISTERED. Refused, with nothing written, unless
  // they hold a place on an event that has not started (AC6). Inviting the next person on the
  // waiting list is H7's.
  //
  // H6 — a place on the waiting list can be withdrawn the same way. It frees no place in the
  // event; everyone behind moves up, since positions are worked out from who is still waiting.
  const withdraw = ({ eventId, attendeeId }) => firestore.runTransaction(async (transaction) => {
    const at = now();
    const place = await readPlace(transaction, eventId, attendeeId, { withWaitlist: true });
    const { event } = place;
    const held = place.holding(REGISTERED_STATUS) || place.holding(WAITLISTED_STATUS);

    const refusal = withdrawalRefusal(held?.data, event, at);
    if (refusal) throw new RegistrationRefused(refusal.reason === "not_found" ? 404 : 409, refusal.reason, refusal.message);

    transaction.update(held.ref, { status: "WITHDRAWN", withdrawn_at: serverTimestamp() });
    if (held.data.status === REGISTERED_STATUS) {
      tellAttendees(transaction, event, place.waitingPeople, { kind: "PLACE_OPENED" });
    }

    const withdrawn = { ...held.data, id: held.id, status: "WITHDRAWN", withdrawn_at: at };
    const freed = held.data.status === REGISTERED_STATUS ? 1 : 0;
    return {
      registration: myRegistrationEntry(withdrawn, event, { now: at }),
      remaining_places: remainingPlaces(event.registration_capacity, place.taken - freed)
    };
  });

  // H6 / SCRUM-144 — join the waiting list of a full event that is still taking registrations.
  // The attendee's one record becomes Waitlisted at once (AC1), with the server's time, which is
  // what their place in the queue is worked out from (AC2). Refused, with nothing written, while
  // a place is free or when they already hold a place either way (AC3).
  const joinWaitlist = ({ eventId, attendeeId }) => firestore.runTransaction(async (transaction) => {
    const at = now();
    const place = await readPlace(transaction, eventId, attendeeId, { withWaitlist: true });
    const { event } = place;
    refuseUnlessTakingRegistrations(event, at);

    if (place.holding(REGISTERED_STATUS)) {
      throw new RegistrationRefused(409, "already_registered", "You are already registered for this event.");
    }
    if (place.holding(WAITLISTED_STATUS)) {
      throw new RegistrationRefused(409, "already_waitlisted", "You are already on the waiting list for this event.");
    }
    if (place.taken < event.registration_capacity) {
      throw new RegistrationRefused(409, "places_available", "A place is free, so register instead.");
    }

    const registrationId = registrationIdFor(eventId, attendeeId);
    const waitlisted = {
      registration_id: registrationId,
      event_id: eventId,
      attendee_id: attendeeId,
      status: WAITLISTED_STATUS,
      waitlisted_at: serverTimestamp(),
      registered_at: null,
      withdrawn_at: null,
      waitlist_position: null
    };
    transaction.set(place.own, waitlisted);

    // Everyone already waiting joined earlier, so this attendee is last in the queue.
    const entry = myRegistrationEntry({ ...waitlisted, id: registrationId, waitlisted_at: at }, event, { now: at });
    return { registration: { ...entry, waitlist_position: place.waiting + 1 } };
  });

  return { register, withdraw, joinWaitlist };
};
