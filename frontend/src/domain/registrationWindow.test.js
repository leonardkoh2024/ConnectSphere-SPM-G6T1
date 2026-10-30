// H1 / SCRUM-139 — Open registration for my event. Unit tests over the pure rules in
// domain/registrationWindow.js: when registration may be set up, what the capacity
// and window must satisfy, and when an attempt to register is refused. The same
// rules are used by the registration service (server) and the Registration tab
// (client), so what the organiser is told on screen is what the server enforces.
//
// Decisions confirmed with Shi Han (22 Oct 2026), which the tests pin:
//   - the capacity ceiling is the SUM of the max_capacity of the venues of the event's
//     APPROVED bookings (F12 events can have several);
//   - H1 AC3 replaces B5's "capacity <= expected attendance" once the event is approved;
//   - with no approved booking yet the window is editable but capacity waits;
//   - AC5 (added to H1 on 22 Oct 2026): capacity cannot be set below the number of attendees
//     currently registered. Only status REGISTERED counts — Waitlisted, Withdrawn and
//     Cancelled do not hold a place.
// Times are Singapore time (as venueHolds.js does). The window is half-open: it is open
// from the open instant and closed from the close instant.

import {
  REGISTRATION_OPENABLE_STATUSES,
  capacityReductionNeedsAcknowledgement,
  registrationAttemptRefusal,
  registrationInstant,
  registrationPhase,
  registrationRecheckApplies,
  registrationReview,
  registrationSetupRefusal,
  validateRegistrationSettings,
  venueCapacityCeiling
} from './registrationWindow';

const NOW = new Date('2026-11-01T02:00:00Z'); // Sun 1 Nov 2026, 10:00 Singapore

const event = (overrides = {}) => ({
  status: 'APPROVED',
  registration_required: true,
  expected_attendance: 100,
  event_date: '2026-12-05',
  start_time: '09:00',
  end_time: '17:00',
  registration_capacity: 80,
  registration_open_date: '2026-11-10',
  registration_open_time: '09:00',
  registration_close_date: '2026-12-01',
  registration_close_time: '17:00',
  ...overrides
});

const good = {
  registrationCapacity: '120',
  registrationOpenDate: '2026-11-10',
  registrationOpenTime: '09:00',
  registrationCloseDate: '2026-12-01',
  registrationCloseTime: '17:00'
};

const check = (overrides = {}, context = {}) =>
  validateRegistrationSettings({ ...good, ...overrides }, { event: event(), ceiling: 120, registeredCount: 0, now: NOW, ...context });

describe('H1 SCRUM-139 when registration may be set up (AC1, AC2)', () => {
  test('TC-1365 H1 AC1 registration can be opened from Approved onwards: Approved, Planning, Safety Review and Confirmed', () => {
    expect(REGISTRATION_OPENABLE_STATUSES).toEqual(['APPROVED', 'PLANNING', 'SAFETY_REVIEW', 'CONFIRMED']);
    REGISTRATION_OPENABLE_STATUSES.forEach((status) =>
      expect(registrationSetupRefusal(event({ status }), NOW)).toBeNull());
  });

  test('TC-1366 H1 AC1 before approval the organiser is told to wait for approval', () => {
    ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].forEach((status) => {
      const refusal = registrationSetupRefusal(event({ status }), NOW);
      expect(refusal.reason).toBe('status');
      expect(refusal.message).toBe('Registration can be opened once your event is approved.');
    });
  });

  test('TC-1367 H1 AC1 a Completed, Cancelled or Rejected event can never open registration', () => {
    ['COMPLETED', 'CANCELLED', 'REJECTED'].forEach((status) => {
      const refusal = registrationSetupRefusal(event({ status }), NOW);
      expect(refusal.reason).toBe('status');
      expect(refusal.message).toBe('Registration cannot be changed for a completed, cancelled or rejected event.');
    });
  });

  test('TC-1368 H1 AC1 an event without the registration flag is refused, whatever its status', () => {
    [false, null, undefined].forEach((flag) => {
      const refusal = registrationSetupRefusal(event({ registration_required: flag }), NOW);
      expect(refusal.reason).toBe('flag_off');
      expect(refusal.message).toBe('This event does not use attendee registration.');
    });
    // The flag is judged first: an unflagged Draft is "not enabled", not "not approved".
    expect(registrationSetupRefusal(event({ status: 'DRAFT', registration_required: false }), NOW).reason).toBe('flag_off');
  });

  test('TC-1369 H1 AC2 setup can be changed before the window opens, while it is open, and up to its last moment', () => {
    [
      new Date('2026-11-05T00:00:00Z'), // before it opens
      new Date('2026-11-20T00:00:00Z'), // while open
      new Date('2026-12-01T08:59:59Z') // one second before it closes (17:00 Singapore = 09:00Z)
    ].forEach((now) => expect(registrationSetupRefusal(event(), now)).toBeNull());
  });

  test('TC-1370 H1 AC2 once the window has closed, capacity and window are locked — at the close instant itself and after', () => {
    [new Date('2026-12-01T09:00:00Z'), new Date('2026-12-02T00:00:00Z')].forEach((now) => {
      const refusal = registrationSetupRefusal(event(), now);
      expect(refusal.reason).toBe('closed');
      expect(refusal.message).toBe('Registration has closed, so its capacity and window can no longer be changed.');
    });
  });

  test('TC-1371 H1 AC2 a flagged event with no window yet can be set up for the first time', () => {
    const blank = event({ registration_capacity: null, registration_open_date: null, registration_open_time: null, registration_close_date: null, registration_close_time: null });
    expect(registrationSetupRefusal(blank, NOW)).toBeNull();
    expect(registrationPhase(blank, NOW)).toBe('NOT_SET');
  });

  test('TC-1372 H1 AC2 the window is read in Singapore time, so 17:00 closes at 09:00 UTC', () => {
    expect(registrationInstant('2026-12-01', '17:00')).toEqual(new Date('2026-12-01T09:00:00Z'));
    expect(registrationInstant('2026-11-10', '00:30')).toEqual(new Date('2026-11-09T16:30:00Z'));
    expect(registrationInstant('', '17:00')).toBeNull();
    expect(registrationInstant('2026-12-01', '')).toBeNull();
    expect(registrationInstant('not-a-date', '17:00')).toBeNull();
  });

  test('TC-1373 H1 AC2 the phase is Not set, Scheduled, Open or Closed; Open from the open instant, Closed from the close instant', () => {
    expect(registrationPhase(event(), new Date('2026-11-10T00:59:59Z'))).toBe('SCHEDULED');
    expect(registrationPhase(event(), new Date('2026-11-10T01:00:00Z'))).toBe('OPEN');
    expect(registrationPhase(event(), new Date('2026-12-01T08:59:59Z'))).toBe('OPEN');
    expect(registrationPhase(event(), new Date('2026-12-01T09:00:00Z'))).toBe('CLOSED');
  });
});

describe('H1 SCRUM-139 the capacity must fit the venue (AC3)', () => {
  test('TC-1374 H1 AC3 a valid capacity and window are accepted and returned as the fields to store', () => {
    const result = check();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.values).toEqual({
      registration_capacity: 120,
      registration_open_date: '2026-11-10',
      registration_open_time: '09:00',
      registration_close_date: '2026-12-01',
      registration_close_time: '17:00',
      registration_opens_at: new Date('2026-11-10T01:00:00Z'),
      registration_closes_at: new Date('2026-12-01T09:00:00Z')
    });
  });

  test('TC-1375 H1 AC3 the capacity may equal the venue capacity but not exceed it', () => {
    expect(check({ registrationCapacity: '120' }).ok).toBe(true);
    const over = check({ registrationCapacity: '121' });
    expect(over.ok).toBe(false);
    expect(over.errors.registrationCapacity).toBe('Registration capacity cannot exceed the venue capacity of 120.');
  });

  test('TC-1376 H1 AC3 the capacity must be a whole number greater than zero', () => {
    ['', '0', '-5', '2.5', 'abc'].forEach((value) => {
      const result = check({ registrationCapacity: value });
      expect(result.ok).toBe(false);
      expect(result.errors.registrationCapacity).toBe('Registration capacity must be a whole number greater than zero.');
    });
  });

  test("TC-1377 H1 AC3 B5's expected-attendance ceiling no longer applies once the venue is approved: 120 is fine for a 100-person event", () => {
    const result = check({ registrationCapacity: '120' }, { event: event({ expected_attendance: 100 }) });
    expect(result.ok).toBe(true);
  });

  test('TC-1378 H1 AC3 with no approved venue booking the capacity cannot be changed, but the same capacity can be kept', () => {
    const changed = check({ registrationCapacity: '90' }, { ceiling: null });
    expect(changed.ok).toBe(false);
    expect(changed.errors.registrationCapacity).toBe('Capacity can be set once a venue booking has been approved.');

    const kept = check({ registrationCapacity: '80', registrationOpenDate: '2026-11-12' }, { ceiling: null });
    expect(kept.ok).toBe(true);
    expect(kept.values.registration_capacity).toBe(80);
    expect(kept.values.registration_open_date).toBe('2026-11-12');
  });

  test('TC-1379 H1 AC3 the ceiling is the sum of the venues of the approved bookings', () => {
    const venues = { v1: { max_capacity: 100 }, v2: { max_capacity: 40 }, v3: { max_capacity: 500 } };
    const approved = (venue_id) => ({ booking_id: `b-${venue_id}`, venue_id, status: 'APPROVED' });
    expect(venueCapacityCeiling([approved('v1')], venues)).toBe(100);
    expect(venueCapacityCeiling([approved('v1'), approved('v2')], venues)).toBe(140);
  });

  test('TC-1380 H1 AC3 only approved bookings count: pending, held, rejected, withdrawn and released ones add nothing', () => {
    const venues = { v1: { max_capacity: 100 }, v2: { max_capacity: 40 } };
    const bookings = [
      { booking_id: 'a', venue_id: 'v1', status: 'APPROVED' },
      ...['PENDING', 'HELD', 'REJECTED', 'WITHDRAWN', 'RELEASED', 'EXPIRED'].map((status) => ({ booking_id: status, venue_id: 'v2', status }))
    ];
    expect(venueCapacityCeiling(bookings, venues)).toBe(100);
  });

  test('TC-1381 H1 AC3 a venue booked twice for the same event counts once, and no approved booking means no ceiling', () => {
    const venues = { v1: { max_capacity: 100 } };
    const twice = [{ booking_id: 'a', venue_id: 'v1', status: 'APPROVED' }, { booking_id: 'b', venue_id: 'v1', status: 'APPROVED' }];
    expect(venueCapacityCeiling(twice, venues)).toBe(100);
    expect(venueCapacityCeiling([], venues)).toBeNull();
    expect(venueCapacityCeiling([{ booking_id: 'p', venue_id: 'v1', status: 'PENDING' }], venues)).toBeNull();
  });
});

describe('H1 SCRUM-139 the open and close date/time (AC2)', () => {
  test('TC-1382 H1 AC2 all four of open date, open time, close date and close time are required', () => {
    ['registrationOpenDate', 'registrationOpenTime', 'registrationCloseDate', 'registrationCloseTime'].forEach((field) => {
      const result = check({ [field]: '' });
      expect(result.ok).toBe(false);
      expect(result.errors.registrationWindow).toBe('Registration open and close date/time are required when registration is enabled.');
    });
  });

  test('TC-1383 H1 AC2 the window must close after it opens — closing at the opening instant is refused', () => {
    const same = check({ registrationCloseDate: '2026-11-10', registrationCloseTime: '09:00' });
    expect(same.errors.registrationCloseDate).toBe('Registration close date/time must be after registration open date/time.');
    const before = check({ registrationCloseDate: '2026-11-09' });
    expect(before.errors.registrationCloseDate).toBe('Registration close date/time must be after registration open date/time.');
    expect(check({ registrationCloseDate: '2026-11-10', registrationCloseTime: '09:01' }).ok).toBe(true);
  });

  test('TC-1384 H1 AC2 registration must close at or before the event starts (B5), to the minute', () => {
    expect(check({ registrationCloseDate: '2026-12-05', registrationCloseTime: '09:00' }).ok).toBe(true);
    const late = check({ registrationCloseDate: '2026-12-05', registrationCloseTime: '09:01' });
    expect(late.errors.registrationCloseDate).toBe('Registration close date/time must be at or before the event start.');
  });

  test('TC-1385 H1 AC2 the new close time must be in the future, but the window may already have opened', () => {
    const past = check({ registrationOpenDate: '2026-10-01', registrationCloseDate: '2026-10-31', registrationCloseTime: '17:00' });
    expect(past.ok).toBe(false);
    expect(past.errors.registrationCloseDate).toBe('Registration close date/time must be in the future.');
    expect(check({ registrationOpenDate: '2026-10-01' }).ok).toBe(true);
  });

  test('TC-1386 H1 AC2 every problem is reported together, not one at a time', () => {
    const result = check({ registrationCapacity: '500', registrationCloseDate: '2026-11-09' });
    expect(Object.keys(result.errors).sort()).toEqual(['registrationCapacity', 'registrationCloseDate']);
    expect(result.values).toBeUndefined();
  });
});

describe('H1 SCRUM-139 registrations outside the open window are refused (AC4)', () => {
  test('TC-1387 H1 AC4 an attempt before the window opens is refused as not open yet', () => {
    const refusal = registrationAttemptRefusal(event(), new Date('2026-11-10T00:59:59Z'));
    expect(refusal.reason).toBe('not_open_yet');
    expect(refusal.message).toBe('Registration is not open yet.');
  });

  test('TC-1388 H1 AC4 an attempt inside the window is accepted, including the opening instant', () => {
    expect(registrationAttemptRefusal(event(), new Date('2026-11-10T01:00:00Z'))).toBeNull();
    expect(registrationAttemptRefusal(event(), new Date('2026-11-25T00:00:00Z'))).toBeNull();
    expect(registrationAttemptRefusal(event(), new Date('2026-12-01T08:59:59Z'))).toBeNull();
  });

  test('TC-1389 H1 AC4 an attempt at the closing instant or after is refused as closed', () => {
    [new Date('2026-12-01T09:00:00Z'), new Date('2026-12-03T00:00:00Z')].forEach((now) => {
      const refusal = registrationAttemptRefusal(event(), now);
      expect(refusal.reason).toBe('closed');
      expect(refusal.message).toBe('Registration has closed.');
    });
  });

  test('TC-1390 H1 AC4 an event with no flag, no window, or a status that cannot take registrations is refused', () => {
    const inside = new Date('2026-11-25T00:00:00Z');
    expect(registrationAttemptRefusal(event({ registration_required: false }), inside).reason).toBe('not_enabled');
    expect(registrationAttemptRefusal(event({ registration_open_date: null, registration_close_date: null }), inside).reason).toBe('not_open_yet');
    ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'COMPLETED', 'CANCELLED', 'REJECTED']
      .forEach((status) => expect(registrationAttemptRefusal(event({ status }), inside).reason).toBe('status'));
  });
});

describe('H1 SCRUM-139 the capacity cannot fall below the people already registered (AC5)', () => {
  test('TC-1391 H1 AC5 a capacity equal to the number registered is accepted; one below it is refused with the count', () => {
    expect(check({ registrationCapacity: '90' }, { registeredCount: 90 }).ok).toBe(true);
    const below = check({ registrationCapacity: '89' }, { registeredCount: 90 });
    expect(below.ok).toBe(false);
    expect(below.errors.registrationCapacity).toBe('Registration capacity cannot be less than the 90 people already registered.');
  });

  test('TC-1392 H1 AC5 a capacity that is not a whole number above zero gets that message, not the registered-count one', () => {
    ['0', '-5', '2.5', 'abc', ''].forEach((value) => {
      const result = check({ registrationCapacity: value }, { registeredCount: 90 });
      expect(result.errors.registrationCapacity).toBe('Registration capacity must be a whole number greater than zero.');
    });
  });

  test('TC-1393 H1 AC5 with nobody registered any capacity from 1 up to the venue limit is accepted', () => {
    expect(check({ registrationCapacity: '1' }, { registeredCount: 0 }).ok).toBe(true);
    expect(check({ registrationCapacity: '120' }, { registeredCount: 0 }).ok).toBe(true);
  });

  test('TC-1394 H1 AC5 AC3 the capacity must sit between the registered count and the venue capacity: each limit has its own message', () => {
    const context = { registeredCount: 90, ceiling: 100 };
    expect(check({ registrationCapacity: '95' }, context).ok).toBe(true);
    expect(check({ registrationCapacity: '100' }, context).ok).toBe(true);
    expect(check({ registrationCapacity: '101' }, context).errors.registrationCapacity)
      .toBe('Registration capacity cannot exceed the venue capacity of 100.');
    expect(check({ registrationCapacity: '89' }, context).errors.registrationCapacity)
      .toBe('Registration capacity cannot be less than the 90 people already registered.');
  });

  test('TC-1395 H1 AC5 a window change that leaves the capacity as it is is never blocked by the registered count', () => {
    const result = check({ registrationCapacity: '80', registrationOpenDate: '2026-11-12' }, { registeredCount: 80 });
    expect(result.ok).toBe(true);
  });
});

// I3 / SCRUM-149 — an applied change to the event may leave its registration needing a
// second look. AC4: lowering the capacity below the people already registered needs an
// explicit acknowledgement (the coordinator's Edit event form asks for it). AC5: after a
// change to the date, start time, expected attendance or venue, the close time must still
// come before the event starts and the capacity must still fit the approved venues. The
// result only says "needs review"; nothing here edits, closes or cancels a registration.
describe('I3 SCRUM-149 a lower registration capacity needs an explicit acknowledgement (AC4)', () => {
  test.each([
    ['lowered below the registered count', { oldCapacity: 100, newCapacity: 40, registeredCount: 60 }, true],
    ['lowered to exactly the registered count', { oldCapacity: 100, newCapacity: 60, registeredCount: 60 }, false],
    ['lowered but still above the registered count', { oldCapacity: 100, newCapacity: 80, registeredCount: 60 }, false],
    ['unchanged', { oldCapacity: 40, newCapacity: 40, registeredCount: 60 }, false],
    ['raised', { oldCapacity: 40, newCapacity: 50, registeredCount: 60 }, false],
    ['lowered with nobody registered', { oldCapacity: 100, newCapacity: 1, registeredCount: 0 }, false]
  ])('TC-2002 I3 capacity %s', (_name, input, expected) => {
    expect(capacityReductionNeedsAcknowledgement(input)).toBe(expected);
  });

  test('TC-2003 I3 a capacity that was never set has nothing to reduce', () => {
    expect(capacityReductionNeedsAcknowledgement({ oldCapacity: null, newCapacity: 10, registeredCount: 60 })).toBe(false);
    expect(capacityReductionNeedsAcknowledgement({ oldCapacity: undefined, newCapacity: 10, registeredCount: 60 })).toBe(false);
  });
});

describe('I3 SCRUM-149 the registration window and capacity are re-checked, never edited (AC5)', () => {
  const venues = { v1: { max_capacity: 120 }, v2: { max_capacity: 80 } };
  const approved = [{ venue_id: 'v1', status: 'APPROVED' }];
  const changed = {
    registration_required: true,
    event_date: '2026-11-04',
    start_time: '09:00',
    registration_close_date: '2026-11-03',
    registration_close_time: '18:00',
    registration_capacity: 100
  };

  test('TC-2004 I3 the re-check runs for a changed date, start time, attendance or venue, and for nothing else', () => {
    expect(registrationRecheckApplies({ event_date: {} })).toBe(true);
    expect(registrationRecheckApplies({ start_time: {} })).toBe(true);
    expect(registrationRecheckApplies({ expected_attendance: {} })).toBe(true);
    expect(registrationRecheckApplies({ preferred_location: {} })).toBe(true);
    expect(registrationRecheckApplies({ required_layout: {} })).toBe(true);
    expect(registrationRecheckApplies({ end_time: {} })).toBe(false);
    expect(registrationRecheckApplies({ accessibility_notes: {} })).toBe(false);
    expect(registrationRecheckApplies({})).toBe(false);
  });

  test('TC-2005 I3 a window that still closes before the event, with capacity inside the venue, needs no review', () => {
    expect(registrationReview({ event: changed, bookings: approved, venues })).toEqual({ needsReview: false, reasons: [] });
  });

  test('TC-2006 I3 a close time after the new event start needs review', () => {
    const moved = { ...changed, event_date: '2026-11-03', start_time: '09:00' };
    expect(registrationReview({ event: moved, bookings: approved, venues }))
      .toEqual({ needsReview: true, reasons: ['CLOSES_AFTER_START'] });
  });

  test('TC-2007 I3 closing exactly at the start is not after it', () => {
    const edge = { ...changed, event_date: '2026-11-03', start_time: '18:00' };
    expect(registrationReview({ event: edge, bookings: approved, venues }).needsReview).toBe(false);
  });

  test('TC-2008 I3 a close only minutes after a very early start is still after it', () => {
    const early = { ...changed, event_date: '2026-11-04', start_time: '00:30', registration_close_date: '2026-11-04', registration_close_time: '00:45' };
    expect(registrationReview({ event: early, bookings: approved, venues }).reasons).toEqual(['CLOSES_AFTER_START']);
  });

  test('TC-2009 I3 a capacity above the venue capacity of the approved bookings needs review', () => {
    expect(registrationReview({ event: { ...changed, registration_capacity: 130 }, bookings: approved, venues }))
      .toEqual({ needsReview: true, reasons: ['CAPACITY_ABOVE_VENUE'] });
  });

  test('TC-2010 I3 the venue capacity is the combined capacity of approved bookings only, a venue counted once', () => {
    const bookings = [
      { venue_id: 'v1', status: 'APPROVED' },
      { venue_id: 'v1', status: 'APPROVED' },
      { venue_id: 'v2', status: 'APPROVED' },
      { venue_id: 'v2', status: 'HELD' }
    ];
    expect(registrationReview({ event: { ...changed, registration_capacity: 200 }, bookings, venues }).needsReview).toBe(false);
    expect(registrationReview({ event: { ...changed, registration_capacity: 201 }, bookings, venues }).reasons).toEqual(['CAPACITY_ABOVE_VENUE']);
  });

  test('TC-2011 I3 both problems are reported together, window first', () => {
    const both = { ...changed, event_date: '2026-11-03', start_time: '09:00', registration_capacity: 500 };
    expect(registrationReview({ event: both, bookings: approved, venues }).reasons)
      .toEqual(['CLOSES_AFTER_START', 'CAPACITY_ABOVE_VENUE']);
  });

  test('TC-2012 I3 no approved booking means no venue limit to compare with', () => {
    expect(registrationReview({ event: { ...changed, registration_capacity: 9999 }, bookings: [], venues }).needsReview).toBe(false);
    expect(registrationReview({ event: { ...changed, registration_capacity: 9999 }, bookings: [{ venue_id: 'v1', status: 'HELD' }], venues }).needsReview).toBe(false);
  });

  test('TC-2013 I3 an event without registration, or with no close time set, has nothing to review', () => {
    expect(registrationReview({ event: { ...changed, registration_required: false, registration_capacity: 999 }, bookings: approved, venues }).needsReview).toBe(false);
    const unset = { ...changed, registration_close_date: undefined, registration_close_time: undefined, event_date: '2026-11-01' };
    expect(registrationReview({ event: unset, bookings: approved, venues }).reasons).toEqual([]);
  });
});
