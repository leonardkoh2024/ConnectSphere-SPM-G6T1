// H4 / SCRUM-142 — what an attendee's own list says about each registration.
//
// The registration service runs these functions on the server (an attendee's browser
// cannot read `registrations` or `events`), so they are written as an .mjs module the
// backend imports unchanged. No React and no Firebase.

export const REGISTRATION_STATUS_LABELS = {
  REGISTERED: "Registered",
  WAITLISTED: "Waitlisted",
  WITHDRAWN: "Withdrawn",
  CANCELLED: "Cancelled"
};

const TONES = { REGISTERED: "positive", WAITLISTED: "warning", WITHDRAWN: "neutral", CANCELLED: "danger" };
export const registrationStatusTone = (status) => TONES[status] || "neutral";

const upper = (value) => String(value || "").toUpperCase();

// AC3 — cancelling an event (D4) leaves its registrations as they were, so the event's own
// status decides: any registration on a cancelled event reads Cancelled. A status this list
// does not know gives null, and the entry is left out.
export const registrationDisplayStatus = (registration, event) => {
  if (upper(event?.status) === "CANCELLED") return "CANCELLED";
  const status = upper(registration?.status);
  return REGISTRATION_STATUS_LABELS[status] ? status : null;
};

// A Firestore Timestamp, a Date or ISO text, as ISO text; null when there is none.
const toIso = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

// Only what an attendee is meant to read. The event's ids, reference, capacity and any
// cancellation reason stay on the server.
export const myRegistrationEntry = (registration, event, { venueNames = [] } = {}) => ({
  registration_id: registration.id || registration.registration_id,
  event_id: registration.event_id,
  name: event.name || "",
  description: event.description || "",
  event_date: event.event_date || null,
  start_time: event.start_time || null,
  end_time: event.end_time || null,
  venue_names: [...venueNames],
  status: registrationDisplayStatus(registration, event),
  registered_at: toIso(registration.registered_at),
  withdrawn_at: toIso(registration.withdrawn_at),
  waitlist_position: registration.waitlist_position ?? null
});

const startsAt = (entry) => `${entry.event_date || ""}T${entry.start_time || ""}`;

// `pairs` holds each registration with its event (null when the event is gone).
export const listMyRegistrations = (pairs, { venueNamesByEvent = {} } = {}) =>
  pairs
    .filter(({ registration, event }) => event && registrationDisplayStatus(registration, event))
    .map(({ registration, event }) => myRegistrationEntry(registration, event, { venueNames: venueNamesByEvent[registration.event_id] || [] }))
    .sort((left, right) => startsAt(left).localeCompare(startsAt(right)) || left.name.localeCompare(right.name));
