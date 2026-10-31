// E8 / F1 / F11 / F12 — what requestVenueBooking refuses, in what order, and what
// it fills in when the caller leaves it out. The successful request, clashes, holds
// and capacity are covered in venuesApi.multiVenue.test.js and venuesApi.holds.test.js;
// this file covers the remaining checks, each of which must leave nothing written.

import { requestVenueBooking } from './venuesApi';

const mockTransactionSet = jest.fn();
const mockGetDocs = jest.fn();
const mockDocuments = new Map();

jest.mock('firebase/firestore', () => ({
  collection: (_database, name) => ({ path: name }),
  doc: (parent, collectionName, id) => {
    if (parent?.path && collectionName === undefined) return { path: `${parent.path}/auto`, id: `${parent.path}-auto` };
    return { path: `${collectionName}/${id}`, id };
  },
  getDoc: jest.fn(),
  getDocs: (...args) => mockGetDocs(...args),
  query: (reference) => reference,
  runTransaction: async (_database, operation) => operation({
    get: async (reference) => mockDocuments.get(reference.path) || { exists: () => false, data: () => undefined },
    set: mockTransactionSet,
    update: jest.fn()
  }),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  updateDoc: jest.fn(),
  where: (...parts) => parts
}));

jest.mock('../../lib/firebase', () => ({ db: { name: 'browser-firestore' } }));

const found = (data) => ({ exists: () => true, data: () => data });
const user = { uid: 'coordinator-1' };

const conference = {
  coordinator_id: 'coordinator-1', status: 'PLANNING', name: 'Annual Conference', reference_no: 'EVT-REF-1',
  event_date: '2026-11-20', start_time: '09:00', end_time: '17:00', expected_attendance: 300
};
const mainHall = { name: 'Main Hall', max_capacity: 400, setup_minutes: 0, turnaround_minutes: 0 };

const request = (fields) => requestVenueBooking({
  user,
  event_id: 'EVT-1',
  venue_id: 'VEN-MAIN',
  booking_label: 'Main programme',
  expected_attendance: 300,
  required_layout: 'THEATRE',
  required_facilities: [],
  acknowledgement: { acknowledged: false, criteria: [] },
  ...fields
});
const written = (prefix) => mockTransactionSet.mock.calls
  .filter(([reference]) => reference.path.startsWith(prefix))
  .map(([, data]) => data);

beforeEach(() => {
  mockTransactionSet.mockClear();
  mockGetDocs.mockReset().mockResolvedValue({ docs: [] });
  mockDocuments.clear();
  mockDocuments.set('events/EVT-1', found(conference));
  mockDocuments.set('venues/VEN-MAIN', found(mainHall));
});

describe('requestVenueBooking refuses an incomplete request before reading anything', () => {
  test.each([
    ['no event', { event_id: '' }, 'An event and venue are required.'],
    ['no venue', { venue_id: undefined }, 'An event and venue are required.'],
    ['a blank layout', { required_layout: '   ' }, 'A required layout must be recorded.'],
    ['facilities that are not a list', { required_facilities: 'STAGE' }, 'Facility requirements must be recorded.']
  ])('%s', async (_name, fields, message) => {
    await expect(request(fields)).rejects.toThrow(message);
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });

  test('a request without a signed-in user is refused', async () => {
    await expect(request({ user: null })).rejects.toThrow('Sign in is required.');
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });
});

describe('requestVenueBooking refuses what the stored event and venue do not allow', () => {
  test.each([
    ['a missing event', () => mockDocuments.delete('events/EVT-1'), 'Event not found.'],
    ['a missing venue', () => mockDocuments.delete('venues/VEN-MAIN'), 'Venue not found.'],
    ['an event assigned to another coordinator',
      () => mockDocuments.set('events/EVT-1', found({ ...conference, coordinator_id: 'coordinator-2' })),
      'Only the current event coordinator may request a venue.'],
    ['a Submitted event',
      () => mockDocuments.set('events/EVT-1', found({ ...conference, status: 'SUBMITTED' })),
      'Venue requests are available only for Approved or Planning events.'],
    ['a Confirmed event',
      () => mockDocuments.set('events/EVT-1', found({ ...conference, status: 'CONFIRMED' })),
      'Venue requests are available only for Approved or Planning events.'],
    ['an inactive venue',
      () => mockDocuments.set('venues/VEN-MAIN', found({ ...mainHall, is_active: false })),
      'This venue is inactive and cannot be requested.'],
    ['an event with no usable attendance',
      () => mockDocuments.set('events/EVT-1', found({ ...conference, expected_attendance: 0 })),
      'Expected attendance must be a positive whole number.'],
    ['an event that ends before it starts',
      () => mockDocuments.set('events/EVT-1', found({ ...conference, start_time: '17:00', end_time: '09:00' })),
      'The event must have a valid date and time window.']
  ])('%s', async (_name, arrange, message) => {
    arrange();
    await expect(request()).rejects.toThrow(message);
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });

  test('an Approved event may request a venue as well as a Planning one', async () => {
    mockDocuments.set('events/EVT-1', found({ ...conference, status: 'approved' }));
    await expect(request()).resolves.toMatchObject({ status: 'PENDING' });
  });

  test('when several checks fail, the coordinator check is reported before the venue being inactive', async () => {
    mockDocuments.set('events/EVT-1', found({ ...conference, coordinator_id: 'coordinator-2' }));
    mockDocuments.set('venues/VEN-MAIN', found({ ...mainHall, is_active: false }));
    await expect(request()).rejects.toThrow('Only the current event coordinator may request a venue.');
  });

  test('when the venue is inactive and too small, the inactive venue is reported first', async () => {
    mockDocuments.set('venues/VEN-MAIN', found({ ...mainHall, is_active: false, max_capacity: 10 }));
    await expect(request()).rejects.toThrow('This venue is inactive and cannot be requested.');
  });
});

describe('F11 requestVenueBooking as a replacement for a lost venue', () => {
  const lost = {
    booking_id: 'BK-LOST', event_id: 'EVT-1', venue_id: 'VEN-OLD', booking_label: 'Old hall',
    replacement_needed: true, replacement_reason: 'Venue unavailable'
  };

  test('a replacement for a booking that does not exist is refused', async () => {
    await expect(request({ replacement_for_booking_id: 'BK-GONE' }))
      .rejects.toThrow('The booking needing replacement was not found.');
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });

  test.each([
    ['belongs to another event', { event_id: 'EVT-2' }],
    ['is not awaiting a replacement', { replacement_needed: false }]
  ])('a replacement for a booking that %s is refused', async (_name, change) => {
    mockDocuments.set('venue_bookings/BK-LOST', found({ ...lost, ...change }));
    await expect(request({ replacement_for_booking_id: 'BK-LOST' }))
      .rejects.toThrow('This booking is not awaiting a replacement for this event.');
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });

  test('an accepted replacement records the booking and venue it replaces', async () => {
    mockDocuments.set('venue_bookings/BK-LOST', found(lost));
    await request({ replacement_for_booking_id: 'BK-LOST' });
    expect(written('venue_bookings/')[0]).toMatchObject({
      replacement_for_booking_id: 'BK-LOST', replacement_original_venue_id: 'VEN-OLD',
      replacement_original_label: 'Old hall', replacement_reason: 'Venue unavailable'
    });
  });
});

describe('requestVenueBooking fills in what the caller leaves out, and tells Venue Staff', () => {
  test("F12 with no label or attendance the booking takes the event's", async () => {
    await request({ booking_label: undefined, expected_attendance: undefined });
    expect(written('venue_bookings/')[0]).toMatchObject({
      booking_label: 'Annual Conference — Main Hall', expected_attendance: 300,
      event_name: 'Annual Conference', event_reference_no: 'EVT-REF-1', requested_by: 'coordinator-1',
      required_facilities_snapshot: [], replacement_for_booking_id: null
    });
  });

  test('facility requirements are stored trimmed and without duplicates', async () => {
    await request({ required_facilities: [' STAGE', 'STAGE', '', 'WIFI '] });
    expect(written('venue_bookings/')[0].required_facilities_snapshot).toEqual(['STAGE', 'WIFI']);
  });

  test("the venue's assigned staff member is notified of the new request", async () => {
    mockDocuments.set('venue_staff/VEN-MAIN', found({ venue_id: 'VEN-MAIN', user_id: 'staff-1' }));
    await request();
    expect(written('notifications/')).toEqual([expect.objectContaining({
      user_id: 'staff-1', event_id: 'EVT-1', type: 'VENUE_BOOKING_REQUESTED', venue_id: 'VEN-MAIN',
      message: 'Annual Conference: a venue booking request was raised for Main Hall.'
    })]);
  });

  test('a venue with no assigned staff member gets the request without a notification', async () => {
    await expect(request()).resolves.toMatchObject({ status: 'PENDING' });
    expect(written('notifications/')).toEqual([]);
  });
});
