// D1 / SCRUM-111, D2 / SCRUM-112, I3 / SCRUM-149 — the coordinator's Edit event form,
// rendered on its own with the review adapter mocked. The screen-level journeys
// (open from the review screen, save, notice) are in EventReviewScreen.test.js;
// this file covers each field and each failure path of the form itself.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventDetailsEditor from './EventDetailsEditor';
import { reviewApi } from '../reviewApi';

jest.mock('../reviewApi', () => ({
  reviewApi: {
    registeredCount: jest.fn(),
    significantChangeImpact: jest.fn(),
    saveEventEdit: jest.fn(),
    retryRerequest: jest.fn()
  }
}));

const baseEvent = {
  id: 'e1', status: 'PLANNING', coordinator_id: 'c1',
  name: 'Partner Summit', purpose: 'Networking', description: 'Annual partner meet-up',
  expected_attendance: 50, event_date: '2026-12-01', start_time: '09:00', end_time: '12:00',
  preferred_location: '', required_layout: '', facilities: [], accessibility: [], accessibility_notes: ''
};
const impact = {
  venueBookings: [{ id: 'b1', label: 'Hall A', status: 'Approved' }],
  equipmentReservations: [{ id: 'r1', label: 'Projector × 2', status: 'Reserved' }],
  registrationsCount: 12
};

const renderEditor = (event = baseEvent, props = {}) => {
  const onSaved = jest.fn().mockResolvedValue(undefined);
  const onCancel = jest.fn();
  render(<EventDetailsEditor event={event} organiser={{ name: 'Nadia', email: 'nadia@example.com' }} onSaved={onSaved} onCancel={onCancel} {...props} />);
  return { onSaved, onCancel };
};
const saveButton = () => screen.getByRole('button', { name: /save changes/i });
const acknowledgeImpact = async () => userEvent.click(await screen.findByLabelText(/reviewed and acknowledge/i));

beforeEach(() => {
  reviewApi.registeredCount.mockResolvedValue(0);
  reviewApi.significantChangeImpact.mockResolvedValue(impact);
  reviewApi.saveEventEdit.mockResolvedValue({ ok: true });
  reviewApi.retryRerequest.mockResolvedValue({ ok: true });
});

describe('D1 / D2 / I3 the Edit event form', () => {
  describe('normal', () => {
    test("TC-0431 D1 AC1 an ordinary edit saves without looking up arrangements, and the contact defaults to the organiser's profile", async () => {
      const { onSaved } = renderEditor();
      expect(screen.getByLabelText(/contact name/i)).toHaveValue('Nadia');
      expect(saveButton()).toBeDisabled();

      userEvent.type(screen.getByLabelText(/internal notes/i), 'VIP list pending');
      userEvent.click(saveButton());

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(reviewApi.significantChangeImpact).not.toHaveBeenCalled();
      expect(reviewApi.saveEventEdit).toHaveBeenCalledWith(expect.objectContaining({
        eventId: 'e1', impact: null, acknowledged: false,
        values: expect.objectContaining({ internal_notes: 'VIP list pending', expected_attendance: 50 })
      }));
      // No capacity is sent: the form's blank field passes through as "", which
      // saveEventEdit (newCapacityOf) reads as "capacity unchanged".
      expect(reviewApi.saveEventEdit.mock.calls[0][0].values.registration_capacity ?? '').toBe('');
    });

    test('TC-0457 D2 AC1-AC3 changing the date, times, location and layout shows the affected arrangements and saves once acknowledged', async () => {
      const { onSaved } = renderEditor();
      userEvent.clear(screen.getByLabelText('Event date'));
      userEvent.type(screen.getByLabelText('Event date'), '2026-12-02');
      userEvent.clear(screen.getByLabelText('Start time'));
      userEvent.type(screen.getByLabelText('Start time'), '10:00');
      userEvent.clear(screen.getByLabelText('End time'));
      userEvent.type(screen.getByLabelText('End time'), '13:00');
      userEvent.selectOptions(screen.getByLabelText('Preferred location'), 'EAST');
      userEvent.selectOptions(screen.getByLabelText('Required layout'), 'THEATRE');

      const warning = await screen.findByRole('complementary', { name: 'Significant change impact' });
      expect(within(warning).getByText('Hall A — Approved')).toBeInTheDocument();
      expect(within(warning).getByText('Projector × 2 — Reserved')).toBeInTheDocument();
      expect(within(warning).getByText('Attendee registrations: 12')).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();

      await acknowledgeImpact();
      userEvent.click(saveButton());

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(reviewApi.saveEventEdit).toHaveBeenCalledWith(expect.objectContaining({
        impact, acknowledged: true,
        values: expect.objectContaining({ event_date: '2026-12-02', start_time: '10:00', end_time: '13:00', preferred_location: 'EAST', required_layout: 'THEATRE' })
      }));
      expect(reviewApi.significantChangeImpact).toHaveBeenCalledTimes(1);
    });

    test('TC-0458 D2 facilities and accessibility needs can be switched on, chosen, noted and saved', async () => {
      renderEditor();
      userEvent.click(screen.getByLabelText(/venue facilities are required/i));
      userEvent.click(screen.getByLabelText('WIFI'));
      userEvent.click(screen.getByLabelText(/accessibility requirements apply/i));
      userEvent.click(screen.getByLabelText('WHEELCHAIR ACCESS'));
      userEvent.type(screen.getByLabelText('Accessibility notes'), 'Two wheelchair users');
      await acknowledgeImpact();
      userEvent.click(saveButton());

      await waitFor(() => expect(reviewApi.saveEventEdit).toHaveBeenCalledWith(expect.objectContaining({
        values: expect.objectContaining({
          facilities_required: true, facilities: ['WIFI'],
          accessibility_needed: true, accessibility: ['WHEELCHAIR_ACCESS'], accessibility_notes: 'Two wheelchair users'
        })
      })));
    });

    test('TC-0432 D1 Cancel hands control back without saving', async () => {
      const { onCancel } = renderEditor();
      userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onCancel).toHaveBeenCalled();
      expect(reviewApi.saveEventEdit).not.toHaveBeenCalled();
    });
  });

  describe('boundary', () => {
    test('TC-0459 D2 an event with no bookings or reservations says "None" for each, and only a Confirmed event warns it moves back to Planning', async () => {
      reviewApi.significantChangeImpact.mockResolvedValue({ venueBookings: [], equipmentReservations: [], registrationsCount: 0 });
      renderEditor();
      userEvent.clear(screen.getByLabelText(/expected attendance/i));
      userEvent.type(screen.getByLabelText(/expected attendance/i), '80');

      const warning = await screen.findByRole('complementary', { name: 'Significant change impact' });
      expect(within(warning).getAllByText('None')).toHaveLength(2);
      expect(within(warning).queryByText(/moved back to planning/i)).not.toBeInTheDocument();
    });

    test('TC-0460 D2 switching facilities and accessibility off clears their choices, and undoing a change removes the warning without a second lookup', async () => {
      renderEditor({ ...baseEvent, facilities: ['WIFI'], accessibility: ['LIFT'], accessibility_notes: 'Lift to level 2' });
      expect(screen.getByLabelText('WIFI')).toBeChecked();

      userEvent.click(screen.getByLabelText(/venue facilities are required/i));
      userEvent.click(screen.getByLabelText(/accessibility requirements apply/i));
      expect(screen.queryByLabelText('WIFI')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Accessibility notes')).not.toBeInTheDocument();
      await screen.findByRole('complementary', { name: 'Significant change impact' });

      userEvent.click(screen.getByLabelText(/venue facilities are required/i));
      userEvent.click(screen.getByLabelText(/accessibility requirements apply/i));
      // Turning a group back on starts it empty: the earlier choices were cleared.
      expect(screen.getByLabelText('WIFI')).not.toBeChecked();
      expect(screen.getByLabelText('Accessibility notes')).toHaveValue('');

      userEvent.click(screen.getByLabelText('WIFI'));
      userEvent.click(screen.getByLabelText('LIFT'));
      userEvent.type(screen.getByLabelText('Accessibility notes'), 'Lift to level 2');
      expect(screen.queryByRole('complementary', { name: 'Significant change impact' })).not.toBeInTheDocument();

      userEvent.click(screen.getByLabelText('WIFI'));
      await screen.findByRole('complementary', { name: 'Significant change impact' });
      expect(reviewApi.significantChangeImpact).toHaveBeenCalledTimes(1);
    });

    test('TC-2020 I3 AC4 a capacity of zero is refused, an emptied field changes nothing, and a capacity-only save sends the capacity', async () => {
      reviewApi.registeredCount.mockResolvedValue(1);
      renderEditor({ ...baseEvent, registration_required: true, registration_capacity: 5 });
      const field = await screen.findByLabelText(/registration capacity/i);
      await waitFor(() => expect(reviewApi.registeredCount).toHaveBeenCalledWith('e1'));
      userEvent.clear(field);
      userEvent.type(field, '0');
      expect(screen.getByRole('alert')).toHaveTextContent('Registration capacity must be a whole number greater than zero.');

      userEvent.clear(field);
      expect(saveButton()).toBeDisabled();
      userEvent.type(field, '3');
      expect(saveButton()).toBeEnabled();
      userEvent.click(saveButton());
      await waitFor(() => expect(reviewApi.saveEventEdit).toHaveBeenCalledWith(expect.objectContaining({
        values: expect.objectContaining({ registration_capacity: 3 }), capacityAcknowledged: false
      })));
    });

    test('TC-2021 I3 AC4 the smallest allowed capacity, 1, below two registered people needs the acknowledgement', async () => {
      reviewApi.registeredCount.mockResolvedValue(2);
      renderEditor({ ...baseEvent, registration_required: true, registration_capacity: 5 });
      const field = await screen.findByLabelText(/registration capacity/i);
      await waitFor(() => expect(reviewApi.registeredCount).toHaveBeenCalled());
      userEvent.clear(field);
      userEvent.type(field, '1');
      expect(await screen.findByText(/below the 2 people already registered/i)).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    test('TC-2022 I3 AC4 an event that takes registration but has no capacity yet starts with an empty field', async () => {
      renderEditor({ ...baseEvent, registration_required: true, registration_capacity: null });
      expect(await screen.findByLabelText(/registration capacity/i)).toHaveValue(null);
      await waitFor(() => expect(reviewApi.registeredCount).toHaveBeenCalled());
    });
  });

  describe('conflict', () => {
    test('TC-0461 D2 while a clarification is open the significant fields are locked and say why', () => {
      renderEditor(baseEvent, { significantLocked: true });
      expect(screen.getByText('Unavailable while a clarification is open.')).toBeInTheDocument();
      expect(screen.getByLabelText(/expected attendance/i)).toBeDisabled();
      expect(screen.getByLabelText('Event date')).toBeDisabled();
    });

    test('TC-0462 D2 when the arrangements changed during editing the warning is refreshed and must be acknowledged again', async () => {
      reviewApi.saveEventEdit.mockRejectedValue(new Error('The existing arrangements changed after the warning was shown.'));
      const { onSaved } = renderEditor();
      userEvent.clear(screen.getByLabelText(/expected attendance/i));
      userEvent.type(screen.getByLabelText(/expected attendance/i), '80');
      await acknowledgeImpact();
      reviewApi.significantChangeImpact.mockResolvedValue({ ...impact, venueBookings: [...impact.venueBookings, { id: 'b2', label: 'Room 2', status: 'Pending' }] });
      userEvent.click(saveButton());

      expect(await screen.findByText(/arrangements changed during editing/i)).toBeInTheDocument();
      expect(screen.getByText('Room 2 — Pending')).toBeInTheDocument();
      expect(screen.getByLabelText(/reviewed and acknowledge/i)).not.toBeChecked();
      expect(saveButton()).toBeDisabled();
      expect(onSaved).not.toHaveBeenCalled();
    });

    test('TC-0463 D2 editing a significant field again after acknowledging takes the acknowledgement away', async () => {
      renderEditor();
      userEvent.clear(screen.getByLabelText(/expected attendance/i));
      userEvent.type(screen.getByLabelText(/expected attendance/i), '80');
      await acknowledgeImpact();
      expect(saveButton()).toBeEnabled();
      userEvent.type(screen.getByLabelText(/expected attendance/i), '0');
      expect(screen.getByLabelText(/reviewed and acknowledge/i)).not.toBeChecked();
      expect(saveButton()).toBeDisabled();
    });
  });

  describe('failure', () => {
    test('TC-0433 D1 a blank required field is reported and Save stays off', async () => {
      renderEditor();
      userEvent.clear(screen.getByLabelText(/event name/i));
      expect(screen.getByRole('alert')).toHaveTextContent('Event name is required.');
      expect(saveButton()).toBeDisabled();
    });

    test('TC-0464 D2 an end time before the start time is reported', async () => {
      renderEditor();
      userEvent.clear(screen.getByLabelText('End time'));
      userEvent.type(screen.getByLabelText('End time'), '08:00');
      expect(await screen.findByText('End time must be later than start time.')).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    test('TC-0465 D2 arrangements that cannot be looked up are reported and Save stays off', async () => {
      reviewApi.significantChangeImpact.mockRejectedValue(new Error('Bookings could not be loaded.'));
      renderEditor();
      userEvent.clear(screen.getByLabelText(/expected attendance/i));
      userEvent.type(screen.getByLabelText(/expected attendance/i), '80');

      expect(await screen.findByText('Bookings could not be loaded.')).toBeInTheDocument();
      expect(screen.queryByText('Checking existing arrangements…')).not.toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    test('TC-0466 D2 a refused save shows its message and the form stays open', async () => {
      reviewApi.saveEventEdit.mockRejectedValue(new Error('This event can no longer be edited.'));
      const { onSaved } = renderEditor();
      userEvent.type(screen.getByLabelText(/internal notes/i), 'x');
      userEvent.click(saveButton());
      expect(await screen.findByText('This event can no longer be edited.')).toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
      expect(saveButton()).toHaveTextContent('Save changes');
    });

    test('TC-0467 D2 if the refreshed warning cannot be loaded either, that failure is shown', async () => {
      reviewApi.saveEventEdit.mockRejectedValue(new Error('The existing arrangements changed after the warning was shown.'));
      renderEditor();
      userEvent.clear(screen.getByLabelText(/expected attendance/i));
      userEvent.type(screen.getByLabelText(/expected attendance/i), '80');
      await acknowledgeImpact();
      reviewApi.significantChangeImpact.mockRejectedValue(new Error('Bookings could not be loaded.'));
      userEvent.click(saveButton());
      expect(await screen.findByText('Bookings could not be loaded.')).toBeInTheDocument();
    });

    test('TC-2023 I3 AC4 a registered count that cannot be read is treated as zero, so lowering the capacity needs no acknowledgement', async () => {
      reviewApi.registeredCount.mockRejectedValue(new Error('denied'));
      renderEditor({ ...baseEvent, registration_required: true, registration_capacity: 100 });
      const field = await screen.findByLabelText(/registration capacity/i);
      await waitFor(() => expect(reviewApi.registeredCount).toHaveBeenCalled());
      userEvent.clear(field);
      userEvent.type(field, '10');
      expect(screen.queryByText(/already registered/i)).not.toBeInTheDocument();
      expect(saveButton()).toBeEnabled();
    });

    test('TC-2024 I3 lookups that finish after the form has closed change nothing', async () => {
      let finishCount;
      let failImpact;
      reviewApi.registeredCount.mockReturnValue(new Promise((resolve) => { finishCount = resolve; }));
      reviewApi.significantChangeImpact.mockReturnValue(new Promise((resolve, reject) => { failImpact = reject; }));
      const view = render(<EventDetailsEditor event={{ ...baseEvent, registration_required: true, registration_capacity: 10 }} organiser={null} onSaved={jest.fn()} onCancel={jest.fn()} />);
      userEvent.clear(screen.getByLabelText(/expected attendance/i));
      userEvent.type(screen.getByLabelText(/expected attendance/i), '80');
      view.unmount();
      await act(async () => { finishCount(4); failImpact(new Error('late')); });
      expect(screen.queryByText('late')).not.toBeInTheDocument();
    });

    test('TC-2025 I3 a late registered-count failure after closing changes nothing', async () => {
      let failCount;
      let finishImpact;
      reviewApi.registeredCount.mockReturnValue(new Promise((resolve, reject) => { failCount = reject; }));
      reviewApi.significantChangeImpact.mockReturnValue(new Promise((resolve) => { finishImpact = resolve; }));
      const view = render(<EventDetailsEditor event={{ ...baseEvent, registration_required: true, registration_capacity: 10 }} organiser={null} onSaved={jest.fn()} onCancel={jest.fn()} />);
      userEvent.clear(screen.getByLabelText(/expected attendance/i));
      userEvent.type(screen.getByLabelText(/expected attendance/i), '80');
      view.unmount();
      await act(async () => { failCount(new Error('late')); finishImpact(impact); });
      expect(reviewApi.saveEventEdit).not.toHaveBeenCalled();
    });

    test('TC-2026 I3 AC1 a save that returns no result still counts as saved', async () => {
      reviewApi.saveEventEdit.mockResolvedValue(undefined);
      const { onSaved } = renderEditor();
      userEvent.type(screen.getByLabelText(/internal notes/i), 'x');
      userEvent.click(saveButton());
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
    });
  });

  describe('re-request and capacity acknowledgement', () => {
    test('TC-2027 [failure] I3 AC1 a saved change whose re-request failed says so, blocks Save, and Retry tries again until it goes through', async () => {
      reviewApi.saveEventEdit.mockResolvedValue({ ok: true, rerequest: { sent: false, changeId: 'ch1', error: 'Service down.' } });
      reviewApi.retryRerequest.mockRejectedValueOnce(new Error('Still down.'));
      const { onSaved } = renderEditor({ ...baseEvent, status: 'CONFIRMED' });
      userEvent.clear(screen.getByLabelText(/expected attendance/i));
      userEvent.type(screen.getByLabelText(/expected attendance/i), '80');
      expect(await screen.findByText('This event is Confirmed and will be moved back to Planning.')).toBeInTheDocument();
      await acknowledgeImpact();
      userEvent.click(saveButton());

      expect(await screen.findByText(/could not be marked for re-request\. Service down\./)).toBeInTheDocument();
      expect(reviewApi.saveEventEdit).toHaveBeenCalledWith(expect.objectContaining({ acknowledged: true, impact }));
      expect(onSaved).not.toHaveBeenCalled();
      expect(saveButton()).toBeDisabled();

      userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText(/re-request\. Still down\./)).toBeInTheDocument();
      expect(reviewApi.retryRerequest).toHaveBeenCalledWith({ eventId: 'e1', changeId: 'ch1' });

      userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });

    test('TC-2028 [normal] I3 AC4 acknowledging a capacity below the registered count enables Save and sends the acknowledgement', async () => {
      reviewApi.registeredCount.mockResolvedValue(3);
      const { onSaved } = renderEditor({ ...baseEvent, registration_required: true, registration_capacity: 5 });
      const field = await screen.findByLabelText(/registration capacity/i);
      await waitFor(() => expect(reviewApi.registeredCount).toHaveBeenCalled());
      userEvent.clear(field);
      userEvent.type(field, '2');
      userEvent.click(await screen.findByLabelText(/nobody will be unregistered/i));
      expect(saveButton()).toBeEnabled();
      userEvent.click(saveButton());

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(reviewApi.saveEventEdit).toHaveBeenCalledWith(expect.objectContaining({
        values: expect.objectContaining({ registration_capacity: 2 }), registeredCount: 3, capacityAcknowledged: true
      }));
    });
  });
});
