// I1 / SCRUM-147 — the rules of a change request. TC-765 – TC-771 in docs/test-cases.md.

import {
  CHANGEABLE_FIELD_NAMES, CHANGE_REQUEST_EVENT_STATUSES, affectedArrangements, canApplyChange, canRequestChange,
  changeDecisionMessage, changeRequestProblems, changeRequestedMessage, changeValueText, currentChangeValues,
  declineReasonProblem, proposedChanges, valuesWithChanges
} from './changeRequests';

const current = currentChangeValues({
  event: { name: 'Harbour Tech Forum', purpose: 'Showcase', description: 'Talks', expected_attendance: 120, event_date: '2026-11-22', start_time: '09:00', end_time: '17:00' },
  requirement: { preferred_location: 'CENTRAL', required_layout: 'THEATRE', accessibility_notes: '' },
  facilities: ['WIFI', 'AIR_CONDITIONING'],
  accessibility: []
});
const TODAY = '2026-10-28';
const problems = (fields, proposed, reason = 'Numbers grew.') => changeRequestProblems({ current, proposed, fields, reason, today: TODAY });

describe('I1 AC1 which events take a change request', () => {
  test('TC-765 the organiser\'s own event from Submitted up to and including Confirmed, and nothing else', () => {
    expect(CHANGE_REQUEST_EVENT_STATUSES).toEqual(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PLANNING', 'SAFETY_REVIEW', 'CONFIRMED']);
    CHANGE_REQUEST_EVENT_STATUSES.forEach((status) => expect(canRequestChange({ organiser_id: 'o1', status }, 'o1')).toBe(true));
    ['DRAFT', 'COMPLETED', 'CANCELLED', 'REJECTED'].forEach((status) => expect(canRequestChange({ organiser_id: 'o1', status }, 'o1')).toBe(false));
    expect(canRequestChange({ organiser_id: 'o2', status: 'PLANNING' }, 'o1')).toBe(false);
    expect(canRequestChange(null, 'o1')).toBe(false);
  });
});

describe('I1 AC2 what a change request carries', () => {
  test('TC-766 the current values come from the event and its request records, lists sorted', () => {
    expect(current).toMatchObject({ expected_attendance: 120, preferred_location: 'CENTRAL', required_layout: 'THEATRE', facilities: ['AIR_CONDITIONING', 'WIFI'], accessibility: [] });
    expect(Object.keys(current)).toEqual(CHANGEABLE_FIELD_NAMES);
  });

  test('TC-767 each chosen field is kept with its value now and the value proposed, and only chosen fields', () => {
    const changes = proposedChanges(current, { expected_attendance: '150', facilities: ['STAGE', 'WIFI'], name: 'Ignored' }, ['expected_attendance', 'facilities']);
    expect(changes).toEqual({
      expected_attendance: { old_value: 120, new_value: 150 },
      facilities: { old_value: ['AIR_CONDITIONING', 'WIFI'], new_value: ['STAGE', 'WIFI'] }
    });
  });

  test('TC-768 a request needs a field, a different value and a reason', () => {
    expect(problems([], {})).toContain('Choose at least one detail to change.');
    expect(problems(['expected_attendance'], { expected_attendance: '120' })).toContain('Expected attendance: enter a value different from the current one.');
    expect(problems(['name'], { name: '  ' })).toContain('Event name cannot be left blank.');
    expect(problems(['expected_attendance'], { expected_attendance: '150' }, '  ')).toEqual(['Give a reason for the change.']);
    expect(problems(['expected_attendance'], { expected_attendance: '150' })).toEqual([]);
  });

  test('TC-769 the event as it would stand must still make sense', () => {
    expect(problems(['expected_attendance'], { expected_attendance: '0' })).toContain('Expected attendance must be a whole number greater than zero.');
    expect(problems(['expected_attendance'], { expected_attendance: '12.5' })).toContain('Expected attendance must be a whole number greater than zero.');
    expect(problems(['event_date'], { event_date: '2026-10-01' })).toContain('The new date cannot be in the past.');
    expect(problems(['end_time'], { end_time: '08:00' })).toContain('The end time must be later than the start time.');
    expect(problems(['start_time', 'end_time'], { start_time: '18:00', end_time: '21:00' })).toEqual([]);
    expect(problems(['accessibility_notes'], { accessibility_notes: 'Ramp at the side entrance' })).toEqual([]);
  });
});

describe('I1 how a request reads', () => {
  test('TC-770 values read in words: lists joined, catalogue values by label, nothing as a dash', () => {
    expect(changeValueText('facilities', ['AIR_CONDITIONING', 'WIFI'])).toBe('AIR CONDITIONING, WIFI');
    expect(changeValueText('accessibility', [])).toBe('None');
    expect(changeValueText('preferred_location', 'CENTRAL')).toMatch(/^Central/);
    expect(changeValueText('required_layout', 'U_SHAPE')).toBe('U SHAPE');
    expect(changeValueText('accessibility_notes', '')).toBe('—');
    expect(changeValueText('expected_attendance', 150)).toBe('150');
  });

  test('TC-771 AC4 the coordinator\'s notice names the event and what is to change', () => {
    expect(changeRequestedMessage({ eventName: 'Harbour Tech Forum', fields: ['expected_attendance', 'event_date'] }))
      .toBe('Harbour Tech Forum has a change request waiting for your decision: expected attendance, date.');
  });
});

describe('I2 SCRUM-148 deciding a request', () => {
  const impact = { venueBookings: [{ id: 'b1', label: 'Grand Hall', status: 'APPROVED' }], equipmentReservations: [{ id: 'r1', label: 'Projector', status: 'RESERVED' }], registrationsCount: 3 };

  test('TC-805 AC1 attendance reaches venue, equipment and registrations, each listing what is held', () => {
    const sections = affectedArrangements(['expected_attendance'], impact);
    expect(sections.map((section) => section.key)).toEqual(['venue', 'equipment', 'registrations']);
    expect(sections[0].items).toEqual(['Grand Hall — APPROVED']);
    expect(sections[1].items).toEqual(['Projector — RESERVED']);
    expect(sections[2].items).toEqual(['3 registration records on this event']);
    expect(sections[0].fields).toEqual(['Expected attendance']);
  });

  test('TC-806 AC1 a field reaches only the arrangements it touches; a name touches none', () => {
    expect(affectedArrangements(['required_layout'], impact).map((section) => section.key)).toEqual(['venue']);
    expect(affectedArrangements(['preferred_location'], impact).map((section) => section.key)).toEqual(['venue', 'registrations']);
    expect(affectedArrangements(['name', 'purpose'], impact)).toEqual([]);
    expect(affectedArrangements(['event_date'], {})[0].items).toEqual([]);
  });

  test('TC-807 AC2 declining needs a reason; applying needs an event that can be edited', () => {
    expect(declineReasonProblem('')).toBe('Give a reason for declining the change.');
    expect(declineReasonProblem('   ')).toBe('Give a reason for declining the change.');
    expect(declineReasonProblem('Venue is full.')).toBeNull();
    ['APPROVED', 'PLANNING', 'CONFIRMED'].forEach((status) => expect(canApplyChange(status)).toBe(true));
    ['SUBMITTED', 'UNDER_REVIEW', 'SAFETY_REVIEW', 'CANCELLED'].forEach((status) => expect(canApplyChange(status)).toBe(false));
  });

  test('TC-808 AC3 the new values go over the form values, and the two switches follow the lists', () => {
    const base = { name: 'A', expected_attendance: 120, facilities: ['WIFI'], facilities_required: true, accessibility: [], accessibility_notes: '', accessibility_needed: false };
    const values = valuesWithChanges(base, {
      expected_attendance: { old_value: 120, new_value: 150 },
      facilities: { old_value: ['WIFI'], new_value: [] },
      accessibility_notes: { old_value: '', new_value: 'Step-free access' }
    });
    expect(values).toMatchObject({ name: 'A', expected_attendance: 150, facilities: [], facilities_required: false, accessibility_needed: true });
    expect(base.expected_attendance).toBe(120);
  });

  test('TC-809 AC4 the organiser\'s notice carries the decision and the reason', () => {
    expect(changeDecisionMessage({ eventName: 'Harbour Tech Forum', accepted: false, reason: 'Venue is full.' }))
      .toBe('Harbour Tech Forum: your change request was declined — Venue is full.');
    expect(changeDecisionMessage({ eventName: 'Harbour Tech Forum', accepted: true, reason: '' }))
      .toBe('Harbour Tech Forum: your change request was accepted and applied.');
  });
});
