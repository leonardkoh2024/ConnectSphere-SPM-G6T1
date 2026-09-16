import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventRequestForm from './EventRequestForm';

jest.mock('../../lib/firebase', () => ({ db: {} }));

jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(),
  collection: jest.fn(),
  deleteDoc: jest.fn(),
  doc: jest.fn((...args) => args.join('/')),
  getDoc: jest.fn(),
  getDocs: jest.fn(() => Promise.resolve({ docs: [] })),
  query: jest.fn(),
  serverTimestamp: jest.fn(() => 'server-ts'),
  setDoc: jest.fn(() => Promise.resolve()),
  updateDoc: jest.fn(() => Promise.resolve()),
  where: jest.fn()
}));

describe('the event request form', () => {
  test('allows adding equipment lines and submits valid equipment details', async () => {
    const user = { uid: 'u1' };
    const onSaved = jest.fn();

    const { addDoc, setDoc } = require('firebase/firestore');
    addDoc.mockResolvedValue({ id: 'event-123' });

    render(<EventRequestForm user={user} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText(/event name/i), 'Launch Event');
    await userEvent.type(screen.getByLabelText(/purpose/i), 'Product launch');
    await userEvent.type(screen.getByLabelText(/description/i), 'A launch event for the new release.');
    await userEvent.type(screen.getByLabelText(/expected attendance/i), '180');
    await userEvent.type(screen.getByLabelText(/proposed date/i), '2026-10-15');
    await userEvent.type(screen.getByLabelText(/start time/i), '09:00');
    await userEvent.type(screen.getByLabelText(/end time/i), '17:00');

    expect(screen.getByRole('button', { name: /add equipment line/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /add equipment line/i }));

    await userEvent.type(screen.getByLabelText(/equipment type/i), 'Projector');
    await userEvent.type(screen.getByLabelText(/quantity/i), '2');
    await userEvent.type(screen.getByLabelText(/technical note/i), 'Need HDMI cable adapter.');

    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));

    await waitFor(() => expect(addDoc).toHaveBeenCalled());
    expect(setDoc).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith('Event request submitted for coordinator review.', null);
  });
});
