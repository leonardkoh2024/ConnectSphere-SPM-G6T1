// A7 / SCRUM-170 AC2–AC4 — the Safety Officer's queue, review view and outcome
// form.

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SafetyReviewScreen from './SafetyReviewScreen';
import { listSafetyQueue, recordSafetyOutcome, safetyReviewDetail } from './safetyApi';

jest.mock('./safetyApi', () => ({
  listSafetyQueue: jest.fn(),
  safetyReviewDetail: jest.fn(),
  recordSafetyOutcome: jest.fn()
}));

const QUEUED = {
  id: 'e1', name: 'Partner Summit', reference_no: 'EVT-001', status: 'SAFETY_REVIEW',
  event_date: '2026-11-04', start_time: '09:00', end_time: '17:00', expected_attendance: 150,
  venue_names: ['Harbour Hall', 'Breakout Room']
};

const REVIEW = {
  event: {
    ...QUEUED, required_layout: 'THEATRE', accessibility: ['WHEELCHAIR_ACCESS'], accessibility_notes: 'Two wheelchair users',
    equipment: [{ equipment_type: 'AUDIO', quantity: 2, notes: 'Wireless' }],
    equipment_placement: 'Speakers either side of the stage', crowd_movement: ''
  },
  bookings: [{
    booking_id: 'VB-1', venue_name: 'Harbour Hall', label: 'Main programme', status: 'APPROVED',
    start_datetime: '2026-11-04T01:00:00.000Z', end_datetime: '2026-11-04T09:00:00.000Z',
    attendance: 150, capacity: 120, exceeds: true, layout: 'THEATRE',
    emergency_access_notes: 'Exit via the loading bay', known_restrictions: 'No open flames'
  }],
  reservations: [{ reservation_id: 'r1', equipment_type: 'AUDIO', quantity: 2 }],
  reviews: [{ review_id: 's1', outcome: 'REQUEST_CHANGES', comment: 'Move the stage away from the exit.', reviewer_id: 'SO-1', decided_at: '2026-10-12T09:00:00.000Z' }]
};

beforeEach(() => {
  listSafetyQueue.mockReset().mockResolvedValue([QUEUED]);
  safetyReviewDetail.mockReset().mockResolvedValue(REVIEW);
  recordSafetyOutcome.mockReset().mockResolvedValue({ ok: true });
});

const openReview = async (props = {}) => {
  render(<SafetyReviewScreen {...props} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Review safety' }));
  return screen.findByRole('heading', { level: 2, name: 'Partner Summit' });
};
const section = (name) => screen.getByRole('region', { name });

// AC2 — the events awaiting a check, with what tells them apart (L2 AC1).
test('TC-0152 the queue lists each event awaiting its check with date, time, venues and attendance', async () => {
  render(<SafetyReviewScreen />);
  const card = (await screen.findByRole('heading', { level: 2, name: 'Partner Summit' })).closest('article');
  expect(card).toHaveTextContent('2026-11-04 · 09:00–17:00');
  expect(card).toHaveTextContent('Venues: Harbour Hall, Breakout Room');
  expect(card).toHaveTextContent('Expected attendance: 150');
  expect(card).toHaveTextContent('EVT-001');
  expect(within(card).getByRole('button', { name: 'Review safety' })).toBeInTheDocument();
});

test('TC-0153 an empty queue and a refused read each say so', async () => {
  listSafetyQueue.mockResolvedValueOnce([]);
  const { unmount } = render(<SafetyReviewScreen />);
  expect(await screen.findByText('No events are awaiting a safety check.')).toBeInTheDocument();
  unmount();

  listSafetyQueue.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
  render(<SafetyReviewScreen />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Missing or insufficient permissions.');
});

// AC3 — every fact the story lists, for each active venue booking.
test('TC-0154 the review shows attendance against capacity, layout, emergency access and restrictions per booking', async () => {
  await openReview();
  expect(safetyReviewDetail).toHaveBeenCalledWith('e1');
  const bookings = section('Venue bookings');
  const booking = within(bookings).getByRole('article');
  expect(within(booking).getByRole('heading', { name: 'Main programme' })).toBeInTheDocument();
  expect(booking).toHaveTextContent('Harbour Hall');
  expect(booking).toHaveTextContent('Expected attendance150 of 120');
  expect(booking).toHaveTextContent('Exceeds venue capacity');
  expect(booking).toHaveTextContent('LayoutTHEATRE');
  expect(booking).toHaveTextContent('Emergency accessExit via the loading bay');
  expect(booking).toHaveTextContent('Known restrictionsNo open flames');
});

test('TC-0155 the review shows accessibility, equipment, placement, crowd movement and earlier checks', async () => {
  await openReview();
  expect(section('Accessibility requirements')).toHaveTextContent('WHEELCHAIR_ACCESS');
  expect(section('Accessibility requirements')).toHaveTextContent('Two wheelchair users');
  expect(section('Equipment')).toHaveTextContent('AUDIO × 2 — Wireless');
  expect(section('Equipment')).toHaveTextContent('Reserved: AUDIO × 2');
  expect(section('Equipment placement')).toHaveTextContent('Speakers either side of the stage');
  // Nobody has recorded it, and the screen says so rather than leaving a gap.
  expect(section('Crowd movement')).toHaveTextContent('Not recorded');
  const earlier = section('Previous safety checks');
  expect(earlier).toHaveTextContent('Request changes');
  expect(earlier).toHaveTextContent('Move the stage away from the exit.');
});

test('TC-0156 a review with nothing recorded says so in every section', async () => {
  safetyReviewDetail.mockResolvedValueOnce({
    event: { ...QUEUED, accessibility: [], accessibility_notes: '', equipment: [], equipment_placement: '', crowd_movement: '' },
    bookings: [{ ...REVIEW.bookings[0], capacity: null, exceeds: false, layout: null, emergency_access_notes: '', known_restrictions: '' }],
    reservations: [], reviews: []
  });
  await openReview();
  const booking = within(section('Venue bookings')).getByRole('article');
  expect(booking).toHaveTextContent('Expected attendance150 of Not recorded');
  expect(booking).not.toHaveTextContent('Exceeds venue capacity');
  expect(booking).toHaveTextContent('LayoutNot recorded');
  expect(booking).toHaveTextContent('Emergency accessNot recorded');
  expect(booking).toHaveTextContent('Known restrictionsNot recorded');
  expect(section('Accessibility requirements')).toHaveTextContent('No accessibility requirements stated.');
  expect(section('Equipment')).toHaveTextContent('No equipment requested.');
  expect(section('Equipment')).toHaveTextContent('No equipment reserved.');
  expect(section('Equipment placement')).toHaveTextContent('Not recorded');
  expect(section('Previous safety checks')).toHaveTextContent('No earlier safety checks.');
});

// AC4 — a comment is required before Reject or Request changes is sent.
test('TC-0157 Request changes without a comment is refused on screen; with one it is recorded', async () => {
  const onNotice = jest.fn();
  await openReview({ onNotice });
  const form = section('Record outcome');
  await userEvent.click(within(form).getByRole('radio', { name: 'Request changes' }));
  await userEvent.click(within(form).getByRole('button', { name: 'Record outcome' }));
  expect(within(form).getByRole('alert')).toHaveTextContent('A comment explaining the concern is required to reject or request changes.');
  expect(recordSafetyOutcome).not.toHaveBeenCalled();

  // Read afresh after the outcome, the event has left Safety Review.
  listSafetyQueue.mockResolvedValueOnce([]);
  await userEvent.type(within(form).getByLabelText(/Comment/), 'Move the stage away from the exit.');
  await userEvent.click(within(form).getByRole('button', { name: 'Record outcome' }));
  expect(recordSafetyOutcome).toHaveBeenCalledWith({
    eventId: 'e1', outcome: 'REQUEST_CHANGES', comment: 'Move the stage away from the exit.', marked: ['venue', 'technical']
  });
  await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Safety outcome recorded: Request changes.'));
  expect(await screen.findByText('No events are awaiting a safety check.')).toBeInTheDocument();
  expect(listSafetyQueue).toHaveBeenCalledTimes(2);
});

test('TC-0158 Approve needs no comment, and nothing is sent until an outcome is chosen', async () => {
  await openReview();
  const form = section('Record outcome');
  await userEvent.click(within(form).getByRole('button', { name: 'Record outcome' }));
  expect(within(form).getByRole('alert')).toHaveTextContent('Choose an outcome: Approve, Reject or Request changes.');
  expect(recordSafetyOutcome).not.toHaveBeenCalled();

  await userEvent.click(within(form).getByRole('radio', { name: 'Approve' }));
  await userEvent.click(within(form).getByRole('button', { name: 'Record outcome' }));
  expect(recordSafetyOutcome).toHaveBeenCalledWith({ eventId: 'e1', outcome: 'APPROVE', comment: '' });
  expect(await screen.findByRole('button', { name: 'Review safety' })).toBeInTheDocument();
});

// AC6 — a refusal from Firestore (or the API's own guard) is shown, and the
// review stays open so nothing is lost.
test('TC-0159 a refused outcome is shown and the review stays open', async () => {
  recordSafetyOutcome.mockRejectedValueOnce(new Error('This event has no approved venue booking, so it cannot be confirmed.'));
  await openReview();
  const form = section('Record outcome');
  await userEvent.click(within(form).getByRole('radio', { name: 'Approve' }));
  await userEvent.click(within(form).getByRole('button', { name: 'Record outcome' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('This event has no approved venue booking, so it cannot be confirmed.');
  expect(screen.getByRole('heading', { level: 2, name: 'Partner Summit' })).toBeInTheDocument();
});

// The way back: the workspace header when it hosts one, otherwise the screen's own.
test('TC-0160 the review closes back to the queue, through the header when the workspace hosts it', async () => {
  const onBackChange = jest.fn();
  await openReview({ onBackChange });
  expect(screen.queryByRole('button', { name: 'Back to safety reviews' })).not.toBeInTheDocument();
  const close = onBackChange.mock.calls.map(([callback]) => callback).filter(Boolean).pop();
  expect(typeof close).toBe('function');
  act(() => close());
  expect(await screen.findByRole('button', { name: 'Review safety' })).toBeInTheDocument();
  expect(onBackChange).toHaveBeenLastCalledWith(null);
});

test('TC-0161 standalone, the review offers its own way back', async () => {
  await openReview();
  await userEvent.click(screen.getByRole('button', { name: 'Back to safety reviews' }));
  expect(await screen.findByRole('button', { name: 'Review safety' })).toBeInTheDocument();
});

describe('L2 / L3 edges', () => {
  test('TC-2463 [boundary] a queued event with nothing recorded still reads plainly', async () => {
    listSafetyQueue.mockResolvedValueOnce([{ id: 'e9', status: 'SAFETY_REVIEW' }]);
    render(<SafetyReviewScreen />);
    const card = (await screen.findByRole('heading', { level: 2, name: 'Untitled event' })).closest('article');
    expect(card).toHaveTextContent('Date not set · Time not set–Time not set');
    expect(card).toHaveTextContent('Venues: None booked');
    expect(card).toHaveTextContent('Expected attendance: Not recorded');
  });

  test('TC-2464 [boundary] a review with no name, date, attendance, booking or dated check says so', async () => {
    safetyReviewDetail.mockResolvedValueOnce({
      event: { id: 'e1', status: 'SAFETY_REVIEW', accessibility: [], equipment: [{ equipment_type: 'VISUAL', quantity: 1 }] },
      bookings: [], reservations: [],
      reviews: [{ review_id: 's9', outcome: 'ESCALATED' }]
    });
    render(<SafetyReviewScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Review safety' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Untitled event' })).toBeInTheDocument();
    expect(screen.getByText('Event date').nextSibling).toHaveTextContent('Not recorded');
    expect(screen.getAllByText('Expected attendance')[0].nextSibling).toHaveTextContent('Not recorded');
    expect(section('Venue bookings')).toHaveTextContent('No active venue bookings.');
    expect(section('Equipment')).toHaveTextContent('VISUAL × 1');
    expect(section('Equipment')).not.toHaveTextContent('—');
    expect(section('Previous safety checks')).toHaveTextContent('ESCALATED · Not recorded');
  });

  test('TC-2465 [boundary] a booking with no attendance or times reads Not recorded', async () => {
    safetyReviewDetail.mockResolvedValueOnce({
      ...REVIEW,
      bookings: [{ ...REVIEW.bookings[0], attendance: null, start_datetime: null, end_datetime: null, exceeds: false }]
    });
    await openReview();
    const booking = within(section('Venue bookings')).getByRole('article');
    expect(booking).toHaveTextContent('Not recorded–Not recorded');
    expect(booking).toHaveTextContent('Expected attendanceNot recorded of 120');
  });

  test('TC-2491 [normal] L4 AC2 Request changes sends only the arrangements left ticked; Reject sends none', async () => {
    await openReview();
    const form = section('Record outcome');
    await userEvent.click(within(form).getByRole('radio', { name: 'Request changes' }));
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Venue' }));
    await userEvent.type(within(form).getByLabelText(/Comment/), 'Add a second technician.');
    await userEvent.click(within(form).getByRole('button', { name: 'Record outcome' }));
    expect(recordSafetyOutcome).toHaveBeenCalledWith({
      eventId: 'e1', outcome: 'REQUEST_CHANGES', comment: 'Add a second technician.', marked: ['technical']
    });
    await screen.findByRole('button', { name: 'Review safety' });

    await userEvent.click(screen.getByRole('button', { name: 'Review safety' }));
    const again = await screen.findByRole('region', { name: 'Record outcome' });
    await userEvent.click(within(again).getByRole('radio', { name: 'Reject' }));
    await userEvent.type(within(again).getByLabelText(/Comment/), 'Exit blocked.');
    await userEvent.click(within(again).getByRole('button', { name: 'Record outcome' }));
    expect(recordSafetyOutcome).toHaveBeenLastCalledWith({ eventId: 'e1', outcome: 'REJECT', comment: 'Exit blocked.' });
    await screen.findByRole('button', { name: 'Review safety' });
  });

  test('TC-2466 [failure] failures without a reason get plain messages, and a review that will not open leaves the queue in place', async () => {
    recordSafetyOutcome.mockRejectedValueOnce(new Error(''));
    await openReview();
    const form = section('Record outcome');
    await userEvent.click(within(form).getByRole('radio', { name: 'Approve' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Record outcome' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('The outcome could not be recorded.');
    await userEvent.click(screen.getByRole('button', { name: 'Back to safety reviews' }));

    safetyReviewDetail.mockRejectedValueOnce(new Error(''));
    await userEvent.click(await screen.findByRole('button', { name: 'Review safety' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The review could not be opened.');
    expect(screen.getByRole('button', { name: 'Review safety' })).toBeInTheDocument();

    safetyReviewDetail.mockRejectedValueOnce(new Error('This event is not awaiting a safety check.'));
    await userEvent.click(screen.getByRole('button', { name: 'Review safety' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This event is not awaiting a safety check.');
  });

  test('TC-2467 [failure] a queue that cannot be read for no stated reason says so plainly', async () => {
    listSafetyQueue.mockRejectedValueOnce(new Error(''));
    render(<SafetyReviewScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The safety review queue could not be loaded.');
  });
});
