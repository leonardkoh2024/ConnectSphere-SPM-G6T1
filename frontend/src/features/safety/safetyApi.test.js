// A7 / SCRUM-170 — the Safety Officer's reads and the one write they make, and
// the coordinator's safety planning notes.

import { listSafetyQueue, recordSafetyOutcome, safetyReviewDetail, savePlanningNotes, sendEventForSafetyCheck } from './safetyApi';

const mockTransactionUpdate = jest.fn();
const mockTransactionSet = jest.fn();
const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockTransactionDocuments = new Map();
const mockAuth = { currentUser: { uid: 'SO-1' } };

const snapshot = (id, data) => ({ id, exists: () => data !== undefined, data: () => data });
const rows = (items) => ({ docs: items.map(([id, data]) => snapshot(id, data)), size: items.length });

jest.mock('firebase/firestore', () => ({
  collection: (_database, name) => ({ path: name }),
  doc: (...args) => {
    if (args.length === 1) return { path: `${args[0].path}/${args[0].path}-auto`, id: `${args[0].path}-auto` };
    const [, collectionName, id] = args;
    return { path: `${collectionName}/${id}`, id };
  },
  getDoc: (...args) => mockGetDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  query: (reference, ...constraints) => ({ ...reference, constraints }),
  runTransaction: async (_database, operation) => operation({
    get: async (reference) => mockTransactionDocuments.get(reference.path) || snapshot(reference.id, undefined),
    update: mockTransactionUpdate,
    set: mockTransactionSet
  }),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  where: (...parts) => parts
}));

// A getter, so the signed-in user can change between tests.
jest.mock('../../lib/firebase', () => ({ get auth() { return mockAuth; }, db: { name: 'browser-firestore' } }));

const EVENT = {
  name: 'Partner Summit', reference_no: 'EVT-001', status: 'SAFETY_REVIEW',
  event_date: '2026-11-04', start_time: '09:00', end_time: '17:00', expected_attendance: 150,
  organiser_id: 'ORG-1', coordinator_id: 'COORD-1', approved_venue_booking_id: 'VB-1',
  equipment_placement: 'Speakers either side of the stage', crowd_movement: '',
  updated_at: '2026-10-14T09:00:00.000Z'
};

const queries = () => mockGetDocs.mock.calls.map(([reference]) => reference);
const written = (collection) => mockTransactionSet.mock.calls
  .filter(([reference]) => reference.path.startsWith(`${collection}/`))
  .map(([reference, data]) => ({ reference, data }));

beforeEach(() => {
  mockTransactionUpdate.mockClear();
  mockTransactionSet.mockClear();
  mockGetDoc.mockReset();
  mockGetDocs.mockReset();
  mockTransactionDocuments.clear();
  mockAuth.currentUser = { uid: 'SO-1' };
});

// AC2 — the queue asks only for events in Safety Review: the events rule lets
// the Safety Officer list nothing else, so an unfiltered query would be refused.
test('TC-0136 the queue reads only events in Safety Review and names the venues each one booked', async () => {
  mockGetDocs.mockImplementation((reference) => {
    if (reference.path === 'events') return Promise.resolve(rows([
      ['e2', { ...EVENT, name: 'Later', updated_at: '2026-10-15T09:00:00.000Z' }],
      ['e1', EVENT]
    ]));
    if (reference.path === 'venue_bookings') {
      const eventId = reference.constraints[0][2];
      return Promise.resolve(rows(eventId === 'e1'
        ? [['VB-1', { event_id: 'e1', venue_id: 'V-1', status: 'APPROVED' }], ['VB-0', { event_id: 'e1', venue_id: 'V-2', status: 'RELEASED' }]]
        : []));
    }
    return Promise.resolve(rows([]));
  });
  mockGetDoc.mockImplementation((reference) => Promise.resolve(snapshot(reference.id, { name: reference.id === 'V-1' ? 'Harbour Hall' : 'Old Room' })));

  const queue = await listSafetyQueue();

  expect(queries()[0]).toEqual({ path: 'events', constraints: [['status', '==', 'SAFETY_REVIEW']] });
  expect(queries().filter((reference) => reference.path === 'venue_bookings')
    .every((reference) => reference.constraints[0][0] === 'event_id')).toBe(true);
  expect(queue.map((event) => event.id)).toEqual(['e1', 'e2']);
  expect(queue[0]).toEqual(expect.objectContaining({ name: 'Partner Summit', event_date: '2026-11-04', expected_attendance: 150, venue_names: ['Harbour Hall'] }));
  expect(queue[1].venue_names).toEqual([]);
});

test('TC-2459 L2 SCRUM-188 the queue is oldest first by when the event was sent for its check', async () => {
  mockGetDocs.mockImplementation((reference) => {
    if (reference.path === 'events') return Promise.resolve(rows([
      ['newer', { ...EVENT, name: 'Later Forum', safety_review_requested_at: '2026-10-12T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' }],
      ['older', { ...EVENT, name: 'Earlier Forum', safety_review_requested_at: '2026-10-10T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z', event_date: '2026-11-20', expected_attendance: 40 }]
    ]));
    return Promise.resolve(rows([]));
  });
  mockGetDoc.mockResolvedValue(snapshot('none', undefined));

  const queue = await listSafetyQueue();

  expect(queue.map((event) => event.id)).toEqual(['older', 'newer']);
  expect(queue[0]).toEqual(expect.objectContaining({ name: 'Earlier Forum', event_date: '2026-11-20', expected_attendance: 40 }));
});

// AC3 — everything the review needs, read in one go. Released bookings and
// returned equipment are not part of what will happen, so they are left out.
test('TC-0137 the review gathers capacity, layout, emergency access, restrictions, accessibility, equipment and earlier checks', async () => {
  mockGetDoc.mockImplementation((reference) => {
    const documents = {
      'events/e1': EVENT,
      'venues/V-1': { name: 'Harbour Hall', max_capacity: 120, emergency_access_notes: 'Exit via the loading bay', known_restrictions: 'No open flames' }
    };
    return Promise.resolve(snapshot(reference.id, documents[reference.path]));
  });
  mockGetDocs.mockImplementation((reference) => {
    const byCollection = {
      event_venue_requirements: [['e1', { event_id: 'e1', required_layout: 'THEATRE', accessibility_notes: 'Two wheelchair users' }]],
      event_accessibility: [['a1', { event_id: 'e1', accessibility_id: 'WHEELCHAIR_ACCESS' }]],
      event_equipment: [['q1', { event_id: 'e1', equipment_type: 'AUDIO', quantity: 2, technical_note: 'Wireless' }]],
      equipment_reservations: [
        ['r1', { event_id: 'e1', equipment_type: 'AUDIO', quantity: 2, status: 'RESERVED' }],
        ['r0', { event_id: 'e1', equipment_type: 'LIGHTING', quantity: 4, status: 'RELEASED' }]
      ],
      venue_bookings: [
        // F12 — a booking carries its own attendance, which is what its venue must hold.
        ['VB-1', { event_id: 'e1', venue_id: 'V-1', status: 'APPROVED', expected_attendance: 130, layout_snapshot: 'THEATRE', booking_label: 'Main programme', start_datetime: '2026-11-04T01:00:00.000Z', end_datetime: '2026-11-04T09:00:00.000Z' }],
        ['VB-0', { event_id: 'e1', venue_id: 'V-9', status: 'RELEASED' }]
      ],
      safety_reviews: [
        ['s2', { review_id: 's2', event_id: 'e1', outcome: 'REQUEST_CHANGES', comment: 'Move the stage.', reviewer_id: 'SO-1', decided_at: '2026-10-12T09:00:00.000Z' }],
        ['s1', { review_id: 's1', event_id: 'e1', outcome: 'REJECT', comment: 'Exit blocked.', reviewer_id: 'SO-1', decided_at: '2026-10-10T09:00:00.000Z' }]
      ]
    };
    return Promise.resolve(rows(byCollection[reference.path] || []));
  });

  const review = await safetyReviewDetail('e1');

  // Every query is pinned to the event, which is what the rules require.
  queries().forEach((reference) => expect(reference.constraints).toEqual([['event_id', '==', 'e1']]));
  expect(review.event).toEqual(expect.objectContaining({
    name: 'Partner Summit', expected_attendance: 150, required_layout: 'THEATRE',
    accessibility: ['WHEELCHAIR_ACCESS'], accessibility_notes: 'Two wheelchair users',
    equipment: [{ equipment_type: 'AUDIO', quantity: 2, notes: 'Wireless' }],
    equipment_placement: 'Speakers either side of the stage', crowd_movement: ''
  }));
  expect(review.bookings).toEqual([expect.objectContaining({
    booking_id: 'VB-1', venue_name: 'Harbour Hall', label: 'Main programme', status: 'APPROVED',
    attendance: 130, capacity: 120, exceeds: true, layout: 'THEATRE',
    emergency_access_notes: 'Exit via the loading bay', known_restrictions: 'No open flames',
    start_datetime: '2026-11-04T01:00:00.000Z', end_datetime: '2026-11-04T09:00:00.000Z'
  })]);
  expect(review.reservations).toEqual([{ reservation_id: 'r1', equipment_type: 'AUDIO', quantity: 2 }]);
  expect(review.reviews.map((item) => [item.review_id, item.outcome, item.comment])).toEqual([
    ['s1', 'REJECT', 'Exit blocked.'], ['s2', 'REQUEST_CHANGES', 'Move the stage.']
  ]);
});

test('TC-0138 an event that is not awaiting its check is not opened for review', async () => {
  mockGetDoc.mockResolvedValue(snapshot('e1', { ...EVENT, status: 'PLANNING' }));
  await expect(safetyReviewDetail('e1')).rejects.toThrow('This event is not awaiting a safety check.');
  mockGetDoc.mockResolvedValue(snapshot('e1', undefined));
  await expect(safetyReviewDetail('e1')).rejects.toThrow('Event not found.');
  expect(mockGetDocs).not.toHaveBeenCalled();
});

// A requirements document that was never written must not stop the review: a
// direct read of a missing document is refused by the rule (it reads
// resource.data.event_id), whereas a query on event_id simply comes back empty.
test('TC-0139 the venue requirements are queried by event, so an event without them still opens', async () => {
  mockGetDoc.mockImplementation((reference) => Promise.resolve(snapshot(reference.id, reference.path === 'events/e1' ? EVENT : undefined)));
  mockGetDocs.mockResolvedValue(rows([]));

  const review = await safetyReviewDetail('e1');

  expect(mockGetDoc.mock.calls.map(([reference]) => reference.path)).toEqual(['events/e1']);
  expect(queries()).toContainEqual({ path: 'event_venue_requirements', constraints: [['event_id', '==', 'e1']] });
  expect(review.event).toEqual(expect.objectContaining({ required_layout: null, accessibility_notes: '', accessibility: [], equipment: [] }));
  expect(review.bookings).toEqual([]);
});

// When Firestore does refuse a read, the message says which one, so a rule gap
// can be found from the screen rather than guessed at.
test('TC-0140 a refused read names the collection it was reading', async () => {
  mockGetDoc.mockResolvedValue(snapshot('e1', EVENT));
  mockGetDocs.mockImplementation((reference) => (reference.path === 'equipment_reservations'
    ? Promise.reject(new Error('Missing or insufficient permissions.'))
    : Promise.resolve(rows([]))));
  await expect(safetyReviewDetail('e1')).rejects.toThrow('Missing or insufficient permissions. (Reading equipment_reservations.)');

  mockGetDoc.mockRejectedValue(new Error('Missing or insufficient permissions.'));
  await expect(safetyReviewDetail('e1')).rejects.toThrow('Missing or insufficient permissions. (Reading events.)');
});

const givenEvent = (changes = {}, role = 'SAFETY_OFFICER', bookings = [['VB-1', { event_id: 'e1', venue_id: 'V-1', status: 'APPROVED' }]]) => {
  mockTransactionDocuments.set('events/e1', snapshot('e1', { ...EVENT, ...changes }));
  mockTransactionDocuments.set(`users/${mockAuth.currentUser.uid}`, snapshot(mockAuth.currentUser.uid, { role }));
  mockGetDocs.mockImplementation((reference) => Promise.resolve(rows(reference.path === 'venue_bookings' ? bookings : [])));
};

// AC4 — Approve: one safety_reviews record, the event to Confirmed pointing at
// it, history, and the coordinator and organiser told — all in one commit, which
// is what safetyOutcomeUpdate in firestore.rules checks.
test('TC-0141 approving writes the review, confirms the event and tells its coordinator and organiser', async () => {
  givenEvent();
  const result = await recordSafetyOutcome({ eventId: 'e1', outcome: 'APPROVE', comment: '' });

  expect(result).toEqual({ ok: true, reviewId: 'safety_reviews-auto', status: 'CONFIRMED' });
  // The event's bookings were read to check every active one is approved.
  expect(queries()).toEqual([{ path: 'venue_bookings', constraints: [['event_id', '==', 'e1']] }]);
  expect(written('safety_reviews')).toEqual([{
    reference: { path: 'safety_reviews/safety_reviews-auto', id: 'safety_reviews-auto' },
    data: { review_id: 'safety_reviews-auto', event_id: 'e1', reviewer_id: 'SO-1', outcome: 'APPROVE', comment: null, decided_at: 'SERVER_TIMESTAMP' }
  }]);
  expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
  expect(mockTransactionUpdate).toHaveBeenCalledWith({ path: 'events/e1', id: 'e1' },
    { status: 'CONFIRMED', last_safety_review_id: 'safety_reviews-auto', updated_at: 'SERVER_TIMESTAMP', confirmed_at: 'SERVER_TIMESTAMP' });
  expect(written('event_history').map(({ data }) => data)).toEqual([expect.objectContaining({
    event_id: 'e1', actor_id: 'SO-1', action_type: 'SAFETY_CHECK_APPROVED',
    field_name: 'status', old_value: 'SAFETY_REVIEW', new_value: 'CONFIRMED', created_at: 'SERVER_TIMESTAMP'
  })]);
  const notices = written('notifications').map(({ data }) => data);
  expect(notices.map((notice) => notice.user_id)).toEqual(['COORD-1', 'ORG-1']);
  notices.forEach((notice) => expect(notice).toEqual(expect.objectContaining({
    event_id: 'e1', type: 'SAFETY_CHECK_APPROVED', is_read: false, created_at: 'SERVER_TIMESTAMP',
    message: 'Partner Summit passed its safety check and is now Confirmed.'
  })));
});

// AC4 — Request changes and Reject return the event to Planning, and the
// comment travels with the record, the history and the notice.
test.each([
  ['REQUEST_CHANGES', 'SAFETY_CHANGES_REQUESTED', 'Partner Summit needs changes before it can pass its safety check and is back in Planning. Comment: Move the stage.'],
  ['REJECT', 'SAFETY_CHECK_REJECTED', 'Partner Summit failed its safety check and is back in Planning. Comment: Move the stage.']
])('TC-0142 %s returns the event to Planning with the comment recorded and sent', async (outcome, type, message) => {
  givenEvent();
  await recordSafetyOutcome({ eventId: 'e1', outcome, comment: '  Move the stage.  ' });

  expect(written('safety_reviews')[0].data).toEqual(expect.objectContaining({ outcome, comment: 'Move the stage.' }));
  expect(mockTransactionUpdate).toHaveBeenCalledWith({ path: 'events/e1', id: 'e1' },
    { status: 'PLANNING', last_safety_review_id: 'safety_reviews-auto', updated_at: 'SERVER_TIMESTAMP', returned_to_planning_at: 'SERVER_TIMESTAMP' });
  expect(written('event_history')[0].data).toEqual(expect.objectContaining({ action_type: type, new_value: 'PLANNING', description: 'Move the stage.' }));
  expect(written('notifications').map(({ data }) => [data.user_id, data.type, data.message]))
    .toEqual([['COORD-1', type, message], ['ORG-1', type, message]]);
});

// AC4 / AC6 — refused before anything is written: a missing comment, an event no
// longer in Safety Review, a caller who is not the Safety Officer, or an approval
// with no approved booking for the event rule to check.
test.each([
  ['a Reject with no comment', {}, 'SAFETY_OFFICER', { outcome: 'REJECT', comment: ' ' }, 'A comment explaining the concern is required to reject or request changes.'],
  ['an event already back in Planning', { status: 'PLANNING' }, 'SAFETY_OFFICER', { outcome: 'APPROVE' }, 'Outcomes can be recorded only by the Safety Officer, on an event in Safety Review.'],
  ['a coordinator', {}, 'EVENT_COORDINATOR', { outcome: 'APPROVE' }, 'Outcomes can be recorded only by the Safety Officer, on an event in Safety Review.'],
  ['an approval with no approved booking', { approved_venue_booking_id: null }, 'SAFETY_OFFICER', { outcome: 'APPROVE' }, 'This event has no approved venue booking, so it cannot be confirmed.'],
  ['an unknown outcome', {}, 'SAFETY_OFFICER', { outcome: 'CONFIRM' }, 'Choose an outcome: Approve, Reject or Request changes.']
])('TC-0143 %s is refused and nothing is written', async (_name, changes, role, input, error) => {
  givenEvent(changes, role);
  await expect(recordSafetyOutcome({ eventId: 'e1', ...input })).rejects.toThrow(error);
  expect(mockTransactionSet).not.toHaveBeenCalled();
  expect(mockTransactionUpdate).not.toHaveBeenCalled();
});

// AC3 — the coordinator records equipment placement and crowd movement. Only
// those two fields and the timestamp change, which is all the rule allows, and
// the edit is kept in the event history.
test('TC-0144 the coordinator saves safety planning notes on their event, with history', async () => {
  mockAuth.currentUser = { uid: 'COORD-1' };
  mockTransactionDocuments.set('events/e1', snapshot('e1', { ...EVENT, status: 'PLANNING' }));

  await savePlanningNotes({ eventId: 'e1', values: { equipment_placement: ' Speakers at the back ', crowd_movement: 'Enter by door A, leave by door B' } });

  expect(mockTransactionUpdate).toHaveBeenCalledWith({ path: 'events/e1', id: 'e1' }, {
    equipment_placement: 'Speakers at the back', crowd_movement: 'Enter by door A, leave by door B', updated_at: 'SERVER_TIMESTAMP'
  });
  expect(written('event_history').map(({ data }) => data)).toEqual([expect.objectContaining({
    event_id: 'e1', actor_id: 'COORD-1', action_type: 'SAFETY_PLANNING_NOTES_UPDATED', field_name: 'safety_planning_notes',
    old_value: { equipment_placement: 'Speakers either side of the stage', crowd_movement: '' },
    new_value: { equipment_placement: 'Speakers at the back', crowd_movement: 'Enter by door A, leave by door B' }
  })]);
});

// F12 — with a second venue still pending, Approve is refused before anything is written.
test('TC-0145 approving an event with a booking not yet approved is refused and nothing is written', async () => {
  givenEvent({}, 'SAFETY_OFFICER', [
    ['VB-1', { event_id: 'e1', venue_id: 'V-1', status: 'APPROVED', booking_label: 'Main programme' }],
    ['VB-2', { event_id: 'e1', venue_id: 'V-2', status: 'PENDING', booking_label: 'Breakout 1' }]
  ]);
  await expect(recordSafetyOutcome({ eventId: 'e1', outcome: 'APPROVE' }))
    .rejects.toThrow('Every active venue booking must be approved before the event can be confirmed. Not yet approved: Breakout 1.');
  expect(mockTransactionSet).not.toHaveBeenCalled();
  expect(mockTransactionUpdate).not.toHaveBeenCalled();
});

test('TC-2488 L4 SCRUM-190 Request changes flags only the venue booking and tells its staff', async () => {
  givenEvent({}, 'SAFETY_OFFICER', [[
    'VB-1',
    { event_id: 'e1', venue_id: 'V-1', status: 'APPROVED', venue_name: 'Harbour Hall', assigned_staff_id: 'STAFF-1' }
  ]]);
  mockGetDoc.mockResolvedValue(snapshot('e1', undefined));

  await recordSafetyOutcome({ eventId: 'e1', outcome: 'REQUEST_CHANGES', comment: 'Move the stage.', marked: ['venue'] });

  expect(mockTransactionUpdate).toHaveBeenCalledWith({ path: 'venue_bookings/VB-1', id: 'VB-1' }, { review_status: 'Review required' });
  expect(mockTransactionUpdate).toHaveBeenCalledWith({ path: 'events/e1', id: 'e1' }, expect.objectContaining({
    status: 'PLANNING', returned_to_planning_at: 'SERVER_TIMESTAMP'
  }));
  expect(mockTransactionUpdate).not.toHaveBeenCalledWith({ path: 'events/e1', id: 'e1' }, expect.objectContaining({
    technical_review_status: 'Review required'
  }));
  expect(written('notifications').some(({ data }) => data.user_id === 'STAFF-1' && data.type === 'ARRANGEMENT_REVIEW_REQUIRED')).toBe(true);
});

test('TC-2445 L1 SCRUM-187 sending a ready event moves it to Safety Review and notifies active Safety Officers', async () => {
  mockAuth.currentUser = { uid: 'COORD-1' };
  mockGetDoc.mockImplementation((reference) => {
    if (reference.path === 'events/e1') return Promise.resolve(snapshot('e1', { ...EVENT, status: 'PLANNING', coordinator_id: 'COORD-1' }));
    return Promise.resolve(snapshot(reference.id, undefined));
  });
  mockGetDocs.mockImplementation((reference) => {
    if (reference.path === 'venue_bookings') return Promise.resolve(rows([['VB-1', { event_id: 'e1', venue_id: 'V-1', venue_name: 'Harbour Hall', status: 'APPROVED' }]]));
    if (reference.path === 'users') return Promise.resolve(rows([
      ['SO-1', { role: 'SAFETY_OFFICER', is_active: true }],
      ['SO-2', { role: 'SAFETY_OFFICER', is_active: false }]
    ]));
    return Promise.resolve(rows([]));
  });
  mockTransactionDocuments.set('events/e1', snapshot('e1', { ...EVENT, status: 'PLANNING', coordinator_id: 'COORD-1' }));

  await expect(sendEventForSafetyCheck('e1')).resolves.toEqual({ ok: true, status: 'SAFETY_REVIEW' });

  expect(mockTransactionUpdate).toHaveBeenCalledWith({ path: 'events/e1', id: 'e1' }, {
    status: 'SAFETY_REVIEW', safety_review_requested_at: 'SERVER_TIMESTAMP', updated_at: 'SERVER_TIMESTAMP'
  });
  expect(written('notifications').map(({ data }) => data.user_id)).toEqual(['SO-1']);
  expect(written('notifications')[0].data.type).toBe('SAFETY_REVIEW_WAITING');
});

// Equipment lines carry the equipment service's `fulfillment_status`, not `status`.
const sendWithEquipmentLines = (lines) => {
  mockAuth.currentUser = { uid: 'COORD-1' };
  mockGetDoc.mockImplementation((reference) => {
    if (reference.path === 'events/e1') return Promise.resolve(snapshot('e1', { ...EVENT, status: 'PLANNING', coordinator_id: 'COORD-1' }));
    if (reference.path === 'equipment_requests/e1') return Promise.resolve(snapshot('e1', { event_id: 'e1', status: 'ARRANGED', lines }));
    return Promise.resolve(snapshot(reference.id, undefined));
  });
  mockGetDocs.mockImplementation((reference) => {
    if (reference.path === 'venue_bookings') return Promise.resolve(rows([['VB-1', { event_id: 'e1', venue_name: 'Harbour Hall', status: 'APPROVED' }]]));
    if (reference.path === 'users') return Promise.resolve(rows([['SO-1', { role: 'SAFETY_OFFICER', is_active: true }]]));
    return Promise.resolve(rows([]));
  });
  mockTransactionDocuments.set('events/e1', snapshot('e1', { ...EVENT, status: 'PLANNING', coordinator_id: 'COORD-1' }));
  return sendEventForSafetyCheck('e1');
};

test('TC-2446 L1 SCRUM-187 an event whose equipment lines are all reserved can be sent', async () => {
  await expect(sendWithEquipmentLines([
    { equipment_type: 'AUDIO', quantity: 2, fulfillment_status: 'RESERVED' },
    { equipment_type: 'VISUAL', quantity: 1, fulfillment_status: 'RESERVED' }
  ])).resolves.toEqual({ ok: true, status: 'SAFETY_REVIEW' });
});

test.each(['PENDING', 'RESOLVED', 'RELEASED'])('TC-2447 L1 SCRUM-187 an equipment line that is %s is outstanding and nothing is written', async (fulfillmentStatus) => {
  await expect(sendWithEquipmentLines([
    { equipment_type: 'AUDIO', quantity: 2, fulfillment_status: 'RESERVED' },
    { equipment_type: 'VISUAL', quantity: 1, fulfillment_status: fulfillmentStatus }
  ])).rejects.toThrow(/Outstanding: VISUAL/);
  expect(mockTransactionUpdate).not.toHaveBeenCalled();
});

test('TC-2448 L1 SCRUM-187 a pending booking is named and nothing is written', async () => {
  mockAuth.currentUser = { uid: 'COORD-1' };
  mockGetDoc.mockImplementation((reference) => Promise.resolve(snapshot(reference.id, reference.path === 'events/e1'
    ? { ...EVENT, status: 'PLANNING', coordinator_id: 'COORD-1' }
    : undefined)));
  mockGetDocs.mockImplementation((reference) => Promise.resolve(rows(reference.path === 'venue_bookings'
    ? [['VB-2', { event_id: 'e1', venue_name: 'Breakout', status: 'PENDING' }]]
    : [])));

  await expect(sendEventForSafetyCheck('e1')).rejects.toThrow(/Outstanding: Breakout/);
  expect(mockTransactionUpdate).not.toHaveBeenCalled();
});

test.each([
  ['another coordinator', 'COORD-2', { status: 'PLANNING' }, { equipment_placement: 'x' }, "Only the event's coordinator can record safety planning notes, while the event is Approved or in Planning."],
  ['an event in Safety Review', 'COORD-1', { status: 'SAFETY_REVIEW' }, { equipment_placement: 'x' }, "Only the event's coordinator can record safety planning notes, while the event is Approved or in Planning."],
  ['a note over the limit', 'COORD-1', { status: 'PLANNING' }, { crowd_movement: 'a'.repeat(2001) }, 'Each safety planning note must be 2000 characters or fewer.'],
  ['no change', 'COORD-1', { status: 'PLANNING' }, { equipment_placement: 'Speakers either side of the stage', crowd_movement: '' }, 'There are no changes to save.']
])('TC-0146 safety planning notes from %s are refused and nothing is written', async (_name, uid, changes, values, error) => {
  mockAuth.currentUser = { uid };
  mockTransactionDocuments.set('events/e1', snapshot('e1', { ...EVENT, ...changes }));
  await expect(savePlanningNotes({ eventId: 'e1', values })).rejects.toThrow(error);
  expect(mockTransactionSet).not.toHaveBeenCalled();
  expect(mockTransactionUpdate).not.toHaveBeenCalled();
});

// L4 AC2 / AC3 — a Reject flags the technical arrangements too: the event carries
// the flag (Technical Support's lines live in the equipment service), and the
// staff assigned to the request are told.
test('TC-2489 [normal] L4 a Reject flags the venue and the technical arrangements and tells both staff', async () => {
  givenEvent({}, 'SAFETY_OFFICER', [['VB-1', { event_id: 'e1', venue_id: 'V-1', status: 'APPROVED', assigned_staff_id: 'STAFF-1' }]]);
  mockGetDoc.mockResolvedValue(snapshot('e1', {
    assigned_staff_id: 'TECH-1',
    lines: [{ equipment_type: 'AUDIO', fulfillment_status: 'RESERVED' }, { fulfillment_status: 'PENDING', assigned_staff_id: 'TECH-2' }]
  }));

  await recordSafetyOutcome({ eventId: 'e1', outcome: 'REJECT', comment: 'Exit blocked.' });

  expect(mockTransactionUpdate).toHaveBeenCalledWith({ path: 'events/e1', id: 'e1' }, expect.objectContaining({
    status: 'PLANNING', technical_review_status: 'Review required'
  }));
  expect(mockTransactionUpdate).toHaveBeenCalledWith({ path: 'venue_bookings/VB-1', id: 'VB-1' }, { review_status: 'Review required' });
  expect(written('notifications').filter(({ data }) => data.type === 'ARRANGEMENT_REVIEW_REQUIRED').map(({ data }) => data.user_id))
    .toEqual(['STAFF-1', 'TECH-1', 'TECH-2']);
});

describe('L1 SCRUM-187 sending for the safety check — edges', () => {
  const coordinatorEvent = { ...EVENT, status: 'PLANNING', coordinator_id: 'COORD-1' };
  const ready = ({ event = coordinatorEvent, request, users = [['SO-1', { role: 'SAFETY_OFFICER' }]], reviews = [] } = {}) => {
    mockAuth.currentUser = { uid: 'COORD-1' };
    mockGetDoc.mockImplementation((reference) => {
      if (reference.path === 'events/e1') return Promise.resolve(snapshot('e1', event));
      if (reference.path === 'equipment_requests/e1') return request || Promise.resolve(snapshot('e1', undefined));
      return Promise.resolve(snapshot(reference.id, undefined));
    });
    mockGetDocs.mockImplementation((reference) => {
      if (reference.path === 'venue_bookings') return Promise.resolve(rows([['VB-1', { event_id: 'e1', booking_label: 'Main programme', status: 'APPROVED' }]]));
      if (reference.path === 'users') return Promise.resolve(rows(users));
      if (reference.path === 'safety_reviews') return Promise.resolve(rows(reviews));
      return Promise.resolve(rows([]));
    });
    mockTransactionDocuments.set('events/e1', snapshot('e1', event));
  };

  test('TC-2449 [boundary] an equipment request that cannot be read counts as none requested, and an officer with no active flag is told', async () => {
    ready({
      request: Promise.reject(new Error('Missing or insufficient permissions.')),
      users: [['SO-1', { role: 'SAFETY_OFFICER' }], ['SO-9', { role: 'SAFETY_OFFICER', is_active: false }]]
    });
    await expect(sendEventForSafetyCheck('e1')).resolves.toEqual({ ok: true, status: 'SAFETY_REVIEW' });
    expect(written('notifications').map(({ data }) => [data.user_id, data.link_screen, data.checked_before]))
      .toEqual([['SO-1', 'Safety review', false]]);
    expect(written('notifications')[0].data.message).toMatch(/at Main programme/);
  });

  test('TC-2266 [normal] J9 AC3 an event checked before tells the Safety Officer so', async () => {
    ready({ reviews: [['s1', { event_id: 'e1', outcome: 'REQUEST_CHANGES' }]] });
    await sendEventForSafetyCheck('e1');
    expect(written('notifications')[0].data).toMatchObject({ checked_before: true, message: expect.stringMatching(/checked before\.$/) });
  });

  test('TC-2490 [conflict] L4 AC4 technical arrangements still marked for review keep the event in Planning', async () => {
    ready({ event: { ...coordinatorEvent, technical_review_status: 'Review required' } });
    await expect(sendEventForSafetyCheck('e1')).rejects.toThrow(
      'Send for safety check is unavailable. Outstanding: Technical arrangements still needs review.'
    );
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
  });

  test('TC-2450 [conflict] an event not in Approved or Planning cannot be sent', async () => {
    ready({ event: { ...coordinatorEvent, status: 'SAFETY_REVIEW' } });
    await expect(sendEventForSafetyCheck('e1')).rejects.toThrow('Send for safety check is not available for this event.');
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
  });

  test('TC-2491 [concurrency] an event cancelled after readiness checks cannot enter Safety Review', async () => {
    ready();
    mockTransactionDocuments.set('events/e1', snapshot('e1', {
      ...coordinatorEvent,
      status: 'CANCELLED',
      cancelled_at: '2026-10-31T02:00:00.000Z',
      last_cancellation_id: 'H-CANCEL'
    }));

    await expect(sendEventForSafetyCheck('e1'))
      .rejects.toThrow('Send for safety check is not available for this event.');
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });

  test('TC-2406 [conflict] K5 another coordinator cannot send, nor can one whose event was reassigned meanwhile', async () => {
    ready({ event: { ...coordinatorEvent, coordinator_id: 'COORD-2' } });
    await expect(sendEventForSafetyCheck('e1')).rejects.toThrow('Only the assigned coordinator can send this event for its safety check.');

    ready();
    mockTransactionDocuments.set('events/e1', snapshot('e1', { ...coordinatorEvent, coordinator_id: 'COORD-2' }));
    await expect(sendEventForSafetyCheck('e1')).rejects.toThrow('Only the assigned coordinator can send this event for its safety check.');
    mockTransactionDocuments.delete('events/e1');
    await expect(sendEventForSafetyCheck('e1')).rejects.toThrow('Only the assigned coordinator can send this event for its safety check.');
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });

  test('TC-2451 [failure] a missing event, or nobody signed in, is refused', async () => {
    ready();
    mockGetDoc.mockResolvedValue(snapshot('e1', undefined));
    await expect(sendEventForSafetyCheck('e1')).rejects.toThrow('Event not found.');
    mockAuth.currentUser = null;
    await expect(sendEventForSafetyCheck('e1')).rejects.toThrow('Please sign in again.');
  });
});

describe('L2 SCRUM-188 a review built from sparse records', () => {
  const sparse = (requirements) => {
    mockGetDoc.mockImplementation((reference) => Promise.resolve(snapshot(reference.id, {
      'events/e1': { status: 'SAFETY_REVIEW', expected_attendance: 40 },
      'venues/V-1': { name: 'Harbour Hall' },
      'venues/V-2': {}
    }[reference.path])));
    mockGetDocs.mockImplementation((reference) => Promise.resolve(rows({
      event_venue_requirements: requirements,
      event_accessibility: [['a1', { event_id: 'e1' }]],
      event_equipment: [['q1', { event_id: 'e1' }], ['q2', { event_id: 'e1', equipment_type: 'AUDIO', notes: 'Spare mics' }]],
      venue_bookings: [
        ['VB-1', { event_id: 'e1', venue_id: 'V-1', status: 'APPROVED' }],
        ['VB-2', { event_id: 'e1', venue_id: 'V-2', status: 'APPROVED', requested_layout_id: 'CLASSROOM' }],
        ['VB-3', { event_id: 'e1', venue_id: 'V-404', status: 'PENDING' }]
      ],
      safety_reviews: [
        ['s2', { outcome: 'REJECT', decided_at: { toDate: () => new Date('2026-10-12T09:00:00.000Z') } }],
        ['s0', { outcome: 'REQUEST_CHANGES' }],
        ['s1', { outcome: 'REJECT', decided_at: '2026-10-10T09:00:00.000Z' }],
        ['s3', { outcome: 'REQUEST_CHANGES' }]
      ]
    }[reference.path] || [])));
  };

  test('TC-2460 [boundary] missing names, notes, layouts and times fall back plainly, and undated checks come first', async () => {
    sparse([['e1', { event_id: 'e1', required_layout: 'BANQUET' }]]);
    const review = await safetyReviewDetail('e1');

    expect(review.event).toEqual(expect.objectContaining({
      required_layout: 'BANQUET', accessibility: [], accessibility_notes: '', equipment_placement: '', crowd_movement: '',
      equipment: [{ equipment_type: undefined, quantity: 1, notes: null }, { equipment_type: 'AUDIO', quantity: 1, notes: 'Spare mics' }]
    }));
    expect(review.bookings.map((booking) => [booking.venue_name, booking.label, booking.layout, booking.attendance, booking.capacity])).toEqual([
      ['Harbour Hall', 'Harbour Hall', 'BANQUET', 40, null],
      ['V-2', 'V-2', 'CLASSROOM', 40, null],
      ['V-404', 'V-404', 'BANQUET', 40, null]
    ]);
    review.bookings.forEach((booking) => expect(booking).toMatchObject({ emergency_access_notes: '', known_restrictions: '', start_datetime: null }));
    expect(review.reviews.map((item) => [item.review_id, item.decided_at])).toEqual([
      ['s0', null], ['s3', null], ['s1', '2026-10-10T09:00:00.000Z'], ['s2', '2026-10-12T09:00:00.000Z']
    ]);
  });

  test('TC-2461 [boundary] with no requirements recorded a booking with no layout of its own has none', async () => {
    sparse([]);
    const review = await safetyReviewDetail('e1');
    expect(review.bookings.map((booking) => booking.layout)).toEqual([null, 'CLASSROOM', null]);
  });

  test('TC-2462 [boundary] the queue names a venue with no name by its id', async () => {
    mockGetDocs.mockImplementation((reference) => Promise.resolve(rows({
      events: [['e1', EVENT]],
      venue_bookings: [['VB-1', { event_id: 'e1', venue_id: 'V-7', status: 'APPROVED' }]]
    }[reference.path] || [])));
    mockGetDoc.mockResolvedValue(snapshot('V-7', {}));
    const [entry] = await listSafetyQueue();
    expect(entry.venue_names).toEqual(['V-7']);
  });
});

describe('L3 SCRUM-189 recording an outcome — refusals and wording', () => {
  test('TC-2476 [failure] an event that has gone, or a caller with no profile, records nothing', async () => {
    givenEvent();
    mockTransactionDocuments.delete('events/e1');
    await expect(recordSafetyOutcome({ eventId: 'e1', outcome: 'APPROVE' })).rejects.toThrow('Event not found.');

    givenEvent();
    mockTransactionDocuments.delete('users/SO-1');
    await expect(recordSafetyOutcome({ eventId: 'e1', outcome: 'APPROVE' }))
      .rejects.toThrow('Outcomes can be recorded only by the Safety Officer, on an event in Safety Review.');
    expect(mockTransactionSet).not.toHaveBeenCalled();
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
  });

  test('TC-2477 [boundary] an event with no name is named by its reference in the notice', async () => {
    givenEvent({ name: '' });
    await recordSafetyOutcome({ eventId: 'e1', outcome: 'APPROVE' });
    expect(written('notifications')[0].data.message).toBe('EVT-001 passed its safety check and is now Confirmed.');
  });
});
