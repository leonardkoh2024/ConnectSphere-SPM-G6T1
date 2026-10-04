import { render, screen, within } from '@testing-library/react';
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
  expect(await screen.findByRole('button', { name: /view venue/i })).toBeInTheDocument();
  expect([...document.querySelectorAll('.cs-record-title h2')].map((heading) => heading.textContent)).toEqual(['Clear Hall']);
});

test('TC-109 one action clears the active filters', async () => {
  render(<VenueSearch />);
  await screen.findAllByRole('button', { name: /view venue/i });
  await userEvent.selectOptions(screen.getByLabelText(/^location$/i), 'EAST');
  expect(document.querySelector('.cs-chip')).toHaveTextContent('EAST');
  await userEvent.click(screen.getByRole('button', { name: /clear filters/i }));
  expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
});

// E4 / SCRUM-120 — the coordinator's catalogue opens the calendar too, and
// keeps its filters when the coordinator comes back.
test('TC-230 the coordinator returns from the shared calendar to the same filters', async () => {
  const { rerender } = render(<VenueSearch role="EVENT_COORDINATOR" />);
  await screen.findAllByRole('button', { name: /view venue/i });
  expect(screen.queryByRole('button', { name: /view calendar/i })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText(/^location$/i), 'CENTRAL');

  rerender(<VenueSearch role="EVENT_COORDINATOR" showCalendar onCloseCalendar={() => {}} />);
  expect(screen.getByRole('region', { name: /availability calendar/i })).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^venues/i })).toHaveTextContent('All venues');

  rerender(<VenueSearch role="EVENT_COORDINATOR" />);
  expect(screen.getByLabelText(/^location$/i)).toHaveValue('CENTRAL');
  expect(screen.getAllByText('Clear Hall').length).toBeGreaterThan(0);
});

test('TC-110 viewing a venue displays its details in that venue result', async () => {
  render(<VenueSearch />);
  const [viewButton] = await screen.findAllByRole('button', { name: /view venue/i });

  const venue = viewButton.closest('.cs-record');
  await userEvent.click(viewButton);

  const details = within(venue).getByLabelText(/venue record/i);
  expect(details).toBeInTheDocument();
  expect(within(details).getByText(/THEATRE/i)).toBeInTheDocument();
  expect(screen.getAllByLabelText(/venue record/i)).toHaveLength(1);
  expect(details.closest('.cs-record')).toBe(venue);
});
