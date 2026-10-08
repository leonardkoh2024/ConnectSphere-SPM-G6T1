// J1 / SCRUM-150 — the rules of the per-user inbox. Who receives a notification
// (AC2) is decided where it is written and enforced in firestore.rules; this
// module only orders, counts and labels what a user already has. No React and no
// Firebase, like the rest of domain/.

import { ROLES } from "./roles";

// The `type` each writer stores, in words. A type nobody has named yet still
// reads as something rather than as a constant.
export const NOTIFICATION_TYPE_LABEL = {
  CLARIFICATION_REQUESTED: "Clarification requested",
  CLARIFICATION_RESPONDED: "Clarification answered",
  EVENT_REJECTED: "Request rejected",
  COORDINATOR_REASSIGNED: "Coordinator reassigned"
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
