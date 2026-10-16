// K2 / SCRUM-183 — functional (component) tests for the two genuinely-new UI
// behaviours the Lead's assignment queue gains in this story:
//   AC1 — a read-only event summary that opens from each queued event.
//   AC2 — each assign option shows that coordinator's active-event count.
// The assign *action* itself (select -> Assign -> reviewApi.assign -> notice ->
// event leaves the queue) is A6 wiring already covered elsewhere, and the new
// assign *logic* (record + notify organiser) is pinned by the domain unit tests
// (K2-TC3/TC4), so neither is re-tested here. reviewApi is mocked, mirroring
// EventReviewScreen.test.js, so this stays a fast, isolated component test.

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LeadAssignmentScreen from './LeadAssignmentScreen';
import { reviewApi } from './reviewApi';

jest.mock('./reviewApi', () => ({ reviewApi: {
  leadBoard: jest.fn(), assign: jest.fn(), leadReassign: jest.fn()
} }));

// One waiting event (EVT-1) that fills the queue, plus one already-assigned,
// non-terminal event (EVT-2) so that coordinator "Alex" has one active event and
// the option counts are not all zero.
const board = {
  events: [
    {
      id: 'EVT-1', coordinator_id: null, status: 'SUBMITTED', organiser_id: 'org-1',
      organiser_name: 'Nadia Organiser', name: 'Gala', purpose: 'Fundraiser',
      event_date: '2026-05-01', start_time: '18:00', end_time: '21:00',
      expected_attendance: 120, reference_no: 'EVT-0001', submitted_at: '2026-05-01T00:00:00Z'
    },
    {
      id: 'EVT-2', coordinator_id: 'c2', coordinator_name: 'Alex', status: 'UNDER_REVIEW',
      name: 'Workshop', event_date: '2026-06-01', reference_no: 'EVT-0002'
    },
    // K3 — a finished event held by Alex: it must offer no Reassign control.
    {
      id: 'EVT-3', coordinator_id: 'c2', coordinator_name: 'Alex', status: 'COMPLETED',
      name: 'Concert', event_date: '2026-03-01', reference_no: 'EVT-0003'
    }
  ],
  coordinators: [
    { id: 'c2', name: 'Alex', active: true },
    { id: 'c7', name: 'Priya', active: true }
  ]
};

beforeEach(() => {
  reviewApi.leadBoard.mockResolvedValue(board);
  reviewApi.assign.mockResolvedValue({ ok: true });
  reviewApi.leadReassign.mockResolvedValue({ ok: true });
});

test('K2-FT1 AC1 a read-only event summary opens from the queue with the event basics', async () => {
  render(<LeadAssignmentScreen view="queue" />);
  await screen.findByText('Gala');

  // The detail (purpose and times) is hidden until the summary is opened.
  expect(screen.queryByText('Fundraiser')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: /view details/i }));

  expect(await screen.findByText('Fundraiser')).toBeInTheDocument();
  expect(screen.getByText(/18:00/)).toBeInTheDocument();
  expect(screen.getByText(/21:00/)).toBeInTheDocument();
});

test('K2-FT2 AC2 each assign option shows the coordinator active-event count', async () => {
  render(<LeadAssignmentScreen view="queue" />);
  await screen.findByText('Gala');

  const select = screen.getByRole('combobox');
  expect(within(select).getByRole('option', { name: 'Alex (1 active)' })).toBeInTheDocument();
  expect(within(select).getByRole('option', { name: 'Priya (0 active)' })).toBeInTheDocument();
});

// K3 / SCRUM-184 — the Lead's Reassign control on the oversight screen. The rules
// (who may be moved, the one-coordinator result, the three notifications) are pinned
// by the domain and adapter tests; these check what the Lead actually sees and can do.
describe('K3 SCRUM-184 reassign from the oversight screen', () => {
  test('K3-FT1 AC1 only a live assigned event offers Reassign: not a waiting or a finished one', async () => {
    render(<LeadAssignmentScreen view="oversight" />);
    await screen.findByText('Workshop');

    // EVT-1 has no coordinator yet and EVT-3 is Completed, so only EVT-2 has a picker.
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Reassign' })).toHaveLength(1);
  });

  test('K3-FT2 AC2 the current coordinator is not offered as the new one', async () => {
    render(<LeadAssignmentScreen view="oversight" />);
    await screen.findByText('Workshop');

    const select = screen.getByLabelText('Reassign to');
    expect(within(select).getByRole('option', { name: /Priya/ })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /Alex/ })).toBeNull();
  });

  test('K3-FT3 AC1 Reassign stays disabled until a coordinator is chosen', async () => {
    render(<LeadAssignmentScreen view="oversight" />);
    await screen.findByText('Workshop');

    expect(screen.getByRole('button', { name: 'Reassign' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Reassign to'), 'c7');
    expect(screen.getByRole('button', { name: 'Reassign' })).toBeEnabled();
  });

  test('K3-FT4 AC1/AC3 choosing a coordinator and pressing Reassign moves the event and shows the new coordinator', async () => {
    const onNotice = jest.fn();
    const moved = {
      ...board,
      events: board.events.map((item) => (item.id === 'EVT-2' ? { ...item, coordinator_id: 'c7', coordinator_name: 'Priya' } : item))
    };
    reviewApi.leadBoard.mockResolvedValueOnce(board).mockResolvedValueOnce(moved);

    render(<LeadAssignmentScreen view="oversight" onNotice={onNotice} />);
    await screen.findByText('Workshop');
    await userEvent.selectOptions(screen.getByLabelText('Reassign to'), 'c7');
    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }));

    expect(reviewApi.leadReassign).toHaveBeenCalledWith('EVT-2', 'c7');
    expect(await screen.findByText('Coordinator: Priya')).toBeInTheDocument();
    expect(onNotice).toHaveBeenCalledWith('Reassigned to Priya.');
  });

  test('K3-FT5 AC2 a refused reassignment is shown to the Lead, not swallowed', async () => {
    reviewApi.leadReassign.mockRejectedValue(new Error('This event cannot be reassigned to that coordinator.'));

    render(<LeadAssignmentScreen view="oversight" />);
    await screen.findByText('Workshop');
    await userEvent.selectOptions(screen.getByLabelText('Reassign to'), 'c7');
    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be reassigned');
  });

  test('K3-FT7 a refused reassignment is shown beside the row it belongs to, not off-screen at the top', async () => {
    reviewApi.leadReassign.mockRejectedValue(new Error('Missing or insufficient permissions.'));

    render(<LeadAssignmentScreen view="oversight" />);
    await screen.findByText('Workshop');
    await userEvent.selectOptions(screen.getByLabelText('Reassign to'), 'c7');
    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }));

    const row = screen.getByText('Workshop').closest('article');
    expect(await within(row).findByRole('alert')).toHaveTextContent('Missing or insufficient permissions.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
