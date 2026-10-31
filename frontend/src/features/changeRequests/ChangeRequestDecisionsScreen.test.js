// I2 / SCRUM-148 — the coordinator's Change requests screen.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangeRequestDecisionsScreen from './ChangeRequestDecisionsScreen';
import { ChangeRequestRecord } from './ChangeRequestsScreen';
import { acceptChangeRequest, declineChangeRequest, loadAssignedChangeRequests, loadChangeReview } from './changeDecisionApi';

jest.mock('./changeDecisionApi', () => ({
  acceptChangeRequest: jest.fn(), declineChangeRequest: jest.fn(), loadAssignedChangeRequests: jest.fn(), loadChangeReview: jest.fn()
}));
jest.mock('./changeRequestsApi', () => ({}));
jest.mock('../events/reviewApi', () => ({ reviewApi: { retryRerequest: jest.fn() } }));

const USER = { uid: 'c1' };
const PENDING = {
  id: 'r1', event_id: 'e1', event_name: 'Harbour Tech Forum', reference_no: 'EVT-1', status: 'PENDING', organiser_id: 'o1',
  created_at: '2026-10-27T01:00:00.000Z', reason: 'More sign-ups.',
  changes: { expected_attendance: { old_value: 120, new_value: 150 } }
};
const REVIEW = {
  event: { id: 'e1', status: 'PLANNING' },
  organiser: null,
  current: { expected_attendance: 120 },
  impact: { venueBookings: [{ id: 'b1', label: 'Grand Hall', status: 'APPROVED' }], equipmentReservations: [], registrationsCount: 2 }
};

beforeEach(() => {
  jest.clearAllMocks();
  loadAssignedChangeRequests.mockResolvedValue([PENDING]);
  loadChangeReview.mockResolvedValue(REVIEW);
});

const openReview = async () => {
  render(<ChangeRequestDecisionsScreen user={USER} onNotice={jest.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Review change' }));
  return screen.findByRole('region', { name: /Decide change request/ });
};

test('TC-1892 AC1 the review sets current beside proposed and lists every arrangement affected', async () => {
  const panel = await openReview();
  const row = within(panel).getByRole('row', { name: /Expected attendance/ });
  expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['120', '150']);
  const affected = within(panel).getByRole('list', { name: 'Arrangements affected' });
  expect(within(affected).getByText('Grand Hall — APPROVED')).toBeInTheDocument();
  expect(within(affected).getByText('No equipment is reserved.')).toBeInTheDocument();
  expect(within(affected).getByText('2 registration records on this event')).toBeInTheDocument();
});

test('TC-1893 AC2 declining without a reason is refused; with one it is sent and the list updates', async () => {
  declineChangeRequest.mockResolvedValue({ ...PENDING, status: 'DECLINED', decision_reason: 'Venue is full.' });
  const panel = await openReview();
  await userEvent.click(within(panel).getByRole('button', { name: 'Decline change' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Give a reason for declining the change.');
  expect(declineChangeRequest).not.toHaveBeenCalled();

  await userEvent.type(within(panel).getByRole('textbox'), 'Venue is full.');
  await userEvent.click(within(panel).getByRole('button', { name: 'Decline change' }));
  await waitFor(() => expect(declineChangeRequest).toHaveBeenCalledWith({ request: PENDING, reason: 'Venue is full.' }));
});

test('TC-1894 AC3 accepting applies the values and tells the coordinator', async () => {
  const onNotice = jest.fn();
  acceptChangeRequest.mockResolvedValue({ ok: true, changed: 1 });
  render(<ChangeRequestDecisionsScreen user={USER} onNotice={onNotice} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Review change' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Accept change' }));
  await waitFor(() => expect(acceptChangeRequest).toHaveBeenCalledWith({ request: PENDING, review: REVIEW, note: '' }));
  expect(onNotice).toHaveBeenCalledWith('Change accepted and applied. The organiser has been told.');
});

test('TC-1895 an event that cannot take edits yet can only be declined', async () => {
  loadChangeReview.mockResolvedValue({ ...REVIEW, event: { id: 'e1', status: 'SUBMITTED' } });
  const panel = await openReview();
  expect(within(panel).getByRole('button', { name: 'Accept change' })).toBeDisabled();
  expect(within(panel).getByText(/can be accepted once it is Approved, Planning or Confirmed/)).toBeInTheDocument();
  expect(within(panel).getByRole('button', { name: 'Decline change' })).toBeEnabled();
});

test('TC-1896 AC4 the organiser\'s list shows the final decision, when, and the reason', () => {
  render(<ChangeRequestRecord request={{ ...PENDING, status: 'DECLINED', decided_at: '2026-10-28T02:00:00.000Z', decision_reason: 'Venue is full.' }} />);
  expect(screen.getByText('Declined')).toHaveClass('cs-pill-danger');
  expect(screen.getByText('Decision reason').nextSibling).toHaveTextContent('Venue is full.');
  expect(screen.getByText('Decided')).toBeInTheDocument();
});

describe('I2 the decision screen at its edges', () => {
  const RETRY_FAILED = 'The arrangements could not be marked for re-request.';
  const { reviewApi } = jest.requireMock('../events/reviewApi');

  test("TC-1897 [normal] with no request on the coordinator's events the screen says so", async () => {
    loadAssignedChangeRequests.mockResolvedValue([]);
    render(<ChangeRequestDecisionsScreen user={USER} />);
    expect(await screen.findByText('No change requests on your events.')).toBeInTheDocument();
  });

  test('TC-1898 [normal] a decided request stays listed with no Review button; Close puts a review away', async () => {
    loadAssignedChangeRequests.mockResolvedValue([PENDING, { ...PENDING, id: 'r2', status: 'ACCEPTED', event_name: 'Old Forum' }]);
    render(<ChangeRequestDecisionsScreen user={USER} />);
    await screen.findByRole('heading', { name: 'Old Forum' });
    expect(screen.getAllByRole('button', { name: 'Review change' })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Review change' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: /Decide change request/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review change' })).toBeInTheDocument();
  });

  test('TC-1899 [normal] AC4 declining tells the coordinator and refreshes the list', async () => {
    const onNotice = jest.fn();
    declineChangeRequest.mockResolvedValue({ ...PENDING, status: 'DECLINED' });
    render(<ChangeRequestDecisionsScreen user={USER} onNotice={onNotice} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Review change' }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Venue is full.' } });
    loadAssignedChangeRequests.mockResolvedValue([{ ...PENDING, status: 'DECLINED' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Decline change' }));

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Change declined. The organiser has been told why.'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Review change' })).not.toBeInTheDocument());
  });

  test('TC-1900 [boundary] the panel waits for the arrangements before it opens', async () => {
    let finish;
    loadChangeReview.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<ChangeRequestDecisionsScreen user={USER} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Review change' }));
    expect(screen.getByText("Loading the event's arrangements…")).toBeInTheDocument();
    await act(async () => { finish(REVIEW); });
    expect(screen.getByRole('region', { name: /Decide change request/ })).toBeInTheDocument();
  });

  test('TC-1901 [conflict] arrangements that changed while reviewing are reloaded and the coordinator is asked to check again', async () => {
    acceptChangeRequest.mockRejectedValue(new Error('The existing arrangements changed since this was opened.'));
    const panel = await openReview();
    loadChangeReview.mockResolvedValue({ ...REVIEW, impact: { ...REVIEW.impact, venueBookings: [{ id: 'b2', label: 'Annex', status: 'PENDING' }] } });
    await userEvent.click(within(panel).getByRole('button', { name: 'Accept change' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The arrangements changed while you were reviewing. Check the updated list, then accept again.');
    expect(screen.getByText('Annex — PENDING')).toBeInTheDocument();
  });

  test('TC-1902 [conflict] if the changed arrangements cannot be reloaded, the original refusal is shown', async () => {
    acceptChangeRequest.mockRejectedValue(new Error('The existing arrangements changed since this was opened.'));
    const panel = await openReview();
    loadChangeReview.mockRejectedValue(new Error('offline'));
    await userEvent.click(within(panel).getByRole('button', { name: 'Accept change' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The existing arrangements changed since this was opened.');
  });

  test('TC-2014 [conflict] I3 a change applied whose re-request failed says so, and Retry marks the arrangements', async () => {
    const onNotice = jest.fn();
    acceptChangeRequest.mockResolvedValue({ ok: true, rerequest: { sent: false, changeId: 'sc1', error: 'The arrangements service is unavailable.' } });
    reviewApi.retryRerequest.mockResolvedValue({ ok: true });
    render(<ChangeRequestDecisionsScreen user={USER} onNotice={onNotice} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Review change' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Accept change' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The change to Harbour Tech Forum was applied, but the arrangements service is unavailable.');
    expect(onNotice).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reviewApi.retryRerequest).toHaveBeenCalledWith({ eventId: 'e1', changeId: 'sc1' });
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Change accepted and applied. The affected arrangements were marked for re-request.'));
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  test('TC-1903 [failure] a re-request with no reason given, and a retry that fails, both say why', async () => {
    acceptChangeRequest.mockResolvedValue({ ok: true, rerequest: { sent: false, changeId: 'sc1' } });
    reviewApi.retryRerequest.mockRejectedValueOnce(new Error('Still unavailable.')).mockRejectedValueOnce(new Error(''));
    render(<ChangeRequestDecisionsScreen user={USER} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Review change' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Accept change' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`applied, but ${RETRY_FAILED.charAt(0).toLowerCase()}${RETRY_FAILED.slice(1)}`);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('applied, but still unavailable.'));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('applied, but the arrangements could not be marked'));
  });

  test('TC-1904 [failure] the list that cannot be loaded says so', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    loadAssignedChangeRequests.mockRejectedValue(new Error('permission-denied'));
    render(<ChangeRequestDecisionsScreen user={USER} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The change requests could not be loaded. Try again.');
    console.error.mockRestore();
  });

  test('TC-1905 [failure] a list that arrives after the screen has gone is dropped', async () => {
    let finish;
    loadAssignedChangeRequests.mockReturnValue(new Promise((_resolve, reject) => { finish = reject; }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<ChangeRequestDecisionsScreen user={USER} />);
    unmount();
    await act(async () => { finish(new Error('late')); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    let arrive;
    loadAssignedChangeRequests.mockReturnValue(new Promise((resolve) => { arrive = resolve; }));
    render(<ChangeRequestDecisionsScreen user={USER} />).unmount();
    await act(async () => { arrive([PENDING]); });
    expect(screen.queryByRole('button', { name: 'Review change' })).not.toBeInTheDocument();
    console.error.mockRestore();
  });

  test('TC-1906 [failure] a request that cannot be opened says so in place of the panel', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    loadChangeReview.mockRejectedValue(new Error('offline'));
    render(<ChangeRequestDecisionsScreen user={USER} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Review change' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This request could not be opened. Try again.');
    console.error.mockRestore();
  });

  test('TC-1907 [failure] a refused accept or decline is shown in the panel', async () => {
    acceptChangeRequest.mockRejectedValue(new Error('Missing or insufficient permissions.'));
    declineChangeRequest.mockRejectedValue(new Error('Decline refused.'));
    const panel = await openReview();
    await userEvent.click(within(panel).getByRole('button', { name: 'Accept change' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Missing or insufficient permissions.');

    fireEvent.change(within(panel).getByRole('textbox'), { target: { value: 'No.' } });
    await userEvent.click(within(panel).getByRole('button', { name: 'Decline change' }));
    expect(await within(panel).findByText('Decline refused.')).toBeInTheDocument();
  });

  test('TC-1908 [failure] a list that cannot be refreshed after a decision is logged, and the decision still stands', async () => {
    const onNotice = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    acceptChangeRequest.mockResolvedValue({ ok: true });
    render(<ChangeRequestDecisionsScreen user={USER} onNotice={onNotice} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Review change' }));
    loadAssignedChangeRequests.mockRejectedValue(new Error('offline'));
    await userEvent.click(await screen.findByRole('button', { name: 'Accept change' }));

    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Could not refresh change requests:', expect.any(Error)));
    expect(onNotice).toHaveBeenCalledWith('Change accepted and applied. The organiser has been told.');
    console.error.mockRestore();
  });
});
