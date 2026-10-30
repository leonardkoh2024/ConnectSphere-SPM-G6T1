import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecheckAllVenueConflicts,
  createRecheckVenueConflicts,
  VenueConflictAssignmentError,
  VenueNotFoundForConflictError
} from "./conflicts.js";

const query = (collection, constraints = []) => ({
  collection,
  constraints,
  where(field, operator, value) {
    return query(collection, [...constraints, [field, operator, value]]);
  }
});

test("TC-0986 catalogue-wide conflict checks deduplicate by venue_id rather than assignment document ID", async () => {
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

// --- F9 / F10: recheckVenueConflicts against an in-memory store keyed by "collection/id". ---

const storeFirestore = (seed = {}) => {
  const store = { ...seed };
  let generated = 0;
  const docRef = (name, id) => ({ kind: "doc", path: `${name}/${id}`, id });
  const queryRef = (name, filters = []) => ({
    kind: "query",
    name,
    filters,
    where: (field, _operator, value) => queryRef(name, [...filters, [field, value]])
  });
  const snapshotOf = (path) => ({ id: path.split("/")[1], ref: { path }, exists: store[path] !== undefined, data: () => store[path] });
  const run = (target) => (target.kind === "doc"
    ? snapshotOf(target.path)
    : { docs: Object.keys(store)
      .filter((path) => path.startsWith(`${target.name}/`) && target.filters.every(([field, value]) => store[path][field] === value))
      .map(snapshotOf) });
  return {
    store,
    collection: (name) => ({
      doc: (id) => docRef(name, id ?? `generated-${++generated}`),
      where: (field, operator, value) => queryRef(name).where(field, operator, value),
      get: async () => run(queryRef(name))
    }),
    runTransaction: async (operation) => operation({
      get: async (target) => run(target),
      set: (target, data) => { store[target.path] = data; },
      update: (target, data) => { store[target.path] = { ...store[target.path], ...data }; }
    })
  };
};

const NOW = new Date("2026-11-01T00:00:00Z");
const assigned = (extra = {}) => ({
  "venues/V1": { name: "Main Hall" },
  "venue_staff/S1-V1": { venue_id: "V1", user_id: "staff-1" },
  ...extra
});
const approved = (eventId, start, end, extra = {}) => ({
  venue_id: "V1", event_id: eventId, status: "APPROVED",
  start_datetime: new Date(start), end_datetime: new Date(end), ...extra
});
const paths = (store, prefix) => Object.keys(store).filter((path) => path.startsWith(prefix));
const recheckWith = (firestore) => createRecheckVenueConflicts({ firestore, serverTimestamp: () => "STAMP" });

test("TC-0987 [normal] F10 two approved bookings whose occupied windows overlap are flagged, never cancelled", async () => {
  const firestore = storeFirestore(assigned({
    "venue_bookings/B1": approved("E1", "2026-11-10T01:00:00Z", "2026-11-10T04:00:00Z", { event_name: "Forum" }),
    "venue_bookings/B2": approved("E2", "2026-11-10T03:00:00Z", "2026-11-10T06:00:00Z", { event_name: "Expo" }),
    "events/E1": { coordinator_id: "coord-1" },
    "events/E2": { coordinator_id: "coord-2" }
  }));

  assert.deepEqual(await recheckWith(firestore)({ venueId: "V1", userId: "staff-1", now: NOW }), { active_conflicts: 1 });

  const conflict = firestore.store["venue_booking_conflicts/V1--B1--B2"];
  assert.equal(conflict.status, "ACTIVE");
  assert.equal(conflict.detected_at, "STAMP");
  assert.equal(conflict.resolved_at, null);
  assert.equal(conflict.event_a_name, "Forum");
  assert.equal(conflict.event_b_name, "Expo");
  assert.deepEqual(conflict.overlap_start, new Date("2026-11-10T03:00:00Z"));
  assert.deepEqual(conflict.overlap_end, new Date("2026-11-10T04:00:00Z"));
  assert.equal(firestore.store["venue_bookings/B1"].status, "APPROVED");
  assert.equal(firestore.store["venue_bookings/B2"].status, "APPROVED");
  assert.equal(firestore.store["event_history/clash-detected-V1--B1--B2-E1"].action_type, "VENUE_BOOKING_CLASH_DETECTED");
  assert.ok(firestore.store["event_history/clash-detected-V1--B1--B2-E2"]);
  const recipients = paths(firestore.store, "notifications/").map((path) => firestore.store[path].user_id).sort();
  assert.deepEqual(recipients, ["coord-1", "coord-2", "staff-1"]);
  assert.equal(firestore.store[paths(firestore.store, "notifications/")[0]].message, "Clash - review required: Forum and Expo overlap.");
});

test("TC-0975 [boundary] F9 occupied windows (setup and turnaround) decide the clash, not the event times", async () => {
  const firestore = storeFirestore(assigned({
    // The event times do not overlap, but turnaround after B1 and setup before B2 make them clash.
    "venue_bookings/B1": approved("E1", "2026-11-10T01:00:00Z", "2026-11-10T03:00:00Z", {
      occupied_start: new Date("2026-11-10T00:30:00Z"), occupied_end: new Date("2026-11-10T03:45:00Z")
    }),
    "venue_bookings/B2": approved("E2", "2026-11-10T03:30:00Z", "2026-11-10T05:00:00Z", {
      occupied_start: { toDate: () => new Date("2026-11-10T03:15:00Z") }, occupied_end: "2026-11-10T05:30:00Z"
    })
  }));

  assert.deepEqual(await recheckWith(firestore)({ venueId: "V1", userId: "staff-1", now: NOW }), { active_conflicts: 1 });
  const conflict = firestore.store["venue_booking_conflicts/V1--B1--B2"];
  assert.deepEqual(conflict.overlap_start, new Date("2026-11-10T03:15:00Z"));
  assert.deepEqual(conflict.overlap_end, new Date("2026-11-10T03:45:00Z"));
});

test("TC-0976 [boundary] F9 occupied windows that only touch do not clash", async () => {
  const firestore = storeFirestore(assigned({
    "venue_bookings/B1": approved("E1", "2026-11-10T01:00:00Z", "2026-11-10T03:00:00Z", { occupied_end: new Date("2026-11-10T03:30:00Z") }),
    "venue_bookings/B2": approved("E2", "2026-11-10T04:00:00Z", "2026-11-10T05:00:00Z", { occupied_start: new Date("2026-11-10T03:30:00Z") })
  }));

  assert.deepEqual(await recheckWith(firestore)({ venueId: "V1", userId: "staff-1", now: NOW }), { active_conflicts: 0 });
  assert.deepEqual(paths(firestore.store, "venue_booking_conflicts/"), []);
  assert.deepEqual(paths(firestore.store, "notifications/"), []);
});

test("TC-0988 [boundary] only approved bookings still running after now are compared", async () => {
  const firestore = storeFirestore(assigned({
    "venue_bookings/past": approved("E1", "2026-10-01T01:00:00Z", "2026-11-01T00:00:00Z"),
    "venue_bookings/pastToo": approved("E2", "2026-10-01T02:00:00Z", "2026-10-31T00:00:00Z"),
    "venue_bookings/held": { ...approved("E3", "2026-11-10T01:00:00Z", "2026-11-10T03:00:00Z"), status: "HELD" },
    "venue_bookings/live": approved("E4", "2026-11-10T02:00:00Z", "2026-11-10T04:00:00Z")
  }));

  assert.deepEqual(await recheckWith(firestore)({ venueId: "V1", userId: "staff-1", now: NOW }), { active_conflicts: 0 });
});

test("TC-0989 [conflict] an already-active clash keeps its first detection time and is not re-announced", async () => {
  const firestore = storeFirestore(assigned({
    "venue_bookings/B1": approved("E1", "2026-11-10T01:00:00Z", "2026-11-10T04:00:00Z"),
    "venue_bookings/B2": approved("E2", "2026-11-10T03:00:00Z", "2026-11-10T06:00:00Z"),
    "venue_booking_conflicts/V1--B1--B2": { venue_id: "V1", status: "ACTIVE", detected_at: "FIRST" }
  }));

  assert.deepEqual(await recheckWith(firestore)({ venueId: "V1", userId: "staff-1", now: NOW }), { active_conflicts: 1 });
  assert.equal(firestore.store["venue_booking_conflicts/V1--B1--B2"].detected_at, "FIRST");
  assert.deepEqual(paths(firestore.store, "event_history/"), []);
  assert.deepEqual(paths(firestore.store, "notifications/"), []);
});

test("TC-0990 [normal] F10 a clash that no longer exists is resolved and recorded on both events", async () => {
  const firestore = storeFirestore(assigned({
    "venue_bookings/B1": approved("E1", "2026-11-10T01:00:00Z", "2026-11-10T02:00:00Z"),
    "venue_booking_conflicts/V1--B1--B2": {
      venue_id: "V1", status: "ACTIVE", event_a_id: "E1", event_b_id: "E 2", event_a_name: "Forum", event_b_name: "Expo"
    },
    "venue_booking_conflicts/V1--B3--B4": { venue_id: "V1", status: "RESOLVED", event_a_id: "E3", event_b_id: null }
  }));

  assert.deepEqual(await recheckWith(firestore)({ venueId: "V1", userId: "staff-1", now: NOW }), { active_conflicts: 0 });
  assert.equal(firestore.store["venue_booking_conflicts/V1--B1--B2"].status, "RESOLVED");
  assert.equal(firestore.store["venue_booking_conflicts/V1--B1--B2"].resolved_at, "STAMP");
  assert.equal(firestore.store["event_history/clash-resolved-V1--B1--B2-E1"].action_type, "VENUE_BOOKING_CLASH_RESOLVED");
  assert.match(firestore.store["event_history/clash-resolved-V1--B1--B2-E%202"].description, /between Forum and Expo was resolved/);
  assert.equal(paths(firestore.store, "event_history/").length, 2, "an already-resolved clash is left alone");
});

test("TC-0991 [boundary] clash labels fall back to the booking label, then the event id; only known coordinators are told", async () => {
  const firestore = storeFirestore(assigned({
    "venue_bookings/B1": approved("E1", "2026-11-10T01:00:00Z", "2026-11-10T04:00:00Z", { booking_label: "Setup block" }),
    "venue_bookings/B2": approved("E2", "2026-11-10T03:00:00Z", "2026-11-10T06:00:00Z"),
    "venue_bookings/B3": approved(undefined, "2026-11-10T03:30:00Z", "2026-11-10T03:45:00Z", { booking_label: "Maintenance hold" }),
    "events/E1": { name: "No coordinator yet" }
  }));

  assert.deepEqual(await recheckWith(firestore)({ venueId: "V1", userId: "staff-1", now: NOW }), { active_conflicts: 3 });
  const conflict = firestore.store["venue_booking_conflicts/V1--B1--B2"];
  assert.equal(conflict.event_a_name, "Setup block");
  assert.equal(conflict.event_b_name, "E2");
  // Neither event has a coordinator on record, so only the staff member hears about it.
  const notices = paths(firestore.store, "notifications/").map((path) => firestore.store[path]);
  assert.ok(notices.length > 0 && notices.every((notice) => notice.user_id === "staff-1"));
  // The booking with no event writes history only for the event that exists.
  assert.ok(firestore.store["event_history/clash-detected-V1--B1--B3-E1"]);
  assert.equal(paths(firestore.store, "event_history/clash-detected-V1--B1--B3-").length, 1);
});

test("TC-0992 [failure] an unknown venue is refused before anything is written", async () => {
  const firestore = storeFirestore({ "venue_staff/S1-V1": { venue_id: "V1", user_id: "staff-1" } });
  await assert.rejects(recheckWith(firestore)({ venueId: "V1", userId: "staff-1" }), (error) => {
    assert.ok(error instanceof VenueNotFoundForConflictError);
    assert.equal(error.message, "Venue not found.");
    return true;
  });
  assert.deepEqual(Object.keys(firestore.store), ["venue_staff/S1-V1"]);
});

test("TC-0993 [conflict] Venue Staff not assigned to the venue cannot run its clash check", async () => {
  const firestore = storeFirestore(assigned());
  await assert.rejects(recheckWith(firestore)({ venueId: "V1", userId: "staff-2" }), (error) => {
    assert.ok(error instanceof VenueConflictAssignmentError);
    assert.equal(error.name, "VenueConflictAssignmentError");
    return true;
  });
});

test("TC-0994 [boundary] the catalogue-wide pass skips incomplete assignments and sums clashes per venue", async () => {
  const firestore = storeFirestore(assigned({
    "venue_staff/blank": { venue_id: "", user_id: "staff-9" },
    "venue_staff/nouser": { venue_id: "V2" },
    "venue_bookings/B1": approved("E1", "2026-11-10T01:00:00Z", "2026-11-10T04:00:00Z"),
    "venue_bookings/B2": approved("E2", "2026-11-10T03:00:00Z", "2026-11-10T06:00:00Z")
  }));
  const recheckAll = createRecheckAllVenueConflicts({ firestore, serverTimestamp: () => "STAMP" });
  assert.deepEqual(await recheckAll(), { venues_checked: 1, active_conflicts: 1 });
});
