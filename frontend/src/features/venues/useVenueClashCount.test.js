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

test('F10 coordinator badge counts unique clashes from their venue bookings', async () => {
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

test('F10 Venue Staff badge refreshes assigned-venue clashes when the window regains focus', async () => {
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

test('roles without venue clash responsibilities do not query booking data', async () => {
  const { result } = renderHook(() => useVenueClashCount({ uid: 'ORG-1' }, ROLES.ORGANISER));
  await waitFor(() => expect(result.current.count).toBe(0));
  expect(loadVenueBookings).not.toHaveBeenCalled();
  expect(loadVenueBookingQueue).not.toHaveBeenCalled();
});
