// K2 / SCRUM-183 — functional (component) tests for the two genuinely-new UI
// behaviours the Lead's assignment queue gains in this story:
//   AC1 — a read-only event summary that opens from each queued event.
//   AC2 — each assign option shows that coordinator's active-event count.
// The assign *action* itself (select -> Assign -> reviewApi.assign -> notice ->
// event leaves the queue) is A6 wiring already covered elsewhere, and the new
// assign *logic* (record + notify organiser) is pinned by the domain unit tests
// (K2-TC3/TC4), so neither is re-tested here. reviewApi is mocked, mirroring
// EventReviewScreen.test.js, so this stays a fast, isolated component test.

import { render, screen, waitFor, within } from '@testing-library/react';
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
    // (Counted by its label: K4 adds two filter dropdowns to this screen, which are not pickers.)
    expect(screen.getAllByLabelText('Reassign to')).toHaveLength(1);
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

// K4 / SCRUM-185 — what the Lead actually sees and can do on the oversight screen:
// the list of active events with coordinator, status, proposed date and time since
// last activity (AC1), the two filters (AC2), the per-coordinator summary (AC3) and no
// way to edit an event from here (AC4). The rules behind them (what is active, how
// rows are built and filtered) are pinned by the domain tests, not repeated here.
describe('K4 SCRUM-185 oversee all coordinators assignments', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const ago = (ms) => new Date(Date.now() - ms).toISOString();

  // Four active events (one unassigned) and three finished ones. Alex holds 2 active
  // events, Priya 1, Sam none, so the summary has a high, a middle and a zero.
  const k4Board = () => ({
    events: [
      { id: 'EVT-1', coordinator_id: null, status: 'SUBMITTED', name: 'Gala', event_date: '2026-11-01', reference_no: 'EVT-0001', organiser_id: 'org-1', submitted_at: ago(DAY), updated_at: ago(DAY) },
      { id: 'EVT-2', coordinator_id: 'c2', coordinator_name: 'Alex', status: 'UNDER_REVIEW', name: 'Workshop', event_date: '2026-06-01', reference_no: 'EVT-0002', updated_at: ago(3 * DAY) },
      { id: 'EVT-3', coordinator_id: 'c2', coordinator_name: 'Alex', status: 'APPROVED', name: 'Summit', event_date: '2026-07-01', reference_no: 'EVT-0003', updated_at: ago(10 * DAY) },
      { id: 'EVT-4', coordinator_id: 'c7', coordinator_name: 'Priya', status: 'CONFIRMED', name: 'Retreat', event_date: '2026-08-01', reference_no: 'EVT-0004', updated_at: ago(2 * 60 * 60 * 1000) },
      { id: 'EVT-5', coordinator_id: 'c2', coordinator_name: 'Alex', status: 'COMPLETED', name: 'Concert', event_date: '2026-03-01', reference_no: 'EVT-0005', updated_at: ago(40 * DAY) },
      { id: 'EVT-6', coordinator_id: 'c7', coordinator_name: 'Priya', status: 'CANCELLED', name: 'Picnic', event_date: '2026-04-01', reference_no: 'EVT-0006', updated_at: ago(30 * DAY) },
      { id: 'EVT-7', coordinator_id: null, status: 'REJECTED', name: 'Rally', event_date: '2026-05-01', reference_no: 'EVT-0007', updated_at: ago(20 * DAY) }
    ],
    coordinators: [
      { id: 'c2', name: 'Alex', active: true },
      { id: 'c7', name: 'Priya', active: true },
      { id: 'c9', name: 'Sam', active: true }
    ]
  });

  const rowOf = (name) => screen.getByText(name).closest('article');
  const summaryItem = (name) => within(screen.getByRole('region', { name: /active events per coordinator/i }))
    .getByText(new RegExp(name)).closest('li');
  const openOversight = async (onNotice) => {
    render(<LeadAssignmentScreen view="oversight" onNotice={onNotice} />);
    await screen.findByText('Workshop');
  };

  beforeEach(() => {
    reviewApi.leadBoard.mockResolvedValue(k4Board());
  });

  test('K4-FT1 AC1 the list shows every active event and none that is Completed, Cancelled or Rejected', async () => {
    await openOversight();

    ['Gala', 'Workshop', 'Summit', 'Retreat'].forEach((name) => expect(screen.getByText(name)).toBeInTheDocument());
    ['Concert', 'Picnic', 'Rally'].forEach((name) => expect(screen.queryByText(name)).toBeNull());
  });

  test('K4-FT2 AC1 each row shows its coordinator, status, proposed date and time since last activity', async () => {
    await openOversight();

    const row = within(rowOf('Workshop'));
    expect(row.getByText('Coordinator: Alex')).toBeInTheDocument();
    expect(row.getByText('UNDER_REVIEW')).toBeInTheDocument();
    expect(row.getByText(/2026-06-01/)).toBeInTheDocument();
    expect(row.getByText(/3 days ago/)).toBeInTheDocument();
    // The same row for a more recently touched event reads in its own units.
    expect(within(rowOf('Retreat')).getByText(/2 hrs ago/)).toBeInTheDocument();
  });

  test('K4-FT3 AC1 an active event nobody holds yet is listed as Unassigned, with its time since last activity', async () => {
    await openOversight();

    const row = within(rowOf('Gala'));
    expect(row.getByText('Unassigned')).toBeInTheDocument();
    expect(row.getByText(/1 day ago/)).toBeInTheDocument();
  });

  test('K4-FT4 AC1 boundary with only finished events on the board the Lead sees an empty message, not a blank page', async () => {
    const finishedOnly = k4Board();
    finishedOnly.events = finishedOnly.events.filter((item) => ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(item.status));
    reviewApi.leadBoard.mockResolvedValue(finishedOnly);

    render(<LeadAssignmentScreen view="oversight" />);

    expect(await screen.findByText(/no active events/i)).toBeInTheDocument();
  });

  test('K4-FT5 AC1 a board that fails to load is reported to the Lead', async () => {
    reviewApi.leadBoard.mockRejectedValue(new Error('This role cannot oversee event assignments.'));

    render(<LeadAssignmentScreen view="oversight" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('cannot oversee');
  });

  test('K4-FT6 AC2 filtering by coordinator shows only that coordinator\'s events, and All coordinators brings the rest back', async () => {
    await openOversight();
    const filter = screen.getByLabelText('Filter by coordinator');
    expect(within(filter).getByRole('option', { name: /all coordinators/i })).toBeInTheDocument();

    await userEvent.selectOptions(filter, 'c2');
    expect(screen.getByText('Workshop')).toBeInTheDocument();
    expect(screen.getByText('Summit')).toBeInTheDocument();
    expect(screen.queryByText('Retreat')).toBeNull();
    expect(screen.queryByText('Gala')).toBeNull();

    await userEvent.selectOptions(filter, '');
    expect(screen.getByText('Retreat')).toBeInTheDocument();
    expect(screen.getByText('Gala')).toBeInTheDocument();
  });

  test('K4-FT7 AC2 filtering by status offers only the active statuses and shows only events in the one chosen', async () => {
    await openOversight();
    const filter = screen.getByLabelText('Filter by status');

    // Draft never reaches the Lead (K1) and the three finished statuses are not on this view.
    expect(within(filter).getAllByRole('option').map((option) => option.value)).toEqual([
      '', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PLANNING', 'SAFETY_REVIEW', 'CONFIRMED'
    ]);

    await userEvent.selectOptions(filter, 'UNDER_REVIEW');
    expect(screen.getByText('Workshop')).toBeInTheDocument();
    expect(screen.queryByText('Summit')).toBeNull();
    expect(screen.queryByText('Gala')).toBeNull();
  });

  test('K4-FT8 AC2 the two filters combine, and a combination with no match says so instead of going blank', async () => {
    await openOversight();

    await userEvent.selectOptions(screen.getByLabelText('Filter by coordinator'), 'c2');
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'APPROVED');
    expect(screen.getByText('Summit')).toBeInTheDocument();
    expect(screen.queryByText('Workshop')).toBeNull();

    // Priya holds no Approved event.
    await userEvent.selectOptions(screen.getByLabelText('Filter by coordinator'), 'c7');
    expect(screen.getByText(/no events match/i)).toBeInTheDocument();
  });

  test('K4-FT9 AC3 the summary shows the number of active events per coordinator, finished events and a zero included', async () => {
    await openOversight();

    // Alex holds two active events and a Completed one, Priya one active and a Cancelled one, Sam none.
    expect(summaryItem('Alex')).toHaveTextContent(/\b2\b/);
    expect(summaryItem('Priya')).toHaveTextContent(/\b1\b/);
    expect(summaryItem('Sam')).toHaveTextContent(/\b0\b/);
  });

  test('K4-FT10 AC3 the summary stays the whole board when a filter narrows the list', async () => {
    await openOversight();

    await userEvent.selectOptions(screen.getByLabelText('Filter by coordinator'), 'c7');

    expect(screen.queryByText('Workshop')).toBeNull();
    expect(summaryItem('Alex')).toHaveTextContent(/\b2\b/);
    expect(summaryItem('Priya')).toHaveTextContent(/\b1\b/);
  });

  test('K4-FT11 AC3 after an event is reassigned the summary counts move with it', async () => {
    const moved = k4Board();
    moved.events = moved.events.map((item) => (item.id === 'EVT-2' ? { ...item, coordinator_id: 'c7', coordinator_name: 'Priya' } : item));
    reviewApi.leadBoard.mockResolvedValueOnce(k4Board()).mockResolvedValueOnce(moved);

    await openOversight();
    await userEvent.selectOptions(within(rowOf('Workshop')).getByLabelText('Reassign to'), 'c7');
    await userEvent.click(within(rowOf('Workshop')).getByRole('button', { name: 'Reassign' }));

    await waitFor(() => expect(summaryItem('Alex')).toHaveTextContent(/\b1\b/));
    expect(summaryItem('Priya')).toHaveTextContent(/\b2\b/);
  });

  test('K4-FT12 AC4 no event detail can be edited here: no text, number or date fields and no edit or save buttons', async () => {
    await openOversight();

    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /edit|save|amend|update|change/i })).toBeNull();
  });

  test('K4-FT13 AC4 the only things that can be done are filtering and the permitted reassign, which goes through leadReassign alone', async () => {
    await openOversight();

    // Filtering is only a view: it writes nothing.
    await userEvent.selectOptions(screen.getByLabelText('Filter by coordinator'), 'c2');
    await userEvent.selectOptions(screen.getByLabelText('Filter by coordinator'), '');
    expect(reviewApi.assign).not.toHaveBeenCalled();
    expect(reviewApi.leadReassign).not.toHaveBeenCalled();

    // Reassign is offered on each live assigned event and not on the unassigned one.
    expect(screen.getAllByRole('button', { name: 'Reassign' })).toHaveLength(3);
    expect(within(rowOf('Gala')).queryByRole('button', { name: 'Reassign' })).toBeNull();

    await userEvent.selectOptions(within(rowOf('Workshop')).getByLabelText('Reassign to'), 'c7');
    await userEvent.click(within(rowOf('Workshop')).getByRole('button', { name: 'Reassign' }));

    expect(reviewApi.leadReassign).toHaveBeenCalledTimes(1);
    expect(reviewApi.leadReassign).toHaveBeenCalledWith('EVT-2', 'c7');
    expect(reviewApi.assign).not.toHaveBeenCalled();
  });

  test('K4-FT14 AC3 a coordinator no longer active who still holds an active event is in the summary and the filter, but is never offered as a reassign target', async () => {
    const board = k4Board();
    board.events.push({ id: 'EVT-8', coordinator_id: 'c5', coordinator_name: 'Dana', status: 'PLANNING', name: 'Fair', event_date: '2026-09-01', reference_no: 'EVT-0008', updated_at: ago(DAY) });
    reviewApi.leadBoard.mockResolvedValue(board);
    await openOversight();

    expect(summaryItem('Dana')).toHaveTextContent(/\b1\b/);
    const filter = screen.getByLabelText('Filter by coordinator');
    expect(within(filter).getByRole('option', { name: /Dana/ })).toBeInTheDocument();
    await userEvent.selectOptions(filter, 'c5');
    expect(screen.getByText('Fair')).toBeInTheDocument();
    expect(screen.queryByText('Workshop')).toBeNull();

    await userEvent.selectOptions(filter, '');
    const picker = within(rowOf('Workshop')).getByLabelText('Reassign to');
    expect(within(picker).queryByRole('option', { name: /Dana/ })).toBeNull();
  });

  test('K4-FT15 AC2 the coordinator filter stays set after a reassign, and the moved event leaves that filtered view', async () => {
    const moved = k4Board();
    moved.events = moved.events.map((item) => (item.id === 'EVT-2' ? { ...item, coordinator_id: 'c7', coordinator_name: 'Priya' } : item));
    reviewApi.leadBoard.mockResolvedValueOnce(k4Board()).mockResolvedValueOnce(moved);
    await openOversight();

    await userEvent.selectOptions(screen.getByLabelText('Filter by coordinator'), 'c2');
    await userEvent.selectOptions(within(rowOf('Workshop')).getByLabelText('Reassign to'), 'c7');
    await userEvent.click(within(rowOf('Workshop')).getByRole('button', { name: 'Reassign' }));

    await waitFor(() => expect(screen.queryByText('Workshop')).toBeNull());
    expect(screen.getByText('Summit')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by coordinator')).toHaveValue('c2');
  });

  test('K4-FT16 AC1 an event with no recorded activity says so, and one dated in the future reads just now', async () => {
    const board = k4Board();
    delete board.events[0].updated_at;
    delete board.events[0].submitted_at;
    board.events[1].updated_at = ago(-DAY);
    reviewApi.leadBoard.mockResolvedValue(board);
    await openOversight();

    expect(within(rowOf('Gala')).getByText('No activity yet')).toBeInTheDocument();
    expect(within(rowOf('Workshop')).getByText(/just now/)).toBeInTheDocument();
  });

  test('K4-FT17 AC1 an event with no proposed date still shows a row, saying the date is not set', async () => {
    const board = k4Board();
    delete board.events[1].event_date;
    reviewApi.leadBoard.mockResolvedValue(board);
    await openOversight();

    expect(within(rowOf('Workshop')).getByText(/date not set/i)).toBeInTheDocument();
  });

  test('K4-FT18 AC3 the summary reads 2 active events, 1 active event and 0 active events, singular only for one', async () => {
    await openOversight();

    expect(summaryItem('Alex')).toHaveTextContent(/2 active events/);
    expect(summaryItem('Priya')).toHaveTextContent(/1 active event\b(?!s)/);
    expect(summaryItem('Sam')).toHaveTextContent(/0 active events/);
  });

  test('K4-FT19 AC1 with no events and no coordinators the Lead sees plain empty messages, not a blank screen', async () => {
    reviewApi.leadBoard.mockResolvedValue({ events: [], coordinators: [] });

    render(<LeadAssignmentScreen view="oversight" />);

    expect(await screen.findByText(/no active events/i)).toBeInTheDocument();
    expect(screen.getByText(/no (active )?coordinators/i)).toBeInTheDocument();
  });

  test('K4-FT20 AC1 while the board is loading the Lead sees a loading message, then the events', async () => {
    let release;
    reviewApi.leadBoard.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    render(<LeadAssignmentScreen view="oversight" />);
    expect(screen.getByText(/loading events/i)).toBeInTheDocument();

    release(k4Board());
    expect(await screen.findByText('Workshop')).toBeInTheDocument();
    expect(screen.queryByText(/loading events/i)).toBeNull();
  });

  test('K4-FT21 AC1 the list shows the longest-untouched event first, so a stalled one is at the top', async () => {
    await openOversight();

    const titles = screen.getAllByRole('article').map((row) => within(row).getByRole('heading', { level: 2 }).textContent);
    // Summit 10 days, Workshop 3 days, Gala 1 day, Retreat 2 hours.
    expect(titles).toEqual(['Summit', 'Workshop', 'Gala', 'Retreat']);
  });

  test('K4-FT22 AC3 the summary lists the busiest coordinator first, so overload is at the top', async () => {
    await openOversight();

    const items = within(screen.getByRole('region', { name: /active events per coordinator/i })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/Alex/);
    expect(items[1]).toHaveTextContent(/Priya/);
    expect(items[2]).toHaveTextContent(/Sam/);
  });
});
