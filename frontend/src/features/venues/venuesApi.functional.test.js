// venuesApi against an in-memory Firestore — the paths the other venuesApi.*.test.js
// files leave out: E9 / F10 venue timings, the catalogue loaders, E11 unavailability,
// and the refusals of F1, F4, F5, F8, F10, F11, F14 and K5.
// FUNCTIONAL.

import {
  approveVenueBooking,
  holdVenueBooking,
  loadVenueBookingQueue,
  loadVenueBookings,
  loadVenueCatalogue,
  loadVenueSafetyCatalogue,
  loadVenueSearchContext,
  prepareClashReplacement,
  rejectVenueBooking,
  rejectVenueBookingInFirestore,
  releaseCancelledEventBookings,
  releaseVenueBooking,
  requestVenueBooking,
  saveVenueCatalogue,
  saveVenuePlanningDetails,
  saveVenueUnavailability,
  withdrawVenueBooking
} from './venuesApi';

// ---- In-memory Firestore ------------------------------------------------------
// Documents live in mockStore by path ("venue_bookings/VB-1"). Reads of a missing
// document return a snapshot that does not exist; list queries filter by the
// "==" constraints given; every write is recorded in mockWrites.
const mockStore = new Map();
const mockWrites = [];
const mockFailures = new Map();
let mockAuto = 0;
const mockBeforeTransaction = { current: null };

jest.mock('firebase/firestore', () => {
  const snapshotOf = (path) => {
    const id = path.split('/').pop();
    const data = mockStore.get(path);
    return { id, ref: { path, id }, exists: () => data !== undefined, data: () => data };
  };
  const record = (kind) => (ref, data) => { mockWrites.push({ kind, path: ref.path, data }); };
  return {
    collection: (_db, name) => ({ path: name }),
    doc: (...args) => {
      if (args.length === 1) {
        mockAuto += 1;
        return { path: `${args[0].path}/auto-${mockAuto}`, id: `auto-${mockAuto}` };
      }
      return { path: `${args[1]}/${args[2]}`, id: args[2] };
    },
    getDoc: async (ref) => {
      if (mockFailures.has(ref.path)) throw mockFailures.get(ref.path);
      return snapshotOf(ref.path);
    },
    getDocs: async (reference) => {
      if (mockFailures.has(reference.path)) throw mockFailures.get(reference.path);
      const docs = [...mockStore.keys()]
        .filter((path) => path.startsWith(`${reference.path}/`) && !path.slice(reference.path.length + 1).includes('/'))
        .map(snapshotOf)
        .filter((item) => (reference.constraints || []).every(([field, , value]) => item.data()[field] === value));
      return { docs };
    },
    query: (reference, ...constraints) => ({ ...reference, constraints }),
    where: (...parts) => parts,
    // mockBeforeTransaction lets a test change a document between the read
    // outside the transaction and the re-read inside it — a concurrent write.
    runTransaction: async (_db, operation) => {
      if (mockBeforeTransaction.current) mockBeforeTransaction.current();
      return operation({
        get: async (ref) => snapshotOf(ref.path),
        set: record('set'),
        update: record('update')
      });
    },
    serverTimestamp: () => 'STAMP',
    updateDoc: async (ref, data) => { mockWrites.push({ kind: 'updateDoc', path: ref.path, data }); }
  };
});
jest.mock('../../lib/firebase', () => ({ db: { name: 'test-db' } }));

const put = (path, data) => mockStore.set(path, data);
const writesTo = (prefix) => mockWrites.filter((item) => item.path.startsWith(prefix));
const writeAt = (path) => mockWrites.filter((item) => item.path === path);
const sg = (date, time) => new Date(`${date}T${time}:00+08:00`);

const originalFetch = global.fetch;
beforeEach(() => {
  mockStore.clear();
  mockWrites.length = 0;
  mockFailures.clear();
  mockAuto = 0;
  mockBeforeTransaction.current = null;
  global.fetch = jest.fn();
});
afterAll(() => {
  if (originalFetch) global.fetch = originalFetch;
  else delete global.fetch;
});

// A venue with 30 minutes setup and 15 turnaround, owned by STAFF-1.
const staffScene = () => {
  put('venues/VEN-1', { name: 'Harbour Hall', max_capacity: 200, setup_minutes: 30, turnaround_minutes: 15 });
  put('venue_staff/VEN-1', { venue_id: 'VEN-1', user_id: 'STAFF-1', staff_name: 'Priya Nair' });
};
const staff = { uid: 'STAFF-1' };
const coordinator = { uid: 'COORD-1' };

// ---- E9 / F10 ---------------------------------------------------------------

describe("E9 / SCRUM-171 + F10 / SCRUM-175 functional — saving a venue's setup and turnaround time", () => {
  const approved = {
    booking_id: 'VB-A', event_id: 'EVT-A', venue_id: 'VEN-1', status: 'APPROVED',
    start_datetime: '2026-11-20T02:00:00.000Z', end_datetime: '2026-11-20T04:00:00.000Z'
  };

  test('TC-0827 [normal] new timings re-window every approved booking, record who changed what, and ask the service to recheck clashes', async () => {
    staffScene();
    put('venues/VEN-1', { name: 'Harbour Hall' });
    put('venue_bookings/VB-A', approved);
    put('venue_bookings/VB-P', { ...approved, booking_id: 'VB-P', event_id: 'EVT-A', status: 'PENDING' });
    put('venue_bookings/VB-R', { ...approved, booking_id: 'VB-R', event_id: 'EVT-R', status: 'REJECTED' });
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const user = { uid: 'STAFF-1', getIdToken: jest.fn().mockResolvedValue('tok') };

    await expect(saveVenuePlanningDetails({ user, venueId: 'VEN-1', changes: { setup_minutes: '30', turnaround_minutes: 45 } }))
      .resolves.toEqual({ venue_id: 'VEN-1', name: 'Harbour Hall', setup_minutes: 30, turnaround_minutes: 45 });

    expect(writeAt('venues/VEN-1')).toEqual([{ kind: 'update', path: 'venues/VEN-1', data: { setup_minutes: 30, turnaround_minutes: 45 } }]);
    // E9 AC1/F9: start − 30 minutes to end + 45 minutes, on the approved booking only.
    expect(writeAt('venue_bookings/VB-A').map((item) => [item.data.occupied_start.toISOString(), item.data.occupied_end.toISOString()]))
      .toEqual([['2026-11-20T01:30:00.000Z', '2026-11-20T04:45:00.000Z']]);
    expect(writeAt('venue_bookings/VB-P')).toEqual([]);
    // E9 AC3: one history row per changed field, previous value defaulting to 0.
    expect(writesTo('venue_change_history/').map((item) => item.data)).toEqual([
      expect.objectContaining({ venue_id: 'VEN-1', actor_id: 'STAFF-1', field_name: 'setup_minutes', old_value: 0, new_value: 30, created_at: 'STAMP' }),
      expect.objectContaining({ field_name: 'turnaround_minutes', old_value: 0, new_value: 45 })
    ]);
    // One notice per live related event, not per booking.
    expect(writesTo('notifications/').map((item) => [item.data.event_id, item.data.type, item.data.venue_id])).toEqual([['EVT-A', 'VENUE_DETAILS_UPDATED', 'VEN-1']]);
    expect(global.fetch).toHaveBeenCalledWith('/api/venues/VEN-1/recheck-conflicts', { method: 'POST', headers: { Authorization: 'Bearer tok' } });
  });

  test('TC-0828 [boundary] zero is accepted, saving unchanged values writes nothing, and notes alone are trimmed without a clash recheck', async () => {
    staffScene();
    put('venues/VEN-1', { name: 'Harbour Hall', setup_minutes: 0, turnaround_minutes: 0, emergency_access_notes: 'Door B' });
    const user = { uid: 'STAFF-1', getIdToken: jest.fn().mockResolvedValue('tok') };
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    await saveVenuePlanningDetails({ user, venueId: 'VEN-1', changes: { setup_minutes: 0, turnaround_minutes: '0' } });
    expect(mockWrites).toEqual([]);

    global.fetch.mockClear();
    const saved = await saveVenuePlanningDetails({ user, venueId: 'VEN-1', changes: { emergency_access_notes: '  Door C  ', known_restrictions: null } });
    expect(saved).toMatchObject({ emergency_access_notes: 'Door C', known_restrictions: '' });
    expect(writesTo('venue_change_history/').map((item) => [item.data.field_name, item.data.old_value, item.data.new_value]))
      .toEqual([['emergency_access_notes', 'Door B', 'Door C']]);
    expect(writesTo('venue_bookings/')).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test.each([
    [{ setup_minutes: -1 }, 'Setup time must be a whole number of minutes at least zero.'],
    [{ setup_minutes: 2.5 }, 'Setup time must be a whole number of minutes at least zero.'],
    [{ turnaround_minutes: 'abc' }, 'Turnaround time must be a whole number of minutes at least zero.']
  ])('TC-0829 [failure] %o is refused with a validation message before anything is read (E9 AC2)', async (changes, message) => {
    staffScene();
    await expect(saveVenuePlanningDetails({ user: staff, venueId: 'VEN-1', changes })).rejects.toThrow(message);
    expect(mockWrites).toEqual([]);
  });

  test('TC-0830 [failure] saving needs a signed-in user and a venue', async () => {
    await expect(saveVenuePlanningDetails({ venueId: 'VEN-1' })).rejects.toThrow('Sign in is required.');
    await expect(saveVenuePlanningDetails({ user: staff })).rejects.toThrow('That venue could not be identified.');
  });

  test("TC-0831 [conflict] only the venue's own Venue Staff may change it, checked again inside the transaction (E9 AC3)", async () => {
    put('venues/VEN-1', { name: 'Harbour Hall' });
    // A second-staff record grants nothing; only the one keyed by the venue id does.
    put('venue_staff/VEN-1-staff-2', { venue_id: 'VEN-1', user_id: 'STAFF-1' });
    await expect(saveVenuePlanningDetails({ user: staff, venueId: 'VEN-1', changes: { setup_minutes: 5 } }))
      .rejects.toThrow('You are not assigned to manage this venue.');
    staffScene();
    await expect(saveVenuePlanningDetails({ user: { uid: 'STAFF-2' }, venueId: 'VEN-1', changes: { setup_minutes: 5 } }))
      .rejects.toThrow('You are not assigned to manage this venue.');
    mockStore.delete('venues/VEN-1');
    await expect(saveVenuePlanningDetails({ user: staff, venueId: 'VEN-1', changes: { setup_minutes: 5 } })).rejects.toThrow('Venue not found.');
    // The venue is reassigned between the check and the save.
    staffScene();
    mockBeforeTransaction.current = () => put('venue_staff/VEN-1', { venue_id: 'VEN-1', user_id: 'STAFF-2' });
    await expect(saveVenuePlanningDetails({ user: staff, venueId: 'VEN-1', changes: { setup_minutes: 5 } }))
      .rejects.toThrow('You are not assigned to manage this venue.');
    mockBeforeTransaction.current = () => mockStore.delete('venue_staff/VEN-1');
    await expect(saveVenuePlanningDetails({ user: staff, venueId: 'VEN-1', changes: { setup_minutes: 5 } }))
      .rejects.toThrow('You are not assigned to manage this venue.');
    expect(mockWrites).toEqual([]);
  });

  test('TC-0832 [boundary] a booking stored with Firestore timestamps is re-windowed; a first restriction note records a blank previous value', async () => {
    staffScene();
    put('venue_bookings/VB-A', { ...approved, start_datetime: { toDate: () => new Date(approved.start_datetime) }, end_datetime: { toDate: () => new Date(approved.end_datetime) } });
    await saveVenuePlanningDetails({ user: staff, venueId: 'VEN-1', changes: { setup_minutes: 60, known_restrictions: 'No open flame' } });
    expect(writeAt('venue_bookings/VB-A')[0].data.occupied_start.toISOString()).toBe('2026-11-20T01:00:00.000Z');
    expect(writesTo('venue_change_history/').map((item) => [item.data.field_name, item.data.old_value])).toEqual([['setup_minutes', 30], ['known_restrictions', '']]);
  });

  test('TC-1019 [failure] the venue save stands when the clash recheck service fails or is unreachable (F10 AC1)', async () => {
    staffScene();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const user = { uid: 'STAFF-1', getIdToken: jest.fn().mockResolvedValue('tok') };
    try {
      global.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Backend down' }) });
      await expect(saveVenuePlanningDetails({ user, venueId: 'VEN-1', changes: { setup_minutes: 10 } })).resolves.toMatchObject({ setup_minutes: 10 });
      expect(warn.mock.calls[0][1]).toEqual(new Error('Backend down'));
      global.fetch.mockResolvedValueOnce({ ok: false, json: async () => { throw new Error('not json'); } });
      await saveVenuePlanningDetails({ user, venueId: 'VEN-1', changes: { setup_minutes: 20 } });
      expect(warn.mock.calls[1][1]).toEqual(new Error('Venue clash notifications could not be refreshed.'));
      global.fetch.mockRejectedValueOnce(new Error('offline'));
      await saveVenuePlanningDetails({ user, venueId: 'VEN-1', changes: { turnaround_minutes: 5 } });
      expect(warn).toHaveBeenCalledTimes(3);
      // Without a token there is nothing to call.
      global.fetch.mockClear();
      await saveVenuePlanningDetails({ user: staff, venueId: 'VEN-1', changes: { setup_minutes: 40 } });
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('TC-0833 [boundary] approved bookings with no window are left alone; the notice names the venue id when it has no name', async () => {
    put('venues/VEN-1', {});
    put('venue_staff/VEN-1', { venue_id: 'VEN-1', user_id: 'STAFF-1' });
    put('venue_bookings/VB-A', { ...approved, start_datetime: undefined });
    put('venue_bookings/VB-NOEVENT', { ...approved, event_id: undefined, status: 'pending' });
    put('venue_bookings/VB-NOSTATUS', { ...approved, event_id: 'EVT-Z', status: undefined });
    await saveVenuePlanningDetails({ user: staff, venueId: 'VEN-1', changes: { setup_minutes: 15 } });
    expect(writesTo('venue_bookings/')).toEqual([]);
    expect(writesTo('notifications/').map((item) => [item.data.event_id, item.data.message]))
      .toEqual([['EVT-A', 'VEN-1: venue details changed for a related event.']]);
  });
});

// ---- Catalogue loaders --------------------------------------------------------

describe('E2 / E3 / E10 functional — loading the venue catalogue', () => {
  test('TC-0583 [normal] a venue without inline lists takes its layouts, facilities, access and hours from the related collections', async () => {
    put('venues/doc-1', { name: 'Annex' });
    put('venues/doc-2', { venue_id: 'VEN-2', name: 'Studio', max_capacity: '40', layouts: ['THEATRE'], facilities: ['WIFI'], accessibility: [], operating_hours: [] });
    put('venue_layouts/l1', { venue_id: 'doc-1', layout_id: 'CLASSROOM' });
    put('venue_layouts/l2', { venue_id: 'doc-1', layout_id: 'BOARDROOM' });
    put('venue_layouts/l3', { layout_id: 'ORPHAN' });
    put('venue_layouts/l4', { venue_id: 'doc-1' });
    put('venue_facilities/f1', { venue_id: 'doc-1', facility_id: 'PROJECTOR' });
    put('venue_accessibility/a1', { venue_id: 'doc-1', accessibility_id: 'LIFT' });
    put('venue_operating_hours/h1', { venue_id: 'doc-1', weekday: 'MONDAY', opens_at: '08:00', closes_at: '18:00', extra: true });

    const venues = await loadVenueCatalogue();

    expect(venues).toEqual([
      {
        venue_id: 'doc-1', name: 'Annex', building: undefined, location: undefined, is_assigned_to_user: false,
        special_space_availability: '', max_capacity: 0, setup_minutes: 0, turnaround_minutes: 0,
        emergency_access_notes: '', known_restrictions: '',
        facilities: ['PROJECTOR'], layouts: ['CLASSROOM', 'BOARDROOM'], accessibility: ['LIFT'],
        operating_hours: [{ weekday: 'MONDAY', opens_at: '08:00', closes_at: '18:00' }]
      },
      expect.objectContaining({ venue_id: 'VEN-2', max_capacity: 40, layouts: ['THEATRE'], facilities: ['WIFI'] })
    ]);
  });

  test('TC-0840 [normal] the Safety Officer catalogue lists only safety fields, sorted by name regardless of case (E10)', async () => {
    put('venues/v-b', { name: 'beta hall', max_capacity: 10, emergency_access_notes: 'Exit C' });
    put('venues/v-a', { venue_id: 'VEN-A', name: 'Alpha', building: 'B1', location: 'EAST', known_restrictions: 'No open flame' });
    put('venues/v-c', {});
    expect(await loadVenueSafetyCatalogue()).toEqual([
      { venue_id: 'VEN-A', name: 'Alpha', building: 'B1', location: 'EAST', max_capacity: 0, emergency_access_notes: '', known_restrictions: 'No open flame' },
      { venue_id: 'v-b', name: 'beta hall', building: '', location: '', max_capacity: 10, emergency_access_notes: 'Exit C', known_restrictions: '' },
      { venue_id: 'v-c', name: 'v-c', building: '', location: '', max_capacity: 0, emergency_access_notes: '', known_restrictions: '' }
    ]);
  });

  test('TC-0604 [normal] saving a catalogue entry trims its text and writes the lists as given (E3)', async () => {
    await saveVenueCatalogue({
      venue_id: 'VEN-1', name: ' Hall ', building: ' B1 ', location: ' EAST ', max_capacity: 120, special_space_availability: ' Roof ',
      layouts: ['THEATRE'], facilities: ['WIFI'], accessibility: ['LIFT'], operating_hours: []
    });
    expect(mockWrites).toEqual([{ kind: 'updateDoc', path: 'venues/VEN-1', data: {
      name: 'Hall', building: 'B1', location: 'EAST', max_capacity: 120, special_space_availability: 'Roof',
      layouts: ['THEATRE'], facilities: ['WIFI'], accessibility: ['LIFT'], operating_hours: []
    } }]);
  });

  test("TC-0984 [boundary] search context reports each booking's occupied window and each block, timestamps as ISO text (F9 AC4, E11 AC5)", async () => {
    const stamp = (iso) => ({ toDate: () => new Date(iso) });
    put('venues/VEN-1', { name: 'Hall' });
    put('venue_bookings/b-1', {
      venue_id: 'VEN-1', status: 'APPROVED', start_datetime: stamp('2026-11-20T02:00:00.000Z'), end_datetime: stamp('2026-11-20T04:00:00.000Z'),
      occupied_start: stamp('2026-11-20T01:30:00.000Z'), occupied_end: stamp('2026-11-20T04:15:00.000Z')
    });
    put('venue_bookings/b-2', { booking_id: 'VB-2', reference_no: 'R-2', event_id: 'E-2', event_name: 'Gala', venue_id: 'VEN-1', status: 'HELD', start_time: '09:00', end_time: '10:00', hold_expires_at: '2026-11-01T00:00:00.000Z', suitability_acknowledgement: { acknowledged: true } });
    put('venue_unavailability/u-1', { venue_id: 'VEN-1', reason: 'Maintenance', start_datetime: stamp('2026-11-21T00:00:00.000Z'), end_datetime: '2026-11-21T08:00:00.000Z' });
    put('venue_unavailability/u-2', { venue_id: 'VEN-1', start_time: '09:00', end_time: '10:00' });

    const context = await loadVenueSearchContext();

    expect(context.bookings).toEqual([
      { id: 'b-1', booking_id: 'b-1', reference_no: '', event_id: '', event_name: '', venue_id: 'VEN-1', status: 'APPROVED',
        start_datetime: '2026-11-20T01:30:00.000Z', end_datetime: '2026-11-20T04:15:00.000Z', hold_expires_at: null,
        start_time: null, end_time: null, suitability_acknowledgement: null },
      expect.objectContaining({ booking_id: 'VB-2', reference_no: 'R-2', start_datetime: null, start_time: '09:00', end_time: '10:00', hold_expires_at: '2026-11-01T00:00:00.000Z', suitability_acknowledgement: { acknowledged: true } })
    ]);
    expect(context.unavailability).toEqual([
      { id: 'u-1', venue_id: 'VEN-1', reason: 'Maintenance', start_datetime: '2026-11-21T00:00:00.000Z', end_datetime: '2026-11-21T08:00:00.000Z', start_time: null, end_time: null },
      { id: 'u-2', venue_id: 'VEN-1', reason: undefined, start_datetime: null, end_datetime: null, start_time: '09:00', end_time: '10:00' }
    ]);
  });
});

// ---- E11 --------------------------------------------------------------------

describe('E11 / SCRUM-173 functional — saving unavailability goes through the venue service', () => {
  test('TC-0871 [normal] the periods kept and added are sent with the signed-in token', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ saved: 1 }) });
    const user = { getIdToken: jest.fn().mockResolvedValue('tok') };
    const additions = [{ start_datetime: '2026-11-20T01:00:00.000Z', end_datetime: '2026-11-20T05:00:00.000Z', reason: 'Maintenance', confirmed: true }];
    await expect(saveVenueUnavailability({ user, venueId: 'VEN-1', keepPeriodIds: ['u-1'], additions })).resolves.toEqual({ saved: 1 });
    expect(global.fetch).toHaveBeenCalledWith('/api/venues/unavailability', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ venue_id: 'VEN-1', keep_period_ids: ['u-1'], additions })
    });
  });

  test("TC-0872 [failure] without sign-in nothing is sent; the service's refusal is passed on, or a plain message when it gives none", async () => {
    await expect(saveVenueUnavailability({ user: {}, venueId: 'VEN-1' })).rejects.toThrow('Sign in is required to save venue availability changes.');
    expect(global.fetch).not.toHaveBeenCalled();
    const user = { getIdToken: async () => 'tok' };
    global.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Confirm the affected bookings first.' }) });
    await expect(saveVenueUnavailability({ user, venueId: 'VEN-1' })).rejects.toThrow('Confirm the affected bookings first.');
    global.fetch.mockResolvedValueOnce({ ok: false, json: async () => { throw new Error('html'); } });
    await expect(saveVenueUnavailability({ user, venueId: 'VEN-1' })).rejects.toThrow('Availability changes could not be saved.');
  });
});

// ---- F1 / F12 / F15 / K5 — requesting a venue -----------------------------------

describe('F1 / SCRUM-125 functional — requesting a venue is refused when it should be', () => {
  const event = {
    coordinator_id: 'COORD-1', status: 'PLANNING', name: 'Summit', event_date: '2026-11-20',
    start_time: '09:00', end_time: '17:00', expected_attendance: 80
  };
  const scene = (eventFields = {}, venueFields = {}) => {
    put('events/EVT-1', { ...event, ...eventFields });
    put('venues/VEN-1', { name: 'Harbour Hall', max_capacity: 200, ...venueFields });
  };
  const ask = (fields = {}) => requestVenueBooking({
    user: coordinator, event_id: 'EVT-1', venue_id: 'VEN-1', required_layout: 'THEATRE', required_facilities: [], ...fields
  });

  test('TC-0891 [failure] a request needs a signed-in coordinator, an event and a venue', async () => {
    await expect(ask({ user: null })).rejects.toThrow('Sign in is required.');
    await expect(ask({ event_id: '' })).rejects.toThrow('An event and venue are required.');
    await expect(ask({ venue_id: undefined })).rejects.toThrow('An event and venue are required.');
  });

  test('TC-0892 [failure] an event or venue that does not exist is refused', async () => {
    put('venues/VEN-1', { max_capacity: 100 });
    await expect(ask()).rejects.toThrow('Event not found.');
    put('events/EVT-1', event);
    mockStore.delete('venues/VEN-1');
    await expect(ask()).rejects.toThrow('Venue not found.');
    expect(mockWrites).toEqual([]);
  });

  test("TC-2409 [conflict] only the event's current coordinator may request a venue (K5 AC2)", async () => {
    scene({ coordinator_id: 'COORD-OTHER' });
    await expect(ask()).rejects.toThrow('Only the current event coordinator may request a venue.');
    expect(mockWrites).toEqual([]);
  });

  test.each(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'SAFETY_REVIEW', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED', undefined])(
    'TC-0893 [conflict] an event in status %s cannot request a venue (F1 AC2)',
    async (status) => {
      scene({ status });
      await expect(ask()).rejects.toThrow('Venue requests are available only for Approved or Planning events.');
    }
  );

  test('TC-0894 [conflict] an inactive venue cannot be requested', async () => {
    scene({}, { is_active: false });
    await expect(ask()).rejects.toThrow('This venue is inactive and cannot be requested.');
  });

  test('TC-1045 [failure] a replacement must point at a booking of this event that is awaiting one (F11 AC3)', async () => {
    scene({ status: 'approved' });
    await expect(ask({ replacement_for_booking_id: 'VB-GONE' })).rejects.toThrow('The booking needing replacement was not found.');
    put('venue_bookings/VB-OLD', { event_id: 'EVT-1', venue_id: 'VEN-0', status: 'APPROVED', replacement_needed: false });
    await expect(ask({ replacement_for_booking_id: 'VB-OLD' })).rejects.toThrow('This booking is not awaiting a replacement for this event.');
    put('venue_bookings/VB-OLD', { event_id: 'EVT-2', venue_id: 'VEN-0', status: 'APPROVED', replacement_needed: true });
    await expect(ask({ replacement_for_booking_id: 'VB-OLD' })).rejects.toThrow('This booking is not awaiting a replacement for this event.');
  });

  test.each([0, -5, 2.5, 'many', undefined])("TC-0895 [failure] an event whose expected attendance is %p cannot request a venue", async (expected_attendance) => {
    scene({ expected_attendance });
    await expect(ask()).rejects.toThrow('Expected attendance must be a positive whole number.');
  });

  test.each([
    ['no date', { event_date: '' }],
    ['an end before the start', { start_time: '17:00', end_time: '09:00' }],
    ['an end equal to the start', { end_time: '09:00' }],
    ['no end time', { end_time: undefined }]
  ])('TC-0896 [failure] an event with %s has no valid window to book', async (_label, fields) => {
    scene(fields);
    await expect(ask()).rejects.toThrow('The event must have a valid date and time window.');
  });

  test("TC-0822 [conflict] a venue smaller than the booking's attendance is refused; equal capacity is accepted (E8 AC1)", async () => {
    scene({}, { max_capacity: 79 });
    await expect(ask()).rejects.toThrow('The venue cannot hold the expected attendance.');
    scene({}, { max_capacity: 80 });
    await expect(ask()).resolves.toMatchObject({ status: 'PENDING' });
  });

  test('TC-0897 [boundary] defaults: names fall back to reference and id, seconds in the clock are kept, blank facilities dropped', async () => {
    put('events/EVT-1', { ...event, name: undefined, reference_no: 'EVT-2026-0001', start_time: '09:00:00', end_time: '17:30:00' });
    put('venues/VEN-1', { max_capacity: 200 });
    put('venue_staff/VEN-1', { venue_id: 'VEN-1', user_id: 'STAFF-1' });
    await ask({ required_facilities: [' WIFI ', 'WIFI', '', null, 'STAGE'] });
    const [booking] = writesTo('venue_bookings/');
    expect(booking.data).toMatchObject({
      booking_label: 'EVT-2026-0001 — VEN-1', event_name: 'EVT-2026-0001', required_facilities_snapshot: ['WIFI', 'STAGE'],
      suitability_acknowledgement: { acknowledged: false, criteria: [] }, replacement_for_booking_id: null, replacement_original_venue_id: null
    });
    expect([booking.data.start_datetime.toISOString(), booking.data.end_datetime.toISOString()]).toEqual(['2026-11-20T01:00:00.000Z', '2026-11-20T09:30:00.000Z']);
    expect(writesTo('notifications/')[0].data.message).toBe('EVT-2026-0001: a venue booking request was raised for VEN-1.');
    // With neither a name nor a reference, the event id stands in.
    mockWrites.length = 0;
    put('events/EVT-1', { ...event, name: undefined });
    await ask();
    expect(writesTo('venue_bookings/')[0].data).toMatchObject({ booking_label: 'EVT-1 — VEN-1', event_name: 'EVT-1', event_reference_no: null });
    expect(writesTo('notifications/')[0].data.event_name).toBe('EVT-1');
  });

  test('TC-0898 [conflict] a clash with the same venue for this event, or with a hold, names the booking id when it has no label', async () => {
    scene();
    put('venue_bookings/VB-SAME', { event_id: 'EVT-1', venue_id: 'VEN-1', status: 'PENDING', booking_id: 'VB-SAME', start_datetime: sg('2026-11-20', '10:00'), end_datetime: sg('2026-11-20', '11:00') });
    await expect(ask({ booking_label: 'Breakout' })).rejects.toThrow('This event already has an active booking for Harbour Hall at an overlapping time: VB-SAME.');
    // A label given but empty is refused rather than defaulted (F12 AC2).
    await expect(ask({ booking_label: null })).rejects.toThrow('Give this booking a label, such as Main programme or Breakout 1.');
    mockStore.delete('venue_bookings/VB-SAME');
    put('venue_bookings/VB-HOLD', { event_id: 'EVT-2', venue_id: 'VEN-1', status: 'HELD', hold_expires_at: '2999-01-01T00:00:00.000Z', start_datetime: sg('2026-11-20', '10:00'), end_datetime: sg('2026-11-20', '11:00') });
    mockStore.set('venues/VEN-1', { max_capacity: 200 });
    await expect(ask()).rejects.toThrow('VEN-1 is held for VB-HOLD until Tue 1 Jan 2999, 08:00, and cannot be requested for an overlapping time.');
    // A label for this event's booking clash, when the venue has no name, uses the venue id.
    put('venue_bookings/VB-HOLD', { event_id: 'EVT-1', venue_id: 'VEN-1', status: 'APPROVED', booking_label: 'Main', start_datetime: sg('2026-11-20', '10:00'), end_datetime: sg('2026-11-20', '11:00') });
    await expect(ask()).rejects.toThrow('This event already has an active booking for VEN-1 at an overlapping time: Main.');
  });
});

// ---- F7 / F10 — the coordinator's list --------------------------------------------

describe('F7 / F10 functional — the coordinator sees their bookings and the clashes on them', () => {
  test('TC-0965 [failure] signed out, the list is empty and nothing is read', async () => {
    await expect(loadVenueBookings({ user: null })).resolves.toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("TC-0966 [conflict] a clash between my approved booking and another coordinator's is attached to mine; theirs is not listed", async () => {
    put('events/EVT-1', { coordinator_id: 'COORD-1', reference_no: 'R-1', event_date: '2026-11-20', status: 'PLANNING' });
    put('events/EVT-2', { coordinator_id: 'COORD-2', name: 'Theirs' });
    put('venue_bookings/VB-MINE', { event_id: 'EVT-1', venue_id: 'VEN-1', status: 'APPROVED', occupied_start: '2099-06-10T09:00:00Z', occupied_end: '2099-06-10T11:00:00Z', requested_at: '2026-10-01T00:00:00Z' });
    put('venue_bookings/VB-THEIRS', { event_id: 'EVT-2', event_name: 'Theirs', venue_id: 'VEN-1', status: 'APPROVED', occupied_start: '2099-06-10T10:00:00Z', occupied_end: '2099-06-10T12:00:00Z' });
    put('venue_bookings/VB-NEW', { event_id: 'EVT-1', venue_id: 'VEN-9', status: 'PENDING', submitted_at: '2026-10-05T00:00:00Z' });
    put('venue_staff/VEN-1', { venue_id: 'VEN-1', user_id: 'STAFF-1' });

    const rows = await loadVenueBookings({ user: coordinator });

    expect(rows.map((row) => row.booking_id)).toEqual(['VB-NEW', 'VB-MINE']);
    const mine = rows[1];
    expect(mine).toMatchObject({ event_name: 'R-1', event_date: '2026-11-20', event_status: 'PLANNING', venue_name: 'VEN-1', venue_staff_name: null, requested_at: '2026-10-01T00:00:00Z' });
    expect(mine.clashes).toEqual([expect.objectContaining({
      booking_a_id: 'VB-MINE', booking_b_id: 'VB-THEIRS', status: 'ACTIVE', event_b_name: 'Theirs'
    })]);
    // Compared as instants: the derived overlap is a Date, not ISO text (see the report).
    expect([mine.clashes[0].overlap_start, mine.clashes[0].overlap_end].map((value) => new Date(value).toISOString()))
      .toEqual(['2099-06-10T10:00:00.000Z', '2099-06-10T11:00:00.000Z']);
    expect(rows[0].clashes).toEqual([]);
  });

  test('TC-0967 [boundary] an event with neither name nor reference shows the booking event name, then the event id', async () => {
    put('events/EVT-1', { coordinator_id: 'COORD-1' });
    put('venue_bookings/VB-1', { event_id: 'EVT-1', event_name: 'Stored name', venue_id: 'VEN-1', status: 'PENDING' });
    put('venue_bookings/VB-2', { event_id: 'EVT-1', venue_id: 'VEN-1', status: 'PENDING' });
    const rows = await loadVenueBookings({ user: coordinator });
    expect(rows.map((row) => row.event_name).sort()).toEqual(['EVT-1', 'Stored name']);
  });

  test('TC-0968 [failure] a failed workflow refresh is logged once and the list still loads', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      global.fetch.mockResolvedValueOnce({ ok: false, json: async () => { throw new Error('html'); } });
      const user = { uid: 'COORD-REFRESH-FAIL', getIdToken: jest.fn().mockResolvedValue('tok') };
      await expect(loadVenueBookings({ user })).resolves.toEqual([]);
      await loadVenueBookings({ user });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith('Could not refresh venue workflows:', new Error('Venue workflows could not be refreshed.'));
      global.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Refresh refused.' }) });
      await loadVenueBookings({ user: { uid: 'COORD-REFRESH-FAIL-2', getIdToken: async () => 'tok' } });
      expect(logged).toHaveBeenLastCalledWith('Could not refresh venue workflows:', new Error('Refresh refused.'));
    } finally {
      logged.mockRestore();
    }
  });
});

// ---- F10 → F11: preparing a clash replacement ------------------------------------

describe('F10 / SCRUM-175 functional — choosing to replace one side of a clash', () => {
  const clash = { conflict_id: 'VEN-1--VB-A--VB-B', booking_a_id: 'VB-A', booking_b_id: 'VB-B', event_a_name: 'Forum' };
  const scene = ({ event = {}, mine = {}, other = {} } = {}) => {
    put('events/EVT-1', { coordinator_id: 'COORD-1', status: 'PLANNING', ...event });
    put('venue_bookings/VB-B', { event_id: 'EVT-1', venue_id: 'VEN-1', status: 'APPROVED', occupied_start: '2099-06-10T09:00:00Z', occupied_end: '2099-06-10T11:00:00Z', ...mine });
    put('venue_bookings/VB-A', { event_id: 'EVT-2', venue_id: 'VEN-1', status: 'APPROVED', occupied_start: '2099-06-10T10:00:00Z', occupied_end: '2099-06-10T12:00:00Z', ...other });
  };
  const prepare = (fields = {}) => prepareClashReplacement({ user: coordinator, bookingId: 'VB-B', clash, ...fields });

  test.each([
    ['no user', { user: null }, 'Sign in is required.'],
    ['no booking', { bookingId: '' }, 'That booking could not be identified.'],
    ['no clash', { clash: null }, 'Choose an active clash for this booking.'],
    ['a clash that does not involve the booking', { clash: { ...clash, booking_b_id: 'VB-X' } }, 'Choose an active clash for this booking.'],
    ['a clash with a blank id', { clash: { ...clash, conflict_id: '  ' } }, 'Choose an active clash for this booking.'],
    ['a clash with no id', { clash: { ...clash, conflict_id: undefined } }, 'Choose an active clash for this booking.'],
    ['a clash of the booking with itself', { clash: { ...clash, booking_a_id: 'VB-B' } }, 'Choose an active clash for this booking.']
  ])('TC-1020 [failure] %s is refused before anything is read', async (_label, fields, message) => {
    await expect(prepare(fields)).rejects.toThrow(message);
    expect(mockWrites).toEqual([]);
  });

  test('TC-1021 [failure] a booking or event that no longer exists is refused', async () => {
    await expect(prepare()).rejects.toThrow('That booking could not be found.');
    scene();
    mockStore.delete('events/EVT-1');
    await expect(prepare()).rejects.toThrow('Event not found.');
  });

  test.each([
    ['my booking is not approved', { mine: { status: 'PENDING' } }, 'Only an approved booking can be replaced to resolve a clash.'],
    ['my booking has no status', { mine: { status: undefined } }, 'Only an approved booking can be replaced to resolve a clash.'],
    ["I am not the event's coordinator", { event: { coordinator_id: 'COORD-2' } }, 'Only the current event coordinator may resolve this booking\'s clash.'],
    ['the event is Completed', { event: { status: 'COMPLETED' } }, 'This event is not in a state where its venue can be replaced.'],
    ['the event is in Safety Review', { event: { status: 'SAFETY_REVIEW' } }, 'This event is not in a state where its venue can be replaced.'],
    ['the event has no status', { event: { status: undefined } }, 'This event is not in a state where its venue can be replaced.'],
    ['the other booking was released', { other: { status: 'RELEASED' } }, 'This booking clash is no longer active. Refresh the bookings list.'],
    ['the other booking has no status', { other: { status: undefined } }, 'This booking clash is no longer active. Refresh the bookings list.'],
    ['the other booking moved venue', { other: { venue_id: 'VEN-2' } }, 'This booking clash is no longer active. Refresh the bookings list.']
  ])('TC-1022 [conflict] it is refused when %s', async (_label, fields, message) => {
    scene(fields);
    await expect(prepare()).rejects.toThrow(message);
    expect(mockWrites).toEqual([]);
  });

  test('TC-1023 [conflict] it is refused when the other booking no longer exists', async () => {
    scene();
    mockStore.delete('venue_bookings/VB-A');
    await expect(prepare()).rejects.toThrow('This booking clash is no longer active.');
  });

  test('TC-1024 [normal] from a Planning event, the booking is flagged and the event keeps its status, naming the other event', async () => {
    scene();
    await expect(prepare()).resolves.toMatchObject({ booking_id: 'VB-B', replacement_reason: 'Schedule clash with Forum.' });
    expect(writeAt('events/EVT-1')[0].data).toEqual({ last_venue_replacement_id: 'auto-1', safety_review_required: true, updated_at: 'STAMP' });
    expect(writesTo('event_history/')[0].data.description).toBe('VB-B needs a replacement: Schedule clash with Forum.');
    // An unnamed other event reads as "another event"; my side may be booking A.
    mockWrites.length = 0;
    await prepareClashReplacement({ user: coordinator, bookingId: 'VB-B', clash: { conflict_id: 'c', booking_a_id: 'VB-B', booking_b_id: 'VB-A' } });
    expect(writeAt('venue_bookings/VB-B')[0].data.replacement_reason).toBe('Schedule clash with another event.');
  });
});

// ---- F10 — the Venue Staff queue ------------------------------------------------

describe('F10 / SCRUM-175 functional — the Venue Staff queue lists live clashes', () => {
  const approved = (fields) => ({ venue_id: 'VEN-1', status: 'APPROVED', event_id: 'E', ...fields });

  test('TC-1025 [normal] an active stored clash keeps its audit record; a resolved one, or one on a lower-case status, is not shown', async () => {
    staffScene();
    put('venue_bookings/VB-1', approved({ booking_label: 'Forum', occupied_start: '2099-06-10T09:00:00Z', occupied_end: '2099-06-10T11:00:00Z', start_datetime: '2099-06-10T09:30:00Z' }));
    put('venue_bookings/VB-2', approved({ occupied_start: '2099-06-10T10:00:00Z', occupied_end: '2099-06-10T12:00:00Z' }));
    put('venue_booking_conflicts/VEN-1--VB-1--VB-2', { venue_id: 'VEN-1', status: 'ACTIVE', booking_a_id: 'VB-1', booking_b_id: 'VB-2', detected_at: 'T0', overlap_start: '2099-06-10T10:00:00Z' });
    put('venue_booking_conflicts/VEN-1--VB-X--VB-Y', { venue_id: 'VEN-1', status: 'ACTIVE', booking_a_id: 'VB-X', booking_b_id: 'VB-Y' });

    const rows = await loadVenueBookingQueue({ user: staff });

    expect(rows.map((row) => [row.booking_id, row.event_name, row.event_date, row.venue_name])).toEqual([
      ['VB-1', 'Forum', '2099-06-10', 'Harbour Hall'], ['VB-2', 'E', null, 'Harbour Hall']
    ]);
    expect(rows[0].clashes).toEqual([expect.objectContaining({ conflict_id: 'VEN-1--VB-1--VB-2', detected_at: 'T0', overlap_start: '2099-06-10T10:00:00Z' })]);

    put('venue_booking_conflicts/VEN-1--VB-1--VB-2', { venue_id: 'VEN-1', status: 'RESOLVED', booking_a_id: 'VB-1', booking_b_id: 'VB-2' });
    put('venue_bookings/VB-2', approved({ status: 'approved', occupied_start: '2099-06-10T10:00:00Z', occupied_end: '2099-06-10T12:00:00Z' }));
    const after = await loadVenueBookingQueue({ user: staff });
    expect(after.every((row) => row.clashes.length === 0)).toBe(true);
  });

  test('TC-1026 [failure] a stored-clash read that fails for any reason other than permission fails the queue; no user is refused', async () => {
    staffScene();
    mockFailures.set('venue_booking_conflicts', Object.assign(new Error('unavailable'), { code: 'unavailable' }));
    await expect(loadVenueBookingQueue({ user: staff })).rejects.toThrow('unavailable');
    await expect(loadVenueBookingQueue({ user: null })).rejects.toThrow('Sign in is required.');
  });
});

// ---- F4 / F6 / F9 / F15 — Venue Staff decisions ----------------------------------

describe('F4 / SCRUM-128 functional — approval and hold refusals', () => {
  const pending = (fields = {}) => ({
    event_id: 'EVT-1', venue_id: 'VEN-1', status: 'PENDING', booking_label: 'Main',
    start_datetime: '2099-11-20T02:00:00.000Z', end_datetime: '2099-11-20T04:00:00.000Z', submitted_at: '2099-10-14T00:00:00.000Z', ...fields
  });
  const scene = (fields) => { staffScene(); put('venue_bookings/VB-1', pending(fields)); };
  const approve = (fields = {}) => approveVenueBooking({ user: staff, bookingId: 'VB-1', now: new Date('2099-10-20T00:00:00Z'), ...fields });

  test('TC-0928 [failure] a decision needs a booking that exists, at a venue the staff member owns', async () => {
    await expect(approve({ bookingId: '' })).rejects.toThrow('That booking could not be identified.');
    await expect(approve()).rejects.toThrow('Booking request not found.');
    scene();
    await expect(approve({ user: { uid: 'STAFF-2' } })).rejects.toThrow('You are not assigned to manage this venue.');
    await expect(holdVenueBooking({ user: null, bookingId: 'VB-1' })).rejects.toThrow('Sign in is required.');
  });

  test('TC-0929 [failure] inside the transaction a missing venue or an unreadable window is refused', async () => {
    scene({ end_datetime: '2099-11-20T02:00:00.000Z' });
    await expect(approve()).rejects.toThrow('The booking has an invalid date and time window.');
    scene({ start_datetime: 'not a date' });
    await expect(approve()).rejects.toThrow('The booking has an invalid date and time window.');
    scene();
    mockStore.delete('venues/VEN-1');
    await expect(approve()).rejects.toThrow('Venue not found.');
    // Withdrawn, or reassigned, between the first read and the transaction.
    scene();
    mockBeforeTransaction.current = () => mockStore.delete('venue_bookings/VB-1');
    await expect(approve()).rejects.toThrow('Booking request not found.');
    scene();
    mockBeforeTransaction.current = () => put('venue_staff/VEN-1', { venue_id: 'VEN-1', user_id: 'STAFF-2' });
    await expect(approve()).rejects.toThrow('You are not assigned to manage this venue.');
    expect(mockWrites).toEqual([]);
  });

  test.each(['APPROVED', 'REJECTED', 'WITHDRAWN', 'RELEASED'])(
    'TC-0930 [conflict] a %s booking cannot be approved again: a decision, rejection included, is not overridden',
    async (status) => {
      scene({ status });
      await expect(approve()).rejects.toThrow('Only Pending booking requests can be approved.');
      expect(mockWrites).toEqual([]);
    }
  );

  test('TC-0954 [conflict] a block over the occupied window refuses approval, with or without a stated reason (F6 AC4)', async () => {
    scene();
    put('venue_unavailability/u-1', { venue_id: 'VEN-1', start_datetime: '2099-11-20T04:00:00.000Z', end_datetime: '2099-11-20T05:00:00.000Z' });
    // The block starts at the event's end but inside its 15-minute turnaround.
    await expect(approve()).rejects.toThrow('The venue is unavailable during this period.');
    put('venue_unavailability/u-1', { venue_id: 'VEN-1', reason: 'Leak', start_datetime: '2099-11-20T04:00:00.000Z', end_datetime: '2099-11-20T05:00:00.000Z' });
    await expect(approve()).rejects.toThrow('The venue is unavailable during this period: Leak');
  });

  test('TC-0985 [boundary] approved occupied windows that only touch do not clash; one minute more does (F9 AC3, F6 AC2)', async () => {
    scene();
    // 30 minutes setup before 05:00 is 04:30; the approved booking ends 04:15 + 15 turnaround = 04:30.
    put('venue_bookings/VB-0', pending({ status: 'APPROVED', start_datetime: '2099-11-20T00:00:00.000Z', end_datetime: '2099-11-20T04:15:00.000Z' }));
    put('venue_bookings/VB-1', pending({ start_datetime: '2099-11-20T05:00:00.000Z', end_datetime: '2099-11-20T06:00:00.000Z' }));
    await expect(approve()).resolves.toEqual({ booking_id: 'VB-1', status: 'APPROVED' });
    put('venue_bookings/VB-1', pending({ start_datetime: '2099-11-20T04:59:00.000Z', end_datetime: '2099-11-20T06:00:00.000Z' }));
    put('venue_bookings/VB-0', pending({ status: 'APPROVED', booking_label: undefined, start_datetime: '2099-11-20T00:00:00.000Z', end_datetime: '2099-11-20T04:15:00.000Z' }));
    await expect(approve()).rejects.toThrow('This period clashes with approved booking VB-0.');
  });

  test('TC-0931 [conflict] first come, first served: an earlier overlapping request, even one with no submission time, is decided first', async () => {
    scene();
    put('venue_bookings/VB-0', pending({ submitted_at: undefined }));
    await expect(approve()).rejects.toThrow('An earlier submitted request for this venue and time must be decided first.');
    // A competing request with no readable window, or submitted later, does not hold it up.
    put('venue_bookings/VB-0', pending({ start_datetime: undefined }));
    put('venue_bookings/VB-2', pending({ submitted_at: '2099-10-15T00:00:00.000Z' }));
    await expect(approve()).resolves.toMatchObject({ status: 'APPROVED' });
  });

  test("TC-0932 [conflict] another event's active hold keeps the venue; the message names the hold's id when it has no label", async () => {
    scene({ submitted_at: undefined });
    put('venue_bookings/VB-H', pending({ status: 'HELD', booking_label: undefined, hold_expires_at: '2099-10-22T02:00:00.000Z' }));
    await expect(approve()).rejects.toThrow('This period is held for VB-H until Thu 22 Oct 2099, 10:00.');
  });

  test('TC-1046 [boundary] approving a replacement with no recorded reason or labels retires the original with plain wording (F11 AC5)', async () => {
    staffScene();
    put('venue_bookings/VB-1', pending({ booking_label: undefined, requested_by: undefined, replacement_for_booking_id: 'VB-OLD', replacement_original_venue_id: 'VEN-0' }));
    put('venue_bookings/VB-OLD', { event_id: 'EVT-1', venue_id: 'VEN-0', status: 'APPROVED', replacement_needed: true });
    await approve();
    expect(writeAt('venue_bookings/VB-OLD')[0].data).toMatchObject({ status: 'REPLACED', replaced_by_booking_id: 'VB-1', release_reason: 'Replacement venue approved' });
    expect(writesTo('event_history/').map((item) => item.data.description)).toEqual(['VB-OLD replaced by VB-1.', 'Venue booking VB-1 approved.']);
    expect(writesTo('notifications/')).toEqual([]);
  });

  test("TC-1121 [boundary] a hold placed on today's clock records its id when the booking has no label (F15 AC1)", async () => {
    scene({ booking_label: undefined, requested_by: undefined, start_datetime: '2999-11-20T02:00:00.000Z', end_datetime: '2999-11-20T04:00:00.000Z' });
    const result = await holdVenueBooking({ user: staff, bookingId: 'VB-1' });
    expect(result.status).toBe('HELD');
    expect(new Date(result.hold_expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(writesTo('event_history/')[0].data.description).toMatch(/^Venue booking VB-1 held until /);
  });
});

// ---- F5 — rejection ------------------------------------------------------------

describe('F5 / SCRUM-129 functional — rejecting a booking request', () => {
  const pending = { event_id: 'EVT-1', venue_id: 'VEN-1', status: 'PENDING', event_name: 'Summit', requested_by: 'COORD-1' };

  test('TC-0944 [normal] the Firestore path marks a pending or held request rejected, needing a re-request, and tells the raiser', async () => {
    staffScene();
    put('venue_bookings/VB-1', pending);
    await expect(rejectVenueBookingInFirestore({ user: staff, bookingId: 'VB-1', reason: '  No fit  ' })).resolves.toEqual({ booking_id: 'VB-1', status: 'REJECTED' });
    expect(writeAt('venue_bookings/VB-1')[0].data).toMatchObject({ status: 'REJECTED', decision_reason: 'No fit', decided_by: 'STAFF-1', requires_re_request: true });
    expect(writesTo('event_history/')[0].data).toMatchObject({ action_type: 'VENUE_BOOKING_REJECTED', old_value: 'PENDING', description: 'No fit' });
    expect(writesTo('notifications/')[0].data).toMatchObject({ user_id: 'COORD-1', type: 'VENUE_BOOKING_REJECTED', booking_id: 'VB-1' });
    expect(writesTo('notifications/')[0].data.message).toContain('Harbour Hall');

    // A held request can be rejected too; a venue with no record is named by its id.
    mockWrites.length = 0;
    put('venue_bookings/VB-1', { ...pending, status: 'HELD' });
    mockStore.delete('venues/VEN-1');
    await rejectVenueBookingInFirestore({ user: staff, bookingId: 'VB-1', reason: 'Lapsed' });
    expect(writesTo('event_history/')[0].data.old_value).toBe('HELD');
    expect(writesTo('notifications/')[0].data.message).toContain('VEN-1');
    // Nobody recorded as raising it: nobody is told.
    mockWrites.length = 0;
    put('venue_bookings/VB-1', { ...pending, requested_by: undefined });
    await rejectVenueBookingInFirestore({ user: staff, bookingId: 'VB-1', reason: 'No fit' });
    expect(writesTo('notifications/')).toEqual([]);
  });

  test('TC-0945 [conflict] a request withdrawn or reassigned between the check and the rejection is refused', async () => {
    staffScene();
    put('venue_bookings/VB-1', pending);
    mockBeforeTransaction.current = () => mockStore.delete('venue_bookings/VB-1');
    await expect(rejectVenueBookingInFirestore({ user: staff, bookingId: 'VB-1', reason: 'No fit' })).rejects.toThrow('Booking request not found.');
    put('venue_bookings/VB-1', pending);
    mockBeforeTransaction.current = () => put('venue_staff/VEN-1', { venue_id: 'VEN-1', user_id: 'STAFF-2' });
    await expect(rejectVenueBookingInFirestore({ user: staff, bookingId: 'VB-1', reason: 'No fit' })).rejects.toThrow('You are not assigned to manage this venue.');
    expect(mockWrites).toEqual([]);
  });

  test('TC-0946 [conflict] an approved booking cannot be rejected after the fact, nor by staff who do not own the venue', async () => {
    staffScene();
    put('venue_bookings/VB-1', { ...pending, status: 'APPROVED' });
    await expect(rejectVenueBookingInFirestore({ user: staff, bookingId: 'VB-1', reason: 'Late' })).rejects.toThrow('Only a pending or held booking request can be rejected.');
    await expect(rejectVenueBookingInFirestore({ user: { uid: 'STAFF-2' }, bookingId: 'VB-1', reason: 'Late' })).rejects.toThrow('You are not assigned to manage this venue.');
    await expect(rejectVenueBookingInFirestore({ user: staff, bookingId: 'VB-1', reason: '   ' })).rejects.toThrow('A rejection reason is required.');
    await expect(rejectVenueBookingInFirestore({ user: staff, bookingId: 'VB-1' })).rejects.toThrow('A rejection reason is required.');
    expect(mockWrites).toEqual([]);
  });

  test("TC-0947 [failure] the service path needs a text reason and a token, and passes on the service's refusal", async () => {
    const user = { getIdToken: async () => 'tok' };
    await expect(rejectVenueBooking({ user, bookingId: 'VB-1', reason: 42 })).rejects.toThrow('A rejection reason is required.');
    await expect(rejectVenueBooking({ user: {}, bookingId: 'VB-1', reason: 'No fit' })).rejects.toThrow('Sign in is required to reject a venue booking.');
    expect(global.fetch).not.toHaveBeenCalled();
    global.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Only a pending or held booking request can be rejected.' }) });
    await expect(rejectVenueBooking({ user, bookingId: 'VB-1', reason: 'No fit' })).rejects.toThrow('Only a pending or held booking request can be rejected.');
    global.fetch.mockResolvedValueOnce({ ok: false, json: async () => { throw new Error('html'); } });
    await expect(rejectVenueBooking({ user, bookingId: 'VB 1', reason: 'No fit' })).rejects.toThrow('The booking could not be rejected.');
    expect(global.fetch).toHaveBeenLastCalledWith('/api/venues/bookings/VB%201/reject', expect.anything());
  });
});

// ---- F8 / D4 — releasing on cancellation --------------------------------------------

describe('F8 / SCRUM-132 functional — a cancelled event releases its venues', () => {
  test.each([
    ['no user', { user: null }, null, 'Sign in is required.'],
    ['no event', { eventId: '' }, null, 'That event could not be identified.'],
    ['an event that does not exist', {}, undefined, 'Event not found.'],
    ["another coordinator's event", {}, { coordinator_id: 'COORD-2', status: 'CANCELLED' }, 'Only the current event coordinator may release its venue bookings.'],
    ['an event that is not Cancelled', {}, { coordinator_id: 'COORD-1', status: 'PLANNING' }, 'Venue bookings can be released automatically only after the event is Cancelled.']
  ])('TC-0972 [failure] release is refused for %s', async (_label, fields, event, message) => {
    if (event) put('events/EVT-1', event);
    await expect(releaseCancelledEventBookings({ user: coordinator, eventId: 'EVT-1', ...fields })).rejects.toThrow(message);
    expect(mockWrites).toEqual([]);
  });

  test('TC-0973 [boundary] holds are withdrawn, decided bookings are left as they are, and an unlinked approval leaves the event alone', async () => {
    put('events/EVT-1', { coordinator_id: 'COORD-1', status: 'cancelled', approved_venue_booking_id: 'VB-ELSEWHERE' });
    put('venue_bookings/VB-A', { event_id: 'EVT-1', status: 'APPROVED' });
    put('venue_bookings/VB-H', { event_id: 'EVT-1', status: 'HELD', booking_label: 'Hold' });
    put('venue_bookings/VB-R', { event_id: 'EVT-1', status: 'REJECTED' });
    put('venue_bookings/VB-X', { event_id: 'EVT-1', status: 'RELEASED' });
    await expect(releaseCancelledEventBookings({ user: coordinator, eventId: 'EVT-1', reason: 'Client withdrew' }))
      .resolves.toEqual([{ booking_id: 'VB-A', status: 'RELEASED' }, { booking_id: 'VB-H', status: 'WITHDRAWN' }]);
    expect(writesTo('event_history/').map((item) => item.data.description)).toEqual(['VB-A: Client withdrew', 'Hold: Client withdrew']);
    expect(writeAt('events/EVT-1')).toEqual([]);
  });
});

// ---- F14 — releasing one venue -----------------------------------------------------

describe('F14 / SCRUM-179 functional — releasing one venue', () => {
  const approved = { event_id: 'EVT-1', venue_id: 'VEN-1', status: 'APPROVED' };
  const release = (fields = {}) => releaseVenueBooking({ user: coordinator, bookingId: 'VB-1', reason: 'Not needed', ...fields });

  test.each([
    ['no user', { user: null }, 'Sign in is required.'],
    ['no reason', { reason: undefined }, 'A release reason is required.'],
    ['no booking', { bookingId: '' }, 'That booking could not be identified.']
  ])('TC-1087 [failure] release is refused with %s', async (_label, fields, message) => {
    await expect(release(fields)).rejects.toThrow(message);
  });

  test('TC-1088 [failure] a booking or event that does not exist, a booking not approved, or someone else is refused', async () => {
    await expect(release()).rejects.toThrow('That booking could not be found.');
    put('venue_bookings/VB-1', approved);
    await expect(release()).rejects.toThrow('Event not found.');
    put('events/EVT-1', { coordinator_id: 'COORD-2', status: 'PLANNING' });
    await expect(release()).rejects.toThrow('Only the current event coordinator may release this venue.');
    put('events/EVT-1', { coordinator_id: 'COORD-1' });
    await expect(release()).rejects.toThrow("This event's venue can no longer be released.");
    put('venue_bookings/VB-1', { ...approved, status: 'PENDING' });
    await expect(release()).rejects.toThrow('Only an approved venue booking can be released.');
    expect(mockWrites).toEqual([]);
  });

  test('TC-1089 [normal] from Confirmed the event returns to Planning; a link to another booking is kept (F14 AC1, AC5)', async () => {
    put('events/EVT-1', { coordinator_id: 'COORD-1', status: 'CONFIRMED', approved_venue_booking_id: 'VB-2', last_safety_review_id: 'SR-1' });
    put('venue_bookings/VB-1', approved);
    put('venue_bookings/VB-2', { ...approved, venue_id: 'VEN-2' });
    await release();
    expect(writeAt('events/EVT-1')[0].data).toMatchObject({ approved_venue_booking_id: 'VB-2', status: 'PLANNING', last_safety_review_id: null, safety_review_required: true });
    expect(writeAt('venue_bookings/VB-2')).toEqual([]);
    expect(writesTo('event_history/')[0].data.description).toBe('VB-1: Not needed');
  });

  test('TC-1090 [boundary] with no link the event points at a remaining approved venue, or at none when this was the last', async () => {
    put('events/EVT-1', { coordinator_id: 'COORD-1', status: 'APPROVED' });
    put('venue_bookings/VB-1', approved);
    put('venue_bookings/VB-2', { ...approved, status: 'PENDING' });
    await release();
    expect(writeAt('events/EVT-1')[0].data).toEqual({ approved_venue_booking_id: null, last_venue_release_id: 'auto-1', updated_at: 'STAMP' });
    mockWrites.length = 0;
    put('venue_bookings/VB-1', approved);
    put('venue_bookings/VB-3', { ...approved, venue_id: 'VEN-3' });
    await release();
    expect(writeAt('events/EVT-1')[0].data.approved_venue_booking_id).toBe('VB-3');
  });
});

// ---- K5 / F1 AC4 — withdrawing --------------------------------------------------------

describe('F1 AC4 / K5 functional — withdrawing a request', () => {
  test('TC-0899 [failure] withdrawing needs a booking id, and an event that still exists', async () => {
    await expect(withdrawVenueBooking({ user: coordinator, bookingId: '' })).rejects.toThrow('That booking could not be identified.');
    put('venue_bookings/VB-1', { event_id: 'EVT-GONE', status: 'PENDING' });
    await expect(withdrawVenueBooking({ user: coordinator, bookingId: 'VB-1' })).rejects.toThrow('Only the current event coordinator may withdraw this booking.');
    expect(mockWrites).toEqual([]);
  });
});
