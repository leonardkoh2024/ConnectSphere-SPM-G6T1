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
