// C2 / C3 — the organiser's name (C2 AC2) and contact (C3 AC2) are looked up from
// the organiser's user profile. A coordinator is not always allowed to read that
// profile, and one unreadable profile must never blank the whole screen: the list
// and the event detail still load, with the organiser shown by the fallback.
import { reviewApi } from './reviewApi';
import * as firestore from 'firebase/firestore';

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
