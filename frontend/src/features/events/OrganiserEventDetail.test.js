// The organiser's event request page and its two tabs.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrganiserEventDetail from './OrganiserEventDetail';
import { reviewApi } from './reviewApi';
import { loadEventVenueNames } from './eventVenuesApi';

jest.mock('./reviewApi', () => ({ reviewApi: { detail: jest.fn(), respond: jest.fn(), cancelUnassigned: jest.fn() } }));
// The form is its own story; here it only reports whether it was left editable.
jest.mock('./EventRequestForm', () => ({
  __esModule: true,
  default: (props) => require('react').createElement('p', null, props.readOnly ? 'form read-only' : 'form editable')
}));
// H1's Registration tab is its own story (RegistrationPanel.test.js); mocked so this page's tests
// never load the real Firebase client.
jest.mock('./RegistrationPanel', () => ({ __esModule: true, default: () => null }));

// H8's registration list sits in the same tab; mocked for the same reason.
jest.mock('./RegistrationList', () => ({ __esModule: true, default: () => null }));
// B10 — the venues come from the event service; stubbed here, tested in eventVenuesApi.test.js.
jest.mock('./eventVenuesApi', () => ({ loadEventVenueNames: jest.fn() }));

const USER = { uid: 'u1', email: 'nadia.organiser@connectsphere.com' };

// CRA resets mocks before each test, so the venues' default answer is set here.
beforeEach(() => { loadEventVenueNames.mockResolvedValue([]); });
const submitted = { id: 'e1', name: 'Partner Summit', status: 'UNDER_REVIEW', open_clarification_id: null };
const detailFor = (event, clarifications = []) => ({
  event: { decision: null, decision_reason: null, decided_at: null, ...event },
  coordinator: { id: 'c1', name: 'Sam Coordinator' }, clarifications, responses: []
});

test('TC-0295 a draft is just the form, with no tabs', () => {
  render(<OrganiserEventDetail user={USER} event={{ id: 'd1', status: 'DRAFT' }} />);

  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  expect(screen.getByText('form editable')).toBeInTheDocument();
  expect(reviewApi.detail).not.toHaveBeenCalled();
});

test('TC-0296 a submitted request opens on the read-only request, with the decision above it', async () => {
  reviewApi.detail.mockResolvedValue(detailFor(submitted));
  render(<OrganiserEventDetail user={USER} event={submitted} />);

  expect(await screen.findByRole('tab', { name: 'Event request' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Sam Coordinator')).toBeVisible();
  expect(screen.getByText('form read-only')).toBeVisible();

  await userEvent.click(screen.getByRole('tab', { name: /^Clarifications/ }));
  expect(screen.getByText('No clarification has been requested for this event.')).toBeVisible();
});

test('TC-0297 an organiser who owes an answer lands on Clarifications, replies there, and the form stays editable until then', async () => {
  const awaiting = { ...submitted, open_clarification_id: 'q1' };
  const question = { id: 'q1', message: 'Please confirm the expected attendance.', created_at: '2026-10-07T09:00:00Z' };
  reviewApi.detail.mockResolvedValueOnce(detailFor(awaiting, [question]));
  reviewApi.detail.mockResolvedValue(detailFor(submitted, [question]));
  reviewApi.respond.mockResolvedValue({ ok: true });
  const onNotice = jest.fn();
  render(<OrganiserEventDetail user={USER} event={awaiting} onNotice={onNotice} />);

  const tab = await screen.findByRole('tab', { name: /^Clarifications\s*1\s*, reply needed$/ });
  await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
  expect(screen.getByText(question.message)).toBeVisible();
  expect(screen.getByText('form editable')).not.toBeVisible();

  await userEvent.type(screen.getByLabelText(/your response/i), 'It is 150.');
  await userEvent.click(screen.getByRole('button', { name: 'Send response' }));

  await waitFor(() => expect(reviewApi.respond).toHaveBeenCalledWith('e1', 'q1', 'It is 150.'));
  expect(onNotice).toHaveBeenCalledWith('Your clarification response was sent.');
  expect(await screen.findByText('form read-only')).toBeInTheDocument();
});

// B10 / SCRUM-101.
test('TC-0298 a submitted event shows the venues approved for it, or To be confirmed', async () => {
  loadEventVenueNames.mockResolvedValue(['Harbour Hall', 'Pier Room']);
  reviewApi.detail.mockResolvedValue(detailFor(submitted));
  const { unmount } = render(<OrganiserEventDetail user={USER} event={submitted} />);
  expect(await screen.findByText('Harbour Hall, Pier Room')).toBeInTheDocument();
  expect(loadEventVenueNames).toHaveBeenCalledWith('e1');
  unmount();

  loadEventVenueNames.mockResolvedValue([]);
  render(<OrganiserEventDetail user={USER} event={submitted} />);
  expect(await screen.findByText('To be confirmed')).toBeInTheDocument();
});

test('TC-0299 a draft asks for no venues, and a failed read says so without hiding the request', async () => {
  render(<OrganiserEventDetail user={USER} event={{ id: 'd1', status: 'DRAFT' }} />);
  expect(loadEventVenueNames).not.toHaveBeenCalled();

  loadEventVenueNames.mockRejectedValue(new Error('down'));
  reviewApi.detail.mockResolvedValue(detailFor(submitted));
  render(<OrganiserEventDetail user={USER} event={submitted} />);
  expect(await screen.findByText('Could not be loaded right now.')).toBeInTheDocument();
  expect(screen.getByText('form read-only')).toBeInTheDocument();
});

// K1 / C5 / B10 — the cancel-while-unassigned form, and what the page does when a
// read or a write fails, or when it is closed before its reads answer.
describe('organiser event page: cancelling, failures and late answers', () => {
  const waiting = { id: 'e1', name: 'Partner Summit', status: 'SUBMITTED', coordinator_id: null };

  test('TC-2277 [normal] K1 a request still waiting for a coordinator can be cancelled with a reason, and the page reloads', async () => {
    reviewApi.detail.mockResolvedValueOnce(detailFor(waiting));
    reviewApi.detail.mockResolvedValue(detailFor({ ...waiting, status: 'CANCELLED' }));
    reviewApi.cancelUnassigned.mockResolvedValue({ ok: true });
    const onNotice = jest.fn();
    render(<OrganiserEventDetail user={USER} event={waiting} onNotice={onNotice} />);

    await userEvent.type(await screen.findByLabelText(/cancellation reason/i), 'Plans changed');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }));

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('The request was cancelled and has left the unassigned queue.'));
    expect(reviewApi.cancelUnassigned).toHaveBeenCalledWith('e1', 'Plans changed');
    expect(reviewApi.detail).toHaveBeenCalledTimes(2);
    // Cancelled, so the form is gone.
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
  });

  test('TC-0300 [failure] a detail that cannot be loaded shows the reason instead of the tabs ever loading', async () => {
    reviewApi.detail.mockRejectedValue(new Error('You are not authorised to view this event.'));
    render(<OrganiserEventDetail user={USER} event={submitted} />);

    expect(await screen.findByText('You are not authorised to view this event.')).toBeInTheDocument();
    expect(screen.queryByText('Loading event request…')).not.toBeInTheDocument();
  });

  test('TC-0393 [failure] C5 / K1 an empty answer is refused on screen, and a refused answer or cancellation shows the service message', async () => {
    const awaiting = { ...waiting, status: 'UNDER_REVIEW', coordinator_id: 'c1', open_clarification_id: 'q1' };
    const question = { id: 'q1', message: 'How many?', created_at: '2026-10-07T09:00:00Z' };
    reviewApi.detail.mockResolvedValue(detailFor(awaiting, [question]));
    reviewApi.respond.mockRejectedValue(new Error('This clarification is already answered.'));
    render(<OrganiserEventDetail user={USER} event={awaiting} />);

    await screen.findByLabelText(/your response/i);
    await userEvent.click(screen.getByRole('button', { name: 'Send response' }));
    expect(screen.getByText('Response message is required.')).toBeInTheDocument();
    expect(reviewApi.respond).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/your response/i), 'Two hundred');
    await userEvent.click(screen.getByRole('button', { name: 'Send response' }));
    expect(await screen.findByText('This clarification is already answered.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send response' })).toBeEnabled();
  });

  test('TC-2278 [conflict] K1 a cancellation the service refuses (for example, a coordinator was assigned meanwhile) is reported and the form stays', async () => {
    reviewApi.detail.mockResolvedValue(detailFor(waiting));
    reviewApi.cancelUnassigned.mockRejectedValue(new Error('A reason is required to cancel this event.'));
    render(<OrganiserEventDetail user={USER} event={waiting} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel request' }));

    expect(await screen.findByText('A reason is required to cancel this event.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeEnabled();
  });

  test('TC-0301 [boundary] closing the page before its venue read answers changes nothing, whether the read succeeds or fails', async () => {
    let answer;
    let refuse;
    reviewApi.detail.mockResolvedValue(detailFor({ ...submitted, status: undefined }));
    loadEventVenueNames.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const first = render(<OrganiserEventDetail user={USER} event={submitted} />);
    await screen.findByText('form read-only');
    first.unmount();
    answer(['Hall A']);

    loadEventVenueNames.mockReturnValueOnce(new Promise((resolve, reject) => { refuse = reject; }));
    const second = render(<OrganiserEventDetail user={USER} event={submitted} />);
    await screen.findByText('form read-only');
    second.unmount();
    refuse(new Error('down'));
    await Promise.resolve();
    expect(screen.queryByText('Hall A')).not.toBeInTheDocument();
  });
});
