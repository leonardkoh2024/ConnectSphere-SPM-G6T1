// Seed fixture for C1 / SCRUM-102 — NOT run automatically by anything.
//
// R1 has no account creation (CLAUDE.md), so coordinators are seeded rather
// than registered. Run this by hand, once, only against the Firestore
// emulator or a throwaway project — never against the shared team project as
// a side effect (CLAUDE.md: "never touch the shared Firebase project on your
// own initiative"). Before running against anything but the emulator, say
// exactly what will be written and where, and get that confirmed first.
//
//   FIRESTORE_EMULATOR_HOST=localhost:8080 node backend/scripts/seedCoordinators.js
//
// Writes:
//   coordinators/{c1,c2,c3}   { coordinator_seq: 1, 2, 3 }
//   assignment_cursor/default { last_assigned_seq: null }

import { db } from "../src/lib/firebaseAdmin.js";

const COORDINATORS = [
  { id: "c1", coordinator_seq: 1, name: "Coordinator One" },
  { id: "c2", coordinator_seq: 2, name: "Coordinator Two" },
  { id: "c3", coordinator_seq: 3, name: "Coordinator Three" }
];

async function seed() {
  const firestore = db();
  await Promise.all(COORDINATORS.map((coordinator) => firestore.collection("coordinators").doc(coordinator.id).set(coordinator)));
  await firestore.collection("assignment_cursor").doc("default").set({ last_assigned_seq: null });
  console.log(`Seeded ${COORDINATORS.length} coordinators and the rotation cursor.`);
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});
