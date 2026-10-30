// J6 / SCRUM-155 AC2. Arriving from a booking's
// outcome notification opens that booking, with its date, time and status.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VenueBookings from './VenueBookings';
import { loadVenueBookings, loadVenueCatalogue, prepareClashReplacement, withdrawVenueBooking } from './venuesApi';
import { reviewApi } from '../events/reviewApi';

jest.mock('./venuesApi', () => ({
  loadVenueBookings: jest.fn(),
  loadVenueCatalogue: jest.fn(),
  prepareClashReplacement: jest.fn(),
  releaseVenueBooking: jest.fn(),
  withdrawVenueBooking: jest.fn()
}));
jest.mock('../events/reviewApi', () => ({ reviewApi: { list: jest.fn(), detail: jest.fn() } }));

const booking = (id, changes = {}) => ({
  booking_id: id, event_id: 'e1', venue_id: 'VEN-1', event_name: 'Q4 Partner Summit',
  status: 'APPROVED', event_status: 'PLANNING', event_date: '2026-11-20', start_time: '10:00', end_time: '12:00',
  expected_attendance: 80, ...changes
});

beforeEach(() => {
  jest.clearAllMocks();
  reviewApi.list.mockResolvedValue({ events: [] });
  loadVenueCatalogue.mockResolvedValue([{ venue_id: 'VEN-1', name: 'Harbour Hall', max_capacity: 120 }]);
  loadVenueBookings.mockResolvedValue([booking('VB-1'), booking('VB-2', { status: 'PENDING' })]);
});

test('TC-2228 the booking named by the notification opens on arrival, and only that one', async () => {
  render(<VenueBookings user={{ uid: 'coord-1' }} focusBookingId="VB-1" />);

  const toggles = await screen.findAllByRole('button', { name: /details/ });
  expect(toggles.map((item) => item.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
  expect(screen.getByText('Time').nextSibling).toHaveTextContent('10:00–12:00');
  expect(screen.getByText('Date').nextSibling).toHaveTextContent('2026-11-20');
  expect(screen.getByText('Status').nextSibling).toHaveTextContent('APPROVED');
});

test('TC-2229 with no booking named, or one that is not in the list, nothing opens by itself', async () => {
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

test('TC-2230 the named booking is scrolled into view once the list has loaded', async () => {
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

  test('TC-2407 K5 AC2 withdrawing sends the signed-in coordinator along with the booking', async () => {
    withdrawVenueBooking.mockResolvedValue({ booking_id: 'VB-2', status: 'WITHDRAWN' });

    await openWithdraw();
    await userEvent.click(screen.getByRole('button', { name: /yes, withdraw/i }));

    expect(withdrawVenueBooking).toHaveBeenCalledWith({ user: { uid: 'coord-1' }, bookingId: 'VB-2' });
    // Let the reload and the dialog closing settle inside act.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('TC-2408 K5 AC2 a refused withdrawal is shown to the coordinator and the booking stays as it was', async () => {
    withdrawVenueBooking.mockRejectedValue(new Error('Only the current event coordinator may withdraw this booking.'));

    await openWithdraw();
    await userEvent.click(screen.getByRole('button', { name: /yes, withdraw/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Only the current event coordinator may withdraw this booking.');
    // The booking is untouched: still pending on screen, and the list was not reloaded as if it had changed.
    expect(screen.getAllByText('PENDING').length).toBeGreaterThan(0);
    expect(loadVenueBookings).toHaveBeenCalledTimes(1);
  });
});

// E8. The details name the Venue Staff member who manages the venue,
// or say it is not recorded.
test('TC-0821 the booking details name the venue\'s Venue Staff member, or say it is not recorded', async () => {
  loadVenueBookings.mockResolvedValue([
    booking('VB-1', { venue_staff_name: 'Priya Nair' }),
    booking('VB-2', { status: 'PENDING', venue_staff_name: null })
  ]);
  render(<VenueBookings user={{ uid: 'coord-1' }} focusBookingId="VB-1" />);

  await screen.findAllByRole('button', { name: /details/ });
  expect(screen.getByText('Venue Staff').nextSibling).toHaveTextContent('Priya Nair');

  await userEvent.click(screen.getAllByRole('button', { name: /details/ })[1]);
  expect(screen.getByText('Venue Staff').nextSibling).toHaveTextContent('Not recorded');
});

test('TC-1018 F10 clash gives the current coordinator a pre-filled alternative-venue path', async () => {
  const clash = {
    conflict_id: 'VEN-1--VB-1--VB-OTHER', booking_a_id: 'VB-1', booking_b_id: 'VB-OTHER',
    event_a_name: 'Q4 Partner Summit', event_b_name: 'Partner Briefing',
    overlap_start: '2026-11-20T11:30:00Z', overlap_end: '2026-11-20T12:00:00Z'
  };
  loadVenueBookings.mockResolvedValue([booking('VB-1', {
    booking_label: 'Main hall', requested_layout_id: 'THEATRE', required_facilities_snapshot: ['WIFI'], clashes: [clash]
  })]);
  prepareClashReplacement.mockResolvedValue({
    booking_id: 'VB-1', event_id: 'e1', replacement_needed: true,
    replacement_reason: 'Schedule clash with Partner Briefing.', replacement_source: 'CLASH'
  });
  reviewApi.detail.mockResolvedValue({ event: {
    id: 'e1', name: 'Q4 Partner Summit', status: 'PLANNING', expected_attendance: 80,
    event_date: '2026-11-20', start_time: '10:00', end_time: '12:00'
  } });
  const onFindReplacement = jest.fn();
  render(<VenueBookings user={{ uid: 'coord-1' }} onFindReplacement={onFindReplacement} />);

  expect(await screen.findByText('Clash - coordinator action required')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /details/i }));
  await userEvent.click(screen.getByRole('button', { name: /find alternative venue/i }));

  expect(prepareClashReplacement).toHaveBeenCalledWith({ user: { uid: 'coord-1' }, bookingId: 'VB-1', clash });
  await waitFor(() => expect(onFindReplacement).toHaveBeenCalledWith(expect.objectContaining({
      event_id: 'e1', replacement_for_booking_id: 'VB-1', excluded_venue_id: 'VEN-1',
      required_layout: 'THEATRE', facilities: ['WIFI']
    })));
});

test('TC-1044 F11 keeps the original booking link after the replacement event is reloaded', async () => {
  reviewApi.detail.mockResolvedValue({ event: {
    id: 'e1', name: 'Regional Partnership Forum', status: 'PLANNING', expected_attendance: 80,
    event_date: '2027-01-12', start_time: '10:00', end_time: '12:00'
  } });
  render(<VenueBookings
    user={{ uid: 'coord-1' }}
    event={{
      id: 'e1', event_id: 'e1', replacement_for_booking_id: 'booking-clash-manualtest',
      excluded_venue_id: 'VEN-OLD', required_layout: 'THEATRE', facilities: ['WIFI']
    }}
    venue={{ venue_id: 'VEN-1' }}
  />);

  expect(await screen.findByText(/will replace booking booking-clash-manualtest/i)).toBeInTheDocument();
});
