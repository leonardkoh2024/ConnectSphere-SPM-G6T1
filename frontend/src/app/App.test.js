import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { ROLES } from '../domain/roles';
import { isStaffEmail, isStrongPassword, isValidMobileNumber, resolveRole } from '../domain/accounts';

// Firebase is stubbed so the tests exercise our own routing and role logic
// without touching a real project. onAuthStateChanged reports a signed-out user.
jest.mock('../lib/firebase', () => ({ auth: {}, db: {} }));

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, callback) => {
    callback(null);
    return () => {};
  },
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

  test('the corporate portal pre-sets the role from the work email', async () => {
    render(<App />);

    await userEvent.click(screen.getByRole('tab', { name: /corporate/i }));
    await userEvent.type(
      screen.getByLabelText(/^email$/i),
      'amir.coordinator@connectsphere.com'
    );

    expect(screen.getByText(/detected role:/i)).toHaveTextContent(
      'Event Coordinator'
    );
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
