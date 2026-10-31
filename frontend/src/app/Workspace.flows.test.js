// The workspace shell's navigation between screens: what each screen hands back to
// the shell (onNotice, onSaved, onFindVenues, onBackChange …) and where the shell then
// goes. Workspace.test.js covers which screens a role may reach (A4); this file covers
// moving between them. Each screen is a stub that offers a button per callback.

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { signOut } from 'firebase/auth';
import Workspace from './Workspace';
import { screenHash } from './routes';
import { ROLES } from '../domain/roles';
import useNotifications from '../features/notifications/useNotifications';
import useVenueClashCount from '../features/venues/useVenueClashCount';

jest.mock('../lib/firebase', () => ({ auth: { name: 'auth' }, db: {} }));
jest.mock('firebase/auth', () => ({ signOut: jest.fn() }));
jest.mock('../features/notifications/useNotifications', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../features/venues/useVenueClashCount', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../features/registrations/registrationsApi', () => ({ registeredEventsFor: jest.fn() }));

// A stub screen: its own label, then one button per [label, handler] pair.
const mockStub = (text, buttons = []) => {
  const { createElement: h, Fragment: F } = require('react');
  return h(F, null, h('p', null, text), ...buttons.map(([label, onClick]) => h('button', { key: label, type: 'button', onClick }, label)));
};

jest.mock('../features/events/OrganiserEventDetail', () => ({
  __esModule: true,
  default: (props) => mockStub(`event detail ${props.event ? props.event.id : 'new'}`, [
    ['save draft', () => props.onSaved('Draft saved.', { id: 'd1', status: 'DRAFT', organiser_id: 'u1' })],
    ['submit and close', () => props.onSaved('Request submitted.', null)],
    ['raise error', () => props.onNotice('Could not save.', 'error')]
  ])
}));
jest.mock('../features/events/EventList', () => ({
  __esModule: true,
  default: (props) => mockStub('event list', [
    ['create', props.onCreate],
    ['edit draft', () => props.onEdit({ id: 'd2', status: 'DRAFT', organiser_id: 'u1' })],
    ['view submitted', () => props.onView({ id: 'e5', status: 'SUBMITTED', organiser_id: 'u1' })],
    ['delete', () => props.onDeleted('Draft deleted.')]
  ])
}));
jest.mock('../features/events/EventReviewScreen', () => ({
  __esModule: true,
  default: (props) => mockStub(`review ${props.queueOnly ? 'queue' : 'assigned'} ${props.initialEventId || '-'} ${props.initialTab || '-'}`, [
    ['find venues', () => props.onFindVenues({ id: 'e1', name: 'Harbour Summit' })],
    ['open detail', () => props.onBackChange(() => props.onBackChange(null))],
    ['notify', () => props.onNotice('Approved.')]
  ])
}));
jest.mock('../features/venues/VenueSearch', () => ({
  __esModule: true,
  default: (props) => mockStub(`venue search ${props.event ? props.event.id : '-'} ${props.showCalendar ? 'calendar' : 'list'}`, [
    ['book venue', () => props.onBookVenue(props.event, { id: 'v1' })]
  ])
}));
jest.mock('../features/venues/VenueBookings', () => ({
  __esModule: true,
  default: (props) => mockStub(`bookings ${props.creating ? 'form' : 'list'} ${props.event ? props.event.id : '-'} ${props.venue ? props.venue.id : '-'}`, [
    ['view booked event', () => props.onViewEvent('e1')],
    ['find replacement', () => props.onFindReplacement({ id: 'e2', reference_no: 'EVT-2' })]
  ])
}));
jest.mock('../features/equipment/EquipmentRequestsScreen', () => ({
  __esModule: true,
  default: (props) => mockStub('equipment requests', [['view equipment event', () => props.onViewEvent('e3')]])
}));
jest.mock('../features/changeRequests/ChangeRequestsScreen', () => ({
  __esModule: true,
  default: (props) => mockStub(`organiser change requests ${props.creating ? 'form' : 'list'} ${props.initialEventId || '-'}`)
}));
jest.mock('../features/changeRequests/ChangeRequestDecisionsScreen', () => ({ __esModule: true, default: () => mockStub('coordinator change decisions') }));
jest.mock('../features/events/LeadAssignmentScreen', () => ({ __esModule: true, default: (props) => mockStub(`lead ${props.view}`) }));
jest.mock('../features/venues/VenueCatalogue', () => ({ __esModule: true, default: (props) => mockStub(`catalogue ${props.showCalendar ? 'calendar' : 'list'}`) }));
jest.mock('../features/venues/VenueAvailability', () => ({ __esModule: true, default: () => mockStub('availability calendar') }));
jest.mock('../features/venues/VenueBookingQueue', () => ({ __esModule: true, default: () => mockStub('booking queue') }));
jest.mock('../features/venues/VenueSafetyInformation', () => ({ __esModule: true, default: () => mockStub('venue safety information') }));
jest.mock('../features/safety/SafetyReviewScreen', () => ({ __esModule: true, default: () => mockStub('safety reviews') }));
jest.mock('../features/registrations/BrowseEvents', () => ({ __esModule: true, default: () => mockStub('browse events') }));
jest.mock('../features/registrations/MyRegistrations', () => ({ __esModule: true, default: (props) => mockStub(`my registrations ${props.focusEventId || '-'}`) }));
jest.mock('../features/equipment/EquipmentQueueScreen', () => ({ __esModule: true, default: () => mockStub('equipment queue') }));
jest.mock('../features/equipment/EquipmentAvailabilityScreen', () => ({ __esModule: true, default: () => mockStub('equipment availability') }));
jest.mock('../features/equipment/EquipmentCatalogueScreen', () => ({ __esModule: true, default: () => mockStub('equipment catalogue') }));
jest.mock('../features/equipment/EquipmentReservationsScreen', () => ({ __esModule: true, default: () => mockStub('equipment reservations') }));
// View hands over a change decision, which opens the request rather than the event (I2 AC4).
jest.mock('../features/notifications/NotificationInbox', () => ({
  __esModule: true,
  default: (props) => mockStub('inbox', props.onViewEvent ? [
    ['view change decision', () => props.onViewEvent({ id: 'e1', status: 'PLANNING', organiser_id: 'o1' }, { type: 'CHANGE_REQUEST_ACCEPTED', event_id: 'e1' })],
    ['view change request', () => props.onViewEvent({ id: 'e1', status: 'PLANNING', organiser_id: 'o1' }, { type: 'CHANGE_REQUESTED', event_id: 'e1' })]
  ] : [])
}));

const USER = { uid: 'u1', email: 'nadia.organiser@connectsphere.com' };
const click = (name) => userEvent.click(screen.getByRole('button', { name }));
const heading = () => screen.getByRole('heading', { level: 1 });
const header = () => within(document.querySelector('.cs-panel-head'));
const sidebar = () => within(document.querySelector('.cs-sidebar-screens'));
const open = (role, name, user = USER) => {
  if (name) window.location.hash = screenHash(role, name);
  return render(<Workspace user={user} role={role} />);
};

beforeEach(() => {
  useNotifications.mockReturnValue({ notifications: [], unread: 0, loading: false, error: '', markRead: jest.fn() });
  useVenueClashCount.mockReturnValue({ count: 0, refresh: jest.fn(), setFromBookings: jest.fn() });
  window.location.hash = '';
  sessionStorage.clear();
  localStorage.clear();
});

describe('organiser screens', () => {
  describe('normal', () => {
    test('TC-0173 B1 Create new event request in the My events header opens a blank request, and Back returns to My events', async () => {
      open(ROLES.ORGANISER);
      await userEvent.click(header().getByRole('button', { name: 'Create new event request' }));
      expect(heading()).toHaveTextContent('New event request');
      expect(screen.getByText('event detail new')).toBeInTheDocument();

      await click('Back to my events');
      expect(heading()).toHaveTextContent('My events');
      expect(window.location.hash).toBe(screenHash(ROLES.ORGANISER, 'My events'));
    });

    test.each([
      ['create', 'event detail new', 'New event request'],
      ['edit draft', 'event detail d2', 'Event request'],
      ['view submitted', 'event detail e5', 'Event request']
    ])('TC-0221 B7 "%s" from the list opens the request page for that event', async (button, rendered, title) => {
      open(ROLES.ORGANISER);
      await click(button);
      expect(screen.getByText(rendered)).toBeInTheDocument();
      expect(heading()).toHaveTextContent(title);
      expect(screen.getByRole('button', { name: 'Back to my events' })).toBeInTheDocument();
    });

    test('TC-1858 a deleted draft is confirmed in a toast', async () => {
      open(ROLES.ORGANISER);
      await click('delete');
      expect(document.querySelector('.cs-toasts')).toHaveTextContent('Draft deleted.');
    });

    test('TC-1859 saving a draft keeps the request open on that draft and confirms it', async () => {
      open(ROLES.ORGANISER, 'New event request');
      await click('save draft');
      expect(document.querySelector('.cs-toasts')).toHaveTextContent('Draft saved.');
      expect(screen.getByText('event detail d1')).toBeInTheDocument();
      // A draft cannot take a change request (I1 AC1).
      expect(screen.queryByRole('button', { name: 'Request a change' })).not.toBeInTheDocument();
    });

    test('TC-1860 a request page opened straight from its address still goes back to My events', async () => {
      open(ROLES.ORGANISER, 'New event request');
      await click('Back to my events');
      expect(heading()).toHaveTextContent('My events');
    });

    test('TC-1861 submitting closes the request and lands back on My events with the confirmation', async () => {
      open(ROLES.ORGANISER, 'New event request');
      await click('submit and close');
      expect(heading()).toHaveTextContent('My events');
      expect(document.querySelector('.cs-toasts')).toHaveTextContent('Request submitted.');
    });

    test('TC-1862 I2 AC4 View on a change decision opens Change requests, not the event or the form', async () => {
      open(ROLES.ORGANISER, 'Notifications');
      await click('view change decision');
      expect(heading()).toHaveTextContent('Change requests');
      expect(screen.getByText('organiser change requests list -')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Back to notifications' })).toBeInTheDocument();
    });

    test('TC-1797 I1 the sidebar opens Change requests on the list, with no event preselected', async () => {
      open(ROLES.ORGANISER);
      await userEvent.click(sidebar().getByRole('button', { name: 'Change requests' }));
      expect(screen.getByText('organiser change requests list -')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Back to/ })).not.toBeInTheDocument();
    });
  });

  describe('failure', () => {
    test('TC-1863 an error a screen reports appears as an error toast', async () => {
      open(ROLES.ORGANISER, 'New event request');
      await click('raise error');
      expect(screen.getByText('Could not save.').closest('.cs-toast')).toHaveClass('cs-toast-error');
    });
  });
});

describe('coordinator screens', () => {
  describe('normal', () => {
    test('TC-0597 E3 Find venues from the review queue opens the catalogue shortlisted for that event, with a way back', async () => {
      open(ROLES.COORDINATOR);
      await click('find venues');
      expect(heading()).toHaveTextContent('Venue catalogue');
      expect(screen.getByText('Shortlist for Harbour Summit.')).toBeInTheDocument();
      expect(screen.getByText('venue search e1 list')).toBeInTheDocument();

      await click('Back to review queue');
      expect(heading()).toHaveTextContent('Review queue');
    });

    test('TC-0736 E8 booking a shortlisted venue opens Venue bookings with the form already open for that event and venue', async () => {
      open(ROLES.COORDINATOR, 'Assigned events');
      await click('find venues');
      await click('book venue');
      expect(heading()).toHaveTextContent('Venue bookings');
      expect(screen.getByText('bookings form e1 v1')).toBeInTheDocument();
      expect(header().queryByRole('button', { name: 'New booking request' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Back to venue catalogue' })).toBeInTheDocument();
    });

    test('TC-0737 E8 New booking request in the Venue bookings header opens a blank form', async () => {
      open(ROLES.COORDINATOR, 'Venue bookings');
      expect(screen.getByText('bookings list - -')).toBeInTheDocument();
      await userEvent.click(header().getByRole('button', { name: 'New booking request' }));
      expect(screen.getByText('bookings form - -')).toBeInTheDocument();
    });

    test('TC-1033 F11 a booking opens its event under Assigned events, and Find replacement shortlists by reference', async () => {
      open(ROLES.COORDINATOR, 'Venue bookings');
      await click('view booked event');
      expect(screen.getByText('review assigned e1 -')).toBeInTheDocument();

      await userEvent.click(sidebar().getByRole('button', { name: 'Venue bookings' }));
      await click('find replacement');
      expect(screen.getByText('Shortlist for EVT-2.')).toBeInTheDocument();
    });

    test('TC-1151 G1 an equipment request opens its event on the Arrangements tab', async () => {
      open(ROLES.COORDINATOR, 'Equipment requests');
      await click('view equipment event');
      expect(screen.getByText('review assigned e3 arrangements')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Back to equipment requests' })).toBeInTheDocument();
      // The focus is for that visit only: the sidebar opens the plain list.
      await userEvent.click(sidebar().getByRole('button', { name: 'Assigned events' }));
      expect(screen.getByText('review assigned - -')).toBeInTheDocument();
    });

    test('TC-1864 I2 View on a change request notice opens the coordinator\'s Change requests', async () => {
      open(ROLES.COORDINATOR, 'Notifications');
      await click('view change request');
      expect(heading()).toHaveTextContent('Change requests');
      expect(screen.getByText('coordinator change decisions')).toBeInTheDocument();
    });

    test('TC-1865 a detail view inside a screen gets the header Back, which closes that view first', async () => {
      open(ROLES.COORDINATOR);
      expect(screen.queryByRole('button', { name: /^Back to/ })).not.toBeInTheDocument();
      await click('open detail');
      await click('Back to review queue');
      expect(heading()).toHaveTextContent('Review queue');
      expect(screen.queryByRole('button', { name: /^Back to/ })).not.toBeInTheDocument();
    });

    test('TC-0605 E4 Back from the shared calendar returns to the catalogue list', async () => {
      open(ROLES.COORDINATOR, 'Venue catalogue');
      await userEvent.click(header().getByRole('button', { name: 'View calendar' }));
      expect(screen.getByText('venue search - calendar')).toBeInTheDocument();
      await click('Back to venue catalogue');
      expect(screen.getByText('venue search - list')).toBeInTheDocument();
    });

    test('TC-1866 a screen\'s confirmation appears as a success toast', async () => {
      open(ROLES.COORDINATOR);
      await click('notify');
      expect(screen.getByText('Approved.').closest('.cs-toast')).toHaveClass('cs-toast-success');
    });
  });

  describe('boundary', () => {
    test('TC-1867 a clash count of exactly one is named in the singular', () => {
      useVenueClashCount.mockReturnValue({ count: 1, refresh: jest.fn(), setFromBookings: jest.fn() });
      open(ROLES.COORDINATOR);
      expect(screen.getByLabelText('1 active booking clash')).toHaveTextContent('1');
    });
  });
});

describe('every remaining screen opens its own content', () => {
  test.each([
    [ROLES.TECH_SUPPORT, 'Availability check', 'equipment availability'],
    [ROLES.VENUE_STAFF, 'Availability calendar', 'availability calendar'],
    [ROLES.VENUE_STAFF, 'Venue catalogue', 'catalogue list'],
    [ROLES.SAFETY_OFFICER, 'Venue safety information', 'venue safety information'],
    [ROLES.COORDINATOR_LEAD, 'Unassigned queue', 'lead queue'],
    [ROLES.COORDINATOR_LEAD, 'Oversight', 'lead oversight'],
    [ROLES.ATTENDEE, 'My registrations', 'my registrations -']
  ])('TC-1868 [normal] %s — %s', async (role, name, rendered) => {
    open(role);
    await userEvent.click(sidebar().getByRole('button', { name }));
    expect(heading()).toHaveTextContent(name);
    expect(screen.getByText(rendered)).toBeInTheDocument();
  });

  test('TC-1869 [boundary] a screen not yet built says so rather than showing nothing', () => {
    open(ROLES.COORDINATOR, 'Registrations');
    expect(heading()).toHaveTextContent('Registrations');
    expect(screen.getByText(/ready to be connected to its workflow/)).toBeInTheDocument();
  });
});

describe('the address bar', () => {
  test('TC-0045 [normal] A4 moving to another of the role\'s own hashes opens that screen', () => {
    open(ROLES.COORDINATOR);
    act(() => {
      window.location.hash = screenHash(ROLES.COORDINATOR, 'Equipment requests');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(heading()).toHaveTextContent('Equipment requests');
  });

  test('TC-0046 [conflict] A4 moving to another role\'s hash is refused, and the sidebar marks nothing active', () => {
    const { container } = open(ROLES.COORDINATOR);
    act(() => {
      window.location.hash = screenHash(ROLES.COORDINATOR_LEAD, 'Unassigned queue');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(heading()).toHaveTextContent('Not authorised');
    expect(container.querySelector('.cs-sidebar-item-active')).toBeNull();
    expect(screen.queryByText('lead queue')).not.toBeInTheDocument();
  });
});

describe('the sidebar', () => {
  test('TC-1870 [normal] collapsing the navigation is remembered for the next visit', async () => {
    const { container, unmount } = open(ROLES.ORGANISER);
    await click('Collapse navigation');
    expect(container.firstChild).toHaveClass('cs-workspace-collapsed');
    expect(localStorage.getItem('cs-nav-collapsed')).toBe('1');
    unmount();

    open(ROLES.ORGANISER);
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-expanded', 'false');
    await click('Expand navigation');
    expect(localStorage.getItem('cs-nav-collapsed')).toBe('0');
  });

  test('TC-0028 [normal] A3 AC3 logging out ends the session and leaves the protected address', async () => {
    open(ROLES.ORGANISER, 'My events');
    await click('Log out');
    expect(signOut).toHaveBeenCalledWith({ name: 'auth' });
    expect(window.location.hash).toBe('#/sign-in');
  });

  test('TC-1871 [failure] a user with no email still gets an avatar letter', () => {
    const { container } = open(ROLES.ATTENDEE, null, { uid: 'u2' });
    expect(container.querySelector('.cs-sidebar-avatar')).toHaveTextContent('?');
  });
});
