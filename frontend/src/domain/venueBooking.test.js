// F2 / F6 / F9 / E11 — the venue-booking rules in domain/venueBooking.js, called
// directly, no React and no Firebase. UNIT.
//
// Production reaches this module through VenueAvailability (UNAVAILABILITY_REASONS,
// affectedApprovedBookings, calendarSegments). The other exports are the same
// rules the screens and venue service enforce, kept here so their boundaries are
// pinned down without Firestore.

import {
  REPLACEMENT_NEEDED,
  UNAVAILABILITY_REASONS,
  affectedApprovedBookings,
  approvedConflicts,
  assignVenueStaff,
  calendarSegments,
  occupiedBookingWindow,
  recordVenueUnavailability,
  searchBlockedByUnavailability,
  unassignedBookingQueue,
  unavailabilityConflicts,
  windowsOverlap
} from './venueBooking';

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

describe('F6 / F9 unit — approved bookings at the same venue conflict on their occupied windows', () => {
  test('TC-0982 [conflict] a request whose occupied window overlaps an approved one is a conflict, even when the event times do not (F9 AC3)', () => {
    // 12:50–14:00 does not meet 10:00–12:00, but 12:20 setup meets the 12:45 turnaround.
    const incoming = booking('B', { status: 'PENDING', start_datetime: '2026-11-20T12:50:00.000Z', end_datetime: '2026-11-20T14:00:00.000Z' });
    expect(approvedConflicts(incoming, [booking('A'), incoming], hall).map((item) => item.booking_id)).toEqual(['A']);
  });

  test('TC-0950 [boundary] occupied windows that only touch do not conflict (F6 AC2, F9 AC3)', () => {
    // 12:45 turnaround end meets a 13:15 start less 30 minutes setup.
    const incoming = booking('B', { status: 'PENDING', start_datetime: '2026-11-20T13:15:00.000Z', end_datetime: '2026-11-20T15:00:00.000Z' });
    expect(approvedConflicts(incoming, [booking('A'), incoming], hall)).toEqual([]);
  });

  test('TC-0951 [normal] only approved bookings at the same venue on the same date count; the request never clashes with itself', () => {
    const incoming = booking('B', { status: 'PENDING' });
    const others = [
      booking('PENDING', { status: 'PENDING' }),
      booking('HELD', { status: 'HELD' }),
      booking('LOWER', { status: 'approved' }),
      booking('OTHER-VENUE', { venue_id: 'VEN-002' }),
      booking('NEXT-DAY', { start_datetime: '2026-11-21T10:00:00.000Z', end_datetime: '2026-11-21T12:00:00.000Z' }),
      booking('NO-STATUS', { status: undefined }),
      booking('NO-START', { start_datetime: undefined }),
      incoming
    ];
    // Status is compared case-insensitively, so a lower-case "approved" still counts.
    expect(approvedConflicts(incoming, others, hall).map((item) => item.booking_id)).toEqual(['LOWER']);
    expect(approvedConflicts({ ...incoming, start_datetime: undefined }, [booking('A')], hall)).toEqual([]);
  });

  test('TC-0952 [conflict] a maintenance block overlapping the occupied window conflicts; a touching or other-venue one does not (F6 AC4)', () => {
    const incoming = booking('B', { status: 'PENDING' });
    const block = (fields) => ({ venue_id: 'VEN-001', start_datetime: '2026-11-20T08:00:00.000Z', end_datetime: '2026-11-20T09:45:00.000Z', reason: 'Maintenance', ...fields });
    expect(unavailabilityConflicts(incoming, [block()], hall).map((item) => item.reason)).toEqual(['Maintenance']);
    expect(unavailabilityConflicts(incoming, [block({ end_datetime: '2026-11-20T09:30:00.000Z' })], hall)).toEqual([]);
    expect(unavailabilityConflicts(incoming, [block({ venue_id: 'VEN-002' })], hall)).toEqual([]);
  });
});

describe('F2 / SCRUM-126 unit — a submitted booking is picked up by one Venue Staff member', () => {
  const staff = (id, fields = {}) => ({ staff_id: id, role: 'VENUE_STAFF', ...fields });
  const pending = (id, fields = {}) => ({ booking_id: id, status: 'PENDING', assigned_staff_id: null, ...fields });

  test('TC-0905 [normal] exactly one active Venue Staff member is recorded with the time of assignment (AC1, AC2)', () => {
    const result = assignVenueStaff({ booking: pending('VB-1'), staff: [staff('S-B'), staff('S-A')], now: '2026-10-15T09:00:00.000Z' });
    expect(result).toEqual({
      ok: true,
      booking: { booking_id: 'VB-1', status: 'PENDING', assigned_staff_id: 'S-A', assigned_at: '2026-10-15T09:00:00.000Z' },
      queue: null
    });
    // Without a clock the server timestamp sentinel is written.
    expect(assignVenueStaff({ booking: pending('VB-2'), staff: [staff('S-A')] }).booking.assigned_at).toBe('SERVER_TIMESTAMP');
  });

  test('TC-0906 [normal] assignment rotates past the last person assigned and wraps round; one person may hold several (AC3, AC4)', () => {
    const people = [staff('S-A'), staff('S-B')];
    const next = (prior) => assignVenueStaff({ booking: pending('VB'), staff: people, priorAssignments: prior }).booking.assigned_staff_id;
    expect(next([])).toBe('S-A');
    expect(next(['S-A'])).toBe('S-B');
    expect(next(['S-A', 'S-B'])).toBe('S-A');
    // Someone no longer in the active list is skipped over when finding "last".
    expect(next(['S-B', 'S-GONE'])).toBe('S-A');
    expect(assignVenueStaff({ booking: pending('VB'), staff: [staff('S-A')], priorAssignments: ['S-A'] }).booking.assigned_staff_id).toBe('S-A');
  });

  test('TC-0907 [boundary] inactive staff and other roles are left out of the rotation (AC3)', () => {
    const result = assignVenueStaff({
      booking: pending('VB-1'),
      staff: [staff('S-A', { active: false }), staff('S-C', { role: 'EVENT_COORDINATOR' }), staff('S-B')]
    });
    expect(result.booking.assigned_staff_id).toBe('S-B');
  });

  test('TC-0908 [boundary] with no active Venue Staff the booking waits, visible, in the unassigned queue (AC5)', () => {
    const result = assignVenueStaff({ booking: pending('VB-1'), staff: [staff('S-A', { active: false })] });
    expect(result).toEqual({
      ok: true,
      booking: { booking_id: 'VB-1', status: 'PENDING', assigned_staff_id: null, assigned_at: null },
      queue: 'unassigned'
    });
    expect(assignVenueStaff({ booking: pending('VB-2') }).queue).toBe('unassigned');
    expect(unassignedBookingQueue([result.booking]).map((item) => item.booking_id)).toEqual(['VB-1']);
  });

  test('TC-0909 [conflict] a booking that already has a staff member is never given a second (AC1)', () => {
    const assigned = pending('VB-1', { assigned_staff_id: 'S-A' });
    expect(assignVenueStaff({ booking: assigned, staff: [staff('S-B')] }))
      .toEqual({ ok: false, reason: 'already_assigned', booking: assigned, queue: null });
  });

  test('TC-0910 [failure] there is nothing to assign without a booking', () => {
    expect(assignVenueStaff({ staff: [staff('S-A')] })).toEqual({ ok: false, reason: 'required' });
  });

  test('TC-0911 [boundary] the unassigned queue holds only pending, unassigned bookings, and is empty by default', () => {
    expect(unassignedBookingQueue()).toEqual([]);
    expect(unassignedBookingQueue([
      pending('P'),
      pending('lower', { status: 'pending' }),
      pending('ASSIGNED', { assigned_staff_id: 'S-A' }),
      pending('APPROVED', { status: 'APPROVED' }),
      pending('NO-STATUS', { status: undefined })
    ]).map((item) => item.booking_id)).toEqual(['P', 'lower']);
  });
});

describe('E11 / SCRUM-173 unit — take a venue out of use even when events are booked there', () => {
  const start = '2026-11-20T09:00:00.000Z';
  const end = '2026-11-20T13:00:00.000Z';
  const event = { event_id: 'EVT-A', coordinator_id: 'COORD-A', status: 'CONFIRMED', name: 'Partner Summit' };
  const approved = booking('A', { occupied_start: '2026-11-20T09:30:00.000Z', occupied_end: '2026-11-20T12:45:00.000Z' });
  const record = (overrides = {}) => recordVenueUnavailability({
    venueId: 'VEN-001', start, end, reason: 'Maintenance', bookings: [approved], events: [event],
    confirmed: true, staffId: 'STAFF-1', now: '2026-10-15T09:30:00.000Z', ...overrides
  });

  test('TC-0857 [normal] the period stores venue, window, reason, trimmed note, who and when (AC1)', () => {
    expect(record({ note: '  Lift inspection  ' }).period).toEqual({
      venue_id: 'VEN-001', start_datetime: start, end_datetime: end, reason: 'Maintenance',
      note: 'Lift inspection', created_by: 'STAFF-1', created_at: '2026-10-15T09:30:00.000Z'
    });
    expect(UNAVAILABILITY_REASONS).toEqual(['Maintenance', 'Equipment failure', 'Renovation', 'Safety concern', 'Other']);
  });

  test.each(['Maintenance', 'Equipment failure', 'Renovation', 'Safety concern'])(
    'TC-0858 [normal] %s is accepted without a note',
    (reason) => {
      const result = record({ reason, note: null, bookings: [], events: [] });
      expect(result.ok).toBe(true);
      expect(result.period.note).toBe('');
    }
  );

  test('TC-0859 [failure] Other needs a note; a reason outside the list is refused (AC1)', () => {
    expect(record({ reason: 'Other' })).toEqual({ ok: false, reason: 'note_required' });
    expect(record({ reason: 'Other', note: '   ' })).toEqual({ ok: false, reason: 'note_required' });
    expect(record({ reason: 'Other', note: null })).toEqual({ ok: false, reason: 'note_required' });
    expect(record({ reason: 'Other', note: 'Film shoot' }).ok).toBe(true);
    expect(record({ reason: 'Holiday' })).toEqual({ ok: false, reason: 'reason' });
  });

  test.each([
    ['ends before it starts', { start: end, end: start }],
    ['ends as it starts', { end: start }],
    ['has no start', { start: 'not a date' }],
    ['has no end', { end: undefined }]
  ])('TC-0860 [failure] a period that %s is refused', (_label, overrides) => {
    expect(record(overrides)).toEqual({ ok: false, reason: 'time_range' });
  });

  test('TC-0861 [conflict] an overlap with approved bookings lists them and waits for confirmation before saving (AC2)', () => {
    expect(record({ confirmed: undefined })).toEqual({ ok: false, reason: 'confirmation_required', affected: [approved] });
  });

  test('TC-0862 [normal] once confirmed, each affected booking is flagged for replacement and nothing else changes (AC3)', () => {
    const untouched = booking('OTHER', { venue_id: 'VEN-002' });
    const result = record({ bookings: [approved, untouched] });
    expect(result.bookings).toEqual([{ ...approved, replacement_status: REPLACEMENT_NEEDED }, untouched]);
    expect(REPLACEMENT_NEEDED).toBe('Venue unavailable - replacement needed');
    // The event is copied as it was: E11 itself cancels nothing and moves no status.
    expect(result.events).toEqual([event]);
    expect(result.events[0]).not.toBe(event);
  });

  test("TC-0863 [normal] the affected event's current coordinator is told the venue, period and reason (AC4)", () => {
    expect(record().notifications).toEqual([{
      user_id: 'COORD-A', event_id: 'EVT-A', venue_id: 'VEN-001',
      start_datetime: start, end_datetime: end, reason: 'Maintenance', type: 'VENUE_UNAVAILABLE'
    }]);
  });

  test('TC-0864 [failure] a booking whose event cannot be found, or has no coordinator, still produces a notice for nobody', () => {
    expect(record({ events: [] }).notifications[0].user_id).toBeNull();
    expect(record({ events: [{ event_id: 'EVT-A' }] }).notifications[0].user_id).toBeNull();
    // Called with no lists, there is nothing to flag and nobody to tell.
    const bare = recordVenueUnavailability({ venueId: 'VEN-001', start, end, reason: 'Renovation', staffId: 'STAFF-1' });
    expect(bare).toMatchObject({ ok: true, bookings: [], events: [], notifications: [] });
    expect(bare.period.created_at).toBe('SERVER_TIMESTAMP');
  });

  test('TC-0865 [boundary] pending, touching and other-venue bookings are not affected and need no confirmation (AC2, AC3)', () => {
    const pending = booking('P', { status: 'PENDING' });
    const touching = booking('T', { occupied_start: end, occupied_end: '2026-11-20T15:00:00.000Z' });
    const elsewhere = booking('E', { venue_id: 'VEN-002' });
    const result = record({ confirmed: false, bookings: [pending, touching, elsewhere] });
    expect(result.ok).toBe(true);
    expect(result.bookings).toEqual([pending, touching, elsewhere]);
    expect(result.notifications).toEqual([]);
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

  test('TC-0867 [normal] the period excludes the venue from a search whose window overlaps it, and only that venue (AC5)', () => {
    const period = record().period;
    const search = (fields) => searchBlockedByUnavailability({ venueId: 'VEN-001', unavailability: [period], ...fields });
    expect(search({ start: '2026-11-20T10:00:00.000Z', end: '2026-11-20T11:00:00.000Z' })).toBe(true);
    expect(search({ start: end, end: '2026-11-20T15:00:00.000Z' })).toBe(false);
    expect(search({ venueId: 'VEN-002', start, end })).toBe(false);
    expect(searchBlockedByUnavailability({ venueId: 'VEN-001', start, end })).toBe(false);
  });
});
