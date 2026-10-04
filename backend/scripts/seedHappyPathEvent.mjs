// Seeds one event that every requirement of a real venue satisfies, so the E8
// happy path (a booking that sails through the suitability gate) can be walked
// through in the app. Mock event 3 has no venue that fits, which is useful for
// the blocked and warning paths but leaves the clean path untestable.
//
// One Firebase project backs the whole team, so this prints what it would write
// and stops. Nothing is written without --write.
//
//   node backend/scripts/seedHappyPathEvent.mjs "Mock User 1"
//   node backend/scripts/seedHappyPathEvent.mjs "Mock User 1" --write
//
// Writes (only with --write), all keyed to one new event id:
//   events/{id}                        the event itself, status APPROVED
//   event_venue_requirements/{id}      preferred location + required layout
//   event_facilities/{id}_{n}          one row per required facility
//   event_accessibility/{id}_{n}       one row per accessibility need
//
// It never edits an existing document.

import { admin, db } from "../src/lib/firebaseAdmin.js";

const [, , who = "Mock User 1", ...flags] = process.argv;
const commit = flags.includes("--write");
const firestore = db();

const fail = (message) => { console.error(`\n✗ ${message}\n`); process.exit(1); };

// Match on uid first, then on the name or email the seeded accounts carry.
const findUser = async (needle) => {
  const direct = await firestore.collection("users").doc(needle).get();
  if (direct.exists) return { id: direct.id, ...direct.data() };

  const all = await firestore.collection("users").get();
  const wanted = needle.trim().toLowerCase();
  const hit = all.docs.find((item) => {
    const data = item.data();
    return [data.name, data.email].filter(Boolean).some((value) => String(value).toLowerCase() === wanted);
  }) || all.docs.find((item) => String(item.data().name || "").toLowerCase().includes(wanted));
  return hit ? { id: hit.id, ...hit.data() } : null;
};

const user = await findUser(who);
if (!user) fail(`No user matched "${who}". Pass a uid, the exact name, or the email.`);

// A venue's attributes may sit on the document or in the side collections the
// catalogue joins in (frontend/src/features/venues/venuesApi.js does the same).
const grouped = async (collection, field) => {
  const snapshot = await firestore.collection(collection).get();
  const map = {};
  snapshot.docs.forEach((item) => {
    const data = item.data();
    if (!data.venue_id || !data[field]) return;
    (map[data.venue_id] ||= []).push(data[field]);
  });
  return map;
};

const [layoutRows, facilityRows, accessRows] = await Promise.all([
  grouped("venue_layouts", "layout_id"),
  grouped("venue_facilities", "facility_id"),
  grouped("venue_accessibility", "accessibility_id")
]);

const venues = (await firestore.collection("venues").get()).docs.map((item) => {
  const data = item.data();
  const id = data.venue_id || item.id;
  return {
    ...data,
    venue_id: id,
    layouts: data.layouts?.length ? data.layouts : (layoutRows[id] || []),
    facilities: data.facilities?.length ? data.facilities : (facilityRows[id] || []),
    accessibility: data.accessibility?.length ? data.accessibility : (accessRows[id] || [])
  };
});
if (!venues.length) fail("No venues in the catalogue to build a fitting event from.");

// Build the event backwards from a real venue, so every criterion is met. Prefer
// the richest venue over the biggest: a venue with no facilities, layouts or
// accessibility yields an event that only ever exercises the capacity check.
const richness = (item) =>
  (item.layouts.length ? 1 : 0) + Math.min(item.facilities.length, 2) + Math.min(item.accessibility.length, 1);
const venue = venues.slice().sort((a, b) =>
  richness(b) - richness(a) || (Number(b.max_capacity) || 0) - (Number(a.max_capacity) || 0))[0];
const capacity = Number(venue.max_capacity) || 0;
if (capacity < 2) fail(`The largest venue (${venue.name}) holds ${capacity}; nothing sensible fits.`);

const facilities = (venue.facilities || []).slice(0, 2);
const accessibility = (venue.accessibility || []).slice(0, 1);
const layout = (venue.layouts || [])[0] || null;

const date = new Date();
date.setDate(date.getDate() + 30);
const eventDate = date.toISOString().slice(0, 10);

// An organiser owns the request; a coordinator works it. Whichever role the
// named user holds is the field they are attached to.
const isCoordinator = user.role === "EVENT_COORDINATOR";
const counterpart = (await firestore.collection("users")
  .where("role", "==", isCoordinator ? "EVENT_ORGANISER" : "EVENT_COORDINATOR").limit(1).get()).docs[0];
if (!counterpart) fail(`Found ${user.name} (${user.role}) but no ${isCoordinator ? "organiser" : "coordinator"} to pair with.`);

const organiserId = isCoordinator ? counterpart.id : user.id;
const coordinatorId = isCoordinator ? user.id : counterpart.id;

// B9 AC5 — every submitted request carries a unique reference number. Same shape
// as domain/eventRequest.js createReferenceNo(), which the browser cannot lend us.
const referenceNo = () => {
  const moment = Date.now().toString(36).toUpperCase().slice(-6);
  const random = Math.random().toString(36).slice(2, 7).padEnd(5, "0").toUpperCase();
  return `EVT-${moment}-${random}`;
};

const event = {
  name: `Happy path check · ${venue.name}`,
  reference_no: referenceNo(),
  purpose: "Verifying the venue suitability gate end to end.",
  description: `Seeded to fit ${venue.name} exactly, so the booking request passes every criterion.`,
  event_date: eventDate,
  start_time: "09:00",
  end_time: "17:00",
  expected_attendance: Math.max(1, Math.floor(capacity / 2)),
  status: "APPROVED",
  organiser_id: organiserId,
  coordinator_id: coordinatorId,
  equipment_required: false,
  registration_required: false
};

const requirement = {
  preferred_location: venue.location || "",
  required_layout: layout,
  facilities_required: facilities.length > 0,
  accessibility_needed: accessibility.length > 0,
  accessibility_notes: ""
};

console.log(`\nUser      ${user.name || user.id} · ${user.role} · ${user.id}`);
console.log(`Venue     ${venue.name} · holds ${capacity} · ${venue.venue_id}`);
console.log(`Pairing   organiser_id=${organiserId}  coordinator_id=${coordinatorId}`);
console.log("\nevents/{new}");
console.table(event);
console.log("event_venue_requirements/{new}");
console.table(requirement);
console.log(`event_facilities    ${facilities.join(", ") || "(none)"}`);
console.log(`event_accessibility ${accessibility.join(", ") || "(none)"}`);

if (!commit) {
  console.log("\nDry run — nothing written. Re-run with --write to create it.\n");
  process.exit(0);
}

const now = admin.firestore.FieldValue.serverTimestamp();
const ref = firestore.collection("events").doc();
const batch = firestore.batch();

batch.set(ref, { ...event, created_at: now, updated_at: now, submitted_at: now });
batch.set(firestore.collection("event_venue_requirements").doc(ref.id), { event_id: ref.id, ...requirement });
facilities.forEach((facility, index) =>
  batch.set(firestore.collection("event_facilities").doc(`${ref.id}_${index}`), { event_id: ref.id, facility_id: facility }));
accessibility.forEach((item, index) =>
  batch.set(firestore.collection("event_accessibility").doc(`${ref.id}_${index}`), { event_id: ref.id, accessibility_id: item }));

await batch.commit();
console.log(`\n✓ Created events/${ref.id} — "${event.name}"`);
console.log(`  Sign in as ${user.name || user.id} and it will be in the coordinator's event list.\n`);
