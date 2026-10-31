// F15 / SCRUM-180 — Place a tentative hold on a venue. FUNCTIONAL,
// the Venue Staff booking requests
// screen, the availability calendar and the coordinator's booking list.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { approveVenueBooking, holdVenueBooking, loadVenueBookingQueue, loadVenueBookings, loadVenueCatalogue } from './venuesApi';
import { reviewApi } from '../events/reviewApi';
import { ROLES } from '../../domain/roles';
import VenueBookingQueue from './VenueBookingQueue';
import VenueBookings from './VenueBookings';
import VenueCalendar from './VenueCalendar';

jest.mock('./venuesApi', () => ({
  approveVenueBooking: jest.fn(),
  holdVenueBooking: jest.fn(),
  loadVenueBookingQueue: jest.fn(),
  loadVenueBookings: jest.fn(),
  loadVenueCatalogue: jest.fn(),
  withdrawVenueBooking: jest.fn(),
  requestVenueBooking: jest.fn()
}));
jest.mock('../events/reviewApi', () => ({ reviewApi: { list: jest.fn(), detail: jest.fn() } }));

const sgIso = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();
const request = (fields) => ({
  booking_id: 'BK-1', event_name: 'Annual Conference', venue_name: 'Hall A', venue_id: 'VEN-1', event_id: 'EVT-1',
  status: 'PENDING', start_datetime: sgIso('2026-11-20', '09:00'), end_datetime: sgIso('2026-11-20', '17:00'),
  submitted_at: sgIso('2026-10-14', '09:00'), expected_attendance: 100, requested_layout_id: 'THEATRE',
  suitability_acknowledgement: null, ...fields
});

beforeEach(() => {
  holdVenueBooking.mockReset().mockResolvedValue({ booking_id: 'BK-1', status: 'HELD', hold_expires_at: sgIso('2026-10-22', '10:00') });
  approveVenueBooking.mockReset().mockResolvedValue({ booking_id: 'BK-1', status: 'APPROVED' });
});

describe('F15 / SCRUM-180 functional — Venue Staff hold, convert and see holds lapse', () => {
  test('TC-1115 a pending request can be put on hold, and Venue Staff are told until when', async () => {
    loadVenueBookingQueue.mockReset()
      .mockResolvedValueOnce([request()])
      .mockResolvedValue([request({ status: 'HELD', hold_expires_at: sgIso('2026-10-22', '10:00') })]);
    const onNotice = jest.fn();
    render(<VenueBookingQueue user={{ uid: 'STAFF-001' }} onNotice={onNotice} />);

    await userEvent.click(within(await screen.findByRole('article')).getByRole('button', { name: 'Place hold' }));

    await waitFor(() => expect(holdVenueBooking).toHaveBeenCalledWith({ user: { uid: 'STAFF-001' }, bookingId: 'BK-1' }));
    expect(onNotice).toHaveBeenCalledWith('Hall A held for Annual Conference until Thu 22 Oct 2026, 10:00.');
  });

  test('TC-1116 an active hold shows its expiry and offers conversion, not another hold', async () => {
    loadVenueBookingQueue.mockReset().mockResolvedValue([
      request({ status: 'HELD', hold_expires_at: new Date(Date.now() + 86400000).toISOString() })
    ]);
    render(<VenueBookingQueue user={{ uid: 'STAFF-001' }} />);

    const row = (await screen.findAllByRole('article'))[0];
    expect(within(row).getByText('Held')).toBeInTheDocument();
    expect(within(row).getByText(/^Held until /)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Place hold' })).not.toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: 'Convert to booking' }));
    await waitFor(() => expect(approveVenueBooking).toHaveBeenCalledWith({ user: { uid: 'STAFF-001' }, bookingId: 'BK-1' }));
  });

  test('TC-1117 a hold whose expiry has passed is shown as expired and offers nothing', async () => {
    loadVenueBookingQueue.mockReset().mockResolvedValue([
      request({ status: 'HELD', hold_expires_at: sgIso('2026-10-01', '10:00') })
    ]);
    render(<VenueBookingQueue user={{ uid: 'STAFF-001' }} />);

    const row = (await screen.findAllByRole('article'))[0];
    expect(within(row).getByText('Hold expired')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /convert to booking|place hold|approve/i })).not.toBeInTheDocument();
  });
});

describe('F15 / SCRUM-180 functional — holds elsewhere', () => {
  test('TC-1118 the availability calendar has its own Held key and filter, apart from booked, pending and blocked', () => {
    render(<VenueCalendar venues={[{ venue_id: 'VEN-1', name: 'Hall A', operating_hours: [] }]} bookings={[]} unavailability={[]}
      role={ROLES.COORDINATOR} today={new Date(2026, 9, 12, 8, 0)} />);

    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['Free', 'Booked', 'Held', 'Pending', 'Blocked', 'Closed']);
    expect(screen.getByRole('checkbox', { name: 'Held' })).toBeChecked();
  });

  test("TC-1119 the coordinator's booking list shows a held request and when the hold ends", async () => {
    loadVenueCatalogue.mockResolvedValue([{ venue_id: 'VEN-1', name: 'Hall A', max_capacity: 200 }]);
    reviewApi.list.mockResolvedValue({ events: [] });
    loadVenueBookings.mockResolvedValue([request({
      status: 'HELD', hold_expires_at: sgIso('2026-10-22', '10:00'), event_date: '2026-11-20', requested_at: sgIso('2026-10-14', '09:00')
    })]);
    render(<VenueBookings user={{ uid: 'COORD-001' }} />);

    await userEvent.click(await screen.findByRole('button', { name: /view details/i }));
    const row = screen.getByRole('article');
    expect(within(row).getByText('Hold expires')).toBeInTheDocument();
    expect(within(row).getByText('Thu 22 Oct 2026, 10:00')).toBeInTheDocument();
  });
});

describe('F15 / SCRUM-180 functional — holds have their own filter', () => {
  test('TC-1120 On hold lists only active holds; Decided leaves them out but keeps lapsed ones', async () => {
    const later = new Date(Date.now() + 86400000).toISOString();
    loadVenueBookingQueue.mockReset().mockResolvedValue([
      request({ booking_id: 'BK-P', event_name: 'Pending event' }),
      request({ booking_id: 'BK-H', event_name: 'Held event', status: 'HELD', hold_expires_at: later }),
      request({ booking_id: 'BK-L', event_name: 'Lapsed event', status: 'HELD', hold_expires_at: sgIso('2026-10-01', '10:00') }),
      request({ booking_id: 'BK-A', event_name: 'Approved event', status: 'APPROVED', decided_at: sgIso('2026-10-15', '09:00') })
    ]);
    render(<VenueBookingQueue user={{ uid: 'STAFF-001' }} />);
    const shown = () => screen.getAllByRole('heading', { level: 2 }).map((item) => item.textContent);
    const showField = await screen.findByRole('combobox', { name: 'Show' });

    // All requests: still waiting first — pending, then on hold — then decided.
    expect(shown()).toEqual(['Pending event', 'Held event', 'Lapsed event', 'Approved event']);

    await userEvent.selectOptions(showField, 'On hold');
    expect(shown()).toEqual(['Held event']);

    await userEvent.selectOptions(showField, 'Decided');
    expect(shown()).toEqual(['Lapsed event', 'Approved event']);
  });
});
