import {
  canOpenReview,
  canRejectEvent,
  canReassignEvent,
  canRequestClarification,
  chronologicalClarifications,
  cleanRequiredText
} from './eventReview';

const event = (changes = {}) => ({ coordinator_id: 'c1', status: 'UNDER_REVIEW', ...changes });

describe('C4 clarification workflow', () => {
  test('TC-060 accepts a non-empty message and TC-061 trims/blocks an empty one', () => {
    expect(cleanRequiredText(' Please confirm attendance. ')).toBe('Please confirm attendance.');
    expect(cleanRequiredText('   ')).toBe('');
  });

  test('TC-062/063 only the current coordinator can ask, only in review, and only once', () => {
    expect(canRequestClarification(event(), 'c1')).toBe(true);
    expect(canRequestClarification(event({ open_clarification_id: 'CLR-1' }), 'c1')).toBe(false);
    expect(canRequestClarification(event(), 'c2')).toBe(false);
    expect(canRequestClarification(event({ status: 'SUBMITTED' }), 'c1')).toBe(false);
    expect(canRejectEvent(event({ open_clarification_id: 'CLR-1' }), 'c1')).toBe(false);
  });

  test('the retained exchange is presented oldest first', () => {
    const result = chronologicalClarifications(
      [{ id: 'q1', created_at: '2026-09-23T10:00:00Z' }],
      [{ id: 'a1', created_at: '2026-09-23T11:00:00Z' }]
    );
    expect(result.map(({ kind }) => kind)).toEqual(['QUESTION', 'RESPONSE']);
  });
});

describe('C7 and C9 workflow boundaries', () => {
  test('TC-072 rejection is unavailable while a clarification is open', () => {
    expect(canRejectEvent(event(), 'c1')).toBe(true);
    expect(canRejectEvent(event({ open_clarification_id: 'CLR-1' }), 'c1')).toBe(false);
  });

  test('opening a submitted assignment starts review', () => {
    expect(canOpenReview(event({ status: 'SUBMITTED' }), 'c1')).toBe(true);
    expect(canOpenReview(event({ status: 'SUBMITTED' }), 'c2')).toBe(false);
  });

  test('TC-077/080 reassignment needs the current coordinator and another active target', () => {
    expect(canReassignEvent(event(), 'c1', { id: 'c2', active: true })).toBe(true);
    expect(canReassignEvent(event(), 'c3', { id: 'c2', active: true })).toBe(false);
    expect(canReassignEvent(event(), 'c1', { id: 'c2', active: false })).toBe(false);
    expect(canReassignEvent(event(), 'c1', { id: 'c1', active: true })).toBe(false);
  });

  test.each(['COMPLETED', 'CANCELLED', 'REJECTED'])('terminal %s events cannot be reassigned', (status) => {
    expect(canReassignEvent(event({ status }), 'c1', { id: 'c2', active: true })).toBe(false);
  });
});
