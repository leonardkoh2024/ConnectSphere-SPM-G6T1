// J1 / SCRUM-150 — the inbox's ordering, counting and labelling rules.
// TC-250 – TC-254 and TC-263 in docs/test-cases.md.

import fs from 'fs';
import path from 'path';
import {
  badgeText, decisionReasonProblem, eventCancelledMessage, eventDecisionMessage, eventLabel, eventSubmittedMessage, eventViewScreen,
  newestFirst, notificationTypeLabel, notificationViewScreen, ORGANISER_PROGRESS_TYPES, unreadCount, venueBookingOutcomeMessage
} from './notifications';
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
    expect(eventViewScreen(ROLES.ATTENDEE)).toBe('My registrations');
    expect(eventViewScreen('NOT_A_ROLE')).toBeNull();
  });
});

// J6 / SCRUM-155 — TC-318 – TC-320 in docs/test-cases.md.
describe('J6 outcome notifications', () => {
  test('TC-318 a booking outcome says approved, or rejected with its reason', () => {
    expect(venueBookingOutcomeMessage({ eventName: 'Q4 Partner Summit', venueName: 'Harbour Hall', approved: true }))
      .toBe('Q4 Partner Summit: the booking for Harbour Hall was approved.');
    expect(venueBookingOutcomeMessage({ eventName: 'Q4 Partner Summit', venueName: 'Harbour Hall', approved: false, reason: ' Closed for repairs ' }))
      .toBe('Q4 Partner Summit: the booking for Harbour Hall was rejected. Reason: Closed for repairs');
    expect(venueBookingOutcomeMessage({ approved: false })).toBe('Your event: the booking for the venue was rejected.');
  });

  test('TC-319 each outcome type has words', () => {
    expect(notificationTypeLabel('VENUE_BOOKING_APPROVED')).toBe('Venue booking approved');
    expect(notificationTypeLabel('VENUE_BOOKING_REJECTED')).toBe('Venue booking rejected');
    expect(notificationTypeLabel('EQUIPMENT_ARRANGED')).toBe('Equipment reserved');
    expect(notificationTypeLabel('EQUIPMENT_UNABLE_TO_FULFIL')).toBe('Equipment unavailable');
  });

  test("TC-320 a coordinator's outcome opens the booking or equipment request, anything else the event", () => {
    expect(notificationViewScreen(ROLES.COORDINATOR, { type: 'VENUE_BOOKING_APPROVED', booking_id: 'VB-1' })).toBe('Venue bookings');
    expect(notificationViewScreen(ROLES.COORDINATOR, { type: 'VENUE_BOOKING_REJECTED', booking_id: 'VB-1' })).toBe('Venue bookings');
    expect(notificationViewScreen(ROLES.COORDINATOR, { type: 'VENUE_BOOKING_APPROVED' })).toBe('Assigned events');
    expect(notificationViewScreen(ROLES.COORDINATOR, { type: 'EQUIPMENT_ARRANGED' })).toBe('Equipment requests');
    expect(notificationViewScreen(ROLES.COORDINATOR, { type: 'EQUIPMENT_UNABLE_TO_FULFIL' })).toBe('Equipment requests');
    expect(notificationViewScreen(ROLES.COORDINATOR, { type: 'EVENT_REJECTED' })).toBe('Assigned events');
    expect(notificationViewScreen(ROLES.COORDINATOR)).toBe('Assigned events');
    expect(notificationViewScreen(ROLES.ORGANISER, { type: 'EQUIPMENT_ARRANGED' })).toBe('New event request');
    expect(notificationViewScreen(ROLES.VENUE_STAFF, { type: 'VENUE_BOOKING_APPROVED', booking_id: 'VB-1' })).toBeNull();
  });
});

// J2 / SCRUM-151 — the organiser is told when their request moves. Each notice names
// the event and the change (AC2), and an approval or rejection carries its reason (AC3).
describe('J2 SCRUM-151 what the organiser is told', () => {
  test('J2-TC1 AC1 AC2 a received submission names the event and says it is waiting for a coordinator', () => {
    expect(eventSubmittedMessage({ eventName: 'Partner Summit' }))
      .toBe('Partner Summit was submitted and is waiting for a coordinator.');
    expect(eventSubmittedMessage({})).toBe('Your event was submitted and is waiting for a coordinator.');
  });

  test('J2-TC2 AC1 AC3 an approval names the event and carries the coordinator\'s reason', () => {
    expect(eventDecisionMessage({ eventName: 'Partner Summit', approved: true, reason: ' Venue and equipment are confirmed. ' }))
      .toBe('Partner Summit was approved — Venue and equipment are confirmed.');
  });

  test('J2-TC3 AC1 AC3 a rejection keeps the wording it already had, with its reason', () => {
    expect(eventDecisionMessage({ eventName: 'Partner Summit', approved: false, reason: 'No suitable venue can be secured.' }))
      .toBe('Partner Summit was rejected — No suitable venue can be secured.');
  });

  test('J2-TC4 AC1 AC2 a cancellation names the event and the reason, and reads sensibly with none', () => {
    expect(eventCancelledMessage({ eventName: 'Partner Summit', reason: ' Speaker withdrew ' }))
      .toBe('Partner Summit was cancelled — Speaker withdrew');
    expect(eventCancelledMessage({ eventName: 'Partner Summit' })).toBe('Partner Summit was cancelled.');
  });

  test('J2-TC5 AC3 an approval or a rejection cannot be sent without a reason, and each says which is missing', () => {
    expect(decisionReasonProblem('approve', '')).toBe('Approval reason is required.');
    expect(decisionReasonProblem('approve', '   ')).toBe('Approval reason is required.');
    expect(decisionReasonProblem('approve', undefined)).toBe('Approval reason is required.');
    expect(decisionReasonProblem('reject', '  ')).toBe('Rejection reason is required.');
    expect(decisionReasonProblem('approve', 'Looks good.')).toBeNull();
    expect(decisionReasonProblem('reject', 'No venue.')).toBeNull();
  });

  test('J2-TC6 AC2 each of the seven moves has its own words in the inbox, not the generic Update', () => {
    expect(ORGANISER_PROGRESS_TYPES).toEqual([
      'EVENT_SUBMITTED', 'COORDINATOR_ASSIGNED', 'CLARIFICATION_REQUESTED', 'EVENT_APPROVED',
      'EVENT_REJECTED', 'SAFETY_CHECK_APPROVED', 'EVENT_CANCELLED'
    ]);
    const labels = ORGANISER_PROGRESS_TYPES.map(notificationTypeLabel);
    expect(labels).toEqual([
      'Request received', 'Coordinator assigned', 'Clarification requested', 'Request approved',
      'Request rejected', 'Event confirmed', 'Event cancelled'
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('J2-TC7 AC2 the organiser can open the event from each of the seven notices', () => {
    ORGANISER_PROGRESS_TYPES.forEach((type) => expect(notificationViewScreen(ROLES.ORGANISER, { type })).toBe('New event request'));
  });
});

// J2 / SCRUM-151 AC1 — "cancelled" is notified by D4 (Cancel an event), which is not
// built yet. This guard turns red the day any source file sets an event to Cancelled
// without also telling the organiser, so the dependency cannot be forgotten.
describe('J2 SCRUM-151 hand-off to D4: cancelling an event tells the organiser', () => {
  const SRC = path.resolve(__dirname, '..');
  const WRITES_CANCELLED = /(status|newValue|new_value)\s*:\s*(EVENT_STATUS\.CANCELLED|["']CANCELLED["'])/;
  const sources = (dir = SRC) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(full);
    return /\.js$/.test(entry.name) && !/\.test\.js$/.test(entry.name) ? [full] : [];
  });

  test('J2-TC8 the guard recognises a write that cancels an event, and ignores a comparison', () => {
    expect(WRITES_CANCELLED.test('tx.update(eventRef, { status: EVENT_STATUS.CANCELLED, updated_at: at });')).toBe(true);
    expect(WRITES_CANCELLED.test('eventHistoryRecord({ newValue: "CANCELLED" })')).toBe(true);
    expect(WRITES_CANCELLED.test('if (event.status === EVENT_STATUS.CANCELLED) return;')).toBe(false);
    expect(WRITES_CANCELLED.test('const TERMINAL = new Set([EVENT_STATUS.COMPLETED, EVENT_STATUS.CANCELLED]);')).toBe(false);
  });

  test('J2-TC9 AC1 every source file that sets an event to Cancelled also sends the organiser eventCancelledMessage as EVENT_CANCELLED', () => {
    const offenders = sources()
      .filter((file) => WRITES_CANCELLED.test(fs.readFileSync(file, 'utf8')))
      .filter((file) => {
        const text = fs.readFileSync(file, 'utf8');
        return !(text.includes('eventCancelledMessage(') && text.includes('EVENT_CANCELLED'));
      })
      .map((file) => path.relative(SRC, file));

    // When this fails: D4's cancel must write a notification to the event's organiser,
    // in the same transaction as the status change (SCRUM-151 / J2 AC1).
    expect(offenders).toEqual([]);
  });
});

describe('J5 SCRUM-154 Technical Support notices read in words, not constants', () => {
  test('J5-TC21 AC1 AC2 AC3 AC4 each notice type the equipment service writes has its own label', () => {
    expect(notificationTypeLabel('EQUIPMENT_REQUEST_RAISED')).toBe('Equipment request raised');
    expect(notificationTypeLabel('EQUIPMENT_REQUEST_AMENDED')).toBe('Equipment request amended');
    expect(notificationTypeLabel('ON_SITE_SUPPORT_REQUIRED')).toBe('On-site support needed');
    expect(notificationTypeLabel('ON_SITE_SUPPORT_CHANGED')).toBe('On-site support changed');
  });
});

describe('H7 SCRUM-145 the attendee is told a place is offered', () => {
  test('TC-755 an offered place has its own label in the inbox', () => {
    const { notificationTypeLabel } = require('./notifications');
    expect(notificationTypeLabel('WAITLIST_PLACE_OFFERED')).toBe('Place offered');
  });
});

// J7 / SCRUM-156 — each notice an attendee is sent reads under its own heading, not "Update".
describe('J7 SCRUM-156 what the attendee is told reads in words', () => {
  test('TC-760 every kind of attendee notice has its own label in the inbox', () => {
    const { attendeeChangeNotices } = require('./safetyAndNotices');
    const labels = {
      REGISTRATION_CONFIRMED: 'Registration confirmed',
      DATE: 'Date changed',
      TIME: 'Time changed',
      VENUE: 'Venue changed',
      CANCELLED: 'Event cancelled',
      PLACE_OPENED: 'Place opened'
    };
    Object.entries(labels).forEach(([kind, label]) => {
      const status = kind === 'PLACE_OPENED' ? 'WAITLISTED' : 'REGISTERED';
      const [notice] = attendeeChangeNotices({ event: { event_id: 'e1', name: 'Harbour Tech Forum' }, attendees: [{ user_id: 'a1', status }], change: { kind, detail: 'x' } });
      expect(notificationTypeLabel(notice.type)).toBe(label);
    });
  });
});
