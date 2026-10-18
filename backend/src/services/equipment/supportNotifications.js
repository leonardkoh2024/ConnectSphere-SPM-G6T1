// J5 / SCRUM-154 — Technical Support are told when equipment work arrives or changes.
//
// "Responsible for the event" is every active Technical Support member: nobody is
// attached to an event, and all of them work one shared queue. A coordinator's
// browser cannot list Technical Support accounts (firestore.rules keeps their profiles
// closed), so the equipment service writes these notices with the Admin SDK, as it
// does for J6's equipment outcomes. After saving a request the coordinator's browser
// asks for this; the service compares the saved request with what it last told
// Technical Support (`equipment_request_notices/{eventId}`) and speaks only if they
// differ, so asking twice sends once.

import {
  EquipmentForbiddenError,
  EquipmentNotFoundError,
  EquipmentValidationError
} from "./availability.js";
import { eventNameOf } from "./outcomeNotifications.js";

const TECHNICAL_SUPPORT_ROLE = "TECHNICAL_SUPPORT_STAFF";
const TERMINAL_EVENT_STATUSES = ["COMPLETED", "CANCELLED", "REJECTED"];

export const SUPPORT_NOTICE_TYPES = {
  RAISED: "EQUIPMENT_REQUEST_RAISED",
  AMENDED: "EQUIPMENT_REQUEST_AMENDED",
  ON_SITE_NEEDED: "ON_SITE_SUPPORT_REQUIRED",
  ON_SITE_CHANGED: "ON_SITE_SUPPORT_CHANGED"
};

const typeWords = (type) => String(type || "equipment").replaceAll("_", " ").toLowerCase();
const summary = (lines = []) => lines.map((line) => `${Number(line.quantity)} × ${typeWords(line.equipment_type)}`).join(", ");
const named = (eventName) => eventName || "An event";
const trimmed = (value) => String(value || "").trim();

// ---- what it says: each names the event and the change -------------------------------

export const raisedMessage = ({ eventName, lines }) =>
  `${named(eventName)}: an equipment request was raised. Requested: ${summary(lines)}.`;

export const amendedMessage = ({ eventName, lines }) =>
  `${named(eventName)}: the equipment request was amended. Now requested: ${summary(lines)}.`;

export const onSiteNeededMessage = ({ eventName, details }) =>
  `${named(eventName)}: on-site support is needed. ${trimmed(details)}`;

export const onSiteChangedMessage = ({ eventName, needed, details }) => needed
  ? `${named(eventName)}: the on-site support needed has changed. ${trimmed(details)}`
  : `${named(eventName)}: on-site support is no longer needed.`;

// ---- what changed ------------------------------------------------------------------------

// The lines as Technical Support see them: type, quantity and requirement. Whitespace
// around a requirement does not make an amendment.
const linesSignature = (lines = []) => JSON.stringify(lines.map((line) => [
  String(line.equipment_type || ""),
  Number(line.quantity),
  trimmed(line.technical_requirements)
]));

// What Technical Support have been told about a request, kept so the next save is
// compared with it rather than with the request's earlier self.
export const noticeState = (request) => {
  const onSite = Boolean(request.on_site_support);
  return {
    lines_signature: linesSignature(request.lines),
    on_site_support: onSite,
    on_site_support_details: onSite ? trimmed(request.on_site_support_details) : ""
  };
};

// The notice types to send, in the order they read: the request first, then on-site
// support. An empty list means nothing changed.
export const supportNoticeChanges = ({ previous, current }) => {
  const now = noticeState(current);
  if (!previous) {
    return [SUPPORT_NOTICE_TYPES.RAISED, ...(now.on_site_support ? [SUPPORT_NOTICE_TYPES.ON_SITE_NEEDED] : [])];
  }
  const changes = [];
  if (previous.lines_signature !== now.lines_signature) changes.push(SUPPORT_NOTICE_TYPES.AMENDED);
  if (!previous.on_site_support && now.on_site_support) {
    changes.push(SUPPORT_NOTICE_TYPES.ON_SITE_NEEDED);
  } else if (previous.on_site_support
    && (!now.on_site_support || previous.on_site_support_details !== now.on_site_support_details)) {
    changes.push(SUPPORT_NOTICE_TYPES.ON_SITE_CHANGED);
  }
  return changes;
};

const messageFor = (type, { eventName, request }) => {
  const state = noticeState(request);
  if (type === SUPPORT_NOTICE_TYPES.RAISED) return raisedMessage({ eventName, lines: request.lines });
  if (type === SUPPORT_NOTICE_TYPES.AMENDED) return amendedMessage({ eventName, lines: request.lines });
  if (type === SUPPORT_NOTICE_TYPES.ON_SITE_NEEDED) {
    return onSiteNeededMessage({ eventName, details: state.on_site_support_details });
  }
  return onSiteChangedMessage({
    eventName, needed: state.on_site_support, details: state.on_site_support_details
  });
};

// ---- who is told --------------------------------------------------------------------------

export const technicalSupportRecipients = (userDocuments) => userDocuments
  .filter((item) => item.data().role === TECHNICAL_SUPPORT_ROLE && item.data().is_active !== false)
  .map((item) => item.id);

// ---- the service ---------------------------------------------------------------------------

export const createSupportNotifier = ({ firestore, serverTimestamp }) => {
  const notifyTechnicalSupport = async ({ eventId, userId }) => {
    if (typeof eventId !== "string" || !eventId.trim()) {
      throw new EquipmentValidationError("Choose an event before notifying Technical Support.");
    }
    const requestRef = firestore.collection("equipment_requests").doc(eventId);
    const eventRef = firestore.collection("events").doc(eventId);
    const noticeRef = firestore.collection("equipment_request_notices").doc(eventId);

    return firestore.runTransaction(async (transaction) => {
      const [requestSnapshot, eventSnapshot, noticeSnapshot, usersSnapshot] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(eventRef),
        transaction.get(noticeRef),
        transaction.get(firestore.collection("users").where("role", "==", TECHNICAL_SUPPORT_ROLE))
      ]);
      if (!requestSnapshot.exists) throw new EquipmentNotFoundError("Equipment request not found.");
      if (!eventSnapshot.exists) throw new EquipmentNotFoundError("Event not found.");
      const event = eventSnapshot.data();
      if (event.coordinator_id !== userId) {
        throw new EquipmentForbiddenError("Only the event's coordinator can notify Technical Support about this request.");
      }
      const nothing = { eventId, sent: 0, types: [] };
      if (TERMINAL_EVENT_STATUSES.includes(event.status)) return nothing;

      const request = requestSnapshot.data();
      const types = supportNoticeChanges({
        previous: noticeSnapshot.exists ? noticeSnapshot.data() : null,
        current: request
      });
      const recipients = technicalSupportRecipients(usersSnapshot.docs);
      // Nothing changed, or nobody active to tell: write nothing, so the first member
      // to join is still told next time.
      if (!types.length || !recipients.length) return nothing;

      const now = serverTimestamp();
      const eventName = eventNameOf(eventSnapshot);
      let sent = 0;
      types.forEach((type) => {
        const message = messageFor(type, { eventName, request });
        recipients.forEach((recipientId) => {
          const notificationRef = firestore.collection("notifications").doc();
          transaction.create(notificationRef, {
            notification_id: notificationRef.id,
            user_id: recipientId,
            event_id: eventId,
            type,
            message,
            is_read: false,
            created_at: now,
            read_at: null
          });
          sent += 1;
        });
      });
      transaction.set(noticeRef, { event_id: eventId, ...noticeState(request), notified_at: now });
      return { eventId, sent, types };
    });
  };

  return { notifyTechnicalSupport };
};
