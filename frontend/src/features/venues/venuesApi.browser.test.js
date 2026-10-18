const mockTransactionSet = jest.fn();
const mockTransactionUpdate = jest.fn();
const mockGetDocs = jest.fn();
const mockVenueStaff = jest.fn();
const assignedTo = (userId) => ({ exists: () => true, data: () => ({ venue_id: 'venue-1', user_id: userId }) });

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
      if (reference.path === 'venue_staff/venue-1') return mockVenueStaff();
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
    mockVenueStaff.mockReset().mockReturnValue(assignedTo('staff-1'));
  });

  test('creates a pending request in a Firestore transaction without requesting an Admin token', async () => {
    const user = { uid: 'coordinator-1', getIdToken: jest.fn() };

    await expect(requestVenueBooking({
      user,
      event_id: 'event-1',
      venue_id: 'venue-1',
      required_layout: 'THEATRE',
      required_facilities: ['WIFI', 'POWER_POINTS'],
      acknowledgement: { acknowledged: false, criteria: [] }
    })).resolves.toEqual({ booking_id: 'booking-auto', status: 'PENDING' });

    expect(user.getIdToken).not.toHaveBeenCalled();
    expect(mockTransactionSet).toHaveBeenCalledTimes(2);
    expect(mockTransactionSet.mock.calls[0][1]).toMatchObject({
      booking_id: 'booking-auto',
      event_id: 'event-1',
      venue_id: 'venue-1',
      requested_by: 'coordinator-1',
      status: 'PENDING',
      expected_attendance: 80,
      requested_layout_id: 'THEATRE',
      layout_snapshot: 'THEATRE',
      required_facilities_snapshot: ['WIFI', 'POWER_POINTS']
    });
    expect(mockTransactionSet.mock.calls[1][1]).toMatchObject({
      type: 'VENUE_BOOKING_REQUESTED',
      event_id: 'event-1',
      user_id: 'staff-1',
      venue_id: 'venue-1',
      message: expect.stringContaining('venue booking request'),
      // J4 / SCRUM-153 TC-540 — Venue Staff cannot read the event, so the notice names it.
      event_name: 'Community Innovation Forum'
    });
    expect(mockTransactionSet.mock.calls[0][1].occupied_start.toISOString()).toBe('2026-11-10T01:30:00.000Z');
    expect(mockTransactionSet.mock.calls[0][1].occupied_end.toISOString()).toBe('2026-11-10T04:15:00.000Z');
  });

  // A coordinator may get venue_staff/{venueId} but not list the collection, so
  // the assignment must be read as that one document. TC-392, TC-393.
  test('TC-392 reads the venue assignment as one document, never a list query on venue_staff', async () => {
    await requestVenueBooking({
      user: { uid: 'coordinator-1' },
      event_id: 'event-1',
      venue_id: 'venue-1',
      required_layout: 'THEATRE',
      required_facilities: [],
      acknowledgement: { acknowledged: false, criteria: [] }
    });

    expect(mockVenueStaff).toHaveBeenCalledTimes(1);
    expect(mockGetDocs.mock.calls.map(([reference]) => reference.path)).not.toContain('venue_staff');
  });

  test('TC-393 still raises the request when no Venue Staff member manages the venue, notifying nobody', async () => {
    mockVenueStaff.mockReturnValue({ exists: () => false, data: () => undefined });

    await expect(requestVenueBooking({
      user: { uid: 'coordinator-1' },
      event_id: 'event-1',
      venue_id: 'venue-1',
      required_layout: 'THEATRE',
      required_facilities: [],
      acknowledgement: { acknowledged: false, criteria: [] }
    })).resolves.toEqual({ booking_id: 'booking-auto', status: 'PENDING' });

    expect(mockTransactionSet).toHaveBeenCalledTimes(1);
    expect(mockTransactionSet.mock.calls[0][1]).toMatchObject({ status: 'PENDING', venue_id: 'venue-1' });
  });

  test.each([
    ['layout', { required_layout: '', required_facilities: [] }, /required layout/i],
    ['facility declaration', { required_layout: 'THEATRE', required_facilities: undefined }, /facility requirements/i]
  ])('refuses a request with no %s before starting a transaction', async (_label, fields, error) => {
    await expect(requestVenueBooking({
      user: { uid: 'coordinator-1' },
      event_id: 'event-1',
      venue_id: 'venue-1',
      acknowledgement: { acknowledged: false, criteria: [] },
      ...fields
    })).rejects.toThrow(error);
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });
});
