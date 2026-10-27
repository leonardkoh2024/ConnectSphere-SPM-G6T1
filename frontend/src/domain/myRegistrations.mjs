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

// H5 / SCRUM-143 — an event is still to come until it starts (Singapore time), and only
// while it is running: a completed, cancelled or rejected event has nothing to attend.
const ENDED_STATUSES = ["COMPLETED", "CANCELLED", "REJECTED"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

const eventStart = (event) => {
  if (!DATE.test(String(event?.event_date || "")) || !TIME.test(String(event?.start_time || ""))) return null;
  const start = new Date(`${event.event_date}T${event.start_time}:00+08:00`);
  return Number.isNaN(start.getTime()) ? null : start;
};

const isUpcoming = (event, now) => {
  if (!event || ENDED_STATUSES.includes(upper(event.status))) return false;
  const start = eventStart(event);
  return Boolean(start) && now < start;
};

// AC2, AC6 — why this attendee cannot withdraw now, or null when they can. Only a Registered
// place can be withdrawn; a waitlisted one leaves the list through H6/H7, not here. There is
// no deadline before the start (release 1 has no change deadlines).
export const withdrawalRefusal = (registration, event, now = new Date()) => {
  if (!event) return { reason: "not_found", message: "That event could not be found." };
  if (upper(registration?.status) !== "REGISTERED") {
    return { reason: "not_registered", message: "You are not registered for this event." };
  }
  if (ENDED_STATUSES.includes(upper(event.status))) {
    return { reason: "event_closed", message: "This event is no longer running, so there is nothing to withdraw from." };
  }
  const start = eventStart(event);
  if (!start || now >= start) return { reason: "event_started", message: "This event has already started." };
  return null;
};

// A Firestore Timestamp, a Date or ISO text, as ISO text; null when there is none.
const toIso = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

// Only what an attendee is meant to read. The event's ids, reference, capacity and any
// cancellation reason stay on the server. `active` (H5 AC1, AC5) is a Registered or
// Waitlisted place on an event still to come; `can_withdraw` (H5 AC2, AC6) says whether
// Withdraw may be offered.
export const myRegistrationEntry = (registration, event, { venueNames = [], now = new Date() } = {}) => ({
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
  waitlist_position: registration.waitlist_position ?? null,
  active: ["REGISTERED", "WAITLISTED"].includes(registrationDisplayStatus(registration, event)) && isUpcoming(event, now),
  can_withdraw: withdrawalRefusal(registration, event, now) === null
});

const startsAt = (entry) => `${entry.event_date || ""}T${entry.start_time || ""}`;

// `pairs` holds each registration with its event (null when the event is gone).
export const listMyRegistrations = (pairs, { venueNamesByEvent = {}, now = new Date() } = {}) =>
  pairs
    .filter(({ registration, event }) => event && registrationDisplayStatus(registration, event))
    .map(({ registration, event }) => myRegistrationEntry(registration, event, { venueNames: venueNamesByEvent[registration.event_id] || [], now }))
    .sort((left, right) => startsAt(left).localeCompare(startsAt(right)) || left.name.localeCompare(right.name));
