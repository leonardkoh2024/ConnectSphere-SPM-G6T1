// E8 / SCRUM-124 — Be stopped before booking an unsuitable venue.
//
// Every test case for the story lives here, in three parts:
//
//   UNIT        TC-112 – TC-131  the rules themselves (domain/venueSuitability.js),
//                                called directly, no React and no Firebase.
//   FUNCTIONAL  TC-132 – TC-143  the coordinator's screen and the Venue Staff
//                                notice, driven the way a user drives them.
//   RULES       TC-144 – TC-147  the server boundary, where a crafted request
//                                that ignores the screen still has to be refused.
//
// The split the story asks for: capacity is a hard stop, while facility,
// accessibility and layout shortfalls are judgement calls the coordinator is
// allowed to make — provided they say so on the record.

import fs from 'fs';
import path from 'path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ACKNOWLEDGEABLE_CRITERIA,
  CRITERIA,
  acknowledgementRecord,
  assessVenue,
  bookingRequirements,
  canSubmitBooking,
  isBlocked,
  outstandingAcknowledgements,
  submissionBlockReason
} from '../../domain/venueSuitability';
import { canFindVenues } from '../../domain/eventReview';
import { existingBookingFor } from '../../domain/venueSuitability';
import { activeFilters, emptyFilters, prefillFilters } from '../../domain/venueSearch';
import { reviewApi } from '../events/reviewApi';
import { loadVenueBookings, loadVenueCatalogue, loadVenueSearchContext, requestVenueBooking, withdrawVenueBooking } from './venuesApi';
import VenueBookingRequest, { BookingAcknowledgementNotice } from './VenueBookingRequest';
import VenueBookings from './VenueBookings';
import VenueAvailabilityCalendar from './VenueAvailability';

jest.mock('./venuesApi', () => ({
  requestVenueBooking: jest.fn(),
  loadVenueCatalogue: jest.fn(),
  loadVenueBookings: jest.fn(),
  loadVenueSearchContext: jest.fn(),
  withdrawVenueBooking: jest.fn()
}));
jest.mock('../events/reviewApi', () => ({ reviewApi: { list: jest.fn(), detail: jest.fn() } }));

// Standing test data, shared by the unit and functional halves so a change to
// the fixture cannot make one half disagree with the other.
const hallA = {
  venue_id: 'VEN-001',
  name: 'Hall A',
  max_capacity: 200,
  facilities: ['WIFI', 'STAGE', 'POWER_POINTS'],
  accessibility: ['WHEELCHAIR_ACCESS', 'LIFT'],
  layouts: ['THEATRE', 'CLASSROOM']
};

const user = { uid: 'coordinator-7' };

// ---------------------------------------------------------------------------
// UNIT — the rules, called directly
// ---------------------------------------------------------------------------

const needs = (fields) => ({
  expected_attendance: 100,
  facilities: [],
  accessibility: [],
  layout: null,
  ...fields
});

const criteriaOf = (entries) => entries.map((entry) => entry.criterion);

describe('E8 / SCRUM-124 unit — capacity is a hard stop', () => {
  test('TC-112 expected attendance above the venue capacity blocks the request', () => {
    const assessment = assessVenue(hallA, needs({ expected_attendance: 201 }));

    expect(criteriaOf(assessment.blocking)).toEqual([CRITERIA.CAPACITY]);
    expect(isBlocked(assessment)).toBe(true);
    expect(assessment.suitable).toBe(false);
  });

  test('TC-113 attendance exactly at capacity is not a failure', () => {
    const assessment = assessVenue(hallA, needs({ expected_attendance: 200 }));

    expect(assessment.blocking).toEqual([]);
    expect(assessment.suitable).toBe(true);
  });

  test('TC-114 the capacity failure names the number asked for and the number available', () => {
    const [failure] = assessVenue(hallA, needs({ expected_attendance: 350 })).blocking;

    expect(failure.criterion).toBe(CRITERIA.CAPACITY);
    expect(failure.required).toBe(350);
    expect(failure.available).toBe(200);
  });

  test('TC-115 a capacity block cannot be acknowledged away', () => {
    const assessment = assessVenue(hallA, needs({ expected_attendance: 201 }));

    expect(ACKNOWLEDGEABLE_CRITERIA).not.toContain(CRITERIA.CAPACITY);
    expect(canSubmitBooking({ assessment, acknowledged: [CRITERIA.CAPACITY] })).toBe(false);
    expect(submissionBlockReason({ assessment, acknowledged: [CRITERIA.CAPACITY] }))
      .toMatch(/capacity/i);
  });
});

describe('E8 / SCRUM-124 unit — facility, accessibility and layout shortfalls warn', () => {
  test('TC-116 a required facility the venue lacks is a warning, not a block', () => {
    const assessment = assessVenue(hallA, needs({ facilities: ['WIFI', 'KITCHEN_PANTRY'] }));

    expect(assessment.blocking).toEqual([]);
    expect(criteriaOf(assessment.warnings)).toEqual([CRITERIA.FACILITY]);
    expect(assessment.warnings[0].missing).toEqual(['KITCHEN_PANTRY']);
  });

  test('TC-117 a required accessibility feature the venue lacks is a warning', () => {
    const assessment = assessVenue(hallA, needs({ accessibility: ['HEARING_LOOP'] }));

    expect(criteriaOf(assessment.warnings)).toEqual([CRITERIA.ACCESSIBILITY]);
    expect(assessment.warnings[0].missing).toEqual(['HEARING_LOOP']);
  });

  test('TC-118 a layout the venue does not support is a warning', () => {
    const assessment = assessVenue(hallA, needs({ layout: 'BANQUET' }));

    expect(criteriaOf(assessment.warnings)).toEqual([CRITERIA.LAYOUT]);
    expect(assessment.warnings[0].missing).toEqual(['BANQUET']);
  });

  test('TC-119 every failing criterion is named, one warning per criterion', () => {
    const assessment = assessVenue(hallA, needs({
      facilities: ['KITCHEN_PANTRY', 'PARKING'],
      accessibility: ['HEARING_LOOP'],
      layout: 'BANQUET'
    }));

    expect(criteriaOf(assessment.warnings))
      .toEqual([CRITERIA.FACILITY, CRITERIA.ACCESSIBILITY, CRITERIA.LAYOUT]);
    expect(assessment.warnings[0].missing).toEqual(['KITCHEN_PANTRY', 'PARKING']);
  });

  test('TC-120 a blocking failure and warnings are reported together', () => {
    const assessment = assessVenue(hallA, needs({
      expected_attendance: 500,
      facilities: ['KITCHEN_PANTRY']
    }));

    expect(criteriaOf(assessment.blocking)).toEqual([CRITERIA.CAPACITY]);
    expect(criteriaOf(assessment.warnings)).toEqual([CRITERIA.FACILITY]);
  });

  test('TC-121 the criteria evaluated are reported whether or not they passed', () => {
    const assessment = assessVenue(hallA, needs({ facilities: ['WIFI'], layout: 'THEATRE' }));

    expect(assessment.suitable).toBe(true);
    expect(assessment.evaluated).toEqual([CRITERIA.CAPACITY, CRITERIA.FACILITY, CRITERIA.LAYOUT]);
  });

  test('TC-122 a criterion the event does not ask for is not evaluated', () => {
    const assessment = assessVenue(hallA, needs({}));

    expect(assessment.evaluated).toEqual([CRITERIA.CAPACITY]);
    expect(assessment.warnings).toEqual([]);
  });
});

describe('E7 AC4 / SCRUM-123 unit — a venue shut for the requested time is a hard stop', () => {
  // 2026-11-20 is a Friday.
  const fridayOnly = { ...hallA, operating_hours: [{ weekday: 'FRIDAY', opens_at: '10:00', closes_at: '20:00' }] };
  const window = (fields) => needs({ event_date: '2026-11-20', start_time: '10:00', end_time: '17:00', ...fields });

  test('TC-175 a window inside the venue opening hours for that day passes', () => {
    const assessment = assessVenue(fridayOnly, window());
    expect(assessment.blocking).toEqual([]);
    expect(assessment.evaluated).toContain(CRITERIA.OPERATING_HOURS);
    expect(assessment.suitable).toBe(true);
  });

  test('TC-176 a window starting before the venue opens blocks the request', () => {
    const assessment = assessVenue(fridayOnly, window({ start_time: '09:00' }));
    expect(assessment.blocking.map((item) => item.criterion)).toEqual([CRITERIA.OPERATING_HOURS]);
    expect(submissionBlockReason({ assessment, acknowledged: [] }))
      .toMatch(/opens 10:00–20:00 on FRIDAY/i);
    expect(canSubmitBooking({ assessment, acknowledged: [CRITERIA.OPERATING_HOURS] })).toBe(false);
  });

  test('TC-177 a venue that does not open that day at all blocks the request', () => {
    const mondayOnly = { ...hallA, operating_hours: [{ weekday: 'MONDAY', opens_at: '10:00', closes_at: '20:00' }] };
    const assessment = assessVenue(mondayOnly, window());
    expect(assessment.blocking.map((item) => item.criterion)).toEqual([CRITERIA.OPERATING_HOURS]);
    expect(submissionBlockReason({ assessment, acknowledged: [] })).toMatch(/does not open on FRIDAY/i);
  });

  test('TC-178 a venue stating no hours at all is treated as open, not shut', () => {
    expect(assessVenue(hallA, window()).blocking).toEqual([]);
  });

  test('TC-179 a date with no times asks only that the venue opens that day', () => {
    const dayOnly = window({ start_time: '', end_time: '' });
    expect(assessVenue(fridayOnly, dayOnly).blocking).toEqual([]);
    const mondayOnly = { ...hallA, operating_hours: [{ weekday: 'MONDAY', opens_at: '10:00', closes_at: '20:00' }] };
    expect(assessVenue(mondayOnly, dayOnly).blocking.map((item) => item.criterion))
      .toEqual([CRITERIA.OPERATING_HOURS]);
  });

  test('TC-180 no date stated means the criterion is not evaluated at all', () => {
    expect(assessVenue(fridayOnly, needs({})).evaluated).not.toContain(CRITERIA.OPERATING_HOURS);
  });
});

describe('E8 / SCRUM-124 unit — the coordinator must acknowledge before submitting', () => {
  const withShortfalls = () => assessVenue(hallA, needs({
    facilities: ['KITCHEN_PANTRY'],
    layout: 'BANQUET'
  }));

  test('TC-123 submission is refused while a warning is unacknowledged', () => {
    const assessment = withShortfalls();

    expect(canSubmitBooking({ assessment, acknowledged: [] })).toBe(false);
    expect(outstandingAcknowledgements({ assessment, acknowledged: [] }))
      .toEqual([CRITERIA.FACILITY, CRITERIA.LAYOUT]);
  });

  test('TC-124 acknowledging only some of the warnings still refuses submission', () => {
    const assessment = withShortfalls();

    expect(canSubmitBooking({ assessment, acknowledged: [CRITERIA.FACILITY] })).toBe(false);
    expect(outstandingAcknowledgements({ assessment, acknowledged: [CRITERIA.FACILITY] }))
      .toEqual([CRITERIA.LAYOUT]);
  });

  test('TC-125 submission is allowed once every warning is acknowledged', () => {
    const assessment = withShortfalls();
    const acknowledged = [CRITERIA.FACILITY, CRITERIA.LAYOUT];

    expect(canSubmitBooking({ assessment, acknowledged })).toBe(true);
    expect(outstandingAcknowledgements({ assessment, acknowledged })).toEqual([]);
    expect(submissionBlockReason({ assessment, acknowledged })).toBeNull();
  });

  test('TC-126 a venue with no failures submits with nothing to acknowledge', () => {
    const assessment = assessVenue(hallA, needs({ facilities: ['WIFI'] }));

    expect(assessment.suitable).toBe(true);
    expect(outstandingAcknowledgements({ assessment, acknowledged: [] })).toEqual([]);
    expect(canSubmitBooking({ assessment, acknowledged: [] })).toBe(true);
  });
});

describe('E8 / SCRUM-124 unit — the acknowledgement is recorded on the booking request', () => {
  test('TC-127 the record names each criterion, what was missing, who acknowledged and when', () => {
    const assessment = assessVenue(hallA, needs({
      facilities: ['KITCHEN_PANTRY'],
      accessibility: ['HEARING_LOOP']
    }));

    const record = acknowledgementRecord({
      assessment,
      acknowledged: [CRITERIA.FACILITY, CRITERIA.ACCESSIBILITY],
      userId: 'coordinator-7',
      at: '2026-10-04T09:30:00.000Z'
    });

    expect(record).toEqual({
      acknowledged: true,
      criteria: [CRITERIA.FACILITY, CRITERIA.ACCESSIBILITY],
      missing: {
        [CRITERIA.FACILITY]: ['KITCHEN_PANTRY'],
        [CRITERIA.ACCESSIBILITY]: ['HEARING_LOOP']
      },
      acknowledged_by: 'coordinator-7',
      acknowledged_at: '2026-10-04T09:30:00.000Z'
    });
  });

  test('TC-128 a request with nothing to acknowledge records that plainly', () => {
    const assessment = assessVenue(hallA, needs({ facilities: ['WIFI'] }));

    expect(acknowledgementRecord({ assessment, acknowledged: [], userId: 'coordinator-7', at: 'now' }))
      .toEqual({ acknowledged: false, criteria: [], missing: {}, acknowledged_by: null, acknowledged_at: null });
  });

  test('TC-129 an unacknowledged warning cannot be written away as acknowledged', () => {
    const assessment = assessVenue(hallA, needs({ facilities: ['KITCHEN_PANTRY'], layout: 'BANQUET' }));

    expect(() => acknowledgementRecord({
      assessment,
      acknowledged: [CRITERIA.FACILITY],
      userId: 'coordinator-7',
      at: '2026-10-04T09:30:00.000Z'
    })).toThrow(/LAYOUT/);
  });
});

describe('E8 / SCRUM-124 unit — the event record supplies what is required', () => {
  test('TC-130 a stored event maps onto the criteria the gate evaluates', () => {
    expect(bookingRequirements({
      event_id: 'EVT-1',
      expected_attendance: 180,
      required_layout: 'BANQUET',
      facilities: ['WIFI', 'STAGE'],
      accessibility: ['HEARING_LOOP']
    })).toEqual({
      expected_attendance: 180,
      event_date: '',
      start_time: '',
      end_time: '',
      facilities: ['WIFI', 'STAGE'],
      accessibility: ['HEARING_LOOP'],
      layout: 'BANQUET'
    });
  });

  test('TC-131 an event that answered No to a section asks for nothing on it', () => {
    expect(bookingRequirements({ expected_attendance: 40, required_layout: null }))
      .toEqual({
        expected_attendance: 40,
        event_date: '',
        start_time: '',
        end_time: '',
        facilities: [],
        accessibility: [],
        layout: null
      });
  });
});

describe('E8 / SCRUM-124 unit — the shortlist starts from the event\'s requirements', () => {
  test('TC-148 Find venues carries the event\'s requirements into the filters', () => {
    expect(prefillFilters({
      expected_attendance: 180,
      preferred_location: 'CENTRAL',
      required_layout: 'THEATRE',
      facilities: ['WIFI', 'STAGE'],
      accessibility: ['LIFT']
    })).toEqual({
      location: 'CENTRAL',
      min_capacity: 180,
      max_capacity: null,
      facilities: ['WIFI', 'STAGE'],
      accessibility: ['LIFT'],
      layout: 'THEATRE'
    });
  });

  test('TC-149 an event that asked for nothing leaves the filters clear', () => {
    expect(prefillFilters({})).toEqual(emptyFilters());
    expect(prefillFilters(null)).toEqual(emptyFilters());
  });

  test('TC-150 the pre-filled filters are the ones the screen can clear', () => {
    // AC2 stays reachable: clearing a criterion widens the shortlist to venues
    // that fall short on it, which is what the acknowledge gate exists for.
    const filters = prefillFilters({ expected_attendance: 180, facilities: ['WIFI'], required_layout: 'THEATRE' });

    expect(activeFilters(filters).map((item) => item.key))
      .toEqual(['capacity_range', 'facilities', 'layout']);
  });
});

// ---------------------------------------------------------------------------
// FUNCTIONAL — the coordinator meets the gate on screen
// ---------------------------------------------------------------------------

const event = (fields) => ({
  event_id: 'EVT-1',
  event_name: 'Annual Conference',
  event_date: '2026-11-20',
  start_time: '09:00',
  end_time: '17:00',
  expected_attendance: 150,
  status: 'APPROVED',
  required_layout: 'THEATRE',
  facilities: ['WIFI'],
  accessibility: [],
  ...fields
});

const submitButton = () => screen.getByRole('button', { name: /request this venue/i });

const chooseVenue = async (name) => {
  await userEvent.click(await screen.findByRole('radio', { name }));
};

// The bookings tab opens on the list of requests already raised; the form that
// judges a venue is one click further in.
const openBookingForm = async () => {
  render(<VenueBookings user={user} />);
  await userEvent.click(await screen.findByRole('button', { name: /new booking request/i }));
};

// The whole card is the radio's label, so the card is reached through its radio.
const venueCard = async (name) => (await screen.findByRole('radio', { name })).closest('.cs-venue-card');

beforeEach(() => {
  requestVenueBooking.mockReset();
  requestVenueBooking.mockResolvedValue({ booking_id: 'BK-1' });
});

describe('E8 / SCRUM-124 functional — a venue that cannot hold the event is refused outright', () => {
  test('TC-132 a capacity failure disables the request and says why', () => {
    render(<VenueBookingRequest venue={hallA} event={event({ expected_attendance: 400 })} user={user} />);

    expect(submitButton()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/capacity/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/400/);
    // The criterion row names what the event asked for; the chip beside it judges.
    expect(screen.getByText('400 pax')).toBeInTheDocument();
  });

  test('TC-133 a capacity failure offers no way to acknowledge past it', () => {
    render(<VenueBookingRequest venue={hallA} event={event({ expected_attendance: 400 })} user={user} />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  test('TC-134 nothing is submitted while the venue is blocked', async () => {
    render(<VenueBookingRequest venue={hallA} event={event({ expected_attendance: 400 })} user={user} />);

    await userEvent.click(submitButton());
    expect(requestVenueBooking).not.toHaveBeenCalled();
  });
});

describe('E8 / SCRUM-124 functional — a shortfall warns and waits to be acknowledged', () => {
  const shortfall = () => event({ facilities: ['WIFI', 'KITCHEN_PANTRY'], required_layout: 'BANQUET' });

  test('TC-135 each failing criterion is listed with what the venue lacks', () => {
    render(<VenueBookingRequest venue={hallA} event={shortfall()} user={user} />);

    // Every requirement is its own line with its own verdict: WIFI passes while
    // KITCHEN PANTRY and BANQUET do not. Which item must be acknowledged is then
    // named again on the control that has to be ticked.
    expect(screen.getByText('WIFI')).toBeInTheDocument();
    expect(screen.getByText('KITCHEN PANTRY')).toBeInTheDocument();
    expect(screen.getByText('BANQUET')).toBeInTheDocument();
    expect(screen.getAllByText('Not met')).toHaveLength(2);
    // Capacity, WIFI, and the hours (Hall A states none, so it is open any time).
    expect(screen.getAllByText('Met')).toHaveLength(3);

    expect(screen.getByRole('checkbox', { name: /kitchen pantry/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /banquet/i })).toBeInTheDocument();
  });

  test('TC-136 the request stays disabled until every warning is acknowledged', async () => {
    render(<VenueBookingRequest venue={hallA} event={shortfall()} user={user} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(submitButton()).toBeDisabled();

    await userEvent.click(boxes[0]);
    expect(submitButton()).toBeDisabled();

    await userEvent.click(boxes[1]);
    expect(submitButton()).toBeEnabled();
  });

  test('TC-137 the acknowledgement travels with the submitted request', async () => {
    render(<VenueBookingRequest venue={hallA} event={shortfall()} user={user} />);
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
    await userEvent.click(submitButton());

    await waitFor(() => expect(requestVenueBooking).toHaveBeenCalledTimes(1));
    const [payload] = requestVenueBooking.mock.calls[0];
    expect(payload.venue_id).toBe('VEN-001');
    expect(payload.event_id).toBe('EVT-1');
    expect(payload.acknowledgement).toMatchObject({
      acknowledged: true,
      criteria: ['FACILITY', 'LAYOUT'],
      missing: { FACILITY: ['KITCHEN_PANTRY'], LAYOUT: ['BANQUET'] },
      acknowledged_by: 'coordinator-7'
    });
    expect(payload.acknowledgement.acknowledged_at).toEqual(expect.any(String));
  });

  test('TC-138 unticking a warning disables the request again', async () => {
    render(<VenueBookingRequest venue={hallA} event={shortfall()} user={user} />);
    const boxes = screen.getAllByRole('checkbox');
    for (const box of boxes) await userEvent.click(box);
    expect(submitButton()).toBeEnabled();

    await userEvent.click(boxes[0]);
    expect(submitButton()).toBeDisabled();
  });
});

describe('E8 / SCRUM-124 functional — a suitable venue goes straight through', () => {
  test('TC-139 no warnings are shown and the request submits unacknowledged', async () => {
    render(<VenueBookingRequest venue={hallA} event={event()} user={user} />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();

    await userEvent.click(submitButton());
    await waitFor(() => expect(requestVenueBooking).toHaveBeenCalledTimes(1));
    expect(requestVenueBooking.mock.calls[0][0].acknowledgement).toMatchObject({ acknowledged: false });
  });

  test('TC-140 the criteria evaluated are shown even when all of them pass', () => {
    render(<VenueBookingRequest venue={hallA} event={event()} user={user} />);

    expect(screen.getByText(/capacity/i)).toBeInTheDocument();
    expect(screen.getByText(/layout/i)).toBeInTheDocument();
  });

  test('TC-141 a failed save is surfaced and does not claim success', async () => {
    requestVenueBooking.mockRejectedValue(new Error('Venue booking could not be saved.'));
    render(<VenueBookingRequest venue={hallA} event={event()} user={user} />);

    await userEvent.click(submitButton());
    expect(await screen.findByText('Venue booking could not be saved.')).toBeInTheDocument();
  });
});

describe('E8 / SCRUM-124 functional — Venue Staff see the acknowledgement on the booking', () => {
  const acknowledgement = {
    acknowledged: true,
    criteria: ['FACILITY', 'LAYOUT'],
    missing: { FACILITY: ['KITCHEN_PANTRY'], LAYOUT: ['BANQUET'] },
    acknowledged_by: 'coordinator-7',
    acknowledged_at: '2026-10-04T09:30:00.000Z'
  };

  test('TC-142 the notice names every criterion the coordinator accepted', () => {
    render(<BookingAcknowledgementNotice acknowledgement={acknowledgement} />);

    expect(screen.getByText(/kitchen pantry/i)).toBeInTheDocument();
    expect(screen.getByText(/banquet/i)).toBeInTheDocument();
  });

  test('TC-165 the acknowledgement reaches the Venue Staff availability calendar', async () => {
    // TC-142 proves the notice renders; this proves it is actually on the screen
    // Venue Staff use, which is what "shown to Venue Staff" means.
    loadVenueSearchContext.mockResolvedValue({
      venues: [hallA],
      unavailability: [],
      bookings: [{
        id: 'BK-1', booking_id: 'BK-1', venue_id: 'VEN-001', event_name: 'Annual Conference',
        status: 'APPROVED', start_datetime: '2026-11-20T09:00:00.000Z', end_datetime: '2026-11-20T17:00:00.000Z',
        suitability_acknowledgement: acknowledgement
      }]
    });

    render(<VenueAvailabilityCalendar user={{ uid: 'staff-1' }} role="VENUE_STAFF" />);

    expect(await screen.findByText(/Requested despite known shortfalls/i)).toBeInTheDocument();
    expect(screen.getByText(/KITCHEN PANTRY/i)).toBeInTheDocument();
    expect(screen.getByText(/BANQUET/i)).toBeInTheDocument();
  });

  test('TC-143 a booking with nothing acknowledged shows no notice', () => {
    const { container } = render(
      <BookingAcknowledgementNotice acknowledgement={{ acknowledged: false, criteria: [], missing: {} }} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('E8 / SCRUM-124 functional — the booking screen is where an unsuitable venue can be named', () => {
  // Route 1 ("Find venues") only ever offers venues that already fit, so it can
  // never trip the gate. Route 2 (the Venue bookings tab) lets the coordinator
  // name any venue in the catalogue, which is the path AC1 and AC2 must stop.
  const tooSmall = { venue_id: 'VEN-009', name: 'Seminar Room', max_capacity: 20, facilities: [], accessibility: [], layouts: [] };

  beforeEach(() => {
    loadVenueCatalogue.mockResolvedValue([hallA, tooSmall]);
    loadVenueBookings.mockResolvedValue([]);
    withdrawVenueBooking.mockResolvedValue({ status: 'WITHDRAWN' });
    reviewApi.list.mockResolvedValue({ events: [{ id: 'EVT-1', name: 'Annual Conference', status: 'APPROVED' }] });
    reviewApi.detail.mockResolvedValue({ event: event() });
  });

  test('TC-160 the tab opens on the requests this coordinator has raised', async () => {
    loadVenueBookings.mockResolvedValue([{
      booking_id: 'BK-1', venue_id: 'VEN-001', event_id: 'EVT-1', event_name: 'Annual Conference',
      event_date: '2026-11-20', start_time: '09:00', end_time: '17:00', expected_attendance: 150,
      status: 'PENDING', requested_at: '2026-10-05T09:00:00.000Z', suitability_acknowledgement: null
    }]);
    render(<VenueBookings user={user} />);

    expect(await screen.findByRole('heading', { name: 'Annual Conference' })).toBeInTheDocument();
    expect(screen.getByText('Hall A')).toBeInTheDocument();
    expect(screen.getByText('PENDING')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new booking request/i })).toBeInTheDocument();
    // The form is not in the way until it is asked for.
    expect(screen.queryByRole('radio', { name: 'Hall A' })).not.toBeInTheDocument();
  });

  test('TC-163 a booking expands to its details and offers the event request', async () => {
    const onViewEvent = jest.fn();
    loadVenueBookings.mockResolvedValue([{
      booking_id: 'BK-1', venue_id: 'VEN-001', event_id: 'EVT-1', event_name: 'Annual Conference',
      event_date: '2026-11-20', start_time: '09:00', end_time: '17:00', expected_attendance: 150,
      status: 'PENDING', requested_at: '2026-10-05T09:00:00.000Z', suitability_acknowledgement: null
    }]);
    render(<VenueBookings user={user} onViewEvent={onViewEvent} />);

    const expand = await screen.findByRole('button', { name: /view details/i });
    expect(screen.queryByText('Expected attendance')).not.toBeInTheDocument();

    await userEvent.click(expand);
    expect(screen.getByText('Expected attendance')).toBeInTheDocument();
    expect(screen.getByText('Venue capacity')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /view event request/i }));
    expect(onViewEvent).toHaveBeenCalledWith('EVT-1');

    await userEvent.click(screen.getByRole('button', { name: /hide details/i }));
    expect(screen.queryByText('Expected attendance')).not.toBeInTheDocument();
  });

  test('TC-161 a coordinator with no requests is told so, and can still start one', async () => {
    render(<VenueBookings user={user} />);

    expect(await screen.findByText(/No booking requests raised yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new booking request/i })).toBeInTheDocument();
  });

  test('TC-162 the request action is gone once the booking has been sent', async () => {
    await openBookingForm();
    await userEvent.selectOptions(await screen.findByLabelText('Event'), 'EVT-1');
    await chooseVenue('Hall A');
    await userEvent.click(submitButton());

    expect(await screen.findByText(/Booking request sent to Venue Staff/i)).toBeInTheDocument();
    // B9 AC7's rule applied here: the same request cannot be sent twice.
    expect(screen.queryByRole('button', { name: /request this venue/i })).not.toBeInTheDocument();
  });

  test('TC-169 a venue already requested for this event is refused with a reason', async () => {
    loadVenueBookings.mockResolvedValue([{
      booking_id: 'BK-1', venue_id: 'VEN-001', event_id: 'EVT-1', event_name: 'Annual Conference',
      status: 'PENDING', requested_at: '2026-10-05T09:00:00.000Z', suitability_acknowledgement: null
    }]);
    render(<VenueBookings user={user} event={{ id: 'EVT-1' }} venue={hallA} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already has a pending request for Hall A/i);
    // Nothing to acknowledge and nothing to send while that request stands.
    expect(screen.queryByRole('button', { name: /request this venue/i })).not.toBeInTheDocument();
    expect(requestVenueBooking).not.toHaveBeenCalled();
  });

  test('TC-170 arriving straight into the form reports its back handler without crashing', async () => {
    // Regression: the effect that hands the back handler up runs on the first
    // render, which returns early while loading. A handler declared after that
    // early return is still in its temporal dead zone when the effect fires.
    const onBackChange = jest.fn();
    render(<VenueBookings user={user} event={{ id: 'EVT-1' }} venue={hallA} onBackChange={onBackChange} />);

    expect(await screen.findByRole('heading', { name: /Suitability for/i })).toBeInTheDocument();
    expect(onBackChange).toHaveBeenCalledWith(expect.any(Function));
  });

  test('TC-171 a pending request can be withdrawn, and asks before it does', async () => {
    const raised = {
      booking_id: 'BK-1', venue_id: 'VEN-001', event_id: 'EVT-1', event_name: 'Annual Conference',
      event_date: '2026-11-20', status: 'PENDING', requested_at: '2026-10-05T09:00:00.000Z',
      suitability_acknowledgement: null
    };
    loadVenueBookings.mockResolvedValue([raised]);
    render(<VenueBookings user={user} />);

    await userEvent.click(await screen.findByRole('button', { name: /view details/i }));
    await userEvent.click(screen.getByRole('button', { name: /withdraw request/i }));

    // It asks in a dialog first, and backing out sends nothing.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /Withdraw this request\?/i })).toBeInTheDocument();
    expect(within(dialog).getByText('Annual Conference')).toBeInTheDocument();
    expect(within(dialog).getByText('Hall A')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /keep request/i }));
    expect(withdrawVenueBooking).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /withdraw request/i }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /yes, withdraw/i }));
    // K5 / SCRUM-186 AC2 — the withdrawal is made on behalf of the signed-in coordinator, so the
    // adapter can refuse it once the event is no longer assigned to them.
    await waitFor(() => expect(withdrawVenueBooking).toHaveBeenCalledWith({ user, bookingId: 'BK-1' }));
  });

  test('TC-172 a request that is not pending offers no withdraw', async () => {
    loadVenueBookings.mockResolvedValue([{
      booking_id: 'BK-2', venue_id: 'VEN-001', event_id: 'EVT-1', event_name: 'Annual Conference',
      status: 'APPROVED', requested_at: '2026-10-05T09:00:00.000Z', suitability_acknowledgement: null
    }]);
    render(<VenueBookings user={user} />);

    await userEvent.click(await screen.findByRole('button', { name: /view details/i }));
    expect(screen.queryByRole('button', { name: /withdraw request/i })).not.toBeInTheDocument();
  });

  test('TC-173 a withdraw that fails is reported and does not claim success', async () => {
    withdrawVenueBooking.mockRejectedValue(new Error('That request could not be withdrawn.'));
    loadVenueBookings.mockResolvedValue([{
      booking_id: 'BK-1', venue_id: 'VEN-001', event_id: 'EVT-1', event_name: 'Annual Conference',
      status: 'PENDING', requested_at: '2026-10-05T09:00:00.000Z', suitability_acknowledgement: null
    }]);
    render(<VenueBookings user={user} />);

    await userEvent.click(await screen.findByRole('button', { name: /view details/i }));
    await userEvent.click(screen.getByRole('button', { name: /withdraw request/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, withdraw/i }));

    expect(await screen.findByText('That request could not be withdrawn.')).toBeInTheDocument();
  });

  test('TC-152 the venue list offers the whole catalogue, not only venues that fit', async () => {
    await openBookingForm();

    expect(await screen.findByRole('radio', { name: 'Seminar Room' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Hall A' })).toBeInTheDocument();
  });

  test('TC-153 naming a venue that cannot hold the event blocks the request', async () => {
    await openBookingForm();

    await userEvent.selectOptions(await screen.findByLabelText('Event'), 'EVT-1');
    await chooseVenue('Seminar Room');

    expect(await screen.findByRole('alert')).toHaveTextContent(/capacity/i);
    expect(submitButton()).toBeDisabled();
    expect(requestVenueBooking).not.toHaveBeenCalled();
  });

  test('TC-164 an event titled the way the events collection stores it is named, not "Untitled"', async () => {
    // Events keep their title in `name`; a booking carries `event_name`. The gate
    // reads either, so a real event does not come through blank.
    reviewApi.detail.mockResolvedValue({ event: { ...event(), event_name: undefined, name: 'Happy path check' } });
    render(<VenueBookings user={user} event={{ id: 'EVT-1' }} venue={hallA} />);

    expect(await screen.findByRole('heading', { name: /Suitability for Happy path check/i })).toBeInTheDocument();
    expect(screen.queryByText(/Untitled event/i)).not.toBeInTheDocument();
  });

  test('TC-154 arriving from Find venues carries both choices in already', async () => {
    render(<VenueBookings user={user} event={{ id: 'EVT-1' }} venue={hallA} />);

    expect(await screen.findByRole('heading', { name: /Suitability for Annual Conference/i })).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  test('TC-155 nothing is judged until both an event and a venue are chosen', async () => {
    await openBookingForm();

    expect(await screen.findByRole('radio', { name: 'Hall A' })).toBeInTheDocument();
    expect(screen.getByText(/Choose an event first/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request this venue/i })).not.toBeInTheDocument();
    // The event card is always there; its details only fill in once one is chosen.
    expect(screen.queryByText('Expected attendance')).not.toBeInTheDocument();
  });

  test('TC-157 the venue list says which venues fit, before one is chosen', async () => {
    await openBookingForm();
    await userEvent.selectOptions(await screen.findByLabelText('Event'), 'EVT-1');

    const hallA = await venueCard('Hall A');
    await waitFor(() => expect(within(hallA).getByText('Meets all requirements')).toBeInTheDocument());
    // The card lists what the venue offers, one feature per line; the chip above
    // is what says whether that adds up to the event's requirements.
    expect(within(hallA).getByText('200 pax')).toBeInTheDocument();
    expect(within(hallA).getByText('WIFI')).toBeInTheDocument();
    expect(within(hallA).getByText('THEATRE')).toBeInTheDocument();

    const small = await venueCard('Seminar Room');
    // Capacity, plus the missing WIFI and THEATRE — counted the same way whatever
    // the kind, so a venue blocked on hours is not mislabelled as too small.
    expect(within(small).getByText('3 requirements not met')).toBeInTheDocument();
    expect(within(small).getByText('20 pax')).toBeInTheDocument();
  });

  test('TC-156 choosing an event shows what that event needs, before any venue is picked', async () => {
    await openBookingForm();

    await userEvent.selectOptions(await screen.findByLabelText('Event'), 'EVT-1');

    // The details fill in inside the same card that holds the event question.
    const panel = await screen.findByRole('region', { name: /event details/i });
    expect(within(panel).getByRole('combobox')).toBeInTheDocument();
    expect(within(panel).getByText('Expected attendance')).toBeInTheDocument();
    expect(within(panel).getByText('150')).toBeInTheDocument();
    expect(within(panel).getByText('THEATRE')).toBeInTheDocument();
    expect(within(panel).getByText('WIFI')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request this venue/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RULES — the server boundary
//
// firestore.rules is the only thing that stops a crafted request, so the gate
// needs a test there too. Proving the *behaviour* means running the Firestore
// emulator, which needs packages and a Java runtime we have deliberately not
// added; what these do instead is assert the policy the rules state, so that
// loosening a rule breaks the build. Same approach as TC-015 / TC-016.
// ---------------------------------------------------------------------------

const RULES = fs.readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8');

const rulesBlock = (collection) => {
  const start = RULES.indexOf(`match /${collection}/`);
  if (start === -1) throw new Error(`No rules found for ${collection}`);
  return RULES.slice(start, RULES.indexOf('\n    }', start)).replace(/\s+/g, ' ');
};

const bookingRules = () => rulesBlock('venue_bookings');

const createRule = () => {
  const rule = bookingRules().match(/allow create:\s*if([^;]*);/);
  if (!rule) throw new Error('venue_bookings has no create rule');
  return rule[1];
};

describe('E8 / SCRUM-124 rules — booking requests carry their suitability acknowledgement', () => {
  test('TC-144 only a coordinator may raise a booking request, and only as themselves', () => {
    expect(createRule()).toContain("hasRole('EVENT_COORDINATOR')");
    expect(createRule()).toContain('request.resource.data.requested_by == request.auth.uid');
    expect(createRule()).not.toContain("hasRole('EVENT_ORGANISER')");
    expect(createRule()).not.toContain("hasRole('ATTENDEE')");
  });

  test('TC-145 a booking cannot be written without its acknowledgement record', () => {
    expect(createRule()).toContain('suitability_acknowledgement');
    expect(createRule()).toContain('acknowledged');
  });

  test('TC-146 a venue over its capacity cannot be booked even by a crafted request', () => {
    expect(createRule()).toContain('expected_attendance');
    expect(createRule()).toMatch(/max_capacity/);
  });

  // The gate can only judge a venue against requirements it is allowed to read.
  // These three collections were organiser-only, so an assigned coordinator could
  // not see the layout, facilities or accessibility they are matching against.
  test.each(['event_venue_requirements', 'event_facilities', 'event_accessibility'])(
    'TC-151 a coordinator on the event may read %s, but still may not edit it',
    (collection) => {
      const block = rulesBlock(collection);
      const readRule = block.match(/allow get, list:\s*if([^;]*);/);
      expect(readRule).not.toBeNull();
      expect(readRule[1]).toContain('canReadEvent(');

      const writeRule = block.match(/allow (?:create|update, delete|update|delete)[^:]*:\s*if([^;]*);/g) || [];
      writeRule.forEach((rule) => expect(rule).toContain('ownsEvent('));
      writeRule.forEach((rule) => expect(rule).not.toContain('canReadEvent('));
    }
  );

  test('TC-174 withdrawing is the only update, and only the raiser may do it', () => {
    const rule = bookingRules().match(/allow update:\s*if([^;]*);/);
    expect(rule).not.toBeNull();

    expect(rule[1]).toContain("hasRole('EVENT_COORDINATOR')");
    expect(rule[1]).toContain('resource.data.requested_by == request.auth.uid');
    // Only PENDING -> WITHDRAWN, and nothing else on the document may move.
    expect(rule[1]).toContain("resource.data.status == 'PENDING'");
    expect(rule[1]).toContain("request.resource.data.status == 'WITHDRAWN'");
    expect(rule[1]).toContain("hasOnly(['status', 'withdrawn_at'])");
  });

  test('TC-147 the acknowledgement cannot be rewritten after the booking is raised', () => {
    const block = bookingRules();
    const updateRule = block.match(/allow update:\s*if([^;]*);/);
    if (!updateRule) {
      expect(block).not.toMatch(/allow\s+[a-z,\s]*\bupdate\b/);
      return;
    }
    expect(updateRule[1]).toContain(
      'request.resource.data.suitability_acknowledgement == resource.data.suitability_acknowledgement'
    );
  });
});

describe('E8 / SCRUM-124 unit — the same venue is not requested twice for one event', () => {
  const raised = (fields) => ({ booking_id: 'BK-1', event_id: 'EVT-1', venue_id: 'VEN-001', status: 'PENDING', ...fields });

  test('TC-166 a live request for the same event and venue is found', () => {
    expect(existingBookingFor([raised()], { eventId: 'EVT-1', venueId: 'VEN-001' })).toMatchObject({ booking_id: 'BK-1' });
    expect(existingBookingFor([raised({ status: 'APPROVED' })], { eventId: 'EVT-1', venueId: 'VEN-001' })).not.toBeNull();
  });

  test('TC-167 a different event or a different venue is not a duplicate', () => {
    expect(existingBookingFor([raised()], { eventId: 'EVT-2', venueId: 'VEN-001' })).toBeNull();
    expect(existingBookingFor([raised()], { eventId: 'EVT-1', venueId: 'VEN-009' })).toBeNull();
  });

  test('TC-168 a request that is no longer live leaves the pairing free again', () => {
    expect(existingBookingFor([raised({ status: 'REJECTED' })], { eventId: 'EVT-1', venueId: 'VEN-001' })).toBeNull();
    expect(existingBookingFor([raised({ status: 'CANCELLED' })], { eventId: 'EVT-1', venueId: 'VEN-001' })).toBeNull();
  });
});

describe('E8 / SCRUM-124 unit — a finished event has nothing left to book', () => {
  test.each(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'SAFETY_REVIEW'])('%s events offer no venue search', (status) => {
    expect(canFindVenues({ status })).toBe(false);
  });

  test.each(['APPROVED', 'PLANNING'])('%s events can request a venue', (status) => {
    expect(canFindVenues({ status })).toBe(true);
  });
});
