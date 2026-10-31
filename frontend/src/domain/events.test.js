// B7 — every event status reads with a tone; and the role model's shape.

import { STATUS_TONE, statusTone } from './events';
import { EVENT_SCOPE_FIELD, ROLES, ROLE_META, eventScopeField } from './roles';

describe('status tones', () => {
  describe('normal', () => {
    test('TC-0061 exactly the ten event statuses have a tone, and there is no Returned', () => {
      expect(Object.keys(STATUS_TONE).sort()).toEqual(
        ['APPROVED', 'CANCELLED', 'COMPLETED', 'CONFIRMED', 'DRAFT', 'PLANNING', 'REJECTED', 'SAFETY_REVIEW', 'SUBMITTED', 'UNDER_REVIEW']
      );
      expect(statusTone('safety_review')).toBe('warning');
      expect(statusTone('REJECTED')).toBe('danger');
    });
  });

  describe('failure', () => {
    test.each([[undefined], [null], [''], ['RETURNED'], ['HELD']])('TC-0062 an unknown or missing status (%p) is neutral', (status) => {
      expect(statusTone(status)).toBe('neutral');
    });
  });
});

describe('roles', () => {
  test('TC-0063 exactly seven roles exist, each with a portal, and only the scoped ones name an event field', () => {
    expect(Object.values(ROLES)).toHaveLength(7);
    Object.values(ROLES).forEach((role) => expect(['corporate', 'individual']).toContain(ROLE_META[role].portal));
    expect(eventScopeField(ROLES.COORDINATOR)).toBe('coordinator_id');
    expect(eventScopeField(ROLES.COORDINATOR_LEAD)).toBeNull();
    expect(eventScopeField(ROLES.ATTENDEE)).toBeNull();
    expect(eventScopeField('ADMIN')).toBeNull();
    expect(Object.keys(EVENT_SCOPE_FIELD)).toHaveLength(7);
  });
});
