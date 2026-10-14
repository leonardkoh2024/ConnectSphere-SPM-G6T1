// J1 / SCRUM-150 — the inbox's ordering, counting and labelling rules.
// TC-250 – TC-254 and TC-263 in docs/test-cases.md.

import { badgeText, eventLabel, eventViewScreen, newestFirst, notificationTypeLabel, unreadCount } from './notifications';
import { ROLES } from './roles';

describe('J1 inbox rules', () => {
  test('TC-250 notifications list newest first, undated last', () => {
    const list = [
      { id: 'old', created_at: '2026-10-01T09:00:00.000Z' },
      { id: 'pending', created_at: null },
      { id: 'new', created_at: '2026-10-07T09:00:00.000Z' }
    ];

    expect(newestFirst(list).map((item) => item.id)).toEqual(['new', 'old', 'pending']);
    expect(list.map((item) => item.id)).toEqual(['old', 'pending', 'new']);
  });

  test('TC-251 only notifications not yet read are counted as unread', () => {
    expect(unreadCount([{ is_read: false }, { is_read: true }, {}])).toBe(2);
    expect(unreadCount([])).toBe(0);
  });

  test('TC-252 the badge is absent at zero and capped at 99+', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(3)).toBe('3');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });

  test('TC-253 the related event reads as name and reference, with fallbacks', () => {
    expect(eventLabel({ name: 'Q4 Partner Summit', reference_no: 'EVT-100234' })).toBe('Q4 Partner Summit (EVT-100234)');
    expect(eventLabel({ name: 'Q4 Partner Summit' })).toBe('Q4 Partner Summit');
    expect(eventLabel({ reference_no: 'EVT-100234' })).toBe('EVT-100234');
    expect(eventLabel({})).toBe('Untitled event');
    expect(eventLabel(null)).toBeNull();
  });

  test('TC-254 each stored type has words, and an unknown one still reads as an update', () => {
    expect(notificationTypeLabel('EVENT_REJECTED')).toBe('Request rejected');
    expect(notificationTypeLabel('CLARIFICATION_REQUESTED')).toBe('Clarification requested');
    expect(notificationTypeLabel('VENUE_BOOKING_REQUESTED')).toBe('Booking request raised');
    expect(notificationTypeLabel('VENUE_DETAILS_UPDATED')).toBe('Venue details updated');
    expect(notificationTypeLabel('SOMETHING_NEW')).toBe('Update');
  });
});

describe('J1 where View on a notification goes', () => {
  test('TC-263 each role with an event screen gets that screen; the rest get none', () => {
    expect(eventViewScreen(ROLES.ORGANISER)).toBe('New event request');
    expect(eventViewScreen(ROLES.COORDINATOR)).toBe('Assigned events');
    expect(eventViewScreen(ROLES.VENUE_STAFF)).toBeNull();
    expect(eventViewScreen(ROLES.TECH_SUPPORT)).toBeNull();
    expect(eventViewScreen(ROLES.ATTENDEE)).toBeNull();
    expect(eventViewScreen('NOT_A_ROLE')).toBeNull();
  });
});
