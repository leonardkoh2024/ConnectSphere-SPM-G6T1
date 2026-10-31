// E8 / F1 / F13 — the suitability gate in front of a venue booking request, called
// directly, no React and no Firebase. UNIT.
// The screen-level behaviour of the same gate is in features/venues/VenueBookingRequest.test.js.

import {
  ACKNOWLEDGEABLE_CRITERIA,
  BLOCKING_CRITERIA,
  CRITERIA,
  CRITERION_LABEL,
  LIVE_BOOKING_STATUSES,
  acknowledgementRecord,
  assessVenue,
  bookingRequirements,
  canSubmitBooking,
  existingBookingFor,
  groupedRequirementLines,
  isBlocked,
  opensFor,
  outstandingAcknowledgements,
  requirementLines,
  submissionBlockReason,
  weekdayOf
} from './venueSuitability';

// 23 Oct 2026 is a Friday.
const hall = {
  venue_id: 'VEN-001', max_capacity: 100,
  facilities: ['WIFI', 'PROJECTOR'], accessibility: ['WHEELCHAIR_ACCESS'], layouts: ['THEATRE', 'CLASSROOM'],
  operating_hours: [{ weekday: 'FRIDAY', opens_at: '08:00', closes_at: '18:00' }]
};
const needs = (fields = {}) => ({
  expected_attendance: 80, event_date: '2026-10-23', start_time: '09:00', end_time: '17:00',
  facilities: ['WIFI'], accessibility: ['WHEELCHAIR_ACCESS'], layout: 'THEATRE', ...fields
});

describe('E8 unit — what can and cannot be acknowledged', () => {
  test('TC-0738 [normal] capacity and operating hours block; facilities, access and layout may be acknowledged', () => {
    expect(BLOCKING_CRITERIA).toEqual([CRITERIA.CAPACITY, CRITERIA.OPERATING_HOURS]);
    expect(ACKNOWLEDGEABLE_CRITERIA).toEqual([CRITERIA.FACILITY, CRITERIA.ACCESSIBILITY, CRITERIA.LAYOUT]);
    expect(Object.keys(CRITERION_LABEL).sort()).toEqual(Object.values(CRITERIA).sort());
  });

  test('TC-0739 [boundary] weekdayOf reads a calendar date and refuses one that does not exist', () => {
    expect(weekdayOf('2026-10-23')).toBe('FRIDAY');
    expect(weekdayOf('2026-02-30')).toBeNull();
    expect(weekdayOf('2026-13-01')).toBeNull();
    expect(weekdayOf('2026-10')).toBeNull();
    expect(weekdayOf('not-a-date')).toBeNull();
    expect(weekdayOf(undefined)).toBeNull();
  });
});

describe('E7 AC4 unit — a venue shut for the requested time cannot host the event', () => {
  test('TC-0712 [boundary] open exactly from start to end is open; a minute outside either end is not', () => {
    expect(opensFor(hall, needs({ start_time: '08:00', end_time: '18:00' }))).toBe(true);
    expect(opensFor(hall, needs({ start_time: '07:59', end_time: '17:00' }))).toBe(false);
    expect(opensFor(hall, needs({ start_time: '09:00', end_time: '18:01' }))).toBe(false);
  });

  test('TC-0713 [conflict] a venue that states hours but none for that weekday is closed then', () => {
    expect(opensFor(hall, needs({ event_date: '2026-10-24' }))).toBe(false);
  });

  test('TC-0714 [boundary] missing data is not a closure: no hours stated, no readable date, or no times', () => {
    expect(opensFor({ ...hall, operating_hours: undefined }, needs())).toBe(true);
    expect(opensFor(hall, needs({ event_date: '2026-02-30' }))).toBe(true);
    expect(opensFor(hall, needs({ start_time: '' }))).toBe(true);
    expect(opensFor({ ...hall, operating_hours: [{ weekday: 'friday', opens_at: '08:00', closes_at: '18:00' }] }, needs())).toBe(true);
  });
});

describe('F12 / F13 unit — each booking is judged on its own attendance and layout', () => {
  test("TC-1086 [normal] a booking's attendance and layout replace the event's; the rest stays the event's (F13 AC1)", () => {
    const event = { expected_attendance: 300, required_layout: 'THEATRE', event_date: '2026-10-23', start_time: '09:00', end_time: '17:00', facilities: ['WIFI'], accessibility: ['LIFT'] };
    expect(bookingRequirements(event, { expected_attendance: '40', layout: 'CLASSROOM' }))
      .toEqual({ ...needs({ expected_attendance: 40, layout: 'CLASSROOM', accessibility: ['LIFT'] }) });
  });

  test('TC-1066 [failure] an event with nothing recorded gives zero attendance and empty needs; a booking with no layout needs none', () => {
    expect(bookingRequirements()).toEqual({
      expected_attendance: 0, event_date: '', start_time: '', end_time: '', facilities: [], accessibility: [], layout: null
    });
    expect(bookingRequirements({ required_layout: 'THEATRE' }, { expected_attendance: 'many' })).toMatchObject({ expected_attendance: 0, layout: null });
  });
});

describe('E8 unit — assessing one venue against the requirements', () => {
  test('TC-0740 [normal] a venue meeting everything is suitable with every stated criterion evaluated', () => {
    expect(assessVenue(hall, needs())).toEqual({
      venue_id: 'VEN-001', suitable: true,
      evaluated: [CRITERIA.CAPACITY, CRITERIA.OPERATING_HOURS, CRITERIA.FACILITY, CRITERIA.ACCESSIBILITY, CRITERIA.LAYOUT],
      blocking: [], warnings: []
    });
  });

  test('TC-0741 [boundary] attendance equal to capacity fits; one more is a blocking shortfall naming both numbers', () => {
    expect(isBlocked(assessVenue(hall, needs({ expected_attendance: 100 })))).toBe(false);
    const over = assessVenue(hall, needs({ expected_attendance: 101 }));
    expect(over.blocking).toEqual([{ criterion: CRITERIA.CAPACITY, required: 101, available: 100 }]);
    expect(isBlocked(over)).toBe(true);
  });

  test('TC-0742 [conflict] a closed day blocks and names the hours it does keep, or none', () => {
    expect(assessVenue(hall, needs({ start_time: '07:00' })).blocking)
      .toEqual([{ criterion: CRITERIA.OPERATING_HOURS, weekday: 'FRIDAY', available: ['08:00–18:00'] }]);
    expect(assessVenue(hall, needs({ event_date: '2026-10-24' })).blocking)
      .toEqual([{ criterion: CRITERIA.OPERATING_HOURS, weekday: 'SATURDAY', available: [] }]);
  });

  test('TC-0743 [normal] facility, access and layout shortfalls are warnings listing exactly what is missing', () => {
    const bare = { venue_id: 'VEN-002', max_capacity: 100 };
    expect(assessVenue(bare, needs({ facilities: ['WIFI', 'STAGE'], event_date: '' }))).toEqual({
      venue_id: 'VEN-002', suitable: false,
      evaluated: [CRITERIA.CAPACITY, CRITERIA.FACILITY, CRITERIA.ACCESSIBILITY, CRITERIA.LAYOUT],
      blocking: [],
      warnings: [
        { criterion: CRITERIA.FACILITY, missing: ['WIFI', 'STAGE'] },
        { criterion: CRITERIA.ACCESSIBILITY, missing: ['WHEELCHAIR_ACCESS'] },
        { criterion: CRITERIA.LAYOUT, missing: ['THEATRE'] }
      ]
    });
  });

  test('TC-0744 [boundary] nothing asked for means only capacity is evaluated', () => {
    expect(assessVenue(hall, { expected_attendance: 10, facilities: [], accessibility: [], layout: null }).evaluated).toEqual([CRITERIA.CAPACITY]);
  });
});

describe('F1 AC4 unit — the same event and venue cannot be requested twice while a request is live', () => {
  const request = { eventId: 'EVT-1', venueId: 'VEN-001' };
  const booking = (fields) => ({ event_id: 'EVT-1', venue_id: 'VEN-001', status: 'PENDING', ...fields });

  test('TC-0875 [conflict] a pending or approved request for the pair is found, in any letter case', () => {
    expect(LIVE_BOOKING_STATUSES).toEqual(['PENDING', 'APPROVED']);
    expect(existingBookingFor([booking()], request)).toMatchObject({ status: 'PENDING' });
    expect(existingBookingFor([booking({ status: 'approved' })], request)).toMatchObject({ status: 'approved' });
  });

  test('TC-0876 [boundary] rejected, withdrawn, unlabelled, other-event and other-venue requests leave the pair free', () => {
    expect(existingBookingFor([
      booking({ status: 'REJECTED' }), booking({ status: 'WITHDRAWN' }), booking({ status: undefined }),
      booking({ event_id: 'EVT-2' }), booking({ venue_id: 'VEN-002' })
    ], request)).toBeNull();
    expect(existingBookingFor(undefined, request)).toBeNull();
  });
});

describe('E8 unit — the requirement lines the picker and the gate both render', () => {
  test('TC-0745 [normal] one line per thing asked for, each judged on its own, grouped in criterion order', () => {
    const lines = requirementLines({ ...hall, accessibility: [] }, needs({ facilities: ['WIFI', 'STAGE'] }));
    expect(lines).toEqual([
      { criterion: CRITERIA.CAPACITY, label: '80 pax', met: true },
      { criterion: CRITERIA.FACILITY, label: 'WIFI', met: true },
      { criterion: CRITERIA.FACILITY, label: 'STAGE', met: false },
      { criterion: CRITERIA.ACCESSIBILITY, label: 'WHEELCHAIR_ACCESS', met: false },
      { criterion: CRITERIA.LAYOUT, label: 'THEATRE', met: true },
      { criterion: CRITERIA.OPERATING_HOURS, label: 'FRIDAY 09:00–17:00', met: true }
    ]);
    expect(groupedRequirementLines({ ...hall, accessibility: [] }, needs({ facilities: ['WIFI', 'STAGE'] })).map((group) => [group.criterion, group.lines.length]))
      .toEqual([[CRITERIA.CAPACITY, 1], [CRITERIA.OPERATING_HOURS, 1], [CRITERIA.FACILITY, 2], [CRITERIA.ACCESSIBILITY, 1], [CRITERIA.LAYOUT, 1]]);
  });

  test('TC-0746 [boundary] lists the venue lacks count as unmet; an unreadable date or missing times show as given; no date, no hours line', () => {
    const bare = { max_capacity: 10 };
    expect(requirementLines(bare, { expected_attendance: 5, facilities: ['WIFI'], accessibility: ['LIFT'], layout: 'THEATRE', event_date: '2026-02-30', start_time: '', end_time: '' }))
      .toEqual([
        { criterion: CRITERIA.CAPACITY, label: '5 pax', met: true },
        { criterion: CRITERIA.FACILITY, label: 'WIFI', met: false },
        { criterion: CRITERIA.ACCESSIBILITY, label: 'LIFT', met: false },
        { criterion: CRITERIA.LAYOUT, label: 'THEATRE', met: false },
        { criterion: CRITERIA.OPERATING_HOURS, label: '2026-02-30', met: true }
      ]);
    expect(groupedRequirementLines(bare, { expected_attendance: 20 })).toEqual([
      { criterion: CRITERIA.CAPACITY, lines: [{ criterion: CRITERIA.CAPACITY, label: '20 pax', met: false }] }
    ]);
  });
});

describe('E8 unit — submitting past the gate', () => {
  const warned = assessVenue({ ...hall, layouts: [] }, needs({ facilities: ['STAGE'] }));

  test('TC-0747 [normal] every warning must be acknowledged before the request can go; then it can', () => {
    expect(outstandingAcknowledgements({ assessment: warned })).toEqual([CRITERIA.FACILITY, CRITERIA.LAYOUT]);
    expect(canSubmitBooking({ assessment: warned })).toBe(false);
    expect(submissionBlockReason({ assessment: warned, acknowledged: [CRITERIA.FACILITY] }))
      .toBe('Acknowledge room layout before requesting this venue.');
    expect(submissionBlockReason({ assessment: warned })).toBe('Acknowledge required facilities and room layout before requesting this venue.');
    expect(canSubmitBooking({ assessment: warned, acknowledged: [CRITERIA.FACILITY, CRITERIA.LAYOUT] })).toBe(true);
    expect(submissionBlockReason({ assessment: warned, acknowledged: [CRITERIA.FACILITY, CRITERIA.LAYOUT] })).toBeNull();
  });

  test('TC-0748 [conflict] capacity and closed hours cannot be acknowledged past, and say why', () => {
    const tooSmall = assessVenue(hall, needs({ expected_attendance: 150 }));
    expect(canSubmitBooking({ assessment: tooSmall, acknowledged: ACKNOWLEDGEABLE_CRITERIA })).toBe(false);
    expect(submissionBlockReason({ assessment: tooSmall })).toBe('Capacity is 100; this event expects 150. This venue cannot be requested.');
    expect(submissionBlockReason({ assessment: assessVenue(hall, needs({ end_time: '19:00' })) }))
      .toBe('This venue opens 08:00–18:00 on FRIDAY. The requested time falls outside that, so it cannot be requested.');
    expect(submissionBlockReason({ assessment: assessVenue(hall, needs({ event_date: '2026-10-25' })) }))
      .toBe('This venue does not open on SUNDAY, so it cannot be requested.');
  });

  test('TC-0749 [normal] the acknowledgement written onto the booking records what was accepted, by whom and when', () => {
    expect(acknowledgementRecord({ assessment: warned, acknowledged: [CRITERIA.FACILITY, CRITERIA.LAYOUT], userId: 'COORD-1', at: 'NOW' })).toEqual({
      acknowledged: true,
      criteria: [CRITERIA.FACILITY, CRITERIA.LAYOUT],
      missing: { [CRITERIA.FACILITY]: ['STAGE'], [CRITERIA.LAYOUT]: ['THEATRE'] },
      acknowledged_by: 'COORD-1',
      acknowledged_at: 'NOW'
    });
    expect(acknowledgementRecord({ assessment: assessVenue(hall, needs()), userId: 'COORD-1', at: 'NOW' }))
      .toEqual({ acknowledged: false, criteria: [], missing: {}, acknowledged_by: null, acknowledged_at: null });
  });

  test('TC-0750 [failure] an acknowledgement cannot be recorded while a warning is still unacknowledged', () => {
    expect(() => acknowledgementRecord({ assessment: warned, acknowledged: [CRITERIA.FACILITY] }))
      .toThrow('Cannot record an acknowledgement while LAYOUT is unacknowledged.');
  });
});
