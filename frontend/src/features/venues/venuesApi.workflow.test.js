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
    if (args.length === 1) return { path: 'event_history/history-auto', id: 'history-auto' };
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

import { approveVenueBooking, releaseCancelledEventBookings } from './venuesApi';

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
    if (reference.path === 'venue_staff') return Promise.resolve({ docs: [{ ref: assignmentRef, data: () => ({ venue_id: 'VEN-001', user_id: 'STAFF-001' }) }] });
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
