// Seeds demo events for H2 / SCRUM-140 ("Find events I can register for"), so an
// Attendee's Browse events screen has something to show. None of the mock events
// can appear there: they have registration on but no capacity or window, which is
// what H1 lets an organiser set later.
//
// One Firebase project backs the whole team, so this prints what it would write
// and stops. Nothing is written without --write; --remove deletes exactly the
// documents this script creates, and nothing else.
//
//   node backend/scripts/seedOpenRegistrationEvents.mjs            # dry run
//   node backend/scripts/seedOpenRegistrationEvents.mjs --write    # write them
//   node backend/scripts/seedOpenRegistrationEvents.mjs --remove   # delete them again
//
// Every id starts with `h2demo-`. Writes (only with --write):
//   events/h2demo-{n}                       9 events — 4 open now, 5 that must not be listed
//   event_venue_requirements/h2demo-{n}     one per event, so the other roles' screens load
//   venue_bookings/h2demo-{n}-{venue}       approved bookings for 3 of the open events
//   registrations/h2demo-{n}-{attendee}     mock attendees, to show places left and Full
//
// Dates are worked out from today (Singapore time), so the open events stay open
// for about two weeks after seeding. It refuses to write if a demo booking would
// overlap an active booking someone else already holds at that venue.

import { admin, db } from "../src/lib/firebaseAdmin.js";
import { isOpenForRegistration } from "../../frontend/src/domain/openRegistration.mjs";

const flags = process.argv.slice(2);
const commit = flags.includes("--write");
const remove = flags.includes("--remove");
const firestore = db();
const fail = (message) => { console.error(`\n✗ ${message}\n`); process.exit(1); };

const PREFIX = "h2demo-";
const ORGANISER = "user-008-MOCKDATA"; // Benjamin Ong
const COORDINATOR = "user-009-MOCKDATA"; // Chloe Goh
const ATTENDEES = ["user-005-MOCKDATA", "user-012-MOCKDATA", "user-019-MOCKDATA", "user-026-MOCKDATA",
  "user-033-MOCKDATA", "user-040-MOCKDATA", "user-047-MOCKDATA", "user-054-MOCKDATA"];

// ---- removal ---------------------------------------------------------------

if (remove) {
  const collections = ["events", "event_venue_requirements", "venue_bookings", "registrations"];
  const refs = [];
  for (const name of collections) {
    const snapshot = await firestore.collection(name)
      .where(admin.firestore.FieldPath.documentId(), ">=", PREFIX)
      .where(admin.firestore.FieldPath.documentId(), "<", `${PREFIX}`)
      .get();
    snapshot.docs.forEach((item) => refs.push(item.ref));
  }
  refs.forEach((ref) => console.log(`  delete ${ref.path}`));
  if (!refs.length) console.log("Nothing to remove.");
  else {
    const batch = firestore.batch();
    refs.forEach((ref) => batch.delete(ref));
    await batch.commit();
    console.log(`\n✓ Removed ${refs.length} documents.\n`);
  }
  process.exit(0);
}

// ---- dates -----------------------------------------------------------------

const singaporeToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const at = (date, time) => new Date(`${date}T${time}:00+08:00`);
const today = singaporeToday();

// ---- what to write ---------------------------------------------------------

// `shown` is what the Browse events screen should do with it; the script checks
// each one against the real rule before writing, so a wrong expectation stops it.
const OPEN = { opens: [addDays(today, -1), "09:00"], closes: [addDays(today, 14), "17:00"] };
const EVENTS = [
  { n: 1, name: "Harbour Tech Forum", status: "CONFIRMED", day: 30, start: "09:00", end: "17:00", capacity: 120,
    venues: [["venue-004-MOCKDATA", "Main hall"], ["venue-006-MOCKDATA", "Breakout room"]],
    registrations: { REGISTERED: 5, WITHDRAWN: 1, WAITLISTED: 0 }, shown: "listed — 2 venues, 115 places left",
    description: "Talks and demos on port and logistics technology, with breakout sessions in the afternoon." },
  { n: 2, name: "Community Coding Workshop", status: "PLANNING", day: 24, start: "13:00", end: "17:00", capacity: 8,
    venues: [["venue-005-MOCKDATA", "Workshop room"]],
    registrations: { REGISTERED: 8, WITHDRAWN: 0, WAITLISTED: 0 }, shown: "listed — Full",
    description: "A hands-on afternoon building a first web page. Laptops provided." },
  { n: 3, name: "Neighbourhood Green Fair", status: "APPROVED", day: 40, start: "10:00", end: "16:00", capacity: 60,
    venues: [], registrations: { REGISTERED: 2, WITHDRAWN: 1, WAITLISTED: 1 }, shown: "listed — venue to be confirmed, 58 places left",
    description: "Stalls, repair clinics and talks on living sustainably." },
  { n: 4, name: "Careers in Public Health Briefing", status: "SAFETY_REVIEW", day: 27, start: "18:30", end: "21:00", capacity: 150,
    venues: [["venue-004-MOCKDATA", "Auditorium"]], registrations: { REGISTERED: 0, WITHDRAWN: 0, WAITLISTED: 0 },
    shown: "listed — 150 places left", description: "" },
  { n: 5, name: "Draft Wellness Day", status: "DRAFT", day: 30, start: "09:00", end: "12:00", capacity: 50,
    venues: [], registrations: {}, shown: "hidden — Draft", description: "Should never be listed." },
  { n: 6, name: "Cancelled Film Night", status: "CANCELLED", day: 30, start: "19:00", end: "22:00", capacity: 50,
    venues: [], registrations: {}, shown: "hidden — Cancelled", description: "Should never be listed." },
  { n: 7, name: "Rejected Hackathon", status: "REJECTED", day: 30, start: "09:00", end: "18:00", capacity: 50,
    venues: [], registrations: {}, shown: "hidden — Rejected", description: "Should never be listed." },
  { n: 8, name: "Closed Registration Seminar", status: "CONFIRMED", day: 30, start: "09:00", end: "12:00", capacity: 50,
    venues: [], registrations: {}, shown: "hidden — window closed yesterday", description: "Should never be listed.",
    window: { opens: [addDays(today, -10), "09:00"], closes: [addDays(today, -1), "17:00"] } },
  { n: 9, name: "Not Yet Open Gala", status: "CONFIRMED", day: 30, start: "18:00", end: "22:00", capacity: 50,
    venues: [], registrations: {}, shown: "hidden — window opens next week", description: "Should never be listed.",
    window: { opens: [addDays(today, 7), "09:00"], closes: [addDays(today, 20), "17:00"] } }
];

const venueDocs = {};
for (const venueId of new Set(EVENTS.flatMap((event) => event.venues.map(([id]) => id)))) {
  const snapshot = await firestore.collection("venues").doc(venueId).get();
  if (!snapshot.exists) fail(`Venue ${venueId} does not exist.`);
  venueDocs[venueId] = snapshot.data();
}

const writes = [];
const now = new Date();
let attendeeCursor = 0;

for (const spec of EVENTS) {
  const id = `${PREFIX}${spec.n}`;
  const eventDate = addDays(today, spec.day);
  const window = spec.window || OPEN;
  const event = {
    event_id: id,
    reference_no: `EVT-H2DEMO-${String(spec.n).padStart(3, "0")}`,
    organiser_id: ORGANISER,
    coordinator_id: spec.status === "DRAFT" ? null : COORDINATOR,
    name: spec.name,
    purpose: "COMMUNITY_ENGAGEMENT",
    description: spec.description,
    event_date: eventDate,
    start_time: spec.start,
    end_time: spec.end,
    expected_attendance: Math.max(spec.capacity, 10),
    status: spec.status,
    registration_required: true,
    registration_capacity: spec.capacity,
    registration_open_date: window.opens[0],
    registration_open_time: window.opens[1],
    registration_close_date: window.closes[0],
    registration_close_time: window.closes[1],
    equipment_required: false,
    open_clarification_id: null,
    created_by: ORGANISER,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    ...(spec.status === "DRAFT" ? {} : { submitted_at: admin.firestore.FieldValue.serverTimestamp() })
  };

  const listed = isOpenForRegistration({ ...event, id }, now);
  if (listed !== spec.shown.startsWith("listed")) fail(`${spec.name}: expected "${spec.shown}" but the rule says ${listed ? "listed" : "hidden"}.`);

  writes.push({ path: `events/${id}`, data: event, note: `${spec.status.padEnd(13)} ${eventDate} ${spec.start}–${spec.end}  ${spec.name}  →  ${spec.shown}` });
  writes.push({ path: `event_venue_requirements/${id}`, data: { event_id: id, preferred_location: "CENTRAL", required_layout: "THEATRE", facilities_required: false, accessibility_needed: false, accessibility_notes: "" } });

  for (const [venueId, label] of spec.venues) {
    const venue = venueDocs[venueId];
    const start = at(eventDate, spec.start);
    const end = at(eventDate, spec.end);
    const occupiedStart = new Date(start.getTime() - (Number(venue.setup_minutes) || 0) * 60000);
    const occupiedEnd = new Date(end.getTime() + (Number(venue.turnaround_minutes) || 0) * 60000);

    const existing = await firestore.collection("venue_bookings").where("venue_id", "==", venueId).get();
    const clash = existing.docs.find((item) => {
      if (item.id.startsWith(PREFIX)) return false;
      const data = item.data();
      if (!["APPROVED", "PENDING", "HELD"].includes(data.status)) return false;
      const otherStart = (data.occupied_start || data.start_datetime)?.toDate?.();
      const otherEnd = (data.occupied_end || data.end_datetime)?.toDate?.();
      return otherStart && otherEnd && otherStart < occupiedEnd && occupiedStart < otherEnd;
    });
    if (clash) fail(`${venue.name} already has ${clash.data().status} booking ${clash.id} overlapping ${eventDate}. Nothing written.`);

    const ts = admin.firestore.Timestamp.fromDate;
    writes.push({
      path: `venue_bookings/${id}-${venueId}`,
      note: `APPROVED      ${venue.name} (${label})`,
      data: {
        booking_id: `${id}-${venueId}`, event_id: id, venue_id: venueId, event_name: spec.name,
        event_reference_no: event.reference_no, event_purpose: event.purpose, event_description: spec.description,
        registration_required: true, booking_label: label,
        start_datetime: ts(start), end_datetime: ts(end), occupied_start: ts(occupiedStart), occupied_end: ts(occupiedEnd),
        expected_attendance: Math.min(event.expected_attendance, venue.max_capacity),
        requested_layout_id: "THEATRE", layout_snapshot: "THEATRE", required_facilities_snapshot: [],
        decision_reason: null, released_at: null, release_reason: null, requires_re_request: false,
        replacement_needed: false, replaced_by_booking_id: null, replaced_at: null, safety_review_required: false,
        suitability_acknowledgement: { acknowledged: false, criteria: [], missing: {}, acknowledged_by: null, acknowledged_at: null },
        requested_by: COORDINATOR, assigned_staff_id: null,
        submitted_at: admin.firestore.FieldValue.serverTimestamp(),
        decided_at: admin.firestore.FieldValue.serverTimestamp(), decided_by: null,
        status: "APPROVED"
      }
    });
  }

  for (const [status, count] of Object.entries(spec.registrations)) {
    for (let index = 0; index < count; index += 1) {
      const attendee = ATTENDEES[attendeeCursor % ATTENDEES.length];
      attendeeCursor += 1;
      const registrationId = `${id}-${attendee}`;
      writes.push({
        path: `registrations/${registrationId}`,
        data: {
          registration_id: registrationId, event_id: id, attendee_id: attendee, status,
          registered_at: admin.firestore.FieldValue.serverTimestamp(),
          withdrawn_at: status === "WITHDRAWN" ? admin.firestore.FieldValue.serverTimestamp() : null,
          waitlist_position: status === "WAITLISTED" ? 1 : null
        }
      });
    }
  }
  attendeeCursor = 0;
}

// One attendee per event at most, as H3 AC8 requires.
const paths = writes.map((item) => item.path);
if (new Set(paths).size !== paths.length) fail("Two writes share an id — an attendee would be registered twice.");

for (const item of writes) {
  const existing = await firestore.doc(item.path).get();
  if (existing.exists) fail(`${item.path} already exists. Run with --remove first, then --write.`);
}

// ---- report and write ------------------------------------------------------

console.log(`\nToday (Singapore): ${today}. Open window for the listed events: ${OPEN.opens.join(" ")} → ${OPEN.closes.join(" ")}\n`);
for (const item of writes.filter((entry) => entry.note)) console.log(`  ${item.path.padEnd(48)} ${item.note}`);
const count = (prefix) => writes.filter((item) => item.path.startsWith(prefix)).length;
console.log(`\n  ${writes.length} documents: ${count("events/")} events, ${count("event_venue_requirements/")} venue requirements, ${count("venue_bookings/")} approved bookings, ${count("registrations/")} registrations.`);

if (!commit) {
  console.log("\nDry run — nothing written. Re-run with --write to create these.\n");
  process.exit(0);
}

const batch = firestore.batch();
writes.forEach((item) => batch.create(firestore.doc(item.path), item.data));
await batch.commit();
console.log(`\n✓ Wrote ${writes.length} documents. Remove them with --remove.\n`);
process.exit(0);
