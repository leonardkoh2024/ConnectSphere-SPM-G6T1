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
// H5 (withdraw), H6 (join the waiting list) and H7 (accept or decline an offered place) change
// the same one record per attendee and event, and start from the same reads, so all live here.
// H7 — every one of them also hands any free place to the waiting list (offerFreedPlaces), so a
// place freed, declined or lapsed is offered to the next person on the next action on the event.

import { createRequire } from "node:module";
import {
  REGISTERED_STATUS,
  registrationAttemptRefusal
} from "../../../../frontend/src/domain/registrationWindow.mjs";
import { myRegistrationEntry, withdrawalRefusal } from "../../../../frontend/src/domain/myRegistrations.mjs";
import { openEventListing, remainingPlaces } from "../../../../frontend/src/domain/openRegistration.mjs";
import {
  invitationState,
  invitationsToIssue,
  placeOfferedMessage,
  reservedPlaces
} from "../../../../frontend/src/domain/waitingList.mjs";

const { attendeeChangeNotices } = createRequire(import.meta.url)("../../../../frontend/src/domain/safetyAndNotices.js");

const WAITLISTED_STATUS = "WAITLISTED";
const WITHDRAWN_STATUS = "WITHDRAWN";

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
  // Everything an action needs to know, read through the transaction before anything is written:
  // the event, the attendee's own record, and every registration on the event (theirs under an
  // older id included, the places taken, and the waiting list with its offers).
  const readPlace = async (transaction, eventId, attendeeId) => {
    const registrations = firestore.collection("registrations");
    const own = registrations.doc(registrationIdFor(eventId, attendeeId));
    const [eventSnapshot, ownSnapshot, eventRecords] = await Promise.all([
      transaction.get(firestore.collection("events").doc(eventId)),
      transaction.get(own),
      transaction.get(registrations.where("event_id", "==", eventId))
    ]);
    const records = eventRecords.docs.map((item) => ({ ref: registrations.doc(item.id), id: item.id, data: item.data() }));
    const mine = [
      ...(ownSnapshot.exists ? [{ ref: own, id: own.id, data: ownSnapshot.data() }] : []),
      ...records.filter((record) => record.id !== own.id && record.data.attendee_id === attendeeId)
    ];
    return {
      own,
      records,
      event: eventSnapshot.exists ? { id: eventId, ...eventSnapshot.data() } : null,
      // The attendee's record holding `status`, their own first; null when there is none.
      holding: (status) => mine.find((record) => record.data.status === status) || null,
      taken: records.filter((record) => record.data.status === REGISTERED_STATUS).length,
      waiting: records.filter((record) => record.data.status === WAITLISTED_STATUS).length
    };
  };

  // J7 / SCRUM-156 — the attendee notices the domain words (here, a confirmed registration).
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

  // H7 AC1, AC4 — offer every place neither taken nor held to the waiting list, in queue order,
  // with a notice to each person offered one (J7 AC2: "notified when a place opens and they are
  // invited to apply"). `records` are the event's registrations as they stand after this
  // transaction's own change; they are updated in place with the offers made.
  const offerFreedPlaces = (transaction, event, records, at) => {
    const offers = invitationsToIssue({ event, records: records.map((record) => ({ id: record.id, ...record.data })), now: at });
    offers.forEach(({ id, expires_at: expiresAt }) => {
      const record = records.find((item) => item.id === id);
      transaction.update(record.ref, { invited_at: serverTimestamp(), invitation_expires_at: expiresAt });
      record.data = { ...record.data, invited_at: at, invitation_expires_at: expiresAt };
      const notice = firestore.collection("notifications").doc();
      transaction.create(notice, {
        notification_id: notice.id,
        user_id: record.data.attendee_id,
        event_id: event.id,
        registration_id: id,
        type: "WAITLIST_PLACE_OFFERED",
        message: placeOfferedMessage({ eventName: event.name, expiresAt }),
        expires_at: expiresAt,
        is_read: false,
        created_at: serverTimestamp(),
        read_at: null
      });
    });
    return offers;
  };

  // The event's records with one of them changed, for offerFreedPlaces to judge.
  const withChange = (records, id, changes) =>
    records.map((record) => (record.id === id ? { ...record, data: { ...record.data, ...changes } } : record));

  // Runs `action` in a transaction. An action that must refuse after it has already offered a
  // place returns { refused } instead of throwing, so the offer is still committed.
  const act = async (action) => {
    const outcome = await firestore.runTransaction(action);
    if (outcome?.refused) throw outcome.refused;
    return outcome;
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

  const register = ({ eventId, attendeeId }) => act(async (transaction) => {
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

    // AC5, AC7 — only REGISTERED holds a place; H7 — and a place offered to the waiting list is held.
    offerFreedPlaces(transaction, event, place.records, at);
    const held = reservedPlaces(place.records.map((record) => record.data), at);
    if (place.taken + held >= event.registration_capacity) {
      return { refused: new RegistrationRefused(409, "full", "This event is full.") };
    }

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
      event: openEventListing(event, { registeredCount: place.taken + 1 + held })
    };
  });

  // H5 / SCRUM-143 — the attendee's Registered place becomes Withdrawn, which gives it back to
  // the event at once (AC4). Refused, with nothing written, unless they hold a place on an event
  // that has not started (AC6). H6 — a place on the waiting list can be withdrawn the same way;
  // it frees no place. H7 — a freed place is offered to the first person waiting, in the same
  // transaction, and only to them.
  const withdraw = ({ eventId, attendeeId }) => act(async (transaction) => {
    const at = now();
    const place = await readPlace(transaction, eventId, attendeeId);
    const { event } = place;
    const held = place.holding(REGISTERED_STATUS) || place.holding(WAITLISTED_STATUS);

    const refusal = withdrawalRefusal(held?.data, event, at);
    if (refusal) throw new RegistrationRefused(refusal.reason === "not_found" ? 404 : 409, refusal.reason, refusal.message);

    transaction.update(held.ref, { status: WITHDRAWN_STATUS, withdrawn_at: serverTimestamp(), withdrawn_from: held.data.status });
    const left = { status: WITHDRAWN_STATUS, withdrawn_at: at, withdrawn_from: held.data.status };
    offerFreedPlaces(transaction, event, withChange(place.records, held.id, left), at);

    const freed = held.data.status === REGISTERED_STATUS ? 1 : 0;
    return {
      registration: myRegistrationEntry({ ...held.data, id: held.id, ...left }, event, { now: at }),
      remaining_places: remainingPlaces(event.registration_capacity, place.taken - freed)
    };
  });

  // H6 / SCRUM-144 — join the waiting list of a full event that is still taking registrations.
  // The attendee's one record becomes Waitlisted at once (AC1), with the server's time, which is
  // what their place in the queue is worked out from (AC2). Refused while a place is free or when
  // they already hold a place either way (AC3).
  const joinWaitlist = ({ eventId, attendeeId }) => act(async (transaction) => {
    const at = now();
    const place = await readPlace(transaction, eventId, attendeeId);
    const { event } = place;
    refuseUnlessTakingRegistrations(event, at);

    if (place.holding(REGISTERED_STATUS)) {
      throw new RegistrationRefused(409, "already_registered", "You are already registered for this event.");
    }
    if (place.holding(WAITLISTED_STATUS)) {
      throw new RegistrationRefused(409, "already_waitlisted", "You are already on the waiting list for this event.");
    }
    offerFreedPlaces(transaction, event, place.records, at);
    const held = reservedPlaces(place.records.map((record) => record.data), at);
    if (place.taken + held < event.registration_capacity) {
      return { refused: new RegistrationRefused(409, "places_available", "A place is free, so register instead.") };
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

  // H7 AC2 — accept an offered place: the attendee becomes Registered, never without asking.
  // AC3 — only while the offer stands (48 hours, or until the event starts).
  const acceptInvitation = ({ eventId, attendeeId }) => act(async (transaction) => {
    const at = now();
    const place = await readPlace(transaction, eventId, attendeeId);
    const { event } = place;
    if (!event) throw new RegistrationRefused(404, "not_found", "That event could not be found.");
    const offered = place.holding(WAITLISTED_STATUS);
    const state = invitationState(offered?.data, at);
    if (state === "NONE") throw new RegistrationRefused(409, "not_invited", "You have not been offered a place for this event.");
    const closed = withdrawalRefusal(offered.data, event, at);
    if (closed) throw new RegistrationRefused(409, closed.reason, closed.message);
    if (state === "LAPSED") {
      // AC4 — they stay on the list; the place passes on, and that offer is committed.
      offerFreedPlaces(transaction, event, place.records, at);
      return { refused: new RegistrationRefused(409, "invitation_expired", "This invitation has expired. You are still on the waiting list.") };
    }

    transaction.update(offered.ref, { status: REGISTERED_STATUS, registered_at: serverTimestamp(), accepted_at: serverTimestamp() });
    const accepted = { status: REGISTERED_STATUS, registered_at: at, accepted_at: at };
    offerFreedPlaces(transaction, event, withChange(place.records, offered.id, accepted), at);
    return { registration: myRegistrationEntry({ ...offered.data, id: offered.id, ...accepted }, event, { now: at }) };
  });

  // H7 AC4 — decline an offered place: the attendee leaves the waiting list, and the place goes
  // to the next person in the same transaction.
  const declineInvitation = ({ eventId, attendeeId }) => act(async (transaction) => {
    const at = now();
    const place = await readPlace(transaction, eventId, attendeeId);
    const { event } = place;
    if (!event) throw new RegistrationRefused(404, "not_found", "That event could not be found.");
    const offered = place.holding(WAITLISTED_STATUS);
    if (invitationState(offered?.data, at) !== "ACTIVE") {
      throw new RegistrationRefused(409, "not_invited", "You have not been offered a place for this event.");
    }

    transaction.update(offered.ref, {
      status: WITHDRAWN_STATUS, withdrawn_from: WAITLISTED_STATUS, withdrawn_at: serverTimestamp(), declined_at: serverTimestamp()
    });
    const declined = { status: WITHDRAWN_STATUS, withdrawn_from: WAITLISTED_STATUS, withdrawn_at: at, declined_at: at };
    offerFreedPlaces(transaction, event, withChange(place.records, offered.id, declined), at);
    return { registration: myRegistrationEntry({ ...offered.data, id: offered.id, ...declined }, event, { now: at }) };
  });

  // H7 AC4 — hand a lapsed or unheld place on, with no other change. Run for a waiting attendee
  // when they open their lists, so an offer that lapsed overnight moves on without a timer.
  const offerPlaces = ({ eventId }) => act(async (transaction) => {
    const at = now();
    const place = await readPlace(transaction, eventId, "");
    if (!place.event) return { offered: [] };
    return { offered: offerFreedPlaces(transaction, place.event, place.records, at).map(({ id }) => id) };
  });

  return { register, withdraw, joinWaitlist, acceptInvitation, declineInvitation, offerPlaces };
};
