import {
  clarificationRecord,
  clarificationResponseRecord,
  coordinatorAssignmentRecord,
  eventHistoryRecord,
  notificationRecord
} from './eventReviewRecords';

const keys = (value) => Object.keys(value).sort();

test('C4/C7/C9 workflow records match the agreed database schema', () => {
  expect(keys(clarificationRecord({}))).toEqual(['clarification_id', 'created_at', 'created_by', 'event_id', 'message', 'responded_at', 'status']);
  expect(keys(clarificationResponseRecord({}))).toEqual(['clarification_id', 'created_at', 'message', 'responder_id', 'response_id']);
  expect(keys(coordinatorAssignmentRecord({}))).toEqual(['assigned_at', 'assignment_id', 'coordinator_id', 'ended_at', 'event_id']);
  expect(keys(eventHistoryRecord({}))).toEqual(['action_type', 'actor_id', 'created_at', 'description', 'event_id', 'field_name', 'history_id', 'new_value', 'old_value']);
  expect(keys(notificationRecord({}))).toEqual(['created_at', 'event_id', 'is_read', 'message', 'notification_id', 'read_at', 'type', 'user_id']);
});
