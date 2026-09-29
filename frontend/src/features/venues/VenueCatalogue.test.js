import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDocs } from 'firebase/firestore';
import VenueCatalogue from './VenueCatalogue';

jest.mock('../../lib/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db, name) => name),
  getDocs: jest.fn()
}));

const snap = (rows) => ({
  docs: rows.map((row) => ({ id: row.id, data: () => row }))
});

beforeEach(() => {
  getDocs.mockResolvedValue(snap([]));
  getDocs
    .mockResolvedValueOnce(snap([
      { id: 'VEN-001', venue_id: 'VEN-001', name: 'Hall A', location: 'CENTRAL', max_capacity: 500 },
      { id: 'VEN-004', venue_id: 'VEN-004', name: 'Annex', location: 'NORTH', max_capacity: 20 }
    ]))
    .mockResolvedValueOnce(snap([{ id: 'l1', venue_id: 'VEN-001', layout_id: 'THEATRE' }]))
    .mockResolvedValueOnce(snap([{ id: 'f1', venue_id: 'VEN-001', facility_id: 'WIFI' }]))
    .mockResolvedValueOnce(snap([{ id: 'a1', venue_id: 'VEN-001', accessibility_id: 'WHEELCHAIR_ACCESS' }]))
    .mockResolvedValueOnce(snap([{ id: 'h1', venue_id: 'VEN-001', weekday: 'MONDAY', opens_at: '09:00', closes_at: '18:00' }]));
});

test('TC-089 the catalogue lists every venue with name, location, capacity and facilities', async () => {
  render(<VenueCatalogue />);
  expect(await screen.findByText('Hall A')).toBeInTheDocument();
  expect(screen.getByText('Annex')).toBeInTheDocument();
  expect(screen.getByText(/2 venues/i)).toBeInTheDocument();
  expect(screen.getByText(/none listed/i)).toBeInTheDocument();
});

test('TC-091 selecting a venue shows layouts, accessibility and operating hours', async () => {
  render(<VenueCatalogue />);
  await screen.findByText('Hall A');
  await userEvent.click(screen.getAllByRole('button', { name: /view venue/i })[0]);
  await waitFor(() => expect(screen.getByLabelText(/venue record/i)).toBeInTheDocument());
  expect(screen.getByText(/THEATRE/i)).toBeInTheDocument();
  expect(screen.getByText(/WHEELCHAIR ACCESS/i)).toBeInTheDocument();
  expect(screen.getByText(/MONDAY 09:00–18:00/i)).toBeInTheDocument();
});
