// B1–B5 and B9 — the rules an event request has to satisfy, tested on their own
// rather than through the form. Each issue names its field (B9 AC4), so the tests
// assert on the field list, not only on the count.
import {
  CORE_DETAILS,
  createReferenceNo,
  equipmentLinesWithContent,
  NO,
  SECTION_QUESTIONS,
  todayIso,
  validateEventRequest,
  VENUE_REQUIREMENTS,
  YES
} from './eventRequest';

const TODAY = '2026-10-30';

// A request that is ready to submit: every core detail, both venue requirements,
// and every Yes/No section answered with its detail filled in.
const complete = (changes = {}) => ({
  name: 'Partner Summit',
  purpose: 'Networking',
  description: 'Annual partner summit',
  eventDate: '2026-11-20',
  startTime: '09:00',
  endTime: '17:00',
  expectedAttendance: '120',
  preferredLocation: 'CENTRAL',
  requiredLayout: 'THEATRE',
  facilitiesRequired: YES,
  facilities: ['WIFI'],
  equipmentRequired: YES,
  equipmentLines: [{ equipmentType: 'PROJECTOR', quantity: '2', technicalNote: '' }],
  accessibilityRequired: YES,
  accessibility: ['WHEELCHAIR_ACCESS'],
  accessibilityNotes: 'Seats near the front',
  registrationRequired: YES,
  registrationCapacity: '100',
  registrationOpenDate: '2026-11-01',
  registrationOpenTime: '09:00',
  registrationCloseDate: '2026-11-19',
  registrationCloseTime: '18:00',
  ...changes
});

const fields = (form, options = {}) => validateEventRequest(form, { today: TODAY, ...options }).map((issue) => issue.field);

describe('B1–B5 / B9 validateEventRequest', () => {
  describe('normal', () => {
    test('TC-0244 B9 AC1 a complete request has no issues', () => {
      expect(validateEventRequest(complete(), { today: TODAY })).toEqual([]);
    });

    test('TC-0245 B9 AC2 every section may be answered No, and then needs no detail', () => {
      const allNo = complete({
        facilitiesRequired: NO, facilities: [],
        equipmentRequired: NO, equipmentLines: [],
        accessibilityRequired: NO, accessibility: [],
        registrationRequired: NO, registrationCapacity: '', registrationOpenDate: ''
      });
      expect(fields(allNo)).toEqual([]);
    });

    test('TC-0188 B2 AC3 a draft with only some fields entered is accepted', () => {
      expect(fields({ name: 'Partner Summit' }, { mode: 'draft' })).toEqual([]);
    });

    test('TC-0189 B2 AC1 / B3 AC1 the venue requirements and the section questions are the agreed ones', () => {
      expect(CORE_DETAILS.map((item) => item.field)).toEqual(
        ['name', 'purpose', 'description', 'eventDate', 'startTime', 'endTime', 'expectedAttendance']
      );
      expect(VENUE_REQUIREMENTS.map((item) => item.field)).toEqual(['preferredLocation', 'requiredLayout']);
      expect(SECTION_QUESTIONS.map((item) => item.gate)).toEqual(
        ['facilitiesRequired', 'equipmentRequired', 'accessibilityRequired', 'registrationRequired']
      );
    });
  });

  describe('boundary', () => {
    test('TC-0246 B9 AC3 an event dated today is allowed; yesterday is in the past', () => {
      expect(fields(complete({ eventDate: TODAY, registrationOpenDate: '2026-10-01', registrationCloseDate: TODAY, registrationCloseTime: '08:00' }))).toEqual([]);
      expect(fields(complete({ eventDate: '2026-10-29' }))).toContain('eventDate');
    });

    test('TC-0247 B9 AC3 an end time equal to the start time is refused; one minute later is fine', () => {
      expect(fields(complete({ endTime: '09:00' }))).toEqual(['endTime']);
      expect(fields(complete({ endTime: '09:01' }))).toEqual([]);
    });

    test('TC-0248 B9 AC3 an attendance of 1 is the smallest allowed; 0 is refused', () => {
      expect(fields(complete({ expectedAttendance: '1', registrationRequired: NO }))).toEqual([]);
      expect(fields(complete({ expectedAttendance: '0', registrationRequired: NO }))).toEqual(['expectedAttendance']);
    });

    test('TC-0200 B5 a registration capacity equal to the expected attendance is allowed; one more is refused', () => {
      expect(fields(complete({ registrationCapacity: '120' }))).toEqual([]);
      const issues = validateEventRequest(complete({ registrationCapacity: '121' }), { today: TODAY });
      expect(issues).toEqual([{ field: 'registrationCapacity', message: 'Registration capacity cannot exceed the expected attendance.' }]);
    });

    test('TC-0201 B5 registration may close exactly at the event start, not a minute after', () => {
      const atStart = { registrationCloseDate: '2026-11-20', registrationCloseTime: '09:00' };
      expect(fields(complete(atStart))).toEqual([]);
      expect(fields(complete({ ...atStart, registrationCloseTime: '09:01' }))).toEqual(['registrationCloseDate']);
    });

    test('TC-0195 B4 a blank trailing equipment line is not a requirement, but a line with only a note is', () => {
      const form = { equipmentLines: [
        { equipmentType: 'MIC', quantity: '1', technicalNote: '' },
        { equipmentType: '', quantity: '', technicalNote: '' },
        { equipmentType: ' ', quantity: ' ', technicalNote: 'Needs HDMI' }
      ] };
      expect(equipmentLinesWithContent(form)).toHaveLength(2);
      expect(equipmentLinesWithContent({})).toEqual([]);
      // Lines built before every key exists are read as blank, not as "undefined".
      expect(equipmentLinesWithContent({ equipmentLines: [{}, { quantity: 1 }, { technicalNote: 'x' }] })).toHaveLength(2);
    });

    test('TC-0196 B4 a line holding only a note still needs a type and a quantity', () => {
      expect(fields(complete({ equipmentLines: [{ technicalNote: 'Needs HDMI' }] }), { mode: 'draft' }))
        .toEqual(['equipmentLines.0.equipmentType', 'equipmentLines.0.quantity']);
    });

    test('TC-0197 B4 equipment answered Yes with only a blank line is the same as no line at submission', () => {
      const form = complete({ equipmentLines: [{ equipmentType: '', quantity: '', technicalNote: '' }] });
      expect(fields(form)).toEqual(['equipmentLines']);
      expect(fields(complete({ equipmentLines: undefined }))).toEqual(['equipmentLines']);
    });

    test('TC-0249 B9 values entered with no end time or no attendance skip the comparisons that need them', () => {
      expect(fields({ startTime: '10:00', expectedAttendance: '' }, { mode: 'draft' })).toEqual([]);
    });

    test('TC-0174 todayIso is the current UTC calendar date', () => {
      expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(validateEventRequest(complete({ eventDate: '2999-01-01', registrationRequired: NO }))).toEqual([]);
    });
  });

  describe('conflict', () => {
    test('TC-0202 B5 registration closing before it opens is reported once, not also as after the event', () => {
      const issues = validateEventRequest(complete({
        registrationOpenDate: '2026-11-25', registrationCloseDate: '2026-11-24'
      }), { today: TODAY });
      expect(issues).toEqual([{
        field: 'registrationCloseDate',
        message: 'Registration close date/time must be after registration open date/time.'
      }]);
    });

    test('TC-0203 B5 an over-capacity check is skipped when the attendance itself is invalid', () => {
      expect(fields(complete({ expectedAttendance: 'many', registrationCapacity: '500' }))).toEqual(['expectedAttendance']);
    });

    test('TC-0250 B9 AC5 two references made in the same millisecond still differ', () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
      try {
        const first = createReferenceNo();
        const second = createReferenceNo();
        expect(first).toMatch(/^EVT-[0-9A-Z]{6}-000[0-9A-Z]{2}$/);
        expect(second).toMatch(/^EVT-[0-9A-Z]{6}-001[0-9A-Z]{2}$/);
        expect(first.slice(0, 11)).toBe(second.slice(0, 11));
        now.mockReturnValue(1_800_000_000_001);
        expect(createReferenceNo()).toMatch(/-000[0-9A-Z]{2}$/);
      } finally {
        now.mockRestore();
      }
    });
  });

  describe('failure', () => {
    test('TC-0251 B9 AC4 an empty request lists every missing field, in form order', () => {
      expect(fields({})).toEqual([
        'name', 'purpose', 'description', 'eventDate', 'startTime', 'endTime', 'expectedAttendance',
        'preferredLocation', 'requiredLayout',
        'facilitiesRequired', 'equipmentRequired', 'accessibilityRequired', 'registrationRequired'
      ]);
    });

    test('TC-0252 B9 AC2 an unanswered section names its question', () => {
      const issues = validateEventRequest(complete({ accessibilityRequired: '' }), { today: TODAY });
      expect(issues).toEqual([{ field: 'accessibilityRequired', message: 'Answer “Does your event have accessibility needs?”' }]);
    });

    test('TC-0253 B9 AC4 whitespace-only values count as missing', () => {
      expect(fields(complete({ name: '   ', requiredLayout: ' ' }))).toEqual(['name', 'requiredLayout']);
    });

    test.each([['2.5'], ['-3'], ['abc']])('TC-0254 B9 AC3 an attendance of %p is invalid even on a draft', (value) => {
      expect(fields({ expectedAttendance: value }, { mode: 'draft' })).toEqual(['expectedAttendance']);
    });

    test('TC-0190 B2/B3 Yes with nothing chosen is refused at submission but allowed on a draft', () => {
      const form = complete({ facilities: undefined, accessibility: undefined });
      expect(fields(form)).toEqual(['facilities', 'accessibility']);
      expect(fields(complete({ facilities: [] }))).toEqual(['facilities']);
      expect(fields(form, { mode: 'draft' })).toEqual([]);
    });

    test('TC-0198 B4 each equipment line with content needs a type and a whole quantity of at least one', () => {
      const issues = validateEventRequest(complete({ equipmentLines: [
        { equipmentType: '', quantity: '2', technicalNote: '' },
        { equipmentType: 'MIC', quantity: '0', technicalNote: '' }
      ] }), { today: TODAY, mode: 'draft' });
      expect(issues.map((issue) => issue.field)).toEqual(['equipmentLines.0.equipmentType', 'equipmentLines.1.quantity']);
      expect(issues[1].message).toBe('Equipment quantity 2 must be a whole number greater than zero.');
    });

    test('TC-0204 B5 registration answered Yes needs a capacity and the full window at submission, not on a draft', () => {
      const form = complete({ registrationCapacity: '', registrationCloseTime: '' });
      expect(fields(form)).toEqual(['registrationCapacity', 'registrationWindow']);
      expect(fields(form, { mode: 'draft' })).toEqual([]);
    });

    test('TC-0205 B5 a capacity that is entered but not a whole number is refused even on a draft', () => {
      expect(fields({ registrationRequired: YES, registrationCapacity: '0' }, { mode: 'draft' })).toEqual(['registrationCapacity']);
    });

    test('TC-0206 B5 a window with no event date or start time is only checked for its own order', () => {
      const form = { registrationRequired: YES, registrationOpenDate: '2026-11-01', registrationOpenTime: '09:00',
        registrationCloseDate: '2026-12-30', registrationCloseTime: '09:00' };
      expect(fields(form, { mode: 'draft' })).toEqual([]);
    });
  });
});
