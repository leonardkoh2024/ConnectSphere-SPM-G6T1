// Exact Firestore document shapes for the C4/C7/C9 workflow. IDs are stored in
// the document as well as used as Firestore document IDs, matching the database
// schema supplied by the team.

export const clarificationRecord = ({ clarificationId, eventId, createdBy, message, createdAt }) => ({
  clarification_id: clarificationId, event_id: eventId, created_by: createdBy, message,
  status: "OPEN", created_at: createdAt, responded_at: null
});

export const clarificationResponseRecord = ({ responseId, clarificationId, responderId, message, createdAt }) => ({
  response_id: responseId, clarification_id: clarificationId, responder_id: responderId, message, created_at: createdAt
});

export const coordinatorAssignmentRecord = ({ assignmentId, eventId, coordinatorId, assignedAt, endedAt = null }) => ({
  assignment_id: assignmentId, event_id: eventId, coordinator_id: coordinatorId, assigned_at: assignedAt, ended_at: endedAt
});

export const eventHistoryRecord = ({ historyId, eventId, actorId, actionType, fieldName = null, oldValue = null, newValue = null, description = null, createdAt }) => ({
  history_id: historyId, event_id: eventId, actor_id: actorId, action_type: actionType,
  field_name: fieldName, old_value: oldValue, new_value: newValue, description, created_at: createdAt
});

export const notificationRecord = ({ notificationId, userId, eventId, type, message, createdAt }) => ({
  notification_id: notificationId, user_id: userId, event_id: eventId, type, message,
  is_read: false, created_at: createdAt, read_at: null
});
