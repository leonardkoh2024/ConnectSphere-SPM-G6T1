// H8 / SCRUM-146 — the registration list on the organiser's Registration tab: who has registered
// for this event, and how many are registered, waitlisted and withdrawn.
//
// UI contract these tests pin:
//   - a "Registered attendees" heading, and a "Registration counts" list with three items,
//     "Registered N", "Waitlisted N", "Withdrawn N" (AC2) — counts are shown even when no one
//     has registered, as zeros;
//   - a table named "Registered attendees" with the columns Name, Email, Mobile number and
//     Registered at (AC1); the time is Singapore time, "3 Nov 2026, 09:00";
//   - the people in the table are the registered ones only; waitlisted and withdrawn people are
//     counts and never rows (the service sends no one else);
//   - an attendee whose profile could not be read still gets a row, "Name not available";
//   - a line that tells the organiser the list is theirs alone (AC3: "be assured");
//   - Refresh asks the service again, because attendees keep registering while the organiser plans;
//   - a failed load (a refusal, the service down) is an alert naming the reason, never a silent
//     empty list.
// registrationApi is mocked, as in RegistrationPanel.test.js; what the service sends is tested
// in attendeeList.test.js and registrationApi.browser.test.js.

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegistrationList from './RegistrationList';
import { registrationApi } from './registrationApi';

jest.mock('./registrationApi', () => ({ registrationApi: { loadAttendees: jest.fn() } }));

const attendee = (overrides = {}) => ({
  id: 'r1', attendeeId: 'a1', name: 'Alicia Tan', email: 'alicia@example.com', mobileNumber: '91234567',
  registeredAt: '2026-11-03T01:00:00.000Z', ...overrides
});

const loaded = (overrides = {}) => ({
  counts: { registered: 2, waitlisted: 3, withdrawn: 1 },
  attendees: [attendee(), attendee({ id: 'r2', attendeeId: 'a2', name: 'Bala Raj', email: 'bala@example.com', mobileNumber: '98765432', registeredAt: '2026-11-03T06:30:00.000Z' })],
  ...overrides
});

beforeEach(() => {
  registrationApi.loadAttendees.mockResolvedValue(loaded());
});

test('TC-1780 H8 AC1 the list is requested for this event and shows each registered attendee\'s name, email, mobile number and registration time', async () => {
  render(<RegistrationList eventId="e1" />);

  const table = await screen.findByRole('table', { name: 'Registered attendees' });
  expect(registrationApi.loadAttendees).toHaveBeenCalledWith('e1');
  expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Name', 'Email', 'Mobile number', 'Registered at']);

  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByText('Alicia Tan')).toBeVisible();
  expect(within(rows[0]).getByText('alicia@example.com')).toBeVisible();
  expect(within(rows[0]).getByText('91234567')).toBeVisible();
  expect(within(rows[0]).getByText('3 Nov 2026, 09:00')).toBeVisible();
  expect(within(rows[1]).getByText('Bala Raj')).toBeVisible();
  expect(within(rows[1]).getByText('3 Nov 2026, 14:30')).toBeVisible();
});

test('TC-1781 H8 AC2 the counts of registered, waitlisted and withdrawn attendees are shown', async () => {
  render(<RegistrationList eventId="e1" />);

  const counts = await screen.findByRole('list', { name: 'Registration counts' });
  const items = within(counts).getAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent(/^Registered\s*2$/);
  expect(items[1]).toHaveTextContent(/^Waitlisted\s*3$/);
  expect(items[2]).toHaveTextContent(/^Withdrawn\s*1$/);
});

test('TC-1782 H8 AC2 with no one registered the counts still show, as zeros, with a plain message instead of an empty table', async () => {
  registrationApi.loadAttendees.mockResolvedValue({ counts: { registered: 0, waitlisted: 0, withdrawn: 0 }, attendees: [] });
  render(<RegistrationList eventId="e1" />);

  expect(await screen.findByText('No one has registered yet.')).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  const items = within(screen.getByRole('list', { name: 'Registration counts' })).getAllByRole('listitem');
  expect(items.map((item) => item.textContent.replace(/\s+/g, ' ').trim())).toEqual(['Registered 0', 'Waitlisted 0', 'Withdrawn 0']);
});

test('TC-1783 H8 AC2 people on the waiting list but no one registered still shows that count, not a blank page', async () => {
  registrationApi.loadAttendees.mockResolvedValue({ counts: { registered: 0, waitlisted: 4, withdrawn: 2 }, attendees: [] });
  render(<RegistrationList eventId="e1" />);

  const counts = await screen.findByRole('list', { name: 'Registration counts' });
  expect(within(counts).getAllByRole('listitem')[1]).toHaveTextContent(/^Waitlisted\s*4$/);
  expect(screen.getByText('No one has registered yet.')).toBeVisible();
});

test('TC-1784 H8 AC1 an attendee whose details could not be read still has a row, marked as unavailable, not a blank or a crash', async () => {
  registrationApi.loadAttendees.mockResolvedValue(loaded({
    counts: { registered: 1, waitlisted: 0, withdrawn: 0 },
    attendees: [attendee({ name: null, email: null, mobileNumber: null })]
  }));
  render(<RegistrationList eventId="e1" />);

  const table = await screen.findByRole('table', { name: 'Registered attendees' });
  const row = within(table).getAllByRole('row')[1];
  expect(within(row).getByText('Name not available')).toBeVisible();
  expect(within(row).getAllByText('Not available')).toHaveLength(2);
  expect(within(row).getByText('3 Nov 2026, 09:00')).toBeVisible();
});

test('TC-1785 H8 AC1 a registration with no recorded time says so', async () => {
  registrationApi.loadAttendees.mockResolvedValue(loaded({ counts: { registered: 1, waitlisted: 0, withdrawn: 0 }, attendees: [attendee({ registeredAt: null })] }));
  render(<RegistrationList eventId="e1" />);

  const row = within(await screen.findByRole('table', { name: 'Registered attendees' })).getAllByRole('row')[1];
  expect(within(row).getByText('Time not recorded')).toBeVisible();
});

test('TC-1786 H8 AC3 the organiser is told the list is theirs alone', async () => {
  render(<RegistrationList eventId="e1" />);

  expect(await screen.findByText('Only you, as the organiser of this event, can see this list.')).toBeVisible();
});

test('TC-1787 H8 while the list loads the organiser sees that, and no table or counts', async () => {
  let release;
  registrationApi.loadAttendees.mockReturnValue(new Promise((resolve) => { release = resolve; }));
  render(<RegistrationList eventId="e1" />);

  expect(screen.getByText('Loading the registration list…')).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Registration counts' })).not.toBeInTheDocument();
  release(loaded());
  expect(await screen.findByRole('table', { name: 'Registered attendees' })).toBeVisible();
});

test('TC-1788 H8 AC3 a refusal from the service is an alert with its reason, and no list or counts are shown', async () => {
  registrationApi.loadAttendees.mockRejectedValue(new Error('You can view the registration list for your own events only.'));
  render(<RegistrationList eventId="e2" />);

  expect(await screen.findByRole('alert')).toHaveTextContent('You can view the registration list for your own events only.');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Registration counts' })).not.toBeInTheDocument();
  expect(screen.queryByText('No one has registered yet.')).not.toBeInTheDocument();
});

test('TC-1789 H8 a service that is down is an alert, not an empty list', async () => {
  registrationApi.loadAttendees.mockRejectedValue(new Error('The registration service is not responding. Check that the backend is running (npm start), then try again.'));
  render(<RegistrationList eventId="e1" />);

  expect(await screen.findByRole('alert')).toHaveTextContent(/registration service is not responding/i);
  expect(screen.queryByText('No one has registered yet.')).not.toBeInTheDocument();
});

test('TC-1790 H8 Refresh asks the service again and shows the new list', async () => {
  registrationApi.loadAttendees.mockResolvedValueOnce(loaded());
  registrationApi.loadAttendees.mockResolvedValueOnce(loaded({
    counts: { registered: 3, waitlisted: 3, withdrawn: 1 },
    attendees: [...loaded().attendees, attendee({ id: 'r3', attendeeId: 'a3', name: 'Chen Wei', email: 'chen@example.com', mobileNumber: '81112222', registeredAt: '2026-11-04T01:00:00.000Z' })]
  }));
  render(<RegistrationList eventId="e1" />);
  await screen.findByRole('table', { name: 'Registered attendees' });
  expect(screen.queryByText('Chen Wei')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

  expect(await screen.findByText('Chen Wei')).toBeVisible();
  expect(registrationApi.loadAttendees).toHaveBeenCalledTimes(2);
  expect(within(screen.getByRole('list', { name: 'Registration counts' })).getAllByRole('listitem')[0]).toHaveTextContent(/^Registered\s*3$/);
});

test('TC-1791 H8 a refresh that fails keeps the list the organiser already had and says why it could not update', async () => {
  registrationApi.loadAttendees.mockResolvedValueOnce(loaded());
  registrationApi.loadAttendees.mockRejectedValueOnce(new Error('The registration service is not responding. Check that the backend is running (npm start), then try again.'));
  render(<RegistrationList eventId="e1" />);
  await screen.findByRole('table', { name: 'Registered attendees' });

  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/registration service is not responding/i);
  expect(screen.getByText('Alicia Tan')).toBeVisible();
});

test('TC-1792 H8 AC1 opening another event asks for that event\'s list and never shows the previous event\'s people', async () => {
  registrationApi.loadAttendees.mockResolvedValueOnce(loaded());
  registrationApi.loadAttendees.mockResolvedValueOnce({
    counts: { registered: 1, waitlisted: 0, withdrawn: 0 },
    attendees: [attendee({ id: 'r9', attendeeId: 'a9', name: 'Zed Ong', email: 'zed@example.com', mobileNumber: '80001111' })]
  });
  const { rerender } = render(<RegistrationList eventId="e1" />);
  await screen.findByText('Alicia Tan');

  rerender(<RegistrationList eventId="e2" />);

  expect(await screen.findByText('Zed Ong')).toBeVisible();
  expect(registrationApi.loadAttendees).toHaveBeenLastCalledWith('e2');
  expect(screen.queryByText('Alicia Tan')).not.toBeInTheDocument();
});

test('TC-1793 H8 a slow answer for the previous event cannot overwrite the event now on screen', async () => {
  let releaseFirst;
  registrationApi.loadAttendees.mockReturnValueOnce(new Promise((resolve) => { releaseFirst = resolve; }));
  registrationApi.loadAttendees.mockResolvedValueOnce({
    counts: { registered: 1, waitlisted: 0, withdrawn: 0 },
    attendees: [attendee({ id: 'r9', attendeeId: 'a9', name: 'Zed Ong', email: 'zed@example.com', mobileNumber: '80001111' })]
  });
  const { rerender } = render(<RegistrationList eventId="e1" />);
  rerender(<RegistrationList eventId="e2" />);
  await screen.findByText('Zed Ong');

  releaseFirst(loaded());

  await waitFor(() => expect(registrationApi.loadAttendees).toHaveBeenCalledTimes(2));
  expect(screen.getByText('Zed Ong')).toBeVisible();
  expect(screen.queryByText('Alicia Tan')).not.toBeInTheDocument();
});

test('TC-1794 [conflict] a slow failure for the previous event cannot put its error on the event now on screen', async () => {
  let failFirst;
  registrationApi.loadAttendees.mockReturnValueOnce(new Promise((_resolve, reject) => { failFirst = reject; }));
  registrationApi.loadAttendees.mockResolvedValueOnce(loaded());
  const { rerender } = render(<RegistrationList eventId="e1" />);
  rerender(<RegistrationList eventId="e2" />);
  await screen.findByText('Alicia Tan');

  await act(async () => { failFirst(new Error('You can view the registration list for your own events only.')); });

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('Alicia Tan')).toBeVisible();
});
