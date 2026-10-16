// C2 / C3 — the organiser's name (C2 AC2) and contact (C3 AC2) are looked up from
// the organiser's user profile. A coordinator is not always allowed to read that
// profile, and one unreadable profile must never blank the whole screen: the list
// and the event detail still load, with the organiser shown by the fallback.
import { reviewApi } from './reviewApi';
import * as firestore from 'firebase/firestore';
import { auth } from '../../lib/firebase';

jest.mock('../../lib/firebase', () => ({ auth: { currentUser: { uid: 'c1' } }, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn(), query: jest.fn(), where: jest.fn(),
  getDoc: jest.fn(), getDocs: jest.fn(), runTransaction: jest.fn(), serverTimestamp: jest.fn()
}));

const permissionDenied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
const snapshot = (id, data) => ({ id, exists: () => Boolean(data), data: () => data });
const docs = (items) => ({ docs: items.map(([id, data]) => snapshot(id, data)) });

const event = { organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', status: 'SUBMITTED' };

beforeEach(() => {
  auth.currentUser = { uid: 'c1' };
  // Create React App resets mocks between tests, so the stubs are built here.
  firestore.collection.mockImplementation((db, name) => ({ name }));
  firestore.doc.mockImplementation((first, name, id) => (name ? { path: `${name}/${id}`, id } : { path: `${first.name}/auto`, id: 'auto' }));
  firestore.query.mockImplementation((source, ...constraints) => ({ name: source.name, constraints }));
  firestore.where.mockImplementation((field, op, value) => ({ field, value }));
  firestore.serverTimestamp.mockReturnValue('TS');
  firestore.getDoc.mockImplementation(async (ref) => {
    if (ref.path === 'users/c1') return snapshot('c1', { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true });
    if (ref.path === 'users/org1') throw permissionDenied();
    if (ref.path === 'events/e1') return snapshot('e1', event);
    return snapshot(ref.id, null);
  });
  firestore.getDocs.mockImplementation(async (q) => {
    if (q.name === 'events') return docs([['e1', event]]);
    return docs([]);
  });
});

test('C2 TC1 an unreadable organiser profile does not stop the assigned events loading', async () => {
  const { events } = await reviewApi.list();

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ id: 'e1', name: 'Partner Summit', editable: true });
  // The row falls back to the organiser id (assignedRow), never a blank or an error.
  expect(events[0].organiser_name).toBeNull();
});

test('C3 TC1 an unreadable organiser profile does not stop the event detail loading', async () => {
  const detail = await reviewApi.detail('e1');

  expect(detail.event).toMatchObject({ id: 'e1', name: 'Partner Summit' });
  expect(detail.organiser).toBeNull();
});

test('C2 TC2 a readable organiser profile still supplies the name', async () => {
  firestore.getDoc.mockImplementation(async (ref) => {
    if (ref.path === 'users/c1') return snapshot('c1', { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true });
    if (ref.path === 'users/org1') return snapshot('org1', { name: 'Nadia Organiser', email: 'nadia@smu.edu.sg' });
    return snapshot(ref.id, null);
  });

  const { events } = await reviewApi.list();

  expect(events[0].organiser_name).toBe('Nadia Organiser');
});

test('C2 TC3 other failures are still reported, and say which step failed', async () => {
  firestore.getDocs.mockImplementation(async (q) => {
    if (q.name === 'events') throw permissionDenied();
    return docs([]);
  });

  await expect(reviewApi.list()).rejects.toThrow('assigned events: Missing or insufficient permissions.');
});

// K3 / SCRUM-184 — what leadReassign actually writes. A fake transaction records the
// writes so the persisted shape can be checked: the one-coordinator event update
// (AC3), the previous assignment kept with its original time (AC3), the history entry
// naming the Lead (AC3), and one notification for each of the three people (AC5).
describe('K3 SCRUM-184 the Lead reassigns an event', () => {
  const stored = {
    'users/lead1': { role: 'EVENT_COORDINATOR_LEAD', name: 'Lena Lead' },
    'users/c1': { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true },
    'users/c2': { role: 'EVENT_COORDINATOR', name: 'Alex Coordinator', is_active: true },
    'events/e2': { organiser_id: 'org1', coordinator_id: 'c1', assigned_at: 'T0', name: 'Workshop', status: 'UNDER_REVIEW' },
    'coordinator_assignments/e2_c1': { event_id: 'e2', coordinator_id: 'c1', assigned_at: 'T0', ended_at: null }
  };
  let writes;

  beforeEach(() => {
    auth.currentUser = { uid: 'lead1' };
    writes = { updates: [], sets: [] };
    firestore.runTransaction.mockImplementation(async (db, work) => work({
      get: async (ref) => snapshot(ref.id, stored[ref.path]),
      update: (ref, data) => writes.updates.push([ref.path, data]),
      set: (ref, data) => writes.sets.push([ref.path, data])
    }));
  });

  const setsAt = (prefix) => writes.sets.filter(([path]) => path.startsWith(prefix)).map(([, data]) => data);

  test('K3 TC1 AC3 the event ends up with exactly the one new coordinator', async () => {
    await reviewApi.leadReassign('e2', 'c2');

    expect(writes.updates).toEqual([['events/e2', { coordinator_id: 'c2', assigned_at: 'TS', updated_at: 'TS' }]]);
  });

  test('K3 TC2 AC3 the previous assignment keeps its original time, the reassignment time and the Lead', async () => {
    await reviewApi.leadReassign('e2', 'c2');

    const previous = writes.sets.find(([path]) => path === 'coordinator_assignments/e2_c1')[1];
    expect(previous).toMatchObject({ coordinator_id: 'c1', assigned_at: 'T0', ended_at: 'TS', reassigned_by: 'lead1' });
    const next = writes.sets.find(([path]) => path === 'coordinator_assignments/e2_c2')[1];
    expect(next).toMatchObject({ coordinator_id: 'c2', assigned_at: 'TS', ended_at: null });
  });

  test('K3 TC3 AC3 the history entry records who, from whom, to whom and both times', async () => {
    await reviewApi.leadReassign('e2', 'c2');

    expect(setsAt('event_history')[0]).toMatchObject({
      event_id: 'e2', action_type: 'COORDINATOR_REASSIGNED', actor_id: 'lead1',
      old_value: 'c1', new_value: 'c2', previous_assigned_at: 'T0', created_at: 'TS'
    });
  });

  test('K3 TC4 AC5 the outgoing coordinator, the incoming coordinator and the organiser are each told, in their own words', async () => {
    await reviewApi.leadReassign('e2', 'c2');

    const notices = setsAt('notifications');
    expect(notices.map((item) => item.user_id)).toEqual(['c1', 'c2', 'org1']);
    expect(notices.every((item) => item.type === 'COORDINATOR_REASSIGNED' && item.event_id === 'e2')).toBe(true);
    expect(notices[0].message).toMatch(/no longer/i);
    expect(notices[1].message).toMatch(/assigned to you/i);
    expect(notices[2].message).toMatch(/Alex Coordinator/);
  });

  test('K3 TC5 AC2 reassigning to the coordinator who already holds the event is refused and writes nothing', async () => {
    await expect(reviewApi.leadReassign('e2', 'c1')).rejects.toThrow('cannot be reassigned');

    expect(writes.updates).toEqual([]);
    expect(writes.sets).toEqual([]);
  });

  test('K3 TC6 AC1 only the Lead may reassign: a coordinator calling it is refused and writes nothing', async () => {
    auth.currentUser = { uid: 'c1' };

    await expect(reviewApi.leadReassign('e2', 'c2')).rejects.toThrow('cannot be reassigned');

    expect(writes.updates).toEqual([]);
    expect(writes.sets).toEqual([]);
  });

  test('K3 TC7 AC1 a finished event is refused and writes nothing', async () => {
    stored['events/e2'] = { ...stored['events/e2'], status: 'COMPLETED' };

    await expect(reviewApi.leadReassign('e2', 'c2')).rejects.toThrow('cannot be reassigned');

    expect(writes.sets).toEqual([]);
    stored['events/e2'] = { ...stored['events/e2'], status: 'UNDER_REVIEW' };
  });

  test('K3 TC8 (replaces C9 criterion 5) the adapter offers no coordinator-side reassign, only the Lead\'s', () => {
    expect(reviewApi.reassign).toBeUndefined();
    expect(typeof reviewApi.leadReassign).toBe('function');
  });
});
