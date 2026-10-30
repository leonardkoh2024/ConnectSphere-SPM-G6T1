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

test("TC-1135 F16 expires at the boundary, releases the venue and notifies the current coordinator once", async () => {
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

test("TC-1136 F16 sends one warning during the final 24 hours and does not expire early", async () => {
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

test("TC-1137 F16 ignores a converted hold", async () => {
  const firestore = fakeFirestore({
    "venue_bookings/H1": { status: "APPROVED", event_id: "E1", venue_id: "V1", hold_expires_at: new Date("2026-10-22T02:00:00Z") }
  });
  const process = createProcessVenueHolds({ firestore, serverTimestamp: () => "STAMP" });
  assert.deepEqual(await process({ now: new Date("2026-10-23T02:00:00Z") }), []);
  assert.equal(firestore.store["venue_bookings/H1"].status, "APPROVED");
});

const hold = (changes = {}) => ({
  status: "HELD", event_id: "E1", venue_id: "V1",
  held_at: new Date("2026-10-19T02:00:00Z"), hold_expires_at: new Date("2026-10-22T02:00:00Z"), ...changes
});
const processWith = (seed) => {
  const firestore = fakeFirestore(seed);
  return { firestore, process: createProcessVenueHolds({ firestore, serverTimestamp: () => "STAMP" }) };
};

test("TC-1138 [boundary] F16 one millisecond before expiry the hold stays held", async () => {
  const { firestore, process } = processWith({ "venue_bookings/H1": hold({ hold_warning_sent_at: "EARLIER" }), "events/E1": { coordinator_id: "C" } });
  assert.deepEqual(await process({ now: new Date("2026-10-22T01:59:59.999Z") }), []);
  assert.equal(firestore.store["venue_bookings/H1"].status, "HELD");
});

test("TC-1139 [boundary] F16 expiry accepts Timestamp-like and string dates, and an ISO string for now", async () => {
  const { firestore, process } = processWith({
    "venue_bookings/H1": hold({ held_at: undefined, submitted_at: "2026-10-19T02:00:00Z", hold_expires_at: { toDate: () => new Date("2026-10-22T02:00:00Z") } }),
    "events/E1": { coordinator_id: "C" }
  });
  assert.deepEqual(await process({ now: "2026-10-22T02:00:00Z" }), [{ booking_id: "H1", action: "EXPIRED" }]);
  assert.equal(firestore.store["event_history/hold-expired-H1"].new_value, "EXPIRED");
  assert.match(firestore.store["event_history/hold-expired-H1"].description, /^H1 expired after three working days\.$/);
});

test("TC-1140 [normal] F16 the expiry notice falls back to the requester when the event record is missing", async () => {
  const { firestore, process } = processWith({ "venue_bookings/H1": hold({ requested_by: "REQ", event_name: "Gala" }) });
  await process({ now: new Date("2026-10-23T00:00:00Z") });
  assert.equal(firestore.store["notifications/hold-expired-H1"].user_id, "REQ");
  assert.match(firestore.store["notifications/hold-expired-H1"].message, /^Gala: the venue hold expired/);
});

test("TC-1141 [boundary] F16 a hold with no event and no requester expires without a notice", async () => {
  const { firestore, process } = processWith({ "venue_bookings/H1": hold({ event_id: undefined, booking_id: "BK-9" }) });
  assert.deepEqual(await process({ now: new Date("2026-10-23T00:00:00Z") }), [{ booking_id: "H1", action: "EXPIRED" }]);
  assert.equal(firestore.store["notifications/hold-expired-H1"], undefined);
  assert.match(firestore.store["event_history/hold-expired-H1"].description, /^BK-9 /);
});

test("TC-1142 [boundary] F16 a warning with no one to tell is still recorded once", async () => {
  const { firestore, process } = processWith({ "venue_bookings/H1": hold({ event_id: undefined }) });
  assert.deepEqual(await process({ now: new Date("2026-10-21T12:00:00Z") }), [{ booking_id: "H1", action: "WARNED" }]);
  assert.equal(firestore.store["venue_bookings/H1"].hold_warning_sent_at, "STAMP");
  assert.equal(firestore.store["notifications/hold-warning-H1"], undefined);
});

test("TC-1143 [boundary] F16 a hold that never lasted more than a day gets no warning before it expires", async () => {
  const { process } = processWith({
    "venue_bookings/short": hold({ held_at: new Date("2026-10-21T03:00:00Z") }),
    "venue_bookings/undated": hold({ held_at: null })
  });
  assert.deepEqual(await process({ now: new Date("2026-10-21T12:00:00Z") }), []);
});

test("TC-1144 [failure] F16 a hold without a readable expiry is left alone rather than expired", async () => {
  const { firestore, process } = processWith({
    "venue_bookings/none": hold({ hold_expires_at: null }),
    "venue_bookings/garbled": hold({ hold_expires_at: "not a date" })
  });
  assert.deepEqual(await process({ now: new Date("2030-01-01T00:00:00Z") }), []);
  assert.equal(firestore.store["venue_bookings/none"].status, "HELD");
  assert.equal(firestore.store["venue_bookings/garbled"].status, "HELD");
});

test("TC-1145 [conflict] F16 a hold converted or deleted between the scan and its transaction is skipped", async () => {
  const firestore = fakeFirestore({ "venue_bookings/H1": hold(), "venue_bookings/H2": hold() });
  const realRun = firestore.runTransaction;
  let calls = 0;
  firestore.runTransaction = (operation) => {
    calls += 1;
    if (calls === 1) firestore.store["venue_bookings/H1"] = { ...firestore.store["venue_bookings/H1"], status: "approved" };
    if (calls === 2) delete firestore.store["venue_bookings/H2"];
    return realRun(operation);
  };
  const process = createProcessVenueHolds({ firestore, serverTimestamp: () => "STAMP" });
  assert.deepEqual(await process({ now: new Date("2026-10-23T00:00:00Z") }), []);
});

test("TC-1146 [failure] F16 a Firestore failure is passed on to the caller", async () => {
  const firestore = fakeFirestore({});
  firestore.collection = () => ({ where: () => ({ get: async () => { throw new Error("unavailable"); } }) });
  const process = createProcessVenueHolds({ firestore, serverTimestamp: () => "STAMP" });
  await assert.rejects(process(), /unavailable/);
});
