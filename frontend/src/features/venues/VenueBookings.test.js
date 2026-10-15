// J6 / SCRUM-155 AC2 — TC-324, TC-339, TC-340 in docs/test-cases.md. Arriving from a booking's
// outcome notification opens that booking, with its date, time and status.

import { render, screen } from '@testing-library/react';
import VenueBookings from './VenueBookings';
import { loadVenueBookings, loadVenueCatalogue } from './venuesApi';
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
