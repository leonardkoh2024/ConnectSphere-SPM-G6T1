// Covers B6 ("drafts appear in the Organiser's own list, labelled Draft, with
// the last-saved date and time") and B7 ("drafts remain distinguishable from
// submitted requests by status"), which is why there is no separate drafts
// screen — one list, told apart by the status pill.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDoc, getDocs, where } from 'firebase/firestore';
import EventList from './EventList';
import { ROLES } from '../../domain/roles';

jest.mock('../../lib/firebase', () => ({ auth: {}, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), query: jest.fn(), where: jest.fn(), getDocs: jest.fn(),
  deleteDoc: jest.fn(), doc: jest.fn()
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
// The first read is the event list; the reads after it belong to deletion, which
// sweeps the four collections keyed by event_id.
const givenEvents = (list = docs()) => {
  getDocs.mockResolvedValue({ docs: [] });
  getDocs.mockResolvedValueOnce({ docs: list });
  const { doc } = require('firebase/firestore');
  doc.mockImplementation((_db, name, id) => `${name}/${id}`);
  deleteDoc.mockResolvedValue();
};

describe('the organiser event list', () => {
  test('shows drafts and submitted requests together, told apart by status', async () => {
    givenEvents();
    render(<EventList user={USER} role={ROLES.ORGANISER} />);

    expect(await screen.findByText('Q4 Partner Summit')).toBeInTheDocument();
    expect(screen.getByText('Volunteer Onboarding')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    expect(screen.getByText('SUBMITTED')).toBeInTheDocument();
  });

  test('B7 a draft and a submitted request are told apart by colour, not only by wording', async () => {
    givenEvents();
    render(<EventList user={USER} role={ROLES.ORGANISER} />);

    await screen.findByText('Q4 Partner Summit');
    const draftPill = screen.getByText('DRAFT');
    const submittedPill = screen.getByText('SUBMITTED');

    expect(draftPill).toHaveClass('cs-pill', 'cs-pill-neutral');
    expect(submittedPill).toHaveClass('cs-pill', 'cs-pill-info');
    expect(draftPill.className).not.toEqual(submittedPill.className);
  });

  test('a draft carries its last-saved time; a submitted request does not', async () => {
    givenEvents();
    render(<EventList user={USER} role={ROLES.ORGANISER} />);

    await screen.findByText('Volunteer Onboarding');
    expect(screen.getAllByText(/^Last saved /)).toHaveLength(1);
  });

  test('only a draft can be edited, and submitted or later statuses use view-only actions', async () => {
    givenEvents();
    const onEdit = jest.fn();
    const onView = jest.fn();
    render(<EventList user={USER} role={ROLES.ORGANISER} onEdit={onEdit} onView={onView} />);

    await screen.findByText('Q4 Partner Summit');
    const editButtons = screen.queryAllByRole('button', { name: /^edit$/i });
    expect(editButtons).toHaveLength(1);
    expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /view details/i }));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ reference_no: 'EVT-100234' }));
  });

  test('the most recently saved event comes first', async () => {
    givenEvents();
    const { container } = render(<EventList user={USER} role={ROLES.ORGANISER} />);

    await screen.findByText('Q4 Partner Summit');
    const names = [...container.querySelectorAll('.cs-record h2')].map((h) => h.textContent);
    expect(names).toEqual(['Volunteer Onboarding', 'Q4 Partner Summit']);
  });

  test('a draft with no times reads cleanly rather than leaving a dangling dash', async () => {
    givenEvents();
    render(<EventList user={USER} role={ROLES.ORGANISER} />);

    await screen.findByText('Volunteer Onboarding');
    expect(screen.getByText(/Date not set · Time not set$/)).toBeInTheDocument();
  });

  test('TC-074 an empty list says so and offers the one action that changes it', async () => {
    givenEvents([]);
    const onCreate = jest.fn();
    render(<EventList user={USER} role={ROLES.ORGANISER} onCreate={onCreate} />);

    await waitFor(() => expect(screen.getByText(/don’t have any events yet/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /create new event request/i }));
    expect(onCreate).toHaveBeenCalled();
  });

  test('TC-074 a list that has events still offers Create', async () => {
    givenEvents();
    const onCreate = jest.fn();
    render(<EventList user={USER} role={ROLES.ORGANISER} onCreate={onCreate} />);

    await screen.findByText('Q4 Partner Summit');
    await userEvent.click(screen.getByRole('button', { name: /create new event request/i }));
    expect(onCreate).toHaveBeenCalled();
  });

  test('TC-075 a card reads left to right: what it is, its reference, where it has got to, what you can do', async () => {
    givenEvents();
    const { container } = render(<EventList user={USER} role={ROLES.ORGANISER} onEdit={jest.fn()} onView={jest.fn()} />);

    await screen.findByText('Q4 Partner Summit');
    const draft = [...container.querySelectorAll('.cs-record')].find((card) => card.textContent.includes('Volunteer Onboarding'));
    const columns = [...draft.children].map((column) => column.className);

    expect(columns).toEqual(['cs-record-title', 'cs-record-ref', 'cs-record-status', 'cs-record-modified', 'cs-record-actions']);
    expect(draft.querySelector('.cs-record-title h2')).toHaveTextContent('Volunteer Onboarding');
    expect(draft.querySelector('.cs-record-title p')).toHaveTextContent('Date not set');
    expect(draft.querySelector('.cs-record-ref')).toHaveTextContent('EVT-100241');
    expect(draft.querySelector('.cs-record-status .cs-pill')).toHaveTextContent('DRAFT');
    expect(draft.querySelector('.cs-record-modified .cs-record-saved')).toHaveTextContent(/^Last saved /);
  });
});

// Story A5 — "see only events I am related to" (TC-016).
//
// Asserting that another organiser's event is absent from the rendered list would
// prove nothing on its own, because the list only contains what this test handed
// back. What matters is that the query asked Firestore to filter, and filtered on
// the field that belongs to the signed-in user's role.
describe('TC-016 the list is scoped to the events the user is related to', () => {
  test('an organiser only ever asks for events carrying their own organiser_id', async () => {
    givenEvents();
    render(<EventList user={USER} role={ROLES.ORGANISER} />);

    await screen.findByText('Q4 Partner Summit');
    expect(where).toHaveBeenCalledWith('organiser_id', '==', 'u1');
  });

  test('a coordinator is scoped by coordinator_id rather than ownership', async () => {
    givenEvents([]);
    render(<EventList user={USER} role={ROLES.COORDINATOR} />);

    await waitFor(() => expect(where).toHaveBeenCalledWith('coordinator_id', '==', 'u1'));
    expect(where).not.toHaveBeenCalledWith('organiser_id', '==', 'u1');
  });

  test.each([
    [ROLES.VENUE_STAFF, 'venue_staff_id'],
    [ROLES.TECH_SUPPORT, 'tech_support_id']
  ])('%s is scoped by %s', async (role, field) => {
    givenEvents([]);
    render(<EventList user={USER} role={role} />);

    await waitFor(() => expect(where).toHaveBeenCalledWith(field, '==', 'u1'));
  });

  test('an attendee never queries the events collection at all', () => {
    render(<EventList user={USER} role={ROLES.ATTENDEE} />);

    expect(getDocs).not.toHaveBeenCalled();
    expect(screen.getByText(/through your own registrations/i)).toBeInTheDocument();
  });
});

// Story B8 / SCRUM-99 — "Delete a draft I no longer need" (TC-076 … TC-078).
describe('B8 deleting a draft', () => {
  test('TC-076 Delete is offered on a draft and on nothing else', async () => {
    givenEvents();
    render(<EventList user={USER} role={ROLES.ORGANISER} onEdit={jest.fn()} onView={jest.fn()} />);

    await screen.findByText('Q4 Partner Summit');
    expect(screen.getAllByRole('button', { name: /^delete$/i })).toHaveLength(1);

    const submitted = [...document.querySelectorAll('.cs-record')].find((card) => card.textContent.includes('Q4 Partner Summit'));
    expect(within(submitted).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  test('TC-077 the confirmation is asked in a dialog, not inside the card, and Keep calls it off', async () => {
    givenEvents();
    const { container } = render(<EventList user={USER} role={ROLES.ORGANISER} onEdit={jest.fn()} />);

    await screen.findByText('Volunteer Onboarding');
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: /delete this draft\?/i })).toBeInTheDocument();
    // The draft it is about to delete is named, and the question is outside the card.
    expect(within(dialog).getByText(/Volunteer Onboarding/)).toBeInTheDocument();
    const card = [...container.querySelectorAll('.cs-record')].find((item) => item.textContent.includes('Volunteer Onboarding'));
    expect(card.textContent).not.toMatch(/delete this draft\?/i);
    expect(deleteDoc).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: /keep draft/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(screen.getByText('Volunteer Onboarding')).toBeInTheDocument();
  });

  test('TC-077 Escape dismisses the dialog and keeps the draft', async () => {
    givenEvents();
    render(<EventList user={USER} role={ROLES.ORGANISER} onEdit={jest.fn()} />);

    await screen.findByText('Volunteer Onboarding');
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(screen.getByText('Volunteer Onboarding')).toBeInTheDocument();
  });

  test('TC-078 a confirmed delete removes the draft from the list, and its other five documents with it', async () => {
    givenEvents();
    const onDeleted = jest.fn();
    render(<EventList user={USER} role={ROLES.ORGANISER} onEdit={jest.fn()} onDeleted={onDeleted} />);

    await screen.findByText('Volunteer Onboarding');
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /yes, delete/i }));

    await waitFor(() => expect(screen.queryByText('Volunteer Onboarding')).not.toBeInTheDocument());
    expect(deleteDoc).toHaveBeenCalledWith('event_venue_requirements/b');
    // The event goes last: the rules on the other five authorise by looking it up.
    expect(deleteDoc).toHaveBeenLastCalledWith('events/b');
    expect(onDeleted).toHaveBeenCalledWith(expect.stringMatching(/deleted/i));
    expect(screen.getByText('Q4 Partner Summit')).toBeInTheDocument();
  });
});

// B10 — the organiser narrows My events by status and by name or reference.
// TC-784 – TC-786 in docs/test-cases.md.
describe('B10 filtering My events', () => {
  test('TC-784 the Status filter shows only events in that status', async () => {
    givenEvents();
    render(<EventList user={USER} role={ROLES.ORGANISER} />);
    await screen.findByText('Q4 Partner Summit');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'DRAFT');
    expect(screen.getByText('Volunteer Onboarding')).toBeInTheDocument();
    expect(screen.queryByText('Q4 Partner Summit')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'all');
    expect(screen.getByText('Q4 Partner Summit')).toBeInTheDocument();
  });

  test('TC-785 Search matches the event name or its reference, whatever the case', async () => {
    givenEvents();
    render(<EventList user={USER} role={ROLES.ORGANISER} />);
    await screen.findByText('Q4 Partner Summit');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'partner');
    expect(screen.getByText('Q4 Partner Summit')).toBeInTheDocument();
    expect(screen.queryByText('Volunteer Onboarding')).not.toBeInTheDocument();

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'evt-100241');
    expect(screen.getByText('Volunteer Onboarding')).toBeInTheDocument();
    expect(screen.queryByText('Q4 Partner Summit')).not.toBeInTheDocument();
  });

  test('TC-786 filters that match nothing say so, and every status is offered', async () => {
    givenEvents();
    render(<EventList user={USER} role={ROLES.ORGANISER} />);
    await screen.findByText('Q4 Partner Summit');

    const options = within(screen.getByRole('combobox', { name: 'Status' })).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['All events', 'Draft', 'Submitted', 'Under review', 'Approved', 'Planning', 'Safety review', 'Confirmed', 'Completed', 'Cancelled', 'Rejected']);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'CONFIRMED');
    expect(screen.getByText('No events match these filters.')).toBeInTheDocument();
  });
});
