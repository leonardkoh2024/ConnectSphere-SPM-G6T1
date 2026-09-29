// Pure workflow rules for C4, C7 and C9. The UI and browser Firestore adapter
// share these checks; firestore.rules remains the authoritative boundary.

export const EVENT_STATUS = {
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  REJECTED: "REJECTED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED"
};

export const cleanRequiredText = (value) => String(value || "").trim();

export const isCurrentCoordinator = (event, userId) =>
  Boolean(event && userId && event.coordinator_id === userId);

export const canOpenReview = (event, userId) =>
  isCurrentCoordinator(event, userId) && event.status === EVENT_STATUS.SUBMITTED;

export const canRequestClarification = (event, userId) =>
  isCurrentCoordinator(event, userId) &&
  event.status === EVENT_STATUS.UNDER_REVIEW &&
  !event.open_clarification_id;

export const canRejectEvent = canRequestClarification;

const TERMINAL = new Set([EVENT_STATUS.COMPLETED, EVENT_STATUS.CANCELLED, EVENT_STATUS.REJECTED]);

export const canReassignEvent = (event, userId, targetCoordinator) =>
  isCurrentCoordinator(event, userId) &&
  !TERMINAL.has(event.status) &&
  Boolean(targetCoordinator?.active !== false) &&
  Boolean(targetCoordinator?.id) &&
  targetCoordinator.id !== userId;

export const chronologicalClarifications = (clarifications = [], responses = []) =>
  [
    ...clarifications.map((item) => ({ ...item, kind: "QUESTION" })),
    ...responses.map((item) => ({ ...item, kind: "RESPONSE" }))
  ].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

const SERVER_TIMESTAMP = "SERVER_TIMESTAMP";

export const canAmendDuringClarification = (event) =>
  Boolean(event && event.status === EVENT_STATUS.UNDER_REVIEW && event.open_clarification_id);

export const canRespondToClarification = (event, clarification, userId) => {
  if (!event || !clarification || !userId) return false;
  if (clarification.status !== "OPEN") return false;
  const clarificationId = clarification.clarification_id || clarification.id;
  if (event.open_clarification_id !== clarificationId) return false;
  if (event.organiser_id !== userId) return false;
  return true;
};

export const submitClarificationResponse = ({
  event,
  clarification,
  responses = [],
  userId,
  message,
  fieldEdits = {},
  now = SERVER_TIMESTAMP
}) => {
  if (!canRespondToClarification(event, clarification, userId)) {
    return { ok: false, event, clarification, responses };
  }
  if (!cleanRequiredText(message)) {
    return { ok: false, reason: "empty", event, clarification, responses };
  }

  const response = {
    clarification_id: clarification.clarification_id || clarification.id,
    responder_id: userId,
    message: cleanRequiredText(message),
    created_at: now
  };

  return {
    ok: true,
    event: {
      ...event,
      ...fieldEdits,
      open_clarification_id: null,
      status: EVENT_STATUS.UNDER_REVIEW
    },
    clarification: {
      ...clarification,
      status: "ANSWERED",
      responded_at: now
    },
    responses: [...responses, response]
  };
};
