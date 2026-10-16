// A7 / SCRUM-170 AC3 — the coordinator records where equipment goes and how the
// crowd moves, for the Safety Officer to read. TC-368, TC-369 in docs/test-cases.md.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SafetyPlanningNotes from './SafetyPlanningNotes';
import { savePlanningNotes } from './safetyApi';

jest.mock('./safetyApi', () => ({ savePlanningNotes: jest.fn() }));

const EVENT = { id: 'e1', status: 'PLANNING', editable: true, equipment_placement: 'Speakers by the stage', crowd_movement: '' };

beforeEach(() => savePlanningNotes.mockReset().mockResolvedValue({ ok: true }));

test('TC-368 the current coordinator edits both notes in Approved or Planning and saves them', async () => {
  const onSaved = jest.fn();
  render(<SafetyPlanningNotes event={EVENT} onSaved={onSaved} />);
  const notes = screen.getByRole('region', { name: 'Safety planning notes' });
  const placement = within(notes).getByLabelText('Equipment placement');
  const crowd = within(notes).getByLabelText('Crowd movement');
  expect(placement).toHaveValue('Speakers by the stage');
  expect(crowd).toHaveValue('');

  await userEvent.type(crowd, 'Enter by door A, leave by door B');
  await userEvent.click(within(notes).getByRole('button', { name: 'Save safety notes' }));
  expect(savePlanningNotes).toHaveBeenCalledWith({
    eventId: 'e1',
    values: { equipment_placement: 'Speakers by the stage', crowd_movement: 'Enter by door A, leave by door B' }
  });
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
});

test('TC-368 a refused save is shown and the typed notes are kept', async () => {
  savePlanningNotes.mockRejectedValueOnce(new Error('There are no changes to save.'));
  const onSaved = jest.fn();
  render(<SafetyPlanningNotes event={{ ...EVENT, status: 'APPROVED' }} onSaved={onSaved} />);
  await userEvent.click(screen.getByRole('button', { name: 'Save safety notes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('There are no changes to save.');
  expect(screen.getByLabelText('Equipment placement')).toHaveValue('Speakers by the stage');
  expect(onSaved).not.toHaveBeenCalled();
});

test.each([
  ['a previous coordinator', { editable: false }],
  ['an event in Safety Review', { status: 'SAFETY_REVIEW' }],
  ['a Confirmed event', { status: 'CONFIRMED' }],
  ['an event still Under Review', { status: 'UNDER_REVIEW' }]
])('TC-369 for %s the notes are read only', (_name, changes) => {
  render(<SafetyPlanningNotes event={{ ...EVENT, ...changes }} />);
  const notes = screen.getByRole('region', { name: 'Safety planning notes' });
  expect(within(notes).queryByRole('textbox')).not.toBeInTheDocument();
  expect(within(notes).queryByRole('button')).not.toBeInTheDocument();
  expect(notes).toHaveTextContent('Equipment placementSpeakers by the stage');
  expect(notes).toHaveTextContent('Crowd movementNot recorded');
});
