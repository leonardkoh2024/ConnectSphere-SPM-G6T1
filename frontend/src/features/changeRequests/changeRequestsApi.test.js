// I1 / SCRUM-147 — what the browser reads and writes for a change request.
// TC-772 – TC-775 in docs/test-cases.md.

import { collection, doc, getDocs, query, serverTimestamp, writeBatch } from 'firebase/firestore';
import { loadChangeableEvents, loadMyChangeRequests, submitChangeRequest } from './changeRequestsApi';

jest.mock('../../lib/firebase', () => ({ auth: {}, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn(), getDoc: jest.fn(), getDocs: jest.fn(), query: jest.fn(),
  where: jest.fn(), serverTimestamp: jest.fn(), writeBatch: jest.fn()
}));

const snapshot = (rows) => ({ docs: rows.map(([id, data]) => ({ id, data: () => data })) });
const current = { name: 'Harbour Tech Forum', expected_attendance: 120, facilities: ['WIFI'] };
let batch;
let ids;

// CRA resets mocks before each test, so the implementations are set here.
beforeEach(() => {
  ids = 0;
  collection.mockImplementation((_db, name) => ({ name }));
  query.mockImplementation((ref) => ref);
  serverTimestamp.mockReturnValue('SERVER_TIME');
  // doc(collection(...)) makes a fresh id per collection, as Firestore would.
  doc.mockImplementation((ref) => ({ id: `${ref.name}-${(ids += 1)}`, collection: ref.name }));
  batch = { set: jest.fn(), commit: jest.fn().mockResolvedValue() };
  writeBatch.mockReturnValue(batch);
});

const written = (name) => batch.set.mock.calls.filter(([ref]) => ref.collection === name).map(([, data]) => data);

test('TC-772 AC1 only the organiser\'s events from Submitted to Confirmed are offered, soonest first', async () => {
  getDocs.mockResolvedValue(snapshot([
    ['d', { status: 'DRAFT', event_date: '2026-11-01' }],
    ['b', { status: 'CONFIRMED', event_date: '2026-12-01' }],
    ['a', { status: 'SUBMITTED', event_date: '2026-11-15' }],
    ['x', { status: 'CANCELLED', event_date: '2026-11-02' }]
  ]));
  expect((await loadChangeableEvents('o1')).map((event) => event.id)).toEqual(['a', 'b']);
});

test('TC-773 AC2 AC4 a request is written Pending with its changes and reason, a history row, and a notice to the coordinator, in one commit', async () => {
  const event = { id: 'e1', name: 'Harbour Tech Forum', reference_no: 'EVT-1', status: 'PLANNING', coordinator_id: 'c1' };
  const saved = await submitChangeRequest({ userId: 'o1', event, current, proposed: { expected_attendance: '150' }, fields: ['expected_attendance'], reason: '  More sign-ups. ' });

  const [request] = written('change_requests');
  expect(request).toEqual({
    change_request_id: 'change_requests-1', event_id: 'e1', event_name: 'Harbour Tech Forum', reference_no: 'EVT-1',
    organiser_id: 'o1', coordinator_id: 'c1', event_status: 'PLANNING',
    changes: { expected_attendance: { old_value: 120, new_value: 150 } },
    reason: 'More sign-ups.', status: 'PENDING', created_at: 'SERVER_TIME'
  });
  expect(written('event_history')[0]).toMatchObject({ event_id: 'e1', actor_id: 'o1', action_type: 'CHANGE_REQUESTED', change_request_id: 'change_requests-1' });
  expect(written('notifications')[0]).toMatchObject({
    user_id: 'c1', event_id: 'e1', type: 'CHANGE_REQUESTED', change_request_id: 'change_requests-1', is_read: false,
    message: 'Harbour Tech Forum has a change request waiting for your decision: expected attendance.'
  });
  expect(batch.commit).toHaveBeenCalledTimes(1);
  expect(saved).toMatchObject({ id: 'change_requests-1', status: 'PENDING', notified: true });
});

test('TC-774 with no coordinator assigned yet the request is still saved, and nobody is told', async () => {
  const event = { id: 'e2', name: 'Waitlist Demo Workshop', status: 'SUBMITTED', coordinator_id: null };
  const saved = await submitChangeRequest({ userId: 'o1', event, current, proposed: { name: 'Waitlist Workshop' }, fields: ['name'], reason: 'Shorter name.' });

  expect(written('change_requests')[0]).toMatchObject({ coordinator_id: null, status: 'PENDING' });
  expect(written('notifications')).toEqual([]);
  expect(saved.notified).toBe(false);
});

test('TC-775 AC3 every request the organiser has raised is listed, newest first', async () => {
  const at = (iso) => ({ toDate: () => new Date(iso) });
  getDocs.mockResolvedValue(snapshot([
    ['r1', { status: 'PENDING', created_at: at('2026-10-20T01:00:00.000Z') }],
    ['r2', { status: 'PENDING', created_at: at('2026-10-27T01:00:00.000Z') }]
  ]));
  const mine = await loadMyChangeRequests('o1');
  expect(mine.map((item) => item.id)).toEqual(['r2', 'r1']);
  expect(mine[0].created_at).toBe('2026-10-27T01:00:00.000Z');
  expect(collection).toHaveBeenCalledWith({}, 'change_requests');
});
