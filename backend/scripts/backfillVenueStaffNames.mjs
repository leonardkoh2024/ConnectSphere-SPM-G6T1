// Copies each Venue Staff member's name onto their venue's assignment, as
// venue_staff/{venueId}.staff_name. A coordinator's booking details name who
// manages the venue; coordinators may get one venue_staff document but may not
// read Venue Staff profiles (TC-347), so the name has to live on the assignment.
//
// One Firebase project backs the whole team, so this prints what it would write
// and stops. Nothing is written without --write. Re-run it after reassigning a
// venue or renaming a Venue Staff member.
//
//   node backend/scripts/backfillVenueStaffNames.mjs
//   node backend/scripts/backfillVenueStaffNames.mjs --write
//
// Writes (only with --write): venue_staff/{venueId}.staff_name, on assignments
// whose stored name differs from the profile's. Nothing else is touched.

import { db } from "../src/lib/firebaseAdmin.js";

const commit = process.argv.includes("--write");
const firestore = db();

const assignments = await firestore.collection("venue_staff").get();
const changes = [];
for (const item of assignments.docs) {
  const { user_id: userId, staff_name: stored = null } = item.data();
  const profile = userId ? await firestore.collection("users").doc(userId).get() : null;
  const name = profile?.exists ? profile.data().name || profile.data().email || null : null;
  if (!name) {
    console.log(`  venue_staff/${item.id}: no readable profile for ${JSON.stringify(userId)} — skipped`);
  } else if (name !== stored) {
    changes.push({ ref: item.ref, name });
    console.log(`  venue_staff/${item.id}: ${JSON.stringify(stored)} -> ${JSON.stringify(name)}`);
  }
}

console.log(`\n${assignments.size} assignment(s) checked, ${changes.length} to update.`);
if (!changes.length) process.exit(0);
if (!commit) {
  console.log("Dry run. Re-run with --write to apply.\n");
  process.exit(0);
}

const batch = firestore.batch();
changes.forEach(({ ref, name }) => batch.update(ref, { staff_name: name }));
await batch.commit();
console.log(`\n✓ Updated ${changes.length} assignment(s).\n`);
