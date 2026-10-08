import { render, screen } from '@testing-library/react';
import DecisionSummary from './DecisionSummary';

// The detail is loaded by OrganiserEventDetail and handed in, so no API here.
test('TC-076 shows the decision reason, timestamp and assigned coordinator to the organiser', () => {
  render(<DecisionSummary detail={{
    event: { id: 'e1', status: 'REJECTED', decision: 'REJECTED', decision_reason: 'No suitable venue.', decided_at: '2026-09-23T10:00:00Z', open_clarification_id: null },
    coordinator: { id: 'c1', name: 'Sam Coordinator' }, clarifications: [], responses: []
  }} />);
  expect(screen.getByText('Sam Coordinator')).toBeInTheDocument();
  expect(screen.getByText('REJECTED')).toBeInTheDocument();
  expect(screen.getByText('No suitable venue.')).toBeInTheDocument();
  expect(screen.getByText(/23 Sep(?:t)? 2026|Sep(?:t)? 23, 2026/)).toBeInTheDocument();
});
