// A1 / A2 account rules at their edges.
// The everyday cases, and the 7/15-digit mobile boundaries, are in app/App.test.js.

import { emailDomain, isStaffEmail, isStrongPassword, passwordChecks, resolveRole } from './accounts';
import { ROLES } from './roles';

describe('account rules', () => {
  describe('boundary', () => {
    test('TC-0001 a password of 11 characters is one short; 12 and 13 pass', () => {
      expect(isStrongPassword('PassWord1!a')).toBe(false);
      expect(isStrongPassword('PassWord1!ab')).toBe(true);
      expect(isStrongPassword('PassWord1!abc')).toBe(true);
    });

    test('TC-0002 the email domain ignores case and surrounding spaces', () => {
      expect(emailDomain('  Amir@ConnectSphere.COM ')).toBe('connectsphere.com');
      expect(isStaffEmail(' Amir@ConnectSphere.com')).toBe(true);
    });
  });

  describe('failure', () => {
    test('TC-0003 no password at all meets none of the rules', () => {
      expect(passwordChecks(undefined).map((check) => check.met)).toEqual([false, false, false]);
      expect(passwordChecks(null).every((check) => !check.met)).toBe(true);
      expect(isStrongPassword(undefined)).toBe(false);
    });

    test('TC-0004 an address with no @ has no domain and is not a staff address', () => {
      expect(emailDomain('not-an-email')).toBe('');
      expect(isStaffEmail('')).toBe(false);
      expect(resolveRole('', 'corporate')).toBe(ROLES.ORGANISER);
      expect(resolveRole('@', 'corporate')).toBe(ROLES.ORGANISER);
      expect(resolveRole('venue.team', 'corporate')).toBe(ROLES.VENUE_STAFF);
    });
  });

  describe('normal', () => {
    test('TC-0005 the staff domains come from REACT_APP_STAFF_EMAIL_DOMAINS, else connectsphere.com', () => {
      const original = process.env.REACT_APP_STAFF_EMAIL_DOMAINS;
      try {
        process.env.REACT_APP_STAFF_EMAIL_DOMAINS = ' Example.org , ,other.sg';
        jest.isolateModules(() => {
          const fresh = require('./accounts');
          expect(fresh.isStaffEmail('a@example.org')).toBe(true);
          expect(fresh.isStaffEmail('a@other.sg')).toBe(true);
          expect(fresh.isStaffEmail('a@connectsphere.com')).toBe(false);
        });
        delete process.env.REACT_APP_STAFF_EMAIL_DOMAINS;
        jest.isolateModules(() => {
          expect(require('./accounts').isStaffEmail('a@connectsphere.com')).toBe(true);
        });
      } finally {
        if (original === undefined) delete process.env.REACT_APP_STAFF_EMAIL_DOMAINS;
        else process.env.REACT_APP_STAFF_EMAIL_DOMAINS = original;
      }
    });
  });
});
