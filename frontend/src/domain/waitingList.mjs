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
