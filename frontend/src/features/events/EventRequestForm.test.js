// Epic B — creating and submitting an event request.
//
//   B1 / SCRUM-92  "Create an event request with the core details"  → TC-017 … TC-029
//   B9 / SCRUM-100 "Submit an event request"                        → TC-030 … TC-046,
//                                                                      TC-064 … TC-066
//   B1 drafts are checked on what they hold                           → TC-067, TC-068
//   B4 / SCRUM-95  "State the equipment my event needs"             → TC-047
//
// Every case below is written up in docs/test-cases.md with its pre-condition,
// steps and expected result.
//
// Why fireEvent.change rather than userEvent.type for most fields: these tests
// are about the validation rules, and typing a value such as "1.5" or "-5" one
// keystroke at a time leaves the field in intermediate states that say nothing
// about the rule under test. TC-047 still types, so the form is proven to work
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
  location: 'Level 3 atrium, east wing',
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

const fillEquipmentLine = ({ type = 'Projector', quantity = '2' } = {}) => {
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

describe('B1 core details are captured (TC-017, TC-018)', () => {
  test('TC-017 a request carries all seven core details, its creator and its creation time', async () => {
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
  ])('TC-018 a request with no %s cannot be submitted, and that field is the one named', async (label, missing) => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest(missing);
    await submit();

    expectBlocked(`${label} is required.`);
    expect(listedProblems()).toHaveLength(1);
  });
});

describe('B1 the event must end after it starts (TC-019, TC-020, TC-021)', () => {
  test('TC-019 an end time one minute after the start is accepted', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ start: '09:00', end: '09:01' });
    await submit();

    await expectAccepted();
    expect(eventWrite()).toMatchObject({ start_time: '09:00', end_time: '09:01' });
  });

  test('TC-020 an end time earlier than the start is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ start: '09:00', end: '08:00' });
    await submit();

    expectBlocked('End time must be later than start time.');
  });

  test('TC-021 an end time equal to the start is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ start: '09:00', end: '09:00' });
    await submit();

    expectBlocked('End time must be later than start time.');
  });
});

describe('B1 the proposed date may not be in the past (TC-022, TC-023)', () => {
  test('TC-022 today is the earliest date accepted', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ date: TODAY });
    await submit();

    await expectAccepted();
    expect(eventWrite()).toMatchObject({ event_date: TODAY });
  });

  test('TC-023 yesterday is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ date: YESTERDAY });
    await submit();

    expectBlocked('The proposed event date cannot be in the past.');
  });
});

describe('B1 expected attendance is a whole number greater than zero (TC-024 … TC-029)', () => {
  test('TC-024 an attendance of 1 is accepted and stored as a number', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ attendance: '1' });
    await submit();

    await expectAccepted();
    expect(eventWrite()).toMatchObject({ expected_attendance: 1 });
  });

  test.each([
    ['TC-025', 'zero', '0'],
    ['TC-026', 'a negative number', '-5'],
    ['TC-027', 'a fraction', '1.5']
  ])('%s an attendance of %s is refused', async (_id, _label, attendance) => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ attendance });
    await submit();

    expectBlocked('Expected attendance must be a whole number greater than zero.');
  });

  // Text never reaches the rule: a number input discards a value that is not a
  // number, so the field arrives at validation empty and is refused as missing.
  // Worth pinning down, because it is why the organiser sees the missing-detail
  // message rather than the whole-number one after typing "many".
  test('TC-028 text cannot be entered as an attendance, and the request is refused as incomplete', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ attendance: 'many' });
    expect(screen.getByLabelText(/expected attendance/i)).toHaveValue(null);

    await submit();

    expectBlocked('Expected attendance is required.');
  });

  test('TC-029 the date and attendance controls carry their own guards', () => {
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

describe('B9 a complete request is submitted (TC-030, TC-031)', () => {
  test('TC-030 submission records the request as Submitted, with a reference number and a submission time', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest();
    await submit();

    await waitFor(() => expect(eventWrite()).toBeDefined());
    expect(eventWrite()).toMatchObject({ status: 'SUBMITTED', submitted_at: 'server-ts' });
    expect(eventWrite().reference_no).toMatch(/^EVT-[0-9A-Z]{6}-[0-9A-Z]{5}$/);
    await waitFor(() => expect(historyWrite()).toMatchObject({ action_type: 'EVENT_SUBMITTED', actor_id: 'u1' }));
  });

  test('TC-031 the confirmation names the reference number the request was given', async () => {
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
});

describe('B9 an incomplete request is not submitted (TC-032, TC-033)', () => {
  test('TC-032 an empty form writes nothing at all, and every unanswered field is named', async () => {
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

  test('TC-033 the values already entered stay on screen so they can be corrected', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ attendance: '0' });
    await submit();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText(/event name/i)).toHaveValue(CORE.name);
    expect(screen.getByLabelText(/purpose/i)).toHaveValue(CORE.purpose);
    expect(screen.getByLabelText(/proposed date/i)).toHaveValue(CORE.date);
    expect(screen.getByLabelText('Equipment type 1')).toHaveValue('Projector');
  });
});

describe('B9 equipment must be answered before submission (TC-034, TC-035, TC-036)', () => {
  test('TC-034 answering Yes and then adding no equipment line is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillCoreDetails();
    fillVenueRequirements();
    answer(QUESTIONS.facilities, 'No');
    answer(QUESTIONS.accessibility, 'No');
    answer(QUESTIONS.equipment, 'Yes');
    await submit();

    expectBlocked('Add at least one equipment line, or answer No above.');
  });

  test('TC-069 answering No puts the equipment fields away and stores the decision', async () => {
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

  test('TC-035 an equipment quantity of zero is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ equipment: { quantity: '0' } });
    await submit();

    expectBlocked('Equipment quantity 1 must be a whole number greater than zero.');
  });

  test('TC-036 an equipment quantity of one is accepted', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ equipment: { quantity: '1' } });
    await submit();

    await expectAccepted();
    expect(setDoc).toHaveBeenCalledWith(
      'event_equipment/event-123_0',
      expect.objectContaining({ equipment_type: 'Projector', quantity: 1 })
    );
  });
});

describe('B9 registration details are consistent with the event (TC-037 … TC-040)', () => {
  const enableRegistration = ({ capacity, openDate = TODAY, openTime = '09:00', closeDate = DAY_BEFORE_EVENT, closeTime = '17:00' }) => {
    answer(QUESTIONS.registration, 'Yes');
    setField(/registration capacity/i, capacity);
    setField(/registration open date/i, openDate);
    setField(/registration open time/i, openTime);
    setField(/registration close date/i, closeDate);
    setField(/registration close time/i, closeTime);
  };

  test('TC-037 a capacity equal to the expected attendance is accepted', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ attendance: '180' });
    enableRegistration({ capacity: '180' });
    await submit();

    await expectAccepted();
    expect(eventWrite()).toMatchObject({ registration_required: true, registration_capacity: 180 });
  });

  test('TC-038 a capacity above the expected attendance is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ attendance: '180' });
    enableRegistration({ capacity: '181' });
    await submit();

    expectBlocked('Registration capacity cannot exceed the expected attendance.');
  });

  test('TC-039 registration with no open and close date/time is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest();
    enableRegistration({ capacity: '100', openDate: '', openTime: '', closeDate: '', closeTime: '' });
    await submit();

    expectBlocked('Registration open and close date/time are required when registration is enabled.');
  });

  test('TC-040 registration closing after the event has started is refused', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ date: EVENT_DAY, start: '09:00' });
    enableRegistration({ capacity: '100', closeDate: EVENT_DAY, closeTime: '10:00' });
    await submit();

    expectBlocked('Registration close date/time must be at or before the event start.');
  });
});

describe('B9 a request cannot be submitted twice (TC-041, TC-042)', () => {
  test('TC-041 the form is cleared once the request has gone', async () => {
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} onSaved={onSaved} />);

    fillValidRequest();
    await submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.getByLabelText(/event name/i)).toHaveValue('');
    expect(screen.getByLabelText(/expected attendance/i)).toHaveValue(null);
  });

  test('TC-042 a request that has already been submitted opens read-only, with no Submit action', async () => {
    const draft = { id: 'event-123', status: 'SUBMITTED', reference_no: 'EVT-100234', name: 'Q4 Partner Summit' };
    render(<EventRequestForm user={USER} draft={draft} onSaved={jest.fn()} />);

    expect(await screen.findByText(/this request is no longer editable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit request/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/event name/i)).toHaveAttribute('readonly');
  });
});

describe('B9 the block names exactly the fields that are wrong (TC-043)', () => {
  test('TC-043 three broken fields produce three messages, and nothing else is reported', async () => {
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

describe('B9 venue requirements and accessibility must be answered (TC-044 … TC-046)', () => {
  test('TC-044 a request with no venue requirements is refused, naming both of them', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ location: '', layout: '' });
    await submit();

    expect(listedProblems()).toEqual([
      'Preferred location or area is required.',
      'Required layout is required.'
    ]);
    expect(addDoc).not.toHaveBeenCalled();
  });

  test('TC-045 answering Yes to facilities and choosing none is refused; answering No is accepted', async () => {
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

  test('TC-046 answering Yes to accessibility and choosing none is refused; answering No is accepted', async () => {
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

  test('TC-064 a Yes keeps what was chosen; changing to No clears it rather than submitting it', async () => {
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

describe('B9 the reference number (TC-065, TC-066)', () => {
  test('TC-065 a draft keeps the reference number it was first given when it is submitted', async () => {
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
  test('TC-066 references generated in the same millisecond never repeat', () => {
    const references = Array.from({ length: 2000 }, () => createReferenceNo());

    expect(new Set(references).size).toBe(2000);
    expect(references.every((reference) => /^EVT-[0-9A-Z]{6}-[0-9A-Z]{5}$/.test(reference))).toBe(true);
  });
});

describe('B1 a draft is checked on what it holds, not on what it is missing (TC-067, TC-068)', () => {
  test('TC-067 an incomplete draft saves without complaint', async () => {
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} onSaved={onSaved} />);

    setField(/event name/i, 'Ideas for the summit');
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0][0]).toMatch(/^Draft EVT-[0-9A-Z]{6}-[0-9A-Z]{5} saved\./);
    expect(eventWrite()).toMatchObject({ status: 'DRAFT', name: 'Ideas for the summit' });
  });

  test('TC-068 a draft holding an impossible value is refused, because B1 AC2 is a rule about the value', async () => {
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

describe('B4 equipment lines (TC-047)', () => {
  test('TC-047 an organiser can add a second equipment line and submit both', async () => {
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} onSaved={onSaved} />);

    fillCoreDetails();
    fillVenueRequirements();
    answer(QUESTIONS.facilities, 'No');
    answer(QUESTIONS.accessibility, 'No');
    answer(QUESTIONS.equipment, 'Yes');

    await userEvent.type(screen.getByLabelText('Equipment type 1'), 'Projector');
    await userEvent.type(screen.getByLabelText('Quantity 1'), '2');
    await userEvent.type(screen.getByLabelText('Technical note 1'), 'Need HDMI cable adapter.');

    await userEvent.click(screen.getByRole('button', { name: /add equipment line/i }));
    await userEvent.type(screen.getByLabelText('Equipment type 2'), 'Microphone');
    await userEvent.type(screen.getByLabelText('Quantity 2'), '4');

    await submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(setDoc).toHaveBeenCalledWith('event_equipment/event-123_0', expect.objectContaining({
      equipment_type: 'Projector', quantity: 2, technical_note: 'Need HDMI cable adapter.'
    }));
    expect(setDoc).toHaveBeenCalledWith('event_equipment/event-123_1', expect.objectContaining({
      equipment_type: 'Microphone', quantity: 4, technical_note: null
    }));
  });
});

// ---------------------------------------------------------------------------
// The form tells the organiser which answers are compulsory before they submit
// ---------------------------------------------------------------------------

describe('compulsory questions are marked (TC-070)', () => {
  const marked = (label) => screen.getByText(label).closest('label, fieldset').querySelector('.cs-required') !== null;

  test('TC-070 every compulsory question carries the red marker, and the optional notes do not', () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    ['Event name', 'Purpose', 'Description', 'Proposed date', 'Start time', 'End time', 'Expected attendance',
      'Preferred location or area', 'Required layout'].forEach((label) => expect(marked(label)).toBe(true));

    Object.values(QUESTIONS).forEach((question) => expect(marked(question)).toBe(true));

    expect(marked('Additional accessibility notes')).toBe(false);
  });

  test('TC-070 the form says what the marker means, and the browser is not left to enforce it', () => {
    const { container } = render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    expect(screen.getByText(/compulsory/i)).toBeInTheDocument();
    expect(container.querySelector('form')).toHaveAttribute('novalidate');
  });
});
