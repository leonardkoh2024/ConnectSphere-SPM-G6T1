// Covers B6 ("drafts appear in the Organiser's own list, labelled Draft, with
// the last-saved date and time") and B7 ("drafts remain distinguishable from
// submitted requests by status"), which is why there is no separate drafts
// screen — one list, told apart by the status pill.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDocs } from 'firebase/firestore';
import EventList from './EventList';

jest.mock('../../lib/firebase', () => ({ auth: {}, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), query: jest.fn(), where: jest.fn(), getDocs: jest.fn()
}));

const ts = (iso) => ({ toDate: () => new Date(iso), toMillis: () => Date.parse(iso) });
const USER = { uid: 'u1', email: 'nadia.organiser@connectsphere.com' };

const docs = () => [
  { id: 'a', data: () => ({ name: 'Q4 Partner Summit', status: 'SUBMITTED', reference_no: 'EVT-100234',
      event_date: '2026-11-04', start_time: '09:00', end_time: '17:00', updated_at: ts('2026-09-14T10:15:00Z') }) },
  { id: 'b', data: () => ({ name: 'Volunteer Onboarding', status: 'DRAFT', reference_no: 'EVT-100241',
      event_date: '', start_time: '', end_time: '', updated_at: ts('2026-09-15T16:40:00Z') }) }
];

// CRA sets resetMocks: true, so an implementation handed to jest.fn() in the
// factory above is stripped before each test. It has to be set per test.
const givenEvents = (list = docs()) => getDocs.mockResolvedValue({ docs: list });

describe('the organiser event list', () => {
  test('shows drafts and submitted requests together, told apart by status', async () => {
    givenEvents();
    render(<EventList user={USER} />);

    expect(await screen.findByText('Q4 Partner Summit')).toBeInTheDocument();
    expect(screen.getByText('Volunteer Onboarding')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    expect(screen.getByText('SUBMITTED')).toBeInTheDocument();
  });

  test('a draft carries its last-saved time; a submitted request does not', async () => {
    givenEvents();
    render(<EventList user={USER} />);

    await screen.findByText('Volunteer Onboarding');
    expect(screen.getAllByText(/^Last saved /)).toHaveLength(1);
  });

  test('only a draft can be continued, and submitted or later statuses use view-only actions', async () => {
    givenEvents();
    const onEdit = jest.fn();
    const onView = jest.fn();
    render(<EventList user={USER} onEdit={onEdit} onView={onView} />);

    await screen.findByText('Q4 Partner Summit');
    const editButtons = screen.queryAllByRole('button', { name: /continue editing/i });
    expect(editButtons).toHaveLength(1);
    expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /view details/i }));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ reference_no: 'EVT-100234' }));
  });

  test('the most recently saved event comes first', async () => {
    givenEvents();
    const { container } = render(<EventList user={USER} />);

    await screen.findByText('Q4 Partner Summit');
    const names = [...container.querySelectorAll('.cs-record h2')].map((h) => h.textContent);
    expect(names).toEqual(['Volunteer Onboarding', 'Q4 Partner Summit']);
  });

  test('a draft with no times reads cleanly rather than leaving a dangling dash', async () => {
    givenEvents();
    render(<EventList user={USER} />);

    await screen.findByText('Volunteer Onboarding');
    expect(screen.getByText(/Date not set · Time not set$/)).toBeInTheDocument();
  });

  test('an empty list points the organiser at the request form', async () => {
    givenEvents([]);
    render(<EventList user={USER} />);

    await waitFor(() => expect(screen.getByText(/have not created any events/i)).toBeInTheDocument());
  });
});
