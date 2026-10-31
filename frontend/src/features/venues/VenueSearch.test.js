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

test('TC-2105 search opened from an event arrives pre-filled', async () => {
  render(<VenueSearch event={{ name: 'Summit', event_date: '2026-10-23', start_time: '09:00', end_time: '17:00', expected_attendance: 180 }} />);
  expect(await screen.findByText(/pre-filled from the event/i)).toBeInTheDocument();
  expect(screen.getByText(/2026-10-23/)).toBeInTheDocument();
  expect(screen.getByText(/09:00–17:00/)).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /view venue/i })).toBeInTheDocument();
  expect([...document.querySelectorAll('.cs-record-title h2')].map((heading) => heading.textContent)).toEqual(['Clear Hall']);
});

test('TC-2106 one action clears the active filters', async () => {
  render(<VenueSearch />);
  await screen.findAllByRole('button', { name: /view venue/i });
  await userEvent.selectOptions(screen.getByLabelText(/^location$/i), 'EAST');
  expect(document.querySelector('.cs-chip')).toHaveTextContent('EAST');
  await userEvent.click(screen.getByRole('button', { name: /clear filters/i }));
  expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
});

test('TC-2107 the requirements section can close and reopen without losing its filters', async () => {
  render(<VenueSearch />);
  await screen.findAllByRole('button', { name: /view venue/i });
  await userEvent.selectOptions(screen.getByLabelText(/^location$/i), 'EAST');

  const close = screen.getByRole('button', { name: /close requirements/i });
  expect(close).toHaveAttribute('aria-expanded', 'true');
  await userEvent.click(close);
  expect(screen.queryByLabelText(/^location$/i)).not.toBeInTheDocument();

  const open = screen.getByRole('button', { name: /open requirements/i });
  expect(open).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(open);
  expect(screen.getByLabelText(/^location$/i)).toHaveValue('EAST');
});

// E4 / SCRUM-120 — the coordinator's catalogue opens the calendar too, and
// keeps its filters when the coordinator comes back.
test('TC-0681 the coordinator returns from the shared calendar to the same filters', async () => {
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

test('TC-2108 viewing a venue displays its details in that venue result', async () => {
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

test('TC-2109 an open venue can be closed to minimise its details', async () => {
  render(<VenueSearch />);
  const [viewButton] = await screen.findAllByRole('button', { name: /view venue/i });
  const venue = viewButton.closest('.cs-record');

  await userEvent.click(viewButton);
  expect(within(venue).getByLabelText(/venue record/i)).toBeInTheDocument();
  await userEvent.click(within(venue).getByRole('button', { name: /^close$/i }));

  expect(within(venue).queryByLabelText(/venue record/i)).not.toBeInTheDocument();
  expect(within(venue).getByRole('button', { name: /view venue/i })).toHaveAttribute('aria-pressed', 'false');
});

test('TC-2110 long venue list values use bounded text containers while retaining their full text', async () => {
  const longName = 'International Convention and Multidisciplinary Collaboration Auditorium';
  getDocs.mockReset();
  getDocs
    .mockResolvedValueOnce(snap([{ id: 'VEN-LONG', venue_id: 'VEN-LONG', name: longName, location: 'NORTH_EAST', max_capacity: 500 }]))
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(snap([
      { id: 'f1', venue_id: 'VEN-LONG', facility_id: 'AIR_CONDITIONING' },
      { id: 'f2', venue_id: 'VEN-LONG', facility_id: 'TABLES_AND_CHAIRS' },
      { id: 'f3', venue_id: 'VEN-LONG', facility_id: 'REGISTRATION_AREA' },
      { id: 'f4', venue_id: 'VEN-LONG', facility_id: 'KITCHEN_PANTRY' }
    ]))
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty);

  render(<VenueSearch />);
  const heading = await screen.findByRole('heading', { name: longName });
  const row = heading.closest('.cs-record');
  const facilities = row.querySelector('.cs-venue-record-facilities');

  expect(row).toHaveClass('cs-venue-record');
  expect(heading).toHaveAttribute('title', longName);
  expect(facilities).toHaveAttribute('title', expect.stringContaining('AIR CONDITIONING'));
  expect(facilities).toHaveTextContent(/KITCHEN PANTRY/i);
});

// E7 as a filter — a blank requirement is no constraint, not a failure, and a
// venue that states no operating hours is open at all hours rather than closed.
test('TC-2111 a stated window alone rules nothing out', async () => {
  render(<VenueSearch />);
  await screen.findAllByRole('button', { name: /view venue/i });

  await userEvent.type(screen.getByLabelText('Event date'), '2026-10-23');
  await userEvent.type(screen.getByLabelText('Start time'), '09:00');
  await userEvent.type(screen.getByLabelText('End time'), '17:00');

  // No minimum capacity given, and neither venue states operating hours.
  expect([...document.querySelectorAll('.cs-record-title h2')].map((h) => h.textContent))
    .toEqual(['Clear Hall', 'Tiny Room']);
});

test('TC-2112 a stated minimum capacity does rule a venue out, with the reason', async () => {
  render(<VenueSearch />);
  await screen.findAllByRole('button', { name: /view venue/i });

  await userEvent.type(screen.getByLabelText('Event date'), '2026-10-23');
  await userEvent.type(screen.getByLabelText('Start time'), '09:00');
  await userEvent.type(screen.getByLabelText('End time'), '17:00');
  await userEvent.type(screen.getByLabelText(/minimum capacity/i), '150');

  expect([...document.querySelectorAll('.cs-record-title h2')].map((h) => h.textContent))
    .toEqual(['Clear Hall']);
});

// "Stated but not covering that day" is not the same as "not stated at all":
// a venue that lists hours and is shut on the requested weekday is unavailable.
test('TC-2113 a venue open other days but not that one is filtered out, with the reason', async () => {
  getDocs.mockReset();
  getDocs
    .mockResolvedValueOnce(snap([
      { id: 'VEN-WEEKDAY', venue_id: 'VEN-WEEKDAY', name: 'Weekday Hall', location: 'CENTRAL', max_capacity: 200 },
      { id: 'VEN-SILENT', venue_id: 'VEN-SILENT', name: 'Silent Hall', location: 'CENTRAL', max_capacity: 200 }
    ]))
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty)
    // Weekday Hall opens Mondays only; Silent Hall states no hours at all.
    .mockResolvedValueOnce(snap([
      { id: 'h1', venue_id: 'VEN-WEEKDAY', weekday: 'MONDAY', opens_at: '09:00', closes_at: '18:00' }
    ]))
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty);

  render(<VenueSearch />);
  await screen.findAllByRole('button', { name: /view venue/i });

  // 2026-10-23 is a Friday.
  await userEvent.type(screen.getByLabelText('Event date'), '2026-10-23');
  await userEvent.type(screen.getByLabelText('Start time'), '09:00');
  await userEvent.type(screen.getByLabelText('End time'), '17:00');

  expect([...document.querySelectorAll('.cs-record-title h2')].map((h) => h.textContent))
    .toEqual(['Silent Hall']);
});

// A date on its own filters: the venue has to open that day. The times, when
// given, narrow it to a window inside those hours.
test('TC-2114 a date alone filters on the opening day, before any times are given', async () => {
  getDocs.mockReset();
  getDocs
    .mockResolvedValueOnce(snap([
      { id: 'VEN-FRI', venue_id: 'VEN-FRI', name: 'Friday Hall', location: 'CENTRAL', max_capacity: 200 },
      { id: 'VEN-MON', venue_id: 'VEN-MON', name: 'Monday Hall', location: 'CENTRAL', max_capacity: 200 }
    ]))
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(snap([
      { id: 'h1', venue_id: 'VEN-FRI', weekday: 'FRIDAY', opens_at: '10:00', closes_at: '20:00' },
      { id: 'h2', venue_id: 'VEN-MON', weekday: 'MONDAY', opens_at: '10:00', closes_at: '20:00' }
    ]))
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty);

  render(<VenueSearch />);
  await screen.findAllByRole('button', { name: /view venue/i });

  // 2026-10-23 is a Friday; no times given yet.
  await userEvent.type(screen.getByLabelText('Event date'), '2026-10-23');

  expect([...document.querySelectorAll('.cs-record-title h2')].map((h) => h.textContent))
    .toEqual(['Friday Hall']);
});

test('TC-2115 adding times narrows it to a window inside the opening hours', async () => {
  getDocs.mockReset();
  getDocs
    .mockResolvedValueOnce(snap([
      { id: 'VEN-FRI', venue_id: 'VEN-FRI', name: 'Friday Hall', location: 'CENTRAL', max_capacity: 200 }
    ]))
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(snap([
      { id: 'h1', venue_id: 'VEN-FRI', weekday: 'FRIDAY', opens_at: '10:00', closes_at: '20:00' }
    ]))
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(empty);

  render(<VenueSearch />);
  await screen.findAllByRole('button', { name: /view venue/i });

  await userEvent.type(screen.getByLabelText('Event date'), '2026-10-23');
  expect(document.querySelectorAll('.cs-record-title h2')).toHaveLength(1);

  // 09:00 is before the venue opens, so the window no longer fits.
  await userEvent.type(screen.getByLabelText('Start time'), '09:00');
  await userEvent.type(screen.getByLabelText('End time'), '17:00');
  expect(document.querySelectorAll('.cs-record-title h2')).toHaveLength(0);
});

// The window narrows the list as much as any filter does, so one action clears it.
test('TC-2116 clear filters also clears the date and time window', async () => {
  render(<VenueSearch />);
  await screen.findAllByRole('button', { name: /view venue/i });

  await userEvent.type(screen.getByLabelText('Event date'), '2026-10-23');
  await userEvent.type(screen.getByLabelText('Start time'), '09:00');
  await userEvent.selectOptions(screen.getByLabelText(/^location$/i), 'EAST');

  await userEvent.click(screen.getByRole('button', { name: /clear filters/i }));

  expect(screen.getByLabelText('Event date')).toHaveValue('');
  expect(screen.getByLabelText('Start time')).toHaveValue('');
  expect(screen.getByLabelText(/^location$/i)).toHaveValue('');
  expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
});
