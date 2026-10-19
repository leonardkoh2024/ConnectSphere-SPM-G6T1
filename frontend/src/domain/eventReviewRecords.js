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

// K3 / SCRUM-184 — `reassignedBy` (the Lead) is written only on the record a
// reassignment closes, so every other assignment keeps the agreed schema exactly.
export const coordinatorAssignmentRecord = ({ assignmentId, eventId, coordinatorId, assignedAt, endedAt = null, reassignedBy = null }) => ({
  assignment_id: assignmentId, event_id: eventId, coordinator_id: coordinatorId, assigned_at: assignedAt, ended_at: endedAt,
  ...(reassignedBy ? { reassigned_by: reassignedBy } : {})
});

// K3 / SCRUM-184 — `previousAssignedAt` is the outgoing coordinator's original
// assignment time; it is written only on a reassignment entry (null when unknown).
export const eventHistoryRecord = ({ historyId, eventId, actorId, actionType, fieldName = null, oldValue = null, newValue = null, description = null, previousAssignedAt, createdAt }) => ({
  history_id: historyId, event_id: eventId, actor_id: actorId, action_type: actionType,
  field_name: fieldName, old_value: oldValue, new_value: newValue, description, created_at: createdAt,
  ...(previousAssignedAt !== undefined ? { previous_assigned_at: previousAssignedAt } : {})
});

// `eventName` is for a recipient who may not read the event itself (J4: Venue
// Staff), so their inbox can still name it. Left off when not given.
export const notificationRecord = ({ notificationId, userId, eventId, type, message, createdAt, eventName }) => ({
  notification_id: notificationId, user_id: userId, event_id: eventId, type, message,
  is_read: false, created_at: createdAt, read_at: null,
  ...(eventName ? { event_name: eventName } : {})
});
