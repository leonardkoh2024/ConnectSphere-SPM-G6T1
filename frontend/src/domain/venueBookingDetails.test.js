// F12 / SCRUM-177 — Book more than one venue for an event. UNIT:
// the per-booking rules, called directly, no React and no
// Firebase.

import {
  bookingDetailsDefaults,
  bookingDetailsErrors,
  clashingEventBooking
} from './venueBookingDetails';
import { bookingRequirements } from './venueSuitability';

const event = { event_id: 'EVT-1', name: 'Annual Conference', expected_attendance: 300, required_layout: 'THEATRE' };
const details = (fields) => ({ label: 'Breakout 1', expected_attendance: '50', layout: 'CLASSROOM', ...fields });

describe('F12 / SCRUM-177 unit — each booking carries its own label, attendance and layout', () => {
  test('TC-1054 a booking needs a label; whitespace alone is not one', () => {
    expect(bookingDetailsErrors(details(), event)).toEqual({});
    expect(bookingDetailsErrors(details({ label: '' }), event).label).toMatch(/label/i);
    expect(bookingDetailsErrors(details({ label: '   ' }), event).label).toMatch(/label/i);
  });

  test.each([
    ['zero', '0'],
    ['a negative number', '-5'],
    ['a fraction', '2.5'],
    ['text', 'fifty'],
    ['nothing', '']
  ])('TC-1055 an expected attendance of %s is refused', (_name, value) => {
    expect(bookingDetailsErrors(details({ expected_attendance: value }), event).expected_attendance)
      .toBe('Expected attendance must be a whole number greater than zero.');
  });

  test("TC-1056 a booking's attendance may equal the event's, but not exceed it", () => {
    expect(bookingDetailsErrors(details({ expected_attendance: '300' }), event)).toEqual({});
    expect(bookingDetailsErrors(details({ expected_attendance: 300 }), event)).toEqual({});
    expect(bookingDetailsErrors(details({ expected_attendance: '301' }), event).expected_attendance)
      .toBe("Expected attendance cannot be more than the event's 300.");
  });

  test('TC-1057 a booking needs a layout', () => {
    expect(bookingDetailsErrors(details({ layout: '' }), event).layout).toMatch(/layout/i);
    expect(bookingDetailsErrors(details({ layout: null }), event).layout).toMatch(/layout/i);
  });

  test("TC-1058 a new booking starts from the venue's name, the event's attendance and the event's layout", () => {
    expect(bookingDetailsDefaults(event, { venue_id: 'VEN-001', name: 'Hall A' }))
      .toEqual({ label: 'Hall A', expected_attendance: '300', layout: 'THEATRE' });
    expect(bookingDetailsDefaults({ expected_attendance: null, required_layout: null }, {}))
      .toEqual({ label: '', expected_attendance: '', layout: '' });
  });
});

describe('F12 / SCRUM-177 unit — the same venue twice at once for one event is refused', () => {
  const morning = { start: '2026-11-20T01:00:00.000Z', end: '2026-11-20T04:00:00.000Z' };
  const booking = (fields) => ({
    booking_id: 'BK-1', booking_label: 'Main programme', event_id: 'EVT-1', venue_id: 'VEN-001', status: 'PENDING',
    start_datetime: morning.start, end_datetime: morning.end, ...fields
  });
  const request = (fields) => ({ eventId: 'EVT-1', venueId: 'VEN-001', ...morning, ...fields });

  test('TC-1059 a live booking for the same event, venue and an overlapping time is the clash; nothing else is', () => {
    expect(clashingEventBooking([booking()], request())).toMatchObject({ booking_id: 'BK-1' });
    expect(clashingEventBooking([booking({ status: 'APPROVED' })], request())).toMatchObject({ booking_id: 'BK-1' });
    // Partly overlapping still clashes.
    expect(clashingEventBooking([booking()], request({ start: '2026-11-20T03:00:00.000Z', end: '2026-11-20T06:00:00.000Z' })))
      .toMatchObject({ booking_id: 'BK-1' });
    // Windows that only touch do not.
    expect(clashingEventBooking([booking()], request({ start: morning.end, end: '2026-11-20T06:00:00.000Z' }))).toBeNull();
    // A different venue for the same event is the point of F12.
    expect(clashingEventBooking([booking({ venue_id: 'VEN-002' })], request())).toBeNull();
    // Another event's booking is F6's concern, not this rule's.
    expect(clashingEventBooking([booking({ event_id: 'EVT-2' })], request())).toBeNull();
    // A booking that is no longer live leaves the venue free to ask for again.
    for (const status of ['WITHDRAWN', 'REJECTED', 'RELEASED', 'CANCELLED']) {
      expect(clashingEventBooking([booking({ status })], request())).toBeNull();
    }
  });

  test('TC-1060 the occupied window, where recorded, is what is compared, and Date values work as well as text', () => {
    const withSetup = booking({
      start_datetime: new Date('2026-11-20T05:00:00.000Z'), end_datetime: new Date('2026-11-20T06:00:00.000Z'),
      occupied_start: new Date('2026-11-20T03:30:00.000Z'), occupied_end: new Date('2026-11-20T06:30:00.000Z')
    });
    expect(clashingEventBooking([withSetup], request())).toMatchObject({ booking_id: 'BK-1' });
  });
});

describe('F12 / SCRUM-177 unit — a venue is judged against its own booking', () => {
  test("TC-1061 the booking's attendance and layout replace the event's; facilities, access and the date stay the event's", () => {
    const whole = { ...event, event_date: '2026-11-20', start_time: '09:00', end_time: '17:00', facilities: ['WIFI'], accessibility: ['LIFT'] };

    expect(bookingRequirements(whole, { expected_attendance: '50', layout: 'CLASSROOM' })).toEqual({
      expected_attendance: 50,
      event_date: '2026-11-20',
      start_time: '09:00',
      end_time: '17:00',
      facilities: ['WIFI'],
      accessibility: ['LIFT'],
      layout: 'CLASSROOM'
    });
    // Without a booking the event's own figures are used, as before.
    expect(bookingRequirements(whole)).toMatchObject({ expected_attendance: 300, layout: 'THEATRE' });
  });
});

describe('F12 / SCRUM-177 unit — edge inputs to the per-booking rules', () => {
  const morning = { start: '2026-11-20T01:00:00.000Z', end: '2026-11-20T04:00:00.000Z' };
  const live = { booking_id: 'BK-1', event_id: 'EVT-1', venue_id: 'VEN-001', status: 'PENDING', start_datetime: morning.start, end_datetime: morning.end };
  const ask = (fields) => ({ eventId: 'EVT-1', venueId: 'VEN-001', ...morning, ...fields });

  test('TC-1062 [failure] with nothing filled in, every field is reported and defaults are blank', () => {
    expect(bookingDetailsDefaults()).toEqual({ label: '', expected_attendance: '', layout: '' });
    expect(Object.keys(bookingDetailsErrors()).sort()).toEqual(['expected_attendance', 'label', 'layout']);
  });

  test("TC-1063 [boundary] an event with no recorded attendance puts no ceiling on the booking's attendance", () => {
    expect(bookingDetailsErrors({ label: 'Main', expected_attendance: '5000', layout: 'THEATRE' }, {})).toEqual({});
  });

  test('TC-1064 [failure] a request window that is missing or not a date cannot clash with anything', () => {
    expect(clashingEventBooking([live], ask({ start: null }))).toBeNull();
    expect(clashingEventBooking([live], ask({ end: 'not a date' }))).toBeNull();
    expect(clashingEventBooking(undefined, ask())).toBeNull();
  });

  test('TC-1065 [boundary] Firestore timestamps compare like dates; a booking with no status or no window is not live', () => {
    const stamp = (value) => ({ toDate: () => new Date(value) });
    expect(clashingEventBooking([live], ask({ start: stamp(morning.start), end: stamp(morning.end) }))).toMatchObject({ booking_id: 'BK-1' });
    expect(clashingEventBooking([{ ...live, status: undefined }], ask())).toBeNull();
    expect(clashingEventBooking([{ ...live, start_datetime: undefined }], ask())).toBeNull();
  });
});
