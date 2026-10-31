// A7 / SCRUM-170 — the Safety Officer's rules, as plain functions.

import {
  NOT_RECORDED,
  PLANNING_NOTE_MAX,
  SAFETY_OUTCOME,
  SAFETY_OUTCOME_LABEL,
  activeBookings,
  canEditPlanningNotes,
  canRecordSafetyOutcome,
  capacityFact,
  cleanPlanningNotes,
  planningNotesOpen,
  safetyApprovalBlocker,
  safetyNotificationType,
  safetyOutcomeMessage,
  safetyOutcomeStatus,
  safetyQueue,
  shownOrNotRecorded,
  validatePlanningNotes,
  validateSafetyOutcome
} from './safetyReview';
import { EVENT_STATUS } from './eventReview';
import { statusTone } from './events';
import { ROLES } from './roles';

// AC2 — the queue is the events awaiting their check, oldest first (L2 AC1).
test('TC-0120 the queue holds only events in Safety Review, the longest-waiting first', () => {
  const events = [
    { id: 'newer', status: 'SAFETY_REVIEW', updated_at: '2026-10-14T09:00:00.000Z' },
    { id: 'planning', status: 'PLANNING', updated_at: '2026-10-01T09:00:00.000Z' },
    { id: 'older', status: 'SAFETY_REVIEW', updated_at: '2026-10-12T09:00:00.000Z' },
    { id: 'confirmed', status: 'CONFIRMED', updated_at: '2026-10-02T09:00:00.000Z' },
    // When L1 records the moment it was sent, that wins over the last edit.
    { id: 'sent-first', status: 'SAFETY_REVIEW', safety_review_requested_at: '2026-10-10T09:00:00.000Z', updated_at: '2026-10-15T09:00:00.000Z' }
  ];
  expect(safetyQueue(events).map((event) => event.id)).toEqual(['sent-first', 'older', 'newer']);
  expect(safetyQueue([])).toEqual([]);
  expect(safetyQueue(undefined)).toEqual([]);
});

// AC4 — one of three outcomes; Reject and Request changes need a comment (L3 AC2).
test('TC-0121 an outcome is one of the three, and only Approve may go without a comment', () => {
  expect(Object.keys(SAFETY_OUTCOME)).toEqual(['APPROVE', 'REJECT', 'REQUEST_CHANGES']);
  expect(SAFETY_OUTCOME_LABEL).toEqual({ APPROVE: 'Approve', REJECT: 'Reject', REQUEST_CHANGES: 'Request changes' });

  expect(validateSafetyOutcome({ outcome: 'APPROVE', comment: '' })).toBeNull();
  expect(validateSafetyOutcome({ outcome: 'APPROVE' })).toBeNull();
  expect(validateSafetyOutcome({ outcome: 'REJECT', comment: 'Fire exit blocked by staging.' })).toBeNull();
  expect(validateSafetyOutcome({ outcome: 'REQUEST_CHANGES', comment: 'Move the stage.' })).toBeNull();

  const needsComment = 'A comment explaining the concern is required to reject or request changes.';
  expect(validateSafetyOutcome({ outcome: 'REJECT', comment: '' })).toBe(needsComment);
  expect(validateSafetyOutcome({ outcome: 'REJECT', comment: '   \n ' })).toBe(needsComment);
  expect(validateSafetyOutcome({ outcome: 'REQUEST_CHANGES' })).toBe(needsComment);

  const chooseOne = 'Choose an outcome: Approve, Reject or Request changes.';
  expect(validateSafetyOutcome({ outcome: '', comment: 'x' })).toBe(chooseOne);
  expect(validateSafetyOutcome({ outcome: 'CONFIRM', comment: 'x' })).toBe(chooseOne);
});

// AC4 / AC6 — only the Safety Officer, and only on an event in Safety Review (L3 AC5).
test('TC-0122 only the Safety Officer may record an outcome, and only during Safety Review', () => {
  const underReview = { status: 'SAFETY_REVIEW' };
  expect(canRecordSafetyOutcome(underReview, ROLES.SAFETY_OFFICER)).toBe(true);
  Object.values(ROLES).filter((role) => role !== ROLES.SAFETY_OFFICER)
    .forEach((role) => expect(canRecordSafetyOutcome(underReview, role)).toBe(false));
  ['PLANNING', 'CONFIRMED', 'APPROVED', 'CANCELLED', undefined]
    .forEach((status) => expect(canRecordSafetyOutcome({ status }, ROLES.SAFETY_OFFICER)).toBe(false));
  expect(canRecordSafetyOutcome(null, ROLES.SAFETY_OFFICER)).toBe(false);
});

// AC4 — Approve confirms the event; Reject and Request changes return it to
// Planning (L3 AC4, L4 AC1). Approve also needs the approved venue booking the
// event rule checks, so the screen refuses it before Firestore does.
test('TC-0123 Approve moves the event to Confirmed, the others back to Planning', () => {
  expect(safetyOutcomeStatus('APPROVE')).toBe(EVENT_STATUS.CONFIRMED);
  expect(safetyOutcomeStatus('REJECT')).toBe(EVENT_STATUS.PLANNING);
  expect(safetyOutcomeStatus('REQUEST_CHANGES')).toBe(EVENT_STATUS.PLANNING);
  expect(safetyOutcomeStatus('OTHER')).toBeNull();

  expect(safetyApprovalBlocker({ approved_venue_booking_id: 'VB-1' })).toBeNull();
  expect(safetyApprovalBlocker({})).toBe('This event has no approved venue booking, so it cannot be confirmed.');
  expect(safetyApprovalBlocker({ approved_venue_booking_id: '' })).toBe('This event has no approved venue booking, so it cannot be confirmed.');
});

// AC4 / F12 — an event with several venues is confirmed only once every active
// booking is approved; released ones do not count.
test('TC-0124 Approve is refused while any active venue booking is not yet approved', () => {
  const event = { approved_venue_booking_id: 'VB-1' };
  const bookings = [
    { booking_id: 'VB-1', booking_label: 'Main programme', status: 'APPROVED' },
    { booking_id: 'VB-2', booking_label: 'Breakout 1', status: 'PENDING' },
    { booking_id: 'VB-3', booking_label: 'Old room', status: 'RELEASED' }
  ];
  expect(safetyApprovalBlocker(event, bookings))
    .toBe('Every active venue booking must be approved before the event can be confirmed. Not yet approved: Breakout 1.');
  expect(safetyApprovalBlocker(event, [bookings[0], bookings[2]])).toBeNull();
  expect(safetyApprovalBlocker(event, [{ ...bookings[1], booking_label: undefined, venue_id: 'V-2' }]))
    .toBe('Every active venue booking must be approved before the event can be confirmed. Not yet approved: V-2.');
  expect(safetyApprovalBlocker(event, [{ ...bookings[0], replacement_needed: true }]))
    .toBe('Every active venue booking must be approved before the event can be confirmed. Not yet approved: Main programme.');
});

// AC3 — each active booking, with its expected attendance against capacity.
test('TC-0125 only active bookings are reviewed, each with attendance against capacity', () => {
  const bookings = ['APPROVED', 'PENDING', 'RELEASED', 'REPLACED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'released']
    .map((status, index) => ({ booking_id: `b${index}`, status }));
  expect(activeBookings(bookings).map((booking) => booking.booking_id)).toEqual(['b0', 'b1']);
  expect(activeBookings(undefined)).toEqual([]);

  expect(capacityFact({ attendance: 120, capacity: 100 })).toEqual({ attendance: 120, capacity: 100, exceeds: true });
  expect(capacityFact({ attendance: 100, capacity: 100 })).toEqual({ attendance: 100, capacity: 100, exceeds: false });
  // An unrecorded capacity is not a breach: it is shown as not recorded.
  expect(capacityFact({ attendance: 100, capacity: 0 })).toEqual({ attendance: 100, capacity: null, exceeds: false });
  expect(capacityFact({ attendance: undefined, capacity: 80 })).toEqual({ attendance: null, capacity: 80, exceeds: false });
});

// AC4 — what the coordinator and organiser are told, with the comment when there is one.
test('TC-0126 the outcome notice names the event, the result and the comment', () => {
  expect(safetyNotificationType('APPROVE')).toBe('SAFETY_CHECK_APPROVED');
  expect(safetyNotificationType('REJECT')).toBe('SAFETY_CHECK_REJECTED');
  expect(safetyNotificationType('REQUEST_CHANGES')).toBe('SAFETY_CHANGES_REQUESTED');

  expect(safetyOutcomeMessage({ eventName: 'Partner Summit', outcome: 'APPROVE' }))
    .toBe('Partner Summit passed its safety check and is now Confirmed.');
  expect(safetyOutcomeMessage({ eventName: 'Partner Summit', outcome: 'REJECT', comment: ' Exit blocked. ' }))
    .toBe('Partner Summit failed its safety check and is back in Planning. Comment: Exit blocked.');
  expect(safetyOutcomeMessage({ eventName: 'Partner Summit', outcome: 'REQUEST_CHANGES', comment: 'Move the stage.' }))
    .toBe('Partner Summit needs changes before it can pass its safety check and is back in Planning. Comment: Move the stage.');
  expect(safetyOutcomeMessage({ outcome: 'APPROVE' })).toBe('Your event passed its safety check and is now Confirmed.');
});

// AC3 — equipment placement and crowd movement are recorded by the event's
// coordinator while it is being planned, then read by the Safety Officer.
test('TC-0127 the coordinator may record safety planning notes only while planning their own event', () => {
  expect(planningNotesOpen('APPROVED')).toBe(true);
  expect(planningNotesOpen('PLANNING')).toBe(true);
  ['SUBMITTED', 'UNDER_REVIEW', 'SAFETY_REVIEW', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED']
    .forEach((status) => expect(planningNotesOpen(status)).toBe(false));

  const event = { coordinator_id: 'c1', status: 'PLANNING' };
  expect(canEditPlanningNotes(event, 'c1')).toBe(true);
  expect(canEditPlanningNotes(event, 'c2')).toBe(false);
  expect(canEditPlanningNotes({ ...event, status: 'SAFETY_REVIEW' }, 'c1')).toBe(false);

  expect(cleanPlanningNotes({ equipment_placement: '  Speakers by the stage ', crowd_movement: undefined, other: 'x' }))
    .toEqual({ equipment_placement: 'Speakers by the stage', crowd_movement: '' });

  expect(PLANNING_NOTE_MAX).toBe(2000);
  expect(validatePlanningNotes({ equipment_placement: 'a'.repeat(2000), crowd_movement: '' })).toBeNull();
  expect(validatePlanningNotes({ equipment_placement: '', crowd_movement: 'a'.repeat(2001) }))
    .toBe('Each safety planning note must be 2000 characters or fewer.');
});

// AC3 — a fact nobody has recorded says so, rather than showing a blank.
test('TC-0128 Safety Review is a status of its own, and an unrecorded fact reads "Not recorded"', () => {
  expect(EVENT_STATUS.SAFETY_REVIEW).toBe('SAFETY_REVIEW');
  expect(EVENT_STATUS.CONFIRMED).toBe('CONFIRMED');
  expect(statusTone('SAFETY_REVIEW')).toBe('warning');

  expect(NOT_RECORDED).toBe('Not recorded');
  expect(shownOrNotRecorded('Exit via the loading bay')).toBe('Exit via the loading bay');
  expect(shownOrNotRecorded('   ')).toBe('Not recorded');
  expect(shownOrNotRecorded(null)).toBe('Not recorded');
});

describe('A7 / L2–L4 safety rule edges', () => {
  test('TC-0129 [boundary] an empty or missing queue is empty; events with no times wait from the start', () => {
    expect(safetyQueue(null)).toEqual([]);
    expect(safetyQueue()).toEqual([]);
    const queue = safetyQueue([
      { event_id: 'B', status: EVENT_STATUS.SAFETY_REVIEW, updated_at: '2026-10-02' },
      { event_id: 'A', status: EVENT_STATUS.SAFETY_REVIEW }
    ]);
    expect(queue.map((event) => event.event_id)).toEqual(['A', 'B']);
  });

  test('TC-0130 [failure] no outcome given is refused; Approve may carry no comment at all', () => {
    expect(validateSafetyOutcome()).toBe('Choose an outcome: Approve, Reject or Request changes.');
    expect(validateSafetyOutcome({ outcome: SAFETY_OUTCOME.APPROVE })).toBeNull();
    expect(validateSafetyOutcome({ outcome: SAFETY_OUTCOME.REJECT })).toMatch(/comment explaining the concern is required/);
    expect(safetyOutcomeStatus('CONFIRM')).toBeNull();
    expect(safetyNotificationType('CONFIRM')).toBeNull();
  });

  test('TC-0131 [boundary] active bookings: none, a status-less one, and a rejection awaiting a replacement', () => {
    expect(activeBookings()).toEqual([]);
    expect(activeBookings(null)).toEqual([]);
    const bookings = [{ booking_id: 'NEW' }, { booking_id: 'LOST', status: 'REJECTED', replacement_needed: true }, { booking_id: 'GONE', status: 'REJECTED' }];
    expect(activeBookings(bookings).map((booking) => booking.booking_id)).toEqual(['NEW', 'LOST']);
    // A booking with no status is not yet approved, and is named by its id.
    expect(safetyApprovalBlocker({ approved_venue_booking_id: 'VB-1' }, [{ booking_id: 'NEW' }]))
      .toBe('Every active venue booking must be approved before the event can be confirmed. Not yet approved: NEW.');
  });

  test('TC-0132 [boundary] the outcome message for an unnamed event, with and without a comment', () => {
    expect(safetyOutcomeMessage({ outcome: SAFETY_OUTCOME.REQUEST_CHANGES }))
      .toBe('Your event needs changes before it can pass its safety check and is back in Planning.');
    expect(safetyOutcomeMessage({ eventName: 'Summit', outcome: SAFETY_OUTCOME.REJECT, comment: '  ' }))
      .toBe('Summit failed its safety check and is back in Planning.');
  });

  test('TC-0133 [boundary] planning notes with nothing given are empty and valid', () => {
    expect(cleanPlanningNotes()).toEqual({ equipment_placement: '', crowd_movement: '' });
    expect(cleanPlanningNotes(null)).toEqual({ equipment_placement: '', crowd_movement: '' });
    expect(validatePlanningNotes()).toBeNull();
    expect(validatePlanningNotes(null)).toBeNull();
    expect(validatePlanningNotes({ equipment_placement: 'x'.repeat(PLANNING_NOTE_MAX) })).toBeNull();
    expect(validatePlanningNotes({ crowd_movement: 'x'.repeat(PLANNING_NOTE_MAX + 1) })).toMatch(/2000 characters or fewer/);
  });
});
