import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventReviewScreen from './EventReviewScreen';
import { reviewApi } from './reviewApi';

// A7 — the safety planning notes section saves through its own API.
jest.mock('../safety/safetyApi', () => ({ savePlanningNotes: jest.fn(() => Promise.resolve({ ok: true })) }));
jest.mock('./reviewApi', () => ({ reviewApi: {
  list: jest.fn(), detail: jest.fn(), openReview: jest.fn(), clarify: jest.fn(), approve: jest.fn(), reject: jest.fn(),
  significantChangeImpact: jest.fn(), saveSignificantChange: jest.fn()
} }));

const baseEvent = { id: 'e1', name: 'Partner Summit', reference_no: 'EVT-001', event_date: '2026-11-04', start_time: '09:00', end_time: '17:00', expected_attendance: 100, purpose: 'Partners', description: 'Annual summit', status: 'UNDER_REVIEW', coordinator_id: 'c1', editable: true };
const detail = (changes = {}) => ({
  event: { ...baseEvent, ...changes }, coordinator: { id: 'c1', name: 'Sam Coordinator' },
  coordinators: [{ id: 'c1', name: 'Sam Coordinator' }, { id: 'c2', name: 'Alex Coordinator' }],
  clarifications: [], responses: [], assignments: [], venueBookings: []
});

beforeEach(() => {
  reviewApi.list.mockResolvedValue({ events: [baseEvent] });
  reviewApi.detail.mockResolvedValue(detail());
  reviewApi.openReview.mockResolvedValue({ ok: true });
  reviewApi.clarify.mockResolvedValue({ ok: true });
  reviewApi.approve.mockResolvedValue({ ok: true });
  reviewApi.reject.mockResolvedValue({ ok: true });
  reviewApi.significantChangeImpact.mockResolvedValue({
    venueBookings: [{ id: 'b1', label: 'Main Hall', status: 'APPROVED' }],
    equipmentReservations: [{ id: 'r1', label: 'Audio', status: 'RESERVED' }],
    registrationsCount: 42
  });
  reviewApi.saveSignificantChange.mockResolvedValue({ ok: true });
});

async function openRequest(props = {}) {
  render(<EventReviewScreen {...props} />);
  await userEvent.click(await screen.findByRole('button', { name: /view request/i }));
  await screen.findByRole('button', { name: /back to events/i });
}

// The clarification exchange and its action are on their own tab.
const openClarifications = () => userEvent.click(screen.getByRole('tab', { name: /^Clarifications/ }));

test('TC-060/061 requests clarification only after a non-empty message', async () => {
  await openRequest();
  await openClarifications();
  await userEvent.click(screen.getByRole('button', { name: /request clarification/i }));
  await userEvent.click(screen.getByRole('button', { name: /send request/i }));
  expect(screen.getByRole('alert')).toHaveTextContent('Clarification message is required.');
  expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  expect(reviewApi.clarify).not.toHaveBeenCalled();

  await userEvent.type(screen.getByRole('textbox'), 'Please confirm attendance.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'false');
  await userEvent.click(screen.getByRole('button', { name: /send request/i }));
  await waitFor(() => expect(reviewApi.clarify).toHaveBeenCalledWith('e1', 'Please confirm attendance.'));
});

test('TC-062 hides clarification and rejection actions while awaiting the organiser', async () => {
  reviewApi.detail.mockResolvedValue(detail({ open_clarification_id: 'q1' }));
  await openRequest();
  expect(screen.getByText(/awaiting the organiser/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /reject request/i })).not.toBeInTheDocument();
  await openClarifications();
  expect(screen.getByText(/awaiting the organiser/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /request clarification/i })).not.toBeInTheDocument();
});

test('TC-063 retains the timestamped clarification exchange', async () => {
  reviewApi.detail.mockResolvedValue({ ...detail(), clarifications: [{ id: 'q1', message: 'Confirm attendance', created_at: '2026-09-23T10:00:00Z' }], responses: [{ id: 'a1', message: 'It is 150.', created_at: '2026-09-23T11:00:00Z' }] });
  await openRequest();
  await openClarifications();
  const history = screen.getByRole('heading', { name: /clarification history/i }).parentElement;
  expect(within(history).getByText('Confirm attendance')).toBeInTheDocument();
  expect(within(history).getByText('It is 150.')).toBeInTheDocument();
});

test('TC-072/073 requires a rejection reason and sends the recorded reason', async () => {
  await openRequest();
  await userEvent.click(screen.getByRole('button', { name: /reject request/i }));
  await userEvent.click(screen.getByRole('button', { name: /reject event/i }));
  expect(screen.getByRole('alert')).toHaveTextContent('Rejection reason is required.');
  expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  expect(reviewApi.reject).not.toHaveBeenCalled();
  await userEvent.type(screen.getByRole('textbox'), 'No suitable venue can be secured.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /reject event/i }));
  await waitFor(() => expect(reviewApi.reject).toHaveBeenCalledWith('e1', 'No suitable venue can be secured.'));
});

// K3 / SCRUM-184 — this replaces C9's old TC-077 (the coordinator reassigning their own
// event). Only the Event Coordinator Lead reassigns now, from the oversight screen, so the
// coordinator in charge has no Reassign control at all, on any status.
test('K3-FT6 AC (replaces C9 criterion 5) the coordinator in charge has no Reassign control', async () => {
  await openRequest();

  expect(screen.getByRole('button', { name: /reject request/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /reassign/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: /new active coordinator/i })).not.toBeInTheDocument();
});

// TC-078 (an outgoing coordinator gets a read-only assignment view) is replaced by K5 SCRUM-186:
// a coordinator an event was reassigned away from has no view of it at all (K5-FT1, K5-TC3).

test.each(['SUBMITTED', 'UNDER_REVIEW', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'SAFETY_REVIEW'])(
  'F1 disables Find venues while an assigned event is %s',
  async (status) => {
    reviewApi.detail.mockResolvedValue(detail({ status }));
    const onFindVenues = jest.fn();
    await openRequest({ onFindVenues });

    const button = screen.getByRole('button', { name: /find venues/i });
    expect(button).toBeDisabled();
    expect(button).toHaveClass('cs-find-venues');
    expect(screen.getByText(/only for events with approved or planning status/i)).toBeInTheDocument();
    await userEvent.click(button);
    expect(onFindVenues).not.toHaveBeenCalled();
  }
);

test.each(['APPROVED', 'PLANNING'])('F1 enables Find venues while an assigned event is %s', async (status) => {
  reviewApi.detail.mockResolvedValue(detail({ status }));
  const onFindVenues = jest.fn();
  await openRequest({ onFindVenues });

  const button = screen.getByRole('button', { name: /find venues/i });
  expect(button).toBeEnabled();
  await userEvent.click(button);
  expect(onFindVenues).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', status }));
});

test('F7 shows each venue booking with its complete decision information inside the event view', async () => {
  const reason = 'The loading bay is unavailable throughout the requested setup window.';
  reviewApi.detail.mockResolvedValue({
    ...detail({ status: 'PLANNING' }),
    venueBookings: [
      {
        booking_id: 'VB-APPROVED', venue_name: 'Harbour Hall', status: 'APPROVED',
        start_datetime: '2026-11-04T09:00:00.000Z', end_datetime: '2026-11-04T17:00:00.000Z',
        decided_at: '2026-10-14T09:30:00.000Z', decision_reason: null
      },
      {
        booking_id: 'VB-REJECTED', venue_name: 'Garden Pavilion', status: 'REJECTED',
        start_datetime: '2026-11-04T09:00:00.000Z', end_datetime: '2026-11-04T17:00:00.000Z',
        decided_at: '2026-10-14T10:00:00.000Z', decision_reason: reason
      }
    ]
  });

  await openRequest();

  const section = screen.getByRole('region', { name: /venue booking status/i });
  expect(within(section).getByText('Harbour Hall')).toBeInTheDocument();
  expect(within(section).getByText('Garden Pavilion')).toBeInTheDocument();
  expect(within(section).getByText(reason)).toBeInTheDocument();
  expect(within(section).getAllByText(/2026|nov/i).length).toBeGreaterThan(0);
});

test('D2 shows all existing arrangements and requires acknowledgement before saving', async () => {
  const planningEvent = { ...baseEvent, status: 'PLANNING' };
  let resolveImpact;
  reviewApi.list.mockResolvedValue({ events: [planningEvent] });
  reviewApi.detail.mockResolvedValue(detail(planningEvent));
  reviewApi.significantChangeImpact.mockImplementation(() => new Promise((resolve) => { resolveImpact = resolve; }));
  await openRequest();
  await userEvent.click(screen.getByRole('button', { name: /edit significant details/i }));

  await act(async () => {
    resolveImpact({
      venueBookings: [{ id: 'b1', label: 'Main Hall', status: 'APPROVED' }],
      equipmentReservations: [{ id: 'r1', label: 'Audio', status: 'RESERVED' }],
      registrationsCount: 42
    });
  });
  await waitFor(() => expect(screen.queryByText(/checking existing arrangements/i)).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: /save significant changes/i })).toBeDisabled();
  await userEvent.clear(screen.getByLabelText(/expected attendance/i));
  await userEvent.type(screen.getByLabelText(/expected attendance/i), '125');
  const warning = await screen.findByRole('complementary', { name: 'Significant change impact' });
  expect(within(warning).getByText(/main hall.*approved/i)).toBeInTheDocument();
  expect(within(warning).getByText(/audio.*reserved/i)).toBeInTheDocument();
  expect(within(warning).getByText(/attendee registrations: 42/i)).toBeInTheDocument();

  const save = screen.getByRole('button', { name: /save significant changes/i });
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByLabelText(/reviewed and acknowledge/i));
  expect(save).toBeEnabled();
  await userEvent.click(save);
  await waitFor(() => expect(reviewApi.saveSignificantChange).toHaveBeenCalledWith(expect.objectContaining({
    eventId: 'e1',
    values: expect.objectContaining({ expected_attendance: 125 }),
    acknowledged: true
  })));
});

test('D2 cancelling a significant edit leaves the event unsaved', async () => {
  const planningEvent = { ...baseEvent, status: 'PLANNING' };
  let resolveImpact;
  reviewApi.list.mockResolvedValue({ events: [planningEvent] });
  reviewApi.detail.mockResolvedValue(detail(planningEvent));
  reviewApi.significantChangeImpact.mockImplementation(() => new Promise((resolve) => { resolveImpact = resolve; }));
  await openRequest();
  await userEvent.click(screen.getByRole('button', { name: /edit significant details/i }));
  await act(async () => {
    resolveImpact({ venueBookings: [], equipmentReservations: [], registrationsCount: 0 });
  });
  await waitFor(() => expect(screen.queryByText(/checking existing arrangements/i)).not.toBeInTheDocument());
  await userEvent.clear(screen.getByLabelText(/expected attendance/i));
  await userEvent.type(screen.getByLabelText(/expected attendance/i), '125');
  await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
  expect(reviewApi.saveSignificantChange).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: /edit significant event details/i })).not.toBeInTheDocument();
});

// C6 — approve a request the coordinator has reviewed (Under Review -> Approved).
// This is the UI that the venue merge dropped: reviewApi.approve and canApproveEvent
// existed, but nothing on the screen called them. These tests guard the button.
describe('C6 approve a submitted request', () => {
  test('C6 TC1 the assigned coordinator sees Approve on an Under Review request and it calls reviewApi.approve', async () => {
    const onNotice = jest.fn();
    await openRequest({ onNotice });

    const approve = screen.getByRole('button', { name: /^approve/i });
    expect(approve).toBeEnabled();
    await userEvent.click(approve);

    await waitFor(() => expect(reviewApi.approve).toHaveBeenCalledWith('e1'));
    expect(reviewApi.approve).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Event request approved.'));
  });

  test('C6 TC2 after approving, the detail refreshes to Approved and Approve is no longer offered', async () => {
    reviewApi.detail
      .mockResolvedValueOnce(detail())
      .mockResolvedValue(detail({ status: 'APPROVED' }));
    await openRequest();

    await userEvent.click(screen.getByRole('button', { name: /^approve/i }));

    // The status pill is the signal that the refreshed detail has landed ("Approving…"
    // does not match /^approve/, so the button's absence alone would pass too early).
    expect(await screen.findByText('APPROVED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject request/i })).not.toBeInTheDocument();
  });

  test.each(['SUBMITTED', 'APPROVED', 'PLANNING', 'REJECTED', 'CANCELLED', 'COMPLETED'])(
    'C6 TC3 Approve is not offered while the event is %s',
    async (status) => {
      reviewApi.detail.mockResolvedValue(detail({ status }));
      await openRequest();
      expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument();
    }
  );

  test('C6 TC5 Approve is unavailable while a clarification is open, and the screen says so', async () => {
    reviewApi.detail.mockResolvedValue(detail({ open_clarification_id: 'q1' }));
    await openRequest();
    expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument();
    expect(screen.getByText(/awaiting the organiser/i)).toHaveTextContent(/approve/i);
  });

  test('C6 TC6 a failed approval shows the error, keeps the event Under Review and offers Approve again', async () => {
    const onNotice = jest.fn();
    reviewApi.approve.mockRejectedValueOnce(new Error('This event cannot be approved now.'));
    await openRequest({ onNotice });

    await userEvent.click(screen.getByRole('button', { name: /^approve/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This event cannot be approved now.');
    expect(onNotice).not.toHaveBeenCalled();
    expect(screen.getByText('UNDER_REVIEW')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^approve/i })).toBeEnabled();
  });

  test('C6 TC7 while approving, Approve and Reject are locked so the decision cannot be sent twice', async () => {
    let finish;
    reviewApi.approve.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await openRequest();

    await userEvent.click(screen.getByRole('button', { name: /^approve/i }));

    const busy = await screen.findByRole('button', { name: /approving/i });
    expect(busy).toBeDisabled();
    expect(screen.getByRole('button', { name: /reject request/i })).toBeDisabled();
    await userEvent.click(busy);
    expect(reviewApi.approve).toHaveBeenCalledTimes(1);

    await act(async () => { finish({ ok: true }); });
  });
});

// C2 / SCRUM-103 — the coordinator's "Assigned events" list. The list is scoped to
// the signed-in coordinator by reviewApi.list + firestore.rules (AC1, covered by
// the pure unit tests in domain/assignedEvents.test.js); these component tests
// cover the row columns (AC2) and the status filter + proposed-date sort (AC3).
const assignedEvents = [
  { id: 'e-early', name: 'Alumni Mixer', reference_no: 'EVT-010', organiser_id: 'u1', organiser_name: 'Nadia Organiser', event_date: '2026-11-02', status: 'APPROVED', coordinator_id: 'c1', editable: true, updated_at: '2026-10-08T11:58:00Z' },
  { id: 'e-late', name: 'Partner Summit', reference_no: 'EVT-011', organiser_id: 'u2', organiser_name: 'Owen Organiser', event_date: '2026-11-20', status: 'SUBMITTED', coordinator_id: 'c1', editable: true, updated_at: '2026-10-06T12:00:00Z' },
  { id: 'e-mid', name: 'Careers Fair', reference_no: 'EVT-012', organiser_id: 'u3', organiser_name: 'Priya Organiser', event_date: '2026-11-10', status: 'APPROVED', coordinator_id: 'c1', editable: true, updated_at: '2026-10-08T09:00:00Z' }
];
const rowNames = () => screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

test('TC-126 each assigned row shows name, organiser, proposed date, status and time since last activity', async () => {
  reviewApi.list.mockResolvedValue({ events: [assignedEvents[0]] });
  render(<EventReviewScreen />);
  const row = (await screen.findByRole('heading', { name: 'Alumni Mixer' })).closest('article');
  expect(within(row).getByText('Nadia Organiser')).toBeInTheDocument();
  expect(within(row).getByText('2026-11-02')).toBeInTheDocument();
  expect(within(row).getByText('APPROVED')).toBeInTheDocument();
  expect(within(row).getByText(/last activity:/i)).toBeInTheDocument();
});

test('TC-127 the status filter narrows the list to the chosen status', async () => {
  reviewApi.list.mockResolvedValue({ events: assignedEvents });
  render(<EventReviewScreen />);
  await screen.findByRole('heading', { name: 'Alumni Mixer' });
  expect(screen.getByRole('heading', { name: 'Partner Summit' })).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByRole('combobox', { name: /filter by status/i }), 'SUBMITTED');
  expect(screen.getByRole('heading', { name: 'Partner Summit' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Alumni Mixer' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Careers Fair' })).not.toBeInTheDocument();
});

test('TC-128 sorting by proposed date orders ascending, then descending on toggle', async () => {
  reviewApi.list.mockResolvedValue({ events: assignedEvents });
  render(<EventReviewScreen />);
  await screen.findByRole('heading', { name: 'Alumni Mixer' });
  expect(rowNames()).toEqual(['Alumni Mixer', 'Careers Fair', 'Partner Summit']);

  await userEvent.click(screen.getByRole('button', { name: /sort by proposed date/i }));
  expect(rowNames()).toEqual(['Partner Summit', 'Careers Fair', 'Alumni Mixer']);
});

// The event detail page is split into tabs. TC-276 – TC-278 in docs/test-cases.md.
describe('the coordinator event detail tabs', () => {
  test('TC-276 the detail opens on the request, with the clarifications on a second tab', async () => {
    reviewApi.detail.mockResolvedValue({ ...detail(), clarifications: [{ id: 'q1', message: 'Confirm attendance', created_at: '2026-09-23T10:00:00Z' }], responses: [] });
    await openRequest();

    expect(screen.getByRole('tab', { name: 'Event request' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^Clarifications/ })).toHaveTextContent('1');
    expect(screen.getByText('Annual summit')).toBeVisible();
    expect(screen.queryByRole('heading', { name: /clarification history/i })).not.toBeInTheDocument();

    await openClarifications();
    expect(screen.getByRole('heading', { name: /clarification history/i })).toBeVisible();
    expect(screen.getByText('Annual summit')).not.toBeVisible();
  });

  test('TC-277 Request clarification is on the Clarifications tab; Reject stays on the request', async () => {
    await openRequest();

    expect(screen.queryByRole('button', { name: /request clarification/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject request/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reassign event/i })).not.toBeInTheDocument();

    await openClarifications();
    expect(screen.getByRole('button', { name: /request clarification/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject request/i })).not.toBeInTheDocument();
  });

  test('TC-278 switching tab closes a half-written action form', async () => {
    await openRequest();
    await userEvent.click(screen.getByRole('button', { name: /reject request/i }));
    expect(screen.getByRole('heading', { name: 'Reject request' })).toBeInTheDocument();

    await openClarifications();
    await userEvent.click(screen.getByRole('tab', { name: 'Event request' }));

    expect(screen.queryByRole('heading', { name: 'Reject request' })).not.toBeInTheDocument();
    expect(reviewApi.reject).not.toHaveBeenCalled();
  });
});

// C3 — the coordinator sees everything the organiser submitted in one place, so a
// request can be understood fully before a decision. The review detail (Event
// request tab) must show every requirement group and the submission metadata
// (AC1, AC2); opening a Submitted request starts the review (AC3). SCRUM id to be
// confirmed. TC-279 – TC-281 in docs/test-cases.md.
describe('C3 the full event request in the review view', () => {
  // A request submitted with every optional section filled in.
  const fullDetail = () => ({
    ...detail({
      submitted_at: '2026-10-01T03:00:00Z',
      preferred_location: 'CENTRAL',
      required_layout: 'THEATRE',
      facilities: ['WIFI', 'POWER_POINTS'],
      accessibility: ['WHEELCHAIR_ACCESS', 'HEARING_LOOP'],
      accessibility_notes: 'Two wheelchair users expected.',
      equipment_required: 'YES',
      equipment: [{ equipment_type: 'AUDIO', quantity: 2, notes: 'Handheld mics' }, { equipment_type: 'LIGHTING', quantity: 1 }],
      registration_required: 'YES',
      registration_capacity: 120,
      registration_open_date: '2026-10-15',
      registration_close_date: '2026-10-30'
    }),
    organiser: { id: 'u1', name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: '+65 9123 4567' }
  });

  test('TC-279 the request tab shows venue requirements, accessibility, equipment and registration needs', async () => {
    reviewApi.detail.mockResolvedValue(fullDetail());
    await openRequest();

    // The four requirement groups the story names each get their own section.
    expect(screen.getByRole('heading', { name: /venue requirements/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /accessibility/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /equipment/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /registration/i })).toBeInTheDocument();

    // A representative value from each group reaches the screen.
    expect(screen.getByText(/WIFI/)).toBeInTheDocument();                       // venue requirements
    expect(screen.getByText('Two wheelchair users expected.')).toBeInTheDocument(); // accessibility
    expect(screen.getByText(/AUDIO/)).toBeInTheDocument();                      // equipment
    expect(screen.getByText(/120/)).toBeInTheDocument();                        // registration capacity
  });

  test('TC-280 the view shows the reference number, submission timestamp and the organiser contact', async () => {
    reviewApi.detail.mockResolvedValue(fullDetail());
    await openRequest();

    expect(screen.getByText('EVT-001')).toBeInTheDocument();          // reference number
    expect(screen.getByText(/submitted/i)).toBeInTheDocument();       // submission timestamp (field label)
    expect(screen.getByText('Nadia Organiser')).toBeInTheDocument();  // organiser contact
    expect(screen.getByText('nadia@smu.edu.sg')).toBeInTheDocument();
    expect(screen.getByText(/9123 4567/)).toBeInTheDocument();
  });

  test('TC-281 opening a Submitted request starts the review (Submitted -> Under Review)', async () => {
    const submitted = { ...baseEvent, id: 'e9', status: 'SUBMITTED', editable: true };
    reviewApi.list.mockResolvedValue({ events: [submitted] });
    reviewApi.detail.mockResolvedValue(detail({ id: 'e9', status: 'UNDER_REVIEW' }));

    render(<EventReviewScreen />);
    await userEvent.click(await screen.findByRole('button', { name: /view request/i }));
    await screen.findByRole('button', { name: /back to events/i });

    // The transition (and the record of who opened it) is reviewApi.openReview.
    await waitFor(() => expect(reviewApi.openReview).toHaveBeenCalledWith('e9'));
  });
});

// A7 / SCRUM-170 AC3 — TC-370. The coordinator finds the safety planning notes on
// the event they are planning, and saving them reloads the event and says so.
describe("TC-370 safety planning notes on the coordinator's event", () => {
  test('a Planning event offers the notes for editing, and a save reloads the event', async () => {
    const { savePlanningNotes } = require('../safety/safetyApi');
    reviewApi.list.mockResolvedValue({ events: [{ ...baseEvent, status: 'PLANNING' }] });
    reviewApi.detail.mockResolvedValue(detail({ status: 'PLANNING', equipment_placement: 'Speakers by the stage' }));
    const onNotice = jest.fn();
    await openRequest({ onNotice });

    const notes = screen.getByRole('region', { name: 'Safety planning notes' });
    expect(within(notes).getByLabelText('Equipment placement')).toHaveValue('Speakers by the stage');
    await userEvent.click(within(notes).getByRole('button', { name: 'Save safety notes' }));

    expect(savePlanningNotes).toHaveBeenCalledWith({ eventId: 'e1', values: { equipment_placement: 'Speakers by the stage', crowd_movement: '' } });
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Safety planning notes saved.'));
    expect(reviewApi.detail).toHaveBeenCalledTimes(2);
  });

  test('an event still Under Review shows the notes read only', async () => {
    await openRequest();
    const notes = screen.getByRole('region', { name: 'Safety planning notes' });
    expect(within(notes).queryByRole('textbox')).not.toBeInTheDocument();
    expect(notes).toHaveTextContent('Crowd movementNot recorded');
  });
});

// K5 / SCRUM-186 — what the coordinator sees when an event is not theirs to open
// (AC3). The server and the adapter refuse; the screen must show that refusal and
// nothing of the event, and must not offer any action on it.
describe('K5 SCRUM-186 an event that is not assigned to the coordinator cannot be opened', () => {
  const refusal = 'You are not authorised to view this event.';

  test('K5-FT1 AC3 opening an event by id that is refused shows the not-authorised message and no event details or actions', async () => {
    reviewApi.list.mockResolvedValue({ events: [] });
    reviewApi.detail.mockRejectedValue(new Error(refusal));

    render(<EventReviewScreen initialEventId="e2" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(refusal);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve|reject|request clarification|find venues|back to events/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Partner Summit')).not.toBeInTheDocument();
  });

  test('K5-FT2 AC3 a refused event leaves the coordinator on their list, and the events assigned to them still open', async () => {
    reviewApi.detail.mockRejectedValueOnce(new Error(refusal));

    render(<EventReviewScreen initialEventId="e2" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(refusal);

    await userEvent.click(await screen.findByRole('button', { name: /view request/i }));
    expect(await screen.findByRole('button', { name: /back to events/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Partner Summit' })).toBeInTheDocument();
  });

  test('K5-FT3 AC1 the assigned events list shows only what is assigned and has no read-only reassigned view', async () => {
    reviewApi.list.mockResolvedValue({ events: [baseEvent, { ...baseEvent, id: 'e5', name: 'Second Workshop', reference_no: 'EVT-005' }] });

    render(<EventReviewScreen />);

    expect(await screen.findByText('Partner Summit')).toBeInTheDocument();
    expect(screen.getByText('Second Workshop')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /view request/i })).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('button', { name: /view request/i })[0]);
    await screen.findByRole('button', { name: /back to events/i });
    expect(screen.queryByText(/was reassigned|previously assigned/i)).not.toBeInTheDocument();
  });
});
