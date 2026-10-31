// H1 / SCRUM-139 — the Registration tab on the organiser's event page. A third tab beside
// "Event request" and "Clarifications", present only for an event that uses registration
// (the registration flag, B5). The panel itself is tested in RegistrationPanel.test.js; here
// it only reports which event it was given. Kept apart from OrganiserEventDetail.test.js so
// the earlier stories' tests are untouched.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrganiserEventDetail from './OrganiserEventDetail';
import { reviewApi } from './reviewApi';

jest.mock('./reviewApi', () => ({ reviewApi: { detail: jest.fn(), respond: jest.fn() } }));
// B10 — the venue line's read is stubbed so this page never loads the real Firebase client.
jest.mock('./eventVenuesApi', () => ({ loadEventVenueNames: () => Promise.resolve([]) }));
jest.mock('./EventRequestForm', () => ({
  __esModule: true,
  default: () => require('react').createElement('p', null, 'form')
}));
jest.mock('./RegistrationPanel', () => ({
  __esModule: true,
  default: (props) => require('react').createElement('p', null, `registration panel for ${props.eventId}`)
}));

// H8 / SCRUM-146 — the registration list under the settings. Its own tests are in RegistrationList.test.js.
jest.mock('./RegistrationList', () => ({
  __esModule: true,
  default: (props) => require('react').createElement('p', null, `registration list for ${props.eventId}`)
}));

const USER = { uid: 'u1', email: 'nadia.organiser@connectsphere.com' };
const approved = { id: 'e1', name: 'Partner Summit', status: 'APPROVED', open_clarification_id: null, registration_required: true };
const detailFor = (event) => ({
  event: { decision: null, decision_reason: null, decided_at: null, ...event },
  coordinator: { id: 'c1', name: 'Sam Coordinator' }, clarifications: [], responses: []
});

test('TC-1396 H1 AC1 an event that uses registration gets a Registration tab after Event request and Clarifications', async () => {
  reviewApi.detail.mockResolvedValue(detailFor(approved));
  render(<OrganiserEventDetail user={USER} event={approved} />);

  await screen.findByRole('tab', { name: 'Event request' });
  const tabs = screen.getAllByRole('tab');
  expect(tabs).toHaveLength(3);
  expect(tabs[0]).toHaveAccessibleName('Event request');
  expect(tabs[1]).toHaveAccessibleName(/^Clarifications/);
  expect(tabs[2]).toHaveAccessibleName('Registration');
});

test('TC-1397 H1 AC2 opening the Registration tab shows the panel for this event', async () => {
  reviewApi.detail.mockResolvedValue(detailFor(approved));
  render(<OrganiserEventDetail user={USER} event={approved} />);

  await userEvent.click(await screen.findByRole('tab', { name: 'Registration' }));
  expect(screen.getByText('registration panel for e1')).toBeVisible();
});

test('TC-1398 H1 AC1 an event that does not use registration has no Registration tab at all', async () => {
  const noRegistration = { ...approved, registration_required: false };
  reviewApi.detail.mockResolvedValue(detailFor(noRegistration));
  render(<OrganiserEventDetail user={USER} event={noRegistration} />);

  await screen.findByRole('tab', { name: 'Event request' });
  expect(screen.queryByRole('tab', { name: 'Registration' })).not.toBeInTheDocument();
});

test('TC-1399 H1 AC1 a request still under review shows the tab too, so the organiser can see why it cannot be used yet', async () => {
  const underReview = { ...approved, status: 'UNDER_REVIEW' };
  reviewApi.detail.mockResolvedValue(detailFor(underReview));
  render(<OrganiserEventDetail user={USER} event={underReview} />);

  expect(await screen.findByRole('tab', { name: 'Registration' })).toBeInTheDocument();
});

test('TC-1400 H1 a draft is still just the form: no tabs, so no Registration tab', () => {
  render(<OrganiserEventDetail user={USER} event={{ id: 'd1', status: 'DRAFT', registration_required: true }} />);

  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  expect(reviewApi.detail).not.toHaveBeenCalled();
});

test('TC-1401 H1 a clarification the organiser owes still opens first: the Registration tab never steals the landing tab', async () => {
  const awaiting = { ...approved, status: 'UNDER_REVIEW', open_clarification_id: 'q1' };
  reviewApi.detail.mockResolvedValue({ ...detailFor(awaiting), clarifications: [{ id: 'q1', message: 'Confirm numbers.', created_at: '2026-10-07T09:00:00Z' }] });
  render(<OrganiserEventDetail user={USER} event={awaiting} />);

  const clarifications = await screen.findByRole('tab', { name: /^Clarifications/ });
  await screen.findByText('Confirm numbers.');
  expect(clarifications).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Registration' })).toHaveAttribute('aria-selected', 'false');
});

test('TC-1773 H8 AC1 the Registration tab also shows the registration list for this event, after the settings', async () => {
  reviewApi.detail.mockResolvedValue(detailFor(approved));
  render(<OrganiserEventDetail user={USER} event={approved} />);

  await userEvent.click(await screen.findByRole('tab', { name: 'Registration' }));
  const panel = screen.getByText('registration panel for e1');
  const list = screen.getByText('registration list for e1');
  expect(list).toBeVisible();
  expect(panel.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
