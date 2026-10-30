// I1 / SCRUM-147 — the change request form on its own.
// The happy path through the screen is in ChangeRequestsScreen.test.js.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangeRequestForm from './ChangeRequestForm';
import { loadCurrentValues, submitChangeRequest } from '../changeRequestsApi';

jest.mock('../changeRequestsApi', () => ({ loadCurrentValues: jest.fn(), submitChangeRequest: jest.fn() }));

const ASSIGNED = { id: 'e1', name: 'Harbour Tech Forum', reference_no: 'EVT-1', status: 'PLANNING', coordinator_id: 'c1' };
const BARE = { id: 'e9', status: 'SUBMITTED', coordinator_id: null };
const CURRENT = {
  name: 'Harbour Tech Forum', purpose: 'Showcase', description: 'Talks', expected_attendance: 120, event_date: '2099-11-22',
  start_time: '09:00', end_time: '17:00', preferred_location: 'CENTRAL', required_layout: 'THEATRE',
  facilities: ['WIFI'], accessibility: [], accessibility_notes: ''
};

beforeEach(() => {
  loadCurrentValues.mockResolvedValue(CURRENT);
  submitChangeRequest.mockResolvedValue({ id: 'r1', notified: true });
});

const renderForm = (props = {}) => {
  const handlers = { onSubmitted: jest.fn(), onCancel: jest.fn() };
  render(<ChangeRequestForm userId="o1" events={[ASSIGNED, BARE]} initialEventId="e1" {...handlers} {...props} />);
  return handlers;
};
const ready = () => screen.findByRole('checkbox', { name: 'Event name' });
const tick = (name) => userEvent.click(screen.getByRole('checkbox', { name }));
const send = () => userEvent.click(screen.getByRole('button', { name: 'Send change request' }));
const reason = (text) => fireEvent.change(screen.getByRole('textbox', { name: /Reason for the change/ }), { target: { value: text } });

describe('ChangeRequestForm', () => {
  describe('normal', () => {
    test('TC-1839 AC2 each kind of detail gets its own input, starting from the current value', async () => {
      renderForm();
      await ready();
      for (const name of ['Description', 'Date', 'Start time', 'Preferred location', 'Facilities']) await tick(name);

      expect(screen.getByRole('textbox', { name: 'New description' })).toHaveValue('Talks');
      expect(screen.getByLabelText('New date')).toHaveAttribute('type', 'date');
      expect(screen.getByLabelText('New date')).toHaveAttribute('min');
      expect(screen.getByLabelText('New start time')).toHaveAttribute('type', 'time');
      expect(screen.getByRole('combobox', { name: 'New preferred location' })).toHaveValue('CENTRAL');
      const facilities = screen.getByRole('group', { name: 'New facilities' });
      expect(within(facilities).getByRole('checkbox', { name: 'WIFI' })).toBeChecked();
    });

    test('TC-1840 AC2 a list, a choice and a long text can each be changed and are sent as proposed', async () => {
      const { onSubmitted } = renderForm();
      await ready();
      await tick('Facilities');
      await userEvent.click(within(screen.getByRole('group', { name: 'New facilities' })).getByRole('checkbox', { name: 'STAGE' }));
      await tick('Preferred location');
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'New preferred location' }), 'EAST');
      await tick('Description');
      fireEvent.change(screen.getByRole('textbox', { name: 'New description' }), { target: { value: 'Talks and demos' } });
      reason('Growing.');
      await send();

      await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith({ id: 'r1', notified: true }));
      expect(submitChangeRequest).toHaveBeenCalledWith({
        userId: 'o1', event: ASSIGNED, current: CURRENT, reason: 'Growing.',
        fields: ['facilities', 'preferred_location', 'description'],
        proposed: { facilities: ['WIFI', 'STAGE'], preferred_location: 'EAST', description: 'Talks and demos' }
      });
    });

    test('TC-1841 an event with a coordinator says nothing about waiting for one; Cancel hands back', async () => {
      const { onCancel } = renderForm();
      await ready();
      expect(screen.queryByText(/No coordinator is assigned/)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onCancel).toHaveBeenCalled();
    });

    test('TC-1842 an event with no name or reference is still offered, as Untitled event', () => {
      renderForm({ initialEventId: null });
      expect(screen.getByRole('option', { name: 'Untitled event' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Harbour Tech Forum (EVT-1)' })).toBeInTheDocument();
    });
  });

  describe('boundary', () => {
    test('TC-1843 unticking a detail drops it, and ticking it again keeps the value already typed', async () => {
      renderForm();
      await ready();
      await tick('Event name');
      fireEvent.change(screen.getByRole('textbox', { name: 'New event name' }), { target: { value: 'Harbour Forum' } });
      await tick('Event name');
      expect(screen.queryByRole('textbox', { name: 'New event name' })).not.toBeInTheDocument();
      await tick('Event name');
      expect(screen.getByRole('textbox', { name: 'New event name' })).toHaveValue('Harbour Forum');
    });

    test('TC-1844 one problem reads in the singular, several in the plural', async () => {
      renderForm();
      await ready();
      await send();
      expect(screen.getByRole('alert')).toHaveTextContent('2 details need your attention');

      reason('Because.');
      expect(screen.getByRole('alert')).toHaveTextContent('One detail needs your attention');
      expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one detail to change.');
    });

    test('TC-1845 a requested event that is not in the list starts with nothing chosen and cannot be sent', () => {
      renderForm({ initialEventId: 'e-gone' });
      expect(screen.getByRole('combobox', { name: /Event to change/ })).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Send change request' })).toBeDisabled();
      expect(loadCurrentValues).not.toHaveBeenCalled();
    });

    test('TC-1846 submitting with no event chosen does nothing', async () => {
      renderForm({ initialEventId: null });
      await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'New change request' })); });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(submitChangeRequest).not.toHaveBeenCalled();
    });
    test('TC-1847 current values missing from an older event start their new value blank', async () => {
      loadCurrentValues.mockResolvedValue({ name: 'Harbour Tech Forum' });
      render(<ChangeRequestForm userId="o1" events={[ASSIGNED]} onSubmitted={jest.fn()} onCancel={jest.fn()} />);
      expect(screen.getByRole('combobox', { name: /Event to change/ })).toHaveValue('');
      await act(async () => { await userEvent.selectOptions(screen.getByRole('combobox', { name: /Event to change/ }), 'e1'); });
      await ready();
      await tick('Purpose');
      await tick('Accessibility needs');
      expect(screen.getByRole('textbox', { name: 'New purpose' })).toHaveValue('');
      within(screen.getByRole('group', { name: 'New accessibility needs' })).getAllByRole('checkbox').forEach((box) => expect(box).not.toBeChecked());
    });
  });

  describe('conflict', () => {
    test('TC-1848 a second submit while the first is still sending is ignored', async () => {
      let finish;
      submitChangeRequest.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      renderForm();
      await ready();
      await tick('Event name');
      fireEvent.change(screen.getByRole('textbox', { name: 'New event name' }), { target: { value: 'Harbour Forum' } });
      reason('Shorter.');
      await send();
      expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
      await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'New change request' })); });
      expect(submitChangeRequest).toHaveBeenCalledTimes(1);
      await act(async () => { finish({ id: 'r1' }); });
    });

    test('TC-1849 changing the event mid-way starts afresh from that event\'s own values', async () => {
      loadCurrentValues.mockImplementation((event) => Promise.resolve(event.id === 'e1' ? CURRENT : { ...CURRENT, name: '' }));
      renderForm();
      await ready();
      await tick('Event name');
      await act(async () => { await userEvent.selectOptions(screen.getByRole('combobox', { name: /Event to change/ }), 'e9'); });
      expect(await screen.findByText(/No coordinator is assigned to this event yet/)).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Event name' })).not.toBeChecked();
    });
  });

  describe('failure', () => {
    test('TC-1850 an event whose details cannot be loaded says so, and cannot be sent', async () => {
      loadCurrentValues.mockRejectedValue(new Error('offline'));
      renderForm();
      expect(screen.getByText("Loading this event's details…")).toBeInTheDocument();
      expect(await screen.findByRole('alert')).toHaveTextContent("This event's details could not be loaded. Try again.");
      expect(screen.getByRole('button', { name: 'Send change request' })).toBeDisabled();
    });

    test('TC-1851 a load that finishes after the form has gone is dropped', async () => {
      let finish;
      loadCurrentValues.mockReturnValue(new Promise((_resolve, reject) => { finish = reject; }));
      const { unmount } = render(<ChangeRequestForm userId="o1" events={[ASSIGNED]} initialEventId="e1" onSubmitted={jest.fn()} onCancel={jest.fn()} />);
      unmount();
      await act(async () => { finish(new Error('late')); });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('TC-1852 a late successful load for a form that has gone is dropped too', async () => {
      let finish;
      loadCurrentValues.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      const { unmount } = render(<ChangeRequestForm userId="o1" events={[ASSIGNED]} initialEventId="e1" onSubmitted={jest.fn()} onCancel={jest.fn()} />);
      unmount();
      await act(async () => { finish(CURRENT); });
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    test('TC-1853 a request that cannot be sent says so and can be tried again', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      submitChangeRequest.mockRejectedValue(new Error('permission-denied'));
      const { onSubmitted } = renderForm();
      await ready();
      await tick('Expected attendance');
      fireEvent.change(screen.getByRole('spinbutton', { name: 'New expected attendance' }), { target: { value: '150' } });
      reason('Bigger crowd.');
      await send();

      expect(await screen.findByRole('alert')).toHaveTextContent('Your change request could not be sent. Try again.');
      expect(screen.getByRole('button', { name: 'Send change request' })).toBeEnabled();
      expect(onSubmitted).not.toHaveBeenCalled();
      console.error.mockRestore();
    });
  });
});
