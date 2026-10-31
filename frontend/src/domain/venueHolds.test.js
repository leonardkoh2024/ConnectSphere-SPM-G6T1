// F15 / SCRUM-180 — Place a tentative hold on a venue. UNIT.
// : the hold rules, called directly, no React and no Firebase.
//
// A hold lasts a fixed three working days (decided 19 Oct 2026): Monday to
// Friday, Singapore time, ending at the same clock time it was placed. Public
// holidays are not counted out — the customer never named them.

import {
  HOLD_WORKING_DAYS,
  activeHoldClash,
  holdExpiry,
  holdRefusal,
  isActiveHold,
  singaporeDateTime
} from './venueHolds';
import { safetyApprovalBlocker } from './safetyReview';
import { notificationViewScreen, venueHoldPlacedMessage } from './notifications';
import { ENTRY_KINDS, SLOT, buildMonthCalendar, buildVenueCalendar } from './venueCalendar';
import { ROLES } from './roles';

// Singapore wall-clock time, as an absolute instant.
const sg = (date, time) => new Date(`${date}T${time}:00+08:00`);
const iso = (date, time) => sg(date, time).toISOString();

describe('F15 / SCRUM-180 unit — a hold lasts exactly three working days', () => {
  test('TC-1099 the expiry is three weekdays on, at the same clock time, skipping the weekend', () => {
    expect(HOLD_WORKING_DAYS).toBe(3);
    // 2026-10-19 is a Monday.
    expect(holdExpiry(sg('2026-10-19', '10:00')).toISOString()).toBe(iso('2026-10-22', '10:00')); // Mon → Thu
    expect(holdExpiry(sg('2026-10-20', '09:30')).toISOString()).toBe(iso('2026-10-23', '09:30')); // Tue → Fri
    expect(holdExpiry(sg('2026-10-21', '15:00')).toISOString()).toBe(iso('2026-10-26', '15:00')); // Wed → Mon
    expect(holdExpiry(sg('2026-10-23', '15:00')).toISOString()).toBe(iso('2026-10-28', '15:00')); // Fri → Wed
    // Placed on a weekend, the count starts on Monday.
    expect(holdExpiry(sg('2026-10-24', '10:00')).toISOString()).toBe(iso('2026-10-28', '10:00')); // Sat → Wed
    expect(holdExpiry(sg('2026-10-25', '10:00')).toISOString()).toBe(iso('2026-10-28', '10:00')); // Sun → Wed
  });

  test("TC-1100 the weekday is Singapore's, not UTC's", () => {
    // Tue 01:00 in Singapore is still Monday in UTC; the hold follows Tuesday.
    expect(holdExpiry(sg('2026-10-20', '01:00')).toISOString()).toBe(iso('2026-10-23', '01:00'));
    // Sat 07:00 in Singapore is Friday in UTC; the hold follows Saturday.
    expect(holdExpiry(sg('2026-10-24', '07:00')).toISOString()).toBe(iso('2026-10-28', '07:00'));
  });
});

describe('F15 / SCRUM-180 unit — only a pending request with time to spare can be held', () => {
  const now = sg('2026-10-19', '10:00'); // Monday; a hold now expires Thu 22 Oct 10:00.
  const request = (fields) => ({
    booking_id: 'BK-1', status: 'PENDING', venue_id: 'VEN-001',
    start_datetime: iso('2026-11-20', '09:00'), end_datetime: iso('2026-11-20', '17:00'),
    occupied_start: iso('2026-11-20', '08:30'), occupied_end: iso('2026-11-20', '17:30'),
    ...fields
  });

  test('TC-1101 a pending request well ahead of its event may be held', () => {
    expect(holdRefusal({ booking: request(), now })).toBeNull();
  });

  test('TC-1102 a hold that would still be running when the venue is needed is refused, naming both times', () => {
    const soon = request({ occupied_start: iso('2026-10-21', '08:30'), start_datetime: iso('2026-10-21', '09:00') });
    expect(holdRefusal({ booking: soon, now })).toBe(
      'A hold placed now would last until Thu 22 Oct 2026, 10:00, but the venue is needed from Wed 21 Oct 2026, 08:30. Approve or reject this request instead.'
    );
    // The expiry must be strictly before the occupied window, so meeting it exactly is refused too.
    expect(holdRefusal({ booking: request({ occupied_start: iso('2026-10-22', '10:00') }), now })).not.toBeNull();
  });

  test('TC-1103 the occupied window, not the event time, is what the hold must end before', () => {
    // The event starts after the expiry, but its setup starts before it.
    const setupFirst = request({ start_datetime: iso('2026-10-22', '11:00'), occupied_start: iso('2026-10-22', '09:00') });
    expect(holdRefusal({ booking: setupFirst, now })).not.toBeNull();
  });

  test('TC-1104 only a pending request can be held', () => {
    for (const status of ['APPROVED', 'HELD', 'REJECTED', 'WITHDRAWN']) {
      expect(holdRefusal({ booking: request({ status }), now })).toBe('Only a pending booking request can be put on hold.');
    }
  });
});

describe('F15 / SCRUM-180 unit — an active hold keeps the venue', () => {
  const now = sg('2026-10-20', '12:00');
  const hold = (fields) => ({
    booking_id: 'BK-H', booking_label: 'Annual Conference — Hall A', event_id: 'EVT-1', venue_id: 'VEN-001',
    status: 'HELD', hold_expires_at: iso('2026-10-22', '10:00'),
    start_datetime: iso('2026-11-20', '09:00'), end_datetime: iso('2026-11-20', '17:00'),
    occupied_start: iso('2026-11-20', '08:30'), occupied_end: iso('2026-11-20', '17:30'),
    ...fields
  });

  test('TC-1105 a hold is active only while it is Held and its expiry has not passed', () => {
    expect(isActiveHold(hold(), now)).toBe(true);
    expect(isActiveHold(hold(), sg('2026-10-22', '09:59'))).toBe(true);
    expect(isActiveHold(hold(), sg('2026-10-22', '10:00'))).toBe(false);
    // A converted hold is an approved booking, no longer subject to expiry (AC7).
    expect(isActiveHold(hold({ status: 'APPROVED' }), now)).toBe(false);
    expect(isActiveHold(hold({ status: 'PENDING' }), now)).toBe(false);
  });

  test("TC-1106 an overlapping request for the same venue meets the active hold, whichever event it is for", () => {
    const ask = (fields) => ({ venueId: 'VEN-001', start: iso('2026-11-20', '12:00'), end: iso('2026-11-20', '20:00'), now, ...fields });

    expect(activeHoldClash([hold()], ask())).toMatchObject({ booking_id: 'BK-H' });
    // Windows that only touch do not clash; the occupied window is what counts.
    expect(activeHoldClash([hold()], ask({ start: iso('2026-11-20', '17:30'), end: iso('2026-11-20', '19:00') }))).toBeNull();
    expect(activeHoldClash([hold()], ask({ venueId: 'VEN-002' }))).toBeNull();
    // Once it has expired the window is free again.
    expect(activeHoldClash([hold()], ask({ now: sg('2026-10-22', '10:00') }))).toBeNull();
    // A booking does not clash with its own hold.
    expect(activeHoldClash([hold()], ask({ excludeBookingId: 'BK-H' }))).toBeNull();
  });

  test('TC-1107 a held booking is not an approved one: the event cannot be confirmed on it', () => {
    const event = { approved_venue_booking_id: 'BK-MAIN' };
    const bookings = [
      { booking_id: 'BK-MAIN', status: 'APPROVED', booking_label: 'Main programme' },
      { booking_id: 'BK-H', status: 'HELD', booking_label: 'Breakout 1', hold_expires_at: iso('2026-10-22', '10:00') }
    ];
    expect(safetyApprovalBlocker(event, bookings)).toMatch(/Not yet approved: Breakout 1\./);
  });
});

describe('F15 / SCRUM-180 unit — the coordinator is told, with the expiry', () => {
  test('TC-1108 the notice names the event, the venue and the expiry in Singapore time, and opens Venue bookings', () => {
    expect(singaporeDateTime(iso('2026-10-22', '10:00'))).toBe('Thu 22 Oct 2026, 10:00');
    expect(venueHoldPlacedMessage({ eventName: 'Annual Conference', venueName: 'Hall A', expiresAt: iso('2026-10-22', '10:00') }))
      .toBe('Annual Conference: Hall A is held for this event until Thu 22 Oct 2026, 10:00.');
    expect(notificationViewScreen(ROLES.COORDINATOR, { type: 'VENUE_BOOKING_HELD', booking_id: 'BK-H' })).toBe('Venue bookings');
  });
});

describe('F15 / SCRUM-180 unit — holds on the availability calendar', () => {
  // Local time, as the calendar buckets days locally. Monday 12 Oct 2026.
  const at = (day, hh) => new Date(2026, 9, day, hh, 0).toISOString();
  const hall = { venue_id: 'VEN-001', name: 'Hall A', operating_hours: [{ weekday: 'MONDAY', opens_at: '08:00', closes_at: '20:00' }] };
  const now = new Date(2026, 9, 5, 9, 0);
  const bookings = [
    { booking_id: 'b1', venue_id: 'VEN-001', status: 'APPROVED', event_name: 'Annual Gala', start_datetime: at(12, 9), end_datetime: at(12, 11) },
    { booking_id: 'h1', venue_id: 'VEN-001', status: 'HELD', event_name: 'Product Launch', start_datetime: at(12, 13), end_datetime: at(12, 15),
      occupied_start: at(12, 12), occupied_end: at(12, 16), hold_expires_at: new Date(2026, 9, 8, 9, 0).toISOString() },
    { booking_id: 'h2', venue_id: 'VEN-001', status: 'HELD', event_name: 'Lapsed Offsite', start_datetime: at(12, 17), end_datetime: at(12, 19),
      hold_expires_at: new Date(2026, 9, 1, 9, 0).toISOString() }
  ];

  test('TC-1109 an active hold occupies its occupied window as Held, distinct from booked, free and blocked; an expired one shows nothing', () => {
    const calendar = buildVenueCalendar({
      venueId: 'VEN-001', venues: [hall], from: '2026-10-12', to: '2026-10-12', bookings, unavailability: [],
      role: ROLES.COORDINATOR, now
    });
    const segments = calendar.days[0].segments.map(({ kind, start, end, label }) => ({ kind, start, end, label }));

    expect(segments).toEqual(expect.arrayContaining([
      { kind: SLOT.BOOKED, start: '09:00', end: '11:00', label: 'Annual Gala' },
      { kind: SLOT.HELD, start: '12:00', end: '16:00', label: 'Product Launch' },
      { kind: SLOT.FREE, start: '16:00', end: '20:00', label: '' }
    ]));
    expect(segments.some((segment) => segment.label === 'Lapsed Offsite')).toBe(false);
  });

  test('TC-1110 the month view lists an active hold as Held, and organisers see that it is held, not whose', () => {
    expect(ENTRY_KINDS).toContain(SLOT.HELD);
    const entriesOn = (role) => buildMonthCalendar({ month: '2026-10', venues: [hall], bookings, unavailability: [], role, now })
      .weeks.flat().find((day) => day.date === '2026-10-12').entries;

    expect(entriesOn(ROLES.COORDINATOR).filter((entry) => entry.kind === SLOT.HELD))
      .toEqual([expect.objectContaining({ label: 'Product Launch', start: '12:00', end: '16:00' })]);
    expect(entriesOn(ROLES.ORGANISER).filter((entry) => entry.kind === SLOT.HELD))
      .toEqual([expect.objectContaining({ label: 'Held' })]);
  });
});

describe('F15 / F16 unit — edge inputs to the hold rules', () => {
  const hold = (fields) => ({
    booking_id: 'BK-H', venue_id: 'VEN-001', status: 'HELD', hold_expires_at: iso('2026-10-22', '10:00'),
    start_datetime: iso('2026-11-20', '09:00'), end_datetime: iso('2026-11-20', '17:00'), ...fields
  });
  const ask = (fields) => ({ venueId: 'VEN-001', start: iso('2026-11-20', '12:00'), end: iso('2026-11-20', '20:00'), now: sg('2026-10-20', '12:00'), ...fields });

  test('TC-1111 [failure] a missing or unreadable time formats as blank rather than "Invalid Date"', () => {
    expect(singaporeDateTime(null)).toBe('');
    expect(singaporeDateTime('not a date')).toBe('');
    expect(singaporeDateTime({ toDate: () => sg('2026-10-22', '10:00') })).toBe('Thu 22 Oct 2026, 10:00');
  });

  test('TC-1112 [boundary] without a stored occupied window, the event times are what a hold keeps and must end before', () => {
    expect(activeHoldClash([hold()], ask())).toMatchObject({ booking_id: 'BK-H' });
    expect(activeHoldClash([hold()], ask({ start: iso('2026-11-20', '17:00') }))).toBeNull();
    expect(holdRefusal({ booking: { status: 'PENDING', start_datetime: iso('2026-10-21', '09:00') }, now: sg('2026-10-19', '10:00') })).not.toBeNull();
    // With no window at all there is nothing for the hold to run into.
    expect(holdRefusal({ booking: { status: 'pending' }, now: sg('2026-10-19', '10:00') })).toBeNull();
  });

  test('TC-1113 [failure] no booking, no status or no expiry is never an active hold, and cannot be held', () => {
    expect(isActiveHold(null)).toBe(false);
    expect(isActiveHold(hold({ hold_expires_at: undefined }))).toBe(false);
    expect(isActiveHold(hold({ status: undefined }))).toBe(false);
    expect(holdRefusal({ booking: undefined })).toBe('Only a pending booking request can be put on hold.');
    // Defaults to the current clock: a hold expiring in 2999 is active, and a request for 2999 can be held.
    expect(isActiveHold(hold({ hold_expires_at: '2999-01-01T00:00:00Z' }))).toBe(true);
    expect(holdRefusal({ booking: { status: 'PENDING', start_datetime: '2999-01-01T00:00:00Z' } })).toBeNull();
  });

  test('TC-1114 [failure] an unreadable request window never meets a hold; the document id stands in for a missing booking id', () => {
    expect(activeHoldClash([hold()], ask({ start: null }))).toBeNull();
    expect(activeHoldClash([hold()], ask({ end: 'not a date' }))).toBeNull();
    expect(activeHoldClash(undefined, ask())).toBeNull();
    const byDocId = hold({ booking_id: undefined, id: 'DOC-H' });
    expect(activeHoldClash([byDocId], ask({ excludeBookingId: 'DOC-H' }))).toBeNull();
    expect(activeHoldClash([byDocId], ask())).toMatchObject({ id: 'DOC-H' });
    expect(activeHoldClash([hold({ hold_expires_at: '2999-01-01T00:00:00Z' })], { venueId: 'VEN-001', start: iso('2026-11-20', '12:00'), end: iso('2026-11-20', '13:00') }))
      .toMatchObject({ booking_id: 'BK-H' });
  });
});
