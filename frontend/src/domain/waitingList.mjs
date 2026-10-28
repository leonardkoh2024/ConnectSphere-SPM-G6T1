// H6 / SCRUM-144 — the order of an event's waiting list: first come, first served (customer
// Q&A Session 1, Q18). Positions are worked out from these records each time they are read,
// never stored, so someone ahead leaving moves everyone behind them up at once.
//
// The registration service runs these functions, so this is an .mjs module the backend
// imports unchanged. No React and no Firebase.

const WAITLISTED = "WAITLISTED";

const instant = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const date = typeof value.toDate === "function" ? value.toDate() : value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
};

// When the attendee joined. Older records (the mock data's) have no waitlisted_at, so their
// registration time stands in, and then the position they were stored with.
const joinedAt = (record) => instant(record.waitlisted_at) ?? instant(record.registered_at);
const storedPosition = (record) => (Number.isFinite(Number(record.waitlist_position)) && record.waitlist_position !== null ? Number(record.waitlist_position) : Infinity);
const idOf = (record) => String(record.id || record.registration_id || "");

// Every Waitlisted record, earliest first. Ties are settled by record id so the order is the
// same on every read.
export const waitlistOrder = (records = []) =>
  records
    .filter((record) => String(record?.status || "").toUpperCase() === WAITLISTED)
    .sort((left, right) => {
      const a = joinedAt(left);
      const b = joinedAt(right);
      if (a !== b) return (a ?? Infinity) - (b ?? Infinity);
      const stored = storedPosition(left) - storedPosition(right);
      if (stored) return stored;
      return idOf(left).localeCompare(idOf(right));
    });

// AC2 — the attendee's place in the queue (1 is next), or null when that record is not waiting.
export const waitlistPosition = (records, recordId) => {
  const index = waitlistOrder(records).findIndex((record) => idOf(record) === recordId);
  return index === -1 ? null : index + 1;
};

// ---- H7 / SCRUM-145 — Be invited to take a freed place ----------------------------------
//
// A freed place is offered to the first person in the queue who is not already holding an
// offer. The offer is written on their record (`invited_at`, `invitation_expires_at`), which
// stays WAITLISTED, so they keep their position. Accepting registers them; declining takes them
// off the list. An offer that lapses leaves them on the list (AC4), the place passes to the
// next person, and they are offered again only when another place frees after the lapse
// (decided 28 Oct 2026). The next offer is made on the next action on the event, not by a timer.

// AC3 — the backlog's 48 hours. Customer Q&A Session 1 left the lead time to us but asked to
// confirm the number: a Session 3 question.
export const INVITATION_HOURS = 48;

const OPEN_STATUSES = ["APPROVED", "PLANNING", "SAFETY_REVIEW", "CONFIRMED"];
const upper = (value) => String(value || "").toUpperCase();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const eventStart = (event) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(event?.event_date || "")) || !/^\d{2}:\d{2}$/.test(String(event?.start_time || ""))) return null;
  return instant(`${event.event_date}T${event.start_time}:00+08:00`);
};

// AC3 — 48 hours from now, or the event's start if that comes first; null once it has started.
export const invitationExpiry = (event, now = new Date()) => {
  const start = eventStart(event);
  if (start === null || now.getTime() >= start) return null;
  return new Date(Math.min(now.getTime() + INVITATION_HOURS * 3600000, start));
};

// NONE, ACTIVE (it can be accepted) or LAPSED (it ran out). Only a WAITLISTED record holds one.
export const invitationState = (record, now = new Date()) => {
  if (upper(record?.status) !== WAITLISTED) return "NONE";
  const expires = instant(record.invitation_expires_at);
  if (expires === null) return "NONE";
  return now.getTime() < expires ? "ACTIVE" : "LAPSED";
};

// Places held for attendees with an offer they can still accept.
export const reservedPlaces = (records = [], now = new Date()) =>
  records.filter((record) => invitationState(record, now) === "ACTIVE").length;

// When a Registered place was last given up: the "next place that frees" a lapsed attendee
// waits for. A withdrawal records which status it left (`withdrawn_from`).
const lastPlaceFreedAt = (records) =>
  records
    .filter((record) => upper(record.status) === "WITHDRAWN" && upper(record.withdrawn_from) === "REGISTERED")
    .map((record) => instant(record.withdrawn_at))
    .filter((time) => time !== null)
    .reduce((latest, time) => Math.max(latest, time), -Infinity);

// AC1, AC4 — who is to be offered a place now, and until when: as many people as there are
// places neither taken nor held, in queue order, skipping anyone holding an offer and anyone
// whose offer lapsed with no place freed since. Nobody once the event has started or stopped
// taking registrations.
export const invitationsToIssue = ({ event, records = [], now = new Date() }) => {
  if (!event || event.registration_required !== true || !OPEN_STATUSES.includes(upper(event.status))) return [];
  const capacity = event.registration_capacity;
  if (!Number.isInteger(capacity) || capacity < 1) return [];
  const expires = invitationExpiry(event, now);
  if (!expires) return [];

  const taken = records.filter((record) => upper(record.status) === "REGISTERED").length;
  const open = capacity - taken - reservedPlaces(records, now);
  if (open <= 0) return [];

  const freedAt = lastPlaceFreedAt(records);
  return waitlistOrder(records)
    .filter((record) => {
      const state = invitationState(record, now);
      return state === "NONE" || (state === "LAPSED" && freedAt > instant(record.invitation_expires_at));
    })
    .slice(0, open)
    .map((record) => ({ id: idOf(record), record, expires_at: expires }));
};

// The invited attendee's notice: which event, and until when the place is held (Singapore time).
export const placeOfferedMessage = ({ eventName, expiresAt }) => {
  const local = new Date(new Date(expiresAt).getTime() + 8 * 3600000);
  const until = `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}, ${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
  return `A place has opened at ${eventName || "your event"}. Accept it in My registrations by ${until}, or it will be offered to the next person on the waiting list.`;
};
