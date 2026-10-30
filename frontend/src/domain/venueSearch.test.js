import {
  activeFilters,
  assessVenueSuitability,
  applyFilters,
  canSearchVenues,
  canViewCatalogue,
  capacityFits,
  daysFromToday,
  emptyFilters,
  facilitiesLabel,
  isOccupied,
  listCatalogue,
  prefillFilters,
  prefillSearch,
  searchVenues,
  venueRecord
} from './venueSearch';
import { ROLES } from './roles';

const venue = (id, fields) => ({ venue_id: id, ...fields });

const hallA = venue('VEN-001', {
  name: 'Hall A', location: 'CENTRAL', max_capacity: 500,
  facilities: ['WIFI', 'STAGE'], layouts: ['THEATRE', 'CLASSROOM'],
  accessibility: ['WHEELCHAIR_ACCESS'],
  operating_hours: [{ weekday: 'MONDAY', opens_at: '09:00', closes_at: '18:00' }]
});

describe('E2 / SCRUM-118 browse the venue catalogue', () => {
  test('TC-0559 every venue is listed with its four summary fields', () => {
    const rows = listCatalogue([
      hallA,
      venue('VEN-002', { name: 'Studio B', location: 'EAST', max_capacity: 40, facilities: ['WIFI'] }),
      venue('VEN-003', { name: 'Atrium', location: 'WEST', max_capacity: 120, facilities: ['AIR_CONDITIONING'] })
    ]);
    expect(rows).toHaveLength(3);
    rows.forEach((row) => {
      expect(row.name).toBeTruthy();
      expect(row.location).toBeTruthy();
      expect(typeof row.max_capacity).toBe('number');
      expect(Array.isArray(row.headline_facilities)).toBe(true);
    });
  });

  test('TC-0560 a venue with no facilities still lists cleanly', () => {
    const [row] = listCatalogue([venue('VEN-004', { name: 'Annex', location: 'NORTH', max_capacity: 20, facilities: [] })]);
    expect(row.headline_facilities).toEqual([]);
    expect(facilitiesLabel(row.headline_facilities)).toBe('None listed');
  });

  test('TC-0561 a venue full record includes layouts, accessibility and hours', () => {
    const record = venueRecord(hallA);
    expect(record.layouts).toEqual(['THEATRE', 'CLASSROOM']);
    expect(record.accessibility).toEqual(['WHEELCHAIR_ACCESS']);
    expect(record.operating_hours).toEqual([{ weekday: 'MONDAY', opens_at: '09:00', closes_at: '18:00' }]);
  });

  test('TC-0562 coordinators and venue staff may view the catalogue', () => {
    expect(canViewCatalogue(ROLES.COORDINATOR)).toBe(true);
    expect(canViewCatalogue(ROLES.VENUE_STAFF)).toBe(true);
  });

  test('TC-0563 the other three roles cannot', () => {
    expect(canViewCatalogue(ROLES.ORGANISER)).toBe(false);
    expect(canViewCatalogue(ROLES.ATTENDEE)).toBe(false);
    expect(canViewCatalogue(ROLES.TECH_SUPPORT)).toBe(false);
  });
});

describe('E5 / SCRUM-121 find venues that fit my event', () => {
  const window = { event_date: '2026-10-23', start_time: '09:00', end_time: '17:00', expected_attendance: 180 };

  test('TC-0682 search opened from an event arrives pre-filled', () => {
    expect(prefillSearch({ event_date: window.event_date, start_time: '09:00', end_time: '17:00', expected_attendance: 180 })).toEqual({
      event_date: window.event_date, start_time: '09:00', end_time: '17:00', expected_attendance: 180
    });
  });

  test('TC-0683 a venue occupied for part of the window is excluded', () => {
    const result = searchVenues({
      venues: [venue('VEN-001', { name: 'Hall A', max_capacity: 500 })],
      window,
      bookings: [{ venue_id: 'VEN-001', start_time: '10:00', end_time: '12:00', status: 'Approved' }]
    });
    expect(result.matches.map((item) => item.venue_id)).toEqual([]);
  });

  test('TC-0684 a booking that ends when the window starts does not exclude', () => {
    const result = searchVenues({
      venues: [venue('VEN-001', { name: 'Hall A', max_capacity: 500 })],
      window,
      bookings: [{ venue_id: 'VEN-001', start_time: '07:00', end_time: '09:00', status: 'Approved' }]
    });
    expect(result.matches.map((item) => item.venue_id)).toEqual(['VEN-001']);
  });

  test('TC-0685 a venue blocked for maintenance is excluded', () => {
    const result = searchVenues({
      venues: [venue('VEN-002', { name: 'Studio B', max_capacity: 200 })],
      window,
      unavailability: [{ venue_id: 'VEN-002', start_time: '08:00', end_time: '18:00', reason: 'Maintenance' }]
    });
    expect(result.matches).toEqual([]);
  });

  test('TC-0686 a multi-date unavailability period blocks the full interval and allows a touching endpoint', () => {
    const result = searchVenues({
      venues: [venue('VEN-BLOCKED', { max_capacity: 500 }), venue('VEN-FREE', { max_capacity: 500 })],
      window,
      unavailability: [
        { venue_id: 'VEN-BLOCKED', start_datetime: '2026-10-22T18:00:00', end_datetime: '2026-10-23T10:00:00' },
        { venue_id: 'VEN-FREE', start_datetime: '2026-10-23T01:00:00', end_datetime: '2026-10-23T09:00:00' }
      ]
    });
    expect(result.matches.map((item) => item.venue_id)).toEqual(['VEN-FREE']);
  });

  test('TC-0687 capacity equal to attendance is a fit', () => {
    expect(capacityFits({ max_capacity: 180 }, 180)).toBe(true);
    expect(searchVenues({ venues: [venue('VEN-003', { max_capacity: 180 })], window }).matches).toHaveLength(1);
  });

  test('TC-0688 one seat short is excluded', () => {
    expect(searchVenues({ venues: [venue('VEN-004', { max_capacity: 179 })], window }).matches).toHaveLength(0);
  });

  test('TC-0689 the shortlist is exactly the venues passing both tests', () => {
    const result = searchVenues({
      venues: [
        venue('VEN-OCC', { max_capacity: 400 }),
        venue('VEN-SMALL', { max_capacity: 50 }),
        venue('VEN-BOTH', { max_capacity: 10 }),
        venue('VEN-OK', { max_capacity: 200 })
      ],
      window,
      bookings: [
        { venue_id: 'VEN-OCC', start_time: '10:00', end_time: '12:00', status: 'Approved' },
        { venue_id: 'VEN-BOTH', start_time: '09:00', end_time: '17:00', status: 'Approved' }
      ]
    });
    expect(result.matches.map((item) => item.venue_id)).toEqual(['VEN-OK']);
  });

  test('TC-0690 zero results report per-criterion exclusion counts', () => {
    const result = searchVenues({
      venues: [
        venue('VEN-OCC', { max_capacity: 400 }),
        venue('VEN-SMALL', { max_capacity: 50 }),
        venue('VEN-BOTH', { max_capacity: 10 })
      ],
      window,
      bookings: [
        { venue_id: 'VEN-OCC', start_time: '10:00', end_time: '12:00', status: 'Approved' },
        { venue_id: 'VEN-BOTH', start_time: '09:00', end_time: '17:00', status: 'Approved' }
      ]
    });
    expect(result.count).toBe(0);
    expect(result.excluded.occupied).toBe(2);
    expect(result.excluded.capacity_below).toBe(2);
    expect(result.excluded.occupied + result.excluded.capacity_below).not.toBe(3);
  });

  test('TC-0691 venue search belongs to coordinators', () => {
    expect(canSearchVenues(ROLES.COORDINATOR)).toBe(true);
    expect(canSearchVenues(ROLES.ORGANISER)).toBe(false);
    expect(canSearchVenues(ROLES.VENUE_STAFF)).toBe(false);
  });
});

describe('E6 / SCRUM-122 narrow the shortlist', () => {
  const catalogue = [
    venue('X', { location: 'CENTRAL', max_capacity: 80, facilities: ['WIFI'], accessibility: [], layouts: ['BOARDROOM'] }),
    venue('Y', { location: 'EAST', max_capacity: 200, facilities: ['POWER_POINTS'], accessibility: ['WHEELCHAIR_ACCESS'], layouts: ['THEATRE'] }),
    venue('Z', { location: 'CENTRAL', max_capacity: 180, facilities: ['WIFI', 'POWER_POINTS'], accessibility: ['WHEELCHAIR_ACCESS'], layouts: ['THEATRE'] }),
    venue('P', { location: 'WEST', max_capacity: 99, facilities: ['WIFI'], accessibility: [], layouts: ['CLASSROOM'] }),
    venue('Q', { location: 'NORTH', max_capacity: 301, facilities: ['POWER_POINTS'], accessibility: [], layouts: ['CLASSROOM'] }),
    venue('R', { location: 'SOUTH', max_capacity: 300, facilities: ['WIFI', 'POWER_POINTS'], accessibility: ['LIFT'], layouts: ['BANQUET'] }),
    venue('S99', { location: 'EAST', max_capacity: 99, facilities: [], accessibility: [], layouts: [] }),
    venue('S100', { location: 'EAST', max_capacity: 100, facilities: [], accessibility: [], layouts: [] }),
    venue('S300', { location: 'EAST', max_capacity: 300, facilities: [], accessibility: [], layouts: [] }),
    venue('S301', { location: 'EAST', max_capacity: 301, facilities: [], accessibility: [], layouts: [] })
  ];

  test('TC-0699 each of the five filters works on its own', () => {
    expect(applyFilters(catalogue, { ...emptyFilters(), location: 'CENTRAL' }).map((item) => item.venue_id)).toEqual(['X', 'Z']);
    expect(applyFilters(catalogue, { ...emptyFilters(), min_capacity: 100, max_capacity: 300 }).map((item) => item.venue_id)).toEqual(['Y', 'Z', 'R', 'S100', 'S300']);
    expect(applyFilters(catalogue, { ...emptyFilters(), facilities: ['WIFI'] }).map((item) => item.venue_id)).toEqual(['X', 'Z', 'P', 'R']);
    expect(applyFilters(catalogue, { ...emptyFilters(), accessibility: ['WHEELCHAIR_ACCESS'] }).map((item) => item.venue_id)).toEqual(['Y', 'Z']);
    expect(applyFilters(catalogue, { ...emptyFilters(), layout: 'THEATRE' }).map((item) => item.venue_id)).toEqual(['Y', 'Z']);
  });

  describe('E7 venue suitability assessment', () => {
    const event = {
      event_date: '2026-10-05',
      start_time: '09:00',
      end_time: '17:00',
      expected_attendance: 101,
      facilities: ['WIFI', 'STAGE'],
      accessibility: ['LIFT'],
      layout: 'THEATRE'
    };
    const venue = {
      name: 'Meeting Room',
      max_capacity: 100,
      facilities: ['WIFI'],
      accessibility: [],
      layouts: ['BOARDROOM'],
      operating_hours: [{ weekday: 'MONDAY', opens_at: '10:00', closes_at: '16:00' }]
    };

    test('TC-0708 the outcome identifies every missing or failing criterion', () => {
      const result = assessVenueSuitability({ venue, event });

      expect(result.suitable).toBe(false);
      expect(result.criteria.filter((criterion) => !criterion.passed).map((criterion) => criterion.label)).toEqual([
        'Attendance and capacity',
        'Required facility: STAGE',
        'Accessibility feature: LIFT',
        'Required room layout',
        'Requested time within operating hours'
      ]);
      expect(result.criteria.find((criterion) => criterion.key === 'facility-WIFI').passed).toBe(true);
    });

    test('TC-0709 attendance equal to capacity and an operating-hours boundary are suitable', () => {
      const result = assessVenueSuitability({
        venue: {
          ...venue,
          operating_hours: [{ weekday: 'MONDAY', opens_at: '09:00', closes_at: '17:00' }]
        },
        event: {
          ...event,
          expected_attendance: 100,
          start_time: '09:00',
          end_time: '17:00',
          facilities: [],
          accessibility: [],
          layout: ''
        }
      });

      expect(result.suitable).toBe(true);
      expect(result.criteria).toHaveLength(5);
      expect(result.criteria.every((criterion) => criterion.passed)).toBe(true);
    });

    test('TC-0710 a requested time outside operating hours fails, including when hours are unlisted', () => {
      const outsideHours = assessVenueSuitability({
        venue: { ...venue, operating_hours: [{ weekday: 'MONDAY', opens_at: '09:00', closes_at: '17:00' }] },
        event: { ...event, start_time: '08:59', end_time: '10:00', facilities: [], accessibility: [], layout: '' }
      });
      const missingHours = assessVenueSuitability({
        venue: { ...venue, operating_hours: [] },
        event: { ...event, facilities: [], accessibility: [], layout: '' }
      });

      expect(outsideHours.criteria.find((criterion) => criterion.key === 'operating-hours')).toMatchObject({ passed: false });
      expect(missingHours.criteria.find((criterion) => criterion.key === 'operating-hours').detail).toMatch(/no operating hours are listed/i);
    });
  });

  test('TC-0700 filters are AND, not OR', () => {
    expect(applyFilters(catalogue, { ...emptyFilters(), location: 'CENTRAL', layout: 'THEATRE' }).map((item) => item.venue_id)).toEqual(['Z']);
  });

  test('TC-0701 a capacity range includes both ends', () => {
    const ranged = catalogue.filter((item) => ['S99', 'S100', 'S300', 'S301'].includes(item.venue_id));
    expect(applyFilters(ranged, { ...emptyFilters(), min_capacity: 100, max_capacity: 300 }).map((item) => item.venue_id)).toEqual(['S100', 'S300']);
  });

  test('TC-0702 two required facilities means both', () => {
    const trio = catalogue.filter((item) => ['P', 'Q', 'R'].includes(item.venue_id));
    expect(applyFilters(trio, { ...emptyFilters(), facilities: ['WIFI', 'POWER_POINTS'] }).map((item) => item.venue_id)).toEqual(['R']);
  });

  test('TC-0703 the active filter set is visible', () => {
    expect(activeFilters({ ...emptyFilters(), location: 'CENTRAL', layout: 'THEATRE' })).toEqual([
      { key: 'location', value: 'CENTRAL' },
      { key: 'layout', value: 'THEATRE' }
    ]);
  });

  test('TC-0704 one action clears everything', () => {
    expect(activeFilters(emptyFilters())).toEqual([]);
    expect(applyFilters(catalogue, emptyFilters())).toHaveLength(catalogue.length);
  });

  test('TC-0705 the count tracks applying and removing a filter', () => {
    const shortlist = catalogue.slice(0, 8);
    const afterLocation = applyFilters(shortlist, { ...emptyFilters(), location: 'CENTRAL' });
    const afterBoth = applyFilters(shortlist, { ...emptyFilters(), location: 'CENTRAL', layout: 'THEATRE' });
    expect(afterLocation.length).toBeLessThan(8);
    expect(afterBoth.length).toBeLessThan(afterLocation.length);
    expect(applyFilters(shortlist, { ...emptyFilters(), location: 'CENTRAL' })).toHaveLength(afterLocation.length);
  });

  test('TC-0706 filters can exclude everything and clearing restores the list', () => {
    expect(applyFilters(catalogue, { ...emptyFilters(), location: 'CENTRAL', layout: 'BANQUET' })).toHaveLength(0);
    expect(applyFilters(catalogue, emptyFilters())).toHaveLength(catalogue.length);
  });
});

// edge inputs to the catalogue, search and suitability rules.
// Dates are built in local time, as isOccupied reads a window's date and times.
describe('E2 / E5 / E6 / E7 unit — edge inputs', () => {
  const local = (hh, mm = 0, day = 23) => new Date(2026, 9, day, hh, mm);
  const window = { event_date: '2026-10-23', start_time: '09:00', end_time: '17:00', expected_attendance: 10 };
  const hall = venue('VEN-001', { max_capacity: 100 });

  test('TC-0564 [boundary] a venue with nothing listed still produces a full record, and the label reads "None listed"', () => {
    expect(listCatalogue()).toEqual([]);
    expect(venueRecord(venue('VEN-9', { name: 'Bare' }))).toEqual({
      venue_id: 'VEN-9', name: 'Bare', location: undefined, max_capacity: undefined,
      headline_facilities: [], layouts: [], accessibility: [], operating_hours: []
    });
    expect(facilitiesLabel()).toBe('None listed');
    expect(facilitiesLabel(['POWER_POINTS', 'WIFI'])).toBe('POWER POINTS, WIFI');
  });

  test('TC-0565 [boundary] daysFromToday counts calendar days from today, crossing month ends, as YYYY-MM-DD', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 30, 12, 0));
    try {
      expect(daysFromToday(0)).toBe('2026-10-30');
      expect(daysFromToday(3)).toBe('2026-11-02');
      expect(daysFromToday(-30)).toBe('2026-09-30');
    } finally {
      jest.useRealTimers();
    }
  });

  test("TC-0566 [normal] Find venues opens narrowed to the event's own needs; an event that asked for none narrows nothing", () => {
    expect(prefillFilters({ preferred_location: 'EAST', expected_attendance: '120', facilities: ['WIFI'], accessibility: ['LIFT'], required_layout: 'THEATRE' }))
      .toEqual({ location: 'EAST', min_capacity: 120, max_capacity: null, facilities: ['WIFI'], accessibility: ['LIFT'], layout: 'THEATRE' });
    expect(prefillFilters(null)).toEqual(emptyFilters());
    expect(prefillFilters({ expected_attendance: 'many' }).min_capacity).toBeNull();
  });

  test('TC-0567 [conflict] an approved booking or block stored as Date, timestamp or epoch number excludes the overlapping venue', () => {
    const stamp = (date) => ({ toDate: () => date });
    for (const [start, end] of [
      [local(10), local(12)],
      [stamp(local(10)), stamp(local(12))],
      [local(10).getTime(), local(12).getTime()]
    ]) {
      expect(isOccupied(hall, window, [{ venue_id: 'VEN-001', status: 'APPROVED', start_datetime: start, end_datetime: end }])).toBe(true);
    }
    expect(isOccupied(hall, window, [], [{ venue_id: 'VEN-001', start_datetime: local(16, 30), end_datetime: local(20) }])).toBe(true);
  });

  test('TC-0983 [boundary] the occupied window (setup and turnaround) is what search compares, not the event times (F9 AC4)', () => {
    const booking = { venue_id: 'VEN-001', status: 'APPROVED', start_datetime: local(17, 30), end_datetime: local(19), occupied_start: local(16, 45), occupied_end: local(19, 30) };
    expect(isOccupied(hall, window, [booking])).toBe(true);
    // Touching the occupied window does not exclude.
    expect(isOccupied(hall, window, [{ ...booking, occupied_start: local(17) }])).toBe(false);
  });

  test('TC-0568 [boundary] a block on another date, or whose times cannot be read, does not exclude the venue', () => {
    expect(isOccupied(hall, window, [{ venue_id: 'VEN-001', status: 'APPROVED', event_date: '2026-10-24', start_time: '10:00', end_time: '12:00' }])).toBe(false);
    expect(isOccupied(hall, window, [{ venue_id: 'VEN-001', status: 'APPROVED', date: '2026-10-23', start_time: '10:00', end_time: '12:00' }])).toBe(true);
    // Only a start, unreadable values, or nothing at all give no times to compare.
    expect(isOccupied(hall, window, [{ venue_id: 'VEN-001', status: 'APPROVED', start_datetime: local(10) }])).toBe(false);
    expect(isOccupied(hall, window, [{ venue_id: 'VEN-001', status: 'APPROVED', start_datetime: 'garbage', end_datetime: { not: 'a date' } }])).toBe(false);
    expect(isOccupied(hall, window, [{ venue_id: 'VEN-001', status: 'APPROVED' }])).toBe(false);
    expect(isOccupied(hall, window)).toBe(false);
  });

  test('TC-0569 [boundary] a window with no date compares clock times alone, from the stored times or the datetime clock', () => {
    const noDate = { start_time: '09:00', end_time: '17:00' };
    expect(isOccupied(hall, noDate, [{ venue_id: 'VEN-001', status: 'approved', start_datetime: local(10), end_datetime: local(11) }])).toBe(true);
    expect(isOccupied(hall, noDate, [{ venue_id: 'VEN-001', status: 'APPROVED', start_datetime: local(17), end_datetime: local(18) }])).toBe(false);
    expect(isOccupied(hall, {}, [{ venue_id: 'VEN-001', status: 'APPROVED', start_time: '10:00', end_time: '11:00' }])).toBe(false);
    // Bare clock text in the datetime fields is read as the clock; a date-only prefix gives the date.
    expect(isOccupied(hall, noDate, [{ venue_id: 'VEN-001', status: 'APPROVED', start_datetime: '10:00', end_datetime: '12:00' }])).toBe(true);
    expect(isOccupied(hall, window, [{ venue_id: 'VEN-001', status: 'APPROVED', start_datetime: '2026-10-24 later', end_datetime: '2026-10-24 later' }])).toBe(false);
  });

  test('TC-0953 [conflict] pending, held and unlabelled bookings never exclude a venue from search; only approved ones do (F6 AC3)', () => {
    for (const status of ['PENDING', 'HELD', undefined]) {
      expect(isOccupied(hall, window, [{ venue_id: 'VEN-001', status, start_time: '10:00', end_time: '12:00' }])).toBe(false);
    }
  });

  test('TC-0570 [boundary] the active-filter chips include a capacity range when only one end is set, and every list filter', () => {
    expect(activeFilters({ ...emptyFilters(), max_capacity: 50, facilities: ['WIFI'], accessibility: ['LIFT'], layout: 'THEATRE', location: 'EAST' }).map((item) => item.key))
      .toEqual(['location', 'capacity_range', 'facilities', 'accessibility', 'layout']);
    expect(activeFilters(emptyFilters())).toEqual([]);
  });

  test('TC-0571 [boundary] a venue missing its lists fails a filter that needs them rather than erroring', () => {
    const bare = [venue('BARE', { max_capacity: 50 })];
    expect(applyFilters(bare, { ...emptyFilters(), facilities: ['WIFI'] })).toEqual([]);
    expect(applyFilters(bare, { ...emptyFilters(), accessibility: ['LIFT'] })).toEqual([]);
    expect(applyFilters(bare, { ...emptyFilters(), layout: 'THEATRE' })).toEqual([]);
    expect(applyFilters(bare, { ...emptyFilters(), max_capacity: 49 })).toEqual([]);
  });

  test('TC-0711 [failure] missing or invalid attendance, capacity, date and times are each reported, not passed (E7)', () => {
    const result = assessVenueSuitability({ venue: { max_capacity: 'lots' }, event: { expected_attendance: 0, event_date: '2026-02-30', start_time: '9am' } });
    const byKey = Object.fromEntries(result.criteria.map((item) => [item.key, item]));
    expect(result.suitable).toBe(false);
    expect(byKey.capacity).toMatchObject({ passed: false, detail: 'Expected attendance or venue capacity is missing or invalid.' });
    expect(byKey['operating-hours'].detail).toBe('The event date is missing or invalid.');
    expect(assessVenueSuitability({ venue: {}, event: { event_date: 20261023 } }).criteria.at(-1).detail).toBe('The event date is missing or invalid.');
    expect(assessVenueSuitability({ venue: {}, event: { event_date: '2026-10' } }).criteria.at(-1).detail).toBe('The event date is missing or invalid.');
    // A real date with the end before the start, or a clock past 23:59.
    const times = (start, end) => assessVenueSuitability({ venue: {}, event: { event_date: '2026-10-23', start_time: start, end_time: end } }).criteria.at(-1).detail;
    expect(times('17:00', '09:00')).toBe('The requested start and end times are missing or invalid.');
    expect(times('24:00', '25:00')).toBe('The requested start and end times are missing or invalid.');
    expect(times('09:60', '10:00')).toBe('The requested start and end times are missing or invalid.');
  });

  test('TC-0572 [normal] an event asking for nothing passes facilities, access and layout; a supported layout says so', () => {
    const open = { max_capacity: 50, layouts: ['THEATRE'], operating_hours: [{ weekday: 'FRIDAY', opens_at: '08:00', closes_at: '18:00' }] };
    const asked = { expected_attendance: 50, event_date: '2026-10-23', start_time: '09:00', end_time: '17:00' };
    const plain = assessVenueSuitability({ venue: open, event: asked });
    expect(plain.suitable).toBe(true);
    expect(plain.criteria.map((item) => item.detail)).toEqual([
      '50 places for 50 expected attendees.', 'No facilities required.', 'No accessibility features required.',
      'No room layout required.', '09:00–17:00 is within FRIDAY operating hours.'
    ]);
    expect(assessVenueSuitability({ venue: open, event: { ...asked, layout: 'THEATRE' } }).criteria.find((item) => item.key === 'layout').detail)
      .toBe('THEATRE is supported.');
    // A venue listing none of what was asked fails each; an hours row with bad clocks never opens.
    const bare = assessVenueSuitability({
      venue: { max_capacity: 50, operating_hours: [{ weekday: 'friday', opens_at: '8am', closes_at: '18:00' }] },
      event: { ...asked, facilities: ['WIFI'], accessibility: ['LIFT'], layout: 'BANQUET' }
    });
    expect(bare.criteria.filter((item) => !item.passed).map((item) => item.key)).toEqual(['facility-WIFI', 'accessibility-LIFT', 'layout', 'operating-hours']);
    expect(assessVenueSuitability({ venue: { max_capacity: 50 }, event: asked }).criteria.at(-1).detail).toBe('No operating hours are listed for FRIDAY.');
  });
});
