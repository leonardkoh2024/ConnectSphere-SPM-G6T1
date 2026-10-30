// J1 / SCRUM-150 — what the inbox asks Firestore for and what it writes.
// AC2: only the signed-in user's notifications are requested. AC3: opening one
// writes the read marker and nothing else.

import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { eventsFor, markNotificationRead, watchNotifications } from './notificationsApi';

jest.mock('../../lib/firebase', () => ({ db: 'db' }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn(), getDoc: jest.fn(), onSnapshot: jest.fn(), query: jest.fn(),
  serverTimestamp: jest.fn(), updateDoc: jest.fn(), where: jest.fn()
}));

const ts = (iso) => ({ toDate: () => new Date(iso) });
const snap = (id, data) => ({ id, data: () => data });

// CRA resets mocks before each test, so implementations are set here.
beforeEach(() => {
  collection.mockImplementation((_db, name) => name);
  where.mockImplementation((field, op, value) => `${field} ${op} ${value}`);
  query.mockImplementation((...parts) => parts);
  doc.mockImplementation((_db, name, id) => `${name}/${id}`);
  serverTimestamp.mockReturnValue('SERVER_TIME');
});

test('TC-2099 the inbox asks only for the signed-in user\'s notifications, newest first', () => {
  const onChange = jest.fn();
  watchNotifications('u1', onChange, jest.fn());

  expect(query).toHaveBeenCalledWith('notifications', 'user_id == u1');
  const [, deliver] = onSnapshot.mock.calls[0];
  deliver({ docs: [
    snap('old', { user_id: 'u1', message: 'Older', created_at: ts('2026-10-01T09:00:00Z'), read_at: null }),
    snap('new', { user_id: 'u1', message: 'Newer', created_at: ts('2026-10-07T09:00:00Z'), read_at: null })
  ] });

  const [list] = onChange.mock.calls[0];
  expect(list.map((item) => item.id)).toEqual(['new', 'old']);
  expect(list[0].created_at).toBe('2026-10-07T09:00:00.000Z');
});

test('TC-2100 marking a notification read writes only the read marker', async () => {
  updateDoc.mockResolvedValue();
  await markNotificationRead('n1');

  expect(updateDoc).toHaveBeenCalledWith('notifications/n1', { is_read: true, read_at: 'SERVER_TIME' });
});

test('TC-2101 an event the user can no longer read comes back empty, not as an error', async () => {
  getDoc.mockImplementation(async (ref) => {
    if (ref === 'events/denied') throw new Error('Missing or insufficient permissions.');
    if (ref === 'events/gone') return { exists: () => false };
    return { id: 'e1', exists: () => true, data: () => ({ name: 'Partner Summit' }) };
  });

  await expect(eventsFor(['e1', 'denied', 'gone', 'e1', null])).resolves.toEqual({
    e1: { id: 'e1', name: 'Partner Summit' }, denied: null, gone: null
  });
  expect(getDoc).toHaveBeenCalledTimes(3);
});

// J4 / SCRUM-153. Venue Staff are told about
// events they may not read; a refused read is not the same as a deleted event.
test('TC-2159 an event the rules refuse comes back as not shared (false), a missing one as gone (null)', async () => {
  getDoc.mockImplementation(async (ref) => {
    if (ref === 'events/refused') throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    if (ref === 'events/gone') return { exists: () => false };
    return { id: 'e1', exists: () => true, data: () => ({ name: 'Partner Summit' }) };
  });

  await expect(eventsFor(['e1', 'refused', 'gone'])).resolves.toEqual({
    e1: { id: 'e1', name: 'Partner Summit' }, refused: false, gone: null
  });
});
