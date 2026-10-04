import {
  activeFilters,
  assessVenueSuitability,
  applyFilters,
  canSearchVenues,
  canViewCatalogue,
  capacityFits,
  emptyFilters,
  facilitiesLabel,
  listCatalogue,
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
  test('TC-089 every venue is listed with its four summary fields', () => {
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

  test('TC-090 a venue with no facilities still lists cleanly', () => {
    const [row] = listCatalogue([venue('VEN-004', { name: 'Annex', location: 'NORTH', max_capacity: 20, facilities: [] })]);
    expect(row.headline_facilities).toEqual([]);
    expect(facilitiesLabel(row.headline_facilities)).toBe('None listed');
  });

  test('TC-091 a venue full record includes layouts, accessibility and hours', () => {
    const record = venueRecord(hallA);
    expect(record.layouts).toEqual(['THEATRE', 'CLASSROOM']);
    expect(record.accessibility).toEqual(['WHEELCHAIR_ACCESS']);
    expect(record.operating_hours).toEqual([{ weekday: 'MONDAY', opens_at: '09:00', closes_at: '18:00' }]);
  });

  test('TC-092 coordinators and venue staff may view the catalogue', () => {
    expect(canViewCatalogue(ROLES.COORDINATOR)).toBe(true);
    expect(canViewCatalogue(ROLES.VENUE_STAFF)).toBe(true);
  });

  test('TC-093 the other three roles cannot', () => {
    expect(canViewCatalogue(ROLES.ORGANISER)).toBe(false);
    expect(canViewCatalogue(ROLES.ATTENDEE)).toBe(false);
    expect(canViewCatalogue(ROLES.TECH_SUPPORT)).toBe(false);
  });
});

describe('E5 / SCRUM-121 find venues that fit my event', () => {
  const window = { event_date: '2026-10-23', start_time: '09:00', end_time: '17:00', expected_attendance: 180 };

  test('TC-095 search opened from an event arrives pre-filled', () => {
    expect(prefillSearch({ event_date: window.event_date, start_time: '09:00', end_time: '17:00', expected_attendance: 180 })).toEqual({
      event_date: window.event_date, start_time: '09:00', end_time: '17:00', expected_attendance: 180
    });
  });

  test('TC-096 a venue occupied for part of the window is excluded', () => {
    const result = searchVenues({
      venues: [venue('VEN-001', { name: 'Hall A', max_capacity: 500 })],
      window,
      bookings: [{ venue_id: 'VEN-001', start_time: '10:00', end_time: '12:00', status: 'Approved' }]
    });
    expect(result.matches.map((item) => item.venue_id)).toEqual([]);
  });

  test('TC-097 a booking that ends when the window starts does not exclude', () => {
    const result = searchVenues({
      venues: [venue('VEN-001', { name: 'Hall A', max_capacity: 500 })],
      window,
      bookings: [{ venue_id: 'VEN-001', start_time: '07:00', end_time: '09:00', status: 'Approved' }]
    });
    expect(result.matches.map((item) => item.venue_id)).toEqual(['VEN-001']);
  });

  test('TC-098 a venue blocked for maintenance is excluded', () => {
    const result = searchVenues({
      venues: [venue('VEN-002', { name: 'Studio B', max_capacity: 200 })],
      window,
      unavailability: [{ venue_id: 'VEN-002', start_time: '08:00', end_time: '18:00', reason: 'Maintenance' }]
    });
    expect(result.matches).toEqual([]);
  });

  test('a multi-date unavailability period blocks the full interval and allows a touching endpoint', () => {
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

  test('TC-099 capacity equal to attendance is a fit', () => {
    expect(capacityFits({ max_capacity: 180 }, 180)).toBe(true);
    expect(searchVenues({ venues: [venue('VEN-003', { max_capacity: 180 })], window }).matches).toHaveLength(1);
  });

  test('TC-100 one seat short is excluded', () => {
    expect(searchVenues({ venues: [venue('VEN-004', { max_capacity: 179 })], window }).matches).toHaveLength(0);
  });

  test('TC-101 the shortlist is exactly the venues passing both tests', () => {
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

  test('TC-102 zero results report per-criterion exclusion counts', () => {
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

  test('TC-103 venue search belongs to coordinators', () => {
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

  test('TC-104 each of the five filters works on its own', () => {
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

    test('TC-112 the outcome identifies every missing or failing criterion', () => {
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

    test('TC-113 attendance equal to capacity and an operating-hours boundary are suitable', () => {
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

    test('TC-114 a requested time outside operating hours fails, including when hours are unlisted', () => {
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

  test('TC-105 filters are AND, not OR', () => {
    expect(applyFilters(catalogue, { ...emptyFilters(), location: 'CENTRAL', layout: 'THEATRE' }).map((item) => item.venue_id)).toEqual(['Z']);
  });

  test('TC-106 a capacity range includes both ends', () => {
    const ranged = catalogue.filter((item) => ['S99', 'S100', 'S300', 'S301'].includes(item.venue_id));
    expect(applyFilters(ranged, { ...emptyFilters(), min_capacity: 100, max_capacity: 300 }).map((item) => item.venue_id)).toEqual(['S100', 'S300']);
  });

  test('TC-107 two required facilities means both', () => {
    const trio = catalogue.filter((item) => ['P', 'Q', 'R'].includes(item.venue_id));
    expect(applyFilters(trio, { ...emptyFilters(), facilities: ['WIFI', 'POWER_POINTS'] }).map((item) => item.venue_id)).toEqual(['R']);
  });

  test('TC-108 the active filter set is visible', () => {
    expect(activeFilters({ ...emptyFilters(), location: 'CENTRAL', layout: 'THEATRE' })).toEqual([
      { key: 'location', value: 'CENTRAL' },
      { key: 'layout', value: 'THEATRE' }
    ]);
  });

  test('TC-109 one action clears everything', () => {
    expect(activeFilters(emptyFilters())).toEqual([]);
    expect(applyFilters(catalogue, emptyFilters())).toHaveLength(catalogue.length);
  });

  test('TC-110 the count tracks applying and removing a filter', () => {
    const shortlist = catalogue.slice(0, 8);
    const afterLocation = applyFilters(shortlist, { ...emptyFilters(), location: 'CENTRAL' });
    const afterBoth = applyFilters(shortlist, { ...emptyFilters(), location: 'CENTRAL', layout: 'THEATRE' });
    expect(afterLocation.length).toBeLessThan(8);
    expect(afterBoth.length).toBeLessThan(afterLocation.length);
    expect(applyFilters(shortlist, { ...emptyFilters(), location: 'CENTRAL' })).toHaveLength(afterLocation.length);
  });

  test('TC-111 filters can exclude everything and clearing restores the list', () => {
    expect(applyFilters(catalogue, { ...emptyFilters(), location: 'CENTRAL', layout: 'BANQUET' })).toHaveLength(0);
    expect(applyFilters(catalogue, emptyFilters())).toHaveLength(catalogue.length);
  });
});
