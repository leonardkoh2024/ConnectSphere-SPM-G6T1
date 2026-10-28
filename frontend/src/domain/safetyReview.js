// A7 / SCRUM-170 — the Safety Officer's Operational Safety Check, as plain rules.
// The queue (AC2), the facts a review shows (AC3) and the outcomes it may record
// (AC4) are decided here; features/safety reads and writes Firestore, and
// firestore.rules is the server-side boundary (AC6). No React, no Firebase.

import { EVENT_STATUS, isCurrentCoordinator } from "./eventReview";
import { ROLES } from "./roles";

export const SAFETY_OUTCOME = {
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  REQUEST_CHANGES: "REQUEST_CHANGES"
};

export const SAFETY_OUTCOME_LABEL = {
  [SAFETY_OUTCOME.APPROVE]: "Approve",
  [SAFETY_OUTCOME.REJECT]: "Reject",
  [SAFETY_OUTCOME.REQUEST_CHANGES]: "Request changes"
};

// AC3 — a fact nobody has recorded says so, rather than leaving a gap the
// Safety Officer might read as "nothing to worry about".
export const NOT_RECORDED = "Not recorded";
export const shownOrNotRecorded = (value) => String(value ?? "").trim() || NOT_RECORDED;

const isSafetyOfficer = (role) => role === ROLES.SAFETY_OFFICER;

// AC2 / L2 AC1 — the events awaiting a check, the longest-waiting first. L1
// (send for safety check) is to stamp safety_review_requested_at; until it
// does, the last change to the event stands in for it.
const waitingSince = (event) => String(event.safety_review_requested_at || event.updated_at || "");
export const safetyQueue = (events = []) =>
  (events || [])
    .filter((event) => event.status === EVENT_STATUS.SAFETY_REVIEW)
    .sort((a, b) => waitingSince(a).localeCompare(waitingSince(b)));

// AC4 / AC6 — only the Safety Officer, and only while the event is in Safety
// Review (L3 AC5). The same boundary as safetyOutcomeUpdate in firestore.rules.
export const canRecordSafetyOutcome = (event, role) =>
  isSafetyOfficer(role) && event?.status === EVENT_STATUS.SAFETY_REVIEW;

// AC4 / L3 AC2 — Reject and Request changes must say what the concern is.
export const outcomeNeedsComment = (outcome) =>
  outcome === SAFETY_OUTCOME.REJECT || outcome === SAFETY_OUTCOME.REQUEST_CHANGES;

export const validateSafetyOutcome = ({ outcome, comment } = {}) => {
  if (!SAFETY_OUTCOME[outcome]) return "Choose an outcome: Approve, Reject or Request changes.";
  if (outcomeNeedsComment(outcome) && !String(comment || "").trim()) {
    return "A comment explaining the concern is required to reject or request changes.";
  }
  return null;
};

// L3 AC4 / L4 AC1 — where each outcome leaves the event.
export const safetyOutcomeStatus = (outcome) => {
  if (outcome === SAFETY_OUTCOME.APPROVE) return EVENT_STATUS.CONFIRMED;
  if (outcomeNeedsComment(outcome)) return EVENT_STATUS.PLANNING;
  return null;
};

// AC3 / L2 AC2 — only bookings that will actually be used are reviewed.
const INACTIVE_BOOKING_STATUSES = new Set(["RELEASED", "REPLACED", "WITHDRAWN", "CANCELLED", "EXPIRED"]);
export const activeBookings = (bookings = []) =>
  (bookings || []).filter((booking) => {
    const status = String(booking.status || "").toUpperCase();
    if (status === "REJECTED") return booking.requires_re_request === true || booking.replacement_needed === true;
    return !INACTIVE_BOOKING_STATUSES.has(status);
  });

const bookingNeedsAction = (booking = {}) =>
  String(booking.status || "").toUpperCase() !== "APPROVED"
  || booking.replacement_needed === true;

// firestore.rules confirms an event only when it points at an approved venue
// booking (safetyOutcomeUpdate), so an approval without one is refused here
// with a reason rather than by Firestore with none. An event may book several
// venues (F12), and it is confirmed only once every active one is approved —
// a rule Firestore cannot check across documents, so it is checked here.
export const safetyApprovalBlocker = (event, bookings = []) => {
  if (!event?.approved_venue_booking_id) return "This event has no approved venue booking, so it cannot be confirmed.";
  const waiting = activeBookings(bookings).filter(bookingNeedsAction);
  if (!waiting.length) return null;
  const names = waiting.map((booking) => booking.booking_label || booking.venue_id || booking.booking_id).join(", ");
  return `Every active venue booking must be approved before the event can be confirmed. Not yet approved: ${names}.`;
};

// AC3 — expected attendance against the venue's capacity. A capacity nobody
// recorded is shown as not recorded, never as a breach.
export const capacityFact = ({ attendance, capacity }) => {
  const people = Number(attendance) > 0 ? Number(attendance) : null;
  const limit = Number(capacity) > 0 ? Number(capacity) : null;
  return { attendance: people, capacity: limit, exceeds: Boolean(people && limit && people > limit) };
};

// AC4 — the event's history and its coordinator's and organiser's inbox use the same names.
const NOTIFICATION_TYPE = {
  [SAFETY_OUTCOME.APPROVE]: "SAFETY_CHECK_APPROVED",
  [SAFETY_OUTCOME.REJECT]: "SAFETY_CHECK_REJECTED",
  [SAFETY_OUTCOME.REQUEST_CHANGES]: "SAFETY_CHANGES_REQUESTED"
};
export const safetyNotificationType = (outcome) => NOTIFICATION_TYPE[outcome] || null;

export const safetyOutcomeMessage = ({ eventName, outcome, comment }) => {
  const name = eventName || "Your event";
  const why = String(comment || "").trim();
  const withComment = (text) => `${text}${why ? ` Comment: ${why}` : ""}`;
  if (outcome === SAFETY_OUTCOME.APPROVE) return `${name} passed its safety check and is now Confirmed.`;
  if (outcome === SAFETY_OUTCOME.REJECT) return withComment(`${name} failed its safety check and is back in Planning.`);
  return withComment(`${name} needs changes before it can pass its safety check and is back in Planning.`);
};

// AC3 — equipment placement and crowd movement have no other source, so the
// event's coordinator records them while planning, for the Safety Officer to
// read. Same statuses and limit as coordinatorSafetyNotesUpdate in firestore.rules.
export const PLANNING_NOTE_FIELDS = ["equipment_placement", "crowd_movement"];
export const PLANNING_NOTE_MAX = 2000;
const PLANNING_NOTE_STATUSES = new Set([EVENT_STATUS.APPROVED, EVENT_STATUS.PLANNING]);

export const planningNotesOpen = (status) => PLANNING_NOTE_STATUSES.has(status);

export const canEditPlanningNotes = (event, userId) =>
  isCurrentCoordinator(event, userId) && planningNotesOpen(event.status);

export const cleanPlanningNotes = (values = {}) =>
  Object.fromEntries(PLANNING_NOTE_FIELDS.map((field) => [field, String(values?.[field] ?? "").trim()]));

export const validatePlanningNotes = (values = {}) =>
  PLANNING_NOTE_FIELDS.some((field) => String(values?.[field] ?? "").length > PLANNING_NOTE_MAX)
    ? `Each safety planning note must be ${PLANNING_NOTE_MAX} characters or fewer.`
    : null;
