// I1 / SCRUM-147 — the rules of a change request.

import {
  CHANGEABLE_FIELD_NAMES, CHANGE_REQUEST_EVENT_STATUSES, CHANGE_REQUEST_STATUS_LABELS, changeRequestStatusTone, changeableField, affectedArrangements, canApplyChange, canRequestChange,
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
  test('TC-1801 the organiser\'s own event from Submitted up to and including Confirmed, and nothing else', () => {
    expect(CHANGE_REQUEST_EVENT_STATUSES).toEqual(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PLANNING', 'SAFETY_REVIEW', 'CONFIRMED']);
    CHANGE_REQUEST_EVENT_STATUSES.forEach((status) => expect(canRequestChange({ organiser_id: 'o1', status }, 'o1')).toBe(true));
    ['DRAFT', 'COMPLETED', 'CANCELLED', 'REJECTED'].forEach((status) => expect(canRequestChange({ organiser_id: 'o1', status }, 'o1')).toBe(false));
    expect(canRequestChange({ organiser_id: 'o2', status: 'PLANNING' }, 'o1')).toBe(false);
    expect(canRequestChange(null, 'o1')).toBe(false);
  });
});

describe('I1 AC2 what a change request carries', () => {
  test('TC-1802 the current values come from the event and its request records, lists sorted', () => {
    expect(current).toMatchObject({ expected_attendance: 120, preferred_location: 'CENTRAL', required_layout: 'THEATRE', facilities: ['AIR_CONDITIONING', 'WIFI'], accessibility: [] });
    expect(Object.keys(current)).toEqual(CHANGEABLE_FIELD_NAMES);
  });

  test('TC-1803 each chosen field is kept with its value now and the value proposed, and only chosen fields', () => {
    const changes = proposedChanges(current, { expected_attendance: '150', facilities: ['STAGE', 'WIFI'], name: 'Ignored' }, ['expected_attendance', 'facilities']);
    expect(changes).toEqual({
      expected_attendance: { old_value: 120, new_value: 150 },
      facilities: { old_value: ['AIR_CONDITIONING', 'WIFI'], new_value: ['STAGE', 'WIFI'] }
    });
  });

  test('TC-1804 a request needs a field, a different value and a reason', () => {
    expect(problems([], {})).toContain('Choose at least one detail to change.');
    expect(problems(['expected_attendance'], { expected_attendance: '120' })).toContain('Expected attendance: enter a value different from the current one.');
    expect(problems(['name'], { name: '  ' })).toContain('Event name cannot be left blank.');
    expect(problems(['expected_attendance'], { expected_attendance: '150' }, '  ')).toEqual(['Give a reason for the change.']);
    expect(problems(['expected_attendance'], { expected_attendance: '150' })).toEqual([]);
  });

  test('TC-1805 the event as it would stand must still make sense', () => {
    expect(problems(['expected_attendance'], { expected_attendance: '0' })).toContain('Expected attendance must be a whole number greater than zero.');
    expect(problems(['expected_attendance'], { expected_attendance: '12.5' })).toContain('Expected attendance must be a whole number greater than zero.');
    expect(problems(['event_date'], { event_date: '2026-10-01' })).toContain('The new date cannot be in the past.');
    expect(problems(['end_time'], { end_time: '08:00' })).toContain('The end time must be later than the start time.');
    expect(problems(['start_time', 'end_time'], { start_time: '18:00', end_time: '21:00' })).toEqual([]);
    expect(problems(['accessibility_notes'], { accessibility_notes: 'Ramp at the side entrance' })).toEqual([]);
  });
});

describe('I1 how a request reads', () => {
  test('TC-1806 values read in words: lists joined, catalogue values by label, nothing as a dash', () => {
    expect(changeValueText('facilities', ['AIR_CONDITIONING', 'WIFI'])).toBe('AIR CONDITIONING, WIFI');
    expect(changeValueText('accessibility', [])).toBe('None');
    expect(changeValueText('preferred_location', 'CENTRAL')).toMatch(/^Central/);
    expect(changeValueText('required_layout', 'U_SHAPE')).toBe('U SHAPE');
    expect(changeValueText('accessibility_notes', '')).toBe('—');
    expect(changeValueText('expected_attendance', 150)).toBe('150');
  });

  test('TC-1807 AC4 the coordinator\'s notice names the event and what is to change', () => {
    expect(changeRequestedMessage({ eventName: 'Harbour Tech Forum', fields: ['expected_attendance', 'event_date'] }))
      .toBe('Harbour Tech Forum has a change request waiting for your decision: expected attendance, date.');
  });
});

describe('I2 SCRUM-148 deciding a request', () => {
  const impact = { venueBookings: [{ id: 'b1', label: 'Grand Hall', status: 'APPROVED' }], equipmentReservations: [{ id: 'r1', label: 'Projector', status: 'RESERVED' }], registrationsCount: 3 };

  test('TC-1872 AC1 attendance reaches venue, equipment and registrations, each listing what is held', () => {
    const sections = affectedArrangements(['expected_attendance'], impact);
    expect(sections.map((section) => section.key)).toEqual(['venue', 'equipment', 'registrations']);
    expect(sections[0].items).toEqual(['Grand Hall — APPROVED']);
    expect(sections[1].items).toEqual(['Projector — RESERVED']);
    expect(sections[2].items).toEqual(['3 registration records on this event']);
    expect(sections[0].fields).toEqual(['Expected attendance']);
  });

  test('TC-1873 AC1 a field reaches only the arrangements it touches; a name touches none', () => {
    expect(affectedArrangements(['required_layout'], impact).map((section) => section.key)).toEqual(['venue']);
    expect(affectedArrangements(['preferred_location'], impact).map((section) => section.key)).toEqual(['venue', 'registrations']);
    expect(affectedArrangements(['name', 'purpose'], impact)).toEqual([]);
    expect(affectedArrangements(['event_date'], {})[0].items).toEqual([]);
  });

  test('TC-1874 AC2 declining needs a reason; applying needs an event that can be edited', () => {
    expect(declineReasonProblem('')).toBe('Give a reason for declining the change.');
    expect(declineReasonProblem('   ')).toBe('Give a reason for declining the change.');
    expect(declineReasonProblem('Venue is full.')).toBeNull();
    ['APPROVED', 'PLANNING', 'CONFIRMED'].forEach((status) => expect(canApplyChange(status)).toBe(true));
    ['SUBMITTED', 'UNDER_REVIEW', 'SAFETY_REVIEW', 'CANCELLED'].forEach((status) => expect(canApplyChange(status)).toBe(false));
  });

  test('TC-1875 AC3 the new values go over the form values, and the two switches follow the lists', () => {
    const base = { name: 'A', expected_attendance: 120, facilities: ['WIFI'], facilities_required: true, accessibility: [], accessibility_notes: '', accessibility_needed: false };
    const values = valuesWithChanges(base, {
      expected_attendance: { old_value: 120, new_value: 150 },
      facilities: { old_value: ['WIFI'], new_value: [] },
      accessibility_notes: { old_value: '', new_value: 'Step-free access' }
    });
    expect(values).toMatchObject({ name: 'A', expected_attendance: 150, facilities: [], facilities_required: false, accessibility_needed: true });
    expect(base.expected_attendance).toBe(120);
  });

  test('TC-1876 AC4 the organiser\'s notice carries the decision and the reason', () => {
    expect(changeDecisionMessage({ eventName: 'Harbour Tech Forum', accepted: false, reason: 'Venue is full.' }))
      .toBe('Harbour Tech Forum: your change request was declined — Venue is full.');
    expect(changeDecisionMessage({ eventName: 'Harbour Tech Forum', accepted: true, reason: '' }))
      .toBe('Harbour Tech Forum: your change request was accepted and applied.');
  });
});

describe('I1 / I2 change request rules at their edges', () => {
  test('TC-1808 [normal] each request status has its label and tone; anything else is neutral', () => {
    expect(changeRequestStatusTone('PENDING')).toBe('warning');
    expect(changeRequestStatusTone('ACCEPTED')).toBe('positive');
    expect(changeRequestStatusTone('DECLINED')).toBe('danger');
    expect(changeRequestStatusTone('WITHDRAWN')).toBe('neutral');
    expect(CHANGE_REQUEST_STATUS_LABELS).toEqual({ PENDING: 'Pending', ACCEPTED: 'Accepted', DECLINED: 'Declined' });
  });

  test('TC-1809 [boundary] an event with nothing recorded yet reads as blank values, and no argument at all too', () => {
    const blank = {
      name: '', purpose: '', description: '', expected_attendance: '', event_date: '', start_time: '', end_time: '',
      preferred_location: '', required_layout: '', facilities: [], accessibility: [], accessibility_notes: ''
    };
    expect(currentChangeValues()).toEqual(blank);
    expect(currentChangeValues({ event: { expected_attendance: 0 } }).expected_attendance).toBe(0);
  });

  test('TC-1810 [boundary] proposed values are stored trimmed, as whole numbers, and as sorted lists, blanks as blank', () => {
    expect(proposedChanges(current, { name: '  Forum  ', expected_attendance: '', facilities: undefined, purpose: null }, ['name', 'expected_attendance', 'facilities', 'purpose'])).toEqual({
      name: { old_value: 'Harbour Tech Forum', new_value: 'Forum' },
      purpose: { old_value: 'Showcase', new_value: '' },
      expected_attendance: { old_value: 120, new_value: '' },
      facilities: { old_value: ['AIR_CONDITIONING', 'WIFI'], new_value: [] }
    });
    expect(proposedChanges(current, { expected_attendance: null }, ['expected_attendance']).expected_attendance.new_value).toBe('');
    expect(proposedChanges(current, { expected_attendance: undefined }, ['expected_attendance']).expected_attendance.new_value).toBe('');
  });

  test('TC-1811 [boundary] AC2 a text at exactly its limit passes, one over is refused', () => {
    expect(problems(['name'], { name: 'x'.repeat(200) })).toEqual([]);
    expect(problems(['name'], { name: 'x'.repeat(201) })).toEqual(['Event name must be 200 characters or fewer.']);
  });

  test('TC-1812 [boundary] AC2 attendance of one passes; zero, a fraction or blank do not', () => {
    expect(problems(['expected_attendance'], { expected_attendance: '1' })).toEqual([]);
    expect(problems(['expected_attendance'], { expected_attendance: '0' })).toContain('Expected attendance must be a whole number greater than zero.');
    expect(problems(['expected_attendance'], { expected_attendance: '2.5' })).toContain('Expected attendance must be a whole number greater than zero.');
    expect(problems(['expected_attendance'], { expected_attendance: '' })).toEqual(['Expected attendance cannot be left blank.']);
  });

  test('TC-1813 [boundary] AC2 today is an allowed new date and yesterday is not; an end equal to the start is refused', () => {
    expect(problems(['event_date'], { event_date: TODAY })).toEqual([]);
    expect(problems(['event_date'], { event_date: '2026-10-27' })).toEqual(['The new date cannot be in the past.']);
    expect(problems(['end_time'], { end_time: '09:00' })).toEqual(['The end time must be later than the start time.']);
    expect(problems(['start_time', 'end_time'], { start_time: '23:59', end_time: '24:00' })).toEqual(['Enter valid start and end times.']);
  });

  test('TC-1814 [boundary] without a today given, the check uses the real date', () => {
    expect(changeRequestProblems({ current, proposed: { event_date: '2000-01-01' }, fields: ['event_date'], reason: 'r' }))
      .toEqual(['The new date cannot be in the past.']);
  });

  test('TC-1815 [failure] a field the form does not know is ignored, and accessibility notes may be cleared', () => {
    expect(problems(['not_a_field'], {})).toEqual([]);
    const withNotes = { ...current, accessibility_notes: 'Ramp' };
    expect(changeRequestProblems({ current: withNotes, proposed: { accessibility_notes: '' }, fields: ['accessibility_notes'], reason: 'r', today: TODAY })).toEqual([]);
    expect(changeableField('not_a_field')).toBeNull();
    expect(changeRequestProblems({ current, proposed: { name: 'Forum' }, fields: ['name'], today: TODAY })).toEqual(['Give a reason for the change.']);
  });

  test('TC-1877 [normal] I2 AC3 a change to neither list leaves both switches as they were', () => {
    const base = { name: 'Old', facilities_required: true, facilities: ['WIFI'], accessibility_needed: false, accessibility: [], accessibility_notes: '' };
    expect(valuesWithChanges(base, { name: { old_value: 'Old', new_value: 'New' } })).toEqual({ ...base, name: 'New' });
  });

  test('TC-1816 [failure] values read on screen fall back sensibly', () => {
    expect(changeValueText('facilities', [])).toBe('None');
    expect(changeValueText('legacy', ['A', 'B'])).toBe('A, B');
    expect(changeValueText('name', null)).toBe('—');
    expect(changeValueText('name', undefined)).toBe('—');
    expect(changeValueText('preferred_location', 'UNKNOWN_AREA')).toBe('UNKNOWN_AREA');
    expect(changeValueText('required_layout', 'U_SHAPE')).toBe('U SHAPE');
    expect(changeValueText('expected_attendance', 0)).toBe('0');
  });

  test('TC-1878 [boundary] I2 AC1 exactly one registration reads as one record; no impact given means nothing held', () => {
    const [registrations] = affectedArrangements(['preferred_location'], { registrationsCount: 1 }).filter((section) => section.key === 'registrations');
    expect(registrations.items).toEqual(['1 registration record on this event']);
    expect(affectedArrangements(['expected_attendance']).map((section) => section.items)).toEqual([[], [], []]);
    expect(affectedArrangements()).toEqual([]);
    expect(affectedArrangements(['legacy'])).toEqual([]);
  });

  test('TC-1879 [failure] I2 AC3 an event with no status cannot have a change applied; status case does not matter', () => {
    expect(canApplyChange(undefined)).toBe(false);
    expect(canApplyChange('')).toBe(false);
    expect(canApplyChange('planning')).toBe(true);
    expect(canApplyChange('SAFETY_REVIEW')).toBe(false);
  });

  test('TC-1817 [boundary] I1 AC4 / I2 AC4 the notices read sensibly without an event name, fields or reason', () => {
    expect(changeDecisionMessage({ accepted: true })).toBe('Your event: your change request was accepted and applied.');
    expect(changeDecisionMessage({ eventName: 'Forum', accepted: false, reason: '  ' })).toBe('Forum: your change request was declined.');
    expect(changeRequestedMessage({})).toBe('An event has a change request waiting for your decision.');
    expect(changeRequestedMessage({ eventName: 'Forum', fields: ['legacy'] })).toBe('Forum has a change request waiting for your decision: legacy.');
  });
});
