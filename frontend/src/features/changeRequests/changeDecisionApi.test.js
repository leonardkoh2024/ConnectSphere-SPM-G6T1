// I2 / SCRUM-148 — the coordinator's reads and writes for a change request.

import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { auth } from '../../lib/firebase';
import { reviewApi } from '../events/reviewApi';
import { acceptChangeRequest, declineChangeRequest, loadAssignedChangeRequests, loadChangeReview } from './changeDecisionApi';

jest.mock('../../lib/firebase', () => ({ auth: { currentUser: null }, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn(), getDocs: jest.fn(), query: jest.fn(), where: jest.fn(),
  serverTimestamp: jest.fn(), writeBatch: jest.fn()
}));
jest.mock('../events/reviewApi', () => ({
  reviewApi: { detail: jest.fn(), arrangementImpact: jest.fn(), saveEventEdit: jest.fn() }
}));

const snapshot = (rows) => ({ docs: rows.map(([id, data]) => ({ id, data: () => data })) });
const at = (iso) => ({ toDate: () => new Date(iso) });
const REQUEST = {
  id: 'r1', event_id: 'e1', event_name: 'Harbour Tech Forum', reference_no: 'EVT-1', organiser_id: 'o1', status: 'PENDING',
  changes: { expected_attendance: { old_value: 120, new_value: 150 }, facilities: { old_value: ['WIFI'], new_value: ['STAGE', 'WIFI'] } }
};
let batch;
let ids;

// CRA resets mocks before each test, so the implementations are set here.
beforeEach(() => {
  ids = 0;
  auth.currentUser = { uid: 'c1' };
  collection.mockImplementation((_db, name) => ({ name }));
  query.mockImplementation((ref, ...clauses) => ({ ...ref, clauses }));
  where.mockImplementation((field, op, value) => ({ field, op, value }));
  serverTimestamp.mockReturnValue('SERVER_TIME');
  doc.mockImplementation((ref, name, id) => (name ? { collection: name, id } : { collection: ref.name, id: `${ref.name}-${(ids += 1)}` }));
  batch = { set: jest.fn(), update: jest.fn(), commit: jest.fn().mockResolvedValue() };
  writeBatch.mockReturnValue(batch);
});

describe('loadAssignedChangeRequests', () => {
  test('TC-1881 [normal] AC1 only requests on events the coordinator holds, between Submitted and Confirmed, Pending first then newest', async () => {
    getDocs.mockImplementation((q) => {
      if (q.name === 'events') {
        return Promise.resolve(snapshot([
          ['e1', { status: 'PLANNING' }], ['e2', { status: 'CONFIRMED' }], ['e3', { status: 'CANCELLED' }]
        ]));
      }
      const eventId = q.clauses[0].value;
      return Promise.resolve(snapshot(eventId === 'e1'
        ? [['r-old', { status: 'DECLINED', created_at: at('2026-10-25T00:00:00.000Z'), decided_at: at('2026-10-26T00:00:00.000Z') }],
          ['r-pending', { status: 'PENDING', created_at: at('2026-10-20T00:00:00.000Z') }]]
        : [['r-new', { status: 'ACCEPTED', created_at: '2026-10-28T00:00:00.000Z', decided_at: null }]]));
    });

    const found = await loadAssignedChangeRequests('c1');

    expect(where).toHaveBeenCalledWith('coordinator_id', '==', 'c1');
    expect(getDocs).toHaveBeenCalledTimes(3);
    expect(found.map((item) => item.id)).toEqual(['r-pending', 'r-new', 'r-old']);
    expect(found[2]).toMatchObject({ created_at: '2026-10-25T00:00:00.000Z', decided_at: '2026-10-26T00:00:00.000Z' });
    expect(found[1]).toMatchObject({ created_at: '2026-10-28T00:00:00.000Z', decided_at: null });
  });

  test('TC-1882 [boundary] requests with no timestamp yet sort after dated ones, and no held event means none', async () => {
    getDocs.mockImplementation((q) => Promise.resolve(q.name === 'events'
      ? snapshot([['e1', { status: 'SUBMITTED' }]])
      : snapshot([['r-undated', { status: 'PENDING' }], ['r-dated', { status: 'PENDING', created_at: '2026-10-01T00:00:00.000Z' }], ['r-undated-2', { status: 'PENDING' }]])));
    const order = (await loadAssignedChangeRequests('c1')).map((item) => item.id);
    expect(order[0]).toBe('r-dated');
    expect(order.slice(1).sort()).toEqual(['r-undated', 'r-undated-2']);

    getDocs.mockResolvedValue(snapshot([]));
    expect(await loadAssignedChangeRequests('c1')).toEqual([]);
  });

  test('TC-1883 [failure] a read the rules refuse is passed on to the screen', async () => {
    getDocs.mockRejectedValue(new Error('permission-denied'));
    await expect(loadAssignedChangeRequests('c1')).rejects.toThrow('permission-denied');
  });
});

describe('loadChangeReview', () => {
  test('TC-1884 [normal] AC1 the event, its organiser, what it holds and its current values are read together', async () => {
    const event = { id: 'e1', name: 'Harbour Tech Forum', expected_attendance: 120, preferred_location: 'CENTRAL', facilities: ['WIFI', 'AIR_CONDITIONING'], accessibility: [] };
    reviewApi.detail.mockResolvedValue({ event, organiser: { name: 'Nadia' } });
    reviewApi.arrangementImpact.mockResolvedValue({ venueBookings: [], registrationsCount: 3 });

    const review = await loadChangeReview(REQUEST);

    expect(reviewApi.detail).toHaveBeenCalledWith('e1');
    expect(reviewApi.arrangementImpact).toHaveBeenCalledWith('e1');
    expect(review.organiser).toEqual({ name: 'Nadia' });
    expect(review.impact.registrationsCount).toBe(3);
    expect(review.current).toMatchObject({ expected_attendance: 120, preferred_location: 'CENTRAL', facilities: ['AIR_CONDITIONING', 'WIFI'] });
  });
});

describe('acceptChangeRequest', () => {
  const review = {
    event: { id: 'e1', name: 'Harbour Tech Forum', expected_attendance: 120, facilities: ['WIFI'], accessibility: [] },
    organiser: { name: 'Nadia', email: 'n@example.com' },
    impact: { venueBookings: [] }
  };

  test('TC-1885 [normal] AC3 the new values go in through the coordinator edit, with the request closed in the same save', async () => {
    reviewApi.saveEventEdit.mockResolvedValue({ ok: true });
    const result = await acceptChangeRequest({ request: REQUEST, review, note: 'Room for more.' });

    expect(result).toEqual({ ok: true });
    const [call] = reviewApi.saveEventEdit.mock.calls[0];
    expect(call).toMatchObject({
      eventId: 'e1', before: review.event, organiser: review.organiser, impact: review.impact, acknowledged: true,
      changeRequest: { id: 'r1', reason: 'Room for more.' }
    });
    expect(call.values).toMatchObject({ expected_attendance: 150, facilities: ['STAGE', 'WIFI'], facilities_required: true, contact_name: 'Nadia' });
  });

  test('TC-1886 [boundary] accepting with no note sends an empty note', async () => {
    reviewApi.saveEventEdit.mockResolvedValue({ ok: true });
    await acceptChangeRequest({ request: REQUEST, review });
    expect(reviewApi.saveEventEdit.mock.calls[0][0].changeRequest).toEqual({ id: 'r1', reason: '' });
  });

  test('TC-1887 [conflict] arrangements that moved since the review are refused by the save, and the refusal is passed on', async () => {
    reviewApi.saveEventEdit.mockRejectedValue(new Error('The existing arrangements changed. Review them again.'));
    await expect(acceptChangeRequest({ request: REQUEST, review })).rejects.toThrow(/arrangements changed/);
  });
});

describe('declineChangeRequest', () => {
  test('TC-1888 [normal] AC2 AC4 the request, a history row and the organiser\'s notice are written in one commit', async () => {
    const declined = await declineChangeRequest({ request: REQUEST, reason: '  Venue is full.  ' });

    expect(batch.update).toHaveBeenCalledWith({ collection: 'change_requests', id: 'r1' }, {
      status: 'DECLINED', decided_by: 'c1', decided_at: 'SERVER_TIME', decision_reason: 'Venue is full.', decision_history_id: 'event_history-1'
    });
    const [[historyRef, history], [noticeRef, notice]] = batch.set.mock.calls;
    expect(historyRef.collection).toBe('event_history');
    expect(history).toMatchObject({ event_id: 'e1', actor_id: 'c1', action_type: 'CHANGE_REQUEST_DECLINED', description: 'Venue is full.', change_request_id: 'r1' });
    expect(noticeRef.collection).toBe('notifications');
    expect(notice).toMatchObject({
      user_id: 'o1', event_id: 'e1', type: 'CHANGE_REQUEST_DECLINED', is_read: false, change_request_id: 'r1',
      message: 'Harbour Tech Forum: your change request was declined — Venue is full.'
    });
    expect(batch.commit).toHaveBeenCalledTimes(1);
    expect(declined).toMatchObject({ id: 'r1', status: 'DECLINED', decision_reason: 'Venue is full.', decided_by: 'c1' });
  });

  test('TC-1889 [boundary] a request with no event name is named by its reference in the notice', async () => {
    await declineChangeRequest({ request: { ...REQUEST, event_name: '' }, reason: 'No.' });
    expect(batch.set.mock.calls[1][1].message).toBe('EVT-1: your change request was declined — No.');
  });

  test.each([
    ['a blank reason', { reason: '   ' }, 'Give a reason for declining the change.'],
    ['no signed-in user', { reason: 'No.', signedOut: true }, 'Please sign in again.']
  ])('TC-1890 [failure] %s writes nothing', async (_name, { reason, signedOut }, message) => {
    if (signedOut) auth.currentUser = null;
    await expect(declineChangeRequest({ request: REQUEST, reason })).rejects.toThrow(message);
    expect(writeBatch).not.toHaveBeenCalled();
  });

  test('TC-1891 [failure] a commit the rules refuse is passed on', async () => {
    batch.commit.mockRejectedValue(new Error('permission-denied'));
    await expect(declineChangeRequest({ request: REQUEST, reason: 'No.' })).rejects.toThrow('permission-denied');
  });
});
