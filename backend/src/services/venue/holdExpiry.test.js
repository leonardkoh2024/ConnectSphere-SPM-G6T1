import test from "node:test";
import assert from "node:assert/strict";

import { createProcessVenueHolds } from "./holdExpiry.js";

const document = (store, collection, id) => ({
  id,
  ref: { path: `${collection}/${id}` },
  exists: store[`${collection}/${id}`] !== undefined,
  data: () => store[`${collection}/${id}`]
});

const fakeFirestore = (seed = {}) => {
  const store = { ...seed };
  const collection = (name) => ({
    doc: (id) => ({ path: `${name}/${id}`, id }),
    where: (field, operator, value) => ({
      get: async () => ({
        docs: Object.entries(store)
          .filter(([path, data]) => path.startsWith(`${name}/`) && operator === "==" && data[field] === value)
          .map(([path]) => document(store, name, path.split("/")[1]))
      })
    })
  });
  return {
    store,
    collection,
    runTransaction: async (operation) => operation({
      get: async (reference) => {
        const [name, id] = reference.path.split("/");
        return document(store, name, id);
      },
      update: (reference, changes) => { store[reference.path] = { ...store[reference.path], ...changes }; },
      set: (reference, data) => { store[reference.path] = data; }
    })
  };
};

test("F16 expires at the boundary, releases the venue and notifies the current coordinator once", async () => {
  const firestore = fakeFirestore({
    "venue_bookings/H1": { status: "HELD", event_id: "E1", venue_id: "V1", booking_label: "Main hall", held_at: new Date("2026-10-19T02:00:00Z"), hold_expires_at: new Date("2026-10-22T02:00:00Z"), requested_by: "OLD" },
    "events/E1": { coordinator_id: "CURRENT" }
  });
  const process = createProcessVenueHolds({ firestore, serverTimestamp: () => "STAMP" });
  assert.deepEqual(await process({ now: new Date("2026-10-22T02:00:00Z") }), [{ booking_id: "H1", action: "EXPIRED" }]);
  assert.equal(firestore.store["venue_bookings/H1"].status, "EXPIRED");
  assert.equal(firestore.store["notifications/hold-expired-H1"].user_id, "CURRENT");
  assert.deepEqual(await process({ now: new Date("2026-10-22T03:00:00Z") }), []);
});

test("F16 sends one warning during the final 24 hours and does not expire early", async () => {
  const firestore = fakeFirestore({
    "venue_bookings/H1": { status: "HELD", event_id: "E1", venue_id: "V1", held_at: new Date("2026-10-19T02:00:00Z"), hold_expires_at: new Date("2026-10-22T02:00:00Z") },
    "events/E1": { coordinator_id: "CURRENT" }
  });
  const process = createProcessVenueHolds({ firestore, serverTimestamp: () => "STAMP" });
  assert.deepEqual(await process({ now: new Date("2026-10-21T02:00:00Z") }), [{ booking_id: "H1", action: "WARNED" }]);
  assert.equal(firestore.store["venue_bookings/H1"].status, "HELD");
  assert.equal(firestore.store["notifications/hold-warning-H1"].user_id, "CURRENT");
  assert.deepEqual(await process({ now: new Date("2026-10-21T03:00:00Z") }), []);
});

test("F16 ignores a converted hold", async () => {
  const firestore = fakeFirestore({
    "venue_bookings/H1": { status: "APPROVED", event_id: "E1", venue_id: "V1", hold_expires_at: new Date("2026-10-22T02:00:00Z") }
  });
  const process = createProcessVenueHolds({ firestore, serverTimestamp: () => "STAMP" });
  assert.deepEqual(await process({ now: new Date("2026-10-23T02:00:00Z") }), []);
  assert.equal(firestore.store["venue_bookings/H1"].status, "APPROVED");
});
