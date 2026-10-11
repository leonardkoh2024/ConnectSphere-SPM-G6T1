import {
  approveEvent,
  canAmendDuringClarification,
  canApproveEvent,
  canOpenReview,
  canRejectEvent,
  canReassignEvent,
  canRequestClarification,
  canRespondToClarification,
  chronologicalClarifications,
  clarificationSummary,
  cleanRequiredText,
  EVENT_TABS,
  initialEventTab,
  submitClarificationResponse,
  buildRequestView,
  contactDetails,
  equipmentList,
  registrationSummary
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

describe('C6 / SCRUM-107 approve a submitted request', () => {
  test('C6-TC1/TC3 the assigned coordinator can approve an under-review event', () => {
    expect(canApproveEvent(event(), 'c1')).toBe(true);
  });

  test('C6-TC2 AC1 approve is unavailable from any status other than Under Review', () => {
    expect(canApproveEvent(event({ status: 'SUBMITTED' }), 'c1')).toBe(false);
    expect(canApproveEvent(event({ status: 'APPROVED' }), 'c1')).toBe(false);
    expect(canApproveEvent(event({ status: 'REJECTED' }), 'c1')).toBe(false);
  });

  test('C6-TC4 AC3 only the assigned coordinator can approve', () => {
    expect(canApproveEvent(event(), 'c2')).toBe(false);
  });

  test('C6-TC5 AC4 approve is blocked while a clarification is open', () => {
    expect(canApproveEvent(event({ open_clarification_id: 'CLR-1' }), 'c1')).toBe(false);
  });

  test('C6-TC6 AC2/AC5 approving sets APPROVED and yields an EVENT_APPROVED history entry', () => {
    const result = approveEvent({ event: event(), userId: 'c1', now: 'T' });
    expect(result.ok).toBe(true);
    expect(result.event.status).toBe('APPROVED');
    expect(result.history.actionType).toBe('EVENT_APPROVED');
    expect(result.history.actorId).toBe('c1');
    expect(result.history.newValue).toBe('APPROVED');
    expect(result.history.createdAt).toBe('T');
  });

  test('C6-TC7 re-approving an already-approved event is a no-op (idempotency)', () => {
    const result = approveEvent({ event: event({ status: 'APPROVED' }), userId: 'c1' });
    expect(result.ok).toBe(false);
    expect(result.event.status).toBe('APPROVED');
  });
});

// The event detail page's two tabs. TC-269 – TC-270 in docs/test-cases.md.
describe('event detail tabs', () => {
  test('TC-269 the Clarifications tab counts the questions asked and knows when an answer is owed', () => {
    expect(clarificationSummary({ event: { open_clarification_id: 'q2' }, clarifications: [{ id: 'q1' }, { id: 'q2' }] }))
      .toEqual({ requests: 2, awaitingOrganiser: true });
    expect(clarificationSummary({ event: { open_clarification_id: null }, clarifications: [] }))
      .toEqual({ requests: 0, awaitingOrganiser: false });
    expect(clarificationSummary(null)).toEqual({ requests: 0, awaitingOrganiser: false });
  });

  test('TC-270 only an organiser who owes an answer starts on Clarifications', () => {
    const awaiting = { event: { open_clarification_id: 'q1' }, clarifications: [{ id: 'q1' }] };
    const answered = { event: { open_clarification_id: null }, clarifications: [{ id: 'q1' }] };

    expect(initialEventTab(awaiting, { organiser: true })).toBe(EVENT_TABS.CLARIFICATIONS);
    expect(initialEventTab(answered, { organiser: true })).toBe(EVENT_TABS.REQUEST);
    expect(initialEventTab(awaiting)).toBe(EVENT_TABS.REQUEST);
    expect(initialEventTab(null, { organiser: true })).toBe(EVENT_TABS.REQUEST);
  });
});

// C3 — the coordinator sees everything the organiser submitted in one place. These
// pure helpers shape the submitted request for the review detail view: organiser
// contact with fallbacks (AC2), the registration gate/window and equipment lines
// (AC1), and buildRequestView that assembles the whole model (AC1 + AC2). SCRUM id
// to be confirmed. C3-TC1 – C3-TC4 in docs/test-cases.md.
describe('C3 see everything the organiser submitted', () => {
  const fullDetail = () => ({
    event: {
      reference_no: 'EVT-001',
      submitted_at: '2026-10-01T03:00:00Z',
      preferred_location: 'CENTRAL',
      required_layout: 'THEATRE',
      facilities: ['WIFI', 'POWER_POINTS'],
      accessibility: ['WHEELCHAIR_ACCESS', 'HEARING_LOOP'],
      accessibility_notes: 'Two wheelchair users expected.',
      equipment_required: 'YES',
      equipment: [{ equipment_type: 'AUDIO', quantity: 2, notes: 'Handheld mics' }, { equipment_type: 'LIGHTING' }],
      registration_required: 'YES',
      registration_capacity: 120,
      registration_open_date: '2026-10-15', registration_open_time: '09:00',
      registration_close_date: '2026-10-30', registration_close_time: '17:00'
    },
    organiser: { name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: '+65 9123 4567' }
  });

  test('C3-TC1 AC2 contactDetails keeps full details and falls back gracefully', () => {
    expect(contactDetails({ name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: '+65 9123 4567' }))
      .toEqual({ name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: '+65 9123 4567' });
    // No name → the email stands in; a contact_number is accepted as the phone.
    expect(contactDetails({ email: 'nadia@smu.edu.sg' })).toEqual({ name: 'nadia@smu.edu.sg', email: 'nadia@smu.edu.sg', phone: null });
    expect(contactDetails({ name: 'Nadia', contact_number: '+65 1111 2222' }).phone).toBe('+65 1111 2222');
    // Nothing at all → a labelled placeholder, never blank.
    expect(contactDetails({})).toEqual({ name: 'Unknown organiser', email: null, phone: null });
    expect(contactDetails()).toEqual({ name: 'Unknown organiser', email: null, phone: null });
  });

  test('C3-TC2 AC1 registrationSummary is null unless registration was asked for', () => {
    expect(registrationSummary({ registration_required: 'NO' })).toBeNull();
    expect(registrationSummary({})).toBeNull();
  });

  test('C3-TC2 AC1 registrationSummary reports capacity and the open/close window', () => {
    expect(registrationSummary(fullDetail().event)).toEqual({
      capacity: 120, opens: '2026-10-15 09:00', closes: '2026-10-30 17:00'
    });
    // A date with no time shows the date alone; a missing side is null.
    expect(registrationSummary({ registration_required: 'YES', registration_open_date: '2026-10-15' }))
      .toEqual({ capacity: null, opens: '2026-10-15', closes: null });
  });

  test('C3-TC3 AC1 equipmentList formats each line with a default quantity of one', () => {
    expect(equipmentList(fullDetail().event)).toEqual([
      { label: 'AUDIO × 2', notes: 'Handheld mics' },
      { label: 'LIGHTING × 1', notes: null }
    ]);
    expect(equipmentList({})).toEqual([]);
    expect(equipmentList()).toEqual([]);
  });

  test('C3-TC4 AC1/AC2 buildRequestView gathers every section the story asks for', () => {
    const view = buildRequestView(fullDetail());
    expect(view.reference).toBe('EVT-001');
    expect(view.submittedAt).toBe('2026-10-01T03:00:00Z');
    expect(view.contact).toMatchObject({ name: 'Nadia Organiser', email: 'nadia@smu.edu.sg' });
    expect(view.venue).toMatchObject({ preferredLocation: 'CENTRAL', layout: 'THEATRE' });
    expect(view.venue.facilities).toEqual(['WIFI', 'POWER_POINTS']);
    expect(view.accessibility.items).toEqual(['WHEELCHAIR_ACCESS', 'HEARING_LOOP']);
    expect(view.accessibility.notes).toBe('Two wheelchair users expected.');
    expect(view.equipment).toEqual([
      { label: 'AUDIO × 2', notes: 'Handheld mics' },
      { label: 'LIGHTING × 1', notes: null }
    ]);
    expect(view.registration).toEqual({ capacity: 120, opens: '2026-10-15 09:00', closes: '2026-10-30 17:00' });
  });

  test('C3-TC4 buildRequestView copes with a bare request and a missing organiser', () => {
    const view = buildRequestView({ event: { reference_no: 'EVT-009' } });
    expect(view.reference).toBe('EVT-009');
    expect(view.submittedAt).toBeNull();
    expect(view.contact).toEqual({ name: 'Unknown organiser', email: null, phone: null });
    expect(view.venue.facilities).toEqual([]);
    expect(view.accessibility.items).toEqual([]);
    expect(view.equipment).toEqual([]);
    expect(view.registration).toBeNull();
  });
});
