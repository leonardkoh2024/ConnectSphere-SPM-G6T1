import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VenueBookingQueue, { elapsed } from './VenueBookingQueue';
import { approveVenueBooking, loadVenueBookingQueue, rejectVenueBooking } from './venuesApi';

jest.mock('./venuesApi', () => ({
  approveVenueBooking: jest.fn(),
  rejectVenueBooking: jest.fn(),
  loadVenueBookingQueue: jest.fn()
}));

const first = {
  booking_id: 'BK-1', event_name: 'Later event', venue_name: 'Hall A', venue_id: 'VEN-1', status: 'PENDING',
  event_id: 'EVT-1', event_reference_no: 'EVT-2026-001', event_purpose: 'COMMUNITY_ENGAGEMENT',
  event_description: 'A community programme with talks and facilitated activities.', registration_required: true,
  start_datetime: '2026-11-21T02:00:00.000Z', end_datetime: '2026-11-21T04:00:00.000Z',
  occupied_start: '2026-11-21T01:30:00.000Z', occupied_end: '2026-11-21T04:45:00.000Z',
  submitted_at: '2026-10-02T00:00:00.000Z', expected_attendance: 100, requested_layout_id: 'THEATRE',
  suitability_acknowledgement: { acknowledged: true, criteria: ['FACILITIES'] }
};
const second = {
  ...first, booking_id: 'BK-2', event_name: 'Earlier event',
  start_datetime: '2026-11-20T02:00:00.000Z', end_datetime: '2026-11-20T04:00:00.000Z',
  submitted_at: '2026-10-01T00:00:00.000Z'
};

beforeEach(() => {
  loadVenueBookingQueue.mockReset().mockResolvedValue([first, second]);
  approveVenueBooking.mockReset().mockResolvedValue({ booking_id: 'BK-2', status: 'APPROVED' });
  rejectVenueBooking.mockReset().mockResolvedValue({ booking_id: 'BK-2', status: 'REJECTED' });
});

test('F3 shows only the supplied staff queue details and sorts by submission time or requested date', async () => {
  render(<VenueBookingQueue user={{ uid: 'staff' }} />);
  expect(await screen.findByText('Earlier event')).toBeInTheDocument();
  let headings = screen.getAllByRole('heading', { level: 2 });
  expect(headings.map((item) => item.textContent)).toEqual(['Earlier event', 'Later event']);
  expect(screen.queryByText('100')).not.toBeInTheDocument();

  const earlierRow = screen.getByText('Earlier event').closest('.cs-record');
  await userEvent.click(within(earlierRow).getByRole('button', { name: /view request/i }));
  expect(within(earlierRow).getByText('100')).toBeInTheDocument();
  expect(within(earlierRow).getByText('THEATRE')).toBeInTheDocument();
  expect(within(earlierRow).getByText(/community programme/i)).toBeInTheDocument();
  expect(within(earlierRow).getByText(/facilities/i)).toBeInTheDocument();
  await userEvent.click(within(earlierRow).getByRole('button', { name: /close/i }));
  expect(within(earlierRow).queryByText('100')).not.toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText(/sort by/i), 'requested_date');
  headings = screen.getAllByRole('heading', { level: 2 });
  expect(headings.map((item) => item.textContent)).toEqual(['Earlier event', 'Later event']);
});

test('F4 approval refreshes the queue and reports service-side conflict errors', async () => {
  loadVenueBookingQueue.mockResolvedValueOnce([second])
    .mockResolvedValueOnce([{ ...second, status: 'APPROVED', decided_at: '2026-10-03T00:00:00.000Z' }]);
  const notice = jest.fn();
  render(<VenueBookingQueue user={{ uid: 'staff' }} onNotice={notice} />);
  const row = (await screen.findByText('Earlier event')).closest('.cs-record');
  await userEvent.click(within(row).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(notice).toHaveBeenCalledWith('Hall A booking approved.'));
  // TC-399 — the approved booking stays listed, marked Approved, with nothing left to approve.
  const approved = screen.getByText('Earlier event').closest('.cs-record');
  expect(within(approved).getByText('Approved')).toBeInTheDocument();
  expect(within(approved).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();

  loadVenueBookingQueue.mockResolvedValue([second]);
  approveVenueBooking.mockRejectedValue(new Error('An earlier submitted request must be decided first.'));
  const { unmount } = render(<VenueBookingQueue user={{ uid: 'staff-2' }} />);
  const buttons = await screen.findAllByRole('button', { name: 'Approve' });
  await userEvent.click(buttons.at(-1));
  expect(await screen.findByRole('alert')).toHaveTextContent(/earlier submitted request/i);
  unmount();
});

test('elapsed provides the time since submission used in each queue entry', () => {
  expect(elapsed('2026-10-09T01:00:00Z', new Date('2026-10-09T03:30:00Z').getTime())).toBe('2 hours ago');
});

test('F5 / SCRUM-129 requires a reason and shows the complete rejection reason and time', async () => {
  const rejected = {
    ...second,
    status: 'REJECTED',
    decision_reason: 'The requested layout is not supported at this venue.',
    decided_at: '2026-10-03T09:30:00.000Z'
  };
  loadVenueBookingQueue.mockResolvedValueOnce([second]).mockResolvedValueOnce([rejected]);
  const notice = jest.fn();
  render(<VenueBookingQueue user={{ uid: 'staff' }} onNotice={notice} />);
  const row = (await screen.findByText('Earlier event')).closest('.cs-record');

  await userEvent.click(within(row).getByRole('button', { name: 'Reject' }));
  await userEvent.click(within(row).getByRole('button', { name: 'Confirm rejection' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/reason is required/i);
  expect(rejectVenueBooking).not.toHaveBeenCalled();

  await userEvent.type(within(row).getByLabelText(/reason for rejection/i), rejected.decision_reason);
  await userEvent.click(within(row).getByRole('button', { name: 'Confirm rejection' }));
  await waitFor(() => expect(rejectVenueBooking).toHaveBeenCalledWith({
    user: { uid: 'staff' }, bookingId: 'BK-2', reason: rejected.decision_reason
  }));
  expect(notice).toHaveBeenCalledWith('Hall A booking rejected.');

  const rejectedRow = screen.getByText('Earlier event').closest('.cs-record');
  await userEvent.click(within(rejectedRow).getByRole('button', { name: 'View request' }));
  expect(within(rejectedRow).getByText(rejected.decision_reason)).toBeInTheDocument();
  expect(within(rejectedRow).getByText('Decided', { selector: 'dt' }).nextSibling)
    .toHaveTextContent(new Date(rejected.decided_at).toLocaleString());
});

// TC-400 — decided requests stay on the screen. All lists pending first; the
// Show filter narrows to Pending or Decided, each with its own empty message.
test('TC-400 decided requests stay listed after pending ones, and Show narrows to Pending or Decided', async () => {
  const approved = { ...first, booking_id: 'BK-3', event_name: 'Approved event', status: 'APPROVED',
    submitted_at: '2026-09-01T00:00:00.000Z', decided_at: '2026-09-02T00:00:00.000Z' };
  loadVenueBookingQueue.mockResolvedValue([approved, second]);
  render(<VenueBookingQueue user={{ uid: 'staff' }} />);

  await screen.findByText('Approved event');
  const headings = () => screen.getAllByRole('heading', { level: 2 }).map((item) => item.textContent);
  expect(headings()).toEqual(['Earlier event', 'Approved event']);
  expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);

  await userEvent.selectOptions(screen.getByLabelText(/^show/i), 'decided');
  expect(headings()).toEqual(['Approved event']);
  await userEvent.click(screen.getByRole('button', { name: /view request/i }));
  expect(screen.getByText('Decided', { selector: 'dt' }).nextSibling).toHaveTextContent(new Date('2026-09-02T00:00:00.000Z').toLocaleString());

  await userEvent.selectOptions(screen.getByLabelText(/^show/i), 'pending');
  expect(headings()).toEqual(['Earlier event']);
});

test('TC-400 an empty Decided view says so', async () => {
  loadVenueBookingQueue.mockResolvedValue([second]);
  render(<VenueBookingQueue user={{ uid: 'staff' }} />);
  await screen.findByText('Earlier event');
  await userEvent.selectOptions(screen.getByLabelText(/^show/i), 'decided');
  expect(screen.getByText('No decided requests for your venues yet.')).toBeInTheDocument();
});
