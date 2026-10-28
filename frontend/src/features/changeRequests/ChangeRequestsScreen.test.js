// I1 / SCRUM-147 — the organiser's Change requests screen and its form.
// TC-776 – TC-779 in docs/test-cases.md.

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangeRequestsScreen from './ChangeRequestsScreen';
import { loadChangeableEvents, loadCurrentValues, loadMyChangeRequests, submitChangeRequest } from './changeRequestsApi';

jest.mock('./changeRequestsApi', () => ({
  loadChangeableEvents: jest.fn(), loadCurrentValues: jest.fn(), loadMyChangeRequests: jest.fn(), submitChangeRequest: jest.fn()
}));

const USER = { uid: 'o1' };
const PLANNING = { id: 'e1', name: 'Harbour Tech Forum', reference_no: 'EVT-1', status: 'PLANNING', coordinator_id: 'c1' };
const UNASSIGNED = { id: 'e2', name: 'Waitlist Demo Workshop', reference_no: 'EVT-2', status: 'SUBMITTED', coordinator_id: null };
const CURRENT = {
  name: 'Harbour Tech Forum', purpose: 'Showcase', description: 'Talks', expected_attendance: 120, event_date: '2099-11-22',
  start_time: '09:00', end_time: '17:00', preferred_location: 'CENTRAL', required_layout: 'THEATRE',
  facilities: ['WIFI'], accessibility: [], accessibility_notes: ''
};
const REQUEST = {
  id: 'r1', event_name: 'Harbour Tech Forum', reference_no: 'EVT-1', status: 'PENDING', created_at: '2026-10-27T01:00:00.000Z',
  changes: { expected_attendance: { old_value: 120, new_value: 150 }, facilities: { old_value: ['WIFI'], new_value: ['STAGE', 'WIFI'] } },
  reason: 'More sign-ups.'
};

beforeEach(() => {
  loadMyChangeRequests.mockResolvedValue([REQUEST]);
  loadChangeableEvents.mockResolvedValue([PLANNING, UNASSIGNED]);
  loadCurrentValues.mockResolvedValue(CURRENT);
});

test('TC-776 AC3 AC4 each request shows its event, every change as old → new, the reason and Pending', async () => {
  render(<ChangeRequestsScreen user={USER} creating={false} onCreatingChange={jest.fn()} />);

  const record = (await screen.findByRole('heading', { name: 'Harbour Tech Forum' })).closest('.cs-record');
  expect(within(record).getByText('Pending')).toHaveClass('cs-pill-warning');
  expect(within(record).getByText('Expected attendance').nextSibling).toHaveTextContent('120 → 150');
  expect(within(record).getByText('Facilities').nextSibling).toHaveTextContent('WIFI → STAGE, WIFI');
  expect(within(record).getByText('More sign-ups.')).toBeInTheDocument();
});

test('TC-777 AC2 a request is sent only with a new value and a reason, then joins the list', async () => {
  const onCreatingChange = jest.fn();
  const onNotice = jest.fn();
  submitChangeRequest.mockResolvedValue({ ...REQUEST, id: 'r2', reason: 'Bigger crowd.', notified: true });
  render(<ChangeRequestsScreen user={USER} creating onCreatingChange={onCreatingChange} onNotice={onNotice} />);

  const picker = await screen.findByRole('combobox', { name: /Event to change/ });
  // Choosing the event loads its current values, so the wait covers that load too.
  await act(async () => { await userEvent.selectOptions(picker, 'e1'); });
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Expected attendance' }));
  expect(screen.getByText('Current expected attendance').nextSibling).toHaveTextContent('120');
  await userEvent.click(screen.getByRole('button', { name: 'Send change request' }));
  const alert = screen.getByRole('alert');
  expect(within(alert).getByText('Expected attendance: enter a value different from the current one.')).toBeInTheDocument();
  expect(within(alert).getByText('Give a reason for the change.')).toBeInTheDocument();
  expect(submitChangeRequest).not.toHaveBeenCalled();

  const attendance = screen.getByRole('spinbutton', { name: 'New expected attendance' });
  await userEvent.clear(attendance);
  await userEvent.type(attendance, '150');
  await userEvent.type(screen.getByRole('textbox', { name: /Reason for the change/ }), 'Bigger crowd.');
  await userEvent.click(screen.getByRole('button', { name: 'Send change request' }));

  await waitFor(() => expect(submitChangeRequest).toHaveBeenCalledWith({
    userId: 'o1', event: PLANNING, current: CURRENT, proposed: { expected_attendance: '150' }, fields: ['expected_attendance'], reason: 'Bigger crowd.'
  }));
  expect(onCreatingChange).toHaveBeenCalledWith(false);
  expect(onNotice).toHaveBeenCalledWith("Change request sent. Harbour Tech Forum's coordinator has been told.");
});

test('TC-778 an event with no coordinator yet says the request waits, and the confirmation says so too', async () => {
  const onNotice = jest.fn();
  submitChangeRequest.mockResolvedValue({ ...REQUEST, id: 'r3', notified: false });
  render(<ChangeRequestsScreen user={USER} creating onCreatingChange={jest.fn()} onNotice={onNotice} initialEventId="e2" />);

  expect(await screen.findByText(/No coordinator is assigned to this event yet/)).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: /Event to change/ })).toHaveValue('e2');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Event name' }));
  const name = screen.getByRole('textbox', { name: 'New event name' });
  await userEvent.clear(name);
  await userEvent.type(name, 'Waitlist Workshop');
  await userEvent.type(screen.getByRole('textbox', { name: /Reason for the change/ }), 'Shorter name.');
  await userEvent.click(screen.getByRole('button', { name: 'Send change request' }));

  await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Change request saved as Pending. The coordinator will see it once the event is assigned.'));
});

test('TC-779 with no request yet, and no event that can take one, the screen says so', async () => {
  loadMyChangeRequests.mockResolvedValue([]);
  loadChangeableEvents.mockResolvedValue([]);
  const { rerender } = render(<ChangeRequestsScreen user={USER} creating={false} onCreatingChange={jest.fn()} />);
  expect(await screen.findByText('You have not requested any changes yet.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'New change request' })).not.toBeInTheDocument();

  rerender(<ChangeRequestsScreen user={USER} creating onCreatingChange={jest.fn()} />);
  expect(screen.getByText(/None of your events can take a change request right now/)).toBeInTheDocument();
});
