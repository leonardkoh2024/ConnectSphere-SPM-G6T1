import {
  clarificationRecord,
  clarificationResponseRecord,
  coordinatorAssignmentRecord,
  eventHistoryRecord,
  notificationRecord
} from './eventReviewRecords';

const keys = (value) => Object.keys(value).sort();

test('TC-0363 C4/C7/C9 workflow records match the agreed database schema', () => {
  expect(keys(clarificationRecord({}))).toEqual(['clarification_id', 'created_at', 'created_by', 'event_id', 'message', 'responded_at', 'status']);
  expect(keys(clarificationResponseRecord({}))).toEqual(['clarification_id', 'created_at', 'message', 'responder_id', 'response_id']);
  expect(keys(coordinatorAssignmentRecord({}))).toEqual(['assigned_at', 'assignment_id', 'coordinator_id', 'ended_at', 'event_id']);
  expect(keys(eventHistoryRecord({}))).toEqual(['action_type', 'actor_id', 'created_at', 'description', 'event_id', 'field_name', 'history_id', 'new_value', 'old_value']);
  expect(keys(notificationRecord({}))).toEqual(['created_at', 'event_id', 'is_read', 'message', 'notification_id', 'read_at', 'type', 'user_id']);
});

test('TC-2314 [normal] K3 / J4 / J7 the optional fields are written only when given', () => {
  expect(coordinatorAssignmentRecord({ reassignedBy: 'lead1' })).toMatchObject({ reassigned_by: 'lead1', ended_at: null });
  expect(eventHistoryRecord({ previousAssignedAt: null })).toHaveProperty('previous_assigned_at', null);
  expect(notificationRecord({ eventName: 'Partner Summit', registrationId: 'g1' })).toMatchObject({ event_name: 'Partner Summit', registration_id: 'g1' });
  expect(notificationRecord({ eventName: '', registrationId: '' })).not.toHaveProperty('event_name');
});
