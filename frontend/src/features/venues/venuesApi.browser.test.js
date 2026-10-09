const mockTransactionSet = jest.fn();
const mockTransactionUpdate = jest.fn();
const mockGetDocs = jest.fn();

jest.mock('firebase/firestore', () => ({
  collection: (_database, name) => ({ path: name }),
  doc: (parent, collectionName, id) => {
    if (parent?.path && collectionName === undefined) {
      return { path: `${parent.path}/booking-auto`, id: 'booking-auto' };
    }
    return { path: `${collectionName}/${id}`, id };
  },
  getDoc: jest.fn(),
  getDocs: (...args) => mockGetDocs(...args),
  query: (reference) => reference,
  runTransaction: async (_database, operation) => operation({
    get: async (reference) => {
      if (reference.path === 'events/event-1') return {
        exists: () => true,
        data: () => ({
          coordinator_id: 'coordinator-1', status: 'PLANNING', name: 'Community Innovation Forum',
          event_date: '2026-11-10', start_time: '10:00', end_time: '12:00', expected_attendance: 80
        })
      };
      if (reference.path === 'venues/venue-1') return {
        exists: () => true,
        data: () => ({ name: 'Harbour Auditorium', max_capacity: 120, setup_minutes: 30, turnaround_minutes: 15 })
      };
      throw new Error(`Unexpected transaction read: ${reference.path}`);
    },
    set: mockTransactionSet,
    update: mockTransactionUpdate
  }),
  serverTimestamp: () => ({ serverTimestamp: true }),
  updateDoc: jest.fn(),
  where: (...parts) => parts
}));

jest.mock('../../lib/firebase', () => ({ db: { name: 'browser-firestore' } }));

import { requestVenueBooking } from './venuesApi';

describe('venue booking browser SDK persistence', () => {
  beforeEach(() => {
    mockTransactionSet.mockClear();
    mockTransactionUpdate.mockClear();
    mockGetDocs.mockReset().mockResolvedValue({ docs: [] });
  });

  test('creates a pending request in a Firestore transaction without requesting an Admin token', async () => {
    const user = { uid: 'coordinator-1', getIdToken: jest.fn() };

    await expect(requestVenueBooking({
      user,
      event_id: 'event-1',
      venue_id: 'venue-1',
      required_layout: 'THEATRE',
      acknowledgement: { acknowledged: false, criteria: [] }
    })).resolves.toEqual({ booking_id: 'booking-auto', status: 'PENDING' });

    expect(user.getIdToken).not.toHaveBeenCalled();
    expect(mockTransactionSet).toHaveBeenCalledTimes(1);
    expect(mockTransactionSet.mock.calls[0][1]).toMatchObject({
      booking_id: 'booking-auto',
      event_id: 'event-1',
      venue_id: 'venue-1',
      requested_by: 'coordinator-1',
      status: 'PENDING',
      expected_attendance: 80,
      requested_layout_id: 'THEATRE'
    });
    expect(mockTransactionSet.mock.calls[0][1].occupied_start.toISOString()).toBe('2026-11-10T01:30:00.000Z');
    expect(mockTransactionSet.mock.calls[0][1].occupied_end.toISOString()).toBe('2026-11-10T04:15:00.000Z');
  });
});
