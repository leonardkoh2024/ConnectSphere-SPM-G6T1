// Epic B — creating an event request.
//
//   B1 / SCRUM-92 "Create an event request with the core details"  → TC-017 … TC-029
//   B1 drafts are judged on what they hold                         → TC-067, TC-068
//   B4 / SCRUM-95 "State the equipment my event needs"             → TC-047
//
// Every case below is written up in docs/test-cases.md with its pre-condition,
// steps and expected result.
//
// Why fireEvent.change rather than userEvent.type for most fields: these tests
// are about the validation rules, and typing a value such as "1.5" or "-5" one
// keystroke at a time leaves the field in intermediate states that say nothing
// about the rule under test. TC-047 still types, so the form is proven to work
// under real keystrokes too.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as firestore from 'firebase/firestore';
import EventRequestForm from './EventRequestForm';

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

const CORE = {
  name: 'Q4 Partner Summit',
  purpose: 'Partner briefing',
  description: 'A full-day briefing for our regional partners.',
  attendance: '180',
  date: EVENT_DAY,
  start: '09:00',
  end: '17:00'
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

const fillEquipmentLine = ({ type = 'Projector', quantity = '2' } = {}) => {
  setField('Equipment type 1', type);
  setField('Quantity 1', quantity);
};

const fillValidRequest = (overrides = {}) => {
  fillCoreDetails(overrides);
  fillEquipmentLine(overrides.equipment);
};

const submit = async () => userEvent.click(screen.getByRole('button', { name: /submit request/i }));

// The write that carries the event itself, as opposed to the history entry that
// follows it into a different collection.
const eventWrite = () => addDoc.mock.calls.find(([name]) => name === 'events')?.[1];

const expectBlocked = (message) => {
  expect(screen.getByRole('alert')).toHaveTextContent(message);
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
    ['event name', { name: '' }],
    ['purpose', { purpose: '' }],
    ['description', { description: '' }],
    ['proposed date', { date: '' }],
    ['start time', { start: '' }],
    ['end time', { end: '' }],
    ['expected attendance', { attendance: '' }]
  ])('TC-018 a request with no %s cannot be submitted', async (_field, missing) => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest(missing);
    await submit();

    expectBlocked('Complete all core event details before submitting.');
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
  test('TC-028 text cannot be entered as an attendance, and the request is refused as incomplete', async () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    fillValidRequest({ attendance: 'many' });
    expect(screen.getByLabelText(/expected attendance/i)).toHaveValue(null);

    await submit();

    expectBlocked('Complete all core event details before submitting.');
  });

  test('TC-029 the date and attendance controls carry their own guards', () => {
    render(<EventRequestForm user={USER} onSaved={jest.fn()} />);

    expect(screen.getByLabelText(/proposed date/i)).toHaveAttribute('min', TODAY);
    expect(screen.getByLabelText(/expected attendance/i)).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText(/expected attendance/i)).toHaveAttribute('min', '1');
    expect(screen.getByLabelText(/expected attendance/i)).toHaveAttribute('step', '1');
  });
});

describe('B1 a draft is judged on what it holds, not on what it is missing (TC-067, TC-068)', () => {
  test('TC-067 an incomplete draft saves without complaint', async () => {
    const onSaved = jest.fn();
    render(<EventRequestForm user={USER} onSaved={onSaved} />);

    setField(/event name/i, 'Ideas for the summit');
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
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
