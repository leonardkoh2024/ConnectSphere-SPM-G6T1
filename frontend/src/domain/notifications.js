// J1 / SCRUM-150 — the rules of the per-user inbox. Who receives a notification
// (AC2) is decided where it is written and enforced in firestore.rules; this
// module only orders, counts and labels what a user already has. No React and no
// Firebase, like the rest of domain/.

import { ROLES } from "./roles";
import { singaporeDateTime } from "./venueHolds";

// The `type` each writer stores, in words. A type nobody has named yet still
// reads as something rather than as a constant.
export const NOTIFICATION_TYPE_LABEL = {
  CLARIFICATION_REQUESTED: "Clarification requested",
  CLARIFICATION_RESPONDED: "Clarification answered",
  EVENT_REJECTED: "Request rejected",
  COORDINATOR_REASSIGNED: "Coordinator reassigned",
  // J2 / SCRUM-151 — the organiser's progress notices, each in its own words.
  EVENT_SUBMITTED: "Request received",
  UNASSIGNED_EVENT: "Waiting for a coordinator",
  UNASSIGNED_EVENT_CANCELLED: "Unassigned request cancelled",
  COORDINATOR_ASSIGNED: "Coordinator assigned",
  EVENT_APPROVED: "Request approved",
  SAFETY_CHECK_APPROVED: "Event confirmed",
  EVENT_CANCELLED: "Event cancelled",
  VENUE_BOOKING_REQUESTED: "Booking request raised",
  VENUE_BOOKING_REQUEST: "Booking request raised",
  VENUE_BOOKING_RAISED: "Booking request raised",
  VENUE_DETAILS_UPDATED: "Venue details updated",
  VENUE_DETAILS_CHANGED: "Venue details updated",
  VENUE_CHANGED: "Venue details updated",
  VENUE_CHANGE: "Venue details updated",
  VENUE_BOOKING_APPROVED: "Venue booking approved",
  VENUE_BOOKING_REJECTED: "Venue booking rejected",
  VENUE_BOOKING_HELD: "Venue held",
  EQUIPMENT_ARRANGED: "Equipment reserved",
  // J5 / SCRUM-154 — what Technical Support are told, written by the equipment service.
  EQUIPMENT_REQUEST_RAISED: "Equipment request raised",
  EQUIPMENT_REQUEST_AMENDED: "Equipment request amended",
  ON_SITE_SUPPORT_REQUIRED: "On-site support needed",
  ON_SITE_SUPPORT_CHANGED: "On-site support changed",
  EQUIPMENT_UNABLE_TO_FULFIL: "Equipment unavailable"
};

export const notificationTypeLabel = (type) => NOTIFICATION_TYPE_LABEL[type] || "Update";

const timeOf = (notification) => {
  const time = Date.parse(notification.created_at || "");
  return Number.isNaN(time) ? -Infinity : time;
};

// Newest first; one with no timestamp yet (a write still pending) sorts last
// rather than jumping about.
export const newestFirst = (notifications) => [...notifications].sort((a, b) => timeOf(b) - timeOf(a));

export const isUnread = (notification) => notification.is_read !== true;

export const unreadCount = (notifications) => notifications.filter(isUnread).length;

// AC3 — the badge on the inbox. Nothing unread means no badge at all, not a 0.
export const badgeText = (count) => (count > 0 ? (count > 99 ? "99+" : String(count)) : null);

// AC1 — the related event, by name with its reference, falling back to whichever
// of the two exists. `null` when the event cannot be read (deleted, or no longer
// related to this user), so the inbox can say so rather than show an id.
export const eventLabel = (event) => {
  if (!event) return null;
  const name = event.name || "";
  const reference = event.reference_no || "";
  if (name && reference) return `${name} (${reference})`;
  return name || reference || "Untitled event";
};

// Where "View" on a notification takes each role: the screen that role already
// uses to open one event. A role with no such screen yet gets no View button
// rather than one that leads nowhere.
export const EVENT_VIEW_SCREEN = {
  [ROLES.ORGANISER]: "New event request",
  [ROLES.COORDINATOR]: "Assigned events"
};

export const eventViewScreen = (role) => EVENT_VIEW_SCREEN[role] || null;

// J2 / SCRUM-151 AC1 — the seven moves of a request that the organiser is told about,
// in the order they happen. "Confirmed" is the safety check passing (A7); "cancelled"
// is told by D4 (Cancel an event), which is not built yet.
export const ORGANISER_PROGRESS_TYPES = [
  "EVENT_SUBMITTED", "COORDINATOR_ASSIGNED", "CLARIFICATION_REQUESTED", "EVENT_APPROVED",
  "EVENT_REJECTED", "SAFETY_CHECK_APPROVED", "EVENT_CANCELLED"
];

const named = (eventName) => eventName || "Your event";
const trimmed = (value) => String(value || "").trim();

// AC2 — names the event and the change.
export const eventSubmittedMessage = ({ eventName } = {}) =>
  `${named(eventName)} was submitted and is waiting for a coordinator.`;

// AC2 + AC3 — an approval or a rejection names the event and carries its reason.
export const eventDecisionMessage = ({ eventName, approved, reason } = {}) =>
  `${named(eventName)} was ${approved ? "approved" : "rejected"} — ${trimmed(reason)}`;

// AC3 — neither decision can be sent without a reason; the same words are used by the
// screen and by the adapter, so the two cannot disagree.
export const decisionReasonProblem = (decision, reason) => {
  if (trimmed(reason)) return null;
  return decision === "approve" ? "Approval reason is required." : "Rejection reason is required.";
};

// AC1 — used by D4 (Cancel an event) when it is built; the guard test in
// notifications.test.js fails until a cancel writes this notice.
export const eventCancelledMessage = ({ eventName, reason } = {}) => {
  const why = trimmed(reason);
  return `${named(eventName)} was cancelled${why ? ` — ${why}` : "."}`;
};

// J6 / SCRUM-155 — the outcome of a coordinator's own booking or equipment
// request. Each is written in the same transaction as the decision it reports,
// so the coordinator never has to poll Venue bookings and Equipment requests.
// F15 AC6 — a hold is not an outcome, but its notice opens the booking the same way.
export const VENUE_BOOKING_OUTCOMES = ["VENUE_BOOKING_APPROVED", "VENUE_BOOKING_REJECTED", "VENUE_BOOKING_HELD"];
export const EQUIPMENT_OUTCOMES = ["EQUIPMENT_ARRANGED", "EQUIPMENT_UNABLE_TO_FULFIL"];

// AC1 — approved or rejected, and on rejection the reason.
export const venueBookingOutcomeMessage = ({ eventName, venueName, approved, reason }) => {
  const subject = `${eventName || "Your event"}: the booking for ${venueName || "the venue"}`;
  if (approved) return `${subject} was approved.`;
  const why = String(reason || "").trim();
  return `${subject} was rejected.${why ? ` Reason: ${why}` : ""}`;
};

// F15 AC6 — the coordinator is told a venue is held for them, and until when.
export const venueHoldPlacedMessage = ({ eventName, venueName, expiresAt }) =>
  `${eventName || "Your event"}: ${venueName || "the venue"} is held for this event until ${singaporeDateTime(expiresAt)}.`;

// AC2 / AC4 — View on an outcome opens that booking or that equipment request,
// where its date, time and quantities can be checked, rather than the event.
export const notificationViewScreen = (role, notification = {}) => {
  if (role === ROLES.COORDINATOR && VENUE_BOOKING_OUTCOMES.includes(notification.type) && notification.booking_id) return "Venue bookings";
  if (role === ROLES.COORDINATOR && EQUIPMENT_OUTCOMES.includes(notification.type)) return "Equipment requests";
  return eventViewScreen(role);
};
