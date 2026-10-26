// C2 / SCRUM-103 — See the events I am responsible for.
//
// Pure helpers behind the coordinator's "Assigned events" list. No React and no
// Firebase, so each rule can be read next to its acceptance criterion and
// unit-tested with plain objects. The Firestore query in
// features/events/reviewApi.js already scopes the list to the signed-in
// coordinator (AC1) and firestore.rules is the authoritative boundary;
// onlyForCoordinator here is that same rule expressed purely, so AC1 has a test
// that needs no Firestore.

export const ALL_STATUSES = "ALL";
export const ACTIVE_EVENTS = "ACTIVE";

// AC1 — only the events whose coordinator_id is the signed-in coordinator.
export const onlyForCoordinator = (events = [], coordinatorId) =>
  events.filter((event) => event && event.coordinator_id === coordinatorId);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// AC2 — "time since last activity", derived from the event's last-updated time.
// Pure and deterministic given `now` (ms); returns a short human label.
export const timeSince = (fromIso, now = Date.now()) => {
  if (!fromIso) return "No activity yet";
  const then = new Date(fromIso).getTime();
  if (Number.isNaN(then)) return "No activity yet";
  const diff = Math.max(0, now - then);
  if (diff < MINUTE) return "Just now";
  if (diff < HOUR) {
    const n = Math.floor(diff / MINUTE);
    return `${n} minute${n === 1 ? "" : "s"} ago`;
  }
  if (diff < DAY) {
    const n = Math.floor(diff / HOUR);
    return `${n} hour${n === 1 ? "" : "s"} ago`;
  }
  const n = Math.floor(diff / DAY);
  return `${n} day${n === 1 ? "" : "s"} ago`;
};

// AC2 — one display row carrying the five columns the story asks for. organiser
// falls back to the id, then "Unknown", so the column is never blank even before
// names resolve. Last activity uses updated_at, then created_at.
export const assignedRow = (event = {}, now = Date.now()) => {
  const lastActivityAt = event.updated_at || event.created_at || null;
  return {
    id: event.id,
    name: event.name || "Untitled event",
    organiser: event.organiser_name || event.organiser_id || "Unknown",
    proposedDate: event.event_date || null,
    status: event.status || null,
    lastActivityAt,
    lastActivityLabel: timeSince(lastActivityAt, now),
    editable: event.editable !== false,
    replacementNeeded: event.replacement_needed === true
  };
};

// AC3 — filter by status. ALL (or empty) keeps everything.
export const filterByStatus = (rows = [], status = ALL_STATUSES) =>
  !status || status === ALL_STATUSES
    ? [...rows]
    : rows.filter((row) => row.status === status);

// AC3 — sort by proposed date. Rows with no date sort last in either direction,
// so an undated row never jumps to the top.
export const sortByProposedDate = (rows = [], direction = "asc") => {
  const dir = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (!a.proposedDate && !b.proposedDate) return 0;
    if (!a.proposedDate) return 1;
    if (!b.proposedDate) return -1;
    if (a.proposedDate < b.proposedDate) return -dir;
    if (a.proposedDate > b.proposedDate) return dir;
    return 0;
  });
};

// The distinct statuses present in the data, for the filter control — ALL first,
// the rest sorted for a stable dropdown.
export const statusOptions = (events = []) => [
  ALL_STATUSES,
  ...[...new Set(events.map((event) => event && event.status).filter(Boolean))].sort()
];

// The whole view in one call: scope to the coordinator when a coordinatorId is
// given (AC1), map to display rows (AC2), then filter by status and sort by
// proposed date (AC3). The screen passes events already scoped by reviewApi, so
// it may omit coordinatorId; the unit tests pass it to exercise AC1 directly.
export const buildAssignedView = (
  events = [],
  { coordinatorId, status = ALL_STATUSES, sort = "asc", now = Date.now() } = {}
) => {
  const scoped = coordinatorId ? onlyForCoordinator(events, coordinatorId) : events;
  const rows = scoped.map((event) => assignedRow(event, now));
  const filtered = status === ACTIVE_EVENTS
    ? rows.filter((row) => !["COMPLETED", "CANCELLED", "REJECTED"].includes(row.status))
    : filterByStatus(rows, status);
  return sortByProposedDate(filtered, sort);
};
