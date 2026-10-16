// J6 / SCRUM-155 AC2 — TC-324, TC-339, TC-340 in docs/test-cases.md. Arriving from a booking's
// outcome notification opens that booking, with its date, time and status.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VenueBookings from './VenueBookings';
import { loadVenueBookings, loadVenueCatalogue, withdrawVenueBooking } from './venuesApi';
import { reviewApi } from '../events/reviewApi';

jest.mock('./venuesApi', () => ({
  loadVenueBookings: jest.fn(),
  loadVenueCatalogue: jest.fn(),
  withdrawVenueBooking: jest.fn()
}));
jest.mock('../events/reviewApi', () => ({ reviewApi: { list: jest.fn(), detail: jest.fn() } }));

const booking = (id, changes = {}) => ({
  booking_id: id, event_id: 'e1', venue_id: 'VEN-1', event_name: 'Q4 Partner Summit',
  status: 'APPROVED', event_date: '2026-11-20', start_time: '10:00', end_time: '12:00',
  expected_attendance: 80, ...changes
});

beforeEach(() => {
  reviewApi.list.mockResolvedValue({ events: [] });
  loadVenueCatalogue.mockResolvedValue([{ venue_id: 'VEN-1', name: 'Harbour Hall', max_capacity: 120 }]);
  loadVenueBookings.mockResolvedValue([booking('VB-1'), booking('VB-2', { status: 'PENDING' })]);
});

test('TC-324 the booking named by the notification opens on arrival, and only that one', async () => {
  render(<VenueBookings user={{ uid: 'coord-1' }} focusBookingId="VB-1" />);

  const toggles = await screen.findAllByRole('button', { name: /details/ });
  expect(toggles.map((item) => item.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
  expect(screen.getByText('Time').nextSibling).toHaveTextContent('10:00–12:00');
  expect(screen.getByText('Date').nextSibling).toHaveTextContent('2026-11-20');
  expect(screen.getByText('Status').nextSibling).toHaveTextContent('APPROVED');
});

test('TC-339 with no booking named, or one that is not in the list, nothing opens by itself', async () => {
  const { unmount } = render(<VenueBookings user={{ uid: 'coord-1' }} />);
  let toggles = await screen.findAllByRole('button', { name: /details/ });
  expect(toggles.map((item) => item.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
  unmount();

  render(<VenueBookings user={{ uid: 'coord-1' }} focusBookingId="VB-GONE" />);
  toggles = await screen.findAllByRole('button', { name: /details/ });
  expect(toggles.map((item) => item.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
});

const spyOnScroll = () => {
  const scrolled = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this.id); };
  // jsdom has no scrollIntoView, so restoring means removing it again.
  return {
    scrolled,
    restore: () => {
      if (original) Element.prototype.scrollIntoView = original;
      else delete Element.prototype.scrollIntoView;
    }
  };
};

test('TC-340 the named booking is scrolled into view once the list has loaded', async () => {
  const spy = spyOnScroll();
  try {
    render(<VenueBookings user={{ uid: 'coord-1' }} focusBookingId="VB-2" />);
    await screen.findAllByRole('button', { name: /details/ });
    expect(spy.scrolled).toEqual(['venue-booking-VB-2']);
  } finally {
    spy.restore();
  }
});

// K5 / SCRUM-186 AC2 — the withdraw action is made on behalf of the signed-in coordinator,
// and when the adapter or server refuses it (the event is no longer theirs) the screen
// says so and leaves the booking as it was.
describe('K5 SCRUM-186 withdrawing a booking is a coordinator action on an assigned event', () => {
  const openWithdraw = async () => {
    render(<VenueBookings user={{ uid: 'coord-1' }} />);
    await userEvent.click(await screen.findByRole('button', { name: /details/ }));
    await userEvent.click(await screen.findByRole('button', { name: /withdraw request/i }));
  };

  beforeEach(() => {
    loadVenueBookings.mockResolvedValue([booking('VB-2', { status: 'PENDING' })]);
  });

  test('K5-FT4 AC2 withdrawing sends the signed-in coordinator along with the booking', async () => {
    withdrawVenueBooking.mockResolvedValue({ booking_id: 'VB-2', status: 'WITHDRAWN' });

    await openWithdraw();
    await userEvent.click(screen.getByRole('button', { name: /yes, withdraw/i }));

    expect(withdrawVenueBooking).toHaveBeenCalledWith({ user: { uid: 'coord-1' }, bookingId: 'VB-2' });
  });

  test('K5-FT5 AC2 a refused withdrawal is shown to the coordinator and the booking stays as it was', async () => {
    withdrawVenueBooking.mockRejectedValue(new Error('Only the current event coordinator may withdraw this booking.'));

    await openWithdraw();
    await userEvent.click(screen.getByRole('button', { name: /yes, withdraw/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Only the current event coordinator may withdraw this booking.');
    // The booking is untouched: still pending on screen, and the list was not reloaded as if it had changed.
    expect(screen.getAllByText('PENDING').length).toBeGreaterThan(0);
    expect(loadVenueBookings).toHaveBeenCalledTimes(1);
  });
});
