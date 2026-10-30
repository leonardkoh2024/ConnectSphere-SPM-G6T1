// Epic B — creating and submitting an event request.
//
// B1 / SCRUM-92 "Create an event request with the core details" → …
// B9 / SCRUM-100 "Submit an event request" → …,
// …
// B1 drafts are checked on what they hold →
// B4 / SCRUM-95 "State the equipment my event needs" →
//
// Every case below is written up in docs/test-cases.md with its pre-condition,
// steps and expected result.
//
// Why fireEvent.change rather than userEvent.type for most fields: these tests
// are about the validation rules, and typing a value such as "1.5" or "-5" one
// keystroke at a time leaves the field in intermediate states that say nothing
// about the rule under test. still types, so the form is proven to work
// under real keystrokes too.

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as firestore from 'firebase/firestore';
import EventRequestForm from './EventRequestForm';
import { createReferenceNo } from '../../domain/eventRequest';

jest.mock('../../lib/firebase', () => ({ db: {} }));

jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(),
  collection: jest.fn(),
  deleteDoc: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  query: jest.fn(),
  serverTimestamp: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  where: jest.fn()
}));

const { addDoc, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } = firestore;

const USER = { uid: 'u1', email: 'nadia.organiser@connectsphere.com' };

// The form compares dates against `new Date().toISOString().slice(0, 10)`, so the
// tests derive theirs the same way instead of hard-coding a date that goes stale.
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const TODAY = isoDate(0);
const YESTERDAY = isoDate(-1);
const EVENT_DAY = isoDate(30);
const DAY_BEFORE_EVENT = isoDate(29);

const CORE = {
  name: 'Q4 Partner Summit',
  purpose: 'Partner briefing',
  description: 'A full-day briefing for our regional partners.',
  attendance: '180',
  date: EVENT_DAY,
  start: '09:00',
  end: '17:00',
  location: 'CENTRAL',
  layout: 'THEATRE'
};

// CRA sets resetMocks: true, which strips any implementation handed to jest.fn()
// in the factory above before each test, so they are set here instead.
beforeEach(() => {
  collection.mockImplementation((_db, name) => name);
  doc.mockImplementation((_db, name, id) => `${name}/${id}`);
  getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
  getDocs.mockResolvedValue({ docs: [] });
  serverTimestamp.mockReturnValue('server-ts');
  setDoc.mockResolvedValue();
  updateDoc.mockResolvedValue();
  deleteDoc.mockResolvedValue();
  addDoc.mockResolvedValue({ id: 'event-123' });
});

const setField = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

const fillCoreDetails = (overrides = {}) => {
  const values = { ...CORE, ...overrides };
  setField(/event name/i, values.name);
  setField(/purpose/i, values.purpose);
  setField(/description/i, values.description);
  setField(/expected attendance/i, values.attendance);
  setField(/proposed date/i, values.date);
  setField(/start time/i, values.start);
  setField(/end time/i, values.end);
};

// B9 AC1 — venue requirements are part of what has to be present at submission.
const fillVenueRequirements = (overrides = {}) => {
  const values = { ...CORE, ...overrides };
  setField(/preferred location or area/i, values.location);
  setField(/required layout/i, values.layout);
};

const fillEquipmentLine = ({ type = 'AUDIO', quantity = '2' } = {}) => {
  setField('Equipment type 1', type);
  setField('Quantity 1', quantity);
};

// B9 AC2 — each optional section opens with a Yes/No question. Nothing is
// pre-selected, so an unanswered question is distinguishable from a deliberate No.
const QUESTIONS = {
  facilities: 'Does your event need facilities from the venue?',
  equipment: 'Does your event need equipment?',
  accessibility: 'Does your event have accessibility needs?',
  registration: 'Do attendees need to register?'
};

const answer = (question, choice) =>
  fireEvent.click(within(screen.getByRole('group', { name: question })).getByRole('radio', { name: choice }));

// The detail fields only exist once the question above them is answered Yes.
const needEquipment = (line) => {
  answer(QUESTIONS.equipment, 'Yes');
  fillEquipmentLine(line);
};

// A request that satisfies every criterion: the two sections that can be declined
// are declined, and equipment is the one answered Yes.
const fillValidRequest = (overrides = {}) => {
  fillCoreDetails(overrides);
  fillVenueRequirements(overrides);
  answer(QUESTIONS.facilities, 'No');
  needEquipment(overrides.equipment);
  answer(QUESTIONS.accessibility, 'No');
};

const submit = async () => userEvent.click(screen.getByRole('button', { name: /submit request/i }));

// The write that carries the event itself, as opposed to the history entry that
// follows it into a different collection.
const eventWrite = () => addDoc.mock.calls.find(([name]) => name === 'events')?.[1];
const historyWrite = () => addDoc.mock.calls.find(([name]) => name === 'event_history')?.[1];

// B9 AC4 — the block names one field at a time, so the assertions read the list.
const listedProblems = () => [...screen.getByRole('alert').querySelectorAll('li')].map((item) => item.textContent);

const expectBlocked = (message) => {
  expect(listedProblems()).toContain(message);
  expect(addDoc).not.toHaveBeenCalled();
  expect(setDoc).not.toHaveBeenCalled();
};

const expectAccepted = async () => {
  await waitFor(() => expect(eventWrite()).toBeDefined());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
};

// ---------------------------------------------------------------------------
// B1 / SCRUM-92 — create an event request with the core details
// ---------------------------------------------------------------------------

describe('B1 core details are captured ()', () => {
  test('TC-0175 a request carries all seven core details, its creator and its creation time', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest();
    await submit();

    await waitFor(() => expect(eventWrite()).toBeDefined());
    expect(eventWrite()).toMatchObject({
      name: CORE.name,
      purpose: CORE.purpose,
      description: CORE.description,
      event_date: CORE.date,
      start_time: CORE.start,
      end_time: CORE.end,
      expected_attendance: 180,
      organiser_id: 'u1',
      created_by: 'u1',
      created_at: 'server-ts'
    });
  });

  test.each([
    ['Event name', { name: '' }],
    ['Purpose', { purpose: '' }],
    ['Description', { description: '' }],
    ['Proposed date', { date: '' }],
    ['Start time', { start: '' }],
    ['End time', { end: '' }],
    ['Expected attendance', { attendance: '' }]
  ])('TC-0176 a request with no %s cannot be submitted, and that field is the one named', async (label, missing) => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest(missing);
    await submit();

    expectBlocked(`${label} is required.`);
    expect(listedProblems()).toHaveLength(1);
  });
});

describe('B1 the event must end after it starts ()', () => {
  test('TC-0177 an end time one minute after the start is accepted', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ start: '09:00', end: '09:01' });
    await submit();

    await expectAccepted();
    expect(eventWrite()).toMatchObject({ start_time: '09:00', end_time: '09:01' });
  });

  test('TC-0178 an end time earlier than the start is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ start: '09:00', end: '08:00' });
    await submit();

    expectBlocked('End time must be later than start time.');
  });

  test('TC-0179 an end time equal to the start is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ start: '09:00', end: '09:00' });
    await submit();

    expectBlocked('End time must be later than start time.');
  });
});

describe('B1 the proposed date may not be in the past ()', () => {
  test('TC-0180 today is the earliest date accepted', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ date: TODAY });
    await submit();

    await expectAccepted();
    expect(eventWrite()).toMatchObject({ event_date: TODAY });
  });

  test('TC-0181 yesterday is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ date: YESTERDAY });
    await submit();

    expectBlocked('The proposed event date cannot be in the past.');
  });
});

describe('B1 expected attendance is a whole number greater than zero ( … )', () => {
  test('TC-0182 an attendance of 1 is accepted and stored as a number', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ attendance: '1' });
    await submit();

    await expectAccepted();
    expect(eventWrite()).toMatchObject({ expected_attendance: 1 });
  });

  test.each([
    ['zero', '0'],
    ['a negative number', '-5'],
    ['a fraction', '1.5']
  ])('TC-0183 an attendance of %s is refused', async (_label, attendance) => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ attendance });
    await submit();

    expectBlocked('Expected attendance must be a whole number greater than zero.');
  });

  // Text never reaches the rule: a number input discards a value that is not a
  // number, so the field arrives at validation empty and is refused as missing.
  // Worth pinning down, because it is why the organiser sees the missing-detail
  // message rather than the whole-number one after typing "many".
  test('TC-0184 text cannot be entered as an attendance, and the request is refused as incomplete', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ attendance: 'many' });
    expect(screen.getByLabelText(/expected attendance/i)).toHaveValue(null);

    await submit();

    expectBlocked('Expected attendance is required.');
  });

  test('TC-0185 the date and attendance controls carry their own guards', () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    expect(screen.getByLabelText(/proposed date/i)).toHaveAttribute('min', TODAY);
    expect(screen.getByLabelText(/expected attendance/i)).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText(/expected attendance/i)).toHaveAttribute('min', '1');
    expect(screen.getByLabelText(/expected attendance/i)).toHaveAttribute('step', '1');
  });
});

// ---------------------------------------------------------------------------
// B9 / SCRUM-100 — submit an event request
// ---------------------------------------------------------------------------

describe('B9 a complete request is submitted ()', () => {
  test('TC-0255 submission records the request as Submitted, with a reference number and a submission time', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest();
    await submit();

    await waitFor(() => expect(eventWrite()).toBeDefined());
    expect(eventWrite()).toMatchObject({ status: 'SUBMITTED', submitted_at: 'server-ts' });
    expect(eventWrite().reference_no).toMatch(/^EVT-[0-9A-Z]{6}-[0-9A-Z]{5}$/);
    await waitFor(() => expect(historyWrite()).toMatchObject({ action_type: 'EVENT_SUBMITTED', actor_id: 'u1' }));
  });

  test('TC-0256 the confirmation names the reference number the request was given', async () => {
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} onSaved={onSaved} />);

    fillValidRequest();
    await submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith(
      `Event request ${eventWrite().reference_no} submitted for coordinator review.`,
      null
    );
  });

  test('TC-2274 K1 SCRUM-182 AC1 a submitted event is not auto-assigned a coordinator', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} onSaved={onSaved} />);

    fillValidRequest();
    await submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // Written with no coordinator, and nothing calls the old auto-assign endpoint —
    // the event waits in the Lead's unassigned queue instead.
    expect(eventWrite().coordinator_id).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('B9 an incomplete request is not submitted ()', () => {
  test('TC-0257 an empty form writes nothing at all, and every unanswered field is named', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    await submit();

    expect(listedProblems()).toEqual([
      'Event name is required.',
      'Purpose is required.',
      'Description is required.',
      'Proposed date is required.',
      'Start time is required.',
      'End time is required.',
      'Expected attendance is required.',
      'Preferred location or area is required.',
      'Required layout is required.',
      'Answer “Does your event need facilities from the venue?”',
      'Answer “Does your event need equipment?”',
      'Answer “Does your event have accessibility needs?”'
    ]);
    expect(addDoc).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  test('TC-0258 the values already entered stay on screen so they can be corrected', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ attendance: '0' });
    await submit();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText(/event name/i)).toHaveValue(CORE.name);
    expect(screen.getByLabelText(/purpose/i)).toHaveValue(CORE.purpose);
    expect(screen.getByLabelText(/proposed date/i)).toHaveValue(CORE.date);
    expect(screen.getByLabelText('Equipment type 1')).toHaveValue('AUDIO');
  });
});

describe('B9 equipment must be answered before submission ()', () => {
  test('TC-0259 answering Yes and then adding no equipment line is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillCoreDetails();
    fillVenueRequirements();
    answer(QUESTIONS.facilities, 'No');
    answer(QUESTIONS.accessibility, 'No');
    answer(QUESTIONS.equipment, 'Yes');
    await submit();

    expectBlocked('Add at least one equipment line, or answer No above.');
  });

  test('TC-0260 answering No puts the equipment fields away and stores the decision', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillCoreDetails();
    fillVenueRequirements();
    answer(QUESTIONS.facilities, 'No');
    answer(QUESTIONS.accessibility, 'No');
    answer(QUESTIONS.equipment, 'Yes');
    expect(screen.getByLabelText('Equipment type 1')).toBeInTheDocument();

    answer(QUESTIONS.equipment, 'No');
    expect(screen.queryByLabelText('Equipment type 1')).not.toBeInTheDocument();

    await submit();

    await expectAccepted();
    expect(eventWrite()).toMatchObject({ equipment_required: false });
    expect(setDoc).not.toHaveBeenCalledWith(expect.stringContaining('event_equipment/'), expect.anything());
  });

  test('TC-0261 an equipment quantity of zero is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ equipment: { quantity: '0' } });
    await submit();

    expectBlocked('Equipment quantity 1 must be a whole number greater than zero.');
  });

  test('TC-0262 an equipment quantity of one is accepted', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ equipment: { quantity: '1' } });
    await submit();

    await expectAccepted();
    expect(setDoc).toHaveBeenCalledWith(
      'event_equipment/event-123_0',
      expect.objectContaining({ equipment_type: 'AUDIO', quantity: 1 })
    );
  });
});

describe('B9 registration details are consistent with the event ( … )', () => {
  const enableRegistration = ({ capacity, openDate = TODAY, openTime = '09:00', closeDate = DAY_BEFORE_EVENT, closeTime = '17:00' }) => {
    answer(QUESTIONS.registration, 'Yes');
    setField(/registration capacity/i, capacity);
    setField(/registration open date/i, openDate);
    setField(/registration open time/i, openTime);
    setField(/registration close date/i, closeDate);
    setField(/registration close time/i, closeTime);
  };

  test('TC-0263 a capacity equal to the expected attendance is accepted', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ attendance: '180' });
    enableRegistration({ capacity: '180' });
    await submit();

    await expectAccepted();
    expect(eventWrite()).toMatchObject({ registration_required: true, registration_capacity: 180 });
  });

  test('TC-0264 a capacity above the expected attendance is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ attendance: '180' });
    enableRegistration({ capacity: '181' });
    await submit();

    expectBlocked('Registration capacity cannot exceed the expected attendance.');
  });

  test('TC-0265 registration with no open and close date/time is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest();
    enableRegistration({ capacity: '100', openDate: '', openTime: '', closeDate: '', closeTime: '' });
    await submit();

    expectBlocked('Registration open and close date/time are required when registration is enabled.');
  });

  test('TC-0266 registration closing after the event has started is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ date: EVENT_DAY, start: '09:00' });
    enableRegistration({ capacity: '100', closeDate: EVENT_DAY, closeTime: '10:00' });
    await submit();

    expectBlocked('Registration close date/time must be at or before the event start.');
  });
});

describe('B9 a request cannot be submitted twice ()', () => {
  test('TC-0267 the form is cleared once the request has gone', async () => {
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} onSaved={onSaved} />);

    fillValidRequest();
    await submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.getByLabelText(/event name/i)).toHaveValue('');
    expect(screen.getByLabelText(/expected attendance/i)).toHaveValue(null);
  });

  test('TC-0268 a request that has already been submitted opens read-only, with no Submit action', async () => {
    const draft = { id: 'event-123', status: 'SUBMITTED', reference_no: 'EVT-100234', name: 'Q4 Partner Summit' };
    render(<EventRequestForm user={USER} draft={draft} onSaved={jest.fn()} />);

    expect(await screen.findByText(/this request is no longer editable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit request/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/event name/i)).toHaveAttribute('readonly');
  });

  test('TC-0269 a request with an open clarification is editable, and submit is replaced by save changes', async () => {
    const draft = {
      id: 'event-123',
      status: 'UNDER_REVIEW',
      reference_no: 'EVT-100234',
      name: 'Q4 Partner Summit',
      open_clarification_id: 'CLR-001'
    };
    render(<EventRequestForm user={USER} draft={draft} onSaved={jest.fn()} />);

    expect(await screen.findByText(/a clarification is open/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit request/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/event name/i)).not.toHaveAttribute('readonly');
  });
});

describe('B9 the block names exactly the fields that are wrong ()', () => {
  test('TC-0270 three broken fields produce three messages, and nothing else is reported', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ name: '', start: '', attendance: '0' });
    await submit();

    expect(listedProblems()).toEqual([
      'Event name is required.',
      'Start time is required.',
      'Expected attendance must be a whole number greater than zero.'
    ]);
    expect(addDoc).not.toHaveBeenCalled();
  });
});

describe('B9 venue requirements and accessibility must be answered ( … )', () => {
  test('TC-0271 preferred location is a Singapore area selector and saves its canonical value', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    const location = screen.getByLabelText(/preferred location or area/i);
    expect(location.tagName).toBe('SELECT');
    expect(within(location).getByRole('option', { name: /central.*city hall/i })).toHaveValue('CENTRAL');
    expect(within(location).getByRole('option', { name: /near an mrt station/i })).toHaveValue('NEAR_MRT');

    fillValidRequest();
    await submit();

    await expectAccepted();
    expect(setDoc).toHaveBeenCalledWith(
      'event_venue_requirements/event-123',
      expect.objectContaining({ preferred_location: 'CENTRAL' })
    );
  });

  test('TC-0272 a request with no venue requirements is refused, naming both of them', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ location: '', layout: '' });
    await submit();

    expect(listedProblems()).toEqual([
      'Preferred location or area is required.',
      'Required layout is required.'
    ]);
    expect(addDoc).not.toHaveBeenCalled();
  });

  test('TC-0273 answering Yes to facilities and choosing none is refused; answering No is accepted', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillCoreDetails();
    fillVenueRequirements();
    needEquipment();
    answer(QUESTIONS.accessibility, 'No');
    answer(QUESTIONS.facilities, 'Yes');
    await submit();

    expectBlocked('Select at least one required facility, or answer No above.');

    answer(QUESTIONS.facilities, 'No');
    await submit();

    await expectAccepted();
    expect(setDoc).toHaveBeenCalledWith(
      'event_venue_requirements/event-123',
      expect.objectContaining({ facilities_required: false })
    );
  });

  test('TC-0274 answering Yes to accessibility and choosing none is refused; answering No is accepted', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillCoreDetails();
    fillVenueRequirements();
    needEquipment();
    answer(QUESTIONS.facilities, 'No');
    answer(QUESTIONS.accessibility, 'Yes');
    await submit();

    expectBlocked('Select at least one accessibility need, or answer No above.');

    answer(QUESTIONS.accessibility, 'No');
    await submit();

    await expectAccepted();
    expect(setDoc).toHaveBeenCalledWith(
      'event_venue_requirements/event-123',
      expect.objectContaining({ accessibility_needed: false })
    );
  });

  test('TC-0275 a Yes keeps what was chosen; changing to No clears it rather than submitting it', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillCoreDetails();
    fillVenueRequirements();
    needEquipment();
    answer(QUESTIONS.facilities, 'No');
    answer(QUESTIONS.accessibility, 'Yes');
    fireEvent.click(screen.getByLabelText('WHEELCHAIR ACCESS'));
    expect(screen.getByLabelText('WHEELCHAIR ACCESS')).toBeChecked();

    answer(QUESTIONS.accessibility, 'No');
    await submit();

    await expectAccepted();
    expect(setDoc).not.toHaveBeenCalledWith(expect.stringContaining('event_accessibility/'), expect.anything());
  });
});

describe('B9 the reference number ()', () => {
  test('TC-0276 a draft keeps the reference number it was first given when it is submitted', async () => {
    const draft = { id: 'event-123', status: 'DRAFT', reference_no: 'EVT-ABC123-9Z8Y' };
    render(<EventRequestForm user={USER} draft={draft} onSaved={jest.fn()} />);

    await screen.findByText(/editing draft EVT-ABC123-9Z8Y/i);
    fillValidRequest();
    await submit();

    await waitFor(() => expect(updateDoc).toHaveBeenCalled());
    expect(updateDoc).toHaveBeenCalledWith('events/event-123', expect.objectContaining({
      reference_no: 'EVT-ABC123-9Z8Y',
      status: 'SUBMITTED'
    }));
  });

  // Deterministic, not probabilistic: the counter behind the timestamp is what
  // makes this hold, so the test cannot pass or fail on the luck of the draw.
  test('TC-0277 references generated in the same millisecond never repeat', () => {
    const references = Array.from({ length: 2000 }, () => createReferenceNo());

    expect(new Set(references).size).toBe(2000);
    expect(references.every((reference) => /^EVT-[0-9A-Z]{6}-[0-9A-Z]{5}$/.test(reference))).toBe(true);
  });
});

describe('B1 a draft is checked on what it holds, not on what it is missing ()', () => {
  test('TC-0186 an incomplete draft saves without complaint', async () => {
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} onSaved={onSaved} />);

    setField(/event name/i, 'Ideas for the summit');
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0][0]).toMatch(/^Draft EVT-[0-9A-Z]{6}-[0-9A-Z]{5} saved\./);
    expect(eventWrite()).toMatchObject({ status: 'DRAFT', name: 'Ideas for the summit' });
  });

  test('TC-0187 a draft holding an impossible value is refused, because B1 AC2 is a rule about the value', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    setField(/event name/i, 'Ideas for the summit');
    setField(/start time/i, '14:00');
    setField(/end time/i, '11:00');
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    expectBlocked('End time must be later than start time.');
  });
});

// ---------------------------------------------------------------------------
// B4 / SCRUM-95 — state the equipment my event needs
// ---------------------------------------------------------------------------

describe('B4 equipment lines ()', () => {
  test('TC-0199 an organiser can add a second equipment line and submit both', async () => {
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} onSaved={onSaved} />);

    fillCoreDetails();
    fillVenueRequirements();
    answer(QUESTIONS.facilities, 'No');
    answer(QUESTIONS.accessibility, 'No');
    answer(QUESTIONS.equipment, 'Yes');

    await userEvent.selectOptions(screen.getByLabelText('Equipment type 1'), 'AUDIO');
    await userEvent.type(screen.getByLabelText('Quantity 1'), '2');
    await userEvent.type(screen.getByLabelText('Technical note 1'), 'Need HDMI cable adapter.');

    await userEvent.click(screen.getByRole('button', { name: /add equipment line/i }));
    await userEvent.selectOptions(screen.getByLabelText('Equipment type 2'), 'VISUAL');
    await userEvent.type(screen.getByLabelText('Quantity 2'), '4');

    await submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(setDoc).toHaveBeenCalledWith('event_equipment/event-123_0', expect.objectContaining({
      equipment_type: 'AUDIO', quantity: 2, technical_note: 'Need HDMI cable adapter.'
    }));
    expect(setDoc).toHaveBeenCalledWith('event_equipment/event-123_1', expect.objectContaining({
      equipment_type: 'VISUAL', quantity: 4, technical_note: null
    }));
  });
});

// ---------------------------------------------------------------------------
// The form tells the organiser which answers are compulsory before they submit
// ---------------------------------------------------------------------------

describe('compulsory questions are marked ()', () => {
  const marked = (label) => screen.getByText(label).closest('label, fieldset').querySelector('.cs-required') !== null;

  test('TC-0278 every compulsory question carries the red marker, and the optional notes do not', () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    ['Event name', 'Purpose', 'Description', 'Proposed date', 'Start time', 'End time', 'Expected attendance',
      'Preferred location or area', 'Required layout'].forEach((label) => expect(marked(label)).toBe(true));

    Object.values(QUESTIONS).forEach((question) => expect(marked(question)).toBe(true));

    expect(marked('Additional accessibility notes')).toBe(false);
  });

  test('TC-0279 the form says what the marker means, and the browser is not left to enforce it', () => {
    const { container } = render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    expect(screen.getByText(/compulsory/i)).toBeInTheDocument();
    expect(container.querySelector('form')).toHaveAttribute('novalidate');
  });
});

// ---------------------------------------------------------------------------
// J2 / SCRUM-151 AC1 — "submission received". Submitting tells the organiser, in their
// own inbox, that the request was received. AC2: it names the event and the change.
// ---------------------------------------------------------------------------

describe('J2 SCRUM-151 the organiser is told the request was received', () => {
  // A notification is written with setDoc under its own id, because firestore.rules
  // requires notification_id to equal the document id (so addDoc cannot be used).
  const received = () => setDoc.mock.calls.filter(([, data]) => data?.type === 'EVENT_SUBMITTED');

  beforeEach(() => {
    // doc(collection(db, 'notifications')) has no id of its own to give, so it returns a
    // reference with one, as the real SDK does; every other doc() call keeps its path string.
    doc.mockImplementation((first, name, id) => (name ? `${name}/${id}` : { id: 'auto-id', path: `${first}/auto-id` }));
  });

  test('TC-2133 J2 AC1 AC2 submitting writes one notice to the organiser, naming the event and the change', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest();
    await submit();

    await waitFor(() => expect(received()).toHaveLength(1));
    const [ref, data] = received()[0];
    expect(ref.path).toBe('notifications/auto-id');
    expect(data).toMatchObject({
      notification_id: 'auto-id', user_id: 'u1', event_id: 'event-123', type: 'EVENT_SUBMITTED',
      message: 'Q4 Partner Summit was submitted and is waiting for a coordinator.',
      is_read: false, created_at: 'server-ts', read_at: null
    });
  });

  test('TC-2134 J2 AC1 the notice is written only after the event itself has been saved', async () => {
    addDoc.mockRejectedValue(new Error('network down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest();
    await submit();

    expect(await screen.findByText(/could not save your event request/i)).toBeInTheDocument();
    expect(received()).toHaveLength(0);
    console.error.mockRestore();
  });

  test('TC-2135 J2 AC1 saving a draft is not a submission, so nothing is sent', async () => {
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} onSaved={onSaved} />);

    fillCoreDetails();
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(eventWrite()).toMatchObject({ status: 'DRAFT' });
    expect(received()).toHaveLength(0);
  });

  test('TC-2136 J2 AC1 answering a clarification is not a new submission, so nothing is sent', async () => {
    const onSaved = jest.fn();
    const draft = { id: 'event-123', status: 'UNDER_REVIEW', reference_no: 'EVT-100234', name: 'Q4 Partner Summit', open_clarification_id: 'CLR-001' };
    render(<EventRequestForm user={USER} draft={draft} onSaved={onSaved} />);

    await userEvent.click(await screen.findByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(received()).toHaveLength(0);
  });

  test('TC-2137 J2 AC1 if the notice cannot be written the request is still reported as submitted, not failed', async () => {
    setDoc.mockImplementation(async (ref) => { if (ref?.path?.startsWith('notifications/')) throw new Error('permission-denied'); });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} onSaved={onSaved} />);

    fillValidRequest();
    await submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0][0]).toMatch(/submitted for coordinator review/);
    expect(screen.queryByText(/could not save your event request/i)).not.toBeInTheDocument();
    console.error.mockRestore();
  });

  test('TC-2252 J8 SCRUM-191 submitting tells every active Event Coordinator Lead the request is unassigned', async () => {
    firestore.query.mockImplementation((source) => source);
    getDocs.mockImplementation(async (name) => (name === 'users'
      ? { docs: [
        { id: 'lead-1', data: () => ({ role: 'EVENT_COORDINATOR_LEAD', is_active: true }) },
        { id: 'lead-2', data: () => ({ role: 'EVENT_COORDINATOR_LEAD', is_active: false }) }
      ] }
      : { docs: [] }));
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'Nadia Organiser' }) });
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);
    fillValidRequest();
    await submit();

    await waitFor(() => expect(setDoc.mock.calls.filter(([, data]) => data?.type === 'UNASSIGNED_EVENT')).toHaveLength(1));
    const [, data] = setDoc.mock.calls.find(([, item]) => item?.type === 'UNASSIGNED_EVENT');
    expect(data.user_id).toBe('lead-1');
    expect(data.message).toContain('Q4 Partner Summit');
    expect(data.message).toContain('Nadia Organiser');
    expect(data.message).toContain(EVENT_DAY);
    expect(data.link_screen).toBe('Unassigned queue');
  });
});

// B2 / B3 / B4 / B5 / B6 / J8 — a saved draft coming back with every section, the
// sections being put away again, and the reads and writes that can fail.
describe('drafts reloaded, sections cleared and failures on the request form', () => {
  const row = (id, data) => ({ id, ref: `ref/${id}`, data: () => data });
  const savedDraft = {
    id: 'd1', status: 'DRAFT', reference_no: 'EVT-D1', name: 'Saved summit', purpose: 'Partners', description: 'Kept',
    event_date: EVENT_DAY, start_time: '09:00', end_time: '17:00', expected_attendance: 120,
    equipment_required: true, registration_required: true, registration_capacity: 100,
    registration_open_date: TODAY, registration_open_time: '09:00', registration_close_date: DAY_BEFORE_EVENT, registration_close_time: '18:00'
  };
  const givenSavedRows = () => {
    firestore.query.mockImplementation((source) => source);
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({
      preferred_location: 'Old campus', required_layout: 'THEATRE', facilities_required: true, accessibility_needed: true, accessibility_notes: 'Ramp'
    }) });
    getDocs.mockImplementation(async (name) => ({
      event_facilities: { docs: [row('f1', { facility_id: 'WIFI' })] },
      event_equipment: { docs: [row('q1', { equipment_type: 'AUDIO', quantity: 2, technical_note: 'Wireless' }), row('q2', { quantity: null })] },
      event_accessibility: { docs: [row('a1', { accessibility_id: 'WHEELCHAIR_ACCESS' })] }
    }[name] || { docs: [] }));
  };

  test('TC-0216 [normal] B6 a saved draft reloads every section, and saving it again replaces the old rows with the current ones', async () => {
    givenSavedRows();
    doc.mockImplementation((_db, name, id) => (name === 'events' ? { id, path: `events/${id}` } : `${name}/${id}`));
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} draft={savedDraft} onSaved={onSaved} />);

    expect(await screen.findByDisplayValue('Saved summit')).toBeInTheDocument();
    expect(screen.getByLabelText(/expected attendance/i)).toHaveValue(120);
    // A location no longer in the list is still shown, not silently dropped.
    expect(screen.getByLabelText(/preferred location or area/i)).toHaveValue('Old campus');
    expect(screen.getByLabelText('WIFI')).toBeChecked();
    expect(screen.getByLabelText('WHEELCHAIR ACCESS')).toBeChecked();
    expect(screen.getByLabelText('Equipment type 1')).toHaveValue('AUDIO');
    expect(screen.getByLabelText('Equipment type 2')).toHaveValue('');
    expect(screen.getByLabelText('Quantity 2')).toHaveValue(null);
    expect(screen.getByLabelText(/registration capacity/i)).toHaveValue(100);

    fireEvent.click(screen.getByLabelText('WIFI'));
    expect(screen.getByLabelText('WIFI')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('WIFI'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove line' })[1]);
    expect(screen.queryByLabelText('Equipment type 2')).not.toBeInTheDocument();
    setField(/additional accessibility notes/i, 'Ramp at the side door');
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(deleteDoc.mock.calls.map(([ref]) => ref)).toEqual(['ref/f1', 'ref/q1', 'ref/q2', 'ref/a1']);
    const written = setDoc.mock.calls.map(([ref]) => ref);
    expect(written).toEqual(expect.arrayContaining(['event_facilities/d1_WIFI', 'event_equipment/d1_0', 'event_accessibility/d1_WHEELCHAIR_ACCESS']));
    expect(written).not.toContain('event_equipment/d1_1');
    expect(setDoc).toHaveBeenCalledWith('event_venue_requirements/d1', expect.objectContaining({ accessibility_notes: 'Ramp at the side door' }));
    expect(updateDoc).toHaveBeenCalledWith({ id: 'd1', path: 'events/d1' }, expect.objectContaining({ registration_capacity: 100, status: 'DRAFT' }));
  });

  test('TC-0207 [boundary] B5 answering No clears what was typed, and Yes with nothing filled saves empty values on a draft', async () => {
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} onSaved={onSaved} />);
    setField(/event name/i, 'Half done');
    answer(QUESTIONS.registration, 'Yes');
    setField(/registration capacity/i, '40');
    answer(QUESTIONS.registration, 'No');
    answer(QUESTIONS.registration, 'Yes');
    expect(screen.getByLabelText(/registration capacity/i)).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(eventWrite()).toMatchObject({
      registration_required: true, registration_capacity: null,
      registration_open_date: null, registration_open_time: null, registration_close_date: null, registration_close_time: null
    });
  });

  test('TC-0217 [failure] B6 a draft whose requirements cannot be read says so, and a form closed before its read answers changes nothing', async () => {
    // A question saved as No comes back answered No, not unanswered.
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ facilities_required: false }) });
    const answeredNo = render(<EventRequestForm user={USER} draft={{ ...savedDraft, equipment_required: false }} onSaved={jest.fn()} />);
    await waitFor(() => expect(within(screen.getByRole('group', { name: QUESTIONS.facilities })).getByRole('radio', { name: 'No' })).toBeChecked());
    expect(within(screen.getByRole('group', { name: QUESTIONS.equipment })).getByRole('radio', { name: 'No' })).toBeChecked();
    answeredNo.unmount();

    jest.spyOn(console, 'error').mockImplementation(() => {});
    getDoc.mockRejectedValueOnce(new Error('unavailable'));
    const { unmount } = render(<EventRequestForm user={USER} draft={savedDraft} onSaved={jest.fn()} />);
    expect(await screen.findByText('We could not load this draft. Please try again.')).toBeInTheDocument();
    unmount();

    let answerRead;
    let refuseRead;
    getDoc.mockReturnValueOnce(new Promise((resolve) => { answerRead = resolve; }));
    const late = render(<EventRequestForm user={USER} draft={savedDraft} onSaved={jest.fn()} />);
    late.unmount();
    answerRead({ exists: () => false, data: () => ({}) });

    getDoc.mockReturnValueOnce(new Promise((resolve, reject) => { refuseRead = reject; }));
    const lateFailure = render(<EventRequestForm user={USER} draft={savedDraft} onSaved={jest.fn()} />);
    lateFailure.unmount();
    refuseRead(new Error('unavailable'));
    await waitFor(() => expect(console.error).toHaveBeenCalledTimes(2));
    console.error.mockRestore();
  });

  test('TC-2253 [boundary] J8 the Leads are told the organiser\'s email when the profile has no name or cannot be found', async () => {
    firestore.query.mockImplementation((source) => source);
    getDocs.mockImplementation(async (name) => (name === 'users'
      ? { docs: [{ id: 'lead-1', data: () => ({ role: 'EVENT_COORDINATOR_LEAD', is_active: true }) }] }
      : { docs: [] }));
    const leadNotice = () => setDoc.mock.calls.filter(([, data]) => data?.type === 'UNASSIGNED_EVENT').map(([, data]) => data.message);

    getDoc.mockResolvedValue({ exists: () => true, data: () => ({}) });
    const first = render(<EventRequestForm user={USER} onSaved={jest.fn()} />);
    fillValidRequest();
    await submit();
    await waitFor(() => expect(leadNotice()).toHaveLength(1));
    expect(leadNotice()[0]).toContain(USER.email);
    first.unmount();

    getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);
    fillValidRequest();
    await submit();
    await waitFor(() => expect(leadNotice()).toHaveLength(2));
    expect(leadNotice()[1]).toContain(USER.email);
  });

  // Migrated from the root test.js B2 / B3, which tested a helper of its own.
  test('TC-0193 [normal] B2 AC1 / B3 AC1 AC2 several facilities and several accessibility needs, plus a note, are all stored on submission', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);
    fillCoreDetails();
    fillVenueRequirements();
    answer(QUESTIONS.facilities, 'Yes');
    ['AIR CONDITIONING', 'TABLES AND CHAIRS', 'WIFI'].forEach((label) => fireEvent.click(screen.getByLabelText(label)));
    answer(QUESTIONS.equipment, 'No');
    answer(QUESTIONS.accessibility, 'Yes');
    ['WHEELCHAIR ACCESS', 'HEARING LOOP'].forEach((label) => fireEvent.click(screen.getByLabelText(label)));
    setField(/additional accessibility notes/i, 'Accessible seating needed');
    await submit();
    await expectAccepted();

    const rows = (prefix) => setDoc.mock.calls.filter(([ref]) => String(ref).startsWith(prefix)).map(([, data]) => data);
    expect(rows('event_facilities/').map((item) => item.facility_id)).toEqual(['AIR_CONDITIONING', 'TABLES_AND_CHAIRS', 'WIFI']);
    expect(rows('event_accessibility/').map((item) => item.accessibility_id)).toEqual(['WHEELCHAIR_ACCESS', 'HEARING_LOOP']);
    expect(rows('event_venue_requirements/')[0]).toMatchObject({
      preferred_location: 'CENTRAL', required_layout: 'THEATRE', facilities_required: true,
      accessibility_needed: true, accessibility_notes: 'Accessible seating needed'
    });
  });

  test('TC-2254 [failure] J8 when the Leads cannot be told, the request is still reported as submitted', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    firestore.query.mockImplementation((source) => source);
    getDocs.mockImplementation(async (name) => {
      if (name === 'users') throw new Error('permission-denied');
      return { docs: [] };
    });
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} onSaved={onSaved} />);
    fillValidRequest();
    await submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0][0]).toMatch(/submitted for coordinator review/);
    expect(console.error).toHaveBeenCalledWith('Could not tell the Event Coordinator Leads:', expect.any(Error));
    console.error.mockRestore();
  });
});
