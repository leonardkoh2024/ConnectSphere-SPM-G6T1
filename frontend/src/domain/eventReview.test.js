import {
  canAmendDuringClarification,
  canOpenReview,
  canRejectEvent,
  canReassignEvent,
  canRequestClarification,
  canRespondToClarification,
  chronologicalClarifications,
  cleanRequiredText,
  submitClarificationResponse
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

describe('C5 / SCRUM-106 respond to a request for clarification', () => {
  const openEvent = (changes = {}) => event({
    event_id: 'EVT-1', organiser_id: 'u1', expected_attendance: 100,
    open_clarification_id: 'CLR-001', ...changes
  });
  const openClarification = (changes = {}) => ({
    clarification_id: 'CLR-001', event_id: 'EVT-1', created_by: 'c1',
    message: 'Confirm expected attendance', status: 'OPEN', created_at: '2026-09-23T10:00:00',
    ...changes
  });

  test('TC-081 AC1 the organiser can amend a field and answer while the clarification is open', () => {
    const result = submitClarificationResponse({
      event: openEvent(), clarification: openClarification(), userId: 'u1',
      message: 'Confirmed, 150 people.', fieldEdits: { expected_attendance: 150 }
    });
    expect(result.ok).toBe(true);
    expect(result.event.expected_attendance).toBe(150);
    expect(result.responses[0].message).toBe('Confirmed, 150 people.');
  });

  test('TC-082 AC1 an empty response cannot be submitted', () => {
    const result = submitClarificationResponse({
      event: openEvent(), clarification: openClarification(), userId: 'u1', message: '   '
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty');
    expect(result.clarification.status).toBe('OPEN');
  });

  test('TC-083 AC2 submitting the response closes the clarification as ANSWERED', () => {
    const result = submitClarificationResponse({
      event: openEvent(), clarification: openClarification(), userId: 'u1', message: 'Confirmed.'
    });
    expect(result.ok).toBe(true);
    expect(result.clarification.status).toBe('ANSWERED');
    expect(result.event.open_clarification_id).toBeNull();
    expect(result.event.status).toBe('UNDER_REVIEW');
  });

  test('TC-084 the event stays Under Review across the exchange', () => {
    expect(openEvent().status).toBe('UNDER_REVIEW');
    const result = submitClarificationResponse({
      event: openEvent(), clarification: openClarification(), userId: 'u1', message: 'Confirmed.'
    });
    expect(result.event.status).toBe('UNDER_REVIEW');
  });

  test('TC-085 a closed clarification cannot be answered twice', () => {
    expect(canRespondToClarification(openEvent({ open_clarification_id: null }), openClarification({ status: 'ANSWERED' }), 'u1')).toBe(false);
  });

  test('TC-086 only the organiser the question was asked of may answer it', () => {
    const result = submitClarificationResponse({
      event: openEvent(), clarification: openClarification(), userId: 'u2', message: 'Not mine.'
    });
    expect(result.ok).toBe(false);
    expect(result.clarification.status).toBe('OPEN');
  });

  test('TC-087 both parties see the exchange oldest first', () => {
    const thread = chronologicalClarifications(
      [openClarification()],
      [{ clarification_id: 'CLR-001', message: 'Confirmed.', created_at: '2026-09-23T11:00:00' }]
    );
    expect(thread.map(({ kind }) => kind)).toEqual(['QUESTION', 'RESPONSE']);
  });

  test('canAmendDuringClarification is true only while a clarification is open', () => {
    expect(canAmendDuringClarification(openEvent())).toBe(true);
    expect(canAmendDuringClarification(openEvent({ open_clarification_id: null }))).toBe(false);
    expect(canAmendDuringClarification(openEvent({ status: 'SUBMITTED' }))).toBe(false);
  });
});
