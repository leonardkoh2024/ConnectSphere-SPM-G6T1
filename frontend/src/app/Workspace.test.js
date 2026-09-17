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

import { render, screen, within } from '@testing-library/react';
import Workspace from './Workspace';
import { screenHash } from './routes';
import { ROLES } from '../domain/roles';

jest.mock('../lib/firebase', () => ({ auth: {}, db: {} }));
jest.mock('firebase/auth', () => ({ signOut: jest.fn() }));
jest.mock('../features/events/EventRequestForm', () => ({ __esModule: true, default: () => null }));
jest.mock('../features/events/EventList', () => ({ __esModule: true, default: () => null }));

const USER = { uid: 'u1', email: 'nadia.organiser@connectsphere.com' };

const PERMITTED_SCREENS = {
  [ROLES.ORGANISER]: ['New event request', 'My events', 'Change requests', 'Registrations', 'Notifications'],
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
