// A1 / SCRUM-82, A2 / SCRUM-83, A3 / SCRUM-84 — the landing page's registration and
// sign-in forms, driven against the real component with Firebase stubbed.
//
// Release 1 needs no account creation (Session 2), but the registration screens are
// still built and merged and their future is an open question in CLAUDE.md, so they
// are tested for as long as they exist.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import LandingPage from './LandingPage';
import { ROLES } from '../../domain/roles';

jest.mock('../../lib/firebase', () => ({ auth: { name: 'auth' }, db: { name: 'db' } }));
jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  signOut: jest.fn()
}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  serverTimestamp: jest.fn()
}));

const STRONG = 'SecurePassword1!';
const DUPLICATE_MESSAGE = 'We could not create an account with those details. Please check them and try again.';
const REGISTER_FAILED = 'We could not sign you in or create your account with those details. Please check them and try again.';
const SIGN_IN_FAILED = 'We could not sign you in with those details. Please check them and try again.';
const WRONG_PORTAL = 'This account cannot be used in this portal. Please use the correct sign-in area.';

// CRA resets mocks before each test, so the implementations are set here.
beforeEach(() => {
  sessionStorage.clear();
  doc.mockImplementation((_db, collection, id) => ({ path: `${collection}/${id}` }));
  serverTimestamp.mockReturnValue('SERVER_TIME');
  setDoc.mockResolvedValue();
  signOut.mockResolvedValue();
  createUserWithEmailAndPassword.mockImplementation((_auth, email) => Promise.resolve({ user: { uid: 'new-user', email } }));
  signInWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u1' } });
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: ROLES.ORGANISER }) });
});

const form = () => screen.getByRole('form');
const chooseCorporate = () => userEvent.click(screen.getByRole('tab', { name: /corporate/i }));
const openRegistration = () => userEvent.click(screen.getByRole('button', { name: /create an account/i }));

// Fills every registration field; `skip` leaves the named ones untouched. Set in one
// change each rather than typed key by key, which keeps the suite fast.
const set = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const fillRegistration = ({ corporate = false, skip = [], values = {} } = {}) => {
  const value = {
    name: 'Alice Tan', organisation: 'ABC Events', mobile: '91234567', email: 'alice@example.com',
    password: STRONG, confirm: STRONG, ...values
  };
  if (!skip.includes('name')) set('Full name', value.name);
  if (corporate && !skip.includes('organisation')) set('Organisation name', value.organisation);
  if (!skip.includes('mobile')) set('Mobile number', value.mobile);
  if (!skip.includes('email')) set(/^email$/i, value.email);
  if (!skip.includes('password')) set(/^password$/i, value.password);
  if (!skip.includes('confirm')) set(/^confirm password$/i, value.confirm);
};

// The inputs are `required`, which a browser enforces before submit; submitting the
// form directly is what reaches the component's own checks behind them.
const submitForm = () => act(async () => { fireEvent.submit(form()); });

const signIn = async ({ email = 'nadia@example.com', password = STRONG } = {}) => {
  set(/^email$/i, email);
  set(/^password$/i, password);
  await userEvent.click(screen.getByRole('button', { name: /^log in to/i }));
};

describe('A1 / A2 registration', () => {
  describe('normal', () => {
    test('TC-0010 A1 AC1 AC2 a corporate registration stores every organiser detail with the organiser role only', async () => {
      render(<LandingPage />);
      await chooseCorporate();
      await openRegistration();
      fillRegistration({ corporate: true, values: { name: '  Alice Tan  ', organisation: ' ABC Events ' } });
      await userEvent.selectOptions(screen.getByLabelText('Preferred contact method'), 'MOBILE');
      await userEvent.click(screen.getByRole('button', { name: 'Create event organiser account' }));

      await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1));
      expect(createUserWithEmailAndPassword).toHaveBeenCalledWith({ name: 'auth' }, 'alice@example.com', STRONG);
      expect(doc).toHaveBeenCalledWith({ name: 'db' }, 'users', 'new-user');
      expect(setDoc).toHaveBeenCalledWith({ path: 'users/new-user' }, {
        user_id: 'new-user',
        name: 'Alice Tan',
        email: 'alice@example.com',
        role: ROLES.ORGANISER,
        organisation_name: 'ABC Events',
        mobile_number: '91234567',
        preferred_contact_method: 'MOBILE',
        is_active: true,
        created_at: 'SERVER_TIME',
        updated_at: 'SERVER_TIME'
      });
    });

    test('TC-0011 A1 AC4 the new organiser is signed in at once, with no approval step, and is told so', async () => {
      render(<LandingPage />);
      await chooseCorporate();
      await openRegistration();
      fillRegistration({ corporate: true });
      await userEvent.click(screen.getByRole('button', { name: 'Create event organiser account' }));

      expect(await screen.findByRole('status')).toHaveTextContent('Your account has been created. You are now signed in.');
      // The workspace picks this up as its first toast once the auth gate opens it.
      expect(sessionStorage.getItem('cs-account-created')).toBe('Your account has been created successfully.');
      expect(signOut).not.toHaveBeenCalled();
    });

    test('TC-0023 A2 AC1 AC4 AC5 an attendee registration stores the attendee role and no organisation', async () => {
      render(<LandingPage />);
      await openRegistration();
      expect(screen.queryByLabelText('Organisation name')).not.toBeInTheDocument();
      fillRegistration();
      await userEvent.click(screen.getByRole('button', { name: 'Create attendee account' }));

      await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1));
      expect(setDoc.mock.calls[0][1]).toMatchObject({
        role: ROLES.ATTENDEE, organisation_name: null, preferred_contact_method: 'EMAIL', mobile_number: '91234567'
      });
      expect(await screen.findByRole('status')).toHaveTextContent(/account has been created/);
    });

    test('TC-0012 the hint under the form follows the portal and the mode', async () => {
      render(<LandingPage />);
      expect(screen.queryByText(/approved ConnectSphere email domain/)).not.toBeInTheDocument();

      await chooseCorporate();
      expect(screen.getByText('Staff accounts must use an approved ConnectSphere email domain.')).toBeInTheDocument();

      await openRegistration();
      expect(screen.getByText(/Self-registration creates an Event Organiser account/)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Log in instead' }));
      expect(screen.getByRole('form', { name: 'Corporate account sign-in' })).toBeInTheDocument();
    });
  });

  describe('boundary', () => {
    test('TC-0013 A1 the mobile number keeps digits only, so separators typed in are dropped', async () => {
      render(<LandingPage />);
      await openRegistration();
      await userEvent.type(screen.getByLabelText('Mobile number'), '+65 9123-4567');

      expect(screen.getByLabelText('Mobile number')).toHaveValue('6591234567');
    });

    test('TC-0014 A1 AC1 a six-digit mobile number is one short and is refused', async () => {
      render(<LandingPage />);
      await openRegistration();
      fillRegistration({ values: { mobile: '123456' } });
      await submitForm();

      expect(screen.getByRole('alert')).toHaveTextContent('Enter a mobile number containing between 7 and 15 digits.');
      expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
    });

    test('TC-0024 A2 AC8 an 11-character password is one short and is refused; 12 is accepted', async () => {
      render(<LandingPage />);
      await openRegistration();
      fillRegistration({ values: { password: 'PassWord1!a', confirm: 'PassWord1!a' } });
      await submitForm();

      expect(screen.getByRole('alert')).toHaveTextContent('Choose a password with at least 12 characters, including a number and special character.');
      expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();

      set(/^password$/i, 'PassWord1!ab');
      set(/^confirm password$/i, 'PassWord1!ab');
      await submitForm();
      expect(createUserWithEmailAndPassword).toHaveBeenCalledWith({ name: 'auth' }, 'alice@example.com', 'PassWord1!ab');
    });

    test('TC-0015 a name of spaces only counts as no name', async () => {
      render(<LandingPage />);
      await openRegistration();
      fillRegistration({ values: { name: '   ' } });
      await submitForm();

      expect(screen.getByRole('alert')).toHaveTextContent('Enter your full name to create an account.');
    });

    test('TC-0016 the button says it is working while the account is being created, and cannot be pressed twice', async () => {
      let finish;
      createUserWithEmailAndPassword.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      render(<LandingPage />);
      await openRegistration();
      fillRegistration();
      await userEvent.click(screen.getByRole('button', { name: 'Create attendee account' }));

      expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
      await act(async () => { finish({ user: { uid: 'new-user', email: 'alice@example.com' } }); });
      expect(screen.getByRole('button', { name: 'Create attendee account' })).toBeEnabled();
    });
  });

  describe('conflict', () => {
    test('TC-0017 A1 AC3 / A2 AC7 an email already in use is refused without saying the account exists or its role', async () => {
      createUserWithEmailAndPassword.mockRejectedValue({ code: 'auth/email-already-in-use' });
      render(<LandingPage />);
      await chooseCorporate();
      await openRegistration();
      fillRegistration({ corporate: true });
      await userEvent.click(screen.getByRole('button', { name: 'Create event organiser account' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(DUPLICATE_MESSAGE);
      expect(alert.textContent).not.toMatch(/already|exists|organiser|attendee|role/i);
      expect(setDoc).not.toHaveBeenCalled();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('failure', () => {
    test.each([
      ['name', false, 'Enter your full name to create an account.'],
      ['organisation', true, 'Enter your organisation name to create an organiser account.'],
      ['mobile', false, 'Enter your mobile number and preferred contact method to create an account.']
    ])('TC-0018 A1 AC1 / A2 AC6 a missing %s blocks the registration with its own message', async (field, corporate, message) => {
      render(<LandingPage />);
      if (corporate) await chooseCorporate();
      await openRegistration();
      fillRegistration({ corporate, skip: [field] });
      await submitForm();

      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
    });

    test('TC-0025 A2 AC6 a missing preferred contact method blocks the registration', async () => {
      render(<LandingPage />);
      await openRegistration();
      fillRegistration();
      fireEvent.change(screen.getByLabelText('Preferred contact method'), { target: { value: '' } });
      await submitForm();

      expect(screen.getByRole('alert')).toHaveTextContent('Enter your mobile number and preferred contact method to create an account.');
      expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
    });

    test('TC-0026 A2 AC8 a password without a number or special character is refused', async () => {
      render(<LandingPage />);
      await openRegistration();
      fillRegistration({ values: { password: 'Password!abcde', confirm: 'Password!abcde' } });
      await submitForm();

      expect(screen.getByRole('alert')).toHaveTextContent(/at least 12 characters, including a number and special character/);
      expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
    });

    test('TC-0019 A1 passwords that do not match are refused', async () => {
      render(<LandingPage />);
      await openRegistration();
      fillRegistration({ values: { confirm: 'SecurePassword1?' } });
      await submitForm();

      expect(screen.getByRole('alert')).toHaveTextContent('Your passwords do not match.');
      expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
    });

    test('TC-0020 any other failure creating the account gives the generic message, not the cause', async () => {
      createUserWithEmailAndPassword.mockRejectedValue({ code: 'auth/network-request-failed' });
      render(<LandingPage />);
      await openRegistration();
      fillRegistration();
      await userEvent.click(screen.getByRole('button', { name: 'Create attendee account' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(REGISTER_FAILED);
      expect(screen.getByRole('button', { name: 'Create attendee account' })).toBeEnabled();
    });

    test('TC-0021 a profile that cannot be saved is reported, and no success is claimed', async () => {
      setDoc.mockRejectedValue(new Error('permission-denied'));
      render(<LandingPage />);
      await openRegistration();
      fillRegistration();
      await userEvent.click(screen.getByRole('button', { name: 'Create attendee account' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(REGISTER_FAILED);
      expect(sessionStorage.getItem('cs-account-created')).toBeNull();
    });
  });
});

describe('A3 sign in', () => {
  describe('normal', () => {
    test('TC-0029 A3 AC1 an organiser signs in through the corporate portal and stays signed in', async () => {
      render(<LandingPage />);
      await chooseCorporate();
      await signIn();

      await waitFor(() => expect(getDoc).toHaveBeenCalledWith({ path: 'users/u1' }));
      expect(signInWithEmailAndPassword).toHaveBeenCalledWith({ name: 'auth' }, 'nadia@example.com', STRONG);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(signOut).not.toHaveBeenCalled();
    });

    test('TC-0030 A3 AC1 an attendee signs in through the individual portal', async () => {
      getDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: ROLES.ATTENDEE }) });
      render(<LandingPage />);
      await signIn();

      await waitFor(() => expect(getDoc).toHaveBeenCalled());
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(signOut).not.toHaveBeenCalled();
    });

    test('TC-0031 switching portal clears an earlier error', async () => {
      signInWithEmailAndPassword.mockRejectedValue({ code: 'auth/invalid-credential' });
      render(<LandingPage />);
      await signIn();
      expect(await screen.findByRole('alert')).toBeInTheDocument();

      await chooseCorporate();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('conflict', () => {
    test.each([
      ['an organiser on the individual portal', ROLES.ORGANISER, false],
      ['an attendee on the corporate portal', ROLES.ATTENDEE, true],
      ['a Safety Officer on the individual portal', ROLES.SAFETY_OFFICER, false]
    ])('TC-0032 A3 %s is refused and the session just started is ended', async (_name, role, corporate) => {
      getDoc.mockResolvedValue({ exists: () => true, data: () => ({ role }) });
      render(<LandingPage />);
      if (corporate) await chooseCorporate();
      await signIn();

      expect(await screen.findByRole('alert')).toHaveTextContent(WRONG_PORTAL);
      expect(signOut).toHaveBeenCalledWith({ name: 'auth' });
      // Kept for the landing page that the auth gate shows again after signing out.
      expect(sessionStorage.getItem('cs-login-error')).toBe(WRONG_PORTAL);
    });

    test('TC-0033 an account with no stored profile belongs to no portal, so it is refused too', async () => {
      getDoc.mockResolvedValue({ exists: () => false });
      render(<LandingPage />);
      await chooseCorporate();
      await signIn();

      expect(await screen.findByRole('alert')).toHaveTextContent(WRONG_PORTAL);
      expect(signOut).toHaveBeenCalled();
    });

    test('TC-0034 the wrong-portal message is shown once on the next landing page, then cleared', () => {
      sessionStorage.setItem('cs-login-error', WRONG_PORTAL);
      const { unmount } = render(<LandingPage />);

      expect(screen.getByRole('alert')).toHaveTextContent(WRONG_PORTAL);
      expect(sessionStorage.getItem('cs-login-error')).toBeNull();
      unmount();

      render(<LandingPage />);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('failure', () => {
    test('TC-0035 A3 AC2 a wrong email or password gets one generic message that discloses nothing', async () => {
      signInWithEmailAndPassword.mockRejectedValue({ code: 'auth/user-not-found' });
      render(<LandingPage />);
      await chooseCorporate();
      await signIn();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(SIGN_IN_FAILED);
      expect(alert.textContent).not.toMatch(/exist|not found|registered|role/i);
      expect(getDoc).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Log in to corporate account' })).toBeEnabled();
    });

    test('TC-0036 a profile that cannot be read after signing in gives the same generic message', async () => {
      getDoc.mockRejectedValue(new Error('unavailable'));
      render(<LandingPage />);
      await signIn();

      expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_IN_FAILED);
    });
  });
});

describe('the rest of the page', () => {
  test('TC-0022 both header links lead to sign-in on their own portal', async () => {
    render(<LandingPage />);
    const header = screen.getByRole('banner');

    await userEvent.click(within(header).getByRole('link', { name: 'Staff log in' }));
    expect(screen.getByRole('tab', { name: /corporate/i })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(within(header).getByRole('link', { name: 'Attendee log in' }));
    expect(screen.getByRole('tab', { name: /individuals/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('form', { name: 'Individual account sign-in' })).toBeInTheDocument();
  });
});
