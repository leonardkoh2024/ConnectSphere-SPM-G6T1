import { act, renderHook, waitFor } from '@testing-library/react';
import { ROLES } from '../../domain/roles';
import { loadVenueBookingQueue, loadVenueBookings } from './venuesApi';
import useVenueClashCount from './useVenueClashCount';

jest.mock('./venuesApi', () => ({
  loadVenueBookingQueue: jest.fn(),
  loadVenueBookings: jest.fn()
}));

const clash = (id) => ({ conflict_id: id, status: 'ACTIVE' });

beforeEach(() => {
  jest.clearAllMocks();
  loadVenueBookings.mockResolvedValue([]);
  loadVenueBookingQueue.mockResolvedValue([]);
});

test('TC-1008 F10 coordinator badge counts unique clashes from their venue bookings', async () => {
  loadVenueBookings.mockResolvedValue([
    { booking_id: 'A', clashes: [clash('C1')] },
    { booking_id: 'B', clashes: [clash('C1'), clash('C2')] }
  ]);
  const { result, unmount } = renderHook(() => useVenueClashCount({ uid: 'COORD-1' }, ROLES.COORDINATOR));

  await waitFor(() => expect(result.current.count).toBe(2));
  expect(loadVenueBookings).toHaveBeenCalledWith({ user: { uid: 'COORD-1' } });
  expect(loadVenueBookingQueue).not.toHaveBeenCalled();
  unmount();
});

test('TC-1009 F10 Venue Staff badge refreshes assigned-venue clashes when the window regains focus', async () => {
  loadVenueBookingQueue.mockResolvedValueOnce([]).mockResolvedValueOnce([
    { booking_id: 'A', clashes: [clash('C1')] }
  ]);
  const { result, unmount } = renderHook(() => useVenueClashCount({ uid: 'STAFF-1' }, ROLES.VENUE_STAFF));
  await waitFor(() => expect(loadVenueBookingQueue).toHaveBeenCalledTimes(1));

  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(result.current.count).toBe(1));
  expect(loadVenueBookingQueue).toHaveBeenCalledTimes(2);
  unmount();
});

test('TC-1010 [failure] a failed read leaves the badge as it was and is logged, never thrown into the workspace', async () => {
  const error = new Error('Missing or insufficient permissions.');
  const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
  loadVenueBookings.mockRejectedValue(error);
  try {
    const { result, unmount } = renderHook(() => useVenueClashCount({ uid: 'COORD-1' }, ROLES.COORDINATOR));
    await waitFor(() => expect(logged).toHaveBeenCalledWith('Could not refresh venue clash count:', error));
    expect(result.current.count).toBe(0);
    unmount();
  } finally {
    logged.mockRestore();
  }
});

test('TC-1011 [boundary] signed out, nothing is read and the count is zero', async () => {
  const { result } = renderHook(() => useVenueClashCount(null, ROLES.COORDINATOR));
  await act(async () => { await result.current.refresh(); });
  expect(result.current.count).toBe(0);
  expect(loadVenueBookings).not.toHaveBeenCalled();
});

test('TC-1012 [normal] the loader gets a stable user whose token comes from the latest signed-in user object', async () => {
  const first = { uid: 'COORD-1', getIdToken: jest.fn().mockResolvedValue('first-token') };
  const second = { uid: 'COORD-1', getIdToken: jest.fn().mockResolvedValue('second-token') };
  const { rerender, unmount } = renderHook(({ user }) => useVenueClashCount(user, ROLES.COORDINATOR), { initialProps: { user: first } });
  await waitFor(() => expect(loadVenueBookings).toHaveBeenCalledTimes(1));
  rerender({ user: second });
  const passed = loadVenueBookings.mock.calls[0][0].user;
  expect(passed.uid).toBe('COORD-1');
  await expect(passed.getIdToken(true)).resolves.toBe('second-token');
  expect(second.getIdToken).toHaveBeenCalledWith(true);
  expect(first.getIdToken).not.toHaveBeenCalled();
  // The same user id does not trigger a second read on re-render.
  expect(loadVenueBookings).toHaveBeenCalledTimes(1);
  unmount();
});

test('TC-1013 [normal] a screen can set the badge straight from the bookings it already holds', async () => {
  const { result, unmount } = renderHook(() => useVenueClashCount({ uid: 'STAFF-1' }, ROLES.VENUE_STAFF));
  await waitFor(() => expect(loadVenueBookingQueue).toHaveBeenCalledTimes(1));
  act(() => result.current.setFromBookings([{ clashes: [clash('C1'), { conflict_id: 'C2', status: 'RESOLVED' }] }]));
  expect(result.current.count).toBe(1);
  unmount();
});

test('TC-1014 roles without venue clash responsibilities do not query booking data', async () => {
  const { result } = renderHook(() => useVenueClashCount({ uid: 'ORG-1' }, ROLES.ORGANISER));
  await waitFor(() => expect(result.current.count).toBe(0));
  expect(loadVenueBookings).not.toHaveBeenCalled();
  expect(loadVenueBookingQueue).not.toHaveBeenCalled();
});
