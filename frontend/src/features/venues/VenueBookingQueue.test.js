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

test('TC-0912 F3 shows only the supplied staff queue details and sorts by submission time or requested date', async () => {
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

test('TC-0924 F4 approval refreshes the queue and reports service-side conflict errors', async () => {
  loadVenueBookingQueue.mockResolvedValueOnce([second])
    .mockResolvedValueOnce([{ ...second, status: 'APPROVED', decided_at: '2026-10-03T00:00:00.000Z' }]);
  const notice = jest.fn();
  render(<VenueBookingQueue user={{ uid: 'staff' }} onNotice={notice} />);
  const row = (await screen.findByText('Earlier event')).closest('.cs-record');
  await userEvent.click(within(row).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(notice).toHaveBeenCalledWith('Hall A booking approved.'));
  // the approved booking stays listed, marked Approved, with nothing left to approve.
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

test('TC-0913 elapsed provides the time since submission used in each queue entry', () => {
  expect(elapsed('2026-10-09T01:00:00Z', new Date('2026-10-09T03:30:00Z').getTime())).toBe('2 hours ago');
});

test('TC-0942 F5 / SCRUM-129 requires a reason and shows the complete rejection reason and time', async () => {
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

// decided requests stay on the screen. All lists pending first; the
// Show filter narrows to Pending or Decided, each with its own empty message.
test('TC-0914 decided requests stay listed after pending ones, and Show narrows to Pending or Decided', async () => {
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

test('TC-0915 an empty Decided view says so', async () => {
  loadVenueBookingQueue.mockResolvedValue([second]);
  render(<VenueBookingQueue user={{ uid: 'staff' }} />);
  await screen.findByText('Earlier event');
  await userEvent.selectOptions(screen.getByLabelText(/^show/i), 'decided');
  expect(screen.getByText('No decided requests for your venues yet.')).toBeInTheDocument();
});

// F3 / F4 / F5 / F10 — further states of the Venue Staff queue, grouped by scenario kind.
const rowOf = (name) => screen.getByText(name, { selector: 'h2' }).closest('.cs-record');
const detail = (row, term) => within(row).getByText(term, { selector: 'dt' }).nextSibling;

describe('normal', () => {
  test('TC-0916 F3 AC1 — loading first, then the queue is loaded for the signed-in staff member', async () => {
    render(<VenueBookingQueue user={{ uid: 'staff' }} />);
    expect(screen.getByText(/loading booking requests/i)).toBeInTheDocument();
    await screen.findByText('Earlier event');
    expect(loadVenueBookingQueue).toHaveBeenCalledWith({ user: { uid: 'staff' } });
  });

  test('TC-0917 F3 — sorting by requested date reorders within the waiting group', async () => {
    loadVenueBookingQueue.mockResolvedValue([
      { ...first, booking_id: 'A', event_name: 'Submitted first, held later', submitted_at: '2026-10-01T00:00:00.000Z', start_datetime: '2026-12-01T02:00:00.000Z' },
      { ...first, booking_id: 'B', event_name: 'Submitted second, held sooner', submitted_at: '2026-10-02T00:00:00.000Z', start_datetime: '2026-11-01T02:00:00.000Z' }
    ]);
    render(<VenueBookingQueue user={{ uid: 'staff' }} />);
    await screen.findByText('Submitted first, held later');
    const headings = () => screen.getAllByRole('heading', { level: 2 }).map((item) => item.textContent);
    expect(headings()).toEqual(['Submitted first, held later', 'Submitted second, held sooner']);
    userEvent.selectOptions(screen.getByLabelText(/sort by/i), 'requested_date');
    expect(headings()).toEqual(['Submitted second, held sooner', 'Submitted first, held later']);
  });

  test('TC-0958 F7 — each status shows its own label; an unknown status reads Unknown', async () => {
    loadVenueBookingQueue.mockResolvedValue([
      { ...first, booking_id: 'R', event_name: 'Rejected one', status: 'REJECTED', decided_at: '2026-10-03T00:00:00.000Z' },
      { ...first, booking_id: 'X', event_name: 'Expired one', status: 'EXPIRED' },
      { ...first, booking_id: 'U', event_name: 'Odd one', status: '' },
      { ...first, booking_id: 'W', event_name: 'Weird one', status: 'REPLACED' }
    ]);
    render(<VenueBookingQueue user={{ uid: 'staff' }} />);
    await screen.findByText('Rejected one');
    expect(within(rowOf('Rejected one')).getByText('Rejected')).toHaveClass('cs-pill-danger');
    expect(within(rowOf('Expired one')).getByText('Expired')).toHaveClass('cs-pill-neutral');
    expect(within(rowOf('Odd one')).getByText('Unknown')).toHaveClass('cs-pill-neutral');
    expect(within(rowOf('Weird one')).getByText('Replaced')).toHaveClass('cs-pill-neutral');
    expect(within(rowOf('Rejected one')).getByText(/^Decided /)).toBeInTheDocument();
    expect(within(rowOf('Expired one')).getByText(/^Submitted /)).toBeInTheDocument();
  });

  test('TC-0925 F4 — an active hold shows its expiry in the request details', async () => {
    loadVenueBookingQueue.mockResolvedValue([{ ...first, status: 'HELD', hold_expires_at: '2099-01-05T01:00:00.000Z', safety_review_required: true, registration_required: false }]);
    render(<VenueBookingQueue user={{ uid: 'staff' }} />);
    const row = (await screen.findByText('Later event')).closest('.cs-record');
    userEvent.click(within(row).getByRole('button', { name: /view request/i }));
    expect(detail(row, 'Hold expires')).toHaveTextContent('2099');
    expect(detail(row, 'Safety review required')).toHaveTextContent('Yes');
    expect(detail(row, 'Registration required')).toHaveTextContent('No');
  });
});

describe('boundary', () => {
  test('TC-0918 F3 — elapsed time at each unit boundary', () => {
    const at = new Date('2026-10-09T00:00:00Z').getTime();
    const ago = (ms) => elapsed(new Date(at - ms).toISOString(), at);
    expect(elapsed('2026-10-09T00:00:01Z', at)).toBe('just now');
    expect(elapsed('not a date', at)).toBe('just now');
    expect(ago(59999)).toBe('just now');
    expect(ago(60000)).toBe('1 minute ago');
    expect(ago(59 * 60000)).toBe('59 minutes ago');
    expect(ago(60 * 60000)).toBe('1 hour ago');
    expect(ago(24 * 3600000)).toBe('1 day ago');
    expect(ago(48 * 3600000)).toBe('2 days ago');
    expect(typeof elapsed(new Date().toISOString())).toBe('string');
  });

  test('TC-0919 F3 — a request with sparse details shows defaults rather than blanks', async () => {
    loadVenueBookingQueue.mockResolvedValue([{
      booking_id: 'S', event_name: 'Sparse', venue_name: 'Hall A', status: 'PENDING', event_id: 'EVT-9',
      start_datetime: '2026-11-21T02:00:00.000Z', end_datetime: '2026-11-21T04:00:00.000Z',
      suitability_acknowledgement: { acknowledged: true }
    }]);
    render(<VenueBookingQueue user={{ uid: 'staff' }} />);
    const row = (await screen.findByText('Sparse')).closest('.cs-record');
    userEvent.click(within(row).getByRole('button', { name: /view request/i }));
    expect(detail(row, 'Event reference')).toHaveTextContent('EVT-9');
    expect(detail(row, 'Purpose')).toHaveTextContent('Not recorded');
    expect(detail(row, 'Requested layout')).toHaveTextContent('Not stated');
    expect(detail(row, 'Submitted')).toHaveTextContent('Not recorded');
    expect(detail(row, 'Occupied window')).toHaveTextContent(new Date('2026-11-21T02:00:00.000Z').toLocaleString());
    expect(detail(row, 'Event description')).toHaveTextContent('Not recorded');
    expect(detail(row, 'Known suitability shortfalls')).toHaveTextContent('Acknowledged without listed criteria');
  });

  test('TC-0920 F3 — no reference at all, and no acknowledgement, read Not recorded and None acknowledged', async () => {
    loadVenueBookingQueue.mockResolvedValue([{ ...first, event_reference_no: '', event_id: '', suitability_acknowledgement: { acknowledged: true, criteria: [] } },
      { ...second, suitability_acknowledgement: null }]);
    render(<VenueBookingQueue user={{ uid: 'staff' }} />);
    const later = (await screen.findByText('Later event')).closest('.cs-record');
    userEvent.click(within(later).getByRole('button', { name: /view request/i }));
    expect(detail(later, 'Event reference')).toHaveTextContent('Not recorded');
    expect(detail(later, 'Known suitability shortfalls')).toHaveTextContent('Acknowledged without listed criteria');
    const earlier = rowOf('Earlier event');
    userEvent.click(within(earlier).getByRole('button', { name: /view request/i }));
    expect(detail(earlier, 'Known suitability shortfalls')).toHaveTextContent('None acknowledged');
  });

  test('TC-0921 F3 — an empty queue says so, and the empty Clashes and On hold views have their own messages', async () => {
    loadVenueBookingQueue.mockResolvedValue([]);
    render(<VenueBookingQueue user={{ uid: 'staff' }} />);
    expect(await screen.findByText('No booking requests for your venues.')).toBeInTheDocument();
    userEvent.selectOptions(screen.getByLabelText(/^show/i), 'clashes');
    expect(screen.getByText('No booking clashes require review.')).toBeInTheDocument();
    userEvent.selectOptions(screen.getByLabelText(/^show/i), 'held');
    expect(screen.getByText('No requests on hold for your venues.')).toBeInTheDocument();
  });
});

describe('conflict', () => {
  test('TC-1015 F10 — a clashing booking is flagged with the other event and overlap, and Show Clashes lists only flagged ones', async () => {
    const clash = (selfIsA) => ({
      conflict_id: selfIsA ? 'C-1' : 'C-2',
      booking_a_id: selfIsA ? 'BK-1' : 'BK-9', event_a_name: selfIsA ? 'Later event' : 'Morning talk',
      booking_b_id: selfIsA ? 'BK-8' : 'BK-1', event_b_name: selfIsA ? 'Evening gala' : 'Later event',
      overlap_start: '2026-11-21T02:00:00.000Z', overlap_end: '2026-11-21T03:00:00.000Z'
    });
    loadVenueBookingQueue.mockResolvedValue([{ ...first, status: 'APPROVED', clashes: [clash(true), clash(false)] }, second]);
    render(<VenueBookingQueue user={{ uid: 'staff' }} />);
    const row = (await screen.findByText('Later event')).closest('.cs-record');
    const flag = within(row).getByRole('status');
    expect(flag).toHaveTextContent('Clash - review required');
    expect(flag).toHaveTextContent('Overlaps Evening gala');
    expect(flag).toHaveTextContent('Overlaps Morning talk');
    expect(within(rowOf('Earlier event')).queryByRole('status')).not.toBeInTheDocument();
    userEvent.selectOptions(screen.getByLabelText(/^show/i), 'clashes');
    expect(screen.getAllByRole('heading', { level: 2 }).map((item) => item.textContent)).toEqual(['Later event']);
  });

  test('TC-0943 F5 — pressing Reject again closes the reason form; actions are disabled while a rejection is in flight', async () => {
    let finish;
    rejectVenueBooking.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    loadVenueBookingQueue.mockResolvedValue([second]);
    render(<VenueBookingQueue user={{ uid: 'staff' }} />);
    const row = (await screen.findByText('Earlier event')).closest('.cs-record');
    userEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    expect(within(row).getByLabelText(/reason for rejection/i)).toBeInTheDocument();
    userEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    expect(within(row).queryByLabelText(/reason for rejection/i)).not.toBeInTheDocument();

    userEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    userEvent.type(within(row).getByLabelText(/reason for rejection/i), 'Layout not supported');
    userEvent.click(within(row).getByRole('button', { name: 'Confirm rejection' }));
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Approve' })).toBeDisabled());
    expect(within(row).getByRole('button', { name: 'Reject' })).toBeDisabled();
    finish({});
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Approve' })).toBeEnabled());
  });

  test('TC-0926 F4 — while one approval is in flight its button reads Approving and the other request stays usable', async () => {
    let finish;
    approveVenueBooking.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<VenueBookingQueue user={{ uid: 'staff' }} />);
    const row = (await screen.findByText('Earlier event')).closest('.cs-record');
    userEvent.click(within(row).getByRole('button', { name: 'Approve' }));
    expect(await within(row).findByRole('button', { name: 'Approving…' })).toBeDisabled();
    expect(within(rowOf('Later event')).getByRole('button', { name: 'Approve' })).toBeEnabled();
    finish({});
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Approve' })).toBeEnabled());
  });
});

describe('failure', () => {
  test('TC-0922 F3 — a failed load shows the error, or a fallback, and still renders the controls', async () => {
    loadVenueBookingQueue.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
    const { unmount } = render(<VenueBookingQueue user={{ uid: 'organiser' }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Missing or insufficient permissions.');
    expect(screen.getByLabelText(/^show/i)).toBeInTheDocument();
    unmount();
    loadVenueBookingQueue.mockRejectedValueOnce({});
    render(<VenueBookingQueue user={{ uid: 'staff' }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Booking requests could not be loaded.');
  });

  test('TC-0927 F4/F5 — a rejected approve or reject without a message falls back to a generic error', async () => {
    approveVenueBooking.mockRejectedValue({});
    rejectVenueBooking.mockRejectedValueOnce(new Error('Only a pending booking request can be rejected.')).mockRejectedValueOnce({});
    loadVenueBookingQueue.mockResolvedValue([second]);
    render(<VenueBookingQueue user={{ uid: 'staff' }} />);
    const row = (await screen.findByText('Earlier event')).closest('.cs-record');
    userEvent.click(within(row).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The booking could not be approved.');

    userEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    userEvent.type(within(row).getByLabelText(/reason for rejection/i), 'No');
    userEvent.click(within(row).getByRole('button', { name: 'Confirm rejection' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Only a pending booking request can be rejected.'));
    userEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    userEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    userEvent.type(within(row).getByLabelText(/reason for rejection/i), 'No');
    userEvent.click(within(row).getByRole('button', { name: 'Confirm rejection' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The booking could not be rejected.'));
  });

  test('TC-0923 F3 — a load settling after unmount changes nothing', async () => {
    let resolve;
    let reject;
    loadVenueBookingQueue.mockReturnValueOnce(new Promise((res) => { resolve = res; }));
    render(<VenueBookingQueue user={{ uid: 'staff' }} />).unmount();
    resolve([first]);
    loadVenueBookingQueue.mockReturnValueOnce(new Promise((_res, rej) => { reject = rej; }));
    render(<VenueBookingQueue user={{ uid: 'staff' }} />).unmount();
    reject(new Error('late'));
    await waitFor(() => expect(loadVenueBookingQueue).toHaveBeenCalledTimes(2));
  });
});
