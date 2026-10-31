// A1 / A2 account rules at their edges.
// The everyday cases, and the 7/15-digit mobile boundaries, are in app/App.test.js.

import { isStrongPassword, isValidEmailAddress, passwordChecks } from './accounts';

describe('account rules', () => {
  describe('boundary', () => {
    test('TC-0001 a password of 11 characters is one short; 12 and 13 pass', () => {
      expect(isStrongPassword('PassWord1!a')).toBe(false);
      expect(isStrongPassword('PassWord1!ab')).toBe(true);
      expect(isStrongPassword('PassWord1!abc')).toBe(true);
    });
  });

  describe('failure', () => {
    test('TC-0003 no password at all meets none of the rules', () => {
      expect(passwordChecks(undefined).map((check) => check.met)).toEqual([false, false, false]);
      expect(passwordChecks(null).every((check) => !check.met)).toBe(true);
      expect(isStrongPassword(undefined)).toBe(false);
    });

    test.each([
      '', 'alice', 'alice@', '@example.com', 'alice@example',
      'alice example@example.com', 'alice@@example.com'
    ])('TC-0027 A2 AC6 malformed email %p is refused before registration', (email) => {
      expect(isValidEmailAddress(email)).toBe(false);
    });

    test('TC-0028 A2 AC6 a normal email is accepted and surrounding spaces are ignored', () => {
      expect(isValidEmailAddress('alice@example.com')).toBe(true);
      expect(isValidEmailAddress('  alice+events@example.co.uk  ')).toBe(true);
    });
  });
});
