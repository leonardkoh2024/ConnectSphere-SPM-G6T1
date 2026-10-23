// H1 / SCRUM-139 — the Registration tab on the organiser's event page: where an organiser
// sets the capacity and the open/close date and time once their event is approved.
//
// UI contract these tests pin (the "necessary UI/UX changes"):
//   - one labelled form, the same field names as the request form (B5) so the organiser
//     sees the same words in both places: Registration capacity, Registration open/close
//     date/time, the four time fields grouped as "Registration window", all in Singapore time;
//   - the venue limit is stated beside the capacity field ("Venue capacity: 140"), set as the
//     input's max, and read out as its description — the organiser learns the limit before
//     typing, not after being refused;
//   - AC5: with attendees registered, "Currently registered: N" sits beside the venue limit, N is
//     the capacity input's min, and a capacity below it is stopped on the field;
//   - a status pill: Not set up / Scheduled / Open / Closed;
//   - where setup is not possible the form is shown read-only with the reason in words
//     (not approved yet, closed) and no Save button, rather than hiding the tab;
//   - errors appear on the field they belong to and in an alert above Save, never only at
//     the top of a long page (the K3 lesson); typed values survive a refused save;
//   - Save shows "Saving…", is disabled meanwhile, and a success is a toast via onNotice.
// registrationApi is mocked, as reviewApi is in EventReviewScreen.test.js; the rules it
// shows are the domain's (H1-TC10 – TC26), so they are not re-derived here.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegistrationPanel from './RegistrationPanel';
import { registrationApi } from './registrationApi';

jest.mock('./registrationApi', () => ({ registrationApi: { load: jest.fn(), save: jest.fn() } }));

const NOW = () => new Date('2026-11-01T02:00:00Z'); // Sun 1 Nov 2026, 10:00 Singapore

const loaded = (overrides = {}) => ({
  settings: {
    registrationCapacity: '80',
    registrationOpenDate: '2026-11-10',
    registrationOpenTime: '09:00',
    registrationCloseDate: '2026-12-01',
    registrationCloseTime: '17:00'
  },
  venueCapacity: 140,
  registeredCount: 0,
  phase: 'SCHEDULED',
  editable: true,
  refusal: null,
  ...overrides
});

const FIELDS = [/registration capacity/i, /registration open date/i, /registration open time/i, /registration close date/i, /registration close time/i];
const saveButton = () => screen.queryByRole('button', { name: /save registration settings/i });

const show = async (state = loaded(), props = {}) => {
  registrationApi.load.mockResolvedValue(state);
  render(<RegistrationPanel eventId="e1" now={NOW} {...props} />);
  await screen.findByLabelText(/registration capacity/i);
};

const retype = async (label, value) => {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, value);
};

test('H1-FT1 AC2 the tab loads the event\'s settings into labelled fields, with the window grouped and stated in Singapore time', async () => {
  await show();

  expect(registrationApi.load).toHaveBeenCalledWith('e1');
  expect(screen.getByLabelText(/registration capacity/i)).toHaveValue(80);
  const window = screen.getByRole('group', { name: /registration window/i });
  expect(within(window).getByLabelText(/registration open date/i)).toHaveValue('2026-11-10');
  expect(within(window).getByLabelText(/registration open time/i)).toHaveValue('09:00');
  expect(within(window).getByLabelText(/registration close date/i)).toHaveValue('2026-12-01');
  expect(within(window).getByLabelText(/registration close time/i)).toHaveValue('17:00');
  expect(screen.getByText(/singapore time/i)).toBeVisible();
  expect(saveButton()).toBeEnabled();
});

test('H1-FT2 shows "Loading registration settings…" while it loads, and the reason if it cannot', async () => {
  registrationApi.load.mockReturnValue(new Promise(() => {}));
  const { unmount } = render(<RegistrationPanel eventId="e1" now={NOW} />);
  expect(screen.getByText('Loading registration settings…')).toBeVisible();
  unmount();

  registrationApi.load.mockRejectedValue(new Error('Your sign-in session is invalid or expired.'));
  render(<RegistrationPanel eventId="e1" now={NOW} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Your sign-in session is invalid or expired.');
  expect(screen.queryByLabelText(/registration capacity/i)).not.toBeInTheDocument();
});

test.each([
  ['NOT_SET', 'Not set up'],
  ['SCHEDULED', 'Scheduled'],
  ['OPEN', 'Open'],
  ['CLOSED', 'Closed']
])('H1-FT3 AC2 the status pill reads %s as "%s"', async (phase, label) => {
  await show(loaded({ phase }));
  expect(screen.getByTestId('registration-phase')).toHaveTextContent(label);
});

test('H1-FT4 AC3 the venue limit is stated beside the capacity, set as its max, and read out as its description', async () => {
  await show();

  const capacity = screen.getByLabelText(/registration capacity/i);
  expect(screen.getByText('Venue capacity: 140')).toBeVisible();
  expect(capacity).toHaveAttribute('max', '140');
  expect(capacity).toHaveAttribute('min', '1');
  expect(capacity).toHaveAccessibleDescription(/venue capacity: 140/i);
});

test('H1-FT5 AC2 AC3 saving sends the edited values, then shows the saved state and a "Registration settings saved." notice', async () => {
  registrationApi.save.mockResolvedValue(loaded({ phase: 'OPEN' }));
  const onNotice = jest.fn();
  await show(loaded(), { onNotice });

  await retype(/registration capacity/i, '120');
  await retype(/registration close date/i, '2026-12-02');
  await userEvent.click(saveButton());

  await waitFor(() => expect(registrationApi.save).toHaveBeenCalledWith('e1', {
    registrationCapacity: '120',
    registrationOpenDate: '2026-11-10',
    registrationOpenTime: '09:00',
    registrationCloseDate: '2026-12-02',
    registrationCloseTime: '17:00'
  }));
  expect(onNotice).toHaveBeenCalledWith('Registration settings saved.');
  expect(await screen.findByText('Open')).toBeVisible();
});

test('H1-FT6 AC3 a capacity above the venue limit is stopped on the field before any request, and focus goes to it', async () => {
  await show();

  await retype(/registration capacity/i, '141');
  await userEvent.click(saveButton());

  const capacity = screen.getByLabelText(/registration capacity/i);
  expect(registrationApi.save).not.toHaveBeenCalled();
  expect(capacity).toHaveAttribute('aria-invalid', 'true');
  expect(capacity).toHaveAccessibleDescription(/registration capacity cannot exceed the venue capacity of 140\./i);
  expect(capacity).toHaveFocus();
  expect(capacity).toHaveValue(141);
});

test('H1-FT7 AC3 the limit can be typed exactly: the venue capacity itself is accepted', async () => {
  registrationApi.save.mockResolvedValue(loaded());
  await show();

  await retype(/registration capacity/i, '140');
  await userEvent.click(saveButton());

  await waitFor(() => expect(registrationApi.save).toHaveBeenCalledTimes(1));
});

test('H1-FT8 AC2 a window that closes before it opens is refused on the close date, with the rule\'s own words', async () => {
  await show();

  await retype(/registration close date/i, '2026-11-09');
  await userEvent.click(saveButton());

  expect(registrationApi.save).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/registration close date/i))
    .toHaveAccessibleDescription(/registration close date\/time must be after registration open date\/time\./i);
});

test('H1-FT9 AC3 when the service refuses, its field message appears on the field, its summary in an alert, and the typed values stay', async () => {
  const refusal = Object.assign(new Error('Check the registration settings.'), {
    fields: { registrationCapacity: 'Registration capacity cannot exceed the venue capacity of 100.' }
  });
  registrationApi.save.mockRejectedValue(refusal);
  await show();

  await retype(/registration capacity/i, '120');
  await userEvent.click(saveButton());

  expect(await screen.findByRole('alert')).toHaveTextContent('Check the registration settings.');
  const capacity = screen.getByLabelText(/registration capacity/i);
  expect(capacity).toHaveAccessibleDescription(/venue capacity of 100/i);
  expect(capacity).toHaveValue(120);
  expect(saveButton()).toBeEnabled();
});

test('H1-FT10 AC3 with no approved venue booking the capacity is read-only with the reason, while the window stays editable', async () => {
  registrationApi.save.mockResolvedValue(loaded({ venueCapacity: null }));
  await show(loaded({ venueCapacity: null }));

  const capacity = screen.getByLabelText(/registration capacity/i);
  expect(capacity).toBeDisabled();
  expect(capacity).toHaveAccessibleDescription(/capacity can be set once a venue booking has been approved\./i);
  expect(screen.queryByText(/venue capacity: /i)).not.toBeInTheDocument();
  FIELDS.slice(1).forEach((label) => expect(screen.getByLabelText(label)).toBeEnabled());

  await retype(/registration open date/i, '2026-11-12');
  await userEvent.click(saveButton());
  await waitFor(() => expect(registrationApi.save).toHaveBeenCalledWith('e1', expect.objectContaining({
    registrationCapacity: '80', registrationOpenDate: '2026-11-12'
  })));
});

test('H1-FT11 AC2 a closed window is shown read-only with the reason, no Save button, and the status Closed', async () => {
  await show(loaded({
    phase: 'CLOSED',
    editable: false,
    refusal: { reason: 'closed', message: 'Registration has closed, so its capacity and window can no longer be changed.' }
  }));

  FIELDS.forEach((label) => expect(screen.getByLabelText(label)).toBeDisabled());
  expect(screen.getByText('Registration has closed, so its capacity and window can no longer be changed.')).toBeVisible();
  expect(screen.getByTestId('registration-phase')).toHaveTextContent('Closed');
  expect(saveButton()).not.toBeInTheDocument();
});

test('H1-FT12 AC1 before approval the form is read-only, says to wait for approval, and offers no Save', async () => {
  await show(loaded({
    phase: 'NOT_SET',
    editable: false,
    refusal: { reason: 'status', message: 'Registration can be opened once your event is approved.' }
  }));

  FIELDS.forEach((label) => expect(screen.getByLabelText(label)).toBeDisabled());
  expect(screen.getByText('Registration can be opened once your event is approved.')).toBeVisible();
  expect(saveButton()).not.toBeInTheDocument();
});

test('H1-FT13 while a save is in flight the button reads "Saving…", is disabled, and a second click sends nothing more', async () => {
  let finish;
  registrationApi.save.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await show();

  await userEvent.click(saveButton());
  const saving = screen.getByRole('button', { name: 'Saving…' });
  expect(saving).toBeDisabled();
  await userEvent.click(saving);
  expect(registrationApi.save).toHaveBeenCalledTimes(1);

  finish(loaded());
  expect(await screen.findByRole('button', { name: /save registration settings/i })).toBeEnabled();
});

test('H1-FT14 every field has a visible label and the form reads in order: capacity, then the four window fields', async () => {
  await show();

  const order = FIELDS.map((label) => screen.getByLabelText(label));
  order.forEach((input) => expect(input).toBeVisible());
  for (let i = 1; i < order.length; i += 1) {
    expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

test('H1-FT21 AC5 with attendees registered the screen says how many, and the capacity cannot be set below that', async () => {
  await show(loaded({ registeredCount: 90, settings: { ...loaded().settings, registrationCapacity: '120' } }));

  const capacity = screen.getByLabelText(/registration capacity/i);
  expect(screen.getByText('Currently registered: 90')).toBeVisible();
  expect(capacity).toHaveAttribute('min', '90');
  expect(capacity).toHaveAttribute('max', '140');
  expect(capacity).toHaveAccessibleDescription(/currently registered: 90/i);
  expect(capacity).toHaveAccessibleDescription(/venue capacity: 140/i);
});

test('H1-FT22 AC5 with nobody registered the "Currently registered" line is not shown', async () => {
  await show(loaded({ registeredCount: 0 }));
  expect(screen.queryByText(/currently registered/i)).not.toBeInTheDocument();
});

test('H1-FT23 AC5 a capacity below the registered count is stopped on the field before any request, and focus goes to it', async () => {
  await show(loaded({ registeredCount: 90, settings: { ...loaded().settings, registrationCapacity: '120' } }));

  await retype(/registration capacity/i, '89');
  await userEvent.click(saveButton());

  const capacity = screen.getByLabelText(/registration capacity/i);
  expect(registrationApi.save).not.toHaveBeenCalled();
  expect(capacity).toHaveAttribute('aria-invalid', 'true');
  expect(capacity).toHaveAccessibleDescription(/registration capacity cannot be less than the 90 people already registered\./i);
  expect(capacity).toHaveFocus();
  expect(capacity).toHaveValue(89);
});

test('H1-FT24 AC5 a capacity equal to the registered count is accepted', async () => {
  registrationApi.save.mockResolvedValue(loaded({ registeredCount: 90 }));
  await show(loaded({ registeredCount: 90, settings: { ...loaded().settings, registrationCapacity: '120' } }));

  await retype(/registration capacity/i, '90');
  await userEvent.click(saveButton());

  await waitFor(() => expect(registrationApi.save).toHaveBeenCalledTimes(1));
});

test('H1-FT25 AC5 when the service refuses a capacity under the registered count, its message appears on the field', async () => {
  const refusal = Object.assign(new Error('Check the registration settings.'), {
    fields: { registrationCapacity: 'Registration capacity cannot be less than the 95 people already registered.' }
  });
  registrationApi.save.mockRejectedValue(refusal);
  // The screen thinks 90 are registered; five more registered since it loaded.
  await show(loaded({ registeredCount: 90, settings: { ...loaded().settings, registrationCapacity: '120' } }));

  await retype(/registration capacity/i, '92');
  await userEvent.click(saveButton());

  expect(await screen.findByRole('alert')).toHaveTextContent('Check the registration settings.');
  expect(screen.getByLabelText(/registration capacity/i)).toHaveAccessibleDescription(/95 people already registered/i);
  expect(screen.getByLabelText(/registration capacity/i)).toHaveValue(92);
});
