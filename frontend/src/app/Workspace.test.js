// Story A4 — "see only what my role permits": the client half. The server half is in
// security/firestoreRules.test.js.
//
// The expected navigation below is written out by hand on purpose. Reading it
// from ROLE_META instead would make the test agree with whatever the code says,
// including a mistake such as handing Attendees the coordinator menu. This list
// is the approved permission matrix; if the two disagree, one of them is wrong
// and the test should say so.
//
// The two event screens are stubbed out because this file is about which screens
// a role can reach, not what they render — and it keeps Firestore out of it.

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Workspace from './Workspace';
import { screenHash } from './routes';
import { ROLES } from '../domain/roles';
import { DISMISS_AFTER_MS } from './Toasts';
import useNotifications from '../features/notifications/useNotifications';
import useVenueClashCount from '../features/venues/useVenueClashCount';

jest.mock('../lib/firebase', () => ({ auth: {}, db: {} }));
jest.mock('firebase/auth', () => ({ signOut: jest.fn() }));
jest.mock('../features/events/OrganiserEventDetail', () => ({ __esModule: true, default: () => null }));
// I1 — reports whether the form is open, and for which event.
jest.mock('../features/changeRequests/ChangeRequestsScreen', () => ({
  __esModule: true,
  default: (props) => `change requests ${props.creating ? 'form' : 'list'}${props.initialEventId ? ` for ${props.initialEventId}` : ''}`
}));
jest.mock('../features/events/EventList', () => ({ __esModule: true, default: () => null }));
// Reports the event it was asked to open, which is all View on a notification decides (J1).
jest.mock('../features/events/EventReviewScreen', () => ({ __esModule: true, default: (props) => (props.initialEventId ? `review of ${props.initialEventId}` : null) }));
jest.mock('../features/events/LeadAssignmentScreen', () => ({ __esModule: true, default: () => null }));
// The venue screens report only whether they were asked for the shared calendar
// (E4), which is the one thing the shell decides for them.
jest.mock('../features/venues/VenueCatalogue', () => ({ __esModule: true, default: (props) => (props.showCalendar ? 'calendar open' : 'venue list') }));
jest.mock('../features/venues/VenueSearch', () => ({ __esModule: true, default: (props) => (props.showCalendar ? 'calendar open' : 'venue list') }));
jest.mock('../features/venues/VenueSafetyInformation', () => ({ __esModule: true, default: () => 'venue safety information' }));
// A7 — the Safety Officer's review screen reports only that it was opened.
jest.mock('../features/safety/SafetyReviewScreen', () => ({ __esModule: true, default: () => 'safety review queue' }));
// J6 — the coordinator's booking and equipment screens report which record they were asked to open.
jest.mock('../features/equipment/EquipmentRequestsScreen', () => ({ __esModule: true, default: (props) => (props.focusEventId ? `equipment request of ${props.focusEventId}` : 'equipment requests') }));
jest.mock('../features/venues/VenueBookings', () => ({ __esModule: true, default: (props) => (props.focusBookingId ? `booking ${props.focusBookingId}` : 'venue bookings') }));
// The remaining screens load from Firestore on mount; stubbed so their loads do not
// update state after a test has finished (act warnings), and because this file is about routing.
jest.mock('../features/venues/VenueBookingQueue', () => ({ __esModule: true, default: () => 'booking queue' }));
jest.mock('../features/venues/VenueAvailability', () => ({ __esModule: true, default: () => 'availability calendar' }));
jest.mock('../features/equipment/EquipmentAvailabilityScreen', () => ({ __esModule: true, default: () => 'equipment availability' }));
jest.mock('../features/changeRequests/ChangeRequestDecisionsScreen', () => ({ __esModule: true, default: () => 'change decisions' }));
jest.mock('../features/equipment/EquipmentQueueScreen', () => ({ __esModule: true, default: () => 'equipment queue' }));
// G2 / G3 — Technical Support's catalogue and reservation list report only that they were opened.
jest.mock('../features/equipment/EquipmentCatalogueScreen', () => ({ __esModule: true, default: () => 'equipment catalogue' }));
jest.mock('../features/equipment/EquipmentReservationsScreen', () => ({ __esModule: true, default: () => 'equipment reservations' }));
// H2 — the attendee's list of open events reports only that it was opened. H3 — and,
// since registering confirms with a toast and opens the event's details, that the shell
// handed it both the toast and the way back.
jest.mock('../features/registrations/BrowseEvents', () => ({ __esModule: true, default: (props) => (props.onNotice && props.onBackChange ? 'open events list' : 'open events list without its handlers') }));
// H4 — the attendee's own registrations report that they were opened, with the way back.
// H5 — withdrawing confirms with a toast, so it is handed that too. J1 — View on a
// notification names the event to open.
jest.mock('../features/registrations/MyRegistrations', () => ({ __esModule: true, default: (props) => (props.focusEventId ? `registration for ${props.focusEventId}` : props.onBackChange && props.onNotice ? 'my registrations list' : 'my registrations without its handlers') }));
// J1 — the live inbox is stubbed so the badge can be driven by hand.
jest.mock('../features/notifications/useNotifications', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../features/venues/useVenueClashCount', () => ({ __esModule: true, default: jest.fn() }));
// The stub offers View only when the shell hands it somewhere to go.
jest.mock('../features/notifications/NotificationInbox', () => ({
  __esModule: true,
  default: (props) => {
    if (!props.onViewEvent) return 'inbox';
    const { createElement, Fragment } = require('react');
    const event = { id: 'e1', name: 'Q4 Partner Summit', status: 'PLANNING', organiser_id: 'o1' };
    const view = (label, notification) => createElement('button', { type: 'button', onClick: () => props.onViewEvent(event, notification) }, label);
    return createElement(Fragment, null,
      view('View event', { type: 'EVENT_REJECTED', event_id: 'e1' }),
      view('View booking outcome', { type: 'VENUE_BOOKING_APPROVED', event_id: 'e1', booking_id: 'VB-1' }),
      view('View equipment outcome', { type: 'EQUIPMENT_UNABLE_TO_FULFIL', event_id: 'e1' }));
  }
}));

const USER = { uid: 'u1', email: 'nadia.organiser@connectsphere.com' };

// What the sidebar offers. "New event request" is deliberately absent: an
// organiser starts one from the button on My events, not from the navigation.
const PERMITTED_SCREENS = {
  [ROLES.ORGANISER]: ['My events', 'Change requests', 'Notifications'],
  [ROLES.COORDINATOR]: ['Review queue', 'Assigned events', 'Venue catalogue', 'Venue bookings', 'Equipment requests', 'Change requests', 'Registrations', 'Notifications'],
  [ROLES.VENUE_STAFF]: ['Booking requests', 'Venue catalogue', 'Availability calendar', 'Notifications'],
  [ROLES.SAFETY_OFFICER]: ['Safety reviews', 'Venue safety information', 'Notifications'],
  [ROLES.TECH_SUPPORT]: ['Equipment queue', 'Availability check', 'Equipment catalogue', 'Reservations', 'Notifications'],
  [ROLES.ATTENDEE]: ['Browse events', 'My registrations', 'Notifications']
};

const sidebarScreens = (container) =>
  [...container.querySelectorAll('.cs-sidebar-screens button')].map((button) => button.textContent);

const givenUnread = (unread) => useNotifications.mockReturnValue({ notifications: [], unread, loading: false, error: '', markRead: jest.fn() });
const givenClashes = (count) => useVenueClashCount.mockReturnValue({ count, refresh: jest.fn(), setFromBookings: jest.fn() });

beforeEach(() => {
  givenUnread(0);
  givenClashes(0);
  window.location.hash = '';
  sessionStorage.clear();
  localStorage.clear();
});

describe('role-specific navigation', () => {
  test.each(Object.entries(PERMITTED_SCREENS))('TC-0047 %s sees exactly its permitted screens', (role, expected) => {
    const { container } = render(<Workspace user={USER} role={role} />);

    expect(sidebarScreens(container)).toEqual(expected);
  });

  test.each(Object.keys(PERMITTED_SCREENS))('TC-0048 %s sees no screen belonging only to another role', (role) => {
    const permitted = PERMITTED_SCREENS[role];
    const otherRolesOnly = Object.entries(PERMITTED_SCREENS)
      .filter(([other]) => other !== role)
      .flatMap(([, screens]) => screens)
      .filter((name) => !permitted.includes(name));

    const { container } = render(<Workspace user={USER} role={role} />);
    const nav = within(container.querySelector('.cs-sidebar-screens'));

    otherRolesOnly.forEach((name) => expect(nav.queryByText(name)).not.toBeInTheDocument());
  });

  // Rendering the sidebar is not the same as being able to use it: this is the
  // only test that actually drives chooseScreen.
  test('TC-0049 choosing a screen from the sidebar opens it', async () => {
    const { container } = render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    await userEvent.click(within(container.querySelector('.cs-sidebar-screens')).getByText('My events'));

    expect(screen.getByRole('heading', { name: 'My events' })).toBeInTheDocument();
  });

  // the two Technical Support screens open their own content, not the
  // "ready to be connected" placeholder Reservations used to show.
  test.each([
    ['Equipment catalogue', 'equipment catalogue'],
    ['Reservations', 'equipment reservations']
  ])('TC-0050 Technical Support choosing %s opens it', async (name, rendered) => {
    const { container } = render(<Workspace user={USER} role={ROLES.TECH_SUPPORT} />);

    await userEvent.click(within(container.querySelector('.cs-sidebar-screens')).getByText(name));

    expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    expect(screen.getByText(rendered)).toBeInTheDocument();
    expect(screen.queryByText(/ready to be connected/)).not.toBeInTheDocument();
  });

  test('TC-0051 an organiser lands on My events', () => {
    render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    expect(screen.getByRole('heading', { name: 'My events' })).toBeInTheDocument();
  });

  test('TC-0052 a screen kept out of the navigation is still one this role may open', () => {
    window.location.hash = screenHash(ROLES.ORGANISER, 'New event request');

    const { container } = render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    expect(screen.getByRole('heading', { name: 'New event request' })).toBeInTheDocument();
    expect(screen.queryByText(/not authorised/i)).not.toBeInTheDocument();
    expect(sidebarScreens(container)).not.toContain('New event request');
  });

  test('TC-0053 another role asking for that same hidden screen is still refused', () => {
    window.location.hash = screenHash(ROLES.ORGANISER, 'New event request');

    render(<Workspace user={USER} role={ROLES.ATTENDEE} />);

    expect(screen.getByRole('heading', { name: /not authorised/i })).toBeInTheDocument();
  });

  test('TC-0054 the role is named alongside the signed-in user', () => {
    render(<Workspace user={USER} role={ROLES.VENUE_STAFF} />);

    expect(screen.getByText('Venue Staff')).toBeInTheDocument();
  });
});

describe('H2 an attendee finds events they can register for', () => {
  test('TC-1459 an attendee lands on Browse events, which lists the open events', () => {
    render(<Workspace user={USER} role={ROLES.ATTENDEE} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Browse events' })).toBeInTheDocument();
    expect(screen.getByText('open events list')).toBeInTheDocument();
  });

  test('TC-1460 no other role is shown the attendee list', () => {
    window.location.hash = screenHash(ROLES.ATTENDEE, 'Browse events');
    render(<Workspace user={USER} role={ROLES.ORGANISER} />);
    expect(screen.queryByText('open events list')).not.toBeInTheDocument();
    expect(screen.getByText('You are not authorised to access this function.')).toBeInTheDocument();
  });
});

describe('requesting a screen that belongs to another role', () => {
  test('TC-0055 an attendee asking for an organiser screen is refused, not shown it', () => {
    window.location.hash = screenHash(ROLES.ORGANISER, 'My events');

    const { container } = render(<Workspace user={USER} role={ROLES.ATTENDEE} />);

    expect(screen.getByRole('heading', { name: /not authorised/i })).toBeInTheDocument();
    expect(screen.getByText(/not authorised to access this function/i)).toBeInTheDocument();
    expect(sidebarScreens(container)).toEqual(PERMITTED_SCREENS[ROLES.ATTENDEE]);
  });

  test('TC-0056 a screen the role does own opens normally', () => {
    window.location.hash = screenHash(ROLES.ATTENDEE, 'My registrations');

    render(<Workspace user={USER} role={ROLES.ATTENDEE} />);

    expect(screen.getByRole('heading', { name: 'My registrations' })).toBeInTheDocument();
    expect(screen.queryByText(/not authorised/i)).not.toBeInTheDocument();
    // H4 — the screen is the attendee's own list, handed the shell's way back.
    expect(screen.getByText('my registrations list')).toBeInTheDocument();
  });
});

// Confirmations used to sit at the top of the panel, which on a form long enough
// to scroll meant scrolling back up to read them.
describe('confirmations appear as toasts in the corner', () => {
  const MESSAGE = 'Your account is ready. Log in to continue.';

  test('TC-0057 a confirmation opens in the toast layer, not in the page body', () => {
    sessionStorage.setItem('cs-account-created', MESSAGE);

    const { container } = render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    expect(container.querySelector('.cs-toasts')).toHaveTextContent(MESSAGE);
    expect(container.querySelector('.cs-panel')).not.toHaveTextContent(MESSAGE);
  });

  test('TC-0058 the toast layer is a live region, so a toast arriving is announced', () => {
    const { container } = render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    const layer = container.querySelector('.cs-toasts');
    expect(layer).toHaveAttribute('role', 'status');
    expect(layer).toHaveAttribute('aria-live', 'polite');
  });

  test('TC-0059 a toast can be dismissed by hand', async () => {
    sessionStorage.setItem('cs-account-created', MESSAGE);
    render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    await userEvent.click(screen.getByRole('button', { name: /dismiss notification/i }));

    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
  });

  test('TC-0060 a toast clears itself, so it does not sit over the form forever', () => {
    jest.useFakeTimers();
    sessionStorage.setItem('cs-account-created', MESSAGE);
    render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(DISMISS_AFTER_MS); });

    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
    jest.useRealTimers();
  });
});

// E4 / SCRUM-120 — one shared availability calendar, opened from the top right of
// the Venue catalogue header rather than from each venue.
describe('the Venue catalogue header opens the shared calendar', () => {
  test.each([ROLES.COORDINATOR, ROLES.VENUE_STAFF])('TC-0606 %s sees View calendar in the page header', async (role) => {
    window.location.hash = screenHash(role, 'Venue catalogue');
    const { container } = render(<Workspace user={USER} role={role} />);

    const header = container.querySelector('.cs-panel-head');
    const button = within(header).getByRole('button', { name: /view calendar/i });
    expect(screen.getByText('venue list')).toBeInTheDocument();

    await userEvent.click(button);
    expect(screen.getByText('calendar open')).toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: /view calendar/i })).not.toBeInTheDocument();

    await userEvent.click(within(container.querySelector('.cs-sidebar')).getByRole('button', { name: /venue catalogue/i }));
    expect(screen.getByText('venue list')).toBeInTheDocument();
  });

  test('TC-0607 other screens do not offer it', () => {
    window.location.hash = screenHash(ROLES.COORDINATOR, 'Review queue');
    const { container } = render(<Workspace user={USER} role={ROLES.COORDINATOR} />);
    expect(within(container.querySelector('.cs-panel-head')).queryByRole('button', { name: /view calendar/i })).not.toBeInTheDocument();
  });
});

// J1 / SCRUM-150 AC3.
describe('J1 the unread badge on the inbox', () => {
  test.each(Object.keys(PERMITTED_SCREENS))('TC-2073 %s sees the unread count on Notifications', (role) => {
    givenUnread(3);
    render(<Workspace user={USER} role={role} />);

    const item = screen.getByRole('button', { name: /^Notifications/ });
    expect(within(item).getByLabelText('3 unread')).toHaveTextContent('3');
  });

  test('TC-2074 with nothing unread there is no badge', () => {
    render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    expect(screen.queryByLabelText(/unread/)).not.toBeInTheDocument();
  });
});

describe('F10 active clash badges in role navigation', () => {
  test.each([
    [ROLES.COORDINATOR, 'Venue bookings'],
    [ROLES.VENUE_STAFF, 'Booking requests']
  ])('TC-0997 %s sees the active clash count on %s', (role, destination) => {
    givenClashes(4);
    render(<Workspace user={USER} role={role} />);

    const item = screen.getByRole('button', { name: new RegExp(`^${destination}`) });
    expect(within(item).getByLabelText('4 active booking clashes')).toHaveTextContent('4');
    expect(within(item).getByLabelText('4 active booking clashes')).toHaveClass('cs-nav-badge-clash');
  });

  test('TC-0998 a zero clash count does not render an empty badge', () => {
    render(<Workspace user={USER} role={ROLES.COORDINATOR} />);
    expect(screen.queryByLabelText(/active booking clash/)).not.toBeInTheDocument();
  });
});

// J1 / SCRUM-150 — View on a notification.
describe('J1 viewing an event from a notification', () => {
  const openInbox = (role) => {
    window.location.hash = screenHash(role, 'Notifications');
    render(<Workspace user={USER} role={role} />);
  };

  test('TC-2075 an organiser lands on that event request, with a way back to the inbox', async () => {
    openInbox(ROLES.ORGANISER);

    await userEvent.click(screen.getByRole('button', { name: 'View event' }));

    expect(window.location.hash).toBe(screenHash(ROLES.ORGANISER, 'New event request'));
    expect(screen.getByRole('heading', { name: 'Event request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to notifications' })).toBeInTheDocument();
  });

  test('TC-2076 a coordinator lands on that event under Assigned events', async () => {
    openInbox(ROLES.COORDINATOR);

    await userEvent.click(screen.getByRole('button', { name: 'View event' }));

    expect(window.location.hash).toBe(screenHash(ROLES.COORDINATOR, 'Assigned events'));
    expect(screen.getByText('review of e1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to notifications' })).toBeInTheDocument();
  });

  test('TC-2077 an attendee lands on their registration for that event, with a way back to the inbox', async () => {
    openInbox(ROLES.ATTENDEE);

    await userEvent.click(screen.getByRole('button', { name: 'View event' }));

    expect(window.location.hash).toBe(screenHash(ROLES.ATTENDEE, 'My registrations'));
    expect(screen.getByText('registration for e1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to notifications' })).toBeInTheDocument();
  });

  test.each([ROLES.VENUE_STAFF, ROLES.TECH_SUPPORT])('TC-2078 %s is offered no View', (role) => {
    openInbox(role);

    expect(screen.queryByRole('button', { name: 'View event' })).not.toBeInTheDocument();
    expect(screen.getByText('inbox')).toBeInTheDocument();
  });
});

// J6 / SCRUM-155 AC2/AC4.
describe("J6 viewing a booking or equipment outcome from a notification", () => {
  beforeEach(() => {
    window.location.hash = screenHash(ROLES.COORDINATOR, 'Notifications');
    render(<Workspace user={USER} role={ROLES.COORDINATOR} />);
  });

  test('TC-2217 a booking outcome opens that booking under Venue bookings', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'View booking outcome' }));

    expect(window.location.hash).toBe(screenHash(ROLES.COORDINATOR, 'Venue bookings'));
    expect(screen.getByText('booking VB-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to notifications' })).toBeInTheDocument();
  });

  test("TC-2218 an equipment outcome opens that event's equipment request", async () => {
    await userEvent.click(screen.getByRole('button', { name: 'View equipment outcome' }));

    expect(window.location.hash).toBe(screenHash(ROLES.COORDINATOR, 'Equipment requests'));
    expect(screen.getByText('equipment request of e1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to notifications' })).toBeInTheDocument();
  });

  test('TC-2219 the focus lasts only for that visit: back, then the sidebar, opens the plain list', async () => {
    const sidebar = (name) => within(document.querySelector('.cs-sidebar-screens')).getByRole('button', { name });

    await userEvent.click(screen.getByRole('button', { name: 'View booking outcome' }));
    expect(screen.getByText('booking VB-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to notifications' }));
    expect(window.location.hash).toBe(screenHash(ROLES.COORDINATOR, 'Notifications'));
    await userEvent.click(sidebar('Venue bookings'));
    expect(screen.getByText('venue bookings')).toBeInTheDocument();

    await userEvent.click(sidebar('Notifications'));
    await userEvent.click(screen.getByRole('button', { name: 'View equipment outcome' }));
    expect(screen.getByText('equipment request of e1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to notifications' }));
    expect(window.location.hash).toBe(screenHash(ROLES.COORDINATOR, 'Notifications'));
    await userEvent.click(sidebar('Equipment requests'));
    expect(screen.getByText('equipment requests')).toBeInTheDocument();
  });
});

describe('A6 the Event Coordinator Lead navigation', () => {
  const LEAD_SCREENS = ['Unassigned queue', 'Oversight'];

  test('TC-0078 A6 AC4 the Lead sees exactly its oversight and assignment screens', () => {
    const { container } = render(<Workspace user={USER} role={ROLES.COORDINATOR_LEAD} />);

    expect(sidebarScreens(container)).toEqual(LEAD_SCREENS);
  });

  test("TC-0079 A6 AC4 the Lead sees none of a coordinator's own working screens", () => {
    const { container } = render(<Workspace user={USER} role={ROLES.COORDINATOR_LEAD} />);
    const nav = within(container.querySelector('.cs-sidebar-screens'));

    ['Review queue', 'Assigned events', 'Venue catalogue', 'Venue bookings',     'Equipment requests', 'Change requests', 'Registrations', 'Notifications']
      .forEach((name) => expect(nav.queryByText(name)).not.toBeInTheDocument());
  });

  test('TC-0080 A6 AC4 the Lead asking for a coordinator screen is refused, not shown it', () => {
    window.location.hash = screenHash(ROLES.COORDINATOR, 'Review queue');

    const { container } = render(<Workspace user={USER} role={ROLES.COORDINATOR_LEAD} />);

    expect(screen.getByRole('heading', { name: /not authorised/i })).toBeInTheDocument();
    expect(sidebarScreens(container)).toEqual(LEAD_SCREENS);
  });
});

// A7 / SCRUM-170 AC5. The Safety Officer lands on the review queue, and
// every screen of the roles they are not is refused to them by hash as well as
// left out of their navigation (AC6 is the server half, in firestoreRules.test.js).
describe('the Safety Officer reaches only safety review functions', () => {
  test('TC-0117 lands on Safety reviews, which renders the review queue', () => {
    render(<Workspace user={USER} role={ROLES.SAFETY_OFFICER} />);
    expect(screen.getByRole('heading', { name: 'Safety reviews' })).toBeInTheDocument();
    expect(screen.getByText('safety review queue')).toBeInTheDocument();
  });

  test.each([
    [ROLES.COORDINATOR, 'Assigned events'],
    [ROLES.COORDINATOR, 'Venue bookings'],
    [ROLES.VENUE_STAFF, 'Booking requests'],
    [ROLES.TECH_SUPPORT, 'Equipment queue'],
    [ROLES.COORDINATOR_LEAD, 'Unassigned queue'],
    [ROLES.ORGANISER, 'New event request']
  ])('TC-0118 a %s screen (%s) asked for by hash is refused', (owner, name) => {
    window.location.hash = screenHash(owner, name);
    render(<Workspace user={USER} role={ROLES.SAFETY_OFFICER} />);
    expect(screen.getByRole('heading', { name: /not authorised/i })).toBeInTheDocument();
  });

  test('TC-0119 no other role is offered Safety reviews', () => {
    Object.values(ROLES).filter((role) => role !== ROLES.SAFETY_OFFICER).forEach((role) => {
      const { container, unmount } = render(<Workspace user={USER} role={role} />);
      expect(sidebarScreens(container)).not.toContain('Safety reviews');
      unmount();
    });
  });
});

// I1 / SCRUM-147.
describe('I1 the organiser reaches the change request form', () => {
  test('TC-1798 Change requests offers New change request in its header, which opens the form', async () => {
    window.location.hash = screenHash(ROLES.ORGANISER, 'Change requests');
    render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    expect(screen.getByText('change requests list')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New change request' }));

    expect(screen.getByText('change requests form')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New change request' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New change request' })).not.toBeInTheDocument();
  });

  test("TC-1799 Request a change in a submitted event's header opens the form for that event", async () => {
    window.location.hash = screenHash(ROLES.ORGANISER, 'Notifications');
    render(<Workspace user={{ ...USER, uid: 'o1' }} role={ROLES.ORGANISER} />);
    await userEvent.click(screen.getByRole('button', { name: 'View event' }));

    await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Request a change' }));

    expect(window.location.hash).toBe(screenHash(ROLES.ORGANISER, 'Change requests'));
    expect(screen.getByText('change requests form for e1')).toBeInTheDocument();
  });

  test("TC-1800 the header offers Request a change only on the organiser's own event", async () => {
    window.location.hash = screenHash(ROLES.ORGANISER, 'Notifications');
    render(<Workspace user={USER} role={ROLES.ORGANISER} />);
    await userEvent.click(screen.getByRole('button', { name: 'View event' }));

    // The stubbed inbox hands over a Planning event owned by o1, not this user.
    expect(screen.getByRole('heading', { name: 'Event request' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request a change' })).not.toBeInTheDocument();
  });
});
