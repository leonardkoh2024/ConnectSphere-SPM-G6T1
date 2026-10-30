// F12 / SCRUM-177 — Book more than one venue for an event. FUNCTIONAL,
// the coordinator's booking
// form and their list of requests, driven the way a coordinator drives them.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadVenueBookings, loadVenueCatalogue, requestVenueBooking } from './venuesApi';
import { reviewApi } from '../events/reviewApi';
import VenueBookingRequest from './VenueBookingRequest';
import VenueBookings from './VenueBookings';

jest.mock('./venuesApi', () => ({
  requestVenueBooking: jest.fn(),
  loadVenueCatalogue: jest.fn(),
  loadVenueBookings: jest.fn(),
  withdrawVenueBooking: jest.fn()
}));
jest.mock('../events/reviewApi', () => ({ reviewApi: { list: jest.fn(), detail: jest.fn() } }));

const user = { uid: 'coordinator-7' };
const seminarRoom = {
  venue_id: 'VEN-SEM', name: 'Seminar Room', max_capacity: 60,
  facilities: ['WIFI'], accessibility: [], layouts: ['CLASSROOM', 'BOARDROOM']
};
const conference = {
  event_id: 'EVT-1', name: 'Annual Conference', event_date: '2026-11-20', start_time: '09:00', end_time: '17:00',
  expected_attendance: 300, status: 'PLANNING', required_layout: 'THEATRE', facilities: ['WIFI'], accessibility: []
};

const labelField = () => screen.getByRole('textbox', { name: /booking label/i });
const attendanceField = () => screen.getByRole('spinbutton', { name: /expected attendance for this venue/i });
const layoutField = () => screen.getByRole('combobox', { name: /layout for this venue/i });
const submitButton = () => screen.getByRole('button', { name: /request this venue/i });
const retype = async (field, value) => {
  await userEvent.clear(field);
  if (value) await userEvent.type(field, value);
};

beforeEach(() => {
  requestVenueBooking.mockReset();
  requestVenueBooking.mockResolvedValue({ booking_id: 'BK-2', status: 'PENDING' });
});

describe('F12 / SCRUM-177 functional — the booking form asks for this booking’s own details', () => {
  test('TC-1069 label, attendance and layout start from the venue and event, and what the coordinator enters is sent', async () => {
    render(<VenueBookingRequest venue={seminarRoom} event={conference} user={user} />);

    expect(labelField()).toHaveValue('Seminar Room');
    expect(attendanceField()).toHaveValue(300);
    expect(layoutField()).toHaveValue('THEATRE');

    await retype(labelField(), 'Breakout 1');
    await retype(attendanceField(), '50');
    await userEvent.selectOptions(layoutField(), 'CLASSROOM');
    await userEvent.click(submitButton());

    await waitFor(() => expect(requestVenueBooking).toHaveBeenCalledTimes(1));
    expect(requestVenueBooking.mock.calls[0][0]).toMatchObject({
      event_id: 'EVT-1',
      venue_id: 'VEN-SEM',
      booking_label: 'Breakout 1',
      expected_attendance: 50,
      required_layout: 'CLASSROOM'
    });
  });

  test("TC-1070 an attendance above the event's is named and cannot be sent", async () => {
    render(<VenueBookingRequest venue={{ ...seminarRoom, max_capacity: 500, layouts: ['THEATRE'] }} event={conference} user={user} />);
    expect(submitButton()).toBeEnabled();

    await retype(attendanceField(), '301');

    expect(screen.getByText("Expected attendance cannot be more than the event's 300.")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await retype(attendanceField(), '0');
    expect(screen.getByText('Expected attendance must be a whole number greater than zero.')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await userEvent.click(submitButton());
    expect(requestVenueBooking).not.toHaveBeenCalled();
  });

  test("TC-1071 the room is judged on this booking's attendance and layout, not the whole event's", async () => {
    render(<VenueBookingRequest venue={seminarRoom} event={conference} user={user} />);

    // 300 people do not fit a 60-seat room.
    expect(screen.getByRole('alert')).toHaveTextContent(/capacity/i);
    expect(submitButton()).toBeDisabled();

    await retype(attendanceField(), '50');
    await userEvent.selectOptions(layoutField(), 'CLASSROOM');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('50 pax')).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  test('TC-1072 a blank label is named and cannot be sent', async () => {
    render(<VenueBookingRequest venue={seminarRoom} event={{ ...conference, expected_attendance: 50, required_layout: 'CLASSROOM' }} user={user} />);
    expect(submitButton()).toBeEnabled();

    await retype(labelField(), '');

    expect(screen.getByText(/give this booking a label/i)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });
});

describe("F12 / SCRUM-177 functional — the coordinator's booking list tells an event's venues apart", () => {
  test('TC-1073 each request shows its label beside its venue', async () => {
    loadVenueCatalogue.mockResolvedValue([seminarRoom, { ...seminarRoom, venue_id: 'VEN-MAIN', name: 'Main Hall', max_capacity: 400 }]);
    reviewApi.list.mockResolvedValue({ events: [{ id: 'EVT-1', name: 'Annual Conference', status: 'PLANNING' }] });
    const raised = (fields) => ({
      event_id: 'EVT-1', event_name: 'Annual Conference', event_date: '2026-11-20', start_time: '09:00', end_time: '17:00',
      status: 'PENDING', requested_at: '2026-10-05T09:00:00.000Z', suitability_acknowledgement: null, ...fields
    });
    loadVenueBookings.mockResolvedValue([
      raised({ booking_id: 'BK-1', venue_id: 'VEN-MAIN', booking_label: 'Main programme', expected_attendance: 300 }),
      raised({ booking_id: 'BK-2', venue_id: 'VEN-SEM', booking_label: 'Breakout 1', expected_attendance: 50 })
    ]);
    render(<VenueBookings user={user} />);

    const records = await screen.findAllByRole('article');
    expect(records).toHaveLength(2);
    expect(within(records[0]).getByText('Main programme · Main Hall')).toBeInTheDocument();
    expect(within(records[1]).getByText('Breakout 1 · Seminar Room')).toBeInTheDocument();
  });
});
