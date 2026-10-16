// A7 / SCRUM-170 — the Safety Officer's rules, as plain functions. TC-348 to
// TC-355 in docs/test-cases.md.

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
test('TC-348 the queue holds only events in Safety Review, the longest-waiting first', () => {
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
test('TC-349 an outcome is one of the three, and only Approve may go without a comment', () => {
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
test('TC-350 only the Safety Officer may record an outcome, and only during Safety Review', () => {
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
test('TC-351 Approve moves the event to Confirmed, the others back to Planning', () => {
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
test('TC-381 Approve is refused while any active venue booking is not yet approved', () => {
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
});

// AC3 — each active booking, with its expected attendance against capacity.
test('TC-352 only active bookings are reviewed, each with attendance against capacity', () => {
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
test('TC-353 the outcome notice names the event, the result and the comment', () => {
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
test('TC-354 the coordinator may record safety planning notes only while planning their own event', () => {
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
test('TC-355 Safety Review is a status of its own, and an unrecorded fact reads "Not recorded"', () => {
  expect(EVENT_STATUS.SAFETY_REVIEW).toBe('SAFETY_REVIEW');
  expect(EVENT_STATUS.CONFIRMED).toBe('CONFIRMED');
  expect(statusTone('SAFETY_REVIEW')).toBe('warning');

  expect(NOT_RECORDED).toBe('Not recorded');
  expect(shownOrNotRecorded('Exit via the loading bay')).toBe('Exit via the loading bay');
  expect(shownOrNotRecorded('   ')).toBe('Not recorded');
  expect(shownOrNotRecorded(null)).toBe('Not recorded');
});
