// F9 / E11 — the venue-booking rules in domain/venueBooking.js, called directly, no React
// and no Firebase. UNIT. Production reaches them through VenueAvailability.

import { affectedApprovedBookings, calendarSegments, occupiedBookingWindow, windowsOverlap } from './venueBooking';

const iso = (value) => new Date(value).toISOString();
const hall = { venue_id: 'VEN-001', setup_minutes: 30, turnaround_minutes: 45 };
const booking = (id, fields = {}) => ({
  booking_id: id,
  event_id: `EVT-${id}`,
  venue_id: 'VEN-001',
  status: 'APPROVED',
  start_datetime: '2026-11-20T10:00:00.000Z',
  end_datetime: '2026-11-20T12:00:00.000Z',
  ...fields
});

describe('F9 / SCRUM-174 unit — a booking occupies its venue for setup, the event and turnaround', () => {
  test('TC-0977 [normal] 10:00–12:00 with 30 minutes setup and 45 turnaround occupies 09:30–12:45 (AC1)', () => {
    const window = occupiedBookingWindow(booking('A'), hall);
    expect([iso(window.start), iso(window.end)]).toEqual(['2026-11-20T09:30:00.000Z', '2026-11-20T12:45:00.000Z']);
  });

  test("TC-0978 [boundary] a venue with no setup or turnaround recorded — or none at all — occupies only the event's own time", () => {
    const plain = ['2026-11-20T10:00:00.000Z', '2026-11-20T12:00:00.000Z'];
    const window = occupiedBookingWindow(booking('A'), { venue_id: 'VEN-001' });
    expect([iso(window.start), iso(window.end)]).toEqual(plain);
    const noVenue = occupiedBookingWindow(booking('A'));
    expect([iso(noVenue.start), iso(noVenue.end)]).toEqual(plain);
    // Text minutes are counted; something that is not a number counts as zero.
    const text = occupiedBookingWindow(booking('A'), { setup_minutes: '15', turnaround_minutes: 'abc' });
    expect([iso(text.start), iso(text.end)]).toEqual(['2026-11-20T09:45:00.000Z', '2026-11-20T12:00:00.000Z']);
  });

  test('TC-0979 [boundary] windows that only touch do not overlap; a minute of overlap does (AC3)', () => {
    const left = { start: 0, end: 100 };
    expect(windowsOverlap(left, { start: 100, end: 200 })).toBe(false);
    expect(windowsOverlap({ start: 100, end: 200 }, left)).toBe(false);
    expect(windowsOverlap(left, { start: 99, end: 200 })).toBe(true);
    expect(windowsOverlap(left, { start: 10, end: 20 })).toBe(true);
  });

  test('TC-0980 [normal] the calendar shows setup, the event and turnaround as three separate segments (AC5)', () => {
    const segments = calendarSegments(booking('A'), hall);
    expect(segments.map(({ kind, start, end }) => [kind, iso(start), iso(end)])).toEqual([
      ['setup', '2026-11-20T09:30:00.000Z', '2026-11-20T10:00:00.000Z'],
      ['event', '2026-11-20T10:00:00.000Z', '2026-11-20T12:00:00.000Z'],
      ['turnaround', '2026-11-20T12:00:00.000Z', '2026-11-20T12:45:00.000Z']
    ]);
  });

  test('TC-0981 [boundary] a zero-minute setup or turnaround leaves no empty segment', () => {
    expect(calendarSegments(booking('A'), { setup_minutes: 0, turnaround_minutes: 0 }).map((segment) => segment.kind))
      .toEqual(['event']);
    expect(calendarSegments(booking('A'), { setup_minutes: 0, turnaround_minutes: 15 }).map((segment) => segment.kind))
      .toEqual(['event', 'turnaround']);
  });
});

describe('E11 / SCRUM-173 unit — which approved bookings an unavailability period affects', () => {
  const start = '2026-11-20T09:00:00.000Z';
  const end = '2026-11-20T13:00:00.000Z';
  const approved = booking('A', { occupied_start: '2026-11-20T09:30:00.000Z', occupied_end: '2026-11-20T12:45:00.000Z' });

  test('TC-0865 [boundary] pending, statusless, touching and other-venue bookings are not affected (AC2, AC3)', () => {
    const pending = booking('P', { status: 'PENDING' });
    const touching = booking('T', { occupied_start: end, occupied_end: '2026-11-20T15:00:00.000Z' });
    const elsewhere = booking('E', { venue_id: 'VEN-002' });
    const statusless = booking('S', { status: undefined });
    expect(affectedApprovedBookings({ venueId: 'VEN-001', start, end, bookings: [approved, pending, statusless, touching, elsewhere] }))
      .toEqual([approved]);
  });

  test("TC-0866 [boundary] the affected list compares a booking's occupied window, falling back to its event times", () => {
    const window = { venueId: 'VEN-001', start: '2026-11-20T12:30:00.000Z', end: '2026-11-20T13:00:00.000Z' };
    // Only the 12:45 turnaround reaches into 12:30–13:00.
    expect(affectedApprovedBookings({ ...window, bookings: [approved] })).toEqual([approved]);
    // Without a recorded occupied window, the event ends at 12:00 — clear of it.
    expect(affectedApprovedBookings({ ...window, bookings: [booking('PLAIN')] })).toEqual([]);
    expect(affectedApprovedBookings({ ...window, bookings: [booking('lower', { status: 'approved', occupied_end: '2026-11-20T12:45:00.000Z' })] }))
      .toHaveLength(1);
    expect(affectedApprovedBookings(window)).toEqual([]);
  });
});
