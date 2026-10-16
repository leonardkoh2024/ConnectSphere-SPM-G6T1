import {
  ORDINARY_FIELD_NAMES,
  activityEntries,
  canEditOrdinaryDetails,
  ordinaryEventChanges,
  ordinaryEventValues,
  validateOrdinaryEventValues
} from './ordinaryEventChanges';
import { contactDetails } from './eventReview';

const event = { name: 'Partner Summit', purpose: 'Partners', description: 'Annual summit', coordinator_id: 'c1', status: 'PLANNING' };
const organiser = { name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: '+65 9123 4567' };

describe('D1 SCRUM-111 ordinary event information', () => {
  test('D1 TC1 AC1 the ordinary set is exactly name, purpose, description, contact details and internal notes', () => {
    expect(ORDINARY_FIELD_NAMES).toEqual(['name', 'purpose', 'description', 'contact_name', 'contact_email', 'contact_phone', 'internal_notes']);
    // Nothing a booking or reservation depends on is in the set.
    ['expected_attendance', 'event_date', 'start_time', 'end_time', 'status', 'coordinator_id']
      .forEach((field) => expect(ORDINARY_FIELD_NAMES).not.toContain(field));
  });

  test('D1 TC2 AC3 editable in Approved, Planning and Confirmed by the current coordinator only', () => {
    ['APPROVED', 'PLANNING', 'CONFIRMED'].forEach((status) => expect(canEditOrdinaryDetails({ ...event, status }, 'c1')).toBe(true));
    ['COMPLETED', 'CANCELLED', 'REJECTED', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'SAFETY_REVIEW']
      .forEach((status) => expect(canEditOrdinaryDetails({ ...event, status }, 'c1')).toBe(false));
    expect(canEditOrdinaryDetails(event, 'c2')).toBe(false);
  });

  test('D1 TC3 AC2 each changed field is listed with its old and new value; untouched fields are not', () => {
    const before = ordinaryEventValues(event, organiser);
    const after = { ...before, name: 'Partner Summit 2026', internal_notes: 'VIP list pending' };
    expect(ordinaryEventChanges(before, after)).toEqual([
      { field: 'name', old_value: 'Partner Summit', new_value: 'Partner Summit 2026' },
      { field: 'internal_notes', old_value: '', new_value: 'VIP list pending' }
    ]);
    expect(ordinaryEventChanges(before, { ...before, name: '  Partner Summit  ' })).toEqual([]);
  });

  test('D1 TC4 contact details start from the organiser profile and an event contact overrides it', () => {
    expect(ordinaryEventValues(event, organiser)).toMatchObject({ contact_name: 'Nadia Organiser', contact_email: 'nadia@smu.edu.sg' });
    const corrected = { ...event, contact_phone: '+65 8000 0000' };
    expect(ordinaryEventValues(corrected, organiser).contact_phone).toBe('+65 8000 0000');
    expect(contactDetails(organiser, corrected)).toEqual({ name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: '+65 8000 0000' });
  });

  test('D1 TC5 name, purpose and description are required; a contact email must be valid', () => {
    const values = ordinaryEventValues(event, organiser);
    expect(validateOrdinaryEventValues(values)).toBe('');
    expect(validateOrdinaryEventValues({ ...values, name: '  ' })).toBe('Event name is required.');
    expect(validateOrdinaryEventValues({ ...values, contact_email: 'not-an-email' })).toBe('Enter a valid contact email.');
    expect(validateOrdinaryEventValues({ ...values, contact_email: '' })).toBe('');
  });

  test('D1 TC6 AC2 the activity log is newest first and names the actor, time, field, old and new value', () => {
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
    // A significant change is split into its fields; an unknown actor falls back to the id.
    expect(entries[0]).toMatchObject({ actor: 'c9', changes: [{ label: 'Expected attendance', oldValue: '100', newValue: '125' }] });
    expect(activityEntries([{ id: 'h4', action_type: 'X', field_name: 'internal_notes', old_value: '', new_value: 'n' }])[0].changes[0].oldValue).toBe('(blank)');
  });
});
