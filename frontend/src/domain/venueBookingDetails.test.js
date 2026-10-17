// F12 / SCRUM-177 — Book more than one venue for an event. UNIT, TC-491 – TC-497
// in docs/test-cases.md: the per-booking rules, called directly, no React and no
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
  test('TC-491 a booking needs a label; whitespace alone is not one', () => {
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
  ])('TC-492 an expected attendance of %s is refused', (_name, value) => {
    expect(bookingDetailsErrors(details({ expected_attendance: value }), event).expected_attendance)
      .toBe('Expected attendance must be a whole number greater than zero.');
  });

  test("TC-493 a booking's attendance may equal the event's, but not exceed it", () => {
    expect(bookingDetailsErrors(details({ expected_attendance: '300' }), event)).toEqual({});
    expect(bookingDetailsErrors(details({ expected_attendance: 300 }), event)).toEqual({});
    expect(bookingDetailsErrors(details({ expected_attendance: '301' }), event).expected_attendance)
      .toBe("Expected attendance cannot be more than the event's 300.");
  });

  test('TC-494 a booking needs a layout', () => {
    expect(bookingDetailsErrors(details({ layout: '' }), event).layout).toMatch(/layout/i);
    expect(bookingDetailsErrors(details({ layout: null }), event).layout).toMatch(/layout/i);
  });

  test("TC-495 a new booking starts from the venue's name, the event's attendance and the event's layout", () => {
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

  test('TC-496 a live booking for the same event, venue and an overlapping time is the clash; nothing else is', () => {
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

  test('TC-496 the occupied window, where recorded, is what is compared, and Date values work as well as text', () => {
    const withSetup = booking({
      start_datetime: new Date('2026-11-20T05:00:00.000Z'), end_datetime: new Date('2026-11-20T06:00:00.000Z'),
      occupied_start: new Date('2026-11-20T03:30:00.000Z'), occupied_end: new Date('2026-11-20T06:30:00.000Z')
    });
    expect(clashingEventBooking([withSetup], request())).toMatchObject({ booking_id: 'BK-1' });
  });
});

describe('F12 / SCRUM-177 unit — a venue is judged against its own booking', () => {
  test("TC-497 the booking's attendance and layout replace the event's; facilities, access and the date stay the event's", () => {
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
