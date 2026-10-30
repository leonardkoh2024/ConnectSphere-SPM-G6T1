// I2 / SCRUM-148 — the coordinator's Change requests screen. TC-810 – TC-813 in docs/test-cases.md.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangeRequestDecisionsScreen from './ChangeRequestDecisionsScreen';
import { ChangeRequestRecord } from './ChangeRequestsScreen';
import { acceptChangeRequest, declineChangeRequest, loadAssignedChangeRequests, loadChangeReview } from './changeDecisionApi';

jest.mock('./changeDecisionApi', () => ({
  acceptChangeRequest: jest.fn(), declineChangeRequest: jest.fn(), loadAssignedChangeRequests: jest.fn(), loadChangeReview: jest.fn()
}));
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

test('TC-810 AC1 the review sets current beside proposed and lists every arrangement affected', async () => {
  const panel = await openReview();
  const row = within(panel).getByRole('row', { name: /Expected attendance/ });
  expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['120', '150']);
  const affected = within(panel).getByRole('list', { name: 'Arrangements affected' });
  expect(within(affected).getByText('Grand Hall — APPROVED')).toBeInTheDocument();
  expect(within(affected).getByText('No equipment is reserved.')).toBeInTheDocument();
  expect(within(affected).getByText('2 registration records on this event')).toBeInTheDocument();
});

test('TC-811 AC2 declining without a reason is refused; with one it is sent and the list updates', async () => {
  declineChangeRequest.mockResolvedValue({ ...PENDING, status: 'DECLINED', decision_reason: 'Venue is full.' });
  const panel = await openReview();
  await userEvent.click(within(panel).getByRole('button', { name: 'Decline change' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Give a reason for declining the change.');
  expect(declineChangeRequest).not.toHaveBeenCalled();

  await userEvent.type(within(panel).getByRole('textbox'), 'Venue is full.');
  await userEvent.click(within(panel).getByRole('button', { name: 'Decline change' }));
  await waitFor(() => expect(declineChangeRequest).toHaveBeenCalledWith({ request: PENDING, reason: 'Venue is full.' }));
});

test('TC-812 AC3 accepting applies the values and tells the coordinator', async () => {
  const onNotice = jest.fn();
  acceptChangeRequest.mockResolvedValue({ ok: true, changed: 1 });
  render(<ChangeRequestDecisionsScreen user={USER} onNotice={onNotice} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Review change' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Accept change' }));
  await waitFor(() => expect(acceptChangeRequest).toHaveBeenCalledWith({ request: PENDING, review: REVIEW, note: '' }));
  expect(onNotice).toHaveBeenCalledWith('Change accepted and applied. The organiser has been told.');
});

test('TC-813 an event that cannot take edits yet can only be declined', async () => {
  loadChangeReview.mockResolvedValue({ ...REVIEW, event: { id: 'e1', status: 'SUBMITTED' } });
  const panel = await openReview();
  expect(within(panel).getByRole('button', { name: 'Accept change' })).toBeDisabled();
  expect(within(panel).getByText(/can be accepted once it is Approved, Planning or Confirmed/)).toBeInTheDocument();
  expect(within(panel).getByRole('button', { name: 'Decline change' })).toBeEnabled();
});

test('TC-814 AC4 the organiser\'s list shows the final decision, when, and the reason', () => {
  render(<ChangeRequestRecord request={{ ...PENDING, status: 'DECLINED', decided_at: '2026-10-28T02:00:00.000Z', decision_reason: 'Venue is full.' }} />);
  expect(screen.getByText('Declined')).toHaveClass('cs-pill-danger');
  expect(screen.getByText('Decision reason').nextSibling).toHaveTextContent('Venue is full.');
  expect(screen.getByText('Decided')).toBeInTheDocument();
});
