const mockTransactionUpdate = jest.fn();
const mockTransactionSet = jest.fn();
const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockTransactionDocuments = new Map();

const snapshot = (id, data, ref = { path: `documents/${id}`, id }) => ({
  id,
  ref,
  exists: () => true,
  data: () => data
});

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
    get: async (reference) => mockTransactionDocuments.get(reference.path),
    update: mockTransactionUpdate,
    set: mockTransactionSet
  }),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  updateDoc: jest.fn(),
  where: (...parts) => parts
}));

jest.mock('../../lib/firebase', () => ({ db: { name: 'browser-firestore' } }));

import * as firestore from 'firebase/firestore';
import { approveVenueBooking, loadVenueBookingQueue, loadVenueBookings, loadVenueSearchContext, releaseCancelledEventBookings, withdrawVenueBooking } from './venuesApi';

beforeEach(() => {
  mockTransactionUpdate.mockClear();
  mockTransactionSet.mockClear();
  mockGetDoc.mockReset();
  mockGetDocs.mockReset();
  mockTransactionDocuments.clear();
});

test('F4/F7 approval links the event to the approved booking in the same transaction', async () => {
  const booking = {
    event_id: 'EVT-001', venue_id: 'VEN-001', status: 'PENDING',
    start_datetime: '2026-11-20T10:00:00.000Z', end_datetime: '2026-11-20T12:00:00.000Z',
    submitted_at: '2026-10-14T09:00:00.000Z', booking_label: 'Harbour Hall booking'
  };
  const bookingRef = { path: 'venue_bookings/VB-001', id: 'VB-001' };
  const assignmentRef = { path: 'venue_staff/VEN-001', id: 'VEN-001' };
  mockGetDoc.mockResolvedValue(snapshot('VB-001', booking, bookingRef));
  mockGetDocs.mockImplementation((reference) => {
    if (reference.path === 'venue_staff') return Promise.resolve({ docs: [{ id: 'VEN-001', ref: assignmentRef, data: () => ({ venue_id: 'VEN-001', user_id: 'STAFF-001' }) }] });
    if (reference.path === 'venue_bookings') return Promise.resolve({ docs: [{ id: 'VB-001', ref: bookingRef, data: () => booking }] });
    return Promise.resolve({ docs: [] });
  });
  mockTransactionDocuments.set(bookingRef.path, snapshot('VB-001', booking, bookingRef));
  mockTransactionDocuments.set('venues/VEN-001', snapshot('VEN-001', { setup_minutes: 30, turnaround_minutes: 15 }));
  mockTransactionDocuments.set(assignmentRef.path, snapshot('VEN-001', { venue_id: 'VEN-001', user_id: 'STAFF-001' }, assignmentRef));

  await expect(approveVenueBooking({ user: { uid: 'STAFF-001' }, bookingId: 'VB-001' }))
    .resolves.toEqual({ booking_id: 'VB-001', status: 'APPROVED' });

  expect(mockTransactionUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'venue_bookings/VB-001' }),
    expect.objectContaining({ status: 'APPROVED', decided_by: 'STAFF-001' })
  );
  expect(mockTransactionUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'events/EVT-001' }),
    { approved_venue_booking_id: 'VB-001', updated_at: 'SERVER_TIMESTAMP' }
  );
});

// J6 / SCRUM-155 AC1/AC2 — TC-317 in docs/test-cases.md.
test('TC-317 approval tells the coordinator who raised it, carrying the booking', async () => {
  const booking = {
    event_id: 'EVT-001', venue_id: 'VEN-001', status: 'PENDING', requested_by: 'COORD-001',
    event_name: 'Q4 Partner Summit',
    start_datetime: '2026-11-20T10:00:00.000Z', end_datetime: '2026-11-20T12:00:00.000Z',
    submitted_at: '2026-10-14T09:00:00.000Z'
  };
  const bookingRef = { path: 'venue_bookings/VB-001', id: 'VB-001' };
  const assignmentRef = { path: 'venue_staff/VEN-001', id: 'VEN-001' };
  mockGetDoc.mockResolvedValue(snapshot('VB-001', booking, bookingRef));
  mockGetDocs.mockImplementation((reference) => {
    if (reference.path === 'venue_staff') return Promise.resolve({ docs: [{ id: 'VEN-001', ref: assignmentRef, data: () => ({ venue_id: 'VEN-001', user_id: 'STAFF-001' }) }] });
    if (reference.path === 'venue_bookings') return Promise.resolve({ docs: [{ id: 'VB-001', ref: bookingRef, data: () => booking }] });
    return Promise.resolve({ docs: [] });
  });
  mockTransactionDocuments.set(bookingRef.path, snapshot('VB-001', booking, bookingRef));
  mockTransactionDocuments.set('venues/VEN-001', snapshot('VEN-001', { name: 'Harbour Hall', setup_minutes: 30, turnaround_minutes: 15 }));
  mockTransactionDocuments.set(assignmentRef.path, snapshot('VEN-001', { venue_id: 'VEN-001', user_id: 'STAFF-001' }, assignmentRef));

  await approveVenueBooking({ user: { uid: 'STAFF-001' }, bookingId: 'VB-001' });

  const notices = mockTransactionSet.mock.calls
    .filter(([reference]) => reference.path.startsWith('notifications/'))
    .map(([, data]) => data);
  expect(notices).toEqual([expect.objectContaining({
    type: 'VENUE_BOOKING_APPROVED',
    user_id: 'COORD-001', event_id: 'EVT-001', booking_id: 'VB-001', venue_id: 'VEN-001',
    message: 'Q4 Partner Summit: the booking for Harbour Hall was approved.',
    is_read: false, created_at: 'SERVER_TIMESTAMP'
  })]);
});

// J6 / SCRUM-155 AC1 — TC-335 – TC-337: who is told, and when nobody is.
const approvalSetup = ({ booking: changes = {}, others = [] } = {}) => {
  const booking = {
    event_id: 'EVT-001', venue_id: 'VEN-001', status: 'PENDING', requested_by: 'COORD-001',
    event_name: 'Q4 Partner Summit',
    start_datetime: '2026-11-20T10:00:00.000Z', end_datetime: '2026-11-20T12:00:00.000Z',
    submitted_at: '2026-10-14T09:00:00.000Z', ...changes
  };
  const bookingRef = { path: 'venue_bookings/VB-001', id: 'VB-001' };
  const assignmentRef = { path: 'venue_staff/VEN-001', id: 'VEN-001' };
  const otherDocs = others.map((data, index) => {
    const ref = { path: `venue_bookings/VB-OTHER-${index}`, id: `VB-OTHER-${index}` };
    mockTransactionDocuments.set(ref.path, snapshot(ref.id, data, ref));
    return { id: ref.id, ref, data: () => data };
  });
  mockGetDoc.mockResolvedValue(snapshot('VB-001', booking, bookingRef));
  mockGetDocs.mockImplementation((reference) => {
    if (reference.path === 'venue_staff') return Promise.resolve({ docs: [{ id: 'VEN-001', ref: assignmentRef, data: () => ({ venue_id: 'VEN-001', user_id: 'STAFF-001' }) }] });
    if (reference.path === 'venue_bookings') return Promise.resolve({ docs: [{ id: 'VB-001', ref: bookingRef, data: () => booking }, ...otherDocs] });
    return Promise.resolve({ docs: [] });
  });
  mockTransactionDocuments.set(bookingRef.path, snapshot('VB-001', booking, bookingRef));
  mockTransactionDocuments.set('venues/VEN-001', snapshot('VEN-001', { name: 'Harbour Hall', setup_minutes: 30, turnaround_minutes: 15 }));
  mockTransactionDocuments.set(assignmentRef.path, snapshot('VEN-001', { venue_id: 'VEN-001', user_id: 'STAFF-001' }, assignmentRef));
};
// Anything written to notifications, whatever its type, so a notice written
// with the wrong type is still seen.
const outcomeNotices = () => mockTransactionSet.mock.calls
  .filter(([reference]) => reference.path.startsWith('notifications/'))
  .map(([, data]) => data);

test('TC-335 a booking with no recorded raiser is still approved, with nobody notified', async () => {
  approvalSetup({ booking: { requested_by: undefined } });

  await expect(approveVenueBooking({ user: { uid: 'STAFF-001' }, bookingId: 'VB-001' }))
    .resolves.toEqual({ booking_id: 'VB-001', status: 'APPROVED' });
  expect(outcomeNotices()).toEqual([]);
});

test('TC-336 an approval that is refused tells nobody anything', async () => {
  approvalSetup({ others: [{
    event_id: 'EVT-002', venue_id: 'VEN-001', status: 'APPROVED',
    start_datetime: '2026-11-20T11:00:00.000Z', end_datetime: '2026-11-20T13:00:00.000Z'
  }] });

  await expect(approveVenueBooking({ user: { uid: 'STAFF-001' }, bookingId: 'VB-001' })).rejects.toThrow(/clashes with approved booking/);
  expect(outcomeNotices()).toEqual([]);
  expect(mockTransactionSet).not.toHaveBeenCalled();
  expect(mockTransactionUpdate).not.toHaveBeenCalled();
});

test('TC-337 one approval, one notification, unread, even when the booking carries no event name', async () => {
  approvalSetup({ booking: { event_name: undefined } });

  await approveVenueBooking({ user: { uid: 'STAFF-001' }, bookingId: 'VB-001' });

  expect(outcomeNotices()).toEqual([{
    notification_id: 'notifications-auto', user_id: 'COORD-001', event_id: 'EVT-001',
    type: 'VENUE_BOOKING_APPROVED', message: 'Your event: the booking for Harbour Hall was approved.',
    is_read: false, created_at: 'SERVER_TIMESTAMP', read_at: null,
    booking_id: 'VB-001', venue_id: 'VEN-001'
  }]);
});

test('F8 cancellation release clears the linked booking while retaining history records', async () => {
  const approvedRef = { path: 'venue_bookings/VB-APPROVED', id: 'VB-APPROVED' };
  const pendingRef = { path: 'venue_bookings/VB-PENDING', id: 'VB-PENDING' };
  const approved = { booking_id: 'VB-APPROVED', event_id: 'EVT-001', venue_id: 'VEN-001', status: 'APPROVED' };
  const pending = { booking_id: 'VB-PENDING', event_id: 'EVT-001', venue_id: 'VEN-002', status: 'PENDING' };
  mockGetDocs.mockResolvedValue({ docs: [
    { id: 'VB-APPROVED', ref: approvedRef, data: () => approved },
    { id: 'VB-PENDING', ref: pendingRef, data: () => pending }
  ] });
  mockTransactionDocuments.set('events/EVT-001', snapshot('EVT-001', {
    coordinator_id: 'COORD-001', status: 'CANCELLED', approved_venue_booking_id: 'VB-APPROVED'
  }));
  mockTransactionDocuments.set(approvedRef.path, snapshot('VB-APPROVED', approved, approvedRef));
  mockTransactionDocuments.set(pendingRef.path, snapshot('VB-PENDING', pending, pendingRef));

  await expect(releaseCancelledEventBookings({ user: { uid: 'COORD-001' }, eventId: 'EVT-001' }))
    .resolves.toEqual([
      { booking_id: 'VB-APPROVED', status: 'RELEASED' },
      { booking_id: 'VB-PENDING', status: 'WITHDRAWN' }
    ]);

  expect(mockTransactionUpdate).toHaveBeenCalledWith(approvedRef, expect.objectContaining({ status: 'RELEASED', release_reason: 'Event cancelled' }));
  expect(mockTransactionUpdate).toHaveBeenCalledWith(pendingRef, expect.objectContaining({ status: 'WITHDRAWN', release_reason: 'Event cancelled' }));
  expect(mockTransactionUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'events/EVT-001' }),
    { approved_venue_booking_id: null, updated_at: 'SERVER_TIMESTAMP' }
  );
  expect(mockTransactionSet).toHaveBeenCalledTimes(2);
});

// K5 / SCRUM-186 AC2 — booking actions follow the event's *current* coordinator. A
// coordinator the event was reassigned away from keeps nothing: not the booking they
// raised, and not the list of bookings. The server (firestore.rules, K5-RT3) refuses the
// same write; the adapter stops it first and says why.
describe('K5 SCRUM-186 venue bookings follow the coordinator the event is assigned to', () => {
  const pendingBooking = { event_id: 'EVT-9', venue_id: 'VEN-1', status: 'PENDING', requested_by: 'COORD-OLD' };
  const storedDocs = (eventCoordinator) => (ref) => {
    if (ref.path === 'venue_bookings/VB-9') return Promise.resolve(snapshot('VB-9', pendingBooking, ref));
    if (ref.path === 'events/EVT-9') return Promise.resolve(snapshot('EVT-9', { coordinator_id: eventCoordinator, status: 'APPROVED' }, ref));
    return Promise.resolve({ exists: () => false, data: () => undefined });
  };

  test('K5-TC8 AC2 a coordinator the event was reassigned away from cannot withdraw the booking they raised', async () => {
    mockGetDoc.mockImplementation(storedDocs('COORD-NEW'));

    await expect(withdrawVenueBooking({ user: { uid: 'COORD-OLD' }, bookingId: 'VB-9' }))
      .rejects.toThrow('Only the current event coordinator may withdraw this booking.');
    expect(firestore.updateDoc).not.toHaveBeenCalled();
  });

  test('K5-TC9 AC2 the coordinator the event is assigned to can withdraw a pending booking', async () => {
    mockGetDoc.mockImplementation(storedDocs('COORD-NEW'));

    await expect(withdrawVenueBooking({ user: { uid: 'COORD-NEW' }, bookingId: 'VB-9' }))
      .resolves.toEqual({ booking_id: 'VB-9', status: 'WITHDRAWN' });
    expect(firestore.updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'venue_bookings/VB-9' }),
      expect.objectContaining({ status: 'WITHDRAWN' })
    );
  });

  test('K5-TC10 AC2 withdrawing needs a signed-in coordinator, and an unknown booking is refused without a write', async () => {
    mockGetDoc.mockImplementation(storedDocs('COORD-NEW'));

    await expect(withdrawVenueBooking({ bookingId: 'VB-9' })).rejects.toThrow('Sign in is required.');
    await expect(withdrawVenueBooking({ user: { uid: 'COORD-NEW' }, bookingId: 'VB-GONE' })).rejects.toThrow();
    expect(firestore.updateDoc).not.toHaveBeenCalled();
  });

  test('K5-TC11 AC1 the bookings list is built from the events currently assigned to the coordinator and no others', async () => {
    const queries = [];
    mockGetDocs.mockImplementation((reference) => {
      queries.push(reference);
      const eventId = (reference.constraints || []).find((item) => item[0] === 'event_id')?.[2];
      if (reference.path === 'events') return Promise.resolve({ docs: [{ id: 'EVT-1', data: () => ({ name: 'Mine', coordinator_id: 'COORD-1' }) }] });
      if (reference.path === 'venue_bookings' && eventId === 'EVT-1') {
        return Promise.resolve({ docs: [{ id: 'VB-1', data: () => ({ event_id: 'EVT-1', venue_id: 'VEN-1', status: 'APPROVED' }) }] });
      }
      return Promise.resolve({ docs: [] });
    });
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });

    const bookings = await loadVenueBookings({ user: { uid: 'COORD-1' } });

    expect(bookings.map((item) => item.booking_id)).toEqual(['VB-1']);
    const eventsQuery = queries.find((item) => item.path === 'events');
    expect(eventsQuery.constraints).toEqual([['coordinator_id', '==', 'COORD-1']]);
    const bookingQueries = queries.filter((item) => item.path === 'venue_bookings');
    // K5 still scopes the returned rows through the coordinator's assigned
    // event. F10 additionally reads the same venue to compare approved windows,
    // but never adds those other coordinators' bookings to this list.
    expect(bookingQueries).toEqual(expect.arrayContaining([
      expect.objectContaining({ constraints: [['event_id', '==', 'EVT-1']] }),
      expect.objectContaining({ constraints: [['venue_id', '==', 'VEN-1']] })
    ]));
  });

  // E8 — TC-396. A coordinator may get venue_staff/{venueId} but not read Venue
  // Staff profiles, so the name comes from the assignment's staff_name.
  test('TC-396 each booking carries its venue\'s Venue Staff name from the assignment, blank when there is none', async () => {
    mockGetDocs.mockImplementation((reference) => {
      if (reference.path === 'events') return Promise.resolve({ docs: [{ id: 'EVT-1', data: () => ({ name: 'Mine', coordinator_id: 'COORD-1' }) }] });
      if (reference.path === 'venue_bookings') return Promise.resolve({ docs: [
        { id: 'VB-1', data: () => ({ event_id: 'EVT-1', venue_id: 'VEN-1', status: 'PENDING' }) },
        { id: 'VB-2', data: () => ({ event_id: 'EVT-1', venue_id: 'VEN-2', status: 'PENDING' }) },
        { id: 'VB-3', data: () => ({ event_id: 'EVT-1', venue_id: 'VEN-3', status: 'PENDING' }) }
      ] });
      return Promise.resolve({ docs: [] });
    });
    const reads = [];
    mockGetDoc.mockImplementation((reference) => {
      reads.push(reference.path);
      if (reference.path === 'venue_staff/VEN-1') return Promise.resolve(snapshot('VEN-1', { venue_id: 'VEN-1', user_id: 'STAFF-1', staff_name: 'Priya Nair' }));
      if (reference.path === 'venue_staff/VEN-3') return Promise.reject(new Error('Missing or insufficient permissions.'));
      return Promise.resolve({ exists: () => false, data: () => undefined });
    });

    const bookings = await loadVenueBookings({ user: { uid: 'COORD-1' } });

    expect(Object.fromEntries(bookings.map((item) => [item.booking_id, item.venue_staff_name])))
      .toEqual({ 'VB-1': 'Priya Nair', 'VB-2': null, 'VB-3': null });
    expect(reads.filter((path) => path.startsWith('users/'))).toEqual([]);
  });
});

// Venue Staff may read bookings only for venues assigned to them (firestore.rules,
// assignedVenueStaff). Firestore refuses a list query it cannot prove stays inside
// that, so an unfiltered read of venue_bookings failed the whole catalogue with
// "Missing or insufficient permissions." TC-386, TC-387 in docs/test-cases.md.
const catalogueRows = (path) => ({
  venues: [['V-1', { name: 'Harbour Hall' }], ['V-2', { name: 'Breakout Room' }], ['V-3', { name: "Someone else's hall" }]],
  venue_staff: [['V-1', { venue_id: 'V-1', user_id: 'STAFF-001' }], ['V-2', { venue_id: 'V-2', user_id: 'STAFF-001' }]]
}[path] || []);
const docsOf = (items) => ({ docs: items.map(([id, data]) => snapshot(id, data)) });
const bookingQueries = () => mockGetDocs.mock.calls.map(([reference]) => reference).filter((reference) => reference.path === 'venue_bookings');

test('TC-386 Venue Staff read bookings one assigned venue at a time, never the whole collection', async () => {
  mockGetDocs.mockImplementation((reference) => {
    if (reference.path === 'venue_bookings') {
      const venueId = reference.constraints[0][2];
      return Promise.resolve(docsOf([[`B-${venueId}`, { venue_id: venueId, status: 'APPROVED', start_datetime: '2026-11-04T01:00:00.000Z', end_datetime: '2026-11-04T03:00:00.000Z' }]]));
    }
    return Promise.resolve(docsOf(catalogueRows(reference.path)));
  });

  const context = await loadVenueSearchContext({ userId: 'STAFF-001', role: 'VENUE_STAFF' });

  expect(bookingQueries()).toEqual([
    { path: 'venue_bookings', constraints: [['venue_id', '==', 'V-1']] },
    { path: 'venue_bookings', constraints: [['venue_id', '==', 'V-2']] }
  ]);
  expect(context.bookings.map((booking) => [booking.id, booking.venue_id])).toEqual([['B-V-1', 'V-1'], ['B-V-2', 'V-2']]);
  // The catalogue itself still lists every venue.
  expect(context.venues.map((venue) => venue.venue_id)).toEqual(['V-1', 'V-2', 'V-3']);
});

test('TC-387 Venue Staff with no assigned venue read no bookings; coordinators still read them all', async () => {
  mockGetDocs.mockImplementation((reference) => Promise.resolve(docsOf(reference.path === 'venue_staff' ? [] : catalogueRows(reference.path))));
  const unassigned = await loadVenueSearchContext({ userId: 'STAFF-002', role: 'VENUE_STAFF' });
  expect(bookingQueries()).toEqual([]);
  expect(unassigned.bookings).toEqual([]);

  mockGetDocs.mockClear();
  mockGetDocs.mockImplementation((reference) => Promise.resolve(docsOf(reference.path === 'venue_bookings'
    ? [['B-1', { venue_id: 'V-3', status: 'PENDING' }]]
    : catalogueRows(reference.path))));
  const coordinator = await loadVenueSearchContext({ userId: 'COORD-001', role: 'EVENT_COORDINATOR' });
  expect(bookingQueries()).toEqual([{ path: 'venue_bookings' }]);
  expect(coordinator.bookings.map((booking) => booking.id)).toEqual(['B-1']);
});

// One owner per venue — TC-397, TC-398. firestore.rules honours only the
// assignment keyed by the venue id, so a seeded "-staff-2" record must not make
// the queue or catalogue read that venue's bookings: one refused query failed
// the whole Booking requests screen with "Missing or insufficient permissions."
const assignmentsFor = () => docsOf([
  ['V-OWN', { venue_id: 'V-OWN', user_id: 'STAFF-001' }],
  ['V-OTHER-staff-2', { venue_id: 'V-OTHER', user_id: 'STAFF-001' }]
]);

test('TC-397 the booking queue reads only venues the staff member owns, ignoring a second-staff record', async () => {
  mockGetDocs.mockImplementation((reference) => {
    if (reference.path === 'venue_staff') return Promise.resolve(assignmentsFor());
    if (reference.path === 'venue_bookings') return Promise.resolve(docsOf([['B-1', { venue_id: 'V-OWN', status: 'PENDING' }]]));
    return Promise.resolve({ docs: [] });
  });
  mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });

  const queue = await loadVenueBookingQueue({ user: { uid: 'STAFF-001' } });

  expect(bookingQueries().map((reference) => reference.constraints)).toEqual([[['venue_id', '==', 'V-OWN']]]);
  expect(queue.map((booking) => booking.booking_id)).toEqual(['B-1']);
});

test('TC-398 the catalogue marks only owned venues as the staff member\'s, so their bookings alone are read', async () => {
  mockGetDocs.mockImplementation((reference) => Promise.resolve(reference.path === 'venue_staff'
    ? assignmentsFor()
    : docsOf(reference.path === 'venues'
      ? [['V-OWN', { venue_id: 'V-OWN', name: 'Own' }], ['V-OTHER', { venue_id: 'V-OTHER', name: 'Other' }]]
      : [])));

  const context = await loadVenueSearchContext({ userId: 'STAFF-001', role: 'VENUE_STAFF' });

  expect(context.venues.filter((venue) => venue.is_assigned_to_user).map((venue) => venue.venue_id)).toEqual(['V-OWN']);
  expect(bookingQueries().map((reference) => reference.constraints)).toEqual([[['venue_id', '==', 'V-OWN']]]);
});

// TC-401 — the queue keeps decided bookings, so an approved request does not
// vanish from the Venue Staff screen; the screen filters by status.
test('TC-401 the booking queue returns decided bookings with their decision time, not only pending ones', async () => {
  mockGetDocs.mockImplementation((reference) => {
    if (reference.path === 'venue_staff') return Promise.resolve(assignmentsFor());
    if (reference.path === 'venue_bookings') return Promise.resolve(docsOf([
      ['B-1', { venue_id: 'V-OWN', status: 'PENDING', submitted_at: '2026-10-02T00:00:00.000Z' }],
      ['B-2', { venue_id: 'V-OWN', status: 'APPROVED', submitted_at: '2026-10-01T00:00:00.000Z', decided_at: '2026-10-03T00:00:00.000Z' }]
    ]));
    return Promise.resolve({ docs: [] });
  });
  mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });

  const queue = await loadVenueBookingQueue({ user: { uid: 'STAFF-001' } });

  expect(queue.map((booking) => [booking.booking_id, booking.status, booking.decided_at || null])).toEqual([
    ['B-2', 'APPROVED', '2026-10-03T00:00:00.000Z'],
    ['B-1', 'PENDING', null]
  ]);
});
