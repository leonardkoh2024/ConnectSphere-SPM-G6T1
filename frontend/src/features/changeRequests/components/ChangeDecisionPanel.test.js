// I2 / SCRUM-148 — the panel a coordinator decides a change in.

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangeDecisionPanel from './ChangeDecisionPanel';

const REQUEST = {
  id: 'r1', event_name: 'Harbour Tech Forum', reason: 'More sign-ups.',
  changes: { expected_attendance: { old_value: 120, new_value: 150 } }
};
const REVIEW = { event: { id: 'e1', status: 'PLANNING' }, current: { expected_attendance: 120, name: 'Harbour Tech Forum' }, impact: {} };

const renderPanel = (props = {}) => {
  const handlers = { onAccept: jest.fn(), onDecline: jest.fn(), onClose: jest.fn() };
  render(<ChangeDecisionPanel request={REQUEST} review={REVIEW} busy={false} error="" {...handlers} {...props} />);
  return handlers;
};

describe('ChangeDecisionPanel', () => {
  describe('normal', () => {
    test('TC-1910 AC3 accepting sends the trimmed note; a change that reaches arrangements says what accepting does', async () => {
      const { onAccept } = renderPanel();
      expect(screen.getByText(/Accepting re-requests the affected venue bookings and equipment/)).toBeInTheDocument();
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Fine.  ' } });
      await userEvent.click(screen.getByRole('button', { name: 'Accept change' }));
      expect(onAccept).toHaveBeenCalledWith('Fine.');
    });

    test('TC-1911 AC1 a change that touches no arrangement says so instead of listing sections', () => {
      renderPanel({ request: { ...REQUEST, changes: { name: { old_value: 'Harbour Tech Forum', new_value: 'Harbour Forum' } } } });
      expect(screen.getByText(/change the event record only/)).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Arrangements affected' })).not.toBeInTheDocument();
      expect(screen.queryByText(/Accepting re-requests/)).not.toBeInTheDocument();
    });

    test('TC-1912 AC2 declining with a reason sends it trimmed; Close hands back', async () => {
      const { onDecline, onClose } = renderPanel();
      fireEvent.change(screen.getByRole('textbox'), { target: { value: ' Venue is full. ' } });
      await userEvent.click(screen.getByRole('button', { name: 'Decline change' }));
      expect(onDecline).toHaveBeenCalledWith('Venue is full.');
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('conflict', () => {
    test('TC-1913 AC1 a value that moved since the request was made is flagged with what it was', () => {
      renderPanel({ review: { ...REVIEW, current: { expected_attendance: 130 } } });
      const row = screen.getByRole('row', { name: /Expected attendance/ });
      expect(within(row).getByText('Changed since the request was made (was 120).')).toBeInTheDocument();
    });

    test('TC-1914 while a decision is being saved every button is disabled, and a saving error is shown', () => {
      renderPanel({ busy: true, error: 'The change could not be saved.' });
      ['Accept change', 'Decline change', 'Close'].forEach((name) => expect(screen.getByRole('button', { name })).toBeDisabled());
      expect(screen.getByRole('alert')).toHaveTextContent('The change could not be saved.');
    });
  });

  describe('failure', () => {
    test('TC-1915 a request with no changes and a field the form does not know still render, by field name', () => {
      const { unmount } = render(<ChangeDecisionPanel request={{ ...REQUEST, changes: undefined }} review={REVIEW} busy={false} error="" onAccept={jest.fn()} onDecline={jest.fn()} onClose={jest.fn()} />);
      expect(screen.queryAllByRole('row')).toHaveLength(1);
      unmount();
      renderPanel({ request: { ...REQUEST, changes: { legacy_field: { old_value: 'a', new_value: 'b' } } }, review: { ...REVIEW, current: { legacy_field: 'a' } } });
      expect(screen.getByRole('rowheader', { name: 'legacy_field' })).toBeInTheDocument();
    });
  });
});
