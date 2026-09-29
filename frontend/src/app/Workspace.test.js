// Story A4 — "see only what my role permits" (TC-014, and the client half of
// TC-015).
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

jest.mock('../lib/firebase', () => ({ auth: {}, db: {} }));
jest.mock('firebase/auth', () => ({ signOut: jest.fn() }));
jest.mock('../features/events/EventRequestForm', () => ({ __esModule: true, default: () => null }));
jest.mock('../features/events/EventList', () => ({ __esModule: true, default: () => null }));
jest.mock('../features/events/EventReviewScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('../features/events/components/DecisionSummary', () => ({ __esModule: true, default: () => null }));
jest.mock('../features/venues/VenueCatalogue', () => ({ __esModule: true, default: () => null }));
jest.mock('../features/venues/VenueSearch', () => ({ __esModule: true, default: () => null }));

const USER = { uid: 'u1', email: 'nadia.organiser@connectsphere.com' };

// What the sidebar offers. "New event request" is deliberately absent: an
// organiser starts one from the button on My events, not from the navigation.
const PERMITTED_SCREENS = {
  [ROLES.ORGANISER]: ['My events', 'Change requests', 'Registrations', 'Notifications'],
  [ROLES.COORDINATOR]: ['Review queue', 'Assigned events', 'Venue search', 'Venue bookings', 'Equipment requests', 'Registrations', 'Notifications'],
  [ROLES.VENUE_STAFF]: ['Booking requests', 'Venue catalogue', 'Availability calendar', 'Notifications'],
  [ROLES.TECH_SUPPORT]: ['Equipment queue', 'Availability check', 'Reservations', 'Notifications'],
  [ROLES.ATTENDEE]: ['Browse events', 'My registrations', 'Notifications']
};

const sidebarScreens = (container) =>
  [...container.querySelectorAll('.cs-sidebar-screens button')].map((button) => button.textContent);

beforeEach(() => {
  window.location.hash = '';
  sessionStorage.clear();
  localStorage.clear();
});

describe('TC-014 role-specific navigation', () => {
  test.each(Object.entries(PERMITTED_SCREENS))('%s sees exactly its permitted screens', (role, expected) => {
    const { container } = render(<Workspace user={USER} role={role} />);

    expect(sidebarScreens(container)).toEqual(expected);
  });

  test.each(Object.keys(PERMITTED_SCREENS))('%s sees no screen belonging only to another role', (role) => {
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
  test('choosing a screen from the sidebar opens it', async () => {
    const { container } = render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    await userEvent.click(within(container.querySelector('.cs-sidebar-screens')).getByText('My events'));

    expect(screen.getByRole('heading', { name: 'My events' })).toBeInTheDocument();
  });

  test('TC-072 an organiser lands on My events', () => {
    render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    expect(screen.getByRole('heading', { name: 'My events' })).toBeInTheDocument();
  });

  test('TC-073 a screen kept out of the navigation is still one this role may open', () => {
    window.location.hash = screenHash(ROLES.ORGANISER, 'New event request');

    const { container } = render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    expect(screen.getByRole('heading', { name: 'New event request' })).toBeInTheDocument();
    expect(screen.queryByText(/not authorised/i)).not.toBeInTheDocument();
    expect(sidebarScreens(container)).not.toContain('New event request');
  });

  test('TC-073 another role asking for that same hidden screen is still refused', () => {
    window.location.hash = screenHash(ROLES.ORGANISER, 'New event request');

    render(<Workspace user={USER} role={ROLES.ATTENDEE} />);

    expect(screen.getByRole('heading', { name: /not authorised/i })).toBeInTheDocument();
  });

  test('the role is named alongside the signed-in user', () => {
    render(<Workspace user={USER} role={ROLES.VENUE_STAFF} />);

    expect(screen.getByText('Venue Staff')).toBeInTheDocument();
  });
});

describe('TC-015 requesting a screen that belongs to another role', () => {
  test('an attendee asking for an organiser screen is refused, not shown it', () => {
    window.location.hash = screenHash(ROLES.ORGANISER, 'My events');

    const { container } = render(<Workspace user={USER} role={ROLES.ATTENDEE} />);

    expect(screen.getByRole('heading', { name: /not authorised/i })).toBeInTheDocument();
    expect(screen.getByText(/not authorised to access this function/i)).toBeInTheDocument();
    expect(sidebarScreens(container)).toEqual(PERMITTED_SCREENS[ROLES.ATTENDEE]);
  });

  test('a screen the role does own opens normally', () => {
    window.location.hash = screenHash(ROLES.ATTENDEE, 'My registrations');

    render(<Workspace user={USER} role={ROLES.ATTENDEE} />);

    expect(screen.getByRole('heading', { name: 'My registrations' })).toBeInTheDocument();
    expect(screen.queryByText(/not authorised/i)).not.toBeInTheDocument();
  });
});

// Confirmations used to sit at the top of the panel, which on a form long enough
// to scroll meant scrolling back up to read them.
describe('TC-071 confirmations appear as toasts in the corner', () => {
  const MESSAGE = 'Your account is ready. Log in to continue.';

  test('a confirmation opens in the toast layer, not in the page body', () => {
    sessionStorage.setItem('cs-account-created', MESSAGE);

    const { container } = render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    expect(container.querySelector('.cs-toasts')).toHaveTextContent(MESSAGE);
    expect(container.querySelector('.cs-panel')).not.toHaveTextContent(MESSAGE);
  });

  test('the toast layer is a live region, so a toast arriving is announced', () => {
    const { container } = render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    const layer = container.querySelector('.cs-toasts');
    expect(layer).toHaveAttribute('role', 'status');
    expect(layer).toHaveAttribute('aria-live', 'polite');
  });

  test('a toast can be dismissed by hand', async () => {
    sessionStorage.setItem('cs-account-created', MESSAGE);
    render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    await userEvent.click(screen.getByRole('button', { name: /dismiss notification/i }));

    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
  });

  test('a toast clears itself, so it does not sit over the form forever', () => {
    jest.useFakeTimers();
    sessionStorage.setItem('cs-account-created', MESSAGE);
    render(<Workspace user={USER} role={ROLES.ORGANISER} />);

    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(DISMISS_AFTER_MS); });

    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
    jest.useRealTimers();
  });
});
