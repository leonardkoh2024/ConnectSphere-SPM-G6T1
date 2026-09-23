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
