import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventReviewScreen from './EventReviewScreen';
import { reviewApi } from './reviewApi';
import { sendEventForSafetyCheck } from '../safety/safetyApi';
import { releaseCancelledEventBookings } from '../venues/venuesApi';
import { releaseCancelledEventReservations } from '../equipment/equipmentApi';

// A7 — the safety planning notes section saves through its own API.
jest.mock('../safety/safetyApi', () => ({
  savePlanningNotes: jest.fn(() => Promise.resolve({ ok: true })),
  sendEventForSafetyCheck: jest.fn(() => Promise.resolve({ ok: true, status: 'SAFETY_REVIEW' }))
}));
jest.mock('../../lib/firebase', () => ({ auth: { currentUser: { uid: 'c1' } } }));
jest.mock('./reviewApi', () => ({ reviewApi: {
  list: jest.fn(), detail: jest.fn(), openReview: jest.fn(), clarify: jest.fn(), approve: jest.fn(), reject: jest.fn(),
  cancel: jest.fn(), complete: jest.fn(), notifyCancelledAttendees: jest.fn(),
  significantChangeImpact: jest.fn(), saveEventEdit: jest.fn(), registeredCount: jest.fn(), retryRerequest: jest.fn()
} }));
jest.mock('../venues/venuesApi', () => ({ releaseCancelledEventBookings: jest.fn() }));
jest.mock('../equipment/equipmentApi', () => ({ releaseCancelledEventReservations: jest.fn() }));

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
  reviewApi.complete.mockResolvedValue({ ok: true });
  reviewApi.cancel.mockResolvedValue({ eventId: 'e1', eventName: 'Partner Summit', reason: 'Speaker unavailable', attendees: [] });
  reviewApi.notifyCancelledAttendees.mockResolvedValue({ notified: 0 });
  releaseCancelledEventBookings.mockResolvedValue([]);
  releaseCancelledEventReservations.mockResolvedValue({ released: 0 });
  reviewApi.significantChangeImpact.mockResolvedValue({
    venueBookings: [{ id: 'b1', label: 'Main Hall', status: 'APPROVED' }],
    equipmentReservations: [{ id: 'r1', label: 'Audio', status: 'RESERVED' }],
    registrationsCount: 42
  });
  reviewApi.saveEventEdit.mockResolvedValue({ ok: true, changed: 1 });
  reviewApi.registeredCount.mockResolvedValue(0);
  reviewApi.retryRerequest.mockResolvedValue({ sent: true });
});

async function openRequest(props = {}) {
  render(<EventReviewScreen {...props} />);
  // Assigned Events now opens on Active events. Tests whose fixture contains
  // only a terminal event must reveal archived statuses before opening it.
  await waitFor(() => {
    expect(
      screen.queryByRole('button', { name: /view request/i })
      || screen.queryByRole('combobox', { name: /filter by status/i })
    ).toBeTruthy();
  });
  if (!screen.queryByRole('button', { name: /view request/i })) {
    const statusFilter = screen.queryByRole('combobox', { name: /filter by status/i });
    if (statusFilter) userEvent.selectOptions(statusFilter, 'ALL');
  }
  userEvent.click(await screen.findByRole('button', { name: /view request/i }));
  await screen.findByRole('button', { name: /back to events/i });
}

// The clarification exchange and its action are on their own tab.
const openClarifications = () => userEvent.click(screen.getByRole('tab', { name: /^Clarifications/ }));

test('TC-0218 /061 requests clarification only after a non-empty message', async () => {
  await openRequest();
  await openClarifications();
  userEvent.click(screen.getByRole('button', { name: /request clarification/i }));
  userEvent.click(screen.getByRole('button', { name: /send request/i }));
  expect(screen.getByRole('alert')).toHaveTextContent('Clarification message is required.');
  expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  expect(reviewApi.clarify).not.toHaveBeenCalled();

  userEvent.type(screen.getByRole('textbox'), 'Please confirm attendance.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'false');
  userEvent.click(screen.getByRole('button', { name: /send request/i }));
  await waitFor(() => expect(reviewApi.clarify).toHaveBeenCalledWith('e1', 'Please confirm attendance.'));
});

test('TC-0219 hides clarification and rejection actions while awaiting the organiser', async () => {
  reviewApi.detail.mockResolvedValue(detail({ open_clarification_id: 'q1' }));
  await openRequest();
  expect(screen.getByText(/awaiting the organiser/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /reject request/i })).not.toBeInTheDocument();
  await openClarifications();
  expect(screen.getByText(/awaiting the organiser/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /request clarification/i })).not.toBeInTheDocument();
});

test('TC-0220 retains the timestamped clarification exchange', async () => {
  reviewApi.detail.mockResolvedValue({ ...detail(), clarifications: [{ id: 'q1', message: 'Confirm attendance', created_at: '2026-09-23T10:00:00Z' }], responses: [{ id: 'a1', message: 'It is 150.', created_at: '2026-09-23T11:00:00Z' }] });
  await openRequest();
  await openClarifications();
  const history = screen.getByRole('heading', { name: /clarification history/i }).parentElement;
  expect(within(history).getByText('Confirm attendance')).toBeInTheDocument();
  expect(within(history).getByText('It is 150.')).toBeInTheDocument();
});

test('TC-0306 /073 requires a rejection reason and sends the recorded reason', async () => {
  await openRequest();
  userEvent.click(screen.getByRole('button', { name: /reject request/i }));
  userEvent.click(screen.getByRole('button', { name: /reject event/i }));
  expect(screen.getByRole('alert')).toHaveTextContent('Rejection reason is required.');
  expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  expect(reviewApi.reject).not.toHaveBeenCalled();
  userEvent.type(screen.getByRole('textbox'), 'No suitable venue can be secured.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  userEvent.click(screen.getByRole('button', { name: /reject event/i }));
  await waitFor(() => expect(reviewApi.reject).toHaveBeenCalledWith('e1', 'No suitable venue can be secured.'));
});

test('TC-2444 L1 SCRUM-187 D3 the coordinator can send a planning event for its safety check once arrangements are secured', async () => {
  const onNotice = jest.fn();
  reviewApi.detail.mockResolvedValue({
    ...detail({ status: 'PLANNING' }),
    venueBookings: [{ booking_id: 'b1', venue_name: 'Hall A', status: 'APPROVED' }],
    equipmentArrangements: { lines: [{ key: '0-AUDIO', label: 'Audio × 2', arranged: true, status: { label: 'Approved', tone: 'positive' } }] }
  });
  await openRequest({ onNotice });
  userEvent.click(screen.getByRole('button', { name: /send for safety check/i }));
  await waitFor(() => expect(sendEventForSafetyCheck).toHaveBeenCalledWith('e1'));
  expect(onNotice).toHaveBeenCalledWith('Event sent for its safety check.');
});

test('TC-0505 D3 AC3 sending is unavailable while an arrangement is missing, and the view names it', async () => {
  reviewApi.detail.mockResolvedValue({
    ...detail({ status: 'PLANNING' }),
    venueBookings: [{ booking_id: 'b1', venue_name: 'Hall A', status: 'APPROVED' }],
    equipmentArrangements: { lines: [{ key: '1-LIGHTING', label: 'Lighting × 1', arranged: false, status: { label: 'Pending', tone: 'warning' } }] }
  });
  await openRequest();
  expect(screen.getByRole('button', { name: /send for safety check/i })).toBeDisabled();
  expect(screen.getByText(/still outstanding: Lighting × 1/i)).toBeInTheDocument();
});

test('TC-0506 D3 AC3 an event with no approved venue booking names that as outstanding', async () => {
  reviewApi.detail.mockResolvedValue(detail({ status: 'PLANNING' }));
  await openRequest();
  expect(screen.getByRole('button', { name: /send for safety check/i })).toBeDisabled();
  expect(screen.getByText(/still outstanding: an approved venue booking/i)).toBeInTheDocument();
});

test('TC-0507 D3 AC4 a confirmed event shows its confirmation time in SGT', async () => {
  reviewApi.detail.mockResolvedValue(detail({ status: 'CONFIRMED', confirmed_at: '2026-11-03T08:30:00.000Z' }));
  await openRequest();
  expect(screen.getByText(/16:30 SGT/)).toBeInTheDocument();
});

test('TC-0519 D4 cancellation requires a reason and explicit confirmation, then releases arrangements', async () => {
  const onNotice = jest.fn();
  reviewApi.detail.mockResolvedValue(detail({ status: 'PLANNING' }));
  await openRequest({ onNotice });
  userEvent.click(screen.getByRole('button', { name: /^cancel event$/i }));

  const confirm = screen.getByRole('button', { name: /confirm cancellation/i });
  expect(confirm).toBeDisabled();
  userEvent.type(screen.getByLabelText(/^reason/i), 'Speaker unavailable');
  expect(confirm).toBeDisabled();
  userEvent.click(screen.getByRole('checkbox'));
  expect(confirm).toBeEnabled();
  userEvent.click(confirm);

  await waitFor(() => expect(reviewApi.cancel).toHaveBeenCalledWith('e1', 'Speaker unavailable'));
  expect(reviewApi.notifyCancelledAttendees).toHaveBeenCalledWith(expect.objectContaining({
    eventId: 'e1', reason: 'Speaker unavailable'
  }));
  expect(releaseCancelledEventBookings).toHaveBeenCalledWith(expect.objectContaining({
    eventId: 'e1', reason: 'Speaker unavailable'
  }));
  expect(releaseCancelledEventReservations).toHaveBeenCalledWith({
    eventId: 'e1', reason: 'Speaker unavailable'
  });

  expect(onNotice).toHaveBeenCalledWith('Event cancelled and arrangements released.');
});

test("TC-0546 D5 AC1/AC2 offers completion after the event end and sends the completion action", async () => {
  const finished = { ...baseEvent, status: "CONFIRMED", event_date: "2020-01-01" };
  const onNotice = jest.fn();
  reviewApi.list.mockResolvedValue({ events: [finished] });
  reviewApi.detail.mockResolvedValue(detail(finished));

  await openRequest({ onNotice });
  userEvent.click(screen.getByRole("button", { name: /mark completed/i }));

  await waitFor(() => expect(reviewApi.complete).toHaveBeenCalledWith("e1"));
  await waitFor(() => expect(onNotice).toHaveBeenCalledWith("Event marked completed."));
});

test('TC-0520 D4 cancellation cleanup failures are reported after retaining the cancellation', async () => {
  const onNotice = jest.fn();
  reviewApi.detail.mockResolvedValue(detail({ status: 'PLANNING' }));
  releaseCancelledEventReservations
    .mockRejectedValueOnce(new Error('Equipment service unavailable.'))
    .mockResolvedValueOnce({ released: 1 });
  await openRequest({ onNotice });
  userEvent.click(screen.getByRole('button', { name: /^cancel event$/i }));
  userEvent.type(screen.getByLabelText(/^reason/i), 'Speaker unavailable');
  userEvent.click(screen.getByRole('checkbox'));
  userEvent.click(screen.getByRole('button', { name: /confirm cancellation/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/event was cancelled, but cleanup is incomplete/i);
  expect(screen.getByRole('alert')).toHaveTextContent(/equipment service unavailable/i);
  expect(releaseCancelledEventBookings).toHaveBeenCalled();

  userEvent.click(screen.getByRole('button', { name: /retry incomplete cleanup/i }));

  await waitFor(() => expect(releaseCancelledEventReservations).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Cancellation cleanup completed.'));
  expect(screen.queryByRole('button', { name: /retry incomplete cleanup/i })).not.toBeInTheDocument();
});

// K3 / SCRUM-184 — this replaces C9's old test (the coordinator reassigning their own
// event). Only the Event Coordinator Lead reassigns now, from the oversight screen, so the
// coordinator in charge has no Reassign control at all, on any status.
test('TC-2315 K3 AC (replaces C9 criterion 5) the coordinator in charge has no Reassign control', async () => {
  await openRequest();

  expect(screen.getByRole('button', { name: /reject request/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /reassign/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: /new active coordinator/i })).not.toBeInTheDocument();
});

// C9's read-only assignment view for an outgoing coordinator is replaced by K5 SCRUM-186:
// a coordinator an event was reassigned away from has no view of it at all (K5).

test.each(['SUBMITTED', 'UNDER_REVIEW', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'SAFETY_REVIEW'])(
  'TC-0877 F1 disables Find venues while an assigned event is %s',
  async (status) => {
    reviewApi.detail.mockResolvedValue(detail({ status }));
    const onFindVenues = jest.fn();
    await openRequest({ onFindVenues });

    const button = screen.getByRole('button', { name: /find venues/i });
    expect(button).toBeDisabled();
    expect(button).toHaveClass('cs-find-venues');
    expect(screen.getByText(/only for events with approved or planning status/i)).toBeInTheDocument();
    userEvent.click(button);
    expect(onFindVenues).not.toHaveBeenCalled();
  }
);

test.each(['APPROVED', 'PLANNING'])('TC-0878 F1 enables Find venues while an assigned event is %s', async (status) => {
  reviewApi.detail.mockResolvedValue(detail({ status }));
  const onFindVenues = jest.fn();
  await openRequest({ onFindVenues });

  const button = screen.getByRole('button', { name: /find venues/i });
  expect(button).toBeEnabled();
  userEvent.click(button);
  expect(onFindVenues).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', status }));
});

test('TC-0955 F7 shows each venue booking with its complete decision information inside the event view', async () => {
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

  userEvent.click(screen.getByRole('tab', { name: /^Arrangements/ }));
  const section = screen.getByRole('region', { name: /venue booking status/i });
  expect(within(section).getByText('Harbour Hall')).toBeInTheDocument();
  expect(within(section).getByText('Garden Pavilion')).toBeInTheDocument();
  expect(within(section).getByText(reason)).toBeInTheDocument();
  expect(within(section).getAllByText(/2026|nov/i).length).toBeGreaterThan(0);
});

test('TC-0468 D2 shows all existing arrangements and requires acknowledgement before saving', async () => {
  const planningEvent = { ...baseEvent, status: 'PLANNING' };
  let resolveImpact;
  reviewApi.list.mockResolvedValue({ events: [planningEvent] });
  reviewApi.detail.mockResolvedValue(detail(planningEvent));
  reviewApi.significantChangeImpact.mockImplementation(() => new Promise((resolve) => { resolveImpact = resolve; }));
  await openRequest();
  userEvent.click(screen.getByRole('button', { name: /^edit event$/i }));

  // Arrangements are checked only once a significant field changes.
  expect(reviewApi.significantChangeImpact).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  userEvent.clear(screen.getByLabelText(/expected attendance/i));
  userEvent.type(screen.getByLabelText(/expected attendance/i), '125');
  expect(reviewApi.significantChangeImpact).toHaveBeenCalledWith('e1');
  expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();

  await act(async () => {
    resolveImpact({
      venueBookings: [{ id: 'b1', label: 'Main Hall', status: 'APPROVED' }],
      equipmentReservations: [{ id: 'r1', label: 'Audio', status: 'RESERVED' }],
      registrationsCount: 42
    });
  });
  const warning = await screen.findByRole('complementary', { name: 'Significant change impact' });
  expect(within(warning).getByText(/main hall.*approved/i)).toBeInTheDocument();
  expect(within(warning).getByText(/audio.*reserved/i)).toBeInTheDocument();
  expect(within(warning).getByText(/attendee registrations: 42/i)).toBeInTheDocument();

  const save = screen.getByRole('button', { name: /save changes/i });
  expect(save).toBeDisabled();
  userEvent.click(screen.getByLabelText(/reviewed and acknowledge/i));
  expect(save).toBeEnabled();
  userEvent.click(save);
  await waitFor(() => expect(reviewApi.saveEventEdit).toHaveBeenCalledWith(expect.objectContaining({
    eventId: 'e1',
    values: expect.objectContaining({ expected_attendance: 125 }),
    impact: expect.objectContaining({ registrationsCount: 42 }),
    acknowledged: true
  })));
});

test('TC-0469 D2 cancelling a significant edit leaves the event unsaved', async () => {
  const planningEvent = { ...baseEvent, status: 'PLANNING' };
  reviewApi.list.mockResolvedValue({ events: [planningEvent] });
  reviewApi.detail.mockResolvedValue(detail(planningEvent));
  reviewApi.significantChangeImpact.mockResolvedValue({ venueBookings: [], equipmentReservations: [], registrationsCount: 0 });
  await openRequest();
  userEvent.click(screen.getByRole('button', { name: /^edit event$/i }));
  userEvent.clear(screen.getByLabelText(/expected attendance/i));
  userEvent.type(screen.getByLabelText(/expected attendance/i), '125');
  await screen.findByRole('complementary', { name: 'Significant change impact' });
  userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
  expect(reviewApi.saveEventEdit).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: /^edit event$/i })).not.toBeInTheDocument();
});

test('TC-0470 D2 an open clarification locks only the date, size and venue fields', async () => {
  const planningEvent = { ...baseEvent, status: 'PLANNING', open_clarification_id: 'q1' };
  reviewApi.list.mockResolvedValue({ events: [planningEvent] });
  reviewApi.detail.mockResolvedValue(detail(planningEvent));
  await openRequest();
  userEvent.click(screen.getByRole('button', { name: /^edit event$/i }));
  expect(screen.getByLabelText(/expected attendance/i)).toBeDisabled();
  expect(screen.getByLabelText(/^event name/i)).toBeEnabled();
  expect(screen.getByText(/unavailable while a clarification is open/i)).toBeInTheDocument();
});

test('TC-0471 D2 when the arrangements changed during editing, the warning is reloaded and must be acknowledged again', async () => {
  const planningEvent = { ...baseEvent, status: 'PLANNING' };
  reviewApi.list.mockResolvedValue({ events: [planningEvent] });
  reviewApi.detail.mockResolvedValue(detail(planningEvent));
  reviewApi.significantChangeImpact
    .mockResolvedValueOnce({ venueBookings: [], equipmentReservations: [], registrationsCount: 0 })
    .mockResolvedValueOnce({ venueBookings: [{ id: 'b9', label: 'Garden Pavilion', status: 'APPROVED' }], equipmentReservations: [], registrationsCount: 0 });
  reviewApi.saveEventEdit.mockRejectedValueOnce(new Error('The existing arrangements changed while you were editing. Review the updated warning before saving.'));
  await openRequest();
  userEvent.click(screen.getByRole('button', { name: /^edit event$/i }));
  userEvent.clear(screen.getByLabelText(/expected attendance/i));
  userEvent.type(screen.getByLabelText(/expected attendance/i), '125');
  await screen.findByRole('complementary', { name: 'Significant change impact' });
  userEvent.click(screen.getByLabelText(/reviewed and acknowledge/i));
  userEvent.click(screen.getByRole('button', { name: /save changes/i }));

  expect(await screen.findByText(/arrangements changed during editing/i)).toBeInTheDocument();
  expect(within(screen.getByRole('complementary', { name: 'Significant change impact' })).getByText(/garden pavilion/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/reviewed and acknowledge/i)).not.toBeChecked();
  expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
});

// C6 — approve a request the coordinator has reviewed (Under Review -> Approved).
// This is the UI that the venue merge dropped: reviewApi.approve and canApproveEvent
// existed, but nothing on the screen called them. These tests guard the button.
// J2 / SCRUM-151 AC3 changed below: Approve now opens a Reason box and the
// decision is sent from there, so each types a reason and confirms with "Approve event".
// (locked while sending) is replaced by J2, which covers the same lock on the new
// confirm button.
const approveWith = async (reason = 'Looks complete.') => {
  userEvent.click(screen.getByRole('button', { name: 'Approve' }));
  userEvent.type(screen.getByRole('textbox', { name: /reason/i }), reason);
  userEvent.click(screen.getByRole('button', { name: 'Approve event' }));
};

describe('C6 approve a submitted request', () => {
  test('TC-0402 C6 TC1 the assigned coordinator sees Approve on an Under Review request and it calls reviewApi.approve', async () => {
    const onNotice = jest.fn();
    await openRequest({ onNotice });

    const approve = screen.getByRole('button', { name: /^approve/i });
    expect(approve).toBeEnabled();
    await approveWith();

    await waitFor(() => expect(reviewApi.approve).toHaveBeenCalledWith('e1', 'Looks complete.'));
    expect(reviewApi.approve).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Event request approved.'));
  });

  test('TC-0403 C6 TC2 after approving, the detail refreshes to Approved and Approve is no longer offered', async () => {
    reviewApi.detail
      .mockResolvedValueOnce(detail())
      .mockResolvedValue(detail({ status: 'APPROVED' }));
    await openRequest();

    await approveWith();

    // The status pill is the signal that the refreshed detail has landed ("Approving…"
    // does not match /^approve/, so the button's absence alone would pass too early).
    expect(await screen.findByText('APPROVED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject request/i })).not.toBeInTheDocument();
  });

  test.each(['SUBMITTED', 'APPROVED', 'PLANNING', 'REJECTED', 'CANCELLED', 'COMPLETED'])(
    'TC-0404 C6 TC3 Approve is not offered while the event is %s',
    async (status) => {
      reviewApi.detail.mockResolvedValue(detail({ status }));
      await openRequest();
      expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument();
    }
  );

  test('TC-0405 C6 TC5 Approve is unavailable while a clarification is open, and the screen says so', async () => {
    reviewApi.detail.mockResolvedValue(detail({ open_clarification_id: 'q1' }));
    await openRequest();
    expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument();
    expect(screen.getByText(/awaiting the organiser/i)).toHaveTextContent(/approve/i);
  });

  test('TC-0406 C6 TC6 a failed approval shows the error, keeps the event Under Review and offers Approve again', async () => {
    const onNotice = jest.fn();
    reviewApi.approve.mockRejectedValueOnce(new Error('This event cannot be approved now.'));
    await openRequest({ onNotice });

    await approveWith();

    expect(await screen.findByRole('alert')).toHaveTextContent('This event cannot be approved now.');
    expect(onNotice).not.toHaveBeenCalled();
    expect(screen.getByText('UNDER_REVIEW')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
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

test('TC-0751 each assigned row shows name, organiser, proposed date, status and time since last activity', async () => {
  reviewApi.list.mockResolvedValue({ events: [assignedEvents[0]] });
  render(<EventReviewScreen />);
  const row = (await screen.findByRole('heading', { name: 'Alumni Mixer' })).closest('article');
  expect(within(row).getByText('Nadia Organiser')).toBeInTheDocument();
  expect(within(row).getByText('2026-11-02')).toBeInTheDocument();
  expect(within(row).getByText('APPROVED')).toBeInTheDocument();
  expect(within(row).getByText(/last activity:/i)).toBeInTheDocument();
});

test('TC-0752 the status filter narrows the list to the chosen status', async () => {
  reviewApi.list.mockResolvedValue({ events: assignedEvents });
  render(<EventReviewScreen />);
  await screen.findByRole('heading', { name: 'Alumni Mixer' });
  expect(screen.getByRole('heading', { name: 'Partner Summit' })).toBeInTheDocument();

  userEvent.selectOptions(screen.getByRole('combobox', { name: /filter by status/i }), 'SUBMITTED');
  expect(screen.getByRole('heading', { name: 'Partner Summit' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Alumni Mixer' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Careers Fair' })).not.toBeInTheDocument();
});

test("TC-0547 D5 AC2/AC3 completed events leave the active list and remain viewable via the status filter", async () => {
  const completed = { ...assignedEvents[0], id: "e-completed", name: "Past Summit", status: "COMPLETED" };
  reviewApi.list.mockResolvedValue({ events: [...assignedEvents, completed] });
  reviewApi.detail.mockResolvedValue(detail({ ...baseEvent, ...completed }));
  render(<EventReviewScreen />);

  await screen.findByRole("heading", { name: "Alumni Mixer" });
  expect(screen.queryByRole("heading", { name: "Past Summit" })).not.toBeInTheDocument();

  userEvent.selectOptions(screen.getByRole("combobox", { name: /filter by status/i }), "COMPLETED");
  userEvent.click(await screen.findByRole("button", { name: /view request/i }));
  expect(await screen.findByRole("heading", { name: "Past Summit" })).toBeInTheDocument();
  expect(screen.getByText("COMPLETED", { selector: ".cs-pill" })).toBeInTheDocument();
});

test('TC-0753 sorting by proposed date orders ascending, then descending on toggle', async () => {
  reviewApi.list.mockResolvedValue({ events: assignedEvents });
  render(<EventReviewScreen />);
  await screen.findByRole('heading', { name: 'Alumni Mixer' });
  expect(rowNames()).toEqual(['Alumni Mixer', 'Careers Fair', 'Partner Summit']);

  userEvent.click(screen.getByRole('button', { name: /sort by proposed date/i }));
  expect(rowNames()).toEqual(['Partner Summit', 'Careers Fair', 'Alumni Mixer']);
});

// The event detail page is split into tabs.
describe('the coordinator event detail tabs', () => {
  test('TC-2029 the detail opens on the request, with the clarifications on a second tab', async () => {
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

  test('TC-2030 Request clarification is on the Clarifications tab; Reject stays on the request', async () => {
    await openRequest();

    expect(screen.queryByRole('button', { name: /request clarification/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject request/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reassign event/i })).not.toBeInTheDocument();

    await openClarifications();
    expect(screen.getByRole('button', { name: /request clarification/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject request/i })).not.toBeInTheDocument();
  });

  test('TC-2031 switching tab closes a half-written action form', async () => {
    await openRequest();
    userEvent.click(screen.getByRole('button', { name: /reject request/i }));
    expect(screen.getByRole('heading', { name: 'Reject request' })).toBeInTheDocument();

    await openClarifications();
    userEvent.click(screen.getByRole('tab', { name: 'Event request' }));

    expect(screen.queryByRole('heading', { name: 'Reject request' })).not.toBeInTheDocument();
    expect(reviewApi.reject).not.toHaveBeenCalled();
  });
});

// C3 — the coordinator sees everything the organiser submitted in one place, so a
// request can be understood fully before a decision. The review detail (Event
// request tab) must show every requirement group and the submission metadata
// (AC1, AC2); opening a Submitted request starts the review (AC3). SCRUM id to be
// confirmed.
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

  test('TC-0348 the request tab shows venue requirements, accessibility, equipment and registration needs', async () => {
    reviewApi.detail.mockResolvedValue(fullDetail());
    await openRequest();

    // The four requirement groups the story names each get their own section.
    expect(screen.getByRole('heading', { name: /venue requirements/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /accessibility/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^equipment$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /registration/i })).toBeInTheDocument();

    // A representative value from each group reaches the screen.
    expect(screen.getByText(/WIFI/)).toBeInTheDocument();                       // venue requirements
    expect(screen.getByText('Two wheelchair users expected.')).toBeInTheDocument(); // accessibility
    expect(screen.getByText(/AUDIO/)).toBeInTheDocument();                      // equipment
    expect(screen.getByText(/120/)).toBeInTheDocument();                        // registration capacity
  });

  test('TC-0349 the view shows the reference number, submission timestamp and the organiser contact', async () => {
    reviewApi.detail.mockResolvedValue(fullDetail());
    await openRequest();

    expect(screen.getByText('EVT-001')).toBeInTheDocument();          // reference number
    expect(screen.getByText(/submitted/i)).toBeInTheDocument();       // submission timestamp (field label)
    expect(screen.getByText('Nadia Organiser')).toBeInTheDocument();  // organiser contact
    expect(screen.getByText('nadia@smu.edu.sg')).toBeInTheDocument();
    expect(screen.getByText(/9123 4567/)).toBeInTheDocument();
  });

  test('TC-0350 opening a Submitted request starts the review (Submitted -> Under Review)', async () => {
    const submitted = { ...baseEvent, id: 'e9', status: 'SUBMITTED', editable: true };
    reviewApi.list.mockResolvedValue({ events: [submitted] });
    reviewApi.detail.mockResolvedValue(detail({ id: 'e9', status: 'UNDER_REVIEW' }));

    render(<EventReviewScreen />);
    userEvent.click(await screen.findByRole('button', { name: /view request/i }));
    await screen.findByRole('button', { name: /back to events/i });

    // The transition (and the record of who opened it) is reviewApi.openReview.
    await waitFor(() => expect(reviewApi.openReview).toHaveBeenCalledWith('e9'));
  });
});

// A7 / SCRUM-170 AC3. The coordinator finds the safety planning notes on
// the event they are planning, and saving them reloads the event and says so.
describe("safety planning notes on the coordinator's event", () => {
  test('TC-0134 a Planning event offers the notes for editing, and a save reloads the event', async () => {
    const { savePlanningNotes } = require('../safety/safetyApi');
    reviewApi.list.mockResolvedValue({ events: [{ ...baseEvent, status: 'PLANNING' }] });
    reviewApi.detail.mockResolvedValue(detail({ status: 'PLANNING', equipment_placement: 'Speakers by the stage' }));
    const onNotice = jest.fn();
    await openRequest({ onNotice });

    const notes = screen.getByRole('region', { name: 'Safety planning notes' });
    expect(within(notes).getByLabelText('Equipment placement')).toHaveValue('Speakers by the stage');
    userEvent.click(within(notes).getByRole('button', { name: 'Save safety notes' }));

    expect(savePlanningNotes).toHaveBeenCalledWith({ eventId: 'e1', values: { equipment_placement: 'Speakers by the stage', crowd_movement: '' } });
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Safety planning notes saved.'));
    expect(reviewApi.detail).toHaveBeenCalledTimes(2);
  });

  test('TC-0135 an event still Under Review shows the notes read only', async () => {
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

  test('TC-2394 K5 AC3 opening an event by id that is refused shows the not-authorised message and no event details or actions', async () => {
    reviewApi.list.mockResolvedValue({ events: [] });
    reviewApi.detail.mockRejectedValue(new Error(refusal));

    render(<EventReviewScreen initialEventId="e2" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(refusal);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve|reject|request clarification|find venues|back to events/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Partner Summit')).not.toBeInTheDocument();
  });

  test('TC-2395 K5 AC3 a refused event leaves the coordinator on their list, and the events assigned to them still open', async () => {
    reviewApi.detail.mockRejectedValueOnce(new Error(refusal));

    render(<EventReviewScreen initialEventId="e2" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(refusal);

    userEvent.click(await screen.findByRole('button', { name: /view request/i }));
    expect(await screen.findByRole('button', { name: /back to events/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Partner Summit' })).toBeInTheDocument();
  });

  test('TC-2396 K5 AC1 the assigned events list shows only what is assigned and has no read-only reassigned view', async () => {
    reviewApi.list.mockResolvedValue({ events: [baseEvent, { ...baseEvent, id: 'e5', name: 'Second Workshop', reference_no: 'EVT-005' }] });

    render(<EventReviewScreen />);

    expect(await screen.findByText('Partner Summit')).toBeInTheDocument();
    expect(screen.getByText('Second Workshop')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /view request/i })).toHaveLength(2);
    userEvent.click(screen.getAllByRole('button', { name: /view request/i })[0]);
    await screen.findByRole('button', { name: /back to events/i });
    expect(screen.queryByText(/was reassigned|previously assigned/i)).not.toBeInTheDocument();
  });
});

describe('D1 SCRUM-111 ordinary event details and the Activity tab', () => {
  const planningEvent = { ...baseEvent, status: 'PLANNING' };

  test('TC-0434 D1 AC1 an ordinary edit saves with no arrangement check or acknowledgement', async () => {
    reviewApi.list.mockResolvedValue({ events: [planningEvent] });
    reviewApi.detail.mockResolvedValue({ ...detail(planningEvent), organiser: { id: 'org1', name: 'Nadia Organiser', email: 'nadia@smu.edu.sg' } });
    await openRequest();
    userEvent.click(screen.getByRole('button', { name: /^edit event$/i }));

    const save = screen.getByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();
    expect(screen.getByLabelText(/contact name/i)).toHaveValue('Nadia Organiser');
    userEvent.type(screen.getByLabelText(/internal notes/i), 'Keynote TBC');
    expect(save).toBeEnabled();
    expect(screen.queryByRole('complementary', { name: 'Significant change impact' })).not.toBeInTheDocument();
    userEvent.click(save);

    await waitFor(() => expect(reviewApi.saveEventEdit).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'e1',
      values: expect.objectContaining({ internal_notes: 'Keynote TBC', name: 'Partner Summit', expected_attendance: 100 }),
      acknowledged: false,
      impact: null
    })));
    // AC1 — no booking or reservation is even looked at.
    expect(reviewApi.significantChangeImpact).not.toHaveBeenCalled();
  });

  test('TC-0435 D1 AC3 a terminal event offers no Edit event', async () => {
    const completed = { ...baseEvent, status: 'COMPLETED' };
    reviewApi.list.mockResolvedValue({ events: [completed] });
    reviewApi.detail.mockResolvedValue(detail(completed));
    await openRequest();
    expect(screen.queryByRole('button', { name: /^edit event$/i })).not.toBeInTheDocument();
  });

  test('TC-0436 D1 AC2 the Activity tab lists each edit with field, old and new value, actor and time', async () => {
    reviewApi.list.mockResolvedValue({ events: [planningEvent] });
    reviewApi.detail.mockResolvedValue({
      ...detail(planningEvent),
      history: [{ id: 'h1', action_type: 'EVENT_DETAILS_UPDATED', actor_id: 'c1', field_name: 'name', old_value: 'Summit', new_value: 'Partner Summit', created_at: '2026-10-02T01:00:00.000Z' }],
      actorNames: { c1: 'Sam Coordinator' }
    });
    await openRequest();
    userEvent.click(screen.getByRole('tab', { name: /^Activity/ }));

    const log = screen.getByRole('region', { name: /event activity/i });
    expect(within(log).getByText('Updated event details')).toBeInTheDocument();
    expect(within(log).getByText(/by Sam Coordinator/)).toBeInTheDocument();
    expect(within(log).getByText('Event name')).toBeInTheDocument();
    expect(within(log).getByText('Summit')).toBeInTheDocument();
    expect(within(log).getByText('Partner Summit')).toBeInTheDocument();
    expect(within(log).getByText(/2026/)).toBeInTheDocument();
  });

  test.each(['COMPLETED', 'CANCELLED', 'REJECTED'])(
    'TC-0553 D6 keeps event history available when the event is %s',
    async (status) => {
      reviewApi.list.mockResolvedValue({ events: [{ ...baseEvent, status }] });
      reviewApi.detail.mockResolvedValue({
        ...detail({ status }),
        history: [{
          id: 'h1', action_type: 'EVENT_REJECTED', actor_id: 'c1',
          description: 'No suitable venue can be secured.',
          created_at: '2026-10-02T01:00:00.000Z'
        }],
        actorNames: { c1: 'Sam Coordinator' }
      });

      await openRequest();
      userEvent.click(screen.getByRole('tab', { name: /^Activity/ }));

      const log = screen.getByRole('region', { name: /event activity/i });
      expect(within(log).getByText('Rejected the request')).toBeInTheDocument();
      expect(within(log).getByText('No suitable venue can be secured.')).toBeInTheDocument();
      expect(within(log).getByText(/by Sam Coordinator/)).toBeInTheDocument();
    }
  );

  test('TC-0437 an invalid ordinary value is named and cannot be saved', async () => {
    reviewApi.list.mockResolvedValue({ events: [planningEvent] });
    reviewApi.detail.mockResolvedValue(detail(planningEvent));
    await openRequest();
    userEvent.click(screen.getByRole('button', { name: /^edit event$/i }));

    userEvent.clear(screen.getByLabelText(/^event name/i));
    expect(screen.getByRole('alert')).toHaveTextContent('Event name is required.');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();

    userEvent.type(screen.getByLabelText(/^event name/i), 'Partner Summit');
    userEvent.type(screen.getByLabelText(/contact email/i), '{selectall}not-an-email');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid contact email.');
    expect(reviewApi.saveEventEdit).not.toHaveBeenCalled();
  });

  test('TC-0438 internal notes are shown to the coordinator on the request', async () => {
    reviewApi.list.mockResolvedValue({ events: [planningEvent] });
    reviewApi.detail.mockResolvedValue(detail({ ...planningEvent, internal_notes: 'Keynote TBC' }));
    await openRequest();
    expect(screen.getByText('Internal notes')).toBeInTheDocument();
    expect(screen.getByText('Keynote TBC')).toBeInTheDocument();
  });

});

describe('equipment reservations on the coordinator event page', () => {
  const planningEvent = { ...baseEvent, status: 'PLANNING' };

  test('TC-1300 G4 an equipment line Technical Support reserved shows an Approved badge, and the decision is on the Activity tab', async () => {
    reviewApi.list.mockResolvedValue({ events: [planningEvent] });
    reviewApi.detail.mockResolvedValue({
      ...detail(planningEvent),
      equipmentArrangements: {
        status: { label: 'Pending', tone: 'warning' },
        lines: [
          { key: '0-AUDIO_SYSTEM', label: 'Audio system × 2', status: { label: 'Approved', tone: 'positive' }, reservedFrom: '2026-11-04T01:00:00.000Z', reservedTo: '2026-11-04T09:00:00.000Z', decidedAt: '2026-10-05T02:00:00.000Z', reason: null },
          { key: '1-PROJECTOR', label: 'Projector × 1', status: { label: 'Pending', tone: 'warning' }, reservedFrom: null, reservedTo: null, decidedAt: null, reason: null }
        ]
      },
      history: [{ id: 'equipment-q1', action_type: 'EQUIPMENT_RESERVED', actor_id: 'tech1', actor_role: 'Technical Support', field_name: 'equipment', old_value: 'Audio system × 2 — Pending', new_value: 'Audio system × 2 — Approved', created_at: '2026-10-05T02:00:00.000Z' }],
      actorNames: {}
    });
    await openRequest();

    userEvent.click(screen.getByRole('tab', { name: /^Arrangements/ }));
    const section = screen.getByRole('region', { name: /equipment reservation status/i });
    const audio = within(section).getByText('Audio system × 2').closest('article');
    expect(within(audio).getByText('Approved')).toHaveClass('cs-pill-positive');
    const projector = within(section).getByText('Projector × 1').closest('article');
    expect(within(projector).getByText('Pending')).toBeInTheDocument();
    expect(within(projector).getByText('Not reserved yet')).toBeInTheDocument();

    userEvent.click(screen.getByRole('tab', { name: /^Activity/ }));
    const log = screen.getByRole('region', { name: /event activity/i });
    expect(within(log).getByText('Approved an equipment reservation')).toBeInTheDocument();
    expect(within(log).getByText(/by Technical Support/)).toBeInTheDocument();
    expect(within(log).getByText('Audio system × 2 — Approved')).toBeInTheDocument();
  });

  test('TC-1301 G4 an event with no equipment request says so', async () => {
    reviewApi.list.mockResolvedValue({ events: [planningEvent] });
    reviewApi.detail.mockResolvedValue(detail(planningEvent));
    await openRequest();
    userEvent.click(screen.getByRole('tab', { name: /^Arrangements/ }));
    const section = screen.getByRole('region', { name: /equipment reservation status/i });
    expect(within(section).getByText(/no equipment request has been sent/i)).toBeInTheDocument();
  });
  test('TC-1302 opened from Equipment requests, the event starts on its Arrangements tab, which counts bookings and equipment lines', async () => {
    reviewApi.list.mockResolvedValue({ events: [planningEvent] });
    reviewApi.detail.mockResolvedValue({
      ...detail(planningEvent),
      venueBookings: [{ booking_id: 'b1', venue_name: 'Harbour Hall', status: 'APPROVED', start_datetime: '2026-11-04T01:00:00.000Z', end_datetime: '2026-11-04T09:00:00.000Z' }],
      equipmentArrangements: {
        status: { label: 'Reserved', tone: 'positive' },
        lines: [{ key: '0-AUDIO', label: 'Audio × 2', status: { label: 'Approved', tone: 'positive' }, reservedFrom: null, reservedTo: null, decidedAt: null, reason: null }]
      }
    });
    render(<EventReviewScreen initialEventId="e1" initialTab="arrangements" />);

    const tab = await screen.findByRole('tab', { name: /^Arrangements/ });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveTextContent('Arrangements2');
    expect(screen.getByRole('region', { name: /equipment reservation status/i })).toHaveTextContent('Audio × 2');
    expect(screen.getByRole('region', { name: /venue booking status/i })).toHaveTextContent('Harbour Hall');
  });
});

// F12 / SCRUM-177 AC5.
describe('F12 SCRUM-177 the event view lists every venue booking', () => {
  test('TC-1067 AC5 each booking shows its label, venue, window and status', async () => {
    const planningEvent = { ...baseEvent, status: 'PLANNING' };
    const window = { start_datetime: '2026-11-04T01:00:00.000Z', end_datetime: '2026-11-04T09:00:00.000Z' };
    reviewApi.list.mockResolvedValue({ events: [planningEvent] });
    reviewApi.detail.mockResolvedValue({
      ...detail(planningEvent),
      venueBookings: [
        { booking_id: 'b1', booking_label: 'Main programme', venue_name: 'Harbour Hall', status: 'APPROVED', expected_attendance: 100, layout: 'THEATRE', ...window },
        { booking_id: 'b2', booking_label: 'Breakout 1', venue_name: 'Seminar Room', status: 'PENDING', expected_attendance: 40, layout: 'CLASSROOM', ...window }
      ]
    });
    render(<EventReviewScreen initialEventId="e1" initialTab="arrangements" />);

    const section = await screen.findByRole('region', { name: /venue booking status/i });
    const records = within(section).getAllByRole('article');
    expect(records).toHaveLength(2);
    const shown = (value) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const expectations = [['Main programme', 'Harbour Hall', 'APPROVED'], ['Breakout 1', 'Seminar Room', 'PENDING']];
    expectations.forEach(([label, venue, status], index) => {
      expect(within(records[index]).getByRole('heading', { name: label })).toBeInTheDocument();
      expect(within(records[index]).getByText(venue)).toBeInTheDocument();
      expect(within(records[index]).getByText(status)).toBeInTheDocument();
      expect(records[index]).toHaveTextContent(`${shown(window.start_datetime)}–${shown(window.end_datetime)}`);
    });
  });
});

// J2 / SCRUM-151 AC3 — an approval carries its reason, as a rejection already does, so
// Approve now opens the same Reason box instead of sending at once. These replace the
// one-click behaviour pinned by C6, above, which are updated to the
// two-step flow with the code.
describe('J2 SCRUM-151 approving needs a reason', () => {
  const approveButton = () => screen.getByRole('button', { name: 'Approve' });
  const confirmButton = () => screen.getByRole('button', { name: 'Approve event' });
  const reasonBox = () => screen.getByRole('textbox', { name: /reason/i });

  test('TC-2138 J2 AC3 Approve opens a required Reason box and sends nothing yet', async () => {
    await openRequest();

    userEvent.click(approveButton());

    expect(screen.getByRole('heading', { name: 'Approve request' })).toBeInTheDocument();
    expect(reasonBox()).toBeRequired();
    expect(confirmButton()).toBeEnabled();
    expect(reviewApi.approve).not.toHaveBeenCalled();
  });

  test('TC-2139 J2 AC3 confirming with no reason is refused beside the box, and typing clears the message', async () => {
    await openRequest();
    userEvent.click(approveButton());

    userEvent.click(confirmButton());

    expect(screen.getByRole('alert')).toHaveTextContent('Approval reason is required.');
    expect(reasonBox()).toHaveAttribute('aria-invalid', 'true');
    expect(reviewApi.approve).not.toHaveBeenCalled();
    userEvent.type(reasonBox(), 'Venue and equipment are confirmed.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(reasonBox()).toHaveAttribute('aria-invalid', 'false');
  });

  test('TC-2140 J2 AC3 a reason made only of spaces is refused too', async () => {
    await openRequest();
    userEvent.click(approveButton());
    userEvent.type(reasonBox(), '   ');

    userEvent.click(confirmButton());

    expect(screen.getByRole('alert')).toHaveTextContent('Approval reason is required.');
    expect(reviewApi.approve).not.toHaveBeenCalled();
  });

  test('TC-2141 J2 AC3 confirming with a reason approves the event and sends the reason with it', async () => {
    const onNotice = jest.fn();
    await openRequest({ onNotice });
    userEvent.click(approveButton());
    userEvent.type(reasonBox(), 'Venue and equipment are confirmed.');

    userEvent.click(confirmButton());

    await waitFor(() => expect(reviewApi.approve).toHaveBeenCalledWith('e1', 'Venue and equipment are confirmed.'));
    expect(reviewApi.approve).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Event request approved.'));
  });

  test('TC-2142 J2 Cancel closes the box without approving, and Approve is offered again', async () => {
    await openRequest();
    userEvent.click(approveButton());
    userEvent.type(reasonBox(), 'Half-written reason');

    userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('textbox', { name: /reason/i })).not.toBeInTheDocument();
    expect(reviewApi.approve).not.toHaveBeenCalled();
    expect(approveButton()).toBeEnabled();
  });

  test('TC-2143 J2 a failed approval shows its error in the box and keeps the reason that was typed', async () => {
    reviewApi.approve.mockRejectedValueOnce(new Error('This event cannot be approved now.'));
    const onNotice = jest.fn();
    await openRequest({ onNotice });
    userEvent.click(approveButton());
    userEvent.type(reasonBox(), 'Venue and equipment are confirmed.');

    userEvent.click(confirmButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('This event cannot be approved now.');
    expect(onNotice).not.toHaveBeenCalled();
    expect(reasonBox()).toHaveValue('Venue and equipment are confirmed.');
    expect(confirmButton()).toBeEnabled();
  });

  test('TC-2144 J2 while the approval is being sent, confirm and Reject are locked so it cannot go twice', async () => {
    let finish;
    reviewApi.approve.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await openRequest();
    userEvent.click(approveButton());
    userEvent.type(reasonBox(), 'Venue and equipment are confirmed.');

    userEvent.click(confirmButton());

    const busy = await screen.findByRole('button', { name: /saving/i });
    expect(busy).toBeDisabled();
    expect(screen.getByRole('button', { name: /reject request/i })).toBeDisabled();
    userEvent.click(busy);
    expect(reviewApi.approve).toHaveBeenCalledTimes(1);

    await act(async () => { finish({ ok: true }); });
  });

  test('TC-2145 J2 switching from Approve to Reject starts the Reason box afresh, under the right heading', async () => {
    await openRequest();
    userEvent.click(approveButton());
    userEvent.type(reasonBox(), 'Venue and equipment are confirmed.');

    userEvent.click(screen.getByRole('button', { name: /reject request/i }));

    expect(screen.getByRole('heading', { name: 'Reject request' })).toBeInTheDocument();
    expect(reasonBox()).toHaveValue('');
    expect(screen.getByRole('button', { name: /reject event/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve event' })).not.toBeInTheDocument();
  });
});

// I3 SCRUM-149 — the Edit event form. A significant change to a Confirmed event moves it back
// to Planning (the service does that after the save), a lower registration capacity needs an
// explicit acknowledgement, and a re-request that did not go through can be retried.
describe('I3 SCRUM-149 the Edit event form and re-requesting arrangements', () => {
  const confirmedEvent = { ...baseEvent, status: 'CONFIRMED', registration_required: true, registration_capacity: 100 };
  const planningEvent = { ...confirmedEvent, status: 'PLANNING' };
  const openEditor = async (event = confirmedEvent, props = {}) => {
    reviewApi.list.mockResolvedValue({ events: [event] });
    reviewApi.detail.mockResolvedValue(detail(event));
    await openRequest(props);
    userEvent.click(screen.getByRole('button', { name: /^edit event$/i }));
    // Let the editor's registered-count read land inside act, not between later steps.
    await act(async () => {});
  };
  const changeAttendance = async (value = '125') => {
    userEvent.clear(screen.getByLabelText(/expected attendance/i));
    userEvent.type(screen.getByLabelText(/expected attendance/i), value);
    // The impact lookup this starts resolves inside act.
    await act(async () => {});
  };
  const setCapacity = async (value) => {
    const field = await screen.findByLabelText(/registration capacity/i);
    userEvent.clear(field);
    userEvent.type(field, value);
  };

  test('TC-2032 I3 AC4 the registration capacity field appears only when the event takes registrations', async () => {
    await openEditor(confirmedEvent);
    expect(await screen.findByLabelText(/registration capacity/i)).toHaveValue(100);
  });

  test('TC-2033 I3 AC4 an event without registration has no capacity field and never asks for the registered count', async () => {
    await openEditor({ ...confirmedEvent, registration_required: false, registration_capacity: undefined });
    expect(screen.queryByLabelText(/registration capacity/i)).not.toBeInTheDocument();
    expect(reviewApi.registeredCount).not.toHaveBeenCalled();
  });

  test('TC-2034 I3 AC4 a capacity below the registered count shows a warning and keeps Save off until acknowledged', async () => {
    reviewApi.registeredCount.mockResolvedValue(60);
    await openEditor(planningEvent);
    await setCapacity('40');

    expect(await screen.findByText(/below the 60 people already registered/i)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();
    userEvent.click(screen.getByLabelText(/below the number already registered/i));
    expect(save).toBeEnabled();
    userEvent.click(save);

    await waitFor(() => expect(reviewApi.saveEventEdit).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'e1',
      values: expect.objectContaining({ registration_capacity: 40 }),
      registeredCount: 60,
      capacityAcknowledged: true
    })));
  });

  test('TC-2035 I3 AC4 un-ticking the acknowledgement, or raising the capacity again, takes the gate away or puts it back', async () => {
    reviewApi.registeredCount.mockResolvedValue(60);
    await openEditor(planningEvent);
    await setCapacity('40');
    const save = screen.getByRole('button', { name: /save changes/i });
    const box = await screen.findByLabelText(/below the number already registered/i);
    userEvent.click(box);
    expect(save).toBeEnabled();
    userEvent.click(box);
    expect(save).toBeDisabled();

    await setCapacity('70');
    expect(screen.queryByText(/below the 60 people already registered/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/below the number already registered/i)).not.toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  test('TC-2036 I3 AC4 a capacity change that does not go below the registered count needs no acknowledgement', async () => {
    reviewApi.registeredCount.mockResolvedValue(60);
    await openEditor(planningEvent);
    await setCapacity('80');

    expect(screen.queryByLabelText(/below the number already registered/i)).not.toBeInTheDocument();
    userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(reviewApi.saveEventEdit).toHaveBeenCalledWith(expect.objectContaining({
      values: expect.objectContaining({ registration_capacity: 80 }),
      capacityAcknowledged: false
    })));
  });

  test('TC-2037 I3 AC4 a capacity the person never touched leaves Save off, as for any other untouched form', async () => {
    reviewApi.registeredCount.mockResolvedValue(150);
    await openEditor(planningEvent);
    expect(await screen.findByLabelText(/registration capacity/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    expect(screen.queryByText(/already registered/i)).not.toBeInTheDocument();
  });

  test('TC-2038 I3 AC1 AC3 the impact warning for a Confirmed event says it goes back to Planning and that bookings are kept as a reference', async () => {
    await openEditor(confirmedEvent);
    await changeAttendance();

    const warning = await screen.findByRole('complementary', { name: 'Significant change impact' });
    expect(within(warning).getByText(/moved back to planning/i)).toBeInTheDocument();
    expect(within(warning).getByText(/re-request/i)).toBeInTheDocument();
    expect(within(warning).getByText(/kept as a reference/i)).toBeInTheDocument();
    expect(within(warning).getByText(/not cancelled/i)).toBeInTheDocument();
  });

  test('TC-2039 I3 AC1 the warning for an event already in Planning still says to re-request but not that the status moves', async () => {
    await openEditor(planningEvent);
    await changeAttendance();

    const warning = await screen.findByRole('complementary', { name: 'Significant change impact' });
    expect(within(warning).getByText(/re-request/i)).toBeInTheDocument();
    expect(within(warning).queryByText(/moved back to planning/i)).not.toBeInTheDocument();
  });

  test('TC-2040 I3 AC1 AC2 after a significant save the screen waits for the re-request, then reports the change as saved', async () => {
    const onNotice = jest.fn();
    reviewApi.saveEventEdit.mockResolvedValue({ ok: true, changed: 1, rerequest: { sent: true, changeId: 'h1' } });
    await openEditor(confirmedEvent, { onNotice });
    await changeAttendance();
    userEvent.click(await screen.findByLabelText(/reviewed and acknowledge/i));
    userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Event changes saved.'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('TC-2041 I3 AC1 when the re-request did not go through the screen says so, offers Retry, and does not report plain success', async () => {
    const onNotice = jest.fn();
    reviewApi.saveEventEdit.mockResolvedValue({ ok: true, changed: 1, rerequest: { sent: false, changeId: 'h1', error: 'Could not reach the service.' } });
    await openEditor(confirmedEvent, { onNotice });
    await changeAttendance();
    userEvent.click(await screen.findByLabelText(/reviewed and acknowledge/i));
    userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/saved/i);
    expect(alert).toHaveTextContent(/could not be marked for re-request/i);
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument();
    expect(onNotice).not.toHaveBeenCalledWith('Event changes saved.');
  });

  test('TC-2042 I3 AC1 Retry asks again for the same change and, once it works, reports the change as saved', async () => {
    const onNotice = jest.fn();
    reviewApi.saveEventEdit.mockResolvedValue({ ok: true, changed: 1, rerequest: { sent: false, changeId: 'h1', error: 'Could not reach the service.' } });
    await openEditor(confirmedEvent, { onNotice });
    await changeAttendance();
    userEvent.click(await screen.findByLabelText(/reviewed and acknowledge/i));
    userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    userEvent.click(await screen.findByRole('button', { name: /^retry$/i }));

    await waitFor(() => expect(reviewApi.retryRerequest).toHaveBeenCalledWith({ eventId: 'e1', changeId: 'h1' }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Event changes saved.'));
    expect(reviewApi.saveEventEdit).toHaveBeenCalledTimes(1);
  });

  test('TC-2043 I3 AC1 a Retry that fails again keeps the message and the button, and says why', async () => {
    reviewApi.saveEventEdit.mockResolvedValue({ ok: true, changed: 1, rerequest: { sent: false, changeId: 'h1', error: 'Could not reach the service.' } });
    reviewApi.retryRerequest.mockRejectedValue(new Error('That change is no longer the latest.'));
    await openEditor(confirmedEvent);
    await changeAttendance();
    userEvent.click(await screen.findByLabelText(/reviewed and acknowledge/i));
    userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    userEvent.click(await screen.findByRole('button', { name: /^retry$/i }));

    expect(await screen.findByText(/that change is no longer the latest/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument();
  });

  test('TC-2044 I3 an ordinary save carries no re-request and reports success straight away', async () => {
    const onNotice = jest.fn();
    await openEditor(confirmedEvent, { onNotice });
    userEvent.type(screen.getByLabelText(/internal notes/i), 'Keynote TBC');
    userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Event changes saved.'));
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument();
  });

  test('TC-2045 I3 AC4 a refusal from the capacity check is shown and nothing is reported as saved', async () => {
    const onNotice = jest.fn();
    reviewApi.registeredCount.mockResolvedValue(10);
    reviewApi.saveEventEdit.mockRejectedValue(new Error('The capacity cannot exceed the venue capacity of 120.'));
    await openEditor(planningEvent, { onNotice });
    await setCapacity('500');
    userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The capacity cannot exceed the venue capacity of 120.');
    expect(onNotice).not.toHaveBeenCalledWith('Event changes saved.');
  });
});

// C1 / C2 / C4 / D4 — the review queue, the header back button, and the screen's
// failure paths.
describe('the review queue, the back button and failures on the coordinator screen', () => {
  const queued = [
    { ...baseEvent, id: 'q1', status: 'SUBMITTED', name: 'Fresh request' },
    { id: 'q2', status: 'UNDER_REVIEW', coordinator_id: 'c1', editable: true },
    { ...baseEvent, id: 'q3', status: 'PLANNING', name: 'Already planning' },
    { ...baseEvent, id: 'q4', status: 'SUBMITTED', name: 'Not mine any more', editable: false }
  ];

  test('TC-0307 [normal] C1 the queue lists only the requests waiting for this coordinator, and opens one', async () => {
    reviewApi.list.mockResolvedValue({ events: queued });
    render(<EventReviewScreen queueOnly />);

    expect(await screen.findByText('Fresh request')).toBeInTheDocument();
    expect(screen.getByText('Untitled event')).toBeInTheDocument();
    expect(screen.getByText('Date not set')).toBeInTheDocument();
    expect(screen.getAllByText('Current assignment')).toHaveLength(2);
    expect(screen.queryByText('Already planning')).not.toBeInTheDocument();
    expect(screen.queryByText('Not mine any more')).not.toBeInTheDocument();

    userEvent.click(screen.getAllByRole('button', { name: /view request/i })[0]);
    expect(await screen.findByRole('button', { name: /back to events/i })).toBeInTheDocument();
  });

  test('TC-0308 [boundary] C1 / C2 an empty answer reads as no requests and no assigned events', async () => {
    reviewApi.list.mockResolvedValue({});
    const { unmount } = render(<EventReviewScreen queueOnly />);
    expect(await screen.findByText('No requests are waiting for review.')).toBeInTheDocument();
    unmount();

    render(<EventReviewScreen />);
    expect(await screen.findByText('No events are assigned to you.')).toBeInTheDocument();
  });

  test('TC-0309 [failure] C1 / C2 a list that cannot be read says why, in the queue and in the assigned list', async () => {
    reviewApi.list.mockRejectedValue(new Error('Missing or insufficient permissions.'));
    const { unmount } = render(<EventReviewScreen queueOnly />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Missing or insufficient permissions.');
    unmount();

    render(<EventReviewScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Missing or insufficient permissions.');
  });

  test('TC-0310 [failure] C1 a request that cannot be opened from the queue is reported above the queue', async () => {
    reviewApi.list.mockResolvedValue({ events: queued });
    reviewApi.openReview.mockRejectedValue(new Error('You are not authorised to view this event.'));
    render(<EventReviewScreen queueOnly />);

    userEvent.click((await screen.findAllByRole('button', { name: /view request/i }))[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('You are not authorised to view this event.');
    expect(screen.getByText('Fresh request')).toBeInTheDocument();
  });

  test('TC-2046 [normal] the page header gets a back action while a request is open, which closes it, and loses it on leaving', async () => {
    const onBackChange = jest.fn();
    const { unmount } = render(<EventReviewScreen onBackChange={onBackChange} />);
    await waitFor(() => expect(onBackChange).toHaveBeenLastCalledWith(null));

    userEvent.click(await screen.findByRole('button', { name: /view request/i }));
    await waitFor(() => expect(onBackChange).toHaveBeenLastCalledWith(expect.any(Function)));
    const back = onBackChange.mock.calls[onBackChange.mock.calls.length - 1][0];
    act(() => back());
    expect(await screen.findByRole('button', { name: /view request/i })).toBeInTheDocument();
    expect(onBackChange).toHaveBeenLastCalledWith(null);

    onBackChange.mockClear();
    unmount();
    expect(onBackChange).toHaveBeenCalledWith(null);
  });

  test('TC-0367 [failure] C4 AC1 an empty clarification message is refused on screen and nothing is sent', async () => {
    await openRequest();
    await openClarifications();
    userEvent.click(screen.getByRole('button', { name: 'Request clarification' }));
    userEvent.click(screen.getByRole('button', { name: 'Send request' }));

    expect(screen.getByText('Clarification message is required.')).toBeInTheDocument();
    expect(reviewApi.clarify).not.toHaveBeenCalled();
  });

  test('TC-0521 [failure] D4 confirming a cancellation with no reason is refused and nothing is cancelled', async () => {
    reviewApi.detail.mockResolvedValue(detail({ status: 'PLANNING' }));
    await openRequest();
    userEvent.click(screen.getByRole('button', { name: /^cancel event$/i }));
    userEvent.click(screen.getByRole('checkbox'));
    userEvent.click(screen.getByRole('button', { name: /confirm cancellation/i }));

    expect(screen.getByText('Cancellation reason is required.')).toBeInTheDocument();
    expect(reviewApi.cancel).not.toHaveBeenCalled();
  });

  test('TC-0522 [failure] D4 a cleanup retry that fails again keeps the retry and names what is still incomplete', async () => {
    reviewApi.detail.mockResolvedValue(detail({ status: 'PLANNING' }));
    releaseCancelledEventBookings.mockRejectedValue(new Error(''));
    await openRequest();
    userEvent.click(screen.getByRole('button', { name: /^cancel event$/i }));
    userEvent.type(screen.getByLabelText(/^reason/i), 'Speaker unavailable');
    userEvent.click(screen.getByRole('checkbox'));
    userEvent.click(screen.getByRole('button', { name: /confirm cancellation/i }));
    // A failure with no message is named by what failed.
    expect(await screen.findByRole('alert')).toHaveTextContent('venue bookings: operation failed');

    userEvent.click(screen.getByRole('button', { name: /retry incomplete cleanup/i }));
    await waitFor(() => expect(releaseCancelledEventBookings).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('The event remains cancelled, but cleanup is incomplete (venue bookings: operation failed).');
    expect(screen.getByRole('button', { name: /retry incomplete cleanup/i })).toBeEnabled();
  });

  test('TC-0351 [boundary] C3 / C8 / F7 / G4 missing details read "Not set", and every recorded reason is shown', async () => {
    const event = { ...baseEvent, status: 'PLANNING', registration_required: 'YES', decision_reason: 'Fits the brief', decided_at: '2026-10-01T02:00:00Z' };
    reviewApi.list.mockResolvedValue({ events: [event] });
    reviewApi.detail.mockResolvedValue({
      ...detail(event),
      venueBookings: undefined,
      equipmentArrangements: { lines: [{ key: 'l1', label: 'Projector × 1', status: { tone: 'danger', label: 'Unable to fulfil' }, reason: 'None in stock', decidedAt: null, reservedFrom: null }] }
    });
    await openRequest();

    expect(screen.getByText(/Fits the brief ·/)).toBeInTheDocument();
    const registration = screen.getByRole('heading', { name: 'Registration' }).closest('section');
    expect(within(registration).getAllByText('Not set')).toHaveLength(3);

    userEvent.click(screen.getByRole('tab', { name: /^Arrangements/ }));
    expect(screen.getByText('No venue booking requests have been raised for this event.')).toBeInTheDocument();
    expect(screen.getByText('None in stock')).toBeInTheDocument();
  });

  test('TC-0327 [boundary] C2 / F11 an undated row says so, a lost venue is flagged, and the date sort toggles both ways', async () => {
    reviewApi.list.mockResolvedValue({ events: [
      { ...baseEvent, id: 'x1', name: 'Undated', event_date: '', replacement_needed: true },
      { ...baseEvent, id: 'x2', name: 'Dated' }
    ] });
    reviewApi.detail.mockResolvedValue(detail({ venueBookings: undefined }));
    render(<EventReviewScreen />);

    expect(await screen.findByText('Replacement venue needed')).toBeInTheDocument();
    expect(screen.getByText('Date not set')).toBeInTheDocument();
    const sort = screen.getByRole('button', { name: 'Sort by proposed date' });
    userEvent.click(sort);
    expect(sort).toHaveTextContent('↓');
    userEvent.click(sort);
    expect(sort).toHaveTextContent('↑');
  });

  test('TC-0956 [conflict] F7 a released booking shows its release reason beside its decision', async () => {
    reviewApi.detail.mockResolvedValue({ ...detail({ status: 'PLANNING' }), venueBookings: [
      { booking_id: 'b1', venue_name: 'Hall A', status: 'Released', decision_reason: 'Approved first', release_reason: 'Moved to Hall B', decided_at: null }
    ] });
    await openRequest();
    userEvent.click(screen.getByRole('tab', { name: /^Arrangements/ }));
    expect(screen.getByText('Moved to Hall B')).toBeInTheDocument();
    expect(screen.getByText('Approved first')).toBeInTheDocument();
  });
});

