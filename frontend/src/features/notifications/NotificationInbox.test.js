// J1 / SCRUM-150 — the inbox screen. AC1 (message, event, timestamp), AC3
// (unread marker; opening marks read) and AC4 (read items stay listed).
// TC-255 – TC-259, and View (TC-264, TC-265), in docs/test-cases.md.

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationInbox from './NotificationInbox';
import { eventsFor } from './notificationsApi';

jest.mock('./notificationsApi', () => ({ eventsFor: jest.fn() }));

const unread = {
  id: 'n1', user_id: 'u1', event_id: 'e1', type: 'EVENT_REJECTED',
  message: 'Your request was rejected: the date clashes with year-end closing.',
  is_read: false, created_at: '2026-10-07T09:30:00.000Z', read_at: null
};
const read = {
  id: 'n2', user_id: 'u1', event_id: 'gone', type: 'CLARIFICATION_REQUESTED',
  message: 'Please confirm the expected attendance.',
  is_read: true, created_at: '2026-10-05T09:30:00.000Z', read_at: '2026-10-05T10:00:00.000Z'
};

const EVENT = { id: 'e1', name: 'Q4 Partner Summit', reference_no: 'EVT-100234', status: 'REJECTED' };

// CRA resets mocks before each test, so the implementation is set here.
beforeEach(() => {
  eventsFor.mockResolvedValue({ e1: EVENT, gone: null });
});

const rows = () => screen.getAllByRole('listitem');

describe('the notification inbox', () => {
  test('TC-255 each row shows the message, the related event and when it arrived', async () => {
    render(<NotificationInbox notifications={[unread]} loading={false} error="" onOpen={jest.fn()} />);

    const row = rows()[0];
    expect(within(row).getByText(unread.message)).toBeInTheDocument();
    expect(await within(row).findByText('Q4 Partner Summit (EVT-100234)')).toBeInTheDocument();
    expect(within(row).getByText('Request rejected')).toBeInTheDocument();
    expect(row.querySelector('time')).toHaveAttribute('dateTime', unread.created_at);
  });

  test('TC-256 unread rows carry the unread marker and read rows do not', async () => {
    render(<NotificationInbox notifications={[unread, read]} loading={false} error="" onOpen={jest.fn()} />);
    await screen.findByText('Q4 Partner Summit (EVT-100234)');

    const [first, second] = rows();
    expect(within(first).getByText('Unread')).toBeInTheDocument();
    expect(first).toHaveClass('cs-notification-unread');
    expect(within(second).queryByText('Unread')).not.toBeInTheDocument();
    expect(second).not.toHaveClass('cs-notification-unread');
  });

  test('TC-257 opening an unread notification marks it read and shows its detail', async () => {
    const onOpen = jest.fn();
    render(<NotificationInbox notifications={[unread]} loading={false} error="" onOpen={onOpen} />);
    await screen.findByText('Q4 Partner Summit (EVT-100234)');

    const open = within(rows()[0]).getByRole('button');
    await userEvent.click(open);

    expect(onOpen).toHaveBeenCalledWith('n1');
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Received')).toBeInTheDocument();
  });

  test('TC-258 a read notification stays listed and opens without being marked again', async () => {
    const onOpen = jest.fn();
    render(<NotificationInbox notifications={[read]} loading={false} error="" onOpen={onOpen} />);

    await userEvent.click(within(rows()[0]).getByRole('button'));

    expect(screen.getAllByText(read.message).length).toBeGreaterThan(0);
    expect(onOpen).not.toHaveBeenCalled();
    expect(await screen.findAllByText('Event no longer available')).not.toHaveLength(0);
  });

  test('TC-259 an empty inbox says so', () => {
    render(<NotificationInbox notifications={[]} loading={false} error="" onOpen={jest.fn()} />);

    expect(screen.getByText('You have no notifications yet.')).toBeInTheDocument();
  });
});

describe('viewing the related event from the inbox', () => {
  test('TC-264 View opens the related event and marks an unread notification read', async () => {
    const onOpen = jest.fn();
    const onViewEvent = jest.fn();
    render(<NotificationInbox notifications={[unread]} loading={false} error="" onOpen={onOpen} onViewEvent={onViewEvent} />);

    await userEvent.click(await screen.findByRole('button', { name: 'View Q4 Partner Summit (EVT-100234)' }));

    expect(onViewEvent).toHaveBeenCalledWith(EVENT);
    expect(onOpen).toHaveBeenCalledWith('n1');
  });

  test('TC-265 there is no View for an unreadable event, nor for a role with no event screen', async () => {
    const { rerender } = render(<NotificationInbox notifications={[read]} loading={false} error="" onOpen={jest.fn()} onViewEvent={jest.fn()} />);
    await screen.findByText('Event no longer available');
    expect(screen.queryByRole('button', { name: /^View/ })).not.toBeInTheDocument();

    rerender(<NotificationInbox notifications={[unread]} loading={false} error="" onOpen={jest.fn()} />);
    await screen.findByText('Q4 Partner Summit (EVT-100234)');
    expect(screen.queryByRole('button', { name: /^View/ })).not.toBeInTheDocument();
  });
});
