import {
  ORDINARY_FIELD_NAMES,
  actionLabel,
  activityEntries,
  canEditOrdinaryDetails,
  cleanOrdinaryValues,
  fieldLabel,
  shownValue,
  ordinaryEventChanges,
  ordinaryEventValues,
  validateOrdinaryEventValues
} from './ordinaryEventChanges';
import { contactDetails } from './eventReview';

const event = { name: 'Partner Summit', purpose: 'Partners', description: 'Annual summit', coordinator_id: 'c1', status: 'PLANNING' };
const organiser = { name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: '+65 9123 4567' };

describe('D1 SCRUM-111 ordinary event information', () => {
  test('TC-0419 D1 AC1 the ordinary set is exactly name, purpose, description, contact details and internal notes', () => {
    expect(ORDINARY_FIELD_NAMES).toEqual(['name', 'purpose', 'description', 'contact_name', 'contact_email', 'contact_phone', 'internal_notes']);
    // Nothing a booking or reservation depends on is in the set.
    ['expected_attendance', 'event_date', 'start_time', 'end_time', 'status', 'coordinator_id']
      .forEach((field) => expect(ORDINARY_FIELD_NAMES).not.toContain(field));
  });

  test('TC-0420 D1 AC3 editable in Approved, Planning and Confirmed by the current coordinator only', () => {
    ['APPROVED', 'PLANNING', 'CONFIRMED'].forEach((status) => expect(canEditOrdinaryDetails({ ...event, status }, 'c1')).toBe(true));
    ['COMPLETED', 'CANCELLED', 'REJECTED', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'SAFETY_REVIEW']
      .forEach((status) => expect(canEditOrdinaryDetails({ ...event, status }, 'c1')).toBe(false));
    expect(canEditOrdinaryDetails(event, 'c2')).toBe(false);
  });

  test('TC-0421 D1 AC2 each changed field is listed with its old and new value; untouched fields are not', () => {
    const before = ordinaryEventValues(event, organiser);
    const after = { ...before, name: 'Partner Summit 2026', internal_notes: 'VIP list pending' };
    expect(ordinaryEventChanges(before, after)).toEqual([
      { field: 'name', old_value: 'Partner Summit', new_value: 'Partner Summit 2026' },
      { field: 'internal_notes', old_value: '', new_value: 'VIP list pending' }
    ]);
    expect(ordinaryEventChanges(before, { ...before, name: '  Partner Summit  ' })).toEqual([]);
  });

  test('TC-0422 D1 contact details start from the organiser profile and an event contact overrides it', () => {
    expect(ordinaryEventValues(event, organiser)).toMatchObject({ contact_name: 'Nadia Organiser', contact_email: 'nadia@smu.edu.sg' });
    const corrected = { ...event, contact_phone: '+65 8000 0000' };
    expect(ordinaryEventValues(corrected, organiser).contact_phone).toBe('+65 8000 0000');
    expect(contactDetails(organiser, corrected)).toEqual({ name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: '+65 8000 0000' });
  });

  test('TC-0423 D1 name, purpose and description are required; a contact email must be valid', () => {
    const values = ordinaryEventValues(event, organiser);
    expect(validateOrdinaryEventValues(values)).toBe('');
    expect(validateOrdinaryEventValues({ ...values, name: '  ' })).toBe('Event name is required.');
    expect(validateOrdinaryEventValues({ ...values, contact_email: 'not-an-email' })).toBe('Enter a valid contact email.');
    expect(validateOrdinaryEventValues({ ...values, contact_email: '' })).toBe('');
  });

  test('TC-0424 D1 AC2 the activity log is newest first and names the actor, time, field, old and new value', () => {
    const entries = activityEntries([
      { id: 'h1', action_type: 'EVENT_APPROVED', actor_id: 'c1', field_name: 'status', old_value: 'UNDER_REVIEW', new_value: 'APPROVED', created_at: '2026-10-01T01:00:00.000Z' },
      { id: 'h2', action_type: 'EVENT_DETAILS_UPDATED', actor_id: 'c1', field_name: 'name', old_value: 'Old', new_value: 'New', created_at: '2026-10-02T01:00:00.000Z' },
      { id: 'h3', action_type: 'SIGNIFICANT_EVENT_DETAILS_CHANGED', actor_id: 'c9', field_name: 'significant_event_details',
        old_value: { expected_attendance: 100 }, new_value: { expected_attendance: 125 }, created_at: '2026-10-03T01:00:00.000Z' }
    ], { c1: 'Sam Coordinator' });

    expect(entries.map((entry) => entry.id)).toEqual(['h3', 'h2', 'h1']);
    expect(entries[1]).toMatchObject({
      action: 'Updated event details', actor: 'Sam Coordinator', at: '2026-10-02T01:00:00.000Z',
      changes: [{ field: 'name', label: 'Event name', oldValue: 'Old', newValue: 'New' }]
    });
    // A significant change is split into its fields; an unknown actor ID is not exposed.
    expect(entries[0]).toMatchObject({ actor: 'Unknown user', changes: [{ label: 'Expected attendance', oldValue: '100', newValue: '125' }] });
    expect(activityEntries([{ id: 'h4', action_type: 'X', field_name: 'internal_notes', old_value: '', new_value: 'n' }])[0].changes[0].oldValue).toBe('(blank)');
  });

  test('TC-0548 D6 displays recorded clarification and decision descriptions and identifies staff actors by role', () => {
    const entries = activityEntries([
      {
        id: 'h1', action_type: 'CLARIFICATION_REQUESTED', actor_id: 'c1',
        description: 'Please confirm attendance.', created_at: '2026-10-01T01:00:00.000Z'
      },
      {
        id: 'h2', action_type: 'VENUE_BOOKING_HELD', actor_id: 'venue-staff-1',
        description: 'Venue booking VB-1 held until 2026-10-06.', created_at: '2026-10-02T01:00:00.000Z'
      },
      {
        id: 'h3', action_type: 'SAFETY_CHECK_REJECTED', actor_id: 'safety-officer-1',
        description: 'Emergency access must remain clear.', created_at: '2026-10-03T01:00:00.000Z'
      }
    ]);

    expect(entries.map((entry) => entry.id)).toEqual(['h3', 'h2', 'h1']);
    expect(entries.map((entry) => entry.actor)).toEqual(['Safety Officer', 'Venue Staff', 'Unknown user']);
    expect(entries.map((entry) => entry.description)).toEqual([
      'Emergency access must remain clear.',
      'Venue booking VB-1 held until 2026-10-06.',
      'Please confirm attendance.'
    ]);
    expect(entries.map((entry) => entry.action)).toEqual([
      'Rejected the safety check',
      'Placed a venue booking on hold',
      'Requested clarification'
    ]);
  });

  test('TC-0549 D6 uses the resolved name instead of exposing an actor user ID', () => {
    const [named] = activityEntries([
      { id: 'h1', action_type: 'EVENT_DETAILS_UPDATED', actor_id: 'uid-123' }
    ], { 'uid-123': 'Jordan Tan' });
    const [unreadable] = activityEntries([
      { id: 'h2', action_type: 'EVENT_DETAILS_UPDATED', actor_id: 'uid-456' }
    ]);

    expect(named.actor).toBe('Jordan Tan');
    expect(unreadable.actor).toBe('Unknown user');
    expect(unreadable.actor).not.toBe('uid-456');
  });
});

// D1 / D6 — edges of the ordinary-details rules and the Activity tab lines.
describe('D1 / D6 ordinary details and activity edges', () => {
  test('TC-0425 [boundary] D1 a missing event or organiser starts every field blank, and nulls clean to blanks', () => {
    expect(ordinaryEventValues()).toEqual({
      name: '', purpose: '', description: '', contact_name: '', contact_email: '', contact_phone: '', internal_notes: ''
    });
    expect(ordinaryEventValues({}, {})).toMatchObject({ contact_name: '', contact_email: '', contact_phone: '' });
    expect(cleanOrdinaryValues()).toEqual(Object.fromEntries(ORDINARY_FIELD_NAMES.map((field) => [field, ''])));
    expect(cleanOrdinaryValues({ name: null, purpose: '  P  ' })).toMatchObject({ name: '', purpose: 'P' });
  });

  test('TC-0426 [boundary] D1 a field exactly at its length limit is accepted; one character more is refused', () => {
    const valid = { ...ordinaryEventValues(event, organiser) };
    expect(validateOrdinaryEventValues({ ...valid, name: 'x'.repeat(200) })).toBe('');
    expect(validateOrdinaryEventValues({ ...valid, name: 'x'.repeat(201) })).toBe('Event name must be 200 characters or fewer.');
  });

  test('TC-0550 [boundary] D6 labels fall back from ordinary, to significant, to the raw field name; unknown actions read as words', () => {
    expect(fieldLabel('contact_email')).toBe('Contact email');
    expect(fieldLabel('event_date')).toBe('Event date');
    expect(fieldLabel('venue_layout_note')).toBe('venue layout note');
    expect(fieldLabel(undefined)).toBe('');
    expect(actionLabel('SAFETY_CHECK_REQUESTED')).toBe('Sent for safety check');
    expect(actionLabel('SOMETHING_NEW')).toBe('Something new');
    expect(actionLabel(undefined)).toBe('Activity');
  });

  test('TC-0551 [boundary] D6 values read as blank, none, Yes/No, JSON or plain text', () => {
    expect(shownValue(undefined)).toBe('(blank)');
    expect(shownValue('')).toBe('(blank)');
    expect(shownValue([])).toBe('(none)');
    expect(shownValue(['WIFI', 'STAGE'])).toBe('WIFI, STAGE');
    expect(shownValue(true)).toBe('Yes');
    expect(shownValue(false)).toBe('No');
    expect(shownValue({ a: 1 })).toBe('{"a":1}');
    expect(shownValue(120)).toBe('120');
  });

  test('TC-0552 [boundary] D6 a significant-change row with only one side recorded, or nothing recorded, still reads cleanly', () => {
    const entries = activityEntries([
      { history_id: 'h1', action_type: 'SIGNIFICANT_EVENT_DETAILS_CHANGED', new_value: { event_date: '2026-11-05' }, created_at: '2' },
      { history_id: 'h2', action_type: 'SIGNIFICANT_EVENT_DETAILS_CHANGED', old_value: { start_time: '09:00' }, created_at: '1' },
      { history_id: 'h3', action_type: 'REVIEW_STARTED' }
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(['h1', 'h2', 'h3']);
    // Undated rows go last whichever side of the comparison they fall on.
    expect(activityEntries([{ id: 'u' }, { id: 'd', created_at: '1' }, { id: 'v' }]).map((entry) => entry.id)).toEqual(['d', 'u', 'v']);
    expect(entries[0].changes).toEqual([{ field: 'event_date', label: 'Event date', oldValue: '(blank)', newValue: '2026-11-05' }]);
    expect(entries[1].changes).toEqual([{ field: 'start_time', label: 'Start time', oldValue: '09:00', newValue: '(blank)' }]);
    expect(entries[2]).toMatchObject({ actor: 'Unknown user', at: null, description: null, reason: null, changes: [] });
    expect(activityEntries()).toEqual([]);
  });
});
