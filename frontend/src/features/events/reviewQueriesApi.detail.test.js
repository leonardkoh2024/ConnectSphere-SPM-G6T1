// C3 / C8 / D1 / F7 / F12 — everything reviewApi.detail returns for one event, from
// a fully populated fake Firestore. reviewApi.test.js covers who may open an event,
// the equipment arrangements, the Activity names and the booking list; this file pins
// the rest of the result: the requirement fields merged onto the event, the latest
// decision, the organiser's contact, the ordering of each list, the coordinator
// lists, and what an organiser's view leaves out.

import { reviewApi } from './reviewApi';
import * as firestore from 'firebase/firestore';
import { auth } from '../../lib/firebase';

jest.mock('../../lib/firebase', () => ({ auth: { currentUser: { uid: 'c1' } }, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn(), query: jest.fn(), where: jest.fn(),
  getDoc: jest.fn(), getDocs: jest.fn(), runTransaction: jest.fn(), serverTimestamp: jest.fn(),
  writeBatch: jest.fn()
}));

const snapshot = (id, data) => ({ id, exists: () => Boolean(data), data: () => data });
const docs = (items) => ({ docs: items.map(([id, data]) => snapshot(id, data)) });

const event = {
  organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', status: 'PLANNING', created_at: '2026-10-01T00:00:00.000Z'
};
let users;
let collections;
let queried;

beforeEach(() => {
  auth.currentUser = { uid: 'c1' };
  queried = [];
  users = {
    c1: { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true },
    org1: { role: 'EVENT_ORGANISER', name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', contact_number: '91234567' }
  };
  collections = {
    clarification_requests: [
      ['q2', { event_id: 'e1', question: 'Second', created_at: '2026-10-03T00:00:00.000Z' }],
      ['q1', { event_id: 'e1', question: 'First', created_at: '2026-10-02T00:00:00.000Z' }]
    ],
    clarification_responses: {
      q1: [['r1', { clarification_id: 'q1', created_at: '2026-10-02T06:00:00.000Z' }]],
      q2: [['r2', { clarification_id: 'q2', created_at: '2026-10-03T06:00:00.000Z' }]]
    },
    coordinator_assignments: [['a1', { event_id: 'e1', coordinator_id: 'c1', created_at: '2026-10-01T01:00:00.000Z' }]],
    event_history: [
      ['h2', { event_id: 'e1', action_type: 'EVENT_APPROVED', actor_id: 'c1', new_value: 'APPROVED', description: 'Looks good', created_at: '2026-10-05T00:00:00.000Z' }],
      ['h1', { event_id: 'e1', action_type: 'EVENT_SUBMITTED', actor_id: 'org1', created_at: '2026-10-01T00:00:00.000Z' }]
    ],
    event_facilities: [['f1', { facility_id: 'WIFI' }], ['f2', { facility_id: '' }]],
    event_accessibility: [['x1', { accessibility_id: 'RAMP' }]],
    event_equipment: [
      ['eq1', { equipment_type: 'MICROPHONE', quantity: 4, technical_note: 'Wireless' }],
      ['eq2', { equipment_type: 'PROJECTOR', notes: 'Older note field' }]
    ],
    venue_bookings: [
      ['BK-2', { venue_id: 'VEN-GONE', venue_name: 'Old Annex', start_datetime: '2026-11-20T05:00:00.000Z' }],
      ['BK-1', {
        booking_id: 'BK-1', venue_id: 'VEN-MAIN', status: 'RELEASED', start_datetime: '2026-11-20T01:00:00.000Z',
        release_reason: 'Moved', replacement_needed: true, replacement_reason: 'Venue unavailable',
        replaced_by_booking_id: 'BK-3', required_facilities_snapshot: ['WIFI']
      }]
    ],
    users: [['c1', users.c1], ['c2', { email: 'c2@example.com', is_active: true }]]
  };
  firestore.collection.mockImplementation((db, name) => ({ name }));
  firestore.doc.mockImplementation((first, name, id) => ({ path: `${name}/${id}`, id }));
  firestore.query.mockImplementation((source, ...constraints) => ({ name: source.name, constraints }));
  firestore.where.mockImplementation((field, op, value) => ({ field, value }));
  firestore.getDoc.mockImplementation(async (ref) => {
    if (ref.path === 'events/e1') return snapshot('e1', event);
    if (ref.path.startsWith('users/')) return snapshot(ref.id, users[ref.id] || null);
    if (ref.path === 'event_venue_requirements/e1') return snapshot('e1', {
      preferred_location: 'CENTRAL', required_layout: 'THEATRE', facilities_required: true, accessibility_needed: false
    });
    if (ref.path === 'venues/VEN-MAIN') return snapshot('VEN-MAIN', { name: 'Main Hall' });
    return snapshot(ref.id, null);
  });
  firestore.getDocs.mockImplementation(async (q) => {
    queried.push(q.name);
    if (q.name === 'clarification_responses') return docs(collections.clarification_responses[q.constraints[0].value] || []);
    return docs(collections[q.name] || []);
  });
});

test('C3 the event carries its venue requirements, facilities, accessibility and equipment lines', async () => {
  const { event: loaded } = await reviewApi.detail('e1');

  expect(loaded).toMatchObject({
    id: 'e1', name: 'Partner Summit', editable: true,
    preferred_location: 'CENTRAL', required_layout: 'THEATRE', facilities_required: true, accessibility_needed: false,
    accessibility_notes: '', facilities: ['WIFI'], accessibility: ['RAMP'],
    // A missing quantity counts as one; the note falls back to the older field.
    equipment: [
      { equipment_type: 'MICROPHONE', quantity: 4, notes: 'Wireless' },
      { equipment_type: 'PROJECTOR', quantity: 1, notes: 'Older note field' }
    ]
  });
});

test('C8 the latest approve or reject decision is carried on the event', async () => {
  const { event: loaded } = await reviewApi.detail('e1');

  expect(loaded).toMatchObject({
    decision: 'APPROVED', decision_reason: 'Looks good', decided_by: 'c1', decided_at: '2026-10-05T00:00:00.000Z'
  });
});

test('C8 an event with no decision yet carries nulls', async () => {
  collections.event_history = [['h1', { event_id: 'e1', action_type: 'EVENT_SUBMITTED', actor_id: 'org1', created_at: '2026-10-01T00:00:00.000Z' }]];
  const { event: loaded } = await reviewApi.detail('e1');

  expect(loaded).toMatchObject({ decision: null, decision_reason: null, decided_by: null, decided_at: null });
});

test("C3 AC2 the organiser's contact comes from their profile, with the older phone field as a fallback", async () => {
  const { organiser } = await reviewApi.detail('e1');

  expect(organiser).toEqual({ id: 'org1', name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: '91234567' });
});

test('the coordinator, the active coordinators and the Activity names are resolved', async () => {
  const result = await reviewApi.detail('e1');

  expect(result.coordinator).toEqual({ id: 'c1', name: 'Joshua Chua', active: true });
  expect(result.coordinators).toEqual([
    { id: 'c1', name: 'Joshua Chua', active: true },
    { id: 'c2', name: 'c2@example.com', active: true }
  ]);
  expect(result.actorNames).toEqual({ c1: 'Joshua Chua', org1: 'Nadia Organiser' });
});

test('history, clarifications, responses and assignments come back oldest first', async () => {
  const result = await reviewApi.detail('e1');

  expect(result.history.map((item) => item.id)).toEqual(['h1', 'h2']);
  expect(result.clarifications.map((item) => item.id)).toEqual(['q1', 'q2']);
  expect(result.responses.map((item) => item.id)).toEqual(['r1', 'r2']);
  expect(result.assignments.map((item) => item.id)).toEqual(['a1']);
  expect(result.equipmentArrangements).toBeNull();
});

test('F7 F11 venue bookings come back by start time, with release and replacement details and fallbacks', async () => {
  const { venueBookings } = await reviewApi.detail('e1');

  expect(venueBookings).toEqual([
    {
      booking_id: 'BK-1', booking_label: null, expected_attendance: null, layout: null,
      venue_id: 'VEN-MAIN', venue_name: 'Main Hall',
      start_datetime: '2026-11-20T01:00:00.000Z', end_datetime: null,
      status: 'RELEASED', decision_reason: null, decided_at: null, released_at: null, release_reason: 'Moved',
      replacement_needed: true, replacement_reason: 'Venue unavailable', replaced_by_booking_id: 'BK-3',
      required_facilities_snapshot: ['WIFI']
    },
    {
      // No booking_id field: the document id. No readable venue: the name copied onto the booking.
      booking_id: 'BK-2', booking_label: null, expected_attendance: null, layout: null,
      venue_id: 'VEN-GONE', venue_name: 'Old Annex',
      start_datetime: '2026-11-20T05:00:00.000Z', end_datetime: null,
      status: 'Status not recorded', decision_reason: null, decided_at: null, released_at: null, release_reason: null,
      replacement_needed: false, replacement_reason: null, replaced_by_booking_id: null,
      required_facilities_snapshot: []
    }
  ]);
});

test("an organiser's view reads no venue bookings, equipment or coordinator list", async () => {
  auth.currentUser = { uid: 'org1' };

  const result = await reviewApi.detail('e1');

  expect(queried).not.toEqual(expect.arrayContaining(['venue_bookings']));
  expect(queried).not.toEqual(expect.arrayContaining(['equipment_reservations']));
  expect(queried).not.toEqual(expect.arrayContaining(['users']));
  expect(result.venueBookings).toEqual([]);
  expect(result.coordinators).toEqual([]);
  expect(result.equipmentArrangements).toBeNull();
  expect(result.event.editable).toBe(false);
});
