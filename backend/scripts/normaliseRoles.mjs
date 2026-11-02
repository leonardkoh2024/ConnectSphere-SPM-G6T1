// Rewrites every users/{uid}.role to its canonical value from
// frontend/src/domain/roles.js. Sign-in (LandingPage.js) and firestore.rules
// (hasRole) both compare the stored role exactly, so an account seeded as
// "Technical Support" or "TECNICAL_SUPPORT" cannot sign in at all.
//
// One Firebase project backs the whole team, so this prints what it would write
// and stops. Nothing is written without --write.
//
//   node backend/scripts/normaliseRoles.mjs
//   node backend/scripts/normaliseRoles.mjs --write
//
// Writes (only with --write): users/{uid}.role and users/{uid}.updated_at, on
// documents whose role is a recognised variant of a canonical role. A role it
// cannot recognise is listed and left alone — fix those by hand.

import { admin, db } from "../src/lib/firebaseAdmin.js";
import { ROLES, ROLE_META } from "../../frontend/src/domain/roles.js";

const commit = process.argv.includes("--write");
const firestore = db();

// "Technical support staff" / "technical-support" -> TECHNICAL_SUPPORT_STAFF / TECHNICAL_SUPPORT
const key = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");

// Every spelling we accept for a role: its stored value, its ROLES key, its
// label, and the label without a trailing "Staff". Known misspellings seen in
// the shared project are added explicitly rather than guessed at.
const variants = new Map();
Object.entries(ROLES).forEach(([name, role]) => {
  const label = ROLE_META[role]?.label;
  [role, name, label, label?.replace(/\s+staff$/i, "")].filter(Boolean)
    .forEach((spelling) => variants.set(key(spelling), role));
});
["TECNICAL_SUPPORT", "TECNICAL_SUPPORT_STAFF", "TECH_SUPPORT_STAFF"]
  .forEach((spelling) => variants.set(spelling, ROLES.TECH_SUPPORT));

const users = await firestore.collection("users").get();
const changes = [];
const unknown = [];
users.docs.forEach((item) => {
  const stored = item.data().role;
  const canonical = variants.get(key(stored));
  if (!canonical) unknown.push({ id: item.id, stored });
  else if (canonical !== stored) changes.push({ ref: item.ref, id: item.id, stored, canonical });
});

console.log(`\n${users.size} users checked.`);
if (changes.length) {
  console.log(`\n${changes.length} role(s) to rewrite:`);
  changes.forEach(({ id, stored, canonical }) => console.log(`  users/${id}: ${JSON.stringify(stored)} -> ${canonical}`));
} else {
  console.log("\nEvery recognised role is already canonical.");
}
if (unknown.length) {
  console.log(`\n${unknown.length} role(s) not recognised — left alone, fix by hand:`);
  unknown.forEach(({ id, stored }) => console.log(`  users/${id}: ${JSON.stringify(stored)}`));
}

if (!commit) {
  if (changes.length) console.log("\nDry run. Re-run with --write to apply.\n");
  process.exit(0);
}

const batch = firestore.batch();
changes.forEach(({ ref, canonical }) => batch.update(ref, {
  role: canonical,
  updated_at: admin.firestore.FieldValue.serverTimestamp()
}));
await batch.commit();
console.log(`\n✓ Rewrote ${changes.length} role(s).\n`);
