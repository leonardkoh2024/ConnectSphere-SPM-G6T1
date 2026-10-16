import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { ROLES } from '../domain/roles';
import { isStaffEmail, isStrongPassword, isValidMobileNumber, passwordChecks, resolveRole } from '../domain/accounts';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getDoc } from 'firebase/firestore';

// Firebase is stubbed so the tests exercise our own routing and role logic
// without touching a real project. onAuthStateChanged reports a signed-out user.
jest.mock('../lib/firebase', () => ({ auth: {}, db: {} }));

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn((_auth, callback) => {
    callback(null);
    return () => {};
  }),
  signOut: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn()
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(() => Promise.resolve({ exists: () => false })),
  setDoc: jest.fn(),
  serverTimestamp: jest.fn()
}));

jest.mock('./Workspace', () => ({
  __esModule: true,
  default: ({ role }) => require('react').createElement('p', null, `Workspace role: ${role}`)
}));

beforeEach(() => {
  onAuthStateChanged.mockImplementation((_auth, callback) => {
    callback(null);
    return () => {};
  });
  getDoc.mockResolvedValue({ exists: () => false });
  signInWithEmailAndPassword.mockReset();
  signOut.mockReset();
});

describe('landing page', () => {
  test('a visitor who is not signed in lands on the log in chooser', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: /choose how you log in/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /individuals/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /corporate/i })).toBeInTheDocument();
  });

  test('the individual portal is selected by default', () => {
    render(<App />);

    expect(screen.getByRole('tab', { name: /individuals/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test.each([
    [/attendee log in/i, /individual account sign-in/i],
    [/staff log in/i, /corporate account sign-in/i]
  ])('the %s header link opens its login form from registration', async (linkName, formName) => {
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /create an account/i }));
    expect(screen.getByRole('form', { name: /registration/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: linkName }));

    expect(screen.getByRole('form', { name: formName })).toBeInTheDocument();
  });

  test('the eye button shows and hides the password', async () => {
    render(<App />);
    const input = screen.getByLabelText(/^password$/i);
    await userEvent.type(input, 'secret');
    expect(input).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /hide password/i })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(input).toHaveAttribute('type', 'password');
  });

  test('registering, each password rule is ticked off as it is typed', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /create an account/i }));
    const rule = (name) => screen.getByText(name).closest('li');
    const input = screen.getByLabelText(/^password$/i);

    // Nothing typed yet: neither met nor flagged.
    expect(rule('At least 12 characters')).not.toHaveClass('cs-password-check-met');
    expect(rule('At least 12 characters')).not.toHaveClass('cs-password-check-unmet');

    await userEvent.type(input, 'abc1');
    expect(rule('One number')).toHaveClass('cs-password-check-met');
    expect(rule('One special character')).toHaveClass('cs-password-check-unmet');
    expect(rule('At least 12 characters')).toHaveClass('cs-password-check-unmet');

    await userEvent.type(input, 'defghijk!');
    expect(rule('One special character')).toHaveClass('cs-password-check-met');
    expect(rule('At least 12 characters')).toHaveClass('cs-password-check-met');
  });

  test('registering, the confirm field says whether the passwords match', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /create an account/i }));
    await userEvent.type(screen.getByLabelText(/^password$/i), 'SecurePassword1!');
    expect(screen.queryByText('Passwords match')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^confirm password$/i), 'Secure');
    expect(screen.getByText('Passwords match').closest('li')).toHaveClass('cs-password-check-unmet');

    await userEvent.type(screen.getByLabelText(/^confirm password$/i), 'Password1!');
    expect(screen.getByText('Passwords match').closest('li')).toHaveClass('cs-password-check-met');
  });

  test('signing in does not show the password rules', () => {
    render(<App />);
    expect(screen.queryByText('At least 12 characters')).not.toBeInTheDocument();
  });

  // The role is still resolved from the work email (see resolveRole below); it is
  // just no longer previewed on the sign-in form.
  test('the corporate sign-in form does not preview a role', async () => {
    render(<App />);

    await userEvent.click(screen.getByRole('tab', { name: /corporate/i }));
    await userEvent.type(
      screen.getByLabelText(/^email$/i),
      'amir.coordinator@connectsphere.com'
    );

    expect(screen.queryByText(/detected role/i)).not.toBeInTheDocument();
  });

  test('Technical Support staff can sign in with valid credentials through the corporate portal', async () => {
    signInWithEmailAndPassword.mockResolvedValue({ user: { uid: 'tech-support-1' } });
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ role: ROLES.TECH_SUPPORT })
    });
    render(<App />);

    await userEvent.click(screen.getByRole('tab', { name: /corporate/i }));
    await userEvent.type(screen.getByLabelText(/^email$/i), 'tech.support@connectsphere.com');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'ValidTestPassword1!');
    await userEvent.click(screen.getByRole('button', { name: /log in to corporate account/i }));

    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      'tech.support@connectsphere.com',
      'ValidTestPassword1!'
    ));
    await waitFor(() => expect(getDoc).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  test('an authenticated Technical Support profile is routed to its own workspace role', async () => {
    onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback({ uid: 'tech-support-1' });
      return () => {};
    });
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ role: ROLES.TECH_SUPPORT })
    });

    render(<App />);

    expect(await screen.findByText(`Workspace role: ${ROLES.TECH_SUPPORT}`)).toBeInTheDocument();
  });

  // A7 / SCRUM-170 AC1 — TC-378. A seeded Safety Officer signs in to their own workspace.
  test('TC-378 a seeded Safety Officer profile is routed to the Safety Officer workspace', async () => {
    onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback({ uid: 'safety-officer-1' });
      return () => {};
    });
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: ROLES.SAFETY_OFFICER }) });

    render(<App />);

    expect(await screen.findByText(`Workspace role: ${ROLES.SAFETY_OFFICER}`)).toBeInTheDocument();
  });
});

describe('resolveRole', () => {
  test.each([
    ['nadia.organiser@connectsphere.com', ROLES.ORGANISER],
    ['amir.coordinator@connectsphere.com', ROLES.COORDINATOR],
    ['venue.team@connectsphere.com', ROLES.VENUE_STAFF],
    ['tech.support@connectsphere.com', ROLES.TECH_SUPPORT]
  ])('%s becomes %s on the corporate portal', (email, expected) => {
    expect(resolveRole(email, 'corporate')).toBe(expected);
  });

  test('an unrecognised staff mailbox falls back to the least privileged staff role', () => {
    expect(resolveRole('j.tan@connectsphere.com', 'corporate')).toBe(
      ROLES.ORGANISER
    );
  });

  test('the individual portal is always an attendee, even with a staff email', () => {
    expect(resolveRole('amir.coordinator@connectsphere.com', 'individual')).toBe(
      ROLES.ATTENDEE
    );
    expect(resolveRole('priya@gmail.com', 'individual')).toBe(ROLES.ATTENDEE);
  });

  test('a company domain cannot set a role on its own', () => {
    expect(resolveRole('j.tan@venueco.com', 'corporate')).not.toBe(
      ROLES.VENUE_STAFF
    );
  });

  // A6 AC1 — the Event Coordinator Lead is appointed, not created from a mailbox
  // name, so there is no public sign-up that lands anyone in the Lead role. Even an
  // email that advertises "lead" resolves to an ordinary staff role.
  test('A6-TC8 AC1 the Coordinator Lead cannot be self-provisioned from a work email', () => {
    expect(resolveRole('coordinator.lead@connectsphere.com', 'corporate')).toBe(
      ROLES.COORDINATOR
    );
    expect(resolveRole('team.lead@connectsphere.com', 'corporate')).toBe(
      ROLES.ORGANISER
    );
  });

  // A7 AC1 — TC-379. Likewise the Safety Officer: seeded, never self-provisioned.
  test('TC-379 the Safety Officer cannot be self-provisioned from a work email', () => {
    ['safety.officer@connectsphere.com', 'safety@connectsphere.com', 'officer@connectsphere.com'].forEach((email) => {
      expect(resolveRole(email, 'corporate')).not.toBe(ROLES.SAFETY_OFFICER);
      expect(resolveRole(email, 'individual')).toBe(ROLES.ATTENDEE);
    });
  });
});

describe('isStaffEmail', () => {
  test('only approved domains may hold a corporate account', () => {
    expect(isStaffEmail('venue.team@connectsphere.com')).toBe(true);
    expect(isStaffEmail('venue.team@gmail.com')).toBe(false);
  });
});

describe('isStrongPassword', () => {
  test('requires 12 characters, a number and a special character', () => {
    expect(isStrongPassword('TwelveChars!')).toBe(false);
    expect(isStrongPassword('TwelveChars12')).toBe(false);
    expect(isStrongPassword('SecurePassword1!')).toBe(true);
  });
});

describe('passwordChecks', () => {
  test('reports each rule separately, in a fixed order', () => {
    expect(passwordChecks('abc1').map(({ id, met }) => [id, met])).toEqual([
      ['length', false],
      ['number', true],
      ['special', false]
    ]);
  });

  test('agrees with isStrongPassword', () => {
    ['', 'TwelveChars!', 'TwelveChars12', 'SecurePassword1!'].forEach((password) => {
      expect(passwordChecks(password).every((check) => check.met)).toBe(isStrongPassword(password));
    });
  });
});

describe('isValidMobileNumber', () => {
  test('accepts a mobile number below the 15-digit maximum', () => {
    expect(isValidMobileNumber('91234567890123')).toBe(true);
  });

  test('accepts a mobile number at the 15-digit maximum', () => {
    expect(isValidMobileNumber('912345678901234')).toBe(true);
  });

  test('rejects a mobile number above the 15-digit maximum', () => {
    expect(isValidMobileNumber('9123456789012345')).toBe(false);
  });

  test('requires 7 to 15 digits and does not allow separators', () => {
    expect(isValidMobileNumber('123456')).toBe(false);
    expect(isValidMobileNumber('+65 9123 4567')).toBe(false);
    expect(isValidMobileNumber('9123456')).toBe(true);
  });
});
