// D1 AC2 — the Activity tab: every recorded change, newest first, with who made
// it, when, and each field's old and new value.
import { render, screen, within } from '@testing-library/react';
import ActivityLog from './ActivityLog';

describe('D1 SCRUM-111 the Activity tab', () => {
  describe('normal', () => {
    test("TC-0427 D1 AC2 entries are newest first, with actor, time and each field's old and new value", () => {
      render(<ActivityLog actorNames={{ c1: 'Joshua Chua' }} history={[
        { id: 'h1', action_type: 'EVENT_EDITED', actor_id: 'c1', created_at: '2026-09-20T02:00:00Z', field_name: 'name', old_value: 'Old', new_value: 'New' },
        { id: 'h2', action_type: 'EVENT_EDITED', actor_id: 'c1', created_at: '2026-09-21T02:00:00Z', old_value: { pax: 50 }, new_value: { pax: 80 } }
      ]} />);

      const entries = within(screen.getByRole('region', { name: 'Event activity' })).getAllByRole('article');
      expect(entries).toHaveLength(2);
      expect(entries[0]).toHaveTextContent('50');
      expect(entries[0]).toHaveTextContent('80');
      expect(entries[1]).toHaveTextContent('Old');
      expect(entries[1]).toHaveTextContent('New');
      expect(entries[0]).toHaveTextContent('by Joshua Chua');
      expect(entries[0].querySelector('time')).toHaveAttribute('datetime', '2026-09-21T02:00:00Z');
    });

    test('TC-0428 D1 AC2 a description is shown, and a reason only when it says something different', () => {
      render(<ActivityLog history={[
        { id: 'h1', action_type: 'REJECTED', actor_role: 'Event Coordinator', created_at: '2026-09-20T02:00:00Z', description: 'Rejected the request', reason: 'No suitable venue.' },
        { id: 'h2', action_type: 'APPROVED', actor_role: 'Event Coordinator', created_at: '2026-09-19T02:00:00Z', description: 'Same text', reason: 'Same text' }
      ]} />);

      expect(screen.getByText('Rejected the request')).toBeInTheDocument();
      expect(screen.getByText('No suitable venue.')).toBeInTheDocument();
      expect(screen.getAllByText('Same text')).toHaveLength(1);
    });
  });

  describe('boundary', () => {
    test('TC-0429 D1 AC2 no history at all says so instead of an empty list', () => {
      render(<ActivityLog />);
      expect(screen.getByText('No activity has been recorded for this event yet.')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Event activity' })).not.toBeInTheDocument();
    });

    test('TC-0430 D1 AC2 an entry without a time reads "Not recorded" and has no change list when nothing changed', () => {
      render(<ActivityLog history={[{ id: 'h1', action_type: 'SUBMITTED' }]} />);
      const entry = screen.getByRole('article');
      expect(entry).toHaveTextContent('Not recorded');
      expect(entry.querySelector('time')).not.toHaveAttribute('datetime');
      expect(entry.querySelector('dl')).toBeNull();
    });
  });
});
