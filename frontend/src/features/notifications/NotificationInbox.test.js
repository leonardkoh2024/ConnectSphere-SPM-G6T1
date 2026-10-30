// J1 / SCRUM-150 — the inbox screen. AC1 (message, event, timestamp), AC3
// (unread marker; opening marks read) and AC4 (read items stay listed), and View.

import { act, render, screen, within } from '@testing-library/react';
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
  test('TC-2085 each row shows the message, the related event and when it arrived', async () => {
    render(<NotificationInbox notifications={[unread]} loading={false} error="" onOpen={jest.fn()} />);

    const row = rows()[0];
    expect(within(row).getByText(unread.message)).toBeInTheDocument();
    expect(await within(row).findByText('Q4 Partner Summit (EVT-100234)')).toBeInTheDocument();
    expect(within(row).getByText('Request rejected')).toBeInTheDocument();
    expect(row.querySelector('time')).toHaveAttribute('dateTime', unread.created_at);
  });

  test('TC-2086 unread rows carry the unread marker and read rows do not', async () => {
    render(<NotificationInbox notifications={[unread, read]} loading={false} error="" onOpen={jest.fn()} />);
    await screen.findByText('Q4 Partner Summit (EVT-100234)');

    const [first, second] = rows();
    expect(within(first).getByText('Unread')).toBeInTheDocument();
    expect(first).toHaveClass('cs-notification-unread');
    expect(within(second).queryByText('Unread')).not.toBeInTheDocument();
    expect(second).not.toHaveClass('cs-notification-unread');
  });

  test('TC-2087 opening an unread notification marks it read and shows its detail', async () => {
    const onOpen = jest.fn();
    render(<NotificationInbox notifications={[unread]} loading={false} error="" onOpen={onOpen} />);
    await screen.findByText('Q4 Partner Summit (EVT-100234)');

    const open = within(rows()[0]).getByRole('button');
    await userEvent.click(open);

    expect(onOpen).toHaveBeenCalledWith('n1');
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Received')).toBeInTheDocument();
  });

  test('TC-2088 a read notification stays listed and opens without being marked again', async () => {
    const onOpen = jest.fn();
    render(<NotificationInbox notifications={[read]} loading={false} error="" onOpen={onOpen} />);
    // Wait for the event lookup first, so its result does not land outside act().
    expect(await screen.findAllByText('Event no longer available')).not.toHaveLength(0);

    await userEvent.click(within(rows()[0]).getByRole('button'));

    expect(screen.getAllByText(read.message).length).toBeGreaterThan(0);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('TC-2089 an empty inbox says so', () => {
    render(<NotificationInbox notifications={[]} loading={false} error="" onOpen={jest.fn()} />);

    expect(screen.getByText('You have no notifications yet.')).toBeInTheDocument();
  });
});

describe('viewing the related event from the inbox', () => {
  test('TC-2090 View opens the related event and marks an unread notification read', async () => {
    const onOpen = jest.fn();
    const onViewEvent = jest.fn();
    render(<NotificationInbox notifications={[unread]} loading={false} error="" onOpen={onOpen} onViewEvent={onViewEvent} />);

    await userEvent.click(await screen.findByRole('button', { name: 'View Q4 Partner Summit (EVT-100234)' }));

    expect(onViewEvent).toHaveBeenCalledWith(EVENT, unread);
    expect(onOpen).toHaveBeenCalledWith('n1');
  });

  test('TC-2091 there is no View for an unreadable event, nor for a role with no event screen', async () => {
    const { rerender } = render(<NotificationInbox notifications={[read]} loading={false} error="" onOpen={jest.fn()} onViewEvent={jest.fn()} />);
    await screen.findByText('Event no longer available');
    expect(screen.queryByRole('button', { name: /^View/ })).not.toBeInTheDocument();

    rerender(<NotificationInbox notifications={[unread]} loading={false} error="" onOpen={jest.fn()} />);
    await screen.findByText('Q4 Partner Summit (EVT-100234)');
    expect(screen.queryByRole('button', { name: /^View/ })).not.toBeInTheDocument();
  });
});

// J6 / SCRUM-155. Outcomes arrive in the same
// inbox, read in words, and View hands over the outcome so the workspace can
// open that booking or equipment request (AC2, AC4).
describe('J6 booking and equipment outcomes in the inbox', () => {
  const approved = {
    id: 'n3', user_id: 'u1', event_id: 'e1', type: 'VENUE_BOOKING_APPROVED', booking_id: 'VB-1', venue_id: 'VEN-1',
    message: 'Q4 Partner Summit: the booking for Harbour Hall was approved.',
    is_read: false, created_at: '2026-10-15T09:30:00.000Z', read_at: null
  };
  const unable = {
    id: 'n4', user_id: 'u1', event_id: 'e1', type: 'EQUIPMENT_UNABLE_TO_FULFIL', equipment_line_index: 1,
    message: 'Q4 Partner Summit: Technical Support cannot fulfil 1 × visual. Reason: Projector under repair.',
    is_read: true, created_at: '2026-10-15T08:30:00.000Z', read_at: '2026-10-15T08:40:00.000Z'
  };

  test('TC-2227 each outcome reads in words, and View hands over that outcome', async () => {
    const onOpen = jest.fn();
    const onViewEvent = jest.fn();
    render(<NotificationInbox notifications={[approved, unable]} loading={false} error="" onOpen={onOpen} onViewEvent={onViewEvent} />);

    const [first, second] = rows();
    expect(within(first).getByText('Venue booking approved')).toBeInTheDocument();
    expect(within(first).getByText(approved.message)).toBeInTheDocument();
    expect(within(second).getByText('Equipment unavailable')).toBeInTheDocument();
    expect(within(second).getByText(/Reason: Projector under repair\./)).toBeInTheDocument();

    const views = await screen.findAllByRole('button', { name: 'View Q4 Partner Summit (EVT-100234)' });
    await userEvent.click(views[0]);
    expect(onViewEvent).toHaveBeenLastCalledWith(EVENT, approved);
    expect(onOpen).toHaveBeenCalledWith('n3');

    await userEvent.click(views[1]);
    expect(onViewEvent).toHaveBeenLastCalledWith(EVENT, unable);
    // Already read: viewing it again does not mark it a second time.
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

// J4 / SCRUM-153. Venue Staff cannot
// read events, so a booking notice names its event itself.
describe('an event this role may not read', () => {
  const notice = (fields) => ({
    id: 'n9', user_id: 'staff', event_id: 'e9', type: 'VENUE_BOOKING_REQUESTED',
    message: 'Christy Test: a venue booking request was raised for Queenstown Community Theatre.',
    is_read: false, created_at: '2026-10-19T00:39:00.000Z', read_at: null, ...fields
  });

  test('TC-2157 the event name stored on the notification is shown, with no View', async () => {
    eventsFor.mockResolvedValue({ e9: false });
    render(<NotificationInbox notifications={[notice({ event_name: 'Christy Test' })]} loading={false} error="" onOpen={jest.fn()} onViewEvent={jest.fn()} />);

    expect(await screen.findByText('Christy Test')).toBeInTheDocument();
    expect(screen.queryByText('Event no longer available')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^View/ })).not.toBeInTheDocument();
  });

  test('TC-2264 J9 SCRUM-192 opening a safety notice after the event has left the queue hides its details', async () => {
    const waiting = {
      id: 'n-safety', user_id: 'so-1', event_id: 'e1', type: 'SAFETY_REVIEW_WAITING',
      message: 'Q4 Partner Summit on 2026-11-04 at Harbour Hall for 180 is waiting for its safety check.',
      is_read: false, created_at: '2026-10-20T09:00:00.000Z', read_at: null
    };
    render(<NotificationInbox notifications={[waiting]} loading={false} error="" onOpen={jest.fn()} onViewEvent={jest.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: /Waiting for a safety check/i }));

    expect(screen.getAllByText('Q4 Partner Summit has left the safety review queue.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^View/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Q4 Partner Summit (EVT-100234)')).not.toBeInTheDocument();
  });

  test('TC-2158 an older notice with no stored name says the event is not shared, not that it is gone', async () => {
    eventsFor.mockResolvedValue({ e9: false });
    render(<NotificationInbox notifications={[notice()]} loading={false} error="" onOpen={jest.fn()} />);

    expect(await screen.findByText('Event details not shared with your role')).toBeInTheDocument();
    expect(screen.queryByText('Event no longer available')).not.toBeInTheDocument();
  });
});

// J1 — an attendee cannot read `events`, so the workspace hands the inbox a lookup that
// reads their registrations instead.
describe("J1 an attendee's notifications", () => {
  test('TC-2092 the event comes from the lookup the workspace passes, and View opens it', async () => {
    const offer = {
      id: 'n-offer', user_id: 'attendee-1', event_id: 'e7', type: 'WAITLIST_PLACE_OFFERED',
      message: 'Waitlist Demo Workshop: a place is offered to you until 7 Nov 2026, 12:00.',
      is_read: false, created_at: '2026-10-28T09:00:00.000Z', read_at: null
    };
    const loadEvents = jest.fn().mockResolvedValue({ e7: { id: 'e7', name: 'Waitlist Demo Workshop' } });
    const onViewEvent = jest.fn();
    render(<NotificationInbox notifications={[offer]} loading={false} error="" onOpen={jest.fn()} onViewEvent={onViewEvent} loadEvents={loadEvents} />);

    await userEvent.click(await screen.findByRole('button', { name: 'View Waitlist Demo Workshop' }));

    expect(loadEvents).toHaveBeenCalledWith(['e7']);
    expect(eventsFor).not.toHaveBeenCalled();
    expect(onViewEvent).toHaveBeenCalledWith({ id: 'e7', name: 'Waitlist Demo Workshop' }, offer);
  });
});

describe('the inbox at its edges', () => {
  const notice = (fields) => ({
    id: 'n20', user_id: 'u1', event_id: 'e1', type: 'EVENT_SUBMITTED', message: 'Received.', is_read: true,
    created_at: '2026-10-20T09:00:00.000Z', read_at: null, ...fields
  });

  test('TC-2255 [normal] J8 AC3 a Lead notice for an event since assigned names the coordinator and offers no assignment', async () => {
    eventsFor.mockResolvedValue({ e1: { ...EVENT, status: 'UNDER_REVIEW', coordinator_id: 'c1', coordinator_name: 'Amir Tan' }, e2: { id: 'e2', name: 'Workshop', coordinator_id: 'c2' } });
    const waiting = notice({ id: 'n21', type: 'UNASSIGNED_EVENT', message: 'Q4 Partner Summit is waiting for a coordinator.' });
    const other = notice({ id: 'n22', event_id: 'e2', type: 'UNASSIGNED_EVENT', message: 'Workshop is waiting.' });
    render(<NotificationInbox notifications={[waiting, other]} loading={false} error="" onOpen={jest.fn()} onViewEvent={jest.fn()} />);
    await screen.findByText('Q4 Partner Summit (EVT-100234)');

    await userEvent.click(within(rows()[0]).getAllByRole('button')[0]);
    expect(screen.getByText('Coordinator').nextSibling).toHaveTextContent('Amir Tan');
    expect(screen.queryByRole('button', { name: /^View/ })).not.toBeInTheDocument();

    await userEvent.click(within(rows()[1]).getAllByRole('button')[0]);
    expect(screen.getByText('Coordinator').nextSibling).toHaveTextContent('c2');
  });

  test('TC-2256 [normal] J8 a Lead notice for an event still unassigned keeps its View', async () => {
    eventsFor.mockResolvedValue({ e1: { ...EVENT, status: 'SUBMITTED', coordinator_id: null } });
    render(<NotificationInbox notifications={[notice({ type: 'UNASSIGNED_EVENT' })]} loading={false} error="" onOpen={jest.fn()} onViewEvent={jest.fn()} />);
    expect(await screen.findByRole('button', { name: 'View Q4 Partner Summit (EVT-100234)' })).toBeInTheDocument();
    await userEvent.click(within(rows()[0]).getAllByRole('button')[0]);
    expect(screen.queryByText('Coordinator')).not.toBeInTheDocument();
  });

  test('TC-2265 [normal] J9 a safety notice for an event still in Safety Review keeps its details and View', async () => {
    eventsFor.mockResolvedValue({ e1: { ...EVENT, status: 'SAFETY_REVIEW' } });
    const waiting = notice({ type: 'SAFETY_REVIEW_WAITING', message: 'Q4 Partner Summit is waiting for its safety check.' });
    render(<NotificationInbox notifications={[waiting]} loading={false} error="" onOpen={jest.fn()} onViewEvent={jest.fn()} />);
    expect(await screen.findByRole('button', { name: 'View Q4 Partner Summit (EVT-100234)' })).toBeInTheDocument();
    await userEvent.click(within(rows()[0]).getAllByRole('button')[0]);
    expect(screen.getByText('Message').nextSibling).toHaveTextContent('Q4 Partner Summit is waiting for its safety check.');
    expect(screen.getByText('Event').nextSibling).toHaveTextContent('Q4 Partner Summit (EVT-100234)');
  });

  test('TC-2093 [boundary] opening a row again closes it; a notice with no event or time still reads', async () => {
    const onOpen = jest.fn();
    render(<NotificationInbox notifications={[notice({ event_id: null, created_at: null, is_read: false })]} loading={false} error="" onOpen={onOpen} />);
    expect(eventsFor).not.toHaveBeenCalled();
    expect(screen.getByText('No related event')).toBeInTheDocument();
    expect(screen.getByText('Just now')).toBeInTheDocument();

    const toggle = within(rows()[0]).getByRole('button');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(rows()[0].querySelector('time')).not.toHaveAttribute('dateTime');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test('TC-2094 [boundary] while the related events load, each row says so', () => {
    eventsFor.mockReturnValue(new Promise(() => {}));
    render(<NotificationInbox notifications={[notice()]} loading={false} error="" onOpen={jest.fn()} />);
    expect(screen.getByText('Loading event…')).toBeInTheDocument();
  });

  test('TC-2095 [boundary] the loading state shows no list', () => {
    eventsFor.mockReturnValue(new Promise(() => {}));
    render(<NotificationInbox notifications={[notice()]} loading error="" onOpen={jest.fn()} />);
    expect(screen.getByText('Loading your notifications…')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  test('TC-2096 [failure] a failed load is reported above an empty inbox and above a list', async () => {
    const { rerender } = render(<NotificationInbox notifications={[]} loading={false} error="We could not load your notifications." onOpen={jest.fn()} />);
    expect(screen.getByText('We could not load your notifications.')).toBeInTheDocument();
    expect(screen.getByText('You have no notifications yet.')).toBeInTheDocument();

    rerender(<NotificationInbox notifications={[notice()]} loading={false} error="We could not mark that notification as read." onOpen={jest.fn()} />);
    expect(screen.getByText('We could not mark that notification as read.')).toBeInTheDocument();
    await screen.findByText('Q4 Partner Summit (EVT-100234)');
  });

  test('TC-2097 [failure] an event that is gone but whose name the notice carries is named, not called gone', async () => {
    eventsFor.mockResolvedValue({ e1: null });
    render(<NotificationInbox notifications={[notice({ event_name: 'Old Summit' })]} loading={false} error="" onOpen={jest.fn()} onViewEvent={jest.fn()} />);
    expect(await screen.findByText('Old Summit')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^View/ })).not.toBeInTheDocument();
  });

  test('TC-2098 [failure] events that arrive after the inbox has gone are dropped', async () => {
    let finish;
    eventsFor.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { unmount } = render(<NotificationInbox notifications={[notice()]} loading={false} error="" onOpen={jest.fn()} />);
    unmount();
    await act(async () => { finish({ e1: EVENT }); });
    expect(screen.queryByText('Q4 Partner Summit (EVT-100234)')).not.toBeInTheDocument();
  });
});
