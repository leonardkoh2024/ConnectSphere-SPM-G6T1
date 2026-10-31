import { render, screen } from '@testing-library/react';
import DecisionSummary from './DecisionSummary';

// The detail is loaded by OrganiserEventDetail and handed in, so no API here.
test('TC-0302 shows the decision reason, timestamp and assigned coordinator to the organiser', () => {
  render(<DecisionSummary detail={{
    event: { id: 'e1', status: 'REJECTED', decision: 'REJECTED', decision_reason: 'No suitable venue.', decided_at: '2026-09-23T10:00:00Z', open_clarification_id: null },
    coordinator: { id: 'c1', name: 'Sam Coordinator' }, clarifications: [], responses: []
  }} />);
  expect(screen.getByText('Sam Coordinator')).toBeInTheDocument();
  expect(screen.getByText('REJECTED')).toBeInTheDocument();
  expect(screen.getByText('No suitable venue.')).toBeInTheDocument();
  expect(screen.getByText(/23 Sep(?:t)? 2026|Sep(?:t)? 23, 2026/)).toBeInTheDocument();
});

describe('C8 / B10 the decision summary', () => {
  const pending = { event: { id: 'e1', status: 'SUBMITTED' }, coordinator: null };

  describe('boundary', () => {
    test('TC-0417 C8 before any decision it shows the status, "Assignment pending", no time and no reason', () => {
      render(<DecisionSummary detail={pending} venues={[]} />);
      expect(screen.getByText('Assignment pending')).toBeInTheDocument();
      expect(screen.getByText('SUBMITTED')).toBeInTheDocument();
      expect(screen.getByText('Not recorded')).toBeInTheDocument();
      expect(screen.getByText('No decision reason recorded.')).toBeInTheDocument();
      expect(screen.getByText('To be confirmed')).toBeInTheDocument();
    });
  });

  describe('normal', () => {
    test('TC-0284 B10 the approved venues are listed once there are any', () => {
      render(<DecisionSummary detail={pending} venues={['Hall A', 'Room 2']} />);
      expect(screen.getByText('Hall A, Room 2')).toBeInTheDocument();
    });
  });

  describe('failure', () => {
    test('TC-0285 B10 venues still loading say so instead of "To be confirmed"', () => {
      render(<DecisionSummary detail={pending} />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(screen.queryByText('To be confirmed')).not.toBeInTheDocument();
    });

    test('TC-0286 B10 venues that failed to load say so instead of "To be confirmed"', () => {
      render(<DecisionSummary detail={pending} venues={null} />);
      expect(screen.getByText('Could not be loaded right now.')).toBeInTheDocument();
    });
  });
});
