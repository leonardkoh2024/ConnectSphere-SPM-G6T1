// J6 / SCRUM-155 AC3 — the coordinator is told when Technical Support marks an
// equipment request arranged, or a line of it unable to be fulfilled. Written in
// the same transaction as the decision, so the two never disagree. This is the
// equipment service's scoped exception to owning only its own collections: it
// reads `coordinator_id` and `name` from `events/{eventId}` and creates
// `notifications` documents in the shape the inbox reads (see backend/README).

const typeWords = (type) => String(type || "equipment").replaceAll("_", " ").toLowerCase();

export const arrangedMessage = ({ eventName, lines = [] }) => {
  const reserved = lines.filter((line) => line.fulfillment_status === "RESERVED");
  const summary = reserved.map((line) => `${Number(line.quantity)} × ${typeWords(line.equipment_type)}`).join(", ");
  const unfulfilled = lines.length - reserved.length;
  // The coordinator reads "reserved", not the stored ARRANGED, and is never told
  // everything is reserved when some of it was refused.
  const outcome = !reserved.length
    ? "none of your requested equipment could be reserved."
    : unfulfilled ? "some of your equipment is reserved." : "your equipment is reserved.";
  return `${eventName || "Your event"}: ${outcome}`
    + (summary ? ` Reserved: ${summary}.` : "")
    + (unfulfilled ? ` ${unfulfilled} line${unfulfilled === 1 ? " was" : "s were"} unable to be fulfilled.` : "");
};

export const unableMessage = ({ eventName, line, reason }) =>
  `${eventName || "Your event"}: Technical Support cannot fulfil ${Number(line.quantity)} × ${typeWords(line.equipment_type)}.`
  + ` Reason: ${String(reason || "").trim()}`;

// Queues the notification on `transaction`. Nothing is written when the event,
// or its coordinator, cannot be found: there is nobody to tell.
export const notifyCoordinator = ({ firestore, transaction, eventSnapshot, eventId, type, message, createdAt, extra = {} }) => {
  const coordinatorId = eventSnapshot?.exists ? eventSnapshot.data().coordinator_id : null;
  if (!coordinatorId) return null;
  const notificationRef = firestore.collection("notifications").doc();
  const record = {
    notification_id: notificationRef.id,
    user_id: coordinatorId,
    event_id: eventId,
    type,
    message,
    is_read: false,
    created_at: createdAt,
    read_at: null,
    ...extra
  };
  transaction.create(notificationRef, record);
  return record;
};

export const eventNameOf = (eventSnapshot) => {
  const event = eventSnapshot?.exists ? eventSnapshot.data() : {};
  return event.name || event.reference_no || "";
};
