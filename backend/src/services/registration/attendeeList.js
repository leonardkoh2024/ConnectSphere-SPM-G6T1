// H8 / SCRUM-146 — the organiser's registration list for one event.
//
// Why this is a service and not a browser read: an organiser has no Firestore read on
// `registrations` (only the event's current coordinator does) and none on attendees' profiles,
// so names and contact details can only reach an organiser through here, after the event has
// been checked to be theirs. The Admin SDK is not bound by firestore.rules, so this check IS the
// access control; every refusal below happens before a registration or a profile is read.
//
// The people coming are the REGISTERED ones: they are listed with name, email, mobile number and
// registration time. Waitlisted and withdrawn people appear only as counts, and their profiles
// are never read.

const REGISTERED = "REGISTERED";
const WAITLISTED = "WAITLISTED";
const WITHDRAWN = "WITHDRAWN";

// One answer for "not yours" and "no such event", so an organiser cannot probe for event ids.
const NOT_YOURS = "You can view the registration list for your own events only.";

class ListError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "ListError";
    this.statusCode = statusCode;
  }
}

// A Firestore Timestamp, a Date or text, as an ISO string; null when there is none.
const toIso = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
};

// The attendee is named by attendee_id (H1's create rule); user_id is accepted too, as in D4's notice rule.
const attendeeOf = (registration) => registration.attendee_id || registration.user_id || null;

export const createRegistrationList = ({ firestore }) => {
  const load = async ({ eventId, userId }) => {
    const event = await firestore.collection("events").doc(eventId).get();
    if (!event.exists || event.data().organiser_id !== userId) throw new ListError(403, NOT_YOURS);

    const snapshot = await firestore.collection("registrations").where("event_id", "==", eventId).get();
    const counts = { registered: 0, waitlisted: 0, withdrawn: 0 };
    const registered = [];
    for (const item of snapshot.docs) {
      const registration = item.data();
      if (registration.status === REGISTERED) {
        counts.registered += 1;
        registered.push({ id: item.id, registration });
      } else if (registration.status === WAITLISTED) counts.waitlisted += 1;
      else if (registration.status === WITHDRAWN) counts.withdrawn += 1;
    }

    const ids = [...new Set(registered.map(({ registration }) => attendeeOf(registration)).filter(Boolean))];
    const profiles = {};
    await Promise.all(ids.map(async (id) => {
      const profile = await firestore.collection("users").doc(id).get();
      profiles[id] = profile.exists ? profile.data() : null;
    }));

    const attendees = registered.map(({ id, registration }) => {
      const attendeeId = attendeeOf(registration);
      const profile = profiles[attendeeId] || {};
      return {
        registration_id: id,
        attendee_id: attendeeId,
        name: profile.name ?? null,
        email: profile.email ?? null,
        mobile_number: profile.mobile_number ?? null,
        registered_at: toIso(registration.registered_at)
      };
    }).sort((a, b) => {
      if (a.registered_at === b.registered_at) return 0;
      if (a.registered_at === null) return 1;
      if (b.registered_at === null) return -1;
      return a.registered_at < b.registered_at ? -1 : 1;
    });

    return { event_id: eventId, counts, attendees };
  };

  return { load };
};
