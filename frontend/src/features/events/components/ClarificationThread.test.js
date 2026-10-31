// C4 AC3 / C5 — the clarification exchange on an event's Clarifications tab, oldest first.
import { render, screen } from '@testing-library/react';
import ClarificationThread from './ClarificationThread';

describe('C4 / C5 SCRUM-106 the clarification exchange', () => {
  describe('normal', () => {
    test('TC-0364 C4 AC3 questions and answers interleave oldest first, each credited to its side', () => {
      render(<ClarificationThread
        clarifications={[{ id: 'q1', message: 'How many wheelchair users?', created_at: '2026-09-20T01:00:00Z' }]}
        responses={[{ id: 'r1', message: 'Three.', created_at: '2026-09-21T01:00:00Z' }]}
      />);

      const items = screen.getAllByRole('article');
      expect(items[0]).toHaveTextContent('Coordinator');
      expect(items[0]).toHaveTextContent('How many wheelchair users?');
      expect(items[1]).toHaveTextContent('Organiser');
      expect(items[1]).toHaveTextContent('Three.');
    });
  });

  describe('boundary', () => {
    test('TC-0365 C4 an event with no clarification says so', () => {
      render(<ClarificationThread />);
      expect(screen.getByText('No clarification has been requested for this event.')).toBeInTheDocument();
    });

    test('TC-0366 C4 a question with no recorded time reads "Not recorded"', () => {
      render(<ClarificationThread clarifications={[{ id: 'q1', message: 'Which room layout?' }]} />);
      expect(screen.getByRole('article')).toHaveTextContent('Not recorded');
    });
  });
});
