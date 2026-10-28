import assert from "node:assert/strict";
import test from "node:test";

import { createRecheckAllVenueConflicts } from "./conflicts.js";

const query = (collection, constraints = []) => ({
  collection,
  constraints,
  where(field, operator, value) {
    return query(collection, [...constraints, [field, operator, value]]);
  }
});

test("catalogue-wide conflict checks deduplicate by venue_id rather than assignment document ID", async () => {
  const assignments = [
    { id: "assignment-101", data: () => ({ venue_id: "V1", user_id: "S1" }) },
    { id: "assignment-102", data: () => ({ venue_id: "V1", user_id: "S2" }) },
    { id: "assignment-201", data: () => ({ venue_id: "V2", user_id: "S3" }) }
  ];
  const firestore = {
    collection(name) {
      return {
        ...query(name),
        doc(id) { return { collection: name, id }; },
        get: async () => name === "venue_staff" ? { docs: assignments } : { docs: [] }
      };
    },
    runTransaction: async (operation) => operation({
      get: async (reference) => {
        if (reference.collection === "venues") return { exists: true, data: () => ({}) };
        if (reference.collection === "venue_staff") return { docs: [{}] };
        return { docs: [] };
      },
      set() {},
      update() {}
    })
  };

  const recheckAll = createRecheckAllVenueConflicts({ firestore, serverTimestamp: () => "STAMP" });
  const result = await recheckAll();

  assert.deepEqual(result, { venues_checked: 2, active_conflicts: 0 });
});
