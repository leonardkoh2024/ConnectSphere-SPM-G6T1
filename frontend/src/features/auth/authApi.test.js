// A1–A3 — what the landing page reads and writes when someone signs in or
// registers. The page's wording is not tested here, only the data access.

import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ROLES } from '../../domain/roles';
import { createAccount, signInToPortal, signOutUser } from './authApi';

jest.mock('../../lib/firebase', () => ({ auth: { name: 'auth' }, db: { name: 'db' } }));
jest.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn()
}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  serverTimestamp: jest.fn()
}));

const profile = (role) => ({ exists: () => role !== undefined, data: () => ({ role }) });

beforeEach(() => {
  doc.mockImplementation((_db, name, id) => `${name}/${id}`);
  serverTimestamp.mockReturnValue('server-ts');
  signInWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u1' } });
  createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u1', email: 'a@example.com' } });
  setDoc.mockResolvedValue();
});

describe('signInToPortal', () => {
  test('A3 an account used on its own portal is let through', async () => {
    getDoc.mockResolvedValue(profile(ROLES.ATTENDEE));
    await expect(signInToPortal({ email: 'a@example.com', password: 'pw', portal: 'individual' }))
      .resolves.toEqual({ portalMatches: true });
    expect(getDoc).toHaveBeenCalledWith('users/u1');
  });

  test('A3 a staff account used on the attendee portal does not match', async () => {
    getDoc.mockResolvedValue(profile(ROLES.COORDINATOR));
    await expect(signInToPortal({ email: 'a@example.com', password: 'pw', portal: 'individual' }))
      .resolves.toEqual({ portalMatches: false });
  });

  test('A3 an account with no profile matches no portal', async () => {
    getDoc.mockResolvedValue(profile(undefined));
    await expect(signInToPortal({ email: 'a@example.com', password: 'pw', portal: 'corporate' }))
      .resolves.toEqual({ portalMatches: false });
  });

  test('A3 a wrong password is passed back to the page to word', async () => {
    signInWithEmailAndPassword.mockRejectedValue(Object.assign(new Error('bad'), { code: 'auth/wrong-password' }));
    await expect(signInToPortal({ email: 'a@example.com', password: 'pw', portal: 'corporate' })).rejects.toThrow('bad');
    expect(getDoc).not.toHaveBeenCalled();
  });

  test('signOutUser ends the Firebase session', async () => {
    await signOutUser();
    expect(signOut).toHaveBeenCalledWith({ name: 'auth' });
  });
});

describe('createAccount', () => {
  const details = {
    email: 'a@example.com', password: 'pw', name: '  Ana Lim ', organisationName: ' Acme ',
    mobileNumber: ' 91234567 ', preferredContactMethod: 'EMAIL'
  };

  test('A1 the corporate portal creates an Event Organiser, trimmed', async () => {
    await createAccount({ ...details, isCorporate: true });
    expect(setDoc).toHaveBeenCalledWith('users/u1', expect.objectContaining({
      user_id: 'u1', name: 'Ana Lim', email: 'a@example.com', role: ROLES.ORGANISER,
      organisation_name: 'Acme', mobile_number: '91234567', is_active: true
    }));
  });

  test('A2 the individual portal creates an Attendee with no organisation', async () => {
    await createAccount({ ...details, isCorporate: false });
    expect(setDoc).toHaveBeenCalledWith('users/u1', expect.objectContaining({
      role: ROLES.ATTENDEE, organisation_name: null
    }));
  });
});
