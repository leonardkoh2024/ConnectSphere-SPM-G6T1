import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventReviewScreen from './EventReviewScreen';
import { reviewApi } from './reviewApi';

jest.mock('./reviewApi', () => ({ reviewApi: {
  list: jest.fn(), detail: jest.fn(), openReview: jest.fn(), clarify: jest.fn(), reject: jest.fn(), reassign: jest.fn()
} }));

const baseEvent = { id: 'e1', name: 'Partner Summit', reference_no: 'EVT-001', event_date: '2026-11-04', start_time: '09:00', end_time: '17:00', expected_attendance: 100, purpose: 'Partners', description: 'Annual summit', status: 'UNDER_REVIEW', coordinator_id: 'c1', editable: true };
const detail = (changes = {}) => ({
  event: { ...baseEvent, ...changes }, coordinator: { id: 'c1', name: 'Sam Coordinator' },
  coordinators: [{ id: 'c1', name: 'Sam Coordinator' }, { id: 'c2', name: 'Alex Coordinator' }],
  clarifications: [], responses: [], assignments: []
});

beforeEach(() => {
  reviewApi.list.mockResolvedValue({ events: [baseEvent] });
  reviewApi.detail.mockResolvedValue(detail());
  reviewApi.openReview.mockResolvedValue({ ok: true });
  reviewApi.clarify.mockResolvedValue({ ok: true });
  reviewApi.reject.mockResolvedValue({ ok: true });
  reviewApi.reassign.mockResolvedValue({ ok: true });
});

async function openRequest() {
  render(<EventReviewScreen />);
  await userEvent.click(await screen.findByRole('button', { name: /view request/i }));
  await screen.findByRole('button', { name: /back to events/i });
}

test('TC-060/061 requests clarification only after a non-empty message', async () => {
  await openRequest();
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
  expect(screen.queryByRole('button', { name: /request clarification/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /reject request/i })).not.toBeInTheDocument();
});

test('TC-063 retains the timestamped clarification exchange', async () => {
  reviewApi.detail.mockResolvedValue({ ...detail(), clarifications: [{ id: 'q1', message: 'Confirm attendance', created_at: '2026-09-23T10:00:00Z' }], responses: [{ id: 'a1', message: 'It is 150.', created_at: '2026-09-23T11:00:00Z' }] });
  await openRequest();
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

test('TC-077 reassigns to a different active coordinator', async () => {
  await openRequest();
  await userEvent.click(screen.getByRole('button', { name: /reassign event/i }));
  const select = screen.getByRole('combobox', { name: /new active coordinator/i });
  expect(within(select).queryByRole('option', { name: 'Sam Coordinator' })).not.toBeInTheDocument();
  await userEvent.selectOptions(select, 'c2');
  await userEvent.click(screen.getByRole('button', { name: /^reassign$/i }));
  await waitFor(() => expect(reviewApi.reassign).toHaveBeenCalledWith('e1', 'c2'));
});

test('TC-078 an outgoing coordinator gets a read-only assignment view', async () => {
  reviewApi.list.mockResolvedValue({ events: [{ ...baseEvent, editable: false }] });
  reviewApi.detail.mockResolvedValue(detail({ editable: false }));
  await openRequest();
  expect(screen.getByText(/reassigned.*view.*only the current coordinator/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /reassign event/i })).not.toBeInTheDocument();
});
