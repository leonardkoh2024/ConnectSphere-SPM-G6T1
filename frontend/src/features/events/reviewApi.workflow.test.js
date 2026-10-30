// The review adapter's remaining paths: the list and detail loaders for every role,
// the impact reads (D2, I2), the workflow writes the coordinator, the organiser and
// the Lead make (C4 open review / clarify, C5 respond, C7 reject, D4 cancel, K1 cancel
// while unassigned, K2 assign, K3 reassign), the I2 change-request acceptance inside an
// edit save, and the backend calls (complete, I3 service errors).
//
// One in-memory store backs every read: getDoc/getDocs/transaction reads come from
// `stored`, and transaction writes are recorded in `writes`, so each test asserts on
// what the adapter would persist rather than on its own mocks.
import { reviewApi } from './reviewApi';
import * as firestore from 'firebase/firestore';
import { auth } from '../../lib/firebase';
import { ordinaryEventValues } from '../../domain/ordinaryEventChanges';
import { significantEventValues } from '../../domain/significantEventChanges';

jest.mock('../../lib/firebase', () => ({ auth: { currentUser: { uid: 'c1' } }, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn(), query: jest.fn(), where: jest.fn(),
  getDoc: jest.fn(), getDocs: jest.fn(), runTransaction: jest.fn(), serverTimestamp: jest.fn(),
  writeBatch: jest.fn()
}));

const NOT_AUTHORISED = 'You are not authorised to view this event.';
const permissionDenied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
const snapshot = (path, data) => {
  const id = path.split('/')[1];
  return { id, ref: { path, id }, exists: () => Boolean(data), data: () => data };
};
const ts = (iso) => ({ toDate: () => new Date(iso) });

let stored;
let denied;
let writes;
let autoId;

const entries = (name) => Object.entries(stored).filter(([path]) => path.startsWith(`${name}/`));
const matches = (data, constraints = []) => constraints.every(({ field, value }) => data[field] === value);
const setsAt = (prefix) => writes.sets.filter(([path]) => path.startsWith(prefix)).map(([, data]) => data);
const updatesAt = (prefix) => writes.updates.filter(([path]) => path.startsWith(prefix)).map(([, data]) => data);
const nothingWritten = () => {
  expect(writes.updates).toEqual([]);
  expect(writes.sets).toEqual([]);
  expect(writes.deletes).toEqual([]);
};

beforeEach(() => {
  auth.currentUser = { uid: 'c1', getIdToken: async () => 'id-token' };
  stored = {};
  denied = new Set();
  writes = { updates: [], sets: [], deletes: [] };
  autoId = 0;
  firestore.collection.mockImplementation((db, name) => ({ name }));
  firestore.doc.mockImplementation((first, name, id) => {
    if (name) return { path: `${name}/${id}`, id };
    autoId += 1;
    return { path: `${first.name}/auto${autoId}`, id: `auto${autoId}` };
  });
  firestore.query.mockImplementation((source, ...constraints) => ({ name: source.name, constraints }));
  firestore.where.mockImplementation((field, op, value) => ({ field, value }));
  firestore.serverTimestamp.mockReturnValue('TS');
  firestore.getDoc.mockImplementation(async (ref) => {
    if (denied.has(ref.path)) throw permissionDenied();
    return snapshot(ref.path, stored[ref.path]);
  });
  firestore.getDocs.mockImplementation(async (q) => {
    if (denied.has(q.name)) throw permissionDenied();
    const found = entries(q.name).filter(([, data]) => matches(data, q.constraints)).map(([path, data]) => snapshot(path, data));
    return { docs: found, size: found.length };
  });
  firestore.runTransaction.mockImplementation(async (db, work) => work({
    get: async (ref) => snapshot(ref.path, stored[ref.path]),
    update: (ref, data) => writes.updates.push([ref.path, data]),
    set: (ref, data) => writes.sets.push([ref.path, data]),
    delete: (ref) => writes.deletes.push(ref.path)
  }));
});

const coordinator = { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true };
const organiserProfile = { role: 'EVENT_ORGANISER', name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: '+65 9000 0000' };

describe('C2 / K5 / F11 the event list for each role', () => {
  beforeEach(() => {
    stored['users/c1'] = coordinator;
    stored['users/org1'] = organiserProfile;
  });

  describe('normal', () => {
    test('TC-0331 C2 an organiser lists only their own events, none of them editable by the organiser', async () => {
      auth.currentUser = { uid: 'org1' };
      stored['events/e1'] = { organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', status: 'PLANNING', created_at: ts('2026-10-01T00:00:00.000Z') };
      stored['events/e2'] = { organiser_id: 'org2', coordinator_id: 'c1', name: 'Other Gala', status: 'PLANNING' };

      const { events } = await reviewApi.list();

      expect(events).toEqual([expect.objectContaining({
        id: 'e1', editable: false, organiser_name: 'Nadia Organiser', created_at: '2026-10-01T00:00:00.000Z'
      })]);
      // An organiser never triggers the coordinator-only venue_bookings read.
      expect(firestore.getDocs.mock.calls.some(([q]) => q.name === 'venue_bookings')).toBe(false);
    });

    test('TC-1040 F11 AC1 a coordinator\'s event with a booking needing replacement is flagged, the other is not', async () => {
      stored['events/e1'] = { organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', status: 'PLANNING' };
      stored['events/e2'] = { organiser_id: 'org1', coordinator_id: 'c1', name: 'Workshop', status: 'PLANNING' };
      stored['venue_bookings/b1'] = { event_id: 'e1', replacement_needed: true };
      stored['venue_bookings/b2'] = { event_id: 'e2', replacement_needed: false };

      const { events } = await reviewApi.list();

      expect(events.map((item) => [item.id, item.replacement_needed, item.editable])).toEqual([['e1', true, true], ['e2', false, true]]);
    });
  });

  describe('boundary', () => {
    test('TC-0332 C2 AC2 the organiser column falls back to the email, keeps a stored name, and is null without a profile', async () => {
      stored['users/org1'] = { role: 'EVENT_ORGANISER', email: 'nadia@smu.edu.sg' };
      stored['events/e1'] = { organiser_id: 'org1', coordinator_id: 'c1', status: 'PLANNING' };
      stored['events/e2'] = { organiser_id: 'gone', coordinator_id: 'c1', status: 'PLANNING' };
      stored['events/e3'] = { organiser_id: 'org1', organiser_name: 'Named On Event', coordinator_id: 'c1', status: 'PLANNING' };
      stored['events/e4'] = { coordinator_id: 'c1', status: 'PLANNING' };

      const { events } = await reviewApi.list();

      expect(Object.fromEntries(events.map((item) => [item.id, item.organiser_name]))).toEqual({
        e1: 'nadia@smu.edu.sg', e2: null, e3: 'Named On Event', e4: null
      });
    });

    test('TC-0333 C2 a coordinator with no assigned events gets an empty list', async () => {
      await expect(reviewApi.list()).resolves.toEqual({ events: [] });
    });

    test('TC-0334 C2 an organiser profile with neither name nor email falls back to its id', async () => {
      stored['users/org1'] = { role: 'EVENT_ORGANISER' };
      stored['events/e1'] = { organiser_id: 'org1', coordinator_id: 'c1', status: 'PLANNING' };

      const { events } = await reviewApi.list();

      expect(events[0].organiser_name).toBe('org1');
    });
  });

  describe('conflict', () => {
    test('TC-0064 A4 a role that does not review events (Venue Staff) is refused the list', async () => {
      stored['users/c1'] = { role: 'VENUE_STAFF', name: 'Vera' };

      await expect(reviewApi.list()).rejects.toThrow('This role cannot review event requests.');
    });
  });

  describe('failure', () => {
    test('TC-0335 a signed-out caller is asked to sign in again', async () => {
      auth.currentUser = null;

      await expect(reviewApi.list()).rejects.toThrow('Please sign in again.');
    });

    test('TC-0336 a missing profile is reported with the step that failed', async () => {
      delete stored['users/c1'];

      await expect(reviewApi.list()).rejects.toThrow('your profile: Your user profile could not be found.');
    });
  });
});

describe('C3 / F7 / F12 the event detail', () => {
  beforeEach(() => {
    stored['users/c1'] = coordinator;
    stored['users/org1'] = organiserProfile;
    stored['events/e1'] = { organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', status: 'PLANNING' };
  });

  describe('normal', () => {
    test('TC-0353 C3 AC1 AC2 the coordinator sees venue needs, equipment lines and the organiser\'s contact', async () => {
      stored['event_venue_requirements/e1'] = {
        preferred_location: 'Level 3', required_layout: 'THEATRE', facilities_required: true, accessibility_needed: true, accessibility_notes: 'Ramp'
      };
      stored['event_facilities/f1'] = { event_id: 'e1', facility_id: 'PROJECTOR' };
      stored['event_facilities/f2'] = { event_id: 'e1' };
      stored['event_accessibility/a1'] = { event_id: 'e1', accessibility_id: 'WHEELCHAIR' };
      stored['event_equipment/q1'] = { event_id: 'e1', equipment_type: 'MIC', quantity: 4, technical_note: 'Wireless' };
      stored['event_equipment/q2'] = { event_id: 'e1', equipment_type: 'SCREEN', notes: 'Large' };
      stored['event_equipment/q3'] = { event_id: 'e1', equipment_type: 'PODIUM' };

      const detail = await reviewApi.detail('e1');

      expect(detail.event).toMatchObject({
        preferred_location: 'Level 3', required_layout: 'THEATRE', facilities_required: true, accessibility_needed: true,
        accessibility_notes: 'Ramp', facilities: ['PROJECTOR'], accessibility: ['WHEELCHAIR'], editable: true
      });
      expect(detail.event.equipment).toEqual([
        { equipment_type: 'MIC', quantity: 4, notes: 'Wireless' },
        { equipment_type: 'SCREEN', quantity: 1, notes: 'Large' },
        { equipment_type: 'PODIUM', quantity: 1, notes: null }
      ]);
      expect(detail.organiser).toEqual({ id: 'org1', name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: '+65 9000 0000' });
      expect(detail.coordinator).toEqual({ id: 'c1', name: 'Joshua Chua', active: true });
      expect(detail.coordinators).toEqual([{ id: 'c1', name: 'Joshua Chua', active: true }]);
    });

    test('TC-0957 F7 / F12 AC5 every booking comes back named by its venue, in start order, with its decision fields', async () => {
      stored['venues/v1'] = { name: 'Hall A' };
      stored['venue_bookings/b1'] = {
        event_id: 'e1', venue_id: 'v1', booking_id: 'BK-1', booking_label: 'Main hall', expected_attendance: 80,
        layout_snapshot: 'THEATRE', start_datetime: ts('2026-11-04T03:00:00.000Z'), end_datetime: ts('2026-11-04T05:00:00.000Z'),
        status: 'Approved', decision_reason: 'Fits', decided_at: ts('2026-10-02T00:00:00.000Z'), released_at: null,
        replacement_needed: true, replacement_reason: 'Venue closed', replaced_by_booking_id: 'BK-3', required_facilities_snapshot: ['PROJECTOR']
      };
      stored['venue_bookings/b2'] = { event_id: 'e1', venue_id: 'v2', venue_name: 'Breakout Room', start_datetime: '2026-11-04T01:00:00.000Z', release_reason: 'Not needed', released_at: '2026-10-03T00:00:00.000Z' };
      stored['venue_bookings/b3'] = { event_id: 'e1', venue_id: 'v9' };

      const { venueBookings } = await reviewApi.detail('e1');

      expect(venueBookings.map((item) => [item.booking_id, item.venue_name])).toEqual([['b3', 'v9'], ['b2', 'Breakout Room'], ['BK-1', 'Hall A']]);
      expect(venueBookings[2]).toEqual({
        booking_id: 'BK-1', booking_label: 'Main hall', expected_attendance: 80, layout: 'THEATRE', venue_id: 'v1', venue_name: 'Hall A',
        start_datetime: '2026-11-04T03:00:00.000Z', end_datetime: '2026-11-04T05:00:00.000Z', status: 'Approved', decision_reason: 'Fits',
        decided_at: '2026-10-02T00:00:00.000Z', released_at: null, release_reason: null, replacement_needed: true,
        replacement_reason: 'Venue closed', replaced_by_booking_id: 'BK-3', required_facilities_snapshot: ['PROJECTOR']
      });
      expect(venueBookings[0]).toMatchObject({ status: 'Status not recorded', booking_label: null, expected_attendance: null, layout: null, replacement_needed: false, required_facilities_snapshot: [] });
      expect(venueBookings[1]).toMatchObject({ release_reason: 'Not needed', released_at: '2026-10-03T00:00:00.000Z' });
    });

    test('TC-0418 C8 the latest decision, its reason and its maker are carried on the event; clarifications and responses come in time order', async () => {
      stored['event_history/h1'] = { event_id: 'e1', action_type: 'EVENT_REJECTED', actor_id: 'c1', new_value: 'REJECTED', description: 'Too late', created_at: '2026-10-01' };
      stored['event_history/h2'] = { event_id: 'e1', action_type: 'EVENT_APPROVED', actor_id: 'c1', new_value: 'APPROVED', description: 'Fits', created_at: '2026-10-03' };
      stored['event_history/h3'] = { event_id: 'e1', action_type: 'NOTE' };
      stored['clarification_requests/q2'] = { event_id: 'e1', message: 'Second', created_at: '2026-10-02' };
      stored['clarification_requests/q1'] = { event_id: 'e1', message: 'First', created_at: '2026-10-01' };
      stored['clarification_responses/r1'] = { clarification_id: 'q1', message: 'Answer', created_at: '2026-10-01T05' };
      stored['coordinator_assignments/e1_c1'] = { event_id: 'e1', coordinator_id: 'c1', assigned_at: ts('2026-09-30T00:00:00.000Z') };

      const detail = await reviewApi.detail('e1');

      expect(detail.event).toMatchObject({ decision: 'APPROVED', decision_reason: 'Fits', decided_by: 'c1', decided_at: '2026-10-03' });
      expect(detail.history.map((item) => item.id)).toEqual(['h3', 'h1', 'h2']);
      expect(detail.clarifications.map((item) => item.message)).toEqual(['First', 'Second']);
      expect(detail.responses.map((item) => item.message)).toEqual(['Answer']);
      expect(detail.assignments).toEqual([expect.objectContaining({ coordinator_id: 'c1', assigned_at: '2026-09-30T00:00:00.000Z' })]);
    });

    test('TC-0354 C3 an organiser opening their own event reads no internal-only collections and gets no coordinator list', async () => {
      auth.currentUser = { uid: 'org1' };

      const detail = await reviewApi.detail('e1');

      expect(detail.venueBookings).toEqual([]);
      expect(detail.coordinators).toEqual([]);
      expect(detail.equipmentArrangements).toBeNull();
      expect(detail.event.editable).toBe(false);
      const read = firestore.getDocs.mock.calls.map(([q]) => q.name);
      expect(read).not.toEqual(expect.arrayContaining(['venue_bookings']));
      expect(read).not.toEqual(expect.arrayContaining(['equipment_reservations']));
    });
  });

  describe('boundary', () => {
    test('TC-0355 an event with no requirement record, no coordinator, no organiser and no history shows empty values, not errors', async () => {
      auth.currentUser = { uid: 'org1' };
      stored['events/e1'] = { status: 'SUBMITTED', organiser_id: null, coordinator_id: null };
      // An organiser reading their own record still needs a profile.
      const detail = await reviewApi.detail('e1');

      expect(detail.event).toMatchObject({
        preferred_location: null, required_layout: null, facilities_required: null, accessibility_needed: null,
        accessibility_notes: '', facilities: [], accessibility: [], equipment: [], decision: null, decision_reason: null, decided_by: null, decided_at: null
      });
      expect(detail.coordinator).toBeNull();
      expect(detail.organiser).toBeNull();
      expect(detail.actorNames).toEqual({});
    });

    test('TC-0356 a coordinator whose profile is gone shows by id and inactive; one with only an email shows the email', async () => {
      auth.currentUser = { uid: 'org1' };
      stored['events/e1'] = { organiser_id: 'org1', coordinator_id: 'gone', status: 'PLANNING' };
      expect((await reviewApi.detail('e1')).coordinator).toEqual({ id: 'gone', name: 'gone', active: false });

      stored['events/e1'] = { organiser_id: 'org1', coordinator_id: 'c9', status: 'PLANNING' };
      stored['users/c9'] = { role: 'EVENT_COORDINATOR', email: 'c9@cs.sg', is_active: false };
      expect((await reviewApi.detail('e1')).coordinator).toEqual({ id: 'c9', name: 'c9@cs.sg', active: false });

      stored['users/c9'] = { role: 'EVENT_COORDINATOR' };
      expect((await reviewApi.detail('e1')).coordinator).toEqual({ id: 'c9', name: 'c9', active: true });
    });

    test('TC-0357 C3 AC2 the organiser\'s phone falls back to contact_number, and missing name and email are null', async () => {
      stored['users/org1'] = { contact_number: '6123 4567' };

      const { organiser } = await reviewApi.detail('e1');

      expect(organiser).toEqual({ id: 'org1', name: null, email: null, phone: '6123 4567' });
    });

    // A readable profile with no name field is NOT tested here: reviewApi.js:202 applies
    // .filter to the [id, name] pair instead of to the entries, so a nameless profile
    // throws and the whole detail fails to load. Reported as a bug, not enshrined.
    test('TC-0444 D1 AC2 an actor whose profile is missing is left for the role fallback', async () => {
      stored['event_history/h2'] = { event_id: 'e1', action_type: 'NOTE', actor_id: 'ghost', created_at: '2' };

      const { actorNames } = await reviewApi.detail('e1');

      expect(actorNames).toEqual({});
    });

    test('TC-1306 G4 an equipment request with no lines and no reservations still loads', async () => {
      stored['equipment_requests/e1'] = { status: 'PENDING' };

      const { equipmentArrangements } = await reviewApi.detail('e1');

      expect(equipmentArrangements).toEqual(expect.objectContaining({ lines: [] }));
    });

    test('TC-1307 G4 a failed reservation or history read leaves those parts empty', async () => {
      stored['equipment_requests/e1'] = { status: 'PENDING', lines: [] };
      denied.add('equipment_reservations');
      denied.add('equipment_request_history');

      const detail = await reviewApi.detail('e1');

      expect(detail.equipmentArrangements).toEqual(expect.objectContaining({ lines: [] }));
      expect(detail.history).toEqual([]);
    });
  });

  describe('failure', () => {
    test('TC-2404 K5 AC3 an event that does not exist answers exactly like one the caller may not open', async () => {
      await expect(reviewApi.detail('missing')).rejects.toThrow(NOT_AUTHORISED);
    });

    test('TC-2405 K5 AC3 a refused event read answers the same way and reads nothing further', async () => {
      denied.add('events/e1');

      await expect(reviewApi.detail('e1')).rejects.toThrow(NOT_AUTHORISED);
      expect(firestore.getDocs).not.toHaveBeenCalled();
    });

    test('TC-0358 a signed-out caller is asked to sign in again', async () => {
      auth.currentUser = null;

      await expect(reviewApi.detail('e1')).rejects.toThrow('Please sign in again.');
    });
  });
});

describe('D2 / I2 the arrangements an event holds', () => {
  beforeEach(() => {
    stored['users/c1'] = coordinator;
    stored['events/e1'] = { organiser_id: 'org1', coordinator_id: 'c1', status: 'PLANNING' };
  });

  describe('normal', () => {
    test('TC-0476 D2 AC1 every booking and reservation is listed with a readable label and status, plus the registration count', async () => {
      stored['venues/v1'] = { name: 'Hall A' };
      stored['venue_bookings/b1'] = { event_id: 'e1', booking_label: 'Main hall', status: 'Approved' };
      stored['venue_bookings/b2'] = { event_id: 'e1', venue_name: 'Breakout Room', status: 'Pending' };
      stored['venue_bookings/b3'] = { event_id: 'e1', venue_id: 'v1' };
      stored['venue_bookings/b4'] = { event_id: 'e1', venue_id: 'v9', booking_id: 'BK-4' };
      stored['venue_bookings/b5'] = { event_id: 'e1' };
      stored['equipment_reservations/r1'] = { event_id: 'e1', equipment_name: 'Mic set', status: 'RESERVED' };
      stored['equipment_reservations/r2'] = { event_id: 'e1', equipment_type: 'SCREEN' };
      stored['equipment_reservations/r3'] = { event_id: 'e1', item_name: 'Podium' };
      stored['equipment_reservations/r4'] = { event_id: 'e1', reservation_id: 'RS-4' };
      stored['equipment_reservations/r5'] = { event_id: 'e1' };
      stored['registrations/g1'] = { event_id: 'e1', status: 'REGISTERED' };
      stored['registrations/g2'] = { event_id: 'e1', status: 'WAITLISTED' };

      const impact = await reviewApi.significantChangeImpact('e1');

      expect(impact).toEqual({
        venueBookings: [
          { id: 'b1', label: 'Main hall', status: 'Approved' },
          { id: 'b2', label: 'Breakout Room', status: 'Pending' },
          { id: 'b3', label: 'Hall A', status: 'Status not recorded' },
          { id: 'b4', label: 'Venue booking BK-4', status: 'Status not recorded' },
          { id: 'b5', label: 'Venue booking b5', status: 'Status not recorded' }
        ],
        equipmentReservations: [
          { id: 'r1', label: 'Mic set', status: 'RESERVED' },
          { id: 'r2', label: 'SCREEN', status: 'Status not recorded' },
          { id: 'r3', label: 'Podium', status: 'Status not recorded' },
          { id: 'r4', label: 'Equipment reservation RS-4', status: 'Status not recorded' },
          { id: 'r5', label: 'Equipment reservation r5', status: 'Status not recorded' }
        ],
        registrationsCount: 2
      });
    });
  });

  describe('boundary', () => {
    test('TC-0477 D2 an event holding nothing yet reports empty lists and zero registrations', async () => {
      await expect(reviewApi.arrangementImpact('e1')).resolves.toEqual({ venueBookings: [], equipmentReservations: [], registrationsCount: 0 });
    });
  });

  describe('conflict', () => {
    test.each([
      ['another coordinator\'s event', { organiser_id: 'org1', coordinator_id: 'c2', status: 'PLANNING' }],
      ['an event under review (not yet editable)', { organiser_id: 'org1', coordinator_id: 'c1', status: 'UNDER_REVIEW' }],
      ['a cancelled event', { organiser_id: 'org1', coordinator_id: 'c1', status: 'CANCELLED' }]
    ])('TC-0478 D2 the impact of %s is refused', async (label, event) => {
      stored['events/e1'] = event;

      await expect(reviewApi.significantChangeImpact('e1')).rejects.toThrow('Only the current coordinator may review the impact');
    });

    test('TC-0479 D2 a non-coordinator holding the id is refused', async () => {
      stored['users/c1'] = { role: 'EVENT_ORGANISER' };

      await expect(reviewApi.significantChangeImpact('e1')).rejects.toThrow('Only the current coordinator may review the impact');
    });
  });

  describe('failure', () => {
    test('TC-0480 D2 a missing event is refused', async () => {
      delete stored['events/e1'];

      await expect(reviewApi.significantChangeImpact('e1')).rejects.toThrow('Only the current coordinator may review the impact');
    });
  });
});

describe('D2 / I2 saving significant changes, venue needs and an accepted change request', () => {
  const organiser = { name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: null };
  const planning = {
    organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', purpose: 'Partners', description: 'Annual summit', status: 'PLANNING',
    expected_attendance: 100, event_date: '2026-11-04', start_time: '09:00', end_time: '17:00'
  };
  const requirement = { event_id: 'e1', preferred_location: 'Level 3', required_layout: 'THEATRE', facilities_required: true, accessibility_needed: true, accessibility_notes: 'Ramp' };
  const before = { ...planning, ...requirement, facilities: ['PROJECTOR', 'WIFI'], accessibility: ['HEARING_LOOP', 'WHEELCHAIR'] };
  const formFor = (event) => ({ ...ordinaryEventValues(event, organiser), ...significantEventValues(event) });
  const impactNow = () => reviewApi.arrangementImpact('e1');

  beforeEach(() => {
    stored['users/c1'] = coordinator;
    stored['events/e1'] = { ...planning };
    stored['event_venue_requirements/e1'] = { ...requirement };
    stored['event_facilities/e1_PROJECTOR'] = { event_id: 'e1', facility_id: 'PROJECTOR' };
    stored['event_facilities/e1_WIFI'] = { event_id: 'e1', facility_id: 'WIFI' };
    stored['event_accessibility/e1_HEARING_LOOP'] = { event_id: 'e1', accessibility_id: 'HEARING_LOOP' };
    stored['event_accessibility/e1_WHEELCHAIR'] = { event_id: 'e1', accessibility_id: 'WHEELCHAIR' };
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
  });

  describe('normal', () => {
    test('TC-0481 D2 kept facility and accessibility rows stay, dropped ones are deleted, new ones are added', async () => {
      const values = { ...formFor(before), facilities: ['PROJECTOR', 'STAGE'], accessibility: ['WHEELCHAIR', 'BRAILLE'] };

      const result = await reviewApi.saveEventEdit({ eventId: 'e1', before, values, organiser, impact: await impactNow(), acknowledged: true });

      expect(result).toMatchObject({ ok: true, changed: 2, rerequest: { sent: true } });
      expect(writes.deletes.sort()).toEqual(['event_accessibility/e1_HEARING_LOOP', 'event_facilities/e1_WIFI']);
      expect(writes.sets.map(([path]) => path)).toEqual(expect.arrayContaining(['event_facilities/e1_STAGE', 'event_accessibility/e1_BRAILLE']));
      expect(writes.sets.map(([path]) => path)).not.toEqual(expect.arrayContaining(['event_facilities/e1_PROJECTOR', 'event_accessibility/e1_WHEELCHAIR']));
    });

    test('TC-1916 I2 AC3 accepting a change request closes it in the same commit, records it and tells the organiser', async () => {
      stored['change_requests/cr1'] = { event_id: 'e1', status: 'PENDING', changes: { expected_attendance: { new_value: 150 }, name: { new_value: 'Partner Summit 2026' }, unknown_field: { new_value: 'x' } } };
      const values = { ...formFor(before), expected_attendance: 150, name: 'Partner Summit 2026' };

      await reviewApi.saveEventEdit({
        eventId: 'e1', before, values, organiser, impact: await impactNow(), acknowledged: true,
        changeRequest: { id: 'cr1', reason: '  Room has space  ' }
      });

      const applied = {
        expected_attendance: { old_value: 100, new_value: 150 },
        name: { old_value: 'Partner Summit', new_value: 'Partner Summit 2026' },
        unknown_field: { old_value: null, new_value: 'x' }
      };
      const [requestUpdate] = updatesAt('change_requests/cr1');
      expect(requestUpdate).toMatchObject({ status: 'ACCEPTED', decided_by: 'c1', decided_at: 'TS', decision_reason: 'Room has space', applied_changes: applied });
      const decision = setsAt('event_history/').find((item) => item.action_type === 'CHANGE_REQUEST_ACCEPTED');
      expect(decision).toMatchObject({ description: 'Room has space', change_request_id: 'cr1', history_id: requestUpdate.decision_history_id });
      expect(decision.new_value).toEqual({ expected_attendance: 150, name: 'Partner Summit 2026', unknown_field: 'x' });
      const notice = setsAt('notifications/').find((item) => item.type === 'CHANGE_REQUEST_ACCEPTED');
      expect(notice).toMatchObject({ user_id: 'org1', change_request_id: 'cr1', message: 'Partner Summit: your change request was accepted and applied — Room has space' });
    });

    test('TC-1917 I2 an ordinary-only accepted request with no note uses the default wording and the event\'s reference', async () => {
      stored['events/e1'] = { ...planning, name: '', reference_no: 'EVT-1' };
      stored['change_requests/cr1'] = { event_id: 'e1', status: 'PENDING' };
      const ordinaryBefore = { ...before, name: '' };

      await reviewApi.saveEventEdit({
        eventId: 'e1', before: ordinaryBefore, values: { ...formFor(ordinaryBefore), name: 'Named now' }, organiser, changeRequest: { id: 'cr1' }
      });

      expect(updatesAt('change_requests/cr1')[0]).toMatchObject({ decision_reason: '', applied_changes: {} });
      expect(setsAt('event_history/').find((item) => item.action_type === 'CHANGE_REQUEST_ACCEPTED').description).toBe('Coordinator accepted the change request.');
      expect(setsAt('notifications/')[0].message).toBe('EVT-1: your change request was accepted and applied.');
    });
  });

  describe('boundary', () => {
    test('TC-0482 D2 turning facilities and accessibility off removes every row and clears the notes', async () => {
      const values = { ...formFor(before), facilities_required: false, accessibility_needed: false };

      await reviewApi.saveEventEdit({ eventId: 'e1', before, values, organiser, impact: await impactNow(), acknowledged: true });

      expect(writes.deletes).toHaveLength(4);
      expect(setsAt('event_venue_requirements/e1')[0]).toMatchObject({ facilities_required: false, accessibility_needed: false, accessibility_notes: '' });
    });

    test('TC-0483 D2 a requirement record that does not exist yet is created from the form', async () => {
      delete stored['event_venue_requirements/e1'];
      ['event_facilities/e1_PROJECTOR', 'event_facilities/e1_WIFI', 'event_accessibility/e1_HEARING_LOOP', 'event_accessibility/e1_WHEELCHAIR'].forEach((path) => delete stored[path]);
      const values = { ...formFor(planning), preferred_location: 'Level 5' };

      await reviewApi.saveEventEdit({ eventId: 'e1', before: planning, values, organiser, impact: await impactNow(), acknowledged: true });

      expect(setsAt('event_venue_requirements/e1')[0]).toEqual({
        event_id: 'e1', preferred_location: 'Level 5', required_layout: null, facilities_required: false, accessibility_needed: false, accessibility_notes: ''
      });
    });

    test('TC-2065 I3 AC4 a fractional capacity is refused, and one below the registered count names that count', async () => {
      const event = { ...planning, registration_capacity: 5 };
      stored['events/e1'] = event;

      await expect(reviewApi.saveEventEdit({
        eventId: 'e1', before: event, organiser, registeredCount: 1, values: { ...formFor(event), registration_capacity: 0.5 }
      })).rejects.toThrow('Registration capacity must be a whole number greater than zero.');

      stored['registrations/g1'] = { event_id: 'e1', status: 'REGISTERED' };
      await expect(reviewApi.saveEventEdit({
        eventId: 'e1', before: { ...event, registration_capacity: 5 }, organiser, registeredCount: 2, values: { ...formFor(event), registration_capacity: 1 }
      })).rejects.toThrow('below the 2 people already registered');
      nothingWritten();
    });

    test('TC-2245 J7 a venue change tells registered attendees whichever id field the registration uses', async () => {
      stored['registrations/g1'] = { event_id: 'e1', status: 'REGISTERED', user_id: 'att1' };
      stored['registrations/g2'] = { event_id: 'e1', status: 'REGISTERED', attendee_id: 'att2' };
      const values = { ...formFor(before), preferred_location: 'Level 9' };

      await reviewApi.saveEventEdit({ eventId: 'e1', before, values, organiser, impact: await impactNow(), acknowledged: true });

      expect(setsAt('notifications/').map((item) => [item.user_id, item.registration_id])).toEqual([['att1', 'g1'], ['att2', 'g2']]);
    });
  });

  describe('conflict', () => {
    test.each([
      ['already decided', { event_id: 'e1', status: 'ACCEPTED' }],
      ['raised against another event', { event_id: 'e2', status: 'PENDING' }],
      ['gone', undefined]
    ])('TC-1918 I2 a change request that is %s is refused and nothing is written', async (label, request) => {
      if (request) stored['change_requests/cr1'] = request;

      await expect(reviewApi.saveEventEdit({
        eventId: 'e1', before, values: { ...formFor(before), name: 'New name' }, organiser, changeRequest: { id: 'cr1' }
      })).rejects.toThrow('This change request has already been decided.');
      nothingWritten();
    });

    test('TC-0484 D2 a venue requirement changed by someone else meanwhile is refused, not overwritten', async () => {
      const impact = await impactNow();
      stored['event_accessibility/e1_WHEELCHAIR'] = { event_id: 'e1', accessibility_id: 'BRAILLE' };

      await expect(reviewApi.saveEventEdit({
        eventId: 'e1', before, values: { ...formFor(before), expected_attendance: 120 }, organiser, impact, acknowledged: true
      })).rejects.toThrow('Reload the event and review the warning again.');
      nothingWritten();
    });

    test('TC-0445 D1 AC3 an event whose coordinator changed before the save is refused', async () => {
      stored['events/e1'] = { ...planning, coordinator_id: 'c2' };

      await expect(reviewApi.saveEventEdit({
        eventId: 'e1', before, values: { ...formFor(before), name: 'New name' }, organiser
      })).rejects.toThrow('Only the current coordinator may edit this event');
      nothingWritten();
    });
  });

  describe('failure', () => {
    test('TC-0446 D1 an event deleted before the save is refused as not authorised', async () => {
      delete stored['events/e1'];

      await expect(reviewApi.saveEventEdit({
        eventId: 'e1', before, values: { ...formFor(before), name: 'New name' }, organiser
      })).rejects.toThrow(NOT_AUTHORISED);
    });

    test('TC-0447 D1 a field emptied to invalid is refused before anything is read in a transaction', async () => {
      await expect(reviewApi.saveEventEdit({
        eventId: 'e1', before, values: { ...formFor(before), name: '   ' }, organiser
      })).rejects.toThrow();
      expect(firestore.runTransaction).not.toHaveBeenCalled();
    });

    test('TC-0485 D2 invalid significant values are refused before the impact is read', async () => {
      await expect(reviewApi.saveEventEdit({
        eventId: 'e1', before, values: { ...formFor(before), expected_attendance: 0 }, organiser, acknowledged: true
      })).rejects.toThrow('Expected attendance must be a whole number greater than zero.');
      expect(firestore.runTransaction).not.toHaveBeenCalled();
    });

    test('TC-2066 I3 a service refusal with no message, or an unreadable reply, falls back to a fixed sentence', async () => {
      global.fetch = jest.fn(async () => ({ ok: false, json: async () => null }));
      await expect(reviewApi.retryRerequest({ eventId: 'e1', changeId: 'h1' })).rejects.toThrow('The arrangements could not be marked for re-request.');

      global.fetch = jest.fn(async () => ({ ok: false, json: async () => { throw new SyntaxError('Unexpected token'); } }));
      await expect(reviewApi.retryRerequest({ eventId: 'e1', changeId: 'h1' })).rejects.toThrow('The arrangements service could not be reached.');
    });

    test('TC-2067 I3 a re-request failure with an empty message is still reported with the fixed sentence', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: '' }) }));

      const result = await reviewApi.saveEventEdit({
        eventId: 'e1', before, values: { ...formFor(before), expected_attendance: 120 }, organiser, impact: await impactNow(), acknowledged: true
      });

      expect(result.rerequest).toEqual({ sent: false, changeId: expect.any(String), error: 'The arrangements could not be marked for re-request.' });
    });
  });
});

describe('C4 / C5 / C7 / C6 the review decisions', () => {
  beforeEach(() => {
    stored['events/e1'] = { organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', reference_no: 'EVT-1', status: 'SUBMITTED' };
  });

  describe('normal', () => {
    test('TC-0368 C4 the assigned coordinator opens a submitted request: Under Review, with a history entry', async () => {
      await expect(reviewApi.openReview('e1')).resolves.toEqual({ ok: true });

      expect(updatesAt('events/e1')).toEqual([{ status: 'UNDER_REVIEW', updated_at: 'TS' }]);
      expect(setsAt('event_history/')).toEqual([expect.objectContaining({ action_type: 'REVIEW_STARTED', old_value: 'SUBMITTED', new_value: 'UNDER_REVIEW', actor_id: 'c1' })]);
    });

    test('TC-0369 C4 AC1 AC2 a clarification is recorded open, linked on the event (still Under Review), logged and sent to the organiser', async () => {
      stored['events/e1'].status = 'UNDER_REVIEW';

      const result = await reviewApi.clarify('e1', '  Which hall?  ');

      expect(result).toEqual({ ok: true, clarificationId: 'auto1' });
      expect(setsAt('clarification_requests/auto1')).toEqual([expect.objectContaining({ message: 'Which hall?', status: 'OPEN', created_by: 'c1' })]);
      expect(updatesAt('events/e1')).toEqual([{ status: 'UNDER_REVIEW', open_clarification_id: 'auto1', updated_at: 'TS' }]);
      expect(setsAt('notifications/')).toEqual([expect.objectContaining({ user_id: 'org1', message: 'Partner Summit: clarification requested — Which hall?' })]);
    });

    test('TC-0394 C5 the organiser answers an open clarification: answered, unlinked, and the coordinator is told', async () => {
      auth.currentUser = { uid: 'org1' };
      stored['events/e1'] = { ...stored['events/e1'], name: '', status: 'UNDER_REVIEW', open_clarification_id: 'q1' };
      stored['clarification_requests/q1'] = { event_id: 'e1', status: 'OPEN' };

      await expect(reviewApi.respond('e1', 'q1', ' Hall B ')).resolves.toEqual({ ok: true });

      expect(setsAt('clarification_responses/')).toEqual([expect.objectContaining({ clarification_id: 'q1', responder_id: 'org1', message: 'Hall B' })]);
      expect(updatesAt('clarification_requests/q1')).toEqual([{ status: 'ANSWERED', responded_at: 'TS' }]);
      expect(updatesAt('events/e1')).toEqual([{ open_clarification_id: null, updated_at: 'TS' }]);
      expect(setsAt('notifications/')).toEqual([expect.objectContaining({ user_id: 'c1', message: 'EVT-1: the organiser answered your clarification.' })]);
    });

    test('TC-0414 C7 an event with no name is rejected and named by its reference', async () => {
      stored['events/e1'] = { ...stored['events/e1'], name: '', status: 'UNDER_REVIEW' };

      await reviewApi.reject('e1', 'Out of scope');

      expect(updatesAt('events/e1')).toEqual([{ status: 'REJECTED', updated_at: 'TS' }]);
      expect(setsAt('notifications/')[0].message).toContain('EVT-1');
    });
  });

  describe('boundary', () => {
    test('TC-0370 C4 a clarification for an event with no name is named by its reference', async () => {
      stored['events/e1'] = { ...stored['events/e1'], name: '', status: 'UNDER_REVIEW' };

      await reviewApi.clarify('e1', 'Which hall?');

      expect(setsAt('notifications/')[0].message).toBe('EVT-1: clarification requested — Which hall?');
    });
  });

  describe('conflict', () => {
    test.each([
      ['an event already under review', { status: 'UNDER_REVIEW' }],
      ['another coordinator\'s event', { coordinator_id: 'c2' }],
      ['an unassigned event (K1)', { coordinator_id: null }]
    ])('TC-0371 C4 opening %s for review is refused and writes nothing', async (label, change) => {
      stored['events/e1'] = { ...stored['events/e1'], ...change };

      await expect(reviewApi.openReview('e1')).rejects.toThrow('Only the assigned coordinator can open this submitted request.');
      nothingWritten();
    });

    test('TC-0372 C4 a second clarification while one is open is refused', async () => {
      stored['events/e1'] = { ...stored['events/e1'], status: 'UNDER_REVIEW', open_clarification_id: 'q1' };

      await expect(reviewApi.clarify('e1', 'Again?')).rejects.toThrow('A clarification cannot be requested for this event.');
      nothingWritten();
    });

    test('TC-0415 C7 / C6 rejecting or approving an event not under review is refused', async () => {
      stored['events/e1'].status = 'APPROVED';

      await expect(reviewApi.reject('e1', 'No')).rejects.toThrow('This event cannot be rejected now.');
      await expect(reviewApi.approve('e1', 'Yes')).rejects.toThrow('This event cannot be approved now.');
      nothingWritten();
    });

    test.each([
      ['someone other than the organiser', 'c1', { status: 'OPEN' }, 'q1'],
      ['an already answered clarification', 'org1', { status: 'ANSWERED' }, 'q1'],
      ['a clarification that is not the open one', 'org1', { status: 'OPEN' }, 'q0']
    ])('TC-0395 C5 an answer from %s is refused', async (label, uid, clarification, openId) => {
      auth.currentUser = { uid };
      stored['events/e1'] = { ...stored['events/e1'], status: 'UNDER_REVIEW', open_clarification_id: openId };
      stored['clarification_requests/q1'] = { event_id: 'e1', ...clarification };

      await expect(reviewApi.respond('e1', 'q1', 'Hall B')).rejects.toThrow('You cannot answer this clarification.');
      nothingWritten();
    });
  });

  describe('failure', () => {
    test('TC-0373 C4 / C5 empty messages are refused before any transaction', async () => {
      await expect(reviewApi.clarify('e1', '   ')).rejects.toThrow('Clarification message is required.');
      await expect(reviewApi.respond('e1', 'q1', '')).rejects.toThrow('Response message is required.');
      await expect(reviewApi.reject('e1', ' ')).rejects.toThrow('Rejection reason is required.');
      expect(firestore.runTransaction).not.toHaveBeenCalled();
    });

    test('TC-0374 missing events or clarifications are refused', async () => {
      await expect(reviewApi.openReview('missing')).rejects.toThrow('Only the assigned coordinator can open this submitted request.');
      await expect(reviewApi.clarify('missing', 'Hi')).rejects.toThrow('A clarification cannot be requested for this event.');
      await expect(reviewApi.reject('missing', 'No')).rejects.toThrow('This event cannot be rejected now.');
      await expect(reviewApi.approve('missing', 'Yes')).rejects.toThrow('This event cannot be approved now.');
      await expect(reviewApi.respond('e1', 'missing', 'Hi')).rejects.toThrow('Clarification not found.');
      nothingWritten();
    });

    test('TC-0375 signed-out callers are asked to sign in again', async () => {
      auth.currentUser = null;

      await expect(reviewApi.openReview('e1')).rejects.toThrow('Please sign in again.');
      await expect(reviewApi.respond('e1', 'q1', 'x')).rejects.toThrow('Please sign in again.');
    });
  });
});

describe('D4 / K1 cancelling an event', () => {
  beforeEach(() => {
    stored['events/e1'] = { organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', reference_no: 'EVT-1', status: 'PLANNING' };
    stored['events/u1'] = { organiser_id: 'org1', coordinator_id: null, name: 'Unassigned Fair', status: 'SUBMITTED' };
    stored['users/lead1'] = { role: 'EVENT_COORDINATOR_LEAD', is_active: true };
    stored['users/lead2'] = { role: 'EVENT_COORDINATOR_LEAD', is_active: true };
  });

  describe('normal', () => {
    test('TC-2279 K1 the organiser cancels a request still waiting for a coordinator, and each Lead is told it left the queue', async () => {
      auth.currentUser = { uid: 'org1' };

      await expect(reviewApi.cancelUnassigned('u1', ' Plans changed ')).resolves.toEqual({ ok: true });

      expect(updatesAt('events/u1')).toEqual([{ status: 'CANCELLED', cancellation_reason: 'Plans changed', cancelled_at: 'TS', updated_at: 'TS' }]);
      expect(setsAt('notifications/').map((item) => [item.user_id, item.type])).toEqual([['lead1', 'UNASSIGNED_EVENT_CANCELLED'], ['lead2', 'UNASSIGNED_EVENT_CANCELLED']]);
    });
  });

  describe('boundary', () => {
    test('TC-0525 D4 an event with neither name nor reference is called "Your event", and registrations without a person are skipped', async () => {
      stored['events/e1'] = { organiser_id: 'org1', coordinator_id: 'c1', status: 'PLANNING' };
      stored['registrations/g1'] = { event_id: 'e1', status: 'registered', user_id: 'att1' };
      stored['registrations/g2'] = { event_id: 'e1', status: 'REGISTERED' };
      stored['registrations/g3'] = { event_id: 'e1' };

      const result = await reviewApi.cancel('e1', 'Venue lost');

      expect(result).toEqual({ eventId: 'e1', eventName: 'Your event', reason: 'Venue lost', attendees: [{ registrationId: 'g1', userId: 'att1' }] });
    });

    test('TC-0526 D4 notifying attendees de-duplicates registrations and commits in batches of 400', async () => {
      const commits = [];
      firestore.writeBatch.mockImplementation(() => {
        const batch = { sets: [], set: (ref, data) => batch.sets.push(data), commit: async () => commits.push(batch.sets.length) };
        return batch;
      });
      const attendees = Array.from({ length: 401 }, (_, index) => ({ registrationId: `g${index}`, userId: `att${index}` }));

      const result = await reviewApi.notifyCancelledAttendees({ eventId: 'e1', eventName: 'Partner Summit', reason: 'Venue lost', attendees: [...attendees, attendees[0]] });

      expect(result).toEqual({ notified: 401 });
      expect(commits).toEqual([400, 1]);
      await expect(reviewApi.notifyCancelledAttendees({ eventId: 'e1' })).resolves.toEqual({ notified: 0 });
      expect(commits).toHaveLength(2);
    });
  });

  describe('conflict', () => {
    test('TC-0527 D4 another coordinator cannot cancel, and an event taken over between the check and the commit is refused', async () => {
      auth.currentUser = { uid: 'c2' };
      await expect(reviewApi.cancel('e1', 'No')).rejects.toThrow('Only the current coordinator may cancel an active event.');

      auth.currentUser = { uid: 'c1' };
      firestore.runTransaction.mockImplementation(async (db, work) => work({
        get: async (ref) => snapshot(ref.path, { ...stored[ref.path], coordinator_id: 'c2' }),
        update: (ref, data) => writes.updates.push([ref.path, data]),
        set: (ref, data) => writes.sets.push([ref.path, data])
      }));
      await expect(reviewApi.cancel('e1', 'No')).rejects.toThrow('Only the current coordinator may cancel an active event.');
      nothingWritten();
    });

    test.each([
      ['an event someone else organises', 'org2', 'u1', 'Only the organiser can cancel this request.'],
      ['an event that already has a coordinator', 'org1', 'e1', 'Only an unassigned submitted request can be cancelled this way.']
    ])('TC-2280 K1 cancelling %s while unassigned is refused', async (label, uid, eventId, message) => {
      auth.currentUser = { uid };

      await expect(reviewApi.cancelUnassigned(eventId, 'No longer needed')).rejects.toThrow(message);
      nothingWritten();
    });
  });

  describe('failure', () => {
    test('TC-0528 D4 / K1 a reason is required and a missing event is refused', async () => {
      auth.currentUser = { uid: 'org1' };
      await expect(reviewApi.cancelUnassigned('u1', '  ')).rejects.toThrow('Cancellation reason is required.');
      await expect(reviewApi.cancelUnassigned('missing', 'Gone')).rejects.toThrow('Only the organiser can cancel this request.');
      auth.currentUser = { uid: 'c1' };
      await expect(reviewApi.cancel('missing', 'Gone')).rejects.toThrow('Only the current coordinator may cancel an active event.');
      nothingWritten();
    });
  });
});

describe('K2 / K3 the Lead assigns and reassigns; H complete', () => {
  beforeEach(() => {
    auth.currentUser = { uid: 'lead1', getIdToken: async () => 'id-token' };
    stored['users/lead1'] = { role: 'EVENT_COORDINATOR_LEAD', name: 'Lena Lead' };
    stored['users/c1'] = coordinator;
    stored['users/c2'] = { role: 'EVENT_COORDINATOR', email: 'alex@cs.sg', is_active: true };
    stored['users/c3'] = { role: 'EVENT_COORDINATOR', is_active: false };
    stored['users/vs1'] = { role: 'VENUE_STAFF', name: 'Vera' };
    stored['events/u1'] = { organiser_id: 'org1', coordinator_id: null, name: '', reference_no: 'EVT-9', status: 'SUBMITTED' };
    stored['events/e2'] = { organiser_id: 'org1', coordinator_id: 'c1', name: 'Workshop', status: 'UNDER_REVIEW' };
    stored['change_requests/cr1'] = { event_id: 'u1', status: 'PENDING', coordinator_id: null };
    stored['change_requests/cr2'] = { event_id: 'u1', status: 'ACCEPTED', coordinator_id: null };
  });

  describe('normal', () => {
    test('TC-2296 K2 AC3 AC4 the Lead assigns an unassigned event: one coordinator, the assignment record, history, and both people told', async () => {
      await expect(reviewApi.assign('u1', 'c2')).resolves.toEqual({ ok: true });

      expect(updatesAt('events/u1')).toEqual([{ coordinator_id: 'c2', assigned_at: 'TS', updated_at: 'TS' }]);
      // I1 — the Pending change request raised while unassigned now belongs to the new coordinator; a decided one is left alone.
      expect(updatesAt('change_requests/')).toEqual([{ coordinator_id: 'c2' }]);
      expect(writes.updates.map(([path]) => path)).toContain('change_requests/cr1');
      expect(setsAt('coordinator_assignments/u1_c2')).toEqual([{ assignment_id: 'u1_c2', event_id: 'u1', coordinator_id: 'c2', assigned_at: 'TS', ended_at: null }]);
      expect(setsAt('event_history/')).toEqual([expect.objectContaining({ action_type: 'COORDINATOR_ASSIGNED', actor_id: 'lead1', new_value: 'c2', description: 'Event assigned to alex@cs.sg.' })]);
      expect(setsAt('notifications/').map((item) => [item.user_id, item.message])).toEqual([
        ['c2', 'EVT-9 was assigned to you.'],
        ['org1', 'EVT-9 was assigned to alex@cs.sg.']
      ]);
    });
  });

  describe('boundary', () => {
    test('TC-2297 K2 a coordinator named on their profile is named in the history; one with no name or email by id', async () => {
      await reviewApi.assign('u1', 'c1');
      expect(setsAt('event_history/')[0].description).toBe('Event assigned to Joshua Chua.');

      stored['users/c4'] = { role: 'EVENT_COORDINATOR' };
      await reviewApi.assign('u1', 'c4');
      expect(setsAt('event_history/')[1].description).toBe('Event assigned to c4.');
    });

    test('TC-2330 K3 reassigning an event with no recorded assignment time keeps a null original time', async () => {
      await reviewApi.leadReassign('e2', 'c2');

      expect(setsAt('coordinator_assignments/e2_c1')[0]).toMatchObject({ coordinator_id: 'c1', assigned_at: null, ended_at: 'TS', reassigned_by: 'lead1' });
      expect(setsAt('event_history/')[0]).toMatchObject({ previous_assigned_at: null, description: 'Event reassigned to alex@cs.sg.' });
      expect(setsAt('notifications/').map((item) => item.message)).toEqual([
        'Workshop was reassigned to alex@cs.sg. You are no longer its coordinator.',
        'Workshop was reassigned to you.',
        'Workshop was reassigned to alex@cs.sg.'
      ]);
    });

    test('TC-2391 K4 an unassigned event on the Lead board has no coordinator name', async () => {
      const { events } = await reviewApi.leadBoard();

      expect(Object.fromEntries(events.map((item) => [item.id, item.coordinator_name]))).toEqual({ u1: null, e2: 'Joshua Chua' });
    });
  });

  describe('conflict', () => {
    test.each([
      ['an event that already has a coordinator (that is a reassignment)', 'lead1', 'e2', 'c2'],
      ['a caller who is a coordinator, not the Lead', 'c1', 'u1', 'c2'],
      ['a caller with no profile', 'nobody', 'u1', 'c2'],
      ['an inactive coordinator', 'lead1', 'u1', 'c3'],
      ['a user who is not a coordinator', 'lead1', 'u1', 'vs1']
    ])('TC-2298 K2 AC5 assigning %s is refused and writes nothing', async (label, uid, eventId, target) => {
      auth.currentUser = { uid };

      await expect(reviewApi.assign(eventId, target)).rejects.toThrow('This event cannot be assigned to that coordinator.');
      nothingWritten();
    });

    test.each([
      ['an unassigned event (that is an assignment)', 'lead1', 'u1', 'c2'],
      ['a caller with no profile', 'nobody', 'e2', 'c2'],
      ['an inactive coordinator', 'lead1', 'e2', 'c3'],
      ['a user who is not a coordinator', 'lead1', 'e2', 'vs1']
    ])('TC-2331 K3 AC1 AC2 reassigning %s is refused and writes nothing', async (label, uid, eventId, target) => {
      auth.currentUser = { uid };

      await expect(reviewApi.leadReassign(eventId, target)).rejects.toThrow('This event cannot be reassigned to that coordinator.');
      nothingWritten();
    });
  });

  describe('failure', () => {
    test('TC-2299 K2 / K3 a missing event or coordinator is reported and nothing is written', async () => {
      await expect(reviewApi.assign('missing', 'c2')).rejects.toThrow('Event or coordinator not found.');
      await expect(reviewApi.assign('u1', 'ghost')).rejects.toThrow('Event or coordinator not found.');
      await expect(reviewApi.leadReassign('missing', 'c2')).rejects.toThrow('Event or coordinator not found.');
      await expect(reviewApi.leadReassign('e2', 'ghost')).rejects.toThrow('Event or coordinator not found.');
      nothingWritten();
    });

    test('TC-2300 a signed-out caller cannot assign, reassign or complete', async () => {
      auth.currentUser = null;

      await expect(reviewApi.assign('u1', 'c2')).rejects.toThrow('Please sign in again.');
      await expect(reviewApi.leadReassign('e2', 'c2')).rejects.toThrow('Please sign in again.');
      await expect(reviewApi.complete('e2')).rejects.toThrow('Please sign in again.');
    });
  });
});

describe('H completing an event through the backend', () => {
  beforeEach(() => {
    auth.currentUser = { uid: 'c1', getIdToken: async () => 'id-token' };
  });
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("TC-0486 [normal] completion is asked of the backend with the coordinator's token and its answer returned", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ status: 'COMPLETED' }) }));

    await expect(reviewApi.complete('e/1')).resolves.toEqual({ status: 'COMPLETED' });
    expect(global.fetch).toHaveBeenCalledWith('/api/events/e%2F1/complete', { method: 'POST', headers: { Authorization: 'Bearer id-token' } });
  });

  test("TC-0487 [failure] a refusal is reported with the backend's message, or a fixed sentence when it gives none", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: 'The event has not ended yet.' }) }));
    await expect(reviewApi.complete('e1')).rejects.toThrow('The event has not ended yet.');

    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    await expect(reviewApi.complete('e1')).rejects.toThrow('The event could not be marked completed.');
  });
});

// The fallbacks the sections above leave untried: profiles with only one kind of
// name, undated bookings, a form missing its significant fields, and a reassignment
// that carries a pending change request across to the new coordinator.
describe('reviewApi fallbacks across loaders and writes', () => {
  beforeEach(() => {
    stored['users/c1'] = coordinator;
    stored['users/lead1'] = { role: 'EVENT_COORDINATOR_LEAD', name: 'Lena Lead' };
    stored['users/c2'] = { role: 'EVENT_COORDINATOR', email: 'alex@cs.sg', is_active: true };
    stored['users/c5'] = { role: 'EVENT_COORDINATOR', is_active: true };
  });

  describe('normal', () => {
    test('TC-2332 K3 a reassignment moves the pending change request to the new coordinator, named by id when the profile has no name', async () => {
      auth.currentUser = { uid: 'lead1' };
      stored['events/e3'] = { organiser_id: 'org1', coordinator_id: 'c1', assigned_at: 'T0', name: '', reference_no: 'EVT-7', status: 'PLANNING' };
      stored['change_requests/cr3'] = { event_id: 'e3', status: 'PENDING', coordinator_id: 'c1' };

      await reviewApi.leadReassign('e3', 'c5');

      expect(updatesAt('change_requests/cr3')).toEqual([{ coordinator_id: 'c5' }]);
      expect(setsAt('event_history/')[0]).toMatchObject({ description: 'Event reassigned to c5.' });
      expect(setsAt('notifications/').map((item) => item.message)).toEqual([
        'EVT-7 was reassigned to c5. You are no longer its coordinator.',
        'EVT-7 was reassigned to you.',
        'EVT-7 was reassigned to c5.'
      ]);
    });
  });

  describe('boundary', () => {
    test('TC-2392 K4 the Lead board names coordinators by name, else email, else id, in the list and on each row', async () => {
      auth.currentUser = { uid: 'lead1' };
      stored['events/a'] = { organiser_id: 'org1', coordinator_id: 'c2', status: 'PLANNING' };
      stored['events/b'] = { organiser_id: 'org1', coordinator_id: 'c5', status: 'PLANNING' };

      const { events, coordinators } = await reviewApi.leadBoard();

      expect(coordinators).toEqual(expect.arrayContaining([
        { id: 'c1', name: 'Joshua Chua', active: true },
        { id: 'c2', name: 'alex@cs.sg', active: true },
        { id: 'c5', name: 'c5', active: true }
      ]));
      expect(Object.fromEntries(events.map((item) => [item.id, item.coordinator_name]))).toEqual({ a: 'alex@cs.sg', b: 'c5' });
    });

    test('TC-0448 D1 AC2 / F12 actors named only by display or staff name are named; undated bookings sort first', async () => {
      stored['events/e1'] = { organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', status: 'PLANNING' };
      stored['event_history/h1'] = { event_id: 'e1', action_type: 'NOTE', actor_id: 'tss1', created_at: '1' };
      stored['event_history/h2'] = { event_id: 'e1', action_type: 'NOTE', actor_id: 'vs1', created_at: '2' };
      stored['users/tss1'] = { role: 'TECHNICAL_SUPPORT', display_name: 'Tia Tech' };
      stored['users/vs1'] = { role: 'VENUE_STAFF', staff_name: 'Vera Venue' };
      stored['venue_bookings/b1'] = { event_id: 'e1', venue_id: 'v1', start_datetime: '2026-11-04T01:00:00.000Z' };
      stored['venue_bookings/b2'] = { event_id: 'e1', venue_id: 'v2' };
      stored['venue_bookings/b3'] = { event_id: 'e1', venue_id: 'v3' };

      const detail = await reviewApi.detail('e1');

      expect(detail.actorNames).toEqual({ tss1: 'Tia Tech', vs1: 'Vera Venue' });
      expect(detail.venueBookings.map((item) => item.booking_id)).toEqual(['b2', 'b3', 'b1']);
    });

    test('TC-2068 I3 AC4 registrations with no recorded status hold no place', async () => {
      stored['registrations/g1'] = { event_id: 'e1', status: 'registered' };
      stored['registrations/g2'] = { event_id: 'e1' };
      stored['registrations/g3'] = { event_id: 'e1', status: 'WAITLISTED' };

      await expect(reviewApi.registeredCount('e1')).resolves.toBe(1);
    });
  });

  describe('failure', () => {
    test('TC-0488 D2 a form missing its date and times is refused before anything is read, even with no organiser given', async () => {
      const event = {
        organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', purpose: 'Partners', description: 'Annual summit',
        status: 'PLANNING', expected_attendance: 100, event_date: '2026-11-04', start_time: '09:00', end_time: '17:00'
      };
      stored['events/e1'] = event;
      const values = { ...ordinaryEventValues(event, null), expected_attendance: 100 };

      await expect(reviewApi.saveEventEdit({ eventId: 'e1', before: event, values }))
        .rejects.toThrow('Event date, start time and end time are required.');
      expect(firestore.runTransaction).not.toHaveBeenCalled();
      nothingWritten();
    });

    test('TC-2069 I3 a re-request that fails with no message at all is reported with the fixed sentence', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const event = {
        organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', purpose: 'Partners', description: 'Annual summit',
        status: 'PLANNING', expected_attendance: 100, event_date: '2026-11-04', start_time: '09:00', end_time: '17:00'
      };
      stored['events/e1'] = event;
      stored['event_venue_requirements/e1'] = { event_id: 'e1' };
      // The token itself cannot be fetched, and the error carries no message.
      auth.currentUser = { uid: 'c1', getIdToken: async () => { throw new Error(''); } };
      const values = { ...ordinaryEventValues(event, null), ...significantEventValues(event), expected_attendance: 120 };

      const result = await reviewApi.saveEventEdit({
        eventId: 'e1', before: event, values, impact: await reviewApi.arrangementImpact('e1'), acknowledged: true
      });

      expect(result.rerequest).toEqual({ sent: false, changeId: expect.any(String), error: 'The arrangements could not be marked for re-request.' });
    });
  });
});
