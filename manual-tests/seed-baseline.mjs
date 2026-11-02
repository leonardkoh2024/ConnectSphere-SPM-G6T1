// Manual-test baseline: wipes the local Firebase emulators (Auth + Firestore) and loads one
// known world that every manual test case in docs/manual-test-cases.md starts from.
//
//   npm run manual:start    emulators + this seed + the app, in one terminal
//   npm run manual:seed     re-run this seed against emulators that are already running
//
// It only ever talks to the emulators. FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST
// are forced to localhost before Firebase Admin starts, the project id is the offline
// `demo-connectsphere`, and the script stops if the emulators are not answering. It can never
// reach the shared team project.
//
// Dates are relative to the day the seed runs (Singapore time), so the data stays valid
// whenever a test is executed: upcoming events are weekdays in the future, registration
// windows are open "now", one hold has already expired, and one Confirmed event has ended.
// Every document ID and name is fixed, so test cases can name them.
//
// Field names and values follow what the app writes (see backend/testing/fixtures.js, which
// the integration tests use, and the *Api.js modules).

const PROJECT_ID = "demo-connectsphere";
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = PROJECT_ID;

const { initializeApp } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, Timestamp } = await import("firebase-admin/firestore");

const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
for (const host of [FIRESTORE, AUTH]) {
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) {
    console.error(`Refusing to seed: ${host} is not a local emulator.`);
    process.exit(1);
  }
}

export const PASSWORD = "ConnectSphere#2026";

// ---------------------------------------------------------------------------------------------
// Time helpers — Singapore wall clock (UTC+8, no daylight saving)
// ---------------------------------------------------------------------------------------------

const NOW = new Date();
const HOUR = 3_600_000;
const sgtIso = (date) => new Date(date.getTime() + 8 * HOUR).toISOString().slice(0, 10);
const TODAY = sgtIso(NOW);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isWeekend = (iso) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());
/** The first Monday–Friday on or after `n` days from today. */
const weekday = (n) => {
  let iso = addDays(TODAY, n);
  while (isWeekend(iso)) iso = addDays(iso, 1);
  return iso;
};
const at = (date, time = "00:00") => Timestamp.fromDate(new Date(`${date}T${time}:00+08:00`));
const hoursAgo = (h) => Timestamp.fromMillis(NOW.getTime() - h * HOUR);
const minutesFrom = (ts, m) => Timestamp.fromMillis(ts.toMillis() + m * 60_000);
/** Same clock time `days` working days (Mon–Fri, SGT) after `from`, as domain/venueHolds.js does. */
const workingDaysAfter = (from, days) => {
  let t = from.getTime();
  let left = days;
  while (left > 0) {
    t += 24 * HOUR;
    if (!isWeekend(sgtIso(new Date(t)))) left -= 1;
  }
  return Timestamp.fromMillis(t);
};

// ---------------------------------------------------------------------------------------------
// Users — one per role, plus a second organiser, coordinator and venue staff, and 4 attendees
// ---------------------------------------------------------------------------------------------

export const USERS = {
  organiser1: { uid: "mt-organiser-1", name: "Olivia Tan", email: "organiser1@manual.test", role: "EVENT_ORGANISER", org: "Harbour Arts Society" },
  organiser2: { uid: "mt-organiser-2", name: "Marcus Lim", email: "organiser2@manual.test", role: "EVENT_ORGANISER", org: "Northside Runners Club" },
  coordinator1: { uid: "mt-coordinator-1", name: "Chloe Ng", email: "coordinator1@manual.test", role: "EVENT_COORDINATOR" },
  coordinator2: { uid: "mt-coordinator-2", name: "Daniel Koh", email: "coordinator2@manual.test", role: "EVENT_COORDINATOR" },
  lead: { uid: "mt-lead", name: "Priya Nair", email: "lead@manual.test", role: "EVENT_COORDINATOR_LEAD" },
  venueStaff1: { uid: "mt-venue-staff-1", name: "Ravi Kumar", email: "venuestaff1@manual.test", role: "VENUE_STAFF" },
  venueStaff2: { uid: "mt-venue-staff-2", name: "Siti Rahman", email: "venuestaff2@manual.test", role: "VENUE_STAFF" },
  tech: { uid: "mt-tech", name: "Ethan Goh", email: "tech@manual.test", role: "TECHNICAL_SUPPORT_STAFF" },
  safety: { uid: "mt-safety", name: "Grace Lee", email: "safety@manual.test", role: "SAFETY_OFFICER" },
  attendee1: { uid: "mt-attendee-1", name: "Aaron Teo", email: "attendee1@manual.test", role: "ATTENDEE" },
  attendee2: { uid: "mt-attendee-2", name: "Bella Chua", email: "attendee2@manual.test", role: "ATTENDEE" },
  attendee3: { uid: "mt-attendee-3", name: "Caleb Wong", email: "attendee3@manual.test", role: "ATTENDEE" },
  attendee4: { uid: "mt-attendee-4", name: "Dana Yeo", email: "attendee4@manual.test", role: "ATTENDEE" }
};
const U = Object.fromEntries(Object.entries(USERS).map(([key, u]) => [key, u.uid]));
const CREATED = hoursAgo(24 * 30);

const users = () => Object.values(USERS).map((u, i) => ({
  path: `users/${u.uid}`,
  data: {
    user_id: u.uid, name: u.name, email: u.email, role: u.role,
    organisation_name: u.role === "ATTENDEE" ? null : (u.org || "ConnectSphere Event Services"),
    mobile_number: `9123456${i % 10}`,
    preferred_contact_method: "EMAIL",
    is_active: true, created_at: CREATED, updated_at: CREATED
  }
}));

// ---------------------------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------------------------

const hours = (opens, closes, days) => days.map((weekday) => ({ weekday, opens_at: opens, closes_at: closes }));
const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const EVERY_DAY = ["SUNDAY", ...WEEKDAYS, "SATURDAY"];

export const VENUES = {
  hall: {
    id: "mt-venue-hall", staff: U.venueStaff1, staffName: USERS.venueStaff1.name,
    name: "Marina Grand Hall", building: "Marina Exhibition Centre, Level 2", location: "CENTRAL",
    max_capacity: 200, setup_minutes: 30, turnaround_minutes: 30,
    layouts: ["THEATRE", "CLASSROOM", "BANQUET"],
    facilities: ["AIR_CONDITIONING", "WIFI", "STAGE", "POWER_POINTS", "TOILETS", "TABLES_AND_CHAIRS"],
    accessibility: ["WHEELCHAIR_ACCESS", "LIFT", "ACCESSIBLE_TOILET"],
    operating_hours: hours("08:00", "22:00", WEEKDAYS),
    emergency_access_notes: "Two fire exits behind the stage; fire engine access via Gate B.",
    known_restrictions: "No open flames. No confetti cannons."
  },
  room: {
    id: "mt-venue-room", staff: U.venueStaff1, staffName: USERS.venueStaff1.name,
    name: "Bayview Meeting Room", building: "Marina Exhibition Centre, Level 3", location: "CENTRAL",
    max_capacity: 40, setup_minutes: 15, turnaround_minutes: 15,
    layouts: ["BOARDROOM", "CLASSROOM", "U_SHAPE"],
    facilities: ["AIR_CONDITIONING", "WIFI", "POWER_POINTS"],
    accessibility: ["WHEELCHAIR_ACCESS", "LIFT"],
    operating_hours: hours("08:00", "22:00", WEEKDAYS),
    emergency_access_notes: "Single exit to the Level 3 lift lobby.",
    known_restrictions: "Maximum 40 people including staff."
  },
  garden: {
    id: "mt-venue-garden", staff: U.venueStaff2, staffName: USERS.venueStaff2.name,
    name: "Fort Canning Garden Lawn", building: "Fort Canning Park", location: "CENTRAL",
    max_capacity: 500, setup_minutes: 60, turnaround_minutes: 60,
    layouts: ["OPEN_SPACE", "STANDING_COCKTAIL", "EXHIBITION_BOOTHS"],
    facilities: ["TOILETS", "PARKING", "LOADING_AREA", "POWER_POINTS"],
    accessibility: ["STEP_FREE_ACCESS", "ACCESSIBLE_PARKING"],
    operating_hours: hours("07:00", "23:00", EVERY_DAY),
    emergency_access_notes: "Ambulance access from Canning Rise.",
    known_restrictions: "Amplified sound must stop by 22:00."
  },
  pavilion: {
    id: "mt-venue-pavilion", staff: U.venueStaff2, staffName: USERS.venueStaff2.name,
    name: "East Coast Pavilion", building: "East Coast Park, Area C", location: "EAST",
    max_capacity: 120, setup_minutes: 30, turnaround_minutes: 30,
    layouts: ["THEATRE", "CLASSROOM", "BANQUET"],
    facilities: ["AIR_CONDITIONING", "WIFI", "STAGE", "TOILETS"],
    accessibility: ["LIFT", "WHEELCHAIR_ACCESS"],
    operating_hours: hours("07:00", "23:00", EVERY_DAY),
    emergency_access_notes: "Exits on the beach side and the car park side.",
    known_restrictions: "No vehicles on the lawn."
  }
};
const V = Object.fromEntries(Object.entries(VENUES).map(([key, v]) => [key, v.id]));
const venueById = Object.fromEntries(Object.values(VENUES).map((v) => [v.id, v]));

const venues = () => Object.values(VENUES).flatMap(({ id, staff, staffName, ...v }) => [
  {
    path: `venues/${id}`,
    data: { venue_id: id, ...v, special_space_availability: "", is_active: true, created_at: CREATED, updated_at: CREATED }
  },
  // Keyed by venue id: firestore.rules looks the staff member up this way.
  { path: `venue_staff/${id}`, data: { venue_id: id, user_id: staff, staff_name: staffName } },
  ...v.operating_hours.map((h, n) => ({
    path: `venue_operating_hours/${id}-hrs-${n + 1}`,
    data: { operating_id: `${id}-hrs-${n + 1}`, venue_id: id, ...h }
  }))
]);

// Garden lawn closed for re-turfing three weeks from now (shows as Blocked on the calendar).
const MAINTENANCE_DAY = weekday(18);
const venueUnavailability = () => [{
  path: "venue_unavailability/mt-unavail-garden",
  data: {
    venue_id: V.garden, start_datetime: at(MAINTENANCE_DAY, "07:00"), end_datetime: at(addDays(MAINTENANCE_DAY, 2), "23:00"),
    reason: "Maintenance", note: "Lawn re-turfing.", created_by: U.venueStaff2, created_at: CREATED
  }
}];

// ---------------------------------------------------------------------------------------------
// Equipment stock
// ---------------------------------------------------------------------------------------------

export const STOCK = { AUDIO: 10, VISUAL: 6, LIGHTING: 8, STAGING: 4, FURNITURE: 200, OTHERS: 10 };
const equipmentInventory = () => Object.entries(STOCK).map(([type, total]) => ({
  path: `equipment_inventory/${type}`,
  data: { equipment_type: type, total_quantity: total, availability_revision: 0, updated_at: CREATED }
}));

// ---------------------------------------------------------------------------------------------
// Event dates (all relative to today)
// ---------------------------------------------------------------------------------------------

export const DATES = {
  draft: weekday(40),
  funRun: weekday(35),
  choir: weekday(45),
  careers: weekday(50),
  coding: weekday(30),
  gala: weekday(55),
  showcase: weekday(60),
  bookFair: weekday(25),
  pitch: weekday(21), // pitch night and founders breakfast share a date and a room (F4)
  wellness: weekday(28),
  launch: weekday(70), // product launch and leadership talk share a date and a room (F10)
  openDay: weekday(42),
  alumni: weekday(48),
  townHall: addDays(TODAY, -2), // already over (D5)
  foodFair: weekday(32),
  nightMarket: weekday(38),
  networking: addDays(TODAY, -20),
  craft: weekday(26),
  fireworks: weekday(33),
  marathon: weekday(52)
};

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

let refCounter = 0;
const event = (id, status, fields) => {
  refCounter += 1;
  return {
    id,
    data: {
      event_id: id,
      reference_no: `EVT-MT${String(refCounter).padStart(4, "0")}-SEED0`,
      organiser_id: U.organiser1,
      created_by: fields.organiser_id || U.organiser1,
      coordinator_id: null,
      assigned_at: null,
      purpose: "Community engagement",
      description: "Seeded event for manual testing.",
      equipment_required: false,
      registration_required: false,
      registration_capacity: null,
      registration_open_date: null,
      registration_open_time: null,
      registration_close_date: null,
      registration_close_time: null,
      status,
      submitted_at: status === "DRAFT" ? null : hoursAgo(24 * 10),
      created_at: hoursAgo(24 * 12),
      updated_at: hoursAgo(24 * 2),
      ...fields
    }
  };
};

const assigned = (coordinator, h = 24 * 9) => ({ coordinator_id: coordinator, assigned_at: hoursAgo(h) });
const registration = (capacity, openDate, openTime, closeDate, closeTime) => ({
  registration_required: true, registration_capacity: capacity,
  registration_open_date: openDate, registration_open_time: openTime,
  registration_close_date: closeDate, registration_close_time: closeTime
});
const OPEN_NOW = (capacity, closeDate) => registration(capacity, addDays(TODAY, -3), "09:00", closeDate, "18:00");

export const EVENTS = {
  draft: event("mt-e01-draft", "DRAFT", {
    name: "Spring Poetry Reading", purpose: "Poetry evening for members", description: "",
    event_date: DATES.draft, start_time: null, end_time: null, expected_attendance: null,
    equipment_required: null, registration_required: null, updated_at: hoursAgo(26)
  }),
  funRun: event("mt-e02-fun-run", "SUBMITTED", {
    name: "Charity Fun Run Briefing", organiser_id: U.organiser2, created_by: U.organiser2,
    purpose: "Brief volunteers for the charity run", description: "Route walkthrough and safety briefing for 120 volunteers.",
    event_date: DATES.funRun, start_time: "18:00", end_time: "20:00", expected_attendance: 120,
    submitted_at: hoursAgo(48), updated_at: hoursAgo(48)
  }),
  choir: event("mt-e03-choir", "SUBMITTED", {
    name: "Community Choir Concert", purpose: "Year-end concert", description: "Three choirs, one evening.",
    event_date: DATES.choir, start_time: "19:00", end_time: "21:00", expected_attendance: 150,
    submitted_at: hoursAgo(3), updated_at: hoursAgo(3)
  }),
  careers: event("mt-e04-careers", "SUBMITTED", {
    name: "Tech Careers Fair", purpose: "Connect students with employers",
    description: "Employer booths in the morning, talks in the afternoon.",
    event_date: DATES.careers, start_time: "10:00", end_time: "16:00", expected_attendance: 180,
    equipment_required: true, ...registration(150, addDays(TODAY, 7), "09:00", addDays(DATES.careers, -1), "18:00"),
    submitted_at: hoursAgo(30), ...assigned(U.coordinator1, 20)
  }),
  coding: event("mt-e05-coding", "UNDER_REVIEW", {
    name: "Youth Coding Workshop", purpose: "Teach teenagers to build a web page",
    description: "Hands-on workshop for 30 students aged 13-16.",
    event_date: DATES.coding, start_time: "10:00", end_time: "16:00", expected_attendance: 30,
    ...assigned(U.coordinator1), open_clarification_id: "mt-clarification-coding"
  }),
  gala: event("mt-e06-gala", "UNDER_REVIEW", {
    name: "Harbour Lights Gala Dinner", purpose: "Annual fundraising dinner",
    description: "Sit-down dinner with a short stage programme.",
    event_date: DATES.gala, start_time: "18:00", end_time: "22:00", expected_attendance: 120,
    ...assigned(U.coordinator1)
  }),
  showcase: event("mt-e07-showcase", "APPROVED", {
    name: "Harbour Arts Showcase", purpose: "Showcase local artists",
    description: "Live performances and an art exhibition.",
    event_date: DATES.showcase, start_time: "14:00", end_time: "17:00", expected_attendance: 150,
    equipment_required: true, ...registration(120, addDays(TODAY, 14), "09:00", addDays(DATES.showcase, -2), "18:00"),
    ...assigned(U.coordinator1)
  }),
  bookFair: event("mt-e08-book-fair", "APPROVED", {
    name: "Riverside Book Fair", purpose: "Second-hand book sale", description: "Book stalls and author signings.",
    event_date: DATES.bookFair, start_time: "09:00", end_time: "12:00", expected_attendance: 35,
    ...assigned(U.coordinator1)
  }),
  pitch: event("mt-e09-pitch", "PLANNING", {
    name: "Startup Pitch Night", purpose: "Founders pitch to investors", description: "Eight five-minute pitches and Q&A.",
    event_date: DATES.pitch, start_time: "18:00", end_time: "21:00", expected_attendance: 35,
    equipment_required: true, ...assigned(U.coordinator1)
  }),
  founders: event("mt-e10-founders", "APPROVED", {
    name: "Founders Breakfast Roundtable", organiser_id: U.organiser2, created_by: U.organiser2,
    purpose: "Founders networking", description: "Roundtable discussion over breakfast.",
    event_date: DATES.pitch, start_time: "18:30", end_time: "20:30", expected_attendance: 30,
    ...assigned(U.coordinator1)
  }),
  wellness: event("mt-e11-wellness", "APPROVED", {
    name: "Wellness Talk Series", purpose: "Lunchtime wellness talk", description: "Talk on sleep and stress.",
    event_date: DATES.wellness, start_time: "12:00", end_time: "14:00", expected_attendance: 80,
    ...assigned(U.coordinator1)
  }),
  launch: event("mt-e12-launch", "PLANNING", {
    name: "Product Launch Gala", purpose: "Launch of the new product line",
    description: "Main stage launch with a breakout demo room.",
    event_date: DATES.launch, start_time: "10:00", end_time: "12:00", expected_attendance: 150,
    equipment_required: true, ...OPEN_NOW(100, addDays(DATES.launch, -2)),
    equipment_placement: "Projector screens either side of the stage; speakers at the front corners.",
    crowd_movement: "Enter through the north doors, exit through the south doors.",
    ...assigned(U.coordinator1)
  }),
  leadership: event("mt-e13-leadership", "CONFIRMED", {
    name: "Leadership Talk", purpose: "Talk by a guest CEO", description: "A fireside chat on leading through change.",
    event_date: DATES.launch, start_time: "13:00", end_time: "15:00", expected_attendance: 30,
    ...OPEN_NOW(2, addDays(DATES.launch, -2)), ...assigned(U.coordinator1),
    approved_venue_booking_id: "mt-b-leadership-room", safety_review_requested_at: hoursAgo(24 * 4),
    last_safety_review_id: "mt-sr-leadership", confirmed_at: hoursAgo(24 * 3)
  }),
  openDay: event("mt-e14-open-day", "CONFIRMED", {
    name: "Open Day Tours", purpose: "Public open day", description: "Guided tours of the exhibition centre.",
    event_date: DATES.openDay, start_time: "09:00", end_time: "12:00", expected_attendance: 100,
    ...OPEN_NOW(50, addDays(DATES.openDay, -1)), ...assigned(U.coordinator1),
    approved_venue_booking_id: "mt-b-open-day-hall", safety_review_requested_at: hoursAgo(24 * 4),
    last_safety_review_id: "mt-sr-open-day", confirmed_at: hoursAgo(24 * 3)
  }),
  alumni: event("mt-e15-alumni", "CONFIRMED", {
    name: "Alumni Homecoming", purpose: "Alumni reunion", description: "Evening reunion on the lawn.",
    event_date: DATES.alumni, start_time: "18:00", end_time: "21:00", expected_attendance: 200,
    ...registration(150, addDays(TODAY, -10), "09:00", addDays(TODAY, -1), "18:00"), ...assigned(U.coordinator1),
    approved_venue_booking_id: "mt-b-alumni-garden", safety_review_requested_at: hoursAgo(24 * 6),
    last_safety_review_id: "mt-sr-alumni", confirmed_at: hoursAgo(24 * 5)
  }),
  townHall: event("mt-e16-town-hall", "CONFIRMED", {
    name: "Quarterly Town Hall", purpose: "Staff town hall", description: "Quarterly update to all staff.",
    event_date: DATES.townHall, start_time: "09:00", end_time: "11:00", expected_attendance: 90,
    ...assigned(U.coordinator1, 24 * 20), submitted_at: hoursAgo(24 * 22), created_at: hoursAgo(24 * 23),
    approved_venue_booking_id: "mt-b-town-hall-hall", safety_review_requested_at: hoursAgo(24 * 10),
    last_safety_review_id: "mt-sr-town-hall", confirmed_at: hoursAgo(24 * 9)
  }),
  foodFair: event("mt-e17-food-fair", "SAFETY_REVIEW", {
    name: "Community Food Fair", organiser_id: U.organiser2, created_by: U.organiser2,
    purpose: "Hawker food fair", description: "Forty food stalls on the lawn.",
    event_date: DATES.foodFair, start_time: "10:00", end_time: "18:00", expected_attendance: 400,
    equipment_required: true, ...assigned(U.coordinator1),
    approved_venue_booking_id: "mt-b-food-fair-garden", safety_review_requested_at: hoursAgo(20),
    equipment_placement: "Forty folding tables in two rows along the lawn's long edge.",
    crowd_movement: "One-way loop between the stall rows; exit by Canning Rise."
  }),
  nightMarket: event("mt-e18-night-market", "SAFETY_REVIEW", {
    name: "Night Market Fest", organiser_id: U.organiser2, created_by: U.organiser2,
    purpose: "Evening market", description: "Craft and snack stalls by the beach.",
    event_date: DATES.nightMarket, start_time: "17:00", end_time: "22:00", expected_attendance: 100,
    ...assigned(U.coordinator2),
    approved_venue_booking_id: "mt-b-night-market-pavilion", safety_review_requested_at: hoursAgo(6),
    last_safety_review_id: "mt-sr-night-market-1", returned_to_planning_at: hoursAgo(24 * 2),
    crowd_movement: "Marshals at both exits; queue lane along the car park side."
  }),
  networking: event("mt-e19-networking", "COMPLETED", {
    name: "Autumn Networking Evening", purpose: "Members networking", description: "Drinks and introductions.",
    event_date: DATES.networking, start_time: "18:00", end_time: "21:00", expected_attendance: 80,
    ...assigned(U.coordinator2, 24 * 40), submitted_at: hoursAgo(24 * 42), created_at: hoursAgo(24 * 43),
    approved_venue_booking_id: "mt-b-networking-hall", completed_at: hoursAgo(24 * 19)
  }),
  craft: event("mt-e20-craft", "CANCELLED", {
    name: "Winter Craft Market", purpose: "Handmade crafts market", description: "Thirty craft stalls.",
    event_date: DATES.craft, start_time: "10:00", end_time: "16:00", expected_attendance: 60,
    ...OPEN_NOW(40, addDays(DATES.craft, -1)), ...assigned(U.coordinator1),
    cancellation_reason: "Organiser could not secure enough vendors.", cancelled_at: hoursAgo(24 * 2),
    last_cancellation_id: "mt-h-craft-cancelled"
  }),
  fireworks: event("mt-e21-fireworks", "REJECTED", {
    name: "Rooftop Fireworks Party", purpose: "New year party", description: "Rooftop party with a fireworks show.",
    event_date: DATES.fireworks, start_time: "22:00", end_time: "23:59", expected_attendance: 300,
    ...assigned(U.coordinator1)
  }),
  marathon: event("mt-e22-marathon", "APPROVED", {
    name: "Marathon Expo", organiser_id: U.organiser2, created_by: U.organiser2,
    purpose: "Race pack collection", description: "Race pack collection and sponsor booths.",
    event_date: DATES.marathon, start_time: "10:00", end_time: "18:00", expected_attendance: 300,
    ...assigned(U.coordinator2)
  })
};
const E = Object.fromEntries(Object.entries(EVENTS).map(([key, e]) => [key, e.id]));
const eventData = (id) => Object.values(EVENTS).find((e) => e.id === id).data;

const events = () => Object.values(EVENTS).map(({ id, data }) => ({ path: `events/${id}`, data }));

// Venue requirements, facilities, accessibility and the organiser's equipment lines.
const requirement = (eventId, location, layout, facilities, accessibility, notes = "") => [
  {
    path: `event_venue_requirements/${eventId}`,
    data: {
      event_id: eventId, preferred_location: location, required_layout: layout,
      facilities_required: facilities.length > 0, accessibility_needed: accessibility.length > 0, accessibility_notes: notes
    }
  },
  ...facilities.map((f) => ({ path: `event_facilities/${eventId}_${f}`, data: { event_id: eventId, facility_id: f } })),
  ...accessibility.map((a) => ({ path: `event_accessibility/${eventId}_${a}`, data: { event_id: eventId, accessibility_id: a } }))
];
const eventRequirements = () => [
  ...requirement(E.draft, "", null, [], []),
  ...requirement(E.funRun, "CENTRAL", "THEATRE", ["WIFI"], []),
  ...requirement(E.choir, "CENTRAL", "THEATRE", ["STAGE"], ["WHEELCHAIR_ACCESS"]),
  ...requirement(E.careers, "CENTRAL", "CLASSROOM", ["WIFI", "POWER_POINTS"], ["WHEELCHAIR_ACCESS", "LIFT"], "Two exhibitors use wheelchairs."),
  ...requirement(E.coding, "CENTRAL", "CLASSROOM", ["WIFI", "POWER_POINTS"], ["WHEELCHAIR_ACCESS"]),
  ...requirement(E.gala, "CENTRAL", "BANQUET", ["STAGE", "TABLES_AND_CHAIRS"], ["WHEELCHAIR_ACCESS"]),
  ...requirement(E.showcase, "CENTRAL", "THEATRE", ["STAGE", "WIFI"], ["WHEELCHAIR_ACCESS"]),
  ...requirement(E.bookFair, "CENTRAL", "CLASSROOM", ["TABLES_AND_CHAIRS"], []),
  ...requirement(E.pitch, "CENTRAL", "BOARDROOM", ["WIFI", "POWER_POINTS"], []),
  ...requirement(E.founders, "CENTRAL", "BOARDROOM", ["WIFI"], []),
  ...requirement(E.wellness, "CENTRAL", "THEATRE", ["AIR_CONDITIONING"], []),
  ...requirement(E.launch, "CENTRAL", "THEATRE", ["STAGE", "WIFI"], ["WHEELCHAIR_ACCESS"]),
  ...requirement(E.leadership, "CENTRAL", "CLASSROOM", ["WIFI"], ["LIFT"]),
  ...requirement(E.openDay, "CENTRAL", "THEATRE", [], ["WHEELCHAIR_ACCESS"]),
  ...requirement(E.alumni, "CENTRAL", "OPEN_SPACE", ["TOILETS"], []),
  ...requirement(E.townHall, "CENTRAL", "THEATRE", ["WIFI"], []),
  ...requirement(E.foodFair, "CENTRAL", "OPEN_SPACE", ["TOILETS", "LOADING_AREA"], ["STEP_FREE_ACCESS"], "Wide aisles for prams and wheelchairs."),
  ...requirement(E.nightMarket, "EAST", "BANQUET", ["TOILETS"], ["WHEELCHAIR_ACCESS"]),
  ...requirement(E.networking, "CENTRAL", "BANQUET", ["WIFI"], []),
  ...requirement(E.craft, "CENTRAL", "CLASSROOM", ["TABLES_AND_CHAIRS"], []),
  ...requirement(E.fireworks, "CENTRAL", "OPEN_SPACE", [], []),
  ...requirement(E.marathon, "CENTRAL", "EXHIBITION_BOOTHS", ["LOADING_AREA"], [])
];

const line = (eventId, n, type, quantity, note = null) => ({
  path: `event_equipment/${eventId}_${n}`,
  data: { event_id: eventId, equipment_type: type, quantity, technical_note: note }
});
const eventEquipment = () => [
  line(E.careers, 0, "AUDIO", 2, "Two lapel microphones for the talks."),
  line(E.careers, 1, "VISUAL", 1, "One projector."),
  line(E.showcase, 0, "AUDIO", 4, "Wireless handheld microphones."),
  line(E.showcase, 1, "LIGHTING", 2, "Warm spotlights for the stage."),
  line(E.pitch, 0, "AUDIO", 2, "Two handheld mics."),
  line(E.pitch, 1, "VISUAL", 1, "Projector for slides."),
  line(E.launch, 0, "VISUAL", 2, "Two projectors."),
  line(E.foodFair, 0, "FURNITURE", 40, null)
];

// ---------------------------------------------------------------------------------------------
// Venue bookings — occupied window = start − setup to end + turnaround (E9/F9)
// ---------------------------------------------------------------------------------------------

const booking = (id, eventId, venueId, status, extra = {}) => {
  const ev = eventData(eventId);
  const venue = venueById[venueId];
  const start = at(ev.event_date, ev.start_time);
  const end = at(ev.event_date, ev.end_time);
  return {
    path: `venue_bookings/${id}`,
    data: {
      booking_id: id, event_id: eventId, venue_id: venueId,
      event_name: ev.name, event_reference_no: ev.reference_no,
      event_purpose: ev.purpose, event_description: ev.description,
      registration_required: Boolean(ev.registration_required),
      assigned_staff_id: status === "PENDING" ? null : venue.staff,
      start_datetime: start, end_datetime: end,
      occupied_start: minutesFrom(start, -venue.setup_minutes),
      occupied_end: minutesFrom(end, venue.turnaround_minutes),
      expected_attendance: ev.expected_attendance,
      status, decision_reason: null,
      requested_layout_id: venue.layouts[0], layout_snapshot: venue.layouts[0],
      required_facilities_snapshot: [],
      booking_label: `${ev.name} — ${venue.name}`,
      submitted_at: hoursAgo(24 * 5),
      decided_at: status === "APPROVED" ? hoursAgo(24 * 4) : null,
      decided_by: status === "APPROVED" ? venue.staff : null,
      released_at: null, release_reason: null,
      requires_re_request: false, replacement_needed: false,
      replacement_for_booking_id: null, replacement_original_venue_id: null, replacement_original_label: null,
      replacement_original_status: null, replacement_reason: null, replaced_by_booking_id: null, replaced_at: null,
      safety_review_required: false,
      suitability_acknowledgement: { acknowledged: false, criteria: [] },
      requested_by: ev.coordinator_id,
      ...extra
    }
  };
};

const HOLD_PLACED = new Date(NOW.getTime() - HOUR);
const EXPIRED_HOLD_PLACED = new Date(NOW.getTime() - 6 * 24 * HOUR);

const venueBookings = () => [
  // F16 — a hold whose expiry passed two hours ago (nobody converted it).
  booking("mt-b-book-fair-hall", E.bookFair, V.hall, "HELD", {
    held_by: U.venueStaff1, held_at: Timestamp.fromDate(EXPIRED_HOLD_PLACED), hold_expires_at: hoursAgo(2)
  }),
  // F3/F4/F5/F15 — two pending requests for the same room and overlapping time; the pitch night was first.
  booking("mt-b-pitch-room", E.pitch, V.room, "PENDING", { submitted_at: hoursAgo(26) }),
  booking("mt-b-founders-room", E.founders, V.room, "PENDING", { submitted_at: hoursAgo(5) }),
  // F15 — an active hold, 3 working days from when it was placed.
  booking("mt-b-wellness-hall", E.wellness, V.hall, "HELD", {
    held_by: U.venueStaff1, held_at: Timestamp.fromDate(HOLD_PLACED), hold_expires_at: workingDaysAfter(HOLD_PLACED, 3)
  }),
  // F12/F14 — a multi-venue event: main hall and a breakout room, both approved.
  booking("mt-b-launch-hall", E.launch, V.hall, "APPROVED", { booking_label: "Main programme", expected_attendance: 150 }),
  booking("mt-b-launch-room", E.launch, V.room, "APPROVED", {
    booking_label: "Breakout 1", expected_attendance: 30, requested_layout_id: "CLASSROOM", layout_snapshot: "CLASSROOM"
  }),
  booking("mt-b-leadership-room", E.leadership, V.room, "APPROVED", { requested_layout_id: "CLASSROOM", layout_snapshot: "CLASSROOM" }),
  booking("mt-b-open-day-hall", E.openDay, V.hall, "APPROVED"),
  booking("mt-b-alumni-garden", E.alumni, V.garden, "APPROVED", { expected_attendance: 200 }),
  booking("mt-b-town-hall-hall", E.townHall, V.hall, "APPROVED", { submitted_at: hoursAgo(24 * 18), decided_at: hoursAgo(24 * 17) }),
  booking("mt-b-food-fair-garden", E.foodFair, V.garden, "APPROVED"),
  booking("mt-b-night-market-pavilion", E.nightMarket, V.pavilion, "APPROVED", { requested_layout_id: "BANQUET", layout_snapshot: "BANQUET" }),
  booking("mt-b-networking-hall", E.networking, V.hall, "APPROVED", {
    requested_layout_id: "BANQUET", layout_snapshot: "BANQUET", submitted_at: hoursAgo(24 * 38), decided_at: hoursAgo(24 * 37)
  }),
  // A rejected request on the cancelled event — rejections cannot be overridden.
  booking("mt-b-craft-hall", E.craft, V.hall, "REJECTED", {
    decision_reason: "Hall closed for a private function.", decided_by: U.venueStaff1, decided_at: hoursAgo(24 * 3),
    requires_re_request: true
  })
];

// ---------------------------------------------------------------------------------------------
// Equipment requests and reservations
// ---------------------------------------------------------------------------------------------

const equipmentRequest = (eventId, status, lines, extra = {}) => {
  const ev = eventData(eventId);
  return {
    path: `equipment_requests/${eventId}`,
    data: {
      request_id: eventId, event_id: eventId, coordinator_id: ev.coordinator_id,
      event_name: ev.name, reference_no: ev.reference_no, event_date: ev.event_date,
      start_time: ev.start_time, end_time: ev.end_time, expected_attendance: ev.expected_attendance,
      lines, on_site_support: false, on_site_support_details: "",
      status, has_support_decisions: status !== "PENDING",
      submitted_at: hoursAgo(24 * 3), created_at: hoursAgo(24 * 3), updated_at: hoursAgo(24 * 3),
      ...extra
    }
  };
};
const reserved = (type, quantity, reservationId, note = "") => ({
  equipment_type: type, quantity, technical_requirements: note, fulfillment_status: "RESERVED",
  reservation_id: reservationId, fulfilled_at: hoursAgo(24 * 2), fulfilled_by: U.tech
});

const equipmentRequests = () => [
  equipmentRequest(E.pitch, "PENDING", [
    { equipment_type: "AUDIO", quantity: 2, technical_requirements: "Two handheld mics.", fulfillment_status: "PENDING" },
    { equipment_type: "VISUAL", quantity: 1, technical_requirements: "Projector for slides.", fulfillment_status: "PENDING" }
  ]),
  equipmentRequest(E.launch, "ARRANGED", [reserved("VISUAL", 2, "mt-r-launch-visual", "Two projectors.")]),
  equipmentRequest(E.foodFair, "ARRANGED", [reserved("FURNITURE", 40, "mt-r-food-fair-furniture")])
];

const reservation = (id, eventId, venueId, type, quantity) => {
  const ev = eventData(eventId);
  const venue = venueById[venueId];
  return {
    path: `equipment_reservations/${id}`,
    data: {
      reservation_id: id, event_id: eventId, equipment_type: type, quantity, line_index: 0,
      start_datetime: minutesFrom(at(ev.event_date, ev.start_time), -venue.setup_minutes),
      end_datetime: minutesFrom(at(ev.event_date, ev.end_time), venue.turnaround_minutes),
      status: "RESERVED", reserved_by: U.tech, created_at: hoursAgo(24 * 2), updated_at: hoursAgo(24 * 2),
      released_at: null, released_by: null, release_reason: null
    }
  };
};
const equipmentReservations = () => [
  reservation("mt-r-launch-visual", E.launch, V.hall, "VISUAL", 2),
  reservation("mt-r-food-fair-furniture", E.foodFair, V.garden, "FURNITURE", 40)
];

// ---------------------------------------------------------------------------------------------
// Review workflow records: assignments, clarifications, change requests, safety reviews, history
// ---------------------------------------------------------------------------------------------

const coordinatorAssignments = () => Object.values(EVENTS)
  .filter(({ data }) => data.coordinator_id)
  .map(({ id, data }) => ({
    path: `coordinator_assignments/${id}_${data.coordinator_id}`,
    data: { assignment_id: `${id}_${data.coordinator_id}`, event_id: id, coordinator_id: data.coordinator_id, assigned_at: data.assigned_at, ended_at: null }
  }));

const clarifications = () => [{
  path: "clarification_requests/mt-clarification-coding",
  data: {
    clarification_id: "mt-clarification-coding", event_id: E.coding, created_by: U.coordinator1,
    message: "How many laptops will the students bring, and do you need us to provide any?",
    status: "OPEN", created_at: hoursAgo(24 * 2), responded_at: null
  }
}];

const changeRequests = () => {
  const ev = eventData(E.pitch);
  return [{
    path: "change_requests/mt-cr-pitch",
    data: {
      change_request_id: "mt-cr-pitch", event_id: E.pitch, event_name: ev.name, reference_no: ev.reference_no,
      organiser_id: U.organiser1, coordinator_id: U.coordinator1, event_status: "PLANNING",
      changes: { expected_attendance: { old_value: 35, new_value: 38 } },
      reason: "Three more founders confirmed.", status: "PENDING", created_at: hoursAgo(24)
    }
  }];
};

const review = (id, eventId, outcome, comment, h, extra = {}) => ({
  path: `safety_reviews/${id}`,
  data: { review_id: id, event_id: eventId, reviewer_id: U.safety, outcome, comment, decided_at: hoursAgo(h), ...extra }
});
const safetyReviews = () => [
  review("mt-sr-leadership", E.leadership, "APPROVE", null, 24 * 3),
  review("mt-sr-open-day", E.openDay, "APPROVE", null, 24 * 3),
  review("mt-sr-alumni", E.alumni, "APPROVE", null, 24 * 5),
  review("mt-sr-town-hall", E.townHall, "APPROVE", null, 24 * 9),
  // The night market was sent back once; the Safety Officer should see this at the next check.
  review("mt-sr-night-market-1", E.nightMarket, "REQUEST_CHANGES", "Add marshals at both exits and a queue lane.", 24 * 2, { marked: ["venue"] })
];

// One history trail per event, newest last. Decisions (approve/reject) are read from these.
let historyCount = 0;
const h = (eventId, actor, action, hAgo, { field = null, from = null, to = null, text = null, id } = {}) => {
  historyCount += 1;
  const historyId = id || `mt-h-${String(historyCount).padStart(3, "0")}`;
  return {
    path: `event_history/${historyId}`,
    data: {
      history_id: historyId, event_id: eventId, actor_id: actor, action_type: action,
      field_name: field, old_value: from, new_value: to, description: text, created_at: hoursAgo(hAgo)
    }
  };
};
const submitted = (eventId, organiser, hAgo) => h(eventId, organiser, "EVENT_SUBMITTED", hAgo, { field: "status", from: "DRAFT", to: "SUBMITTED", text: "Event submitted." });
const assignedTo = (eventId, coordinator, hAgo) => h(eventId, U.lead, "COORDINATOR_ASSIGNED", hAgo, {
  field: "coordinator_id", from: null, to: coordinator, text: `${Object.values(USERS).find((u) => u.uid === coordinator).name} assigned.`
});
const reviewed = (eventId, coordinator, hAgo) => h(eventId, coordinator, "REVIEW_STARTED", hAgo, { field: "status", from: "SUBMITTED", to: "UNDER_REVIEW", text: "Review started." });
const approvedBy = (eventId, coordinator, hAgo) => h(eventId, coordinator, "EVENT_APPROVED", hAgo, { field: "status", from: "UNDER_REVIEW", to: "APPROVED", text: "All details are complete." });
const bookingApproved = (eventId, staff, bookingId, hAgo) => h(eventId, staff, "VENUE_BOOKING_APPROVED", hAgo, {
  field: "venue_booking_status", from: "PENDING", to: "APPROVED", text: `Venue booking ${bookingId} approved.`
});
const sentForSafety = (eventId, coordinator, from, hAgo) => h(eventId, coordinator, "SAFETY_CHECK_REQUESTED", hAgo, { field: "status", from, to: "SAFETY_REVIEW", text: "Sent for safety check." });
const safetyApproved = (eventId, hAgo) => h(eventId, U.safety, "SAFETY_CHECK_APPROVED", hAgo, { field: "status", from: "SAFETY_REVIEW", to: "CONFIRMED", text: "Safety check passed." });

const eventHistory = () => {
  const c1 = U.coordinator1;
  const c2 = U.coordinator2;
  const trail = (id, organiser, coordinator) => [
    submitted(id, organiser, 24 * 10), assignedTo(id, coordinator, 24 * 9), reviewed(id, coordinator, 24 * 8), approvedBy(id, coordinator, 24 * 7)
  ];
  return [
    submitted(E.funRun, U.organiser2, 48),
    submitted(E.choir, U.organiser1, 3),
    submitted(E.careers, U.organiser1, 30), assignedTo(E.careers, c1, 20),
    submitted(E.coding, U.organiser1, 24 * 10), assignedTo(E.coding, c1, 24 * 9), reviewed(E.coding, c1, 24 * 8),
    h(E.coding, c1, "CLARIFICATION_REQUESTED", 48, { text: "How many laptops will the students bring, and do you need us to provide any?" }),
    submitted(E.gala, U.organiser1, 24 * 10), assignedTo(E.gala, c1, 24 * 9), reviewed(E.gala, c1, 24 * 8),
    ...trail(E.showcase, U.organiser1, c1),
    ...trail(E.bookFair, U.organiser1, c1),
    h(E.bookFair, U.venueStaff1, "VENUE_BOOKING_HELD", 24 * 6, { field: "venue_booking_status", from: "PENDING", to: "HELD", text: "Marina Grand Hall held." }),
    ...trail(E.pitch, U.organiser1, c1),
    ...trail(E.founders, U.organiser2, c1),
    ...trail(E.wellness, U.organiser1, c1),
    h(E.wellness, U.venueStaff1, "VENUE_BOOKING_HELD", 1, { field: "venue_booking_status", from: "PENDING", to: "HELD", text: "Marina Grand Hall held." }),
    ...trail(E.launch, U.organiser1, c1),
    bookingApproved(E.launch, U.venueStaff1, "Main programme", 24 * 4), bookingApproved(E.launch, U.venueStaff1, "Breakout 1", 24 * 4),
    ...trail(E.leadership, U.organiser1, c1),
    bookingApproved(E.leadership, U.venueStaff1, "mt-b-leadership-room", 24 * 4), sentForSafety(E.leadership, c1, "APPROVED", 24 * 4), safetyApproved(E.leadership, 24 * 3),
    ...trail(E.openDay, U.organiser1, c1),
    bookingApproved(E.openDay, U.venueStaff1, "mt-b-open-day-hall", 24 * 4), sentForSafety(E.openDay, c1, "APPROVED", 24 * 4), safetyApproved(E.openDay, 24 * 3),
    ...trail(E.alumni, U.organiser1, c1),
    bookingApproved(E.alumni, U.venueStaff2, "mt-b-alumni-garden", 24 * 6), sentForSafety(E.alumni, c1, "APPROVED", 24 * 6), safetyApproved(E.alumni, 24 * 5),
    ...trail(E.townHall, U.organiser1, c1),
    bookingApproved(E.townHall, U.venueStaff1, "mt-b-town-hall-hall", 24 * 6), sentForSafety(E.townHall, c1, "APPROVED", 24 * 6), safetyApproved(E.townHall, 24 * 5),
    ...trail(E.foodFair, U.organiser2, c1),
    bookingApproved(E.foodFair, U.venueStaff2, "mt-b-food-fair-garden", 24 * 4), sentForSafety(E.foodFair, c1, "APPROVED", 20),
    ...trail(E.nightMarket, U.organiser2, c2),
    bookingApproved(E.nightMarket, U.venueStaff2, "mt-b-night-market-pavilion", 24 * 5), sentForSafety(E.nightMarket, c2, "APPROVED", 24 * 3),
    h(E.nightMarket, U.safety, "SAFETY_CHANGES_REQUESTED", 48, { field: "status", from: "SAFETY_REVIEW", to: "PLANNING", text: "Add marshals at both exits and a queue lane." }),
    sentForSafety(E.nightMarket, c2, "PLANNING", 6),
    ...trail(E.networking, U.organiser1, c2),
    h(E.networking, c2, "EVENT_COMPLETED", 24 * 19, { field: "status", from: "CONFIRMED", to: "COMPLETED", text: "Event completed." }),
    ...trail(E.craft, U.organiser1, c1),
    h(E.craft, U.organiser1, "EVENT_CANCELLED", 48, { id: "mt-h-craft-cancelled", field: "status", from: "APPROVED", to: "CANCELLED", text: "Organiser could not secure enough vendors." }),
    submitted(E.fireworks, U.organiser1, 24 * 10), assignedTo(E.fireworks, c1, 24 * 9), reviewed(E.fireworks, c1, 24 * 8),
    h(E.fireworks, c1, "EVENT_REJECTED", 24 * 6, { field: "status", from: "UNDER_REVIEW", to: "REJECTED", text: "Fireworks are not permitted at any of our venues." }),
    ...trail(E.marathon, U.organiser2, c2)
  ];
};

// ---------------------------------------------------------------------------------------------
// Registrations
//   Leadership Talk  capacity 2 — full: attendee 1 and 2 registered, attendee 3 waitlisted
//   Product Launch   capacity 100 — attendees 1, 2 and 4 registered
//   Open Day Tours   capacity 50 — attendee 4 registered
//   Alumni           window closed yesterday — attendee 1 registered
//   Craft Market     cancelled — attendee 1 was registered
// ---------------------------------------------------------------------------------------------

const reg = (eventId, attendee, status, hAgo) => ({
  path: `registrations/${eventId}_${attendee}`,
  data: {
    registration_id: `${eventId}_${attendee}`, event_id: eventId, attendee_id: attendee, status,
    registered_at: status === "REGISTERED" ? hoursAgo(hAgo) : null,
    waitlisted_at: status === "WAITLISTED" ? hoursAgo(hAgo) : null,
    withdrawn_at: null, waitlist_position: null
  }
});
const registrations = () => [
  reg(E.leadership, U.attendee1, "REGISTERED", 60),
  reg(E.leadership, U.attendee2, "REGISTERED", 50),
  reg(E.leadership, U.attendee3, "WAITLISTED", 40),
  reg(E.launch, U.attendee1, "REGISTERED", 30),
  reg(E.launch, U.attendee2, "REGISTERED", 29),
  reg(E.launch, U.attendee4, "REGISTERED", 28),
  reg(E.openDay, U.attendee4, "REGISTERED", 20),
  reg(E.alumni, U.attendee1, "REGISTERED", 24 * 5),
  reg(E.craft, U.attendee1, "REGISTERED", 24 * 3)
];

// ---------------------------------------------------------------------------------------------
// Notifications — unread and read ones, so the inbox badge can be checked (J1)
// ---------------------------------------------------------------------------------------------

let notificationCount = 0;
const note = (user, eventId, type, message, hAgo, read = false) => {
  notificationCount += 1;
  const id = `mt-n-${String(notificationCount).padStart(3, "0")}`;
  return {
    path: `notifications/${id}`,
    data: {
      notification_id: id, user_id: user, event_id: eventId, type, message,
      event_name: eventData(eventId).name,
      is_read: read, created_at: hoursAgo(hAgo), read_at: read ? hoursAgo(hAgo - 1) : null
    }
  };
};
const notifications = () => [
  note(U.lead, E.funRun, "UNASSIGNED_EVENT", "Charity Fun Run Briefing is waiting to be assigned a coordinator.", 48),
  note(U.lead, E.choir, "UNASSIGNED_EVENT", "Community Choir Concert is waiting to be assigned a coordinator.", 3),
  note(U.coordinator1, E.careers, "COORDINATOR_ASSIGNED", "You have been assigned Tech Careers Fair.", 20),
  note(U.coordinator1, E.coding, "COORDINATOR_ASSIGNED", "You have been assigned Youth Coding Workshop.", 24 * 9, true),
  note(U.organiser1, E.choir, "EVENT_SUBMITTED", "Community Choir Concert was submitted and is waiting for a coordinator.", 3),
  note(U.organiser1, E.coding, "CLARIFICATION_REQUESTED", "Youth Coding Workshop: clarification requested — How many laptops will the students bring, and do you need us to provide any?", 48),
  note(U.organiser1, E.showcase, "EVENT_APPROVED", "Harbour Arts Showcase was approved.", 24 * 7, true),
  note(U.venueStaff1, E.pitch, "VENUE_BOOKING_REQUESTED", "Bayview Meeting Room requested for Startup Pitch Night.", 26),
  note(U.venueStaff1, E.founders, "VENUE_BOOKING_REQUESTED", "Bayview Meeting Room requested for Founders Breakfast Roundtable.", 5),
  note(U.safety, E.foodFair, "SAFETY_REVIEW_WAITING", "Community Food Fair is waiting for its safety check.", 20),
  note(U.safety, E.nightMarket, "SAFETY_REVIEW_WAITING", "Night Market Fest is waiting for its safety check. It has been checked before.", 6),
  note(U.attendee3, E.leadership, "REGISTRATION_WAITLISTED", "You are on the waiting list for Leadership Talk.", 40, true)
];

// ---------------------------------------------------------------------------------------------

export function baseline() {
  return [
    ...users(), ...venues(), ...venueUnavailability(), ...equipmentInventory(),
    ...events(), ...eventRequirements(), ...eventEquipment(), ...venueBookings(),
    ...equipmentRequests(), ...equipmentReservations(), ...coordinatorAssignments(),
    ...clarifications(), ...changeRequests(), ...safetyReviews(), ...eventHistory(),
    ...registrations(), ...notifications()
  ];
}

async function main() {
  // Fail fast, with a useful message, when the emulators are not running.
  for (const [name, host] of [["Firestore", FIRESTORE], ["Auth", AUTH]]) {
    try {
      await fetch(`http://${host}/`);
    } catch {
      console.error(`The ${name} emulator is not answering on ${host}. Start it with \`npm run manual:start\` first.`);
      process.exit(1);
    }
  }

  // 1. Wipe everything.
  await fetch(`http://${FIRESTORE}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });

  initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth();
  const db = getFirestore();

  // 2. Sign-in accounts, one per seeded user.
  for (const u of Object.values(USERS)) {
    await auth.createUser({ uid: u.uid, email: u.email, password: PASSWORD, displayName: u.name });
  }

  // 3. Documents, in batches of at most 500 writes.
  const docs = baseline();
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    for (const { path, data } of docs.slice(i, i + 500)) batch.set(db.doc(path), data);
    await batch.commit();
  }

  const counts = docs.reduce((acc, { path }) => {
    const name = path.split("/")[0];
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {});
  console.log(`\nManual-test baseline loaded (${TODAY}, Singapore time). ${Object.keys(USERS).length} accounts, password ${PASSWORD}`);
  console.table(counts);
  console.log("Event dates this run:");
  console.table(Object.fromEntries(Object.entries(EVENTS).map(([, e]) => [e.data.name, `${e.data.event_date} ${e.data.start_time || ""}-${e.data.end_time || ""} ${e.data.status}`])));
}

// Run only when executed directly, so the data can also be imported by a check script.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  await main();
  process.exit(0);
}
