// Gives the mock venue catalogue a realistic spread of opening days.
//
// Every venue was seeded MONDAY-only — 50 venues, 50 rows, all Monday — so the
// catalogue is shut six days a week and a suitability search on any other day
// rules out the entire catalogue. This assigns each venue one of eight opening
// patterns, so there is variety across the catalogue and several days per venue.
//
// One Firebase project backs the whole team, so this prints what it would write
// and stops. Nothing is written without --write.
//
//   node backend/scripts/seedOperatingHours.mjs
//   node backend/scripts/seedOperatingHours.mjs --write
//
// Writes (only with --write), per venue:
//   venues/{id}.operating_hours          the array the catalogue reads first
//   venue_operating_hours/{id}-hrs-{n}   the rows it falls back to, kept in step
//
// It replaces that venue's existing hours rows and that one field. No other
// field on a venue, and no other collection, is touched.

import { db } from "../src/lib/firebaseAdmin.js";

const commit = process.argv.includes("--write");
const firestore = db();

// Eight patterns: a mix of weekday-only, six-day, alternating-day and weekend
// venues, so a search on any given weekday finds some open and some shut.
const PATTERNS = [
  { name: "Weekdays, office hours", days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"], opens_at: "08:00", closes_at: "18:00" },
  { name: "Six days, long hours", days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"], opens_at: "09:00", closes_at: "22:00" },
  { name: "Alternating days", days: ["TUESDAY", "THURSDAY", "SATURDAY"], opens_at: "10:00", closes_at: "20:00" },
  { name: "Midweek to Sunday", days: ["WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"], opens_at: "12:00", closes_at: "23:00" },
  { name: "Every day", days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"], opens_at: "07:00", closes_at: "23:00" },
  { name: "Mon / Wed / Fri", days: ["MONDAY", "WEDNESDAY", "FRIDAY"], opens_at: "08:00", closes_at: "17:00" },
  { name: "Weekend only", days: ["SATURDAY", "SUNDAY"], opens_at: "09:00", closes_at: "18:00" },
  { name: "Late week, evenings", days: ["THURSDAY", "FRIDAY", "SATURDAY"], opens_at: "14:00", closes_at: "23:30" }
];

// Deterministic, so a re-run produces the same catalogue rather than reshuffling
// it: the trailing number in venue-12-MOCKDATA picks the pattern.
const patternFor = (venueId, index) => {
  const digits = String(venueId).match(/(\d+)/);
  const seed = digits ? Number(digits[1]) : index;
  return PATTERNS[seed % PATTERNS.length];
};

const venues = (await firestore.collection("venues").get()).docs;
if (!venues.length) {
  console.error("\n✗ No venues in the catalogue.\n");
  process.exit(1);
}

const plan = venues.map((doc, index) => {
  const data = doc.data();
  const venueId = data.venue_id || doc.id;
  const pattern = patternFor(venueId, index);
  return {
    ref: doc.ref,
    venueId,
    name: data.name,
    pattern,
    hours: pattern.days.map((weekday) => ({ weekday, opens_at: pattern.opens_at, closes_at: pattern.closes_at }))
  };
});

const spread = {};
plan.forEach(({ pattern }) => { spread[pattern.name] = (spread[pattern.name] || 0) + 1; });

const openOn = (weekday) => plan.filter((row) => row.pattern.days.includes(weekday)).length;

console.log(`\n${plan.length} venues · ${plan.reduce((total, row) => total + row.hours.length, 0)} hours rows\n`);
console.log("Pattern spread");
console.table(spread);
console.log("Venues open on each day");
console.table(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
  .reduce((acc, day) => ({ ...acc, [day]: openOn(day) }), {}));
console.log("First five venues");
console.table(plan.slice(0, 5).map(({ venueId, name, pattern }) => ({
  venueId, name, pattern: pattern.name, days: pattern.days.join(","), hours: `${pattern.opens_at}-${pattern.closes_at}`
})));

if (!commit) {
  console.log("Dry run — nothing written. Re-run with --write to apply.\n");
  process.exit(0);
}

// Clear the old rows first, so a venue that used to open more days does not keep
// stale ones behind.
const existing = await firestore.collection("venue_operating_hours").get();
let batch = firestore.batch();
let queued = 0;
const flush = async () => { if (queued) { await batch.commit(); batch = firestore.batch(); queued = 0; } };
const queue = async (fn) => { fn(); queued += 1; if (queued >= 400) await flush(); };

for (const doc of existing.docs) await queue(() => batch.delete(doc.ref));
for (const { ref, venueId, hours } of plan) {
  await queue(() => batch.update(ref, { operating_hours: hours }));
  for (const [index, row] of hours.entries()) {
    await queue(() => batch.set(firestore.collection("venue_operating_hours").doc(`${venueId}-hrs-${index + 1}`), {
      operating_id: `${venueId}-hrs-${index + 1}`,
      venue_id: venueId,
      ...row
    }));
  }
}
await flush();

console.log(`✓ Updated ${plan.length} venues and replaced ${existing.size} hours rows with ${plan.reduce((t, r) => t + r.hours.length, 0)}.\n`);
