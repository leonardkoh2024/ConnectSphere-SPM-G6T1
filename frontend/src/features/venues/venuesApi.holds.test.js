// F15 / SCRUM-180 — Place a tentative hold on a venue.
//
// FUNCTIONAL holdVenueBooking, and the hold's effect on
//                                requestVenueBooking and approveVenueBooking,
//                                against a mocked Firestore.
// RULES the server boundary in firestore.rules.

import fs from 'fs';
import path from 'path';
import { approveVenueBooking, holdVenueBooking, rejectVenueBooking, requestVenueBooking } from './venuesApi';

const mockTransactionUpdate = jest.fn();
const mockTransactionSet = jest.fn();
const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockDocuments = new Map();

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
    get: async (reference) => mockDocuments.get(reference.path) || { exists: () => false, data: () => undefined },
    update: mockTransactionUpdate,
    set: mockTransactionSet
  }),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  updateDoc: jest.fn(),
  where: (...parts) => parts
}));

jest.mock('../../lib/firebase', () => ({ db: { name: 'browser-firestore' } }));

const sg = (date, time) => new Date(`${date}T${time}:00+08:00`);
const found = (id, data, ref = { path: `documents/${id}`, id }) => ({ id, ref, exists: () => true, data: () => data });

// Monday 19 Oct 2026, 10:00 Singapore: a hold placed now expires Thu 22 Oct, 10:00.
const now = sg('2026-10-19', '10:00');
const expiry = sg('2026-10-22', '10:00');
const staff = { uid: 'STAFF-001' };

test('TC-0948 F5 sends rejection through the authenticated venue service, not client Firestore writes', async () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ booking_id: 'VB-001', status: 'REJECTED', decision_reason: 'No fit.' })
  });
  global.fetch = fetchMock;
  try {
    const user = { ...staff, getIdToken: jest.fn().mockResolvedValue('staff-token') };
    await expect(rejectVenueBooking({ user, bookingId: 'VB-001', reason: ' No fit. ' }))
      .resolves.toEqual({ booking_id: 'VB-001', status: 'REJECTED', decision_reason: 'No fit.' });
    expect(fetchMock).toHaveBeenCalledWith('/api/venues/bookings/VB-001/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer staff-token' },
      body: JSON.stringify({ reason: 'No fit.' })
    });
  } finally {
    if (originalFetch) global.fetch = originalFetch;
    else delete global.fetch;
  }
});

const pending = {
  booking_id: 'VB-001', booking_label: 'Annual Conference — Harbour Hall', event_id: 'EVT-001', event_name: 'Annual Conference',
  venue_id: 'VEN-001', status: 'PENDING', requested_by: 'COORD-001',
  start_datetime: sg('2026-11-20', '09:00'), end_datetime: sg('2026-11-20', '17:00'),
  submitted_at: sg('2026-10-14', '09:00')
};
const venue = { name: 'Harbour Hall', max_capacity: 400, setup_minutes: 30, turnaround_minutes: 15 };

// The documents a Venue Staff decision reads: the booking, its venue, the
// staff member's assignment, the venue's other bookings and its blocks.
const staffScene = ({ booking = pending, others = [], blocks = [] } = {}) => {
  const bookingRef = { path: `venue_bookings/${booking.booking_id}`, id: booking.booking_id };
  const assignmentRef = { path: 'venue_staff/VEN-001', id: 'VEN-001' };
  mockGetDoc.mockResolvedValue(found(booking.booking_id, booking, bookingRef));
  const bookingDocs = [booking, ...others].map((item) => found(item.booking_id, item, { path: `venue_bookings/${item.booking_id}`, id: item.booking_id }));
  const blockDocs = blocks.map((item) => found(item.id, item, { path: `venue_unavailability/${item.id}`, id: item.id }));
  mockGetDocs.mockImplementation((reference) => {
    if (reference.path === 'venue_staff') return Promise.resolve({ docs: [{ id: 'VEN-001', ref: assignmentRef, data: () => ({ venue_id: 'VEN-001', user_id: 'STAFF-001' }) }] });
    if (reference.path === 'venue_bookings') return Promise.resolve({ docs: bookingDocs });
    if (reference.path === 'venue_unavailability') return Promise.resolve({ docs: blockDocs });
    return Promise.resolve({ docs: [] });
  });
  [...bookingDocs, ...blockDocs].forEach((item) => mockDocuments.set(item.ref.path, item));
  mockDocuments.set('venues/VEN-001', found('VEN-001', venue));
  mockDocuments.set(assignmentRef.path, found('VEN-001', { venue_id: 'VEN-001', user_id: 'STAFF-001' }, assignmentRef));
};

const updatesTo = (pathName) => mockTransactionUpdate.mock.calls.filter(([reference]) => reference.path === pathName).map(([, data]) => data);
const setsIn = (collectionName) => mockTransactionSet.mock.calls.filter(([reference]) => reference.path.startsWith(`${collectionName}/`)).map(([, data]) => data);

beforeEach(() => {
  mockTransactionUpdate.mockClear();
  mockTransactionSet.mockClear();
  mockGetDoc.mockReset();
  mockGetDocs.mockReset();
  mockDocuments.clear();
});

describe('F15 / SCRUM-180 functional — Venue Staff place a hold', () => {
  test('TC-1122 a hold records the venue, event, occupied window and an expiry three working days on', async () => {
    staffScene();

    await expect(holdVenueBooking({ user: staff, bookingId: 'VB-001', now }))
      .resolves.toEqual({ booking_id: 'VB-001', status: 'HELD', hold_expires_at: expiry.toISOString() });

    expect(updatesTo('venue_bookings/VB-001')).toEqual([{
      status: 'HELD',
      assigned_staff_id: 'STAFF-001',
      held_by: 'STAFF-001',
      held_at: 'SERVER_TIMESTAMP',
      hold_expires_at: expiry,
      // Setup 30 minutes before, turnaround 15 after.
      occupied_start: sg('2026-11-20', '08:30'),
      occupied_end: sg('2026-11-20', '17:15')
    }]);
    expect(setsIn('event_history')).toEqual([expect.objectContaining({
      event_id: 'EVT-001', booking_id: 'VB-001', venue_id: 'VEN-001', actor_id: 'STAFF-001',
      action_type: 'VENUE_BOOKING_HELD', old_value: 'PENDING', new_value: 'HELD',
      description: 'Venue booking Annual Conference — Harbour Hall held until Thu 22 Oct 2026, 10:00.'
    })]);
  });

  test('TC-1123 the coordinator who raised it is told, with the expiry', async () => {
    staffScene();

    await holdVenueBooking({ user: staff, bookingId: 'VB-001', now });

    expect(setsIn('notifications')).toEqual([expect.objectContaining({
      type: 'VENUE_BOOKING_HELD', user_id: 'COORD-001', event_id: 'EVT-001', event_name: 'Annual Conference', booking_id: 'VB-001', venue_id: 'VEN-001',
      hold_expires_at: expiry,
      message: 'Annual Conference: Harbour Hall is held for this event until Thu 22 Oct 2026, 10:00.',
      is_read: false, created_at: 'SERVER_TIMESTAMP'
    })]);
  });

  test('TC-1124 an event that needs the venue before the hold would end cannot be held', async () => {
    staffScene({ booking: { ...pending, start_datetime: sg('2026-10-21', '09:00'), end_datetime: sg('2026-10-21', '12:00') } });

    await expect(holdVenueBooking({ user: staff, bookingId: 'VB-001', now })).rejects.toThrow(
      'A hold placed now would last until Thu 22 Oct 2026, 10:00, but the venue is needed from Wed 21 Oct 2026, 08:30. Approve or reject this request instead.'
    );
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });

  test('TC-1125 only the venue’s own staff may hold, and only a pending request', async () => {
    staffScene();
    await expect(holdVenueBooking({ user: { uid: 'STAFF-OTHER' }, bookingId: 'VB-001', now }))
      .rejects.toThrow('You are not assigned to manage this venue.');

    staffScene({ booking: { ...pending, status: 'APPROVED' } });
    await expect(holdVenueBooking({ user: staff, bookingId: 'VB-001', now }))
      .rejects.toThrow('Only a pending booking request can be put on hold.');
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
  });

  test('TC-1126 a hold meets the same clashes an approval does', async () => {
    const other = (fields) => ({
      ...pending, booking_id: 'VB-002', event_id: 'EVT-002', booking_label: 'Board Retreat — Harbour Hall', ...fields
    });

    staffScene({ others: [other({ status: 'APPROVED' })] });
    await expect(holdVenueBooking({ user: staff, bookingId: 'VB-001', now }))
      .rejects.toThrow('This period clashes with approved booking Board Retreat — Harbour Hall.');

    staffScene({ others: [other({ status: 'PENDING', submitted_at: sg('2026-10-13', '09:00') })] });
    await expect(holdVenueBooking({ user: staff, bookingId: 'VB-001', now }))
      .rejects.toThrow('An earlier submitted request for this venue and time must be decided first.');

    staffScene({ blocks: [{ id: 'U-1', venue_id: 'VEN-001', reason: 'Roof repairs', start_datetime: sg('2026-11-20', '00:00'), end_datetime: sg('2026-11-21', '00:00') }] });
    await expect(holdVenueBooking({ user: staff, bookingId: 'VB-001', now }))
      .rejects.toThrow('The venue is unavailable during this period: Roof repairs');

    expect(mockTransactionUpdate).not.toHaveBeenCalled();
  });
});

describe('F15 / SCRUM-180 functional — while a hold is active the venue is kept', () => {
  const activeHold = {
    ...pending, booking_id: 'VB-HOLD', event_id: 'EVT-009', booking_label: 'Board Retreat — Harbour Hall', status: 'HELD',
    occupied_start: sg('2026-11-20', '08:30'), occupied_end: sg('2026-11-20', '17:15'), hold_expires_at: expiry
  };

  // A coordinator raising a request for the same venue on the same day.
  const coordinatorScene = (holds) => {
    mockDocuments.set('events/EVT-001', found('EVT-001', {
      coordinator_id: 'COORD-001', status: 'PLANNING', name: 'Annual Conference',
      event_date: '2026-11-20', start_time: '13:00', end_time: '16:00', expected_attendance: 100
    }));
    mockDocuments.set('venues/VEN-001', found('VEN-001', venue));
    const holdDocs = holds.map((item) => found(item.booking_id, item, { path: `venue_bookings/${item.booking_id}`, id: item.booking_id }));
    holdDocs.forEach((item) => mockDocuments.set(item.ref.path, item));
    mockGetDocs.mockImplementation((reference) => Promise.resolve({
      docs: reference.path === 'venue_bookings' && reference.constraints?.[0]?.[0] === 'venue_id' ? holdDocs : []
    }));
  };
  const raise = (fields) => requestVenueBooking({
    user: { uid: 'COORD-001' }, event_id: 'EVT-001', venue_id: 'VEN-001',
    required_layout: 'THEATRE', required_facilities: [], acknowledgement: { acknowledged: false, criteria: [] }, now, ...fields
  });

  test("TC-1127 an overlapping request for the held venue is refused, naming the hold and its expiry", async () => {
    coordinatorScene([activeHold]);

    await expect(raise()).rejects.toThrow(
      'Harbour Hall is held for Board Retreat — Harbour Hall until Thu 22 Oct 2026, 10:00, and cannot be requested for an overlapping time.'
    );
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });

  test('TC-1128 once the hold has expired the same request goes through', async () => {
    coordinatorScene([activeHold]);

    await expect(raise({ now: sg('2026-10-22', '10:00') })).resolves.toMatchObject({ status: 'PENDING' });
  });

  test('TC-1129 Venue Staff convert an active hold into an approved booking', async () => {
    staffScene({ booking: activeHold });

    await expect(approveVenueBooking({ user: staff, bookingId: 'VB-HOLD', now: sg('2026-10-20', '15:00') }))
      .resolves.toEqual({ booking_id: 'VB-HOLD', status: 'APPROVED' });

    expect(updatesTo('venue_bookings/VB-HOLD')).toEqual([expect.objectContaining({ status: 'APPROVED', decided_by: 'STAFF-001' })]);
    expect(setsIn('event_history')).toEqual([expect.objectContaining({ action_type: 'VENUE_BOOKING_APPROVED', old_value: 'HELD', new_value: 'APPROVED' })]);
  });

  test('TC-1130 an expired hold can no longer be converted', async () => {
    staffScene({ booking: activeHold });

    await expect(approveVenueBooking({ user: staff, bookingId: 'VB-HOLD', now: sg('2026-10-22', '10:00') }))
      .rejects.toThrow('This hold expired on Thu 22 Oct 2026, 10:00 and can no longer be converted.');
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
  });

  test("TC-1131 another event's request over an active hold cannot be approved", async () => {
    staffScene({ others: [activeHold] });

    await expect(approveVenueBooking({ user: staff, bookingId: 'VB-001', now: sg('2026-10-20', '15:00') }))
      .rejects.toThrow('This period is held for Board Retreat — Harbour Hall until Thu 22 Oct 2026, 10:00.');
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// RULES — read from firestore.rules
// ---------------------------------------------------------------------------

const rules = fs.readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8');
const block = (start) => rules.slice(rules.indexOf(start));
const bookingUpdateRule = () => block('match /venue_bookings/{bookingId}').match(/allow update:\s*if([^;]*);/)[1];
const compact = (text) => text.replace(/\s+/g, ' ');

describe('F15 / SCRUM-180 rules — a crafted write cannot bend the hold', () => {
  test('TC-1132 only the assigned Venue Staff move a pending request to Held, stamped now, for exactly three working days, ending before the venue is needed', () => {
    const rule = compact(bookingUpdateRule());
    expect(rule).toContain("resource.data.status == 'PENDING' && request.resource.data.status == 'HELD'");
    expect(rule).toContain('request.resource.data.held_by == request.auth.uid');
    expect(rule).toContain('request.resource.data.held_at == request.time');
    expect(rule).toContain('holdExpiryIsThreeWorkingDays(request.resource.data.hold_expires_at)');
    expect(rule).toContain('request.resource.data.hold_expires_at < request.resource.data.occupied_start');
    expect(rule).toMatch(/affectedKeys\(\)\.hasOnly\(\[ 'status', 'assigned_staff_id', 'held_by', 'held_at', 'hold_expires_at', 'occupied_start', 'occupied_end' \]\)/);
    // The day count follows Singapore's weekday (UTC+8) from 1 Jan 1970, a Thursday.
    expect(compact(rules)).toMatch(/function holdExpiryIsThreeWorkingDays\(expiresAt\)/);
    expect(rules).toContain('28800000');
  });

  test('TC-1133 a hold converts to an approval only while it has not expired', () => {
    const rule = compact(bookingUpdateRule());
    expect(rule).toContain("(resource.data.status == 'PENDING' || (resource.data.status == 'HELD' && resource.data.hold_expires_at > request.time)) && request.resource.data.status == 'APPROVED'");
  });

  test('TC-1134 the hold’s history row and notice can be written only with the hold itself', () => {
    const history = compact(block('match /event_history/{historyId}'));
    expect(history).toContain("request.resource.data.action_type == 'VENUE_BOOKING_HELD'");
    const notices = compact(block('match /notifications/{notificationId}'));
    expect(notices).toContain('function venueBookingHoldNotice(booking)');
    expect(notices).toContain('booking.held_by == request.auth.uid && booking.held_at == request.time');
    expect(notices).toContain("['VENUE_BOOKING_APPROVED', 'VENUE_BOOKING_REJECTED', 'VENUE_BOOKING_HELD']");
  });
});
