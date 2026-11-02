// Seeds the held count for every equipment type, so Technical Support can check
// availability (G-epic). Session 2 requires availability to be checked against
// real counts; with no equipment_inventory/{type} document the check fails with
// "No held inventory is recorded for <type>". The counts are our own mock data —
// the customer supplies none.
//
// One Firebase project backs the whole team, so this prints what it would write
// and stops. Nothing is written without --write.
//
//   node backend/scripts/seedEquipmentInventory.mjs
//   node backend/scripts/seedEquipmentInventory.mjs --write
//
// Writes (only with --write): equipment_inventory/{type} for each type in
// EQUIPMENT_TYPES that has no document yet. It never edits an existing one.

import { admin, db } from "../src/lib/firebaseAdmin.js";
import { EQUIPMENT_TYPES } from "../../frontend/src/domain/events.js";

const HELD = { AUDIO: 10, VISUAL: 8, LIGHTING: 12, STAGING: 6, FURNITURE: 200, OTHERS: 20 };

const commit = process.argv.includes("--write");
const firestore = db();

const missing = [];
for (const type of EQUIPMENT_TYPES) {
  const ref = firestore.collection("equipment_inventory").doc(type);
  const snapshot = await ref.get();
  if (snapshot.exists) {
    console.log(`  equipment_inventory/${type}: exists (total_quantity ${snapshot.data().total_quantity}) — left alone`);
  } else if (HELD[type] == null) {
    console.log(`  equipment_inventory/${type}: missing, but no count is set for it in HELD — skipped`);
  } else {
    missing.push({ ref, type });
    console.log(`  equipment_inventory/${type}: missing -> total_quantity ${HELD[type]}`);
  }
}

if (!missing.length) {
  console.log("\nNothing to write.\n");
  process.exit(0);
}
if (!commit) {
  console.log(`\nDry run. Re-run with --write to create ${missing.length} document(s).\n`);
  process.exit(0);
}

const batch = firestore.batch();
missing.forEach(({ ref, type }) => batch.create(ref, {
  equipment_type: type,
  total_quantity: HELD[type],
  availability_revision: 0,
  updated_at: admin.firestore.FieldValue.serverTimestamp()
}));
await batch.commit();
console.log(`\n✓ Created ${missing.length} inventory document(s).\n`);
