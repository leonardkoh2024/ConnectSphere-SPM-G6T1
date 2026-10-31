// J1 / SCRUM-150 AC3 — the badge's count follows the live list, so opening a
// notification (which marks it read) brings the count down.

import { act, renderHook, waitFor } from '@testing-library/react';
import useNotifications from './useNotifications';
import { markNotificationRead, watchNotifications } from './notificationsApi';

jest.mock('./notificationsApi', () => ({ markNotificationRead: jest.fn(), watchNotifications: jest.fn() }));

let deliver;
let fail;
const unsubscribe = jest.fn();

beforeEach(() => {
  watchNotifications.mockImplementation((userId, onChange, onError) => { deliver = onChange; fail = onError; return unsubscribe; });
  markNotificationRead.mockResolvedValue();
});

test('TC-2102 opening an unread notification marks it read and the unread count drops', async () => {
  const { result, unmount } = renderHook(() => useNotifications('u1'));
  expect(watchNotifications).toHaveBeenCalledWith('u1', expect.any(Function), expect.any(Function));

  act(() => deliver([{ id: 'n1', is_read: false }, { id: 'n2', is_read: false }, { id: 'n3', is_read: true }]));
  expect(result.current.unread).toBe(2);
  expect(result.current.loading).toBe(false);

  await act(() => result.current.markRead('n1'));
  expect(markNotificationRead).toHaveBeenCalledWith('n1');

  // Firestore hands the updated list straight back to the live subscription.
  act(() => deliver([{ id: 'n1', is_read: true }, { id: 'n2', is_read: false }, { id: 'n3', is_read: true }]));
  expect(result.current.unread).toBe(1);
  expect(result.current.notifications).toHaveLength(3);

  unmount();
  expect(unsubscribe).toHaveBeenCalled();
});

test('TC-2103 a failed load or a failed mark-read says so instead of failing silently', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const { result } = renderHook(() => useNotifications('u1'));

  act(() => fail(new Error('offline')));
  expect(result.current.error).toMatch(/could not load your notifications/i);

  markNotificationRead.mockRejectedValue(new Error('denied'));
  await act(() => result.current.markRead('n1'));
  await waitFor(() => expect(result.current.error).toMatch(/could not mark that notification as read/i));
  console.error.mockRestore();
});

test('TC-2104 [boundary] with nobody signed in there is no subscription and nothing unread', () => {
  const { result } = renderHook(() => useNotifications(null));
  expect(watchNotifications).not.toHaveBeenCalled();
  expect(result.current.unread).toBe(0);
  expect(result.current.notifications).toEqual([]);
});
