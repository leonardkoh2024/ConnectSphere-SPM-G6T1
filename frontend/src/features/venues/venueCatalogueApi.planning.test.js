// E9 / F9 / F10 — Venue Staff editing a venue's planning details: setup and
// turnaround time, emergency access notes and known restrictions. Covers who may
// save, what counts as a change, the approved bookings whose occupied windows move
// with a new setup or turnaround time, the history and notices written, and the
// backend clash recheck, whose failure must not fail the save.

import { saveVenuePlanningDetails } from './venuesApi';

const mockGetDocs = jest.fn();
const mockDocuments = new Map();
const mockWrites = { updates: [], sets: [] };

jest.mock('firebase/firestore', () => ({
  collection: (_database, name) => ({ path: name }),
  doc: (parent, collectionName, id) => {
    if (parent?.path && collectionName === undefined) {
      mockWrites.autoId = (mockWrites.autoId || 0) + 1;
      return { path: `${parent.path}/auto${mockWrites.autoId}`, id: `auto${mockWrites.autoId}` };
    }
    return { path: `${collectionName}/${id}`, id };
  },
  getDoc: jest.fn(),
  getDocs: (...args) => mockGetDocs(...args),
  query: (reference, ...constraints) => ({ ...reference, constraints }),
  runTransaction: async (_database, operation) => operation({
    // A snapshot carries its own ref, as Firestore's does.
    get: async (reference) => ({ ...(mockDocuments.get(reference.path) || { exists: () => false, data: () => undefined }), ref: reference }),
    update: (reference, data) => mockWrites.updates.push([reference.path, data]),
    set: (reference, data) => mockWrites.sets.push([reference.path, data])
  }),
  serverTimestamp: () => 'TS',
  updateDoc: jest.fn(),
  where: (...parts) => parts
}));

jest.mock('../../lib/firebase', () => ({ db: { name: 'browser-firestore' } }));

const found = (data) => ({ exists: () => true, data: () => data });
const staff = { uid: 'staff-1', getIdToken: jest.fn() };
const harbourHall = { name: 'Harbour Hall', setup_minutes: 0, turnaround_minutes: 0, emergency_access_notes: 'Exit B', known_restrictions: '' };
const assignment = { venue_id: 'VEN-1', user_id: 'staff-1' };

const booking = (id, data) => ({
  id, ref: { path: `venue_bookings/${id}` },
  data: () => ({
    venue_id: 'VEN-1', start_datetime: new Date('2026-11-20T01:00:00.000Z'), end_datetime: new Date('2026-11-20T09:00:00.000Z'), ...data
  })
});
let bookings;

const save = (changes, overrides = {}) => saveVenuePlanningDetails({ user: staff, venueId: 'VEN-1', changes, ...overrides });
const setsTo = (prefix) => mockWrites.sets.filter(([path]) => path.startsWith(prefix)).map(([, data]) => data);

beforeEach(() => {
  mockWrites.updates = [];
  mockWrites.sets = [];
  mockWrites.autoId = 0;
  mockDocuments.clear();
  bookings = [
    booking('BK-APPROVED', { status: 'APPROVED', event_id: 'EVT-1' }),
    booking('BK-PENDING', { status: 'PENDING', event_id: 'EVT-2' }),
    booking('BK-SAME-EVENT', { status: 'APPROVED', event_id: 'EVT-1' }),
    booking('BK-RELEASED', { status: 'RELEASED', event_id: 'EVT-3' })
  ];
  bookings.forEach((item) => mockDocuments.set(item.ref.path, found(item.data())));
  mockDocuments.set('venues/VEN-1', found(harbourHall));
  mockDocuments.set('venue_staff/VEN-1', found(assignment));
  mockGetDocs.mockReset().mockImplementation(async (source) => {
    if (source.path === 'venue_staff') return { docs: [{ id: 'VEN-1', ref: { path: 'venue_staff/VEN-1' }, data: () => assignment }] };
    if (source.path === 'venue_bookings') return { docs: bookings };
    return { docs: [] };
  });
  staff.getIdToken.mockReset().mockResolvedValue('token-1');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete global.fetch;
  console.warn.mockRestore();
});

describe('saveVenuePlanningDetails refuses', () => {
  test('a save with no signed-in user or no venue', async () => {
    await expect(save({}, { user: null })).rejects.toThrow('Sign in is required.');
    await expect(save({}, { venueId: '' })).rejects.toThrow('That venue could not be identified.');
  });

  test.each([
    [{ setup_minutes: -5 }, 'Setup time must be a whole number of minutes at least zero.'],
    [{ setup_minutes: 1.5 }, 'Setup time must be a whole number of minutes at least zero.'],
    [{ turnaround_minutes: 'soon' }, 'Turnaround time must be a whole number of minutes at least zero.']
  ])('%j before reading anything', async (changes, message) => {
    await expect(save(changes)).rejects.toThrow(message);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  test('someone not assigned to the venue, including through a second staff record', async () => {
    mockGetDocs.mockImplementation(async (source) => (source.path === 'venue_staff'
      ? { docs: [{ id: 'VEN-1-staff-2', ref: { path: 'venue_staff/VEN-1-staff-2' }, data: () => assignment }] }
      : { docs: [] }));
    await expect(save({ setup_minutes: 30 })).rejects.toThrow('You are not assigned to manage this venue.');
    expect(mockWrites.updates).toEqual([]);
  });

  test('an assignment that changed hands before the save commits', async () => {
    mockDocuments.set('venue_staff/VEN-1', found({ ...assignment, user_id: 'staff-2' }));
    await expect(save({ setup_minutes: 30 })).rejects.toThrow('You are not assigned to manage this venue.');
    expect(mockWrites.updates).toEqual([]);
  });

  test('a venue that no longer exists', async () => {
    mockDocuments.delete('venues/VEN-1');
    await expect(save({ setup_minutes: 30 })).rejects.toThrow('Venue not found.');
  });
});

describe('saveVenuePlanningDetails with nothing new', () => {
  test('writes nothing; an unset time counts as zero and notes are compared trimmed (a time that was sent still asks for a recheck)', async () => {
    mockDocuments.set('venues/VEN-1', found({ name: 'Harbour Hall', emergency_access_notes: 'Exit B' }));

    const saved = await save({ setup_minutes: '0', turnaround_minutes: 0, emergency_access_notes: '  Exit B  ' });

    expect(mockWrites).toMatchObject({ updates: [], sets: [] });
    expect(global.fetch).toHaveBeenCalled();
    expect(saved).toEqual({
      venue_id: 'VEN-1', name: 'Harbour Hall', emergency_access_notes: 'Exit B', setup_minutes: 0, turnaround_minutes: 0
    });
  });
});

describe('F9 F10 a new setup or turnaround time', () => {
  test('moves the occupied window of each approved booking, and leaves pending and released ones', async () => {
    await save({ setup_minutes: 30, turnaround_minutes: 15 });

    expect(mockWrites.updates).toEqual([
      ['venues/VEN-1', { setup_minutes: 30, turnaround_minutes: 15 }],
      ['venue_bookings/BK-APPROVED', { occupied_start: new Date('2026-11-20T00:30:00.000Z'), occupied_end: new Date('2026-11-20T09:15:00.000Z') }],
      ['venue_bookings/BK-SAME-EVENT', { occupied_start: new Date('2026-11-20T00:30:00.000Z'), occupied_end: new Date('2026-11-20T09:15:00.000Z') }]
    ]);
  });

  test('records one history row per changed field, with the old value', async () => {
    await save({ setup_minutes: 30, turnaround_minutes: 0, known_restrictions: '  No confetti ' });

    expect(setsTo('venue_change_history/')).toEqual([
      { history_id: 'auto1', venue_id: 'VEN-1', actor_id: 'staff-1', field_name: 'setup_minutes', old_value: 0, new_value: 30, created_at: 'TS' },
      { history_id: 'auto2', venue_id: 'VEN-1', actor_id: 'staff-1', field_name: 'known_restrictions', old_value: '', new_value: 'No confetti', created_at: 'TS' }
    ]);
  });

  test('tells the venue owner once for each pending or approved event at the venue', async () => {
    await save({ setup_minutes: 30 });

    const notices = setsTo('notifications/');
    expect(notices.map((notice) => notice.event_id)).toEqual(['EVT-1', 'EVT-2']);
    expect(notices.every((notice) => notice.user_id === 'staff-1' && notice.type === 'VENUE_DETAILS_UPDATED'
      && notice.venue_id === 'VEN-1' && notice.message === 'Harbour Hall: venue details changed for a related event.')).toBe(true);
  });

  test('asks the venue service to recheck clashes, signed with the caller\'s token', async () => {
    const saved = await save({ setup_minutes: 30 });

    expect(global.fetch).toHaveBeenCalledWith('/api/venues/VEN-1/recheck-conflicts', {
      method: 'POST', headers: { Authorization: 'Bearer token-1' }
    });
    expect(saved).toMatchObject({ venue_id: 'VEN-1', name: 'Harbour Hall', setup_minutes: 30 });
  });

  test.each([
    ['the service refuses', () => { global.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'nope' }) }); }],
    ['the service cannot be reached', () => { global.fetch.mockRejectedValue(new Error('offline')); }]
  ])('still reports the save as done when %s', async (_name, arrange) => {
    arrange();
    await expect(save({ setup_minutes: 30 })).resolves.toMatchObject({ setup_minutes: 30 });
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('a change to the notes only', () => {
  test('moves no booking and asks for no recheck', async () => {
    await save({ emergency_access_notes: 'Use Exit C' });

    expect(mockWrites.updates).toEqual([['venues/VEN-1', { emergency_access_notes: 'Use Exit C' }]]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a caller without an ID token is not sent to the service at all', async () => {
    await save({ setup_minutes: 30 }, { user: { uid: 'staff-1' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
