import {
  approveEvent,
  canAmendDuringClarification,
  canApproveEvent,
  canOpenReview,
  canRejectEvent,
  canCancelEvent,
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
  registrationSummary,
  canAssignCoordinator,
  canLeadReassign,
  supervisesAllEvents,
  coordinatorWorkload,
  unassignedQueue,
  leadVisibleEvents,
  assignEvent,
  assignmentSummary,
  coordinatorChoiceLabel,
  reassignEvent,
  EVENT_STATUS,
  isActiveEvent,
  lastActivityAt,
  timeSinceLastActivity,
  oversightRows,
  oversightCoordinators,
  formatSinceActivity,
  oversightSummary
} from './eventReview';
import * as eventReviewModule from './eventReview';
import { ROLES } from './roles';
import { canFindVenues, isCurrentCoordinator, isTerminal } from './eventReview';

const event = (changes = {}) => ({ coordinator_id: 'c1', status: 'UNDER_REVIEW', ...changes });

describe('C4 clarification workflow', () => {
  test('TC-0359 accepts a non-empty message and trims/blocks an empty one', () => {
    expect(cleanRequiredText(' Please confirm attendance. ')).toBe('Please confirm attendance.');
    expect(cleanRequiredText('   ')).toBe('');
  });

  test('TC-0360 /063 only the current coordinator can ask, only in review, and only once', () => {
    expect(canRequestClarification(event(), 'c1')).toBe(true);
    expect(canRequestClarification(event({ open_clarification_id: 'CLR-1' }), 'c1')).toBe(false);
    expect(canRequestClarification(event(), 'c2')).toBe(false);
    expect(canRequestClarification(event({ status: 'SUBMITTED' }), 'c1')).toBe(false);
    expect(canRejectEvent(event({ open_clarification_id: 'CLR-1' }), 'c1')).toBe(false);
  });

  test('TC-0361 the retained exchange is presented oldest first', () => {
    const result = chronologicalClarifications(
      [{ id: 'q1', created_at: '2026-09-23T10:00:00Z' }],
      [{ id: 'a1', created_at: '2026-09-23T11:00:00Z' }]
    );
    expect(result.map(({ kind }) => kind)).toEqual(['QUESTION', 'RESPONSE']);
  });
});

describe('C7 and C9 workflow boundaries', () => {
  test('TC-0412 rejection is unavailable while a clarification is open', () => {
    expect(canRejectEvent(event(), 'c1')).toBe(true);
    expect(canRejectEvent(event({ open_clarification_id: 'CLR-1' }), 'c1')).toBe(false);
  });

  test('TC-0413 opening a submitted assignment starts review', () => {
    expect(canOpenReview(event({ status: 'SUBMITTED' }), 'c1')).toBe(true);
    expect(canOpenReview(event({ status: 'SUBMITTED' }), 'c2')).toBe(false);
  });

  // K3 / SCRUM-184 replaces C9 criterion 5: the Lead, not the coordinator in charge,
  // reassigns. The old coordinator-side guard (canReassignEvent) is gone.
  test('TC-2302 K3 (replaces C9 criterion 5) a coordinator, even the one in charge, has no reassign guard', () => {
    expect(eventReviewModule.canReassignEvent).toBeUndefined();
    expect(canLeadReassign(event(), ROLES.COORDINATOR, { id: 'c2', active: true })).toBe(false);
  });
});

describe('D4 cancellation workflow', () => {
  test('TC-0517 only the assigned coordinator can cancel a non-terminal event', () => {
    ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PLANNING', 'SAFETY_REVIEW', 'CONFIRMED']
      .forEach((status) => expect(canCancelEvent(event({ status }), 'c1')).toBe(true));
    ['DRAFT', 'COMPLETED', 'CANCELLED', 'REJECTED']
      .forEach((status) => expect(canCancelEvent(event({ status }), 'c1')).toBe(false));
    expect(canCancelEvent(event(), 'c2')).toBe(false);
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

  test('TC-0377 AC1 the organiser can amend a field and answer while the clarification is open', () => {
    const result = submitClarificationResponse({
      event: openEvent(), clarification: openClarification(), userId: 'u1',
      message: 'Confirmed, 150 people.', fieldEdits: { expected_attendance: 150 }
    });
    expect(result.ok).toBe(true);
    expect(result.event.expected_attendance).toBe(150);
    expect(result.responses[0].message).toBe('Confirmed, 150 people.');
  });

  test('TC-0378 AC1 an empty response cannot be submitted', () => {
    const result = submitClarificationResponse({
      event: openEvent(), clarification: openClarification(), userId: 'u1', message: '   '
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty');
    expect(result.clarification.status).toBe('OPEN');
  });

  test('TC-0379 AC2 submitting the response closes the clarification as ANSWERED', () => {
    const result = submitClarificationResponse({
      event: openEvent(), clarification: openClarification(), userId: 'u1', message: 'Confirmed.'
    });
    expect(result.ok).toBe(true);
    expect(result.clarification.status).toBe('ANSWERED');
    expect(result.event.open_clarification_id).toBeNull();
    expect(result.event.status).toBe('UNDER_REVIEW');
  });

  test('TC-0380 the event stays Under Review across the exchange', () => {
    expect(openEvent().status).toBe('UNDER_REVIEW');
    const result = submitClarificationResponse({
      event: openEvent(), clarification: openClarification(), userId: 'u1', message: 'Confirmed.'
    });
    expect(result.event.status).toBe('UNDER_REVIEW');
  });

  test('TC-0381 a closed clarification cannot be answered twice', () => {
    expect(canRespondToClarification(openEvent({ open_clarification_id: null }), openClarification({ status: 'ANSWERED' }), 'u1')).toBe(false);
  });

  test('TC-0382 only the organiser the question was asked of may answer it', () => {
    const result = submitClarificationResponse({
      event: openEvent(), clarification: openClarification(), userId: 'u2', message: 'Not mine.'
    });
    expect(result.ok).toBe(false);
    expect(result.clarification.status).toBe('OPEN');
  });

  test('TC-0383 both parties see the exchange oldest first', () => {
    const thread = chronologicalClarifications(
      [openClarification()],
      [{ clarification_id: 'CLR-001', message: 'Confirmed.', created_at: '2026-09-23T11:00:00' }]
    );
    expect(thread.map(({ kind }) => kind)).toEqual(['QUESTION', 'RESPONSE']);
  });

  // Migrated from the root test.js (C5), which tested its own copy of this helper.
  test('TC-0384 AC3 a second round appends to the history, which keeps both questions and both answers in order', () => {
    const first = submitClarificationResponse({
      event: openEvent(), clarification: openClarification(), userId: 'u1', message: 'First answer', now: '2026-09-23T11:00:00'
    });
    const second = openClarification({ clarification_id: 'CLR-002', message: 'Also confirm the layout', created_at: '2026-09-23T12:00:00' });
    const result = submitClarificationResponse({
      event: { ...first.event, open_clarification_id: 'CLR-002' }, clarification: second, responses: first.responses,
      userId: 'u1', message: 'Second answer', now: '2026-09-23T13:00:00'
    });

    expect(result.responses.map((item) => item.message)).toEqual(['First answer', 'Second answer']);
    const thread = chronologicalClarifications([openClarification(), second], result.responses);
    expect(thread.map(({ kind }) => kind)).toEqual(['QUESTION', 'RESPONSE', 'QUESTION', 'RESPONSE']);
  });

  test('TC-0385 canAmendDuringClarification is true only while a clarification is open', () => {
    expect(canAmendDuringClarification(openEvent())).toBe(true);
    expect(canAmendDuringClarification(openEvent({ open_clarification_id: null }))).toBe(false);
    expect(canAmendDuringClarification(openEvent({ status: 'SUBMITTED' }))).toBe(false);
  });
});

describe('C6 / SCRUM-107 approve a submitted request', () => {
  test('TC-0396 C6/TC3 the assigned coordinator can approve an under-review event', () => {
    expect(canApproveEvent(event(), 'c1')).toBe(true);
  });

  test('TC-0397 C6 AC1 approve is unavailable from any status other than Under Review', () => {
    expect(canApproveEvent(event({ status: 'SUBMITTED' }), 'c1')).toBe(false);
    expect(canApproveEvent(event({ status: 'APPROVED' }), 'c1')).toBe(false);
    expect(canApproveEvent(event({ status: 'REJECTED' }), 'c1')).toBe(false);
  });

  test('TC-0398 C6 AC3 only the assigned coordinator can approve', () => {
    expect(canApproveEvent(event(), 'c2')).toBe(false);
  });

  test('TC-0399 C6 AC4 approve is blocked while a clarification is open', () => {
    expect(canApproveEvent(event({ open_clarification_id: 'CLR-1' }), 'c1')).toBe(false);
  });

  test('TC-0400 C6 AC2/AC5 approving sets APPROVED and yields an EVENT_APPROVED history entry', () => {
    const result = approveEvent({ event: event(), userId: 'c1', now: 'T' });
    expect(result.ok).toBe(true);
    expect(result.event.status).toBe('APPROVED');
    expect(result.history.actionType).toBe('EVENT_APPROVED');
    expect(result.history.actorId).toBe('c1');
    expect(result.history.newValue).toBe('APPROVED');
    expect(result.history.createdAt).toBe('T');
  });

  test('TC-0401 C6 re-approving an already-approved event is a no-op (idempotency)', () => {
    const result = approveEvent({ event: event({ status: 'APPROVED' }), userId: 'c1' });
    expect(result.ok).toBe(false);
    expect(result.event.status).toBe('APPROVED');
  });
});

// The event detail page's two tabs.
describe('event detail tabs', () => {
  test('TC-2338 the Clarifications tab counts the questions asked and knows when an answer is owed', () => {
    expect(clarificationSummary({ event: { open_clarification_id: 'q2' }, clarifications: [{ id: 'q1' }, { id: 'q2' }] }))
      .toEqual({ requests: 2, awaitingOrganiser: true });
    expect(clarificationSummary({ event: { open_clarification_id: null }, clarifications: [] }))
      .toEqual({ requests: 0, awaitingOrganiser: false });
    expect(clarificationSummary(null)).toEqual({ requests: 0, awaitingOrganiser: false });
  });

  test('TC-2339 only an organiser who owes an answer starts on Clarifications', () => {
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
// to be confirmed.
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

  test('TC-0341 C3 AC2 contactDetails keeps full details and falls back gracefully', () => {
    expect(contactDetails({ name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: '+65 9123 4567' }))
      .toEqual({ name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: '+65 9123 4567' });
    // No name → the email stands in; a contact_number is accepted as the phone.
    expect(contactDetails({ email: 'nadia@smu.edu.sg' })).toEqual({ name: 'nadia@smu.edu.sg', email: 'nadia@smu.edu.sg', phone: null });
    expect(contactDetails({ name: 'Nadia', contact_number: '+65 1111 2222' }).phone).toBe('+65 1111 2222');
    // Nothing at all → a labelled placeholder, never blank.
    expect(contactDetails({})).toEqual({ name: 'Unknown organiser', email: null, phone: null });
    expect(contactDetails()).toEqual({ name: 'Unknown organiser', email: null, phone: null });
  });

  test('TC-0342 C3 AC1 registrationSummary is null unless registration was asked for', () => {
    expect(registrationSummary({ registration_required: 'NO' })).toBeNull();
    expect(registrationSummary({})).toBeNull();
  });

  test('TC-0343 C3 AC1 registrationSummary reports capacity and the open/close window', () => {
    expect(registrationSummary(fullDetail().event)).toEqual({
      capacity: 120, opens: '2026-10-15 09:00', closes: '2026-10-30 17:00'
    });
    // A date with no time shows the date alone; a missing side is null.
    expect(registrationSummary({ registration_required: 'YES', registration_open_date: '2026-10-15' }))
      .toEqual({ capacity: null, opens: '2026-10-15', closes: null });
  });

  test('TC-0344 C3 AC1 equipmentList formats each line with a default quantity of one', () => {
    expect(equipmentList(fullDetail().event)).toEqual([
      { label: 'AUDIO × 2', notes: 'Handheld mics' },
      { label: 'LIGHTING × 1', notes: null }
    ]);
    expect(equipmentList({})).toEqual([]);
    expect(equipmentList()).toEqual([]);
  });

  test('TC-0345 C3 AC1/AC2 buildRequestView gathers every section the story asks for', () => {
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

  test('TC-0346 C3 buildRequestView copes with a bare request and a missing organiser', () => {
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

describe('A6 Event Coordinator Lead oversight and assignment', () => {
  const LEAD = ROLES.COORDINATOR_LEAD;
  const target = { id: 'c2', name: 'Alex Coordinator', active: true };

  test('TC-0081 A6 AC3 only the Lead supervises all events', () => {
    expect(supervisesAllEvents(LEAD)).toBe(true);
    expect(supervisesAllEvents(ROLES.COORDINATOR)).toBe(false);
    expect(supervisesAllEvents(ROLES.ORGANISER)).toBe(false);
    expect(supervisesAllEvents(undefined)).toBe(false);
  });

  test('TC-0082 A6 AC2 the Lead assigns a coordinator to an unassigned event', () => {
    const unassigned = event({ coordinator_id: null, status: 'SUBMITTED' });
    expect(canAssignCoordinator(unassigned, LEAD, target)).toBe(true);
    // Only the Lead may assign.
    expect(canAssignCoordinator(unassigned, ROLES.COORDINATOR, target)).toBe(false);
    // An already-assigned event is a reassignment, not an assignment.
    expect(canAssignCoordinator(event({ coordinator_id: 'c1' }), LEAD, target)).toBe(false);
    // A terminal event cannot be assigned.
    expect(canAssignCoordinator(event({ coordinator_id: null, status: 'CANCELLED' }), LEAD, target)).toBe(false);
    // The target must be an active coordinator.
    expect(canAssignCoordinator(unassigned, LEAD, { id: 'c2', active: false })).toBe(false);
    expect(canAssignCoordinator(unassigned, LEAD, { name: 'no id' })).toBe(false);
  });

  test('TC-0083 A6 AC2 the Lead reassigns any assigned event to a different active coordinator', () => {
    const assigned = event({ coordinator_id: 'c1', status: 'UNDER_REVIEW' });
    expect(canLeadReassign(assigned, LEAD, target)).toBe(true);
    // A coordinator is not a Lead — the existing coordinator-only reassign still governs them.
    expect(canLeadReassign(assigned, ROLES.COORDINATOR, target)).toBe(false);
    // Cannot reassign to the coordinator who already holds it.
    expect(canLeadReassign(assigned, LEAD, { id: 'c1', active: true })).toBe(false);
    // An unassigned event is an assignment, not a reassignment.
    expect(canLeadReassign(event({ coordinator_id: null }), LEAD, target)).toBe(false);
    // Terminal events cannot be reassigned.
    expect(canLeadReassign(event({ status: 'REJECTED' }), LEAD, target)).toBe(false);
    // The target must be active.
    expect(canLeadReassign(assigned, LEAD, { id: 'c2', active: false })).toBe(false);
  });

  test('TC-0084 A6 AC3 coordinatorWorkload counts active events per coordinator, least-loaded first', () => {
    const coordinators = [
      { id: 'c1', name: 'Sam' },
      { id: 'c2', name: 'Alex' },
      { id: 'c3', name: 'Priya' }
    ];
    const events = [
      event({ coordinator_id: 'c1', status: 'UNDER_REVIEW' }),
      event({ coordinator_id: 'c1', status: 'APPROVED' }),
      event({ coordinator_id: 'c2', status: 'UNDER_REVIEW' }),
      event({ coordinator_id: 'c1', status: 'CANCELLED' }), // terminal → not counted
      event({ coordinator_id: null, status: 'SUBMITTED' })  // unassigned → not counted
    ];
    expect(coordinatorWorkload(events, coordinators)).toEqual([
      { id: 'c3', name: 'Priya', activeEvents: 0 },
      { id: 'c2', name: 'Alex', activeEvents: 1 },
      { id: 'c1', name: 'Sam', activeEvents: 2 }
    ]);
    expect(coordinatorWorkload([], coordinators).every((item) => item.activeEvents === 0)).toBe(true);
    expect(coordinatorWorkload()).toEqual([]);
  });
});

describe('K1 SCRUM-182 the unassigned queue', () => {
  const waiting = (id, submitted_at, extra = {}) => ({ id, coordinator_id: null, status: 'SUBMITTED', submitted_at, ...extra });

  test('TC-2267 K1 AC3 waiting events are listed oldest submission first', () => {
    const events = [
      waiting('e-new', '2026-03-10T09:00:00Z'),
      waiting('e-old', '2026-03-01T09:00:00Z'),
      waiting('e-mid', '2026-03-05T09:00:00Z')
    ];
    expect(unassignedQueue(events).map((e) => e.id)).toEqual(['e-old', 'e-mid', 'e-new']);
  });

  test('TC-2268 K1 AC4 an event leaves the queue as soon as it has a coordinator', () => {
    const events = [
      waiting('e1', '2026-03-01T09:00:00Z'),
      waiting('e2', '2026-03-02T09:00:00Z', { coordinator_id: 'c1' })
    ];
    expect(unassignedQueue(events).map((e) => e.id)).toEqual(['e1']);
  });

  test('TC-2269 K1 AC3 a terminal event is not a waiting event', () => {
    const events = [
      waiting('e1', '2026-03-01T09:00:00Z'),
      waiting('e2', '2026-03-02T09:00:00Z', { status: 'CANCELLED' })
    ];
    expect(unassignedQueue(events).map((e) => e.id)).toEqual(['e1']);
  });

  test('TC-2270 K1 no events means an empty queue', () => {
    expect(unassignedQueue()).toEqual([]);
    expect(unassignedQueue([])).toEqual([]);
  });

  test('TC-2271 K1 AC a draft is not yet submitted, so it never reaches the Lead queue', () => {
    const events = [
      waiting('e1', '2026-03-01T09:00:00Z'),
      { id: 'e2-draft', coordinator_id: null, status: 'DRAFT', submitted_at: null }
    ];
    expect(unassignedQueue(events).map((e) => e.id)).toEqual(['e1']);
  });

  test('TC-2272 K1 AC the Lead board carries every submitted event but no draft, in either view', () => {
    const events = [
      { id: 'sub', status: 'SUBMITTED', coordinator_id: null },
      { id: 'rev', status: 'UNDER_REVIEW', coordinator_id: 'c1' },
      { id: 'done', status: 'COMPLETED', coordinator_id: 'c1' },
      { id: 'dft', status: 'DRAFT', coordinator_id: null }
    ];
    expect(leadVisibleEvents(events).map((e) => e.id)).toEqual(['sub', 'rev', 'done']);
  });
});

describe('K2 SCRUM-183 assign an event to a coordinator', () => {
  const organiser = { name: 'Nadia Organiser', email: 'nadia@connectsphere.com' };
  const unassigned = {
    id: 'EVT-1', coordinator_id: null, status: 'SUBMITTED', organiser_id: 'org-1',
    name: 'Gala', purpose: 'Fundraiser', event_date: '2026-05-01',
    start_time: '18:00', end_time: '21:00', expected_attendance: 120
  };
  const target = { id: 'c2', name: 'Alex', active: true };
  const LEAD = ROLES.COORDINATOR_LEAD;

  test('TC-2283 K2 AC1 the read-only summary carries the event basics and the organiser', () => {
    const summary = assignmentSummary(unassigned, organiser);
    expect(summary).toMatchObject({
      name: 'Gala', purpose: 'Fundraiser', eventDate: '2026-05-01',
      startTime: '18:00', endTime: '21:00', expectedAttendance: 120
    });
    expect(summary.organiser.name).toBe('Nadia Organiser');
  });

  test('TC-2284 K2 AC2 each coordinator choice shows its number of active events', () => {
    expect(coordinatorChoiceLabel({ name: 'Alex', activeEvents: 3 })).toBe('Alex (3 active)');
    expect(coordinatorChoiceLabel({ name: 'Priya', activeEvents: 0 })).toBe('Priya (0 active)');
  });

  test('TC-2285 K2 AC3 assignment sets exactly one coordinator and records coordinator, Lead and timestamp', () => {
    const result = assignEvent({ event: unassigned, role: LEAD, leadId: 'lead-1', target, now: 'T1' });
    expect(result.ok).toBe(true);
    expect(result.event.coordinator_id).toBe('c2');
    expect(result.event.assigned_at).toBe('T1');
    expect(result.history).toMatchObject({
      actionType: 'COORDINATOR_ASSIGNED', newValue: 'c2', actorId: 'lead-1', createdAt: 'T1'
    });
  });

  test('TC-2286 K2 AC4 both the assigned coordinator and the organiser are notified', () => {
    const result = assignEvent({ event: unassigned, role: LEAD, leadId: 'lead-1', target, now: 'T1' });
    const recipients = result.notifications.map((item) => item.userId);
    expect(recipients).toContain('c2');
    expect(recipients).toContain('org-1');
  });

  test('TC-2287 K2 AC5 an already-assigned event cannot be assigned again, and only the Lead may assign', () => {
    const assigned = { ...unassigned, coordinator_id: 'c1', status: 'UNDER_REVIEW' };
    expect(assignEvent({ event: assigned, role: LEAD, leadId: 'lead-1', target, now: 'T1' }).ok).toBe(false);
    expect(assignEvent({ event: unassigned, role: ROLES.COORDINATOR, leadId: 'lead-1', target, now: 'T1' }).ok).toBe(false);
  });

  test('TC-2288 K2 AC3 boundary no coordinator chosen is refused and sets nothing', () => {
    const result = assignEvent({ event: unassigned, role: LEAD, leadId: 'lead-1', target: null, now: 'T1' });
    expect(result.ok).toBe(false);
    expect(result.event).toBeUndefined();
  });

  test('TC-2289 K2 AC5 boundary a terminal event cannot be assigned even with no coordinator yet', () => {
    const cancelled = { ...unassigned, status: 'CANCELLED' };
    const rejected = { ...unassigned, status: 'REJECTED' };
    expect(assignEvent({ event: cancelled, role: LEAD, leadId: 'lead-1', target, now: 'T1' }).ok).toBe(false);
    expect(assignEvent({ event: rejected, role: LEAD, leadId: 'lead-1', target, now: 'T1' }).ok).toBe(false);
  });

  test('TC-2290 K2 AC2 boundary an inactive coordinator cannot be assigned', () => {
    const inactive = { id: 'c9', name: 'Bo', active: false };
    expect(assignEvent({ event: unassigned, role: LEAD, leadId: 'lead-1', target: inactive, now: 'T1' }).ok).toBe(false);
  });
});

// K3 / SCRUM-184 — the Lead moves an event to a different coordinator. These pin
// the single pure outcome (reassignEvent) the adapter will follow, exactly as K2's
// assignEvent does for assignment: the guard (AC1/AC2), the one-coordinator result
// and the retained previous assignment (AC3), the outgoing coordinator losing every
// coordinator action (AC4), and the three people told (AC5).
describe('K3 SCRUM-184 reassign an event to another coordinator', () => {
  const LEAD = ROLES.COORDINATOR_LEAD;
  const assigned = {
    id: 'EVT-2', coordinator_id: 'c1', assigned_at: 'T0', status: 'UNDER_REVIEW',
    organiser_id: 'org-1', name: 'Workshop'
  };
  const target = { id: 'c2', name: 'Alex', active: true };
  const reassign = (overrides = {}) =>
    reassignEvent({ event: assigned, role: LEAD, leadId: 'lead-1', target, now: 'T1', ...overrides });

  test('TC-2303 K3 AC1 the Lead can reassign an event in any status except Completed, Cancelled or Rejected', () => {
    ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PLANNING'].forEach((status) => {
      expect(reassign({ event: { ...assigned, status } }).ok).toBe(true);
    });
    ['COMPLETED', 'CANCELLED', 'REJECTED'].forEach((status) => {
      expect(reassign({ event: { ...assigned, status } }).ok).toBe(false);
    });
  });

  test('TC-2304 K3 AC1 only the Lead may reassign, and only an event that already has a coordinator', () => {
    expect(reassign({ role: ROLES.COORDINATOR }).ok).toBe(false);
    expect(reassign({ role: ROLES.ORGANISER }).ok).toBe(false);
    // An event with no coordinator is an assignment (K2), not a reassignment.
    expect(reassign({ event: { ...assigned, coordinator_id: null } }).ok).toBe(false);
  });

  test('TC-2305 K3 AC2 reassigning to the coordinator who already holds the event is refused', () => {
    const result = reassign({ target: { id: 'c1', name: 'Joshua', active: true } });
    expect(result.ok).toBe(false);
    expect(result.event).toBeUndefined();
  });

  test('TC-2306 K3 AC2 boundary no coordinator chosen, or an inactive one, is refused and changes nothing', () => {
    expect(reassign({ target: null }).ok).toBe(false);
    expect(reassign({ target: { id: 'c9', name: 'Bo', active: false } }).ok).toBe(false);
  });

  test('TC-2307 K3 AC3 after reassignment exactly one coordinator is assigned, from the reassignment time', () => {
    const result = reassign();
    expect(result.ok).toBe(true);
    expect(result.event.coordinator_id).toBe('c2');
    expect(result.event.assigned_at).toBe('T1');
    // The input event is left untouched (pure).
    expect(assigned.coordinator_id).toBe('c1');
  });

  test('TC-2308 K3 AC3 the previous assignment is kept with its original time, the reassignment time and the Lead', () => {
    expect(reassign().previousAssignment).toEqual({
      coordinatorId: 'c1', assignedAt: 'T0', endedAt: 'T1', reassignedBy: 'lead-1'
    });
  });

  test('TC-2309 K3 AC3 the history entry names the outgoing and incoming coordinator, the Lead and both times', () => {
    expect(reassign().history).toMatchObject({
      actionType: 'COORDINATOR_REASSIGNED', fieldName: 'coordinator_id',
      oldValue: 'c1', newValue: 'c2', actorId: 'lead-1',
      previousAssignedAt: 'T0', createdAt: 'T1'
    });
  });

  test('TC-2310 K3 AC3 boundary an event with no recorded assignment time keeps null, not undefined', () => {
    const { assigned_at, ...withoutTime } = assigned;
    const result = reassign({ event: withoutTime });
    expect(result.previousAssignment.assignedAt).toBeNull();
    expect(result.history.previousAssignedAt).toBeNull();
  });

  test('TC-2311 K3 AC4 immediately after, the outgoing coordinator can take no coordinator action and the incoming one can', () => {
    const underReview = reassign().event;
    expect(canRequestClarification(underReview, 'c1')).toBe(false);
    expect(canRejectEvent(underReview, 'c1')).toBe(false);
    expect(canApproveEvent(underReview, 'c1')).toBe(false);
    expect(canLeadReassign(underReview, ROLES.COORDINATOR, { id: 'c3', active: true })).toBe(false);
    expect(canRequestClarification(underReview, 'c2')).toBe(true);
    expect(canApproveEvent(underReview, 'c2')).toBe(true);

    const submitted = reassign({ event: { ...assigned, status: 'SUBMITTED' } }).event;
    expect(canOpenReview(submitted, 'c1')).toBe(false);
    expect(canOpenReview(submitted, 'c2')).toBe(true);
  });

  test('TC-2312 K3 AC5 the outgoing coordinator, the incoming coordinator and the organiser are each notified once', () => {
    expect(reassign().notifications).toEqual([
      { userId: 'c1', type: 'COORDINATOR_REASSIGNED', audience: 'outgoing' },
      { userId: 'c2', type: 'COORDINATOR_REASSIGNED', audience: 'incoming' },
      { userId: 'org-1', type: 'COORDINATOR_REASSIGNED', audience: 'organiser' }
    ]);
  });
});

// K4 / SCRUM-185 — the Lead oversees every active event and who holds it. These pin
// the pure helpers the oversight screen will follow: what "active" means and which
// events are listed (AC1), the row each one gets, including time since last activity
// (AC1), the coordinator and status filters (AC2), the per-coordinator count (AC3, via
// the existing coordinatorWorkload so the summary and the list can never disagree), and
// that nothing here can change an event (AC4). Assign / reassign stay with the K2 / K3
// helpers and are deliberately not re-tested.
describe("K4 SCRUM-185 oversee all coordinators' assignments", () => {
  const NOW = '2026-10-16T00:00:00.000Z';
  const DAY = 24 * 60 * 60 * 1000;
  const ev = (id, overrides = {}) => ({
    id, name: `Event ${id}`, reference_no: `REF-${id}`,
    coordinator_id: 'c1', coordinator_name: 'Sam', status: 'UNDER_REVIEW',
    event_date: '2026-11-01', updated_at: '2026-10-13T00:00:00.000Z',
    ...overrides
  });
  const ids = (rows) => rows.map((row) => row.id).sort();

  test('TC-2340 K4 AC1 an active event is any event not Completed, Cancelled or Rejected', () => {
    const finished = ['COMPLETED', 'CANCELLED', 'REJECTED'];
    Object.values(EVENT_STATUS).forEach((status) => {
      expect(isActiveEvent({ status })).toBe(!finished.includes(status));
    });
    // Boundary: nothing to judge is not active.
    expect(isActiveEvent(null)).toBe(false);
    expect(isActiveEvent(undefined)).toBe(false);
  });

  test('TC-2341 K4 AC1 the list holds every active event, assigned or not, and no finished one', () => {
    const events = [
      ev('a'),
      ev('b', { status: 'APPROVED' }),
      ev('c', { coordinator_id: null, coordinator_name: null, status: 'SUBMITTED' }),
      ev('d', { status: 'COMPLETED' }),
      ev('e', { status: 'CANCELLED' }),
      ev('f', { status: 'REJECTED' }),
      ev('g', { status: 'SAFETY_REVIEW' }),
      ev('h', { status: 'CONFIRMED' })
    ];
    expect(ids(oversightRows(events, {}, NOW))).toEqual(['a', 'b', 'c', 'g', 'h']);
  });

  test('TC-2342 K4 AC1 each row carries the coordinator, status, proposed date and time since last activity', () => {
    const [row] = oversightRows([ev('a')], {}, NOW);
    expect(row).toEqual({
      id: 'a', name: 'Event a', reference: 'REF-a',
      coordinatorId: 'c1', coordinatorName: 'Sam',
      status: 'UNDER_REVIEW', proposedDate: '2026-11-01',
      sinceLastActivityMs: 3 * DAY
    });
  });

  test('TC-2343 K4 AC1 an active event with no coordinator is listed with no coordinator, not dropped', () => {
    const [row] = oversightRows([ev('c', { coordinator_id: null, coordinator_name: null, status: 'SUBMITTED' })], {}, NOW);
    expect(row.coordinatorId).toBeNull();
    expect(row.coordinatorName).toBeNull();
  });

  test('TC-2344 K4 AC1 last activity is the last update, falling back to submission, then creation', () => {
    const all = { updated_at: 'U', submitted_at: 'S', created_at: 'C' };
    expect(lastActivityAt(all)).toBe('U');
    expect(lastActivityAt({ submitted_at: 'S', created_at: 'C' })).toBe('S');
    expect(lastActivityAt({ created_at: 'C' })).toBe('C');
    // Boundary: no timestamp at all is null, and so is the time since.
    expect(lastActivityAt({})).toBeNull();
    expect(timeSinceLastActivity({}, NOW)).toBeNull();
    expect(timeSinceLastActivity(ev('a', { updated_at: '2026-10-15T00:00:00.000Z' }), NOW)).toBe(DAY);
  });

  test('TC-2345 K4 AC1 boundary a last activity after "now" (clock skew) is 0, never negative', () => {
    expect(timeSinceLastActivity(ev('a', { updated_at: '2026-10-17T00:00:00.000Z' }), NOW)).toBe(0);
  });

  test('TC-2346 K4 AC2 filtering by coordinator keeps only that coordinator\'s events', () => {
    const events = [ev('a'), ev('b', { coordinator_id: 'c2', coordinator_name: 'Alex' }), ev('c', { coordinator_id: null, status: 'SUBMITTED' })];
    expect(ids(oversightRows(events, { coordinatorId: 'c2' }, NOW))).toEqual(['b']);
    // An unassigned event belongs to no coordinator, so it only shows when not filtering by one.
    expect(ids(oversightRows(events, { coordinatorId: 'c1' }, NOW))).toEqual(['a']);
  });

  test('TC-2347 K4 AC2 filtering by status keeps only events in that status', () => {
    const events = [ev('a'), ev('b', { status: 'APPROVED' }), ev('c', { status: 'APPROVED' })];
    expect(ids(oversightRows(events, { status: 'APPROVED' }, NOW))).toEqual(['b', 'c']);
  });

  test('TC-2348 K4 AC2 both filters together narrow the list, and empty filters mean no filter', () => {
    const events = [
      ev('a'),
      ev('b', { status: 'APPROVED' }),
      ev('c', { coordinator_id: 'c2', coordinator_name: 'Alex', status: 'APPROVED' })
    ];
    expect(ids(oversightRows(events, { coordinatorId: 'c1', status: 'APPROVED' }, NOW))).toEqual(['b']);
    expect(ids(oversightRows(events, { coordinatorId: '', status: '' }, NOW))).toEqual(['a', 'b', 'c']);
    expect(ids(oversightRows(events, undefined, NOW))).toEqual(['a', 'b', 'c']);
  });

  test('TC-2349 K4 AC2 boundary a filter that matches nothing, or a finished status, gives an empty list not an error', () => {
    const events = [ev('a'), ev('d', { status: 'COMPLETED' })];
    expect(oversightRows(events, { coordinatorId: 'nobody' }, NOW)).toEqual([]);
    // Finished events are never on this view, so filtering for one finds nothing.
    expect(oversightRows(events, { status: 'COMPLETED' }, NOW)).toEqual([]);
    expect(oversightRows([], {}, NOW)).toEqual([]);
    expect(oversightRows(undefined, {}, NOW)).toEqual([]);
  });

  test('TC-2350 K4 AC3 the active-event count per coordinator equals the rows listed for them, zero included', () => {
    const coordinators = [{ id: 'c1', name: 'Sam' }, { id: 'c2', name: 'Alex' }, { id: 'c3', name: 'Priya' }];
    const events = [
      ev('a'),
      ev('b', { status: 'CONFIRMED' }),
      ev('c', { status: 'CANCELLED' }),
      ev('d', { coordinator_id: 'c2', status: 'SAFETY_REVIEW' }),
      ev('e', { coordinator_id: 'c2', status: 'APPROVED' }),
      ev('f', { coordinator_id: 'c2', status: 'COMPLETED' }),
      ev('g', { coordinator_id: 'c3', status: 'REJECTED' }),
      ev('h', { coordinator_id: null, status: 'SUBMITTED' })
    ];
    const counts = Object.fromEntries(coordinatorWorkload(events, coordinators).map((item) => [item.id, item.activeEvents]));
    expect(counts).toEqual({ c1: 2, c2: 2, c3: 0 });
    const rows = oversightRows(events, {}, NOW);
    coordinators.forEach((coordinator) => {
      expect(counts[coordinator.id]).toBe(rows.filter((row) => row.coordinatorId === coordinator.id).length);
    });
  });

  test('TC-2351 K4 AC4 the oversight rows are read-only: input is never changed and a row cannot reach back into an event', () => {
    const events = Object.freeze([Object.freeze(ev('a')), Object.freeze(ev('b', { status: 'APPROVED' }))]);
    const rows = oversightRows(events, { status: 'APPROVED' }, NOW);
    // Frozen input would throw in strict mode if anything wrote to it.
    rows[0].status = 'CANCELLED';
    expect(events[1].status).toBe('APPROVED');
    // The row is a fixed summary, not the event document, so there is nothing editable on it.
    expect(Object.keys(oversightRows(events, {}, NOW)[0]).sort()).toEqual([
      'coordinatorId', 'coordinatorName', 'id', 'name', 'proposedDate', 'reference', 'sinceLastActivityMs', 'status'
    ]);
  });

  test('TC-2352 K4 AC3 a coordinator who is no longer active but still holds an active event is still counted and filterable', () => {
    const active = [{ id: 'c1', name: 'Sam', active: true }];
    const events = [ev('a'), ev('b', { coordinator_id: 'c5', coordinator_name: 'Dana', status: 'APPROVED' })];

    const list = oversightCoordinators(events, active);

    expect(list.map((item) => item.id)).toEqual(['c1', 'c5']);
    expect(list.find((item) => item.id === 'c5')).toMatchObject({ name: 'Dana', active: false });
    expect(coordinatorWorkload(events, list).find((item) => item.id === 'c5').activeEvents).toBe(1);
  });

  test('TC-2353 K4 AC3 boundary no duplicates, and finished-only holders, unassigned events or no data add nobody', () => {
    const active = [{ id: 'c1', name: 'Sam', active: true }];
    const events = [
      ev('a'),
      ev('b', { coordinator_id: 'c5', status: 'COMPLETED' }),
      ev('c', { coordinator_id: null, status: 'SUBMITTED' }),
      ev('d', { coordinator_id: 'c1' })
    ];
    expect(oversightCoordinators(events, active).map((item) => item.id)).toEqual(['c1']);
    expect(oversightCoordinators(undefined, undefined)).toEqual([]);
    // With no name recorded the id stands in, so the row is never blank.
    expect(oversightCoordinators([ev('x', { coordinator_id: 'c6', coordinator_name: undefined })], [])[0].name).toBe('c6');
  });

  test('TC-2354 K4 AC1 time since last activity reads in minutes, hours or days, with just-now and no-activity edges', () => {
    const MIN = 60 * 1000;
    const HR = 60 * MIN;
    expect(formatSinceActivity(0)).toBe('just now');
    expect(formatSinceActivity(59 * 1000)).toBe('just now');
    expect(formatSinceActivity(MIN)).toBe('1 min ago');
    expect(formatSinceActivity(59 * MIN)).toBe('59 min ago');
    expect(formatSinceActivity(HR)).toBe('1 hr ago');
    expect(formatSinceActivity(23 * HR + 59 * MIN)).toBe('23 hrs ago');
    expect(formatSinceActivity(24 * HR)).toBe('1 day ago');
    expect(formatSinceActivity(3 * DAY)).toBe('3 days ago');
    expect(formatSinceActivity(null)).toBe('No activity yet');
    expect(formatSinceActivity(undefined)).toBe('No activity yet');
  });

  test('TC-2355 K4 AC1 the list puts the longest-untouched events first so stalled ones are easy to spot, and events with no recorded activity last', () => {
    const events = [
      ev('recent', { updated_at: '2026-10-15T00:00:00.000Z' }),
      ev('stalled', { updated_at: '2026-10-01T00:00:00.000Z' }),
      ev('none', { updated_at: undefined }),
      ev('middle', { updated_at: '2026-10-10T00:00:00.000Z' })
    ];
    expect(oversightRows(events, {}, NOW).map((row) => row.id)).toEqual(['stalled', 'middle', 'recent', 'none']);
  });

  test('TC-2356 K4 AC3 the summary lists the busiest coordinator first, ties by name, while coordinatorWorkload keeps its least-loaded-first order', () => {
    const coordinators = [{ id: 'c1', name: 'Sam' }, { id: 'c2', name: 'Alex' }, { id: 'c3', name: 'Priya' }, { id: 'c4', name: 'Bea' }];
    const events = [
      ev('a'), ev('b'),
      ev('c', { coordinator_id: 'c2' }),
      ev('d', { coordinator_id: 'c3' })
    ];
    expect(oversightSummary(events, coordinators).map((item) => [item.name, item.activeEvents])).toEqual([
      ['Sam', 2], ['Alex', 1], ['Priya', 1], ['Bea', 0]
    ]);
    // The shared helper A6 and K2 rely on is untouched: fewest first.
    expect(coordinatorWorkload(events, coordinators).map((item) => item.activeEvents)).toEqual([0, 1, 1, 2]);
  });
});

// Edge, ownership and missing-data cases for the pure workflow rules above. The
// adapter and screens hand these helpers whatever Firestore returned, so a missing
// list, a missing field or an id stored under `id` instead of `*_id` must not throw.
describe('event review rules: edges and missing data', () => {
  const LEAD = ROLES.COORDINATOR_LEAD;
  const NOW = new Date('2026-10-30T12:00:00Z').getTime();

  describe('normal', () => {
    test('TC-0873 F1 venues can be found once approved and during planning, whatever the status casing', () => {
      expect(canFindVenues({ status: 'APPROVED' })).toBe(true);
      expect(canFindVenues({ status: 'planning' })).toBe(true);
      expect(isTerminal({ status: 'COMPLETED' })).toBe(true);
      expect(isTerminal({ status: 'SAFETY_REVIEW' })).toBe(false);
    });

    test('TC-0386 C5 AC2 a clarification stored with only its document id can still be answered, and the response points at that id', () => {
      const question = { id: 'CLR-9', status: 'OPEN' };
      const owner = { organiser_id: 'u1', open_clarification_id: 'CLR-9', status: 'UNDER_REVIEW' };
      expect(canRespondToClarification(owner, question, 'u1')).toBe(true);
      const result = submitClarificationResponse({ event: owner, clarification: question, userId: 'u1', message: ' Yes ', now: 'T1' });
      expect(result.responses).toEqual([{ clarification_id: 'CLR-9', responder_id: 'u1', message: 'Yes', created_at: 'T1' }]);
    });
  });

  describe('boundary', () => {
    test('TC-2357 every list helper treats a missing list as empty', () => {
      expect(coordinatorWorkload()).toEqual([]);
      expect(coordinatorWorkload(null, null)).toEqual([]);
      expect(coordinatorWorkload(null, [{ id: 'c1', name: 'A' }])).toEqual([{ id: 'c1', name: 'A', activeEvents: 0 }]);
      expect(leadVisibleEvents()).toEqual([]);
      expect(leadVisibleEvents(null)).toEqual([]);
      expect(unassignedQueue()).toEqual([]);
      expect(unassignedQueue(null)).toEqual([]);
      expect(oversightRows()).toEqual([]);
      expect(oversightRows(null, null, NOW)).toEqual([]);
      expect(oversightCoordinators()).toEqual([]);
      expect(oversightCoordinators(null, null)).toEqual([]);
      expect(chronologicalClarifications()).toEqual([]);
      expect(oversightSummary()).toEqual([]);
    });

    test('TC-2273 K1 AC3 a submitted event with no submission time queues ahead of timed ones', () => {
      const queue = unassignedQueue([
        { id: 'late', status: 'SUBMITTED', submitted_at: '2026-10-02' },
        null,
        { id: 'untimed', status: 'SUBMITTED' },
        { id: 'early', status: 'SUBMITTED', submitted_at: '2026-10-01' }
      ]);
      expect(queue.map((item) => item.id)).toEqual(['untimed', 'early', 'late']);
      expect(leadVisibleEvents([null, { status: 'DRAFT' }]).length).toBe(1);
    });

    test('TC-2358 K4 AC1 an unreadable activity time counts as no activity; the default clock is now', () => {
      expect(timeSinceLastActivity({ updated_at: 'not a date' }, NOW)).toBeNull();
      expect(timeSinceLastActivity({ updated_at: '2026-10-30T11:00:00Z' }, 'not a date')).toBeNull();
      expect(timeSinceLastActivity({ updated_at: new Date(Date.now() - 1000).toISOString() })).toBeGreaterThanOrEqual(0);
    });

    test('TC-2359 K4 AC1 rows with no reference, coordinator name or date read null; events with no activity sink together', () => {
      const rows = oversightRows([
        { id: 'a', status: 'PLANNING', coordinator_id: 'c9' },
        { id: 'b', status: 'PLANNING' },
        { id: 'c', status: 'PLANNING', updated_at: '2026-10-30T11:00:00Z' }
      ], undefined, NOW);
      expect(rows.map((row) => row.id)).toEqual(['c', 'a', 'b']);
      expect(rows[1]).toMatchObject({ reference: null, coordinatorName: 'c9', proposedDate: null, sinceLastActivityMs: null });
      expect(rows[2]).toMatchObject({ coordinatorId: null, coordinatorName: null });
      // The default "now" is the real clock.
      expect(oversightRows([{ id: 'x', status: 'PLANNING' }])).toHaveLength(1);
    });

    test('TC-2360 K4 AC3 a no-longer-active holder with no stored name is shown by id', () => {
      expect(oversightCoordinators([{ status: 'PLANNING', coordinator_id: 'gone' }], [])).toEqual([{ id: 'gone', name: 'gone', active: false }]);
    });

    test('TC-0362 C4 AC3 exchange entries with no timestamp sort first and keep their kind', () => {
      const thread = chronologicalClarifications([{ id: 'q1', created_at: 'T2' }], [{ id: 'r0' }]);
      expect(thread.map((item) => [item.id, item.kind])).toEqual([['r0', 'RESPONSE'], ['q1', 'QUESTION']]);
      const untimed = chronologicalClarifications([{ id: 'q1' }, { id: 'q2', created_at: 'T1' }], [{ id: 'r1' }]);
      expect(untimed.map((item) => item.id)).toEqual(['q1', 'r1', 'q2']);
    });

    test('TC-2291 K2 AC1 the summary of a missing event is all blank, and a choice with no count reads 0 active', () => {
      expect(assignmentSummary(undefined)).toEqual({
        name: undefined, purpose: undefined, eventDate: undefined, startTime: undefined,
        endTime: undefined, expectedAttendance: undefined, organiser: null
      });
      expect(coordinatorChoiceLabel({ name: 'Alex' })).toBe('Alex (0 active)');
    });

    test('TC-0347 C3 AC2 the request view of a missing detail still renders, with the fallback organiser', () => {
      expect(cleanRequiredText(undefined)).toBe('');
      expect(contactDetails(null, null)).toEqual({ name: 'Unknown organiser', email: null, phone: null });
      expect(contactDetails()).toEqual({ name: 'Unknown organiser', email: null, phone: null });
      expect(registrationSummary(null)).toBeNull();
      expect(registrationSummary()).toBeNull();
      expect(equipmentList(null)).toEqual([]);
      expect(equipmentList()).toEqual([]);
      expect(buildRequestView(null)).toMatchObject({ reference: null, registration: null, equipment: [] });
      expect(buildRequestView()).toMatchObject({ reference: null, contact: { name: 'Unknown organiser' } });
    });
  });

  describe('conflict', () => {
    test('TC-2393 K5 a coordinator is current only for an event that carries their id, and a missing user is never current', () => {
      expect(isCurrentCoordinator({ coordinator_id: 'c1' }, 'c1')).toBe(true);
      expect(isCurrentCoordinator({ coordinator_id: 'c1' }, 'c2')).toBe(false);
      expect(isCurrentCoordinator({ coordinator_id: 'c1' }, undefined)).toBe(false);
      expect(isCurrentCoordinator(null, 'c1')).toBe(false);
    });

    test('TC-0387 C5 a response to a clarification other than the open one is refused', () => {
      const owner = { organiser_id: 'u1', open_clarification_id: 'CLR-2' };
      expect(canRespondToClarification(owner, { clarification_id: 'CLR-1', status: 'OPEN' }, 'u1')).toBe(false);
    });

    test('TC-2313 K3 AC1 the Lead cannot reassign an event that has no coordinator yet; that is an assignment', () => {
      expect(canLeadReassign({ status: 'SUBMITTED' }, LEAD, { id: 'c2' })).toBe(false);
      expect(canLeadReassign(null, LEAD, { id: 'c2' })).toBe(false);
      expect(canAssignCoordinator(null, LEAD, { id: 'c2' })).toBe(false);
    });
  });

  describe('failure', () => {
    test('TC-0874 F1 no event, or an event with no status, cannot look for venues', () => {
      expect(canFindVenues(null)).toBe(false);
      expect(canFindVenues({})).toBe(false);
      expect(isTerminal(undefined)).toBe(false);
    });

    test('TC-0388 C5 a response with no event, no clarification or no signed-in user is refused', () => {
      const owner = { organiser_id: 'u1', open_clarification_id: 'CLR-1' };
      const question = { clarification_id: 'CLR-1', status: 'OPEN' };
      expect(canRespondToClarification(null, question, 'u1')).toBe(false);
      expect(canRespondToClarification(owner, null, 'u1')).toBe(false);
      expect(canRespondToClarification(owner, question, null)).toBe(false);
    });
  });
});
