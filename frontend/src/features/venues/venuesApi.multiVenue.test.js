// F12 / SCRUM-177 — Book more than one venue for an event.
//
// FUNCTIONAL requestVenueBooking, the one place a booking is
//                                written, against a mocked Firestore.
// RULES the server boundary in firestore.rules, which a
//                                crafted request that skips this code still meets.

import fs from 'fs';
import path from 'path';
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

// One conference: 300 pax, 09:00–17:00 Singapore time on 20 Nov.
const conference = {
  coordinator_id: 'coordinator-1', status: 'PLANNING', name: 'Annual Conference',
  event_date: '2026-11-20', start_time: '09:00', end_time: '17:00', expected_attendance: 300
};
const mainHall = { name: 'Main Hall', max_capacity: 400, setup_minutes: 0, turnaround_minutes: 0 };
const seminarRoom = { name: 'Seminar Room', max_capacity: 60, setup_minutes: 0, turnaround_minutes: 0 };

// The main programme already booked in the Main Hall, as Firestore would hand it back.
const mainProgramme = {
  booking_id: 'BK-MAIN', booking_label: 'Main programme', event_id: 'EVT-1', venue_id: 'VEN-MAIN', status: 'PENDING',
  start_datetime: new Date('2026-11-20T01:00:00.000Z'), end_datetime: new Date('2026-11-20T09:00:00.000Z'),
  occupied_start: new Date('2026-11-20T01:00:00.000Z'), occupied_end: new Date('2026-11-20T09:00:00.000Z')
};
const existing = (...bookings) => {
  const docs = bookings.map((data) => ({ id: data.booking_id, ref: { path: `venue_bookings/${data.booking_id}` }, data: () => data }));
  docs.forEach((item) => mockDocuments.set(item.ref.path, found(item.data())));
  mockGetDocs.mockResolvedValue({ docs });
};

const request = (fields) => requestVenueBooking({
  user,
  event_id: 'EVT-1',
  venue_id: 'VEN-SEM',
  booking_label: 'Breakout 1',
  expected_attendance: 50,
  required_layout: 'CLASSROOM',
  required_facilities: [],
  acknowledgement: { acknowledged: false, criteria: [] },
  ...fields
});
const bookingsWritten = () => mockTransactionSet.mock.calls
  .filter(([reference]) => reference.path.startsWith('venue_bookings/'))
  .map(([, data]) => data);

beforeEach(() => {
  mockTransactionSet.mockClear();
  mockGetDocs.mockReset().mockResolvedValue({ docs: [] });
  mockDocuments.clear();
  mockDocuments.set('events/EVT-1', found(conference));
  mockDocuments.set('venues/VEN-MAIN', found(mainHall));
  mockDocuments.set('venues/VEN-SEM', found(seminarRoom));
});

describe('F12 / SCRUM-177 functional — requesting a second venue for the same event', () => {
  test('TC-1077 a second venue is accepted alongside the first, with its own label, attendance and layout', async () => {
    existing(mainProgramme);

    await expect(request()).resolves.toEqual({ booking_id: 'venue_bookings-auto', status: 'PENDING' });

    expect(bookingsWritten()).toEqual([expect.objectContaining({
      event_id: 'EVT-1',
      venue_id: 'VEN-SEM',
      booking_label: 'Breakout 1',
      expected_attendance: 50,
      requested_layout_id: 'CLASSROOM',
      layout_snapshot: 'CLASSROOM',
      status: 'PENDING'
    })]);
  });

  test("TC-1078 an attendance above the event's is refused and nothing is written", async () => {
    await expect(request({ expected_attendance: 301 }))
      .rejects.toThrow("Expected attendance cannot be more than the event's 300.");
    await expect(request({ expected_attendance: 0 }))
      .rejects.toThrow('Expected attendance must be a whole number greater than zero.');
    await expect(request({ expected_attendance: 12.5 }))
      .rejects.toThrow('Expected attendance must be a whole number greater than zero.');

    expect(mockTransactionSet).not.toHaveBeenCalled();
  });

  test('TC-1079 a blank label is refused and nothing is written; the label is stored trimmed', async () => {
    await expect(request({ booking_label: '   ' })).rejects.toThrow(/label/i);
    expect(mockTransactionSet).not.toHaveBeenCalled();

    await request({ booking_label: '  Breakout 1  ' });
    expect(bookingsWritten()[0].booking_label).toBe('Breakout 1');
  });

  test('TC-1080 the same venue again at an overlapping time for the same event is refused, naming the booking it clashes with', async () => {
    existing(mainProgramme);

    await expect(request({ venue_id: 'VEN-MAIN', booking_label: 'Overflow', expected_attendance: 100 }))
      .rejects.toThrow('This event already has an active booking for Main Hall at an overlapping time: Main programme.');
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });

  test('TC-1081 once the first booking for that venue is withdrawn, the venue may be requested again', async () => {
    existing({ ...mainProgramme, status: 'WITHDRAWN' });

    await expect(request({ venue_id: 'VEN-MAIN', booking_label: 'Main programme', expected_attendance: 300 }))
      .resolves.toMatchObject({ status: 'PENDING' });
  });

  test("TC-1082 a room is checked against the booking's attendance, so a small breakout room fits a large event", async () => {
    // The Seminar Room holds 60; the conference is 300; the breakout is 50.
    await expect(request()).resolves.toMatchObject({ status: 'PENDING' });
    // 61 for a 60-seat room is still refused.
    mockTransactionSet.mockClear();
    await expect(request({ expected_attendance: 61 })).rejects.toThrow('The venue cannot hold the expected attendance.');
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// RULES — the create rule for venue_bookings, read from firestore.rules
// ---------------------------------------------------------------------------

const rules = fs.readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8');
const createRule = () => {
  const block = rules.slice(rules.indexOf('match /venue_bookings/{bookingId}'));
  return block.match(/allow create:\s*if([^;]*);/)[1];
};

describe('F12 / SCRUM-177 rules — a crafted request cannot skip the per-booking checks', () => {
  test("TC-1083 a booking's attendance cannot exceed its event's", () => {
    expect(createRule()).toMatch(
      /request\.resource\.data\.expected_attendance\s*<=\s*get\(\/databases\/\$\(database\)\/documents\/events\/\$\(request\.resource\.data\.event_id\)\)\.data\.expected_attendance/
    );
  });

  test('TC-1084 a booking must carry a label that is not blank', () => {
    expect(createRule()).toContain('request.resource.data.booking_label is string');
    expect(createRule()).toContain('request.resource.data.booking_label.trim().size() > 0');
  });
});
