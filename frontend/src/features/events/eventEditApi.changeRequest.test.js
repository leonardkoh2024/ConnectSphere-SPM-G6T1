// I2 / SCRUM-148 AC3 — accepting a change request applies its values through the
// Edit event save, and closes the request in the same transaction: the request is
// marked Accepted with the values it changed, the decision gets a history row, and
// the organiser is told. Same fake-transaction style as reviewApi.test.js.

import { reviewApi } from './reviewApi';
import * as firestore from 'firebase/firestore';
import { ordinaryEventValues } from '../../domain/ordinaryEventChanges';
import { significantEventValues } from '../../domain/significantEventChanges';
import { ACCEPTED, CHANGE_ACCEPTED, CHANGE_REQUEST_COLLECTION, PENDING, changeDecisionMessage } from '../../domain/changeRequests';

jest.mock('../../lib/firebase', () => ({ auth: { currentUser: { uid: 'c1' } }, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn(), query: jest.fn(), where: jest.fn(),
  getDoc: jest.fn(), getDocs: jest.fn(), runTransaction: jest.fn(), serverTimestamp: jest.fn(),
  writeBatch: jest.fn()
}));

const snapshot = (id, data) => ({ id, exists: () => Boolean(data), data: () => data });

const organiser = { name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: null };
const planning = {
  organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', purpose: 'Partners', description: 'Annual summit', status: 'PLANNING',
  expected_attendance: 100, event_date: '2026-11-04', start_time: '09:00', end_time: '17:00'
};
const formFor = (event) => ({ ...ordinaryEventValues(event, organiser), ...significantEventValues(event) });
const noImpact = { venueBookings: [], equipmentReservations: [], registrationsCount: 0 };
const requestPath = `${CHANGE_REQUEST_COLLECTION}/cr1`;

let writes;
let request;

beforeEach(() => {
  writes = { updates: [], sets: [], deletes: [] };
  request = { status: PENDING, event_id: 'e1', changes: { name: { new_value: 'Partner Summit 2026' } } };
  let autoId = 0;
  firestore.collection.mockImplementation((db, name) => ({ name }));
  firestore.query.mockImplementation((source, ...constraints) => ({ name: source.name, constraints }));
  firestore.where.mockImplementation((field, op, value) => ({ field, value }));
  firestore.serverTimestamp.mockReturnValue('TS');
  firestore.getDocs.mockResolvedValue({ docs: [], size: 0 });
  firestore.doc.mockImplementation((first, name, id) => {
    if (name) return { path: `${name}/${id}`, id };
    autoId += 1;
    return { path: `${first.name}/a${autoId}`, id: `a${autoId}` };
  });
  firestore.getDoc.mockImplementation(async (ref) => {
    if (ref.path === 'users/c1') return snapshot('c1', { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true });
    if (ref.path === 'events/e1') return snapshot('e1', planning);
    return snapshot(ref.id, null);
  });
  firestore.runTransaction.mockImplementation(async (db, work) => work({
    get: async (ref) => {
      if (ref.path === 'events/e1') return snapshot('e1', planning);
      if (ref.path === requestPath) return snapshot('cr1', request);
      return snapshot(ref.id, null);
    },
    update: (ref, data) => writes.updates.push([ref.path, data]),
    set: (ref, data) => writes.sets.push([ref.path, data]),
    delete: (ref) => writes.deletes.push(ref.path)
  }));
});

test('I2 AC3 an accepted ordinary change closes the request, records the decision and tells the organiser', async () => {
  const result = await reviewApi.saveEventEdit({
    eventId: 'e1', before: planning, organiser,
    values: { ...formFor(planning), name: 'Partner Summit 2026' },
    changeRequest: { id: 'cr1', reason: '  Agreed with the venue  ' }
  });

  expect(result).toEqual({ ok: true, changed: 1 });
  expect(writes.updates.map(([path]) => path)).toEqual(['events/e1', requestPath]);
  const decision = writes.sets.find(([, data]) => data.action_type === CHANGE_ACCEPTED);
  expect(writes.updates[1][1]).toEqual({
    status: ACCEPTED, decided_by: 'c1', decided_at: 'TS', decision_reason: 'Agreed with the venue',
    applied_changes: { name: { old_value: 'Partner Summit', new_value: 'Partner Summit 2026' } },
    decision_history_id: decision[1].history_id
  });
  expect(decision[1]).toMatchObject({
    event_id: 'e1', actor_id: 'c1', field_name: 'change_request', change_request_id: 'cr1',
    old_value: { name: 'Partner Summit' }, new_value: { name: 'Partner Summit 2026' },
    description: 'Agreed with the venue'
  });
  const notice = writes.sets.find(([path, data]) => path.startsWith('notifications/') && data.type === CHANGE_ACCEPTED);
  expect(notice[1]).toMatchObject({
    user_id: 'org1', event_id: 'e1', change_request_id: 'cr1',
    message: changeDecisionMessage({ eventName: 'Partner Summit', accepted: true, reason: 'Agreed with the venue' })
  });
});

test('I2 AC3 an accepted significant change records the stored value it replaced', async () => {
  request = { ...request, changes: { expected_attendance: { new_value: 125 } } };

  await reviewApi.saveEventEdit({
    eventId: 'e1', before: planning, organiser, impact: noImpact, acknowledged: true,
    values: { ...formFor(planning), expected_attendance: 125 },
    changeRequest: { id: 'cr1', reason: '' }
  });

  const requestUpdate = writes.updates.find(([path]) => path === requestPath)[1];
  expect(requestUpdate.applied_changes).toEqual({ expected_attendance: { old_value: 100, new_value: 125 } });
  const decision = writes.sets.find(([, data]) => data.action_type === CHANGE_ACCEPTED)[1];
  expect(decision.description).toBe('Coordinator accepted the change request.');
});

test('I2 AC3 a request that is no longer pending is refused and nothing is written', async () => {
  request = { ...request, status: ACCEPTED };

  await expect(reviewApi.saveEventEdit({
    eventId: 'e1', before: planning, organiser,
    values: { ...formFor(planning), name: 'Partner Summit 2026' },
    changeRequest: { id: 'cr1', reason: '' }
  })).rejects.toThrow('This change request has already been decided.');
  expect(writes).toEqual({ updates: [], sets: [], deletes: [] });
});
