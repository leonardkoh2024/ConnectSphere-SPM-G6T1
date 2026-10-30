import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { doc, getDocs, updateDoc } from 'firebase/firestore';
import { ROLES } from '../../domain/roles';
import VenueCatalogue from './VenueCatalogue';

jest.mock('../../lib/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db, name) => name),
  getDocs: jest.fn(),
  query: jest.fn((reference, ...constraints) => ({ reference, constraints })),
  where: jest.fn((field, operator, value) => ({ field, operator, value })),
  doc: jest.fn((_db, collectionName, id) => ({ collectionName, id })),
  updateDoc: jest.fn()
}));

const snap = (rows) => ({
  docs: rows.map((row) => ({ id: row.id, data: () => row }))
});

let assignedStaffId;
let readIndex;

beforeEach(() => {
  assignedStaffId = null;
  readIndex = 0;
  doc.mockImplementation((_db, collectionName, id) => ({ collectionName, id }));
  updateDoc.mockResolvedValue();
  getDocs.mockImplementation((reference) => {
    const fallbackOrder = assignedStaffId
      ? ['venue_staff', 'venues', 'venue_layouts', 'venue_facilities', 'venue_accessibility', 'venue_operating_hours', 'venue_bookings', 'venue_unavailability']
      : ['venues', 'venue_layouts', 'venue_facilities', 'venue_accessibility', 'venue_operating_hours', 'venue_bookings', 'venue_unavailability'];
    const fallbackName = fallbackOrder[readIndex++];
    const collectionName = typeof reference === 'string' ? reference : reference?.reference || fallbackName;
    if (collectionName === 'venues') return Promise.resolve(snap([
      { id: 'VEN-001', venue_id: 'VEN-001', name: 'Hall A', building: 'Central Tower', location: 'CENTRAL', max_capacity: 500 },
      { id: 'VEN-004', venue_id: 'VEN-004', name: 'Annex', location: 'NORTH', max_capacity: 20 }
    ]));
    if (collectionName === 'venue_layouts') return Promise.resolve(snap([{ id: 'l1', venue_id: 'VEN-001', layout_id: 'THEATRE' }]));
    if (collectionName === 'venue_facilities') return Promise.resolve(snap([{ id: 'f1', venue_id: 'VEN-001', facility_id: 'WIFI' }]));
    if (collectionName === 'venue_accessibility') return Promise.resolve(snap([{ id: 'a1', venue_id: 'VEN-001', accessibility_id: 'WHEELCHAIR_ACCESS' }]));
    if (collectionName === 'venue_operating_hours') return Promise.resolve(snap([{ id: 'h1', venue_id: 'VEN-001', weekday: 'MONDAY', opens_at: '09:00', closes_at: '18:00' }]));
    if (collectionName === 'venue_staff') return Promise.resolve(snap(assignedStaffId ? [{ id: 'VEN-001', venue_id: 'VEN-001', user_id: assignedStaffId }] : []));
    return Promise.resolve(snap([]));
  });
});

test('TC-0673 the catalogue lists every venue with name, location, capacity and facilities', async () => {
  const { container } = render(<VenueCatalogue />);
  expect(await screen.findByText('Hall A')).toBeInTheDocument();
  expect(screen.getByText('Annex')).toBeInTheDocument();
  expect(screen.getByText(/2 venues/i)).toBeInTheDocument();
  expect(screen.getByText(/none listed/i)).toBeInTheDocument();
  expect([...container.querySelectorAll('.cs-record-title h2')].map((heading) => heading.textContent)).toEqual(['Annex', 'Hall A']);
});

test('TC-0674 selecting a venue shows layouts, accessibility and operating hours', async () => {
  render(<VenueCatalogue />);
  await screen.findByText('Hall A');
  await userEvent.click(within(screen.getByText('Hall A').closest('.cs-record')).getByRole('button', { name: /view venue/i }));
  await waitFor(() => expect(screen.getByLabelText(/venue record/i)).toBeInTheDocument());
  expect(screen.getByText(/THEATRE/i)).toBeInTheDocument();
  expect(screen.getByText(/WHEELCHAIR ACCESS/i)).toBeInTheDocument();
  expect(screen.getByText(/MONDAY 09:00–18:00/i)).toBeInTheDocument();
  // E9 AC1 — legacy documents remain compatible while new venue records and
  // seed data persist these same zero defaults explicitly.
  expect(screen.getByText(/setup time/i).closest('div')).toHaveTextContent('0 minutes');
  expect(screen.getByText(/turnaround time/i).closest('div')).toHaveTextContent('0 minutes');
  const hallRow = [...document.querySelectorAll('.cs-record-title h2')].find((heading) => heading.textContent === 'Hall A').closest('.cs-record');
  expect(screen.getByLabelText(/venue record/i).closest('.cs-record')).toBe(hallRow);
  await userEvent.click(within(hallRow).getByRole('button', { name: /close/i }));
  expect(screen.queryByLabelText(/venue record/i)).not.toBeInTheDocument();
});

test('TC-0675 only the Venue Staff member assigned to a venue can edit it', async () => {
  assignedStaffId = 'staff-1';
  render(<VenueCatalogue user={{ uid: 'staff-1' }} role={ROLES.VENUE_STAFF} />);
  await screen.findByText('Hall A');
  expect(screen.getAllByRole('button', { name: /update venue/i })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: /view venue/i })).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: /update venue/i }));
  expect(screen.getByRole('heading', { name: /edit venue/i })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /close/i }));
  expect(screen.queryByRole('heading', { name: /edit venue/i })).not.toBeInTheDocument();
});

test('TC-0676 Venue Staff can filter the catalogue to My venues and return to all venues', async () => {
  assignedStaffId = 'staff-1';
  render(<VenueCatalogue user={{ uid: 'staff-1' }} role={ROLES.VENUE_STAFF} />);

  await screen.findByText('Hall A');
  expect(screen.getByText('Annex')).toBeInTheDocument();
  const myVenues = screen.getByRole('button', { name: /my venues/i });
  expect(myVenues).toHaveAttribute('aria-pressed', 'false');

  await userEvent.click(myVenues);
  expect(myVenues).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Hall A')).toBeInTheDocument();
  expect(screen.queryByText('Annex')).not.toBeInTheDocument();
  expect(screen.getByText(/1 venue/i)).toBeInTheDocument();

  await userEvent.click(myVenues);
  expect(screen.getByText('Annex')).toBeInTheDocument();
  expect(screen.getByText(/2 venues/i)).toBeInTheDocument();
});

test('TC-0677 the My venues filter is not shown to coordinators', async () => {
  render(<VenueCatalogue user={{ uid: 'coordinator-1' }} role={ROLES.EVENT_COORDINATOR} />);
  await screen.findByText('Hall A');
  expect(screen.queryByRole('button', { name: /my venues/i })).not.toBeInTheDocument();
});

test('TC-0678 venue edits require a positive whole capacity and at least one layout', async () => {
  assignedStaffId = 'staff-1';
  render(<VenueCatalogue user={{ uid: 'staff-1' }} role={ROLES.VENUE_STAFF} />);
  await screen.findByText('Hall A');
  await userEvent.click(screen.getByRole('button', { name: /update venue/i }));
  fireEvent.change(screen.getByRole('spinbutton', { name: /maximum capacity/i }), { target: { value: '0' } });
  await userEvent.click(screen.getByRole('button', { name: /save venue/i }));
  expect(screen.getByRole('alert')).toHaveTextContent(/whole number greater than zero/i);
  expect(updateDoc).not.toHaveBeenCalled();

  fireEvent.change(screen.getByRole('spinbutton', { name: /maximum capacity/i }), { target: { value: '550' } });
  await userEvent.click(screen.getByRole('checkbox', { name: /THEATRE/i }));
  await userEvent.click(screen.getByRole('button', { name: /save venue/i }));
  expect(screen.getByRole('alert')).toHaveTextContent(/at least one supported room layout/i);
  expect(updateDoc).not.toHaveBeenCalled();
});

test('TC-0679 assigned staff save venue details without changing existing bookings', async () => {
  assignedStaffId = 'staff-1';
  render(<VenueCatalogue user={{ uid: 'staff-1' }} role={ROLES.VENUE_STAFF} />);
  await screen.findByText('Hall A');
  await userEvent.click(screen.getByRole('button', { name: /update venue/i }));
  fireEvent.change(screen.getByRole('spinbutton', { name: /maximum capacity/i }), { target: { value: '550' } });
  fireEvent.change(screen.getByLabelText(/space availability for special requirements/i), { target: { value: 'Quiet room available beside the hall' } });
  await userEvent.click(screen.getByRole('button', { name: /save venue/i }));

  await waitFor(() => expect(updateDoc).toHaveBeenCalledWith(
    { collectionName: 'venues', id: 'VEN-001' },
    expect.objectContaining({
      building: 'Central Tower',
      max_capacity: 550,
      layouts: ['THEATRE'],
      facilities: ['WIFI'],
      accessibility: ['WHEELCHAIR_ACCESS'],
      operating_hours: [{ weekday: 'MONDAY', opens_at: '09:00', closes_at: '18:00' }],
      special_space_availability: 'Quiet room available beside the hall'
    })
  ));
  expect(screen.getByText(/quiet room available beside the hall/i)).toBeInTheDocument();
  expect(updateDoc.mock.calls[0][0].collectionName).toBe('venues');
});

// E4 / SCRUM-120 — the availability calendar opens from the catalogue.
test('TC-0680 the catalogue swaps to one shared calendar and back, with no per-venue calendar button', async () => {
  assignedStaffId = 'staff-1';
  const onCloseCalendar = jest.fn();
  const { rerender } = render(<VenueCatalogue user={{ uid: 'staff-1' }} role={ROLES.VENUE_STAFF} />);
  await screen.findByText('Hall A');
  expect(screen.queryByRole('button', { name: /view calendar/i })).not.toBeInTheDocument();

  rerender(<VenueCatalogue user={{ uid: 'staff-1' }} role={ROLES.VENUE_STAFF} showCalendar onCloseCalendar={onCloseCalendar} />);
  expect(screen.getByRole('region', { name: /availability calendar/i })).toBeInTheDocument();
  // Opens across every venue; each is one choice away in the Venue filter.
  const venuesField = screen.getByRole('button', { name: /^venues/i });
  expect(venuesField).toHaveTextContent('All venues');
  await userEvent.click(venuesField);
  expect(screen.getAllByRole('checkbox', { name: /all venues|annex|hall a/i }).map((box) => box.closest('label').textContent)).toEqual(['All venues', 'Annex', 'Hall A']);
  expect(screen.getByRole('checkbox', { name: 'All venues' })).toBeChecked();
  expect(screen.queryByText(/2 venues/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /back to catalogue/i }));
  expect(onCloseCalendar).toHaveBeenCalled();
});
