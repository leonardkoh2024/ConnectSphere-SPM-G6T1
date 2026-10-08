// E4 / SCRUM-120 — See when a venue is free. The calendar rules, without React.
// Every date here is built in local time, which is how the calendar buckets days,
// so the suite passes in any timezone.

import { ROLES } from "./roles";
import { buildMonthCalendar, buildVenueCalendar, calendarRange, isInternalRole, monthGrid, monthLabel, shiftMonth, SLOT } from "./venueCalendar";

const at = (day, hh, mm = 0) => new Date(2026, 9, day, hh, mm).toISOString();

// 12 Oct 2026 is a Monday.
const hall = {
  venue_id: "VEN-001",
  name: "Hall A",
  operating_hours: [
    { weekday: "MONDAY", opens_at: "09:00", closes_at: "18:00" },
    { weekday: "TUESDAY", opens_at: "09:00", closes_at: "18:00" }
  ]
};

const build = (overrides = {}) => buildVenueCalendar({
  venueId: "VEN-001",
  venues: [hall],
  from: "2026-10-12",
  to: "2026-10-12",
  bookings: [],
  unavailability: [],
  role: ROLES.COORDINATOR,
  ...overrides
});

const kinds = (day) => day.segments.map((segment) => `${segment.start}-${segment.end} ${segment.kind}`);

test("TC-200 an open day with nothing on it is free inside operating hours and closed outside", () => {
  const calendar = build();
  expect(calendar.found).toBe(true);
  expect(calendar.days).toHaveLength(1);
  expect(kinds(calendar.days[0])).toEqual([
    "00:00-09:00 closed",
    "09:00-18:00 free",
    "18:00-24:00 closed"
  ]);
});

test("TC-201 an approved booking is occupied and splits the free time around it", () => {
  const calendar = build({
    bookings: [{ booking_id: "b1", venue_id: "VEN-001", status: "APPROVED", event_name: "Annual Gala", start_datetime: at(12, 12), end_datetime: at(12, 14) }]
  });
  expect(kinds(calendar.days[0])).toEqual([
    "00:00-09:00 closed",
    "09:00-12:00 free",
    "12:00-14:00 booked",
    "14:00-18:00 free",
    "18:00-24:00 closed"
  ]);
});

test("TC-202 an unavailability period is shown as blocked, with its reason", () => {
  const calendar = build({
    unavailability: [{ id: "u1", venue_id: "VEN-001", reason: "Electrical maintenance", start_datetime: at(12, 9), end_datetime: at(12, 11) }]
  });
  const blocked = calendar.days[0].segments.find((segment) => segment.kind === SLOT.BLOCKED);
  expect(blocked).toMatchObject({ start: "09:00", end: "11:00", label: "Electrical maintenance" });
});

test("TC-203 a block spanning several days makes the venue unavailable for its whole duration", () => {
  const calendar = build({
    to: "2026-10-14",
    unavailability: [{ id: "u1", venue_id: "VEN-001", reason: "Renovation", start_datetime: at(12, 15), end_datetime: at(14, 10) }]
  });
  // A block outranks closed hours, so it runs unbroken past closing time.
  expect(kinds(calendar.days[0])).toEqual(["00:00-09:00 closed", "09:00-15:00 free", "15:00-24:00 blocked"]);
  expect(kinds(calendar.days[1])).toEqual(["00:00-24:00 blocked"]);
  expect(kinds(calendar.days[2])).toEqual(["00:00-10:00 blocked", "10:00-24:00 closed"]);
});

test("TC-204 pending requests are listed apart from approved bookings and do not occupy time", () => {
  const calendar = build({
    bookings: [{ booking_id: "p1", venue_id: "VEN-001", status: "PENDING", event_name: "Product Launch", start_datetime: at(12, 10), end_datetime: at(12, 12) }]
  });
  const day = calendar.days[0];
  expect(day.segments.some((segment) => segment.kind === SLOT.BOOKED)).toBe(false);
  expect(kinds(day)).toContain("09:00-18:00 free");
  expect(day.pending).toEqual([expect.objectContaining({ start: "10:00", end: "12:00", label: "Product Launch", kind: SLOT.PENDING })]);
});

test("TC-205 rejected or withdrawn requests do not appear at all", () => {
  const calendar = build({
    bookings: [
      { booking_id: "r1", venue_id: "VEN-001", status: "REJECTED", event_name: "Refused", start_datetime: at(12, 10), end_datetime: at(12, 12) },
      { booking_id: "w1", venue_id: "VEN-001", status: "WITHDRAWN", event_name: "Withdrawn", start_datetime: at(12, 13), end_datetime: at(12, 15) }
    ]
  });
  expect(kinds(calendar.days[0])).toContain("09:00-18:00 free");
  expect(calendar.days[0].pending).toEqual([]);
});

test("TC-206 a weekday with no operating hours is closed all day", () => {
  // 14 Oct 2026 is a Wednesday, which Hall A does not open on.
  const calendar = build({ from: "2026-10-14", to: "2026-10-14" });
  expect(calendar.days[0].weekday).toBe("WEDNESDAY");
  expect(calendar.days[0].hours).toBeNull();
  expect(kinds(calendar.days[0])).toEqual(["00:00-24:00 closed"]);
});

test("TC-207 internal users see the event name on an occupied block", () => {
  const bookings = [{ booking_id: "b1", venue_id: "VEN-001", status: "APPROVED", event_name: "Annual Gala", start_datetime: at(12, 12), end_datetime: at(12, 14) }];
  for (const role of [ROLES.COORDINATOR, ROLES.VENUE_STAFF, ROLES.TECH_SUPPORT]) {
    const booked = build({ role, bookings }).days[0].segments.find((segment) => segment.kind === SLOT.BOOKED);
    expect(booked.label).toBe("Annual Gala");
  }
});

test("TC-208 external users see an occupied block without the event name", () => {
  const bookings = [
    { booking_id: "b1", venue_id: "VEN-001", status: "APPROVED", event_name: "Annual Gala", start_datetime: at(12, 12), end_datetime: at(12, 14) },
    { booking_id: "p1", venue_id: "VEN-001", status: "PENDING", event_name: "Product Launch", start_datetime: at(12, 15), end_datetime: at(12, 16) }
  ];
  for (const role of [ROLES.ORGANISER, ROLES.ATTENDEE, undefined]) {
    const day = build({ role, bookings }).days[0];
    expect(day.segments.find((segment) => segment.kind === SLOT.BOOKED).label).toBe("Booked");
    expect(day.pending[0].label).toBe("Pending request");
  }
});

test("TC-209 the internal roles are exactly the three ConnectSphere staff roles", () => {
  expect(isInternalRole(ROLES.COORDINATOR)).toBe(true);
  expect(isInternalRole(ROLES.VENUE_STAFF)).toBe(true);
  expect(isInternalRole(ROLES.TECH_SUPPORT)).toBe(true);
  expect(isInternalRole(ROLES.ORGANISER)).toBe(false);
  expect(isInternalRole(ROLES.ATTENDEE)).toBe(false);
  expect(isInternalRole(undefined)).toBe(false);
});

test("TC-210 a booked period spans the event plus its setup and teardown time", () => {
  const calendar = build({
    setupMinutes: 60,
    teardownMinutes: 30,
    bookings: [{ booking_id: "b1", venue_id: "VEN-001", status: "APPROVED", event_name: "Annual Gala", start_datetime: at(12, 12), end_datetime: at(12, 14) }]
  });
  expect(kinds(calendar.days[0])).toContain("11:00-14:30 booked");
});

test("TC-211 bookings stored as a date plus times are placed on the right day", () => {
  const calendar = build({
    to: "2026-10-13",
    bookings: [{ booking_id: "b1", venue_id: "VEN-001", status: "APPROVED", event_name: "Workshop", event_date: "2026-10-13", start_time: "10:00", end_time: "11:30" }]
  });
  expect(kinds(calendar.days[0])).toContain("09:00-18:00 free");
  expect(kinds(calendar.days[1])).toContain("10:00-11:30 booked");
});

test("TC-212 another venue's bookings and blocks are ignored", () => {
  const calendar = build({
    bookings: [{ booking_id: "b1", venue_id: "VEN-002", status: "APPROVED", event_name: "Elsewhere", start_datetime: at(12, 12), end_datetime: at(12, 14) }],
    unavailability: [{ id: "u1", venue_id: "VEN-002", reason: "Elsewhere", start_datetime: at(12, 9), end_datetime: at(12, 11) }]
  });
  expect(kinds(calendar.days[0])).toContain("09:00-18:00 free");
});

test("TC-213 back-to-back bookings that merely touch leave no gap and no overlap", () => {
  const calendar = build({
    bookings: [
      { booking_id: "b1", venue_id: "VEN-001", status: "APPROVED", event_name: "Morning", start_datetime: at(12, 9), end_datetime: at(12, 12) },
      { booking_id: "b2", venue_id: "VEN-001", status: "APPROVED", event_name: "Afternoon", start_datetime: at(12, 12), end_datetime: at(12, 15) }
    ]
  });
  expect(calendar.days[0].segments.filter((segment) => segment.kind === SLOT.BOOKED).map((segment) => segment.label)).toEqual(["Morning", "Afternoon"]);
  expect(kinds(calendar.days[0])).toContain("15:00-18:00 free");
});

test("TC-214 an unknown venue is reported as not found", () => {
  const calendar = build({ venueId: "VEN-404" });
  expect(calendar.found).toBe(false);
  expect(calendar.days).toEqual([]);
});

test("TC-215 a venue with no operating hours is flagged as having no availability data", () => {
  const calendar = build({
    venues: [{ venue_id: "VEN-001", name: "Hall A", operating_hours: [] }],
    unavailability: [{ id: "u1", venue_id: "VEN-001", reason: "Electrical maintenance", start_datetime: at(12, 9), end_datetime: at(12, 11) }]
  });
  expect(calendar.found).toBe(true);
  expect(calendar.hasAvailabilityData).toBe(false);
  // Free time cannot be claimed without hours, but known occupancy still shows.
  expect(kinds(calendar.days[0])).toEqual(["00:00-09:00 unknown", "09:00-11:00 blocked", "11:00-24:00 unknown"]);
});

test("TC-216 the date range must run forwards and stay within 31 days", () => {
  expect(calendarRange("2026-10-12", "2026-10-18")).toEqual({ days: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"], error: "" });
  expect(calendarRange("2026-10-18", "2026-10-12").error).toMatch(/on or after/i);
  expect(calendarRange("2026-10-01", "2026-11-15").error).toMatch(/31 days/i);
  expect(calendarRange("", "2026-10-12").error).toMatch(/choose/i);
});

test("TC-217 a month grid runs Monday to Sunday and covers the whole month", () => {
  const weeks = monthGrid("2026-10");
  // 1 Oct 2026 is a Thursday, 31 Oct a Saturday.
  expect(weeks[0]).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  expect(weeks[weeks.length - 1]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  expect(weeks).toHaveLength(5);
  weeks.forEach((week) => expect(week).toHaveLength(7));
});

test("TC-233 months step across a year boundary and read as words", () => {
  expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  expect(monthLabel("2026-10")).toBe("October 2026");
});

// The month view across every venue.
const annex = { venue_id: "VEN-002", name: "Annex", location: "NORTH", operating_hours: [{ weekday: "WEDNESDAY", opens_at: "10:00", closes_at: "16:00" }] };
const central = { ...hall, location: "CENTRAL" };
const monthBookings = [
  { booking_id: "b1", venue_id: "VEN-001", status: "APPROVED", event_name: "Annual Gala", start_datetime: at(12, 12), end_datetime: at(12, 14) },
  { booking_id: "p1", venue_id: "VEN-002", status: "PENDING", event_name: "Product Launch", start_datetime: at(12, 10), end_datetime: at(12, 11) },
  { booking_id: "r1", venue_id: "VEN-002", status: "REJECTED", event_name: "Refused", start_datetime: at(12, 9), end_datetime: at(12, 10) }
];
const monthBlocks = [{ id: "u1", venue_id: "VEN-001", reason: "Renovation", start_datetime: at(20, 15), end_datetime: at(22, 10) }];
const month = (overrides = {}) => buildMonthCalendar({
  month: "2026-10",
  venues: [central, annex],
  bookings: monthBookings,
  unavailability: monthBlocks,
  role: ROLES.COORDINATOR,
  ...overrides
});
const cell = (calendar, date) => calendar.weeks.flat().find((day) => day.date === date);

test("TC-234 by default the month shows every venue's bookings, requests and blocks", () => {
  const calendar = month();
  expect(calendar.venues.map((venue) => venue.name)).toEqual(["Annex", "Hall A"]);
  expect(cell(calendar, "2026-10-12").entries.map((entry) => `${entry.start} ${entry.kind} ${entry.venue_name} ${entry.label}`)).toEqual([
    "10:00 pending Annex Product Launch",
    "12:00 booked Hall A Annual Gala"
  ]);
  expect(cell(calendar, "2026-10-13").entries).toEqual([]);
  expect(cell(calendar, "2026-09-28").inMonth).toBe(false);
  expect(cell(calendar, "2026-10-12").inMonth).toBe(true);
});

test("TC-235 a block spanning several days appears on each, all day in the middle", () => {
  const calendar = month();
  expect(cell(calendar, "2026-10-20").entries[0]).toMatchObject({ kind: SLOT.BLOCKED, start: "15:00", end: "24:00", allDay: false, label: "Renovation" });
  expect(cell(calendar, "2026-10-21").entries[0]).toMatchObject({ kind: SLOT.BLOCKED, allDay: true });
  expect(cell(calendar, "2026-10-22").entries[0]).toMatchObject({ start: "00:00", end: "10:00" });
});

test("TC-236 filtering by venue keeps only that venue's entries", () => {
  const calendar = month({ filters: { venueIds: ["VEN-001"] } });
  expect(calendar.venues.map((venue) => venue.venue_id)).toEqual(["VEN-001"]);
  expect(cell(calendar, "2026-10-12").entries.map((entry) => entry.venue_id)).toEqual(["VEN-001"]);
});

test("TC-237 filtering by location keeps only venues there", () => {
  const calendar = month({ filters: { location: "NORTH" } });
  expect(calendar.venues.map((venue) => venue.name)).toEqual(["Annex"]);
  expect(cell(calendar, "2026-10-12").entries.map((entry) => entry.kind)).toEqual([SLOT.PENDING]);
});

test("TC-238 filtering by kind hides the kinds left unticked", () => {
  const calendar = month({ filters: { kinds: [SLOT.BOOKED] } });
  expect(cell(calendar, "2026-10-12").entries.map((entry) => entry.kind)).toEqual([SLOT.BOOKED]);
  expect(cell(calendar, "2026-10-21").entries).toEqual([]);
});

test("TC-239 with one venue chosen, days it does not open are marked closed", () => {
  const calendar = month({ filters: { venueIds: ["VEN-001"] } });
  expect(cell(calendar, "2026-10-12").closed).toBe(false);
  expect(cell(calendar, "2026-10-14").closed).toBe(true);
  // Across several venues, opening days differ, so no day is marked closed.
  expect(cell(month(), "2026-10-14").closed).toBe(false);
});

test("TC-240 external viewers see the month without event names", () => {
  const calendar = month({ role: ROLES.ORGANISER });
  expect(cell(calendar, "2026-10-12").entries.map((entry) => entry.label)).toEqual(["Pending request", "Booked"]);
});

test("TC-241 an unknown venue filter is reported as not found", () => {
  const calendar = month({ filters: { venueIds: ["VEN-404"] } });
  expect(calendar.found).toBe(false);
  expect(calendar.venues).toEqual([]);
});

test("TC-242 several venues can be chosen at once", () => {
  const calendar = month({ filters: { venueIds: ["VEN-002", "VEN-001"] } });
  expect(calendar.venues.map((venue) => venue.name)).toEqual(["Annex", "Hall A"]);
  expect(cell(calendar, "2026-10-12").entries).toHaveLength(2);
  // Two venues open on different days, so neither day is called closed.
  expect(cell(calendar, "2026-10-14").closed).toBe(false);
  expect(cell(calendar, "2026-10-15").closed).toBe(false);
});

test("TC-243 choosing no venue means every venue", () => {
  expect(month({ filters: { venueIds: [] } }).venues).toHaveLength(2);
});
