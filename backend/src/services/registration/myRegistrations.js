// H4 / SCRUM-142 — the signed-in attendee's own registrations, each with its event.
//
// Why this is a service and not a browser read: an attendee has no Firestore read on
// `registrations` or `events` (A4/A5), and an event carries far more than an attendee should
// see. So only the caller's registrations are queried, their events read with the Admin SDK,
// and each entry cut down by the shared rules in frontend/src/domain/myRegistrations.mjs.
// The attendee is named by `attendee_id`, as H3 writes it.

import { listMyRegistrations } from "../../../../frontend/src/domain/myRegistrations.mjs";

// H6 AC2 — a waitlisted entry carries its live position, from `waitlistPositionFor`.
export const createMyRegistrations = ({ firestore, venueNamesFor, now = () => new Date(), waitlistPositionFor = async () => null }) => {
  const load = async ({ attendeeId }) => {
    const snapshot = await firestore.collection("registrations").where("attendee_id", "==", attendeeId).get();
    const registrations = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

    const eventIds = [...new Set(registrations.map((registration) => registration.event_id).filter(Boolean))];
    const events = {};
    const venueNamesByEvent = {};
    await Promise.all(eventIds.map(async (eventId) => {
      const event = await firestore.collection("events").doc(eventId).get();
      if (!event.exists) return;
      events[eventId] = { id: eventId, ...event.data() };
      venueNamesByEvent[eventId] = await venueNamesFor(eventId);
    }));

    const pairs = registrations.map((registration) => ({ registration, event: events[registration.event_id] || null }));
    const entries = listMyRegistrations(pairs, { venueNamesByEvent, now: now() });
    return {
      registrations: await Promise.all(entries.map(async (entry) => (entry.status === "WAITLISTED"
        ? { ...entry, waitlist_position: await waitlistPositionFor(entry.event_id, entry.registration_id) }
        : entry)))
    };
  };

  return { load };
};
