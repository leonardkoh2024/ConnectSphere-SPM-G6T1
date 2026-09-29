import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDocs } from 'firebase/firestore';
import VenueSearch from './VenueSearch';

jest.mock('../../lib/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db, name) => name),
  getDocs: jest.fn()
}));

const snap = (rows) => ({ docs: rows.map((row) => ({ id: row.id, data: () => row })) });
const empty = snap([]);

beforeEach(() => {
  getDocs.mockReset();
  getDocs
    .mockResolvedValueOnce(snap([
      { id: 'VEN-OK', venue_id: 'VEN-OK', name: 'Clear Hall', location: 'CENTRAL', max_capacity: 200 },
      { id: 'VEN-SMALL', venue_id: 'VEN-SMALL', name: 'Tiny Room', location: 'EAST', max_capacity: 10 }
    ]))
    .mockResolvedValueOnce(snap([{ id: 'l1', venue_id: 'VEN-OK', layout_id: 'THEATRE' }]))
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty);
});

test('TC-095 search opened from an event arrives pre-filled', async () => {
  render(<VenueSearch event={{ name: 'Summit', event_date: '2026-10-23', start_time: '09:00', end_time: '17:00', expected_attendance: 180 }} />);
  expect(await screen.findByText(/pre-filled from the event/i)).toBeInTheDocument();
  expect(screen.getByText(/2026-10-23/)).toBeInTheDocument();
  expect(screen.getByText(/09:00–17:00/)).toBeInTheDocument();
  expect(await screen.findByText('Clear Hall')).toBeInTheDocument();
  expect(screen.queryByText('Tiny Room')).not.toBeInTheDocument();
});

test('TC-109 one action clears the active filters', async () => {
  render(<VenueSearch />);
  await screen.findByText('Clear Hall');
  await userEvent.selectOptions(screen.getByLabelText(/^location$/i), 'EAST');
  expect(document.querySelector('.cs-chip')).toHaveTextContent('EAST');
  await userEvent.click(screen.getByRole('button', { name: /clear filters/i }));
  expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
});
