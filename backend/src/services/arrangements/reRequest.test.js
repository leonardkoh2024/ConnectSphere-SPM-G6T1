// I3 / SCRUM-149 — a significant change forces affected arrangements back into re-request.
//
// After the coordinator's browser saves an applied change, it asks this service (Admin
// SDK) to carry out the effects the browser may not write itself: a coordinator cannot
// update a venue booking or an equipment reservation, and cannot read Venue Staff or
// Technical Support accounts to tell them. The service marks the affected arrangements
// (AC1), moves a Confirmed event back to Planning (AC1), tells their holders (AC2), never
// cancels or releases anything (AC3) and re-checks the registration, flagging it for the
// organiser without editing it (AC5). What it has already applied is remembered in
// `arrangement_rerequests/{eventId}`, so asking twice applies once.

import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import {
  REREQUEST_NOTICE_TYPES,
  affectedEquipmentReservations,
  affectedKinds,
  affectedVenueBookings,
  arrangementReRequestMessage,
  changeTriggersReRequest,
  changedFieldLabels,
  createArrangementReRequester,
  equipmentSignature,
  reRequestMarker,
  registrationReviewMessage,
  statusAfterChange
} from "./reRequest.js";
import { createArrangementsService } from "./service.js";

const NOW = { serverTimestamp: true };
const MARKER_KEYS = ["rerequest_change_id", "rerequest_flagged_at", "rerequest_reason", "rerequest_required"];

const baseEvent = (overrides = {}) => ({
  coordinator_id: "coord-1",
  organiser_id: "org-1",
  name: "Partner Summit",
  reference_no: "EVT-001",
  status: "CONFIRMED",
  event_date: "2026-11-05",
  start_time: "09:00",
  end_time: "17:00",
  expected_attendance: 100,
  last_significant_change_id: "h1",
  registration_required: false,
  ...overrides
});

const dateChange = (overrides = {}) => ({
  event_id: "event-1",
  action_type: "SIGNIFICANT_EVENT_DETAILS_CHANGED",
  old_value: { event_date: "2026-11-04" },
  new_value: { event_date: "2026-11-05" },
  warning_acknowledged: true,
  ...overrides
});

const AUDIO = { equipment_type: "AUDIO", quantity: 2, technical_requirements: "Wireless" };

// ---- what the rules say (pure) ---------------------------------------------------------------------

test("I3-TC1 AC1 every kind of significant change is a trigger", () => {
  [
    { event_date: { old_value: "2026-11-04", new_value: "2026-11-05" } },
    { start_time: { old_value: "09:00", new_value: "10:00" } },
    { end_time: { old_value: "17:00", new_value: "18:00" } },
    { expected_attendance: { old_value: 100, new_value: 150 } },
    { required_layout: { old_value: "THEATRE", new_value: "BANQUET" } },
    { preferred_location: { old_value: "CENTRAL", new_value: "EAST" } },
    { facilities: { old_value: ["WIFI"], new_value: ["STAGE"] } },
    { accessibility: { old_value: [], new_value: ["LIFT"] } }
  ].forEach((significantChanges) => assert.equal(changeTriggersReRequest({ significantChanges }), true));
});

test("I3-TC2 AC1 an equipment requirement change is a trigger on its own", () => {
  assert.equal(changeTriggersReRequest({ significantChanges: {}, equipmentChanged: true }), true);
});

test("I3-TC3 AC1 no significant change and no equipment change is not a trigger", () => {
  assert.equal(changeTriggersReRequest({}), false);
  assert.equal(changeTriggersReRequest({ significantChanges: {}, equipmentChanged: false }), false);
});

test("I3-TC4 AC1 a Confirmed event goes back to Planning when triggered; every other status is left alone", () => {
  assert.equal(statusAfterChange("CONFIRMED", true), "PLANNING");
  assert.equal(statusAfterChange("PLANNING", true), "PLANNING");
  assert.equal(statusAfterChange("APPROVED", true), "APPROVED");
  assert.equal(statusAfterChange("CONFIRMED", false), "CONFIRMED");
});

test("I3-TC5 AC1 a venue-side change affects venue bookings and equipment; an equipment-only change affects equipment alone", () => {
  assert.deepEqual(affectedKinds({ significantChanges: { event_date: {} } }), { venue: true, equipment: true });
  assert.deepEqual(affectedKinds({ significantChanges: {}, equipmentChanged: true }), { venue: false, equipment: true });
  assert.deepEqual(affectedKinds({}), { venue: false, equipment: false });
});

test("I3-TC6 the changed fields read as labels, in the order the Edit event form lists them", () => {
  assert.deepEqual(
    changedFieldLabels({ start_time: {}, event_date: {}, expected_attendance: {} }),
    ["Expected attendance", "Event date", "Start time"]
  );
  assert.deepEqual(changedFieldLabels({}, true), ["Equipment"]);
});

test("I3-TC7 AC1 live venue bookings are affected; ended ones are not", () => {
  const bookings = [
    { id: "b1", status: "PENDING" },
    { id: "b2", status: "HELD" },
    { id: "b3", status: "APPROVED" },
    { id: "b4", status: "REJECTED" },
    { id: "b5", status: "RELEASED" },
    { id: "b6", status: "WITHDRAWN" },
    { id: "b7", status: "approved" }
  ];
  assert.deepEqual(affectedVenueBookings(bookings).map((item) => item.id), ["b1", "b2", "b3", "b7"]);
});

test("I3-TC8 AC1 live equipment reservations are affected; released ones are not", () => {
  const reservations = [
    { id: "r1", status: "RESERVED" },
    { id: "r2", status: "APPROVED" },
    { id: "r3", status: "RELEASED" },
    { id: "r4", status: "CANCELLED" }
  ];
  assert.deepEqual(affectedEquipmentReservations(reservations).map((item) => item.id), ["r1", "r2"]);
});

test("I3-TC9 AC3 the marker carries the flag, the change and the reason, and never a status", () => {
  const marker = reRequestMarker({ changeId: "h7", reason: "Event date changed" });
  assert.deepEqual(marker, {
    rerequest_required: true,
    rerequest_change_id: "h7",
    rerequest_reason: "Event date changed"
  });
  // Nothing that could cancel, release or approve a booking or a reservation.
  assert.equal(Object.keys(marker).includes("status"), false);
  assert.equal(Object.keys(marker).some((key) => /cancel|release|withdraw/i.test(key)), false);
});

test("I3-TC10 AC2 the notice names the event and what changed", () => {
  const message = arrangementReRequestMessage({ eventName: "Partner Summit", changed: ["Event date", "Start time"] });
  assert.match(message, /^Partner Summit:/);
  assert.match(message, /Event date, Start time/);
  assert.match(message, /re-request/i);
});

test("I3-TC11 AC3 the notice says the existing arrangement stays as a reference and is not cancelled", () => {
  const message = arrangementReRequestMessage({ eventName: "Partner Summit", changed: ["Equipment"] });
  assert.match(message, /reference/i);
  assert.match(message, /not (been )?cancelled/i);
});

test("I3-TC12 an unnamed event reads as 'An event'", () => {
  assert.match(arrangementReRequestMessage({ changed: ["Event date"] }), /^An event:/);
});

test("I3-TC13 the two notice types are distinct, and registration review is not an arrangement notice", () => {
  assert.deepEqual(REREQUEST_NOTICE_TYPES, {
    ARRANGEMENT: "ARRANGEMENT_REREQUEST_REQUIRED",
    REGISTRATION_REVIEW: "REGISTRATION_NEEDS_REVIEW"
  });
});

test("I3-TC26 AC5 the review message names the event and each reason, and promises no automatic edit", () => {
  const message = registrationReviewMessage({
    eventName: "Partner Summit", reasons: ["CLOSES_AFTER_START", "CAPACITY_ABOVE_VENUE"]
  });
  assert.match(message, /^Partner Summit:/);
  assert.match(message, /registration/i);
  assert.match(message, /closes after the (new )?event start/i);
  assert.match(message, /above the venue capacity/i);
  assert.match(message, /review/i);
  assert.match(message, /nothing (has been|was) changed automatically/i);
});

// A small in-memory Firestore: reads see the state before the transaction, and writes are
// applied when it commits, as the real one behaves.
const fixture = ({
  event = baseEvent(),
  history = { h1: dateChange() },
  bookings = {
    b1: { event_id: "event-1", venue_id: "v1", status: "APPROVED" },
    b2: { event_id: "event-1", venue_id: "v1", status: "HELD" },
    b3: { event_id: "event-1", venue_id: "v2", status: "PENDING" },
    b4: { event_id: "event-1", venue_id: "v3", status: "REJECTED" },
    b5: { event_id: "event-1", venue_id: "v4", status: "RELEASED" },
    other: { event_id: "event-2", venue_id: "v1", status: "APPROVED" }
  },
  reservations = {
    r1: { event_id: "event-1", status: "RESERVED" },
    r2: { event_id: "event-1", status: "RELEASED" },
    other: { event_id: "event-2", status: "RESERVED" }
  },
  equipmentRequest = { event_id: "event-1", status: "PENDING", lines: [AUDIO] },
  venueStaff = { v1: { user_id: "vs-1" }, v2: { user_id: "vs-2" }, v3: { user_id: "vs-3" }, v4: { user_id: "vs-4" } },
  venues = { v1: { max_capacity: 120 }, v2: { max_capacity: 80 } },
  users = {
    "tech-1": { role: "TECHNICAL_SUPPORT_STAFF", is_active: true },
    "tech-2": { role: "TECHNICAL_SUPPORT_STAFF" },
    "tech-gone": { role: "TECHNICAL_SUPPORT_STAFF", is_active: false },
    "coord-1": { role: "EVENT_COORDINATOR", is_active: true }
  },
  registrations = {},
  state = null
} = {}) => {
  const store = new Map();
  const put = (collection, rows) => Object.entries(rows).forEach(([id, data]) => store.set(`${collection}/${id}`, data));
  if (event) store.set("events/event-1", event);
  put("event_history", history);
  put("venue_bookings", bookings);
  put("equipment_reservations", reservations);
  if (equipmentRequest) store.set("equipment_requests/event-1", equipmentRequest);
  put("venue_staff", venueStaff);
  put("venues", venues);
  put("users", users);
  put("registrations", registrations);
  if (state) store.set("arrangement_rerequests/event-1", state);

  const writes = [];
  let counter = 0;
  const reference = (collectionName, id) => {
    const ref = { id, path: `${collectionName}/${id}`, collectionName };
    ref.get = async () => snapshotOf(ref);
    return ref;
  };
  const snapshotOf = (ref) => {
    const data = store.get(ref.path);
    return { id: ref.id, ref, exists: data !== undefined, data: () => data };
  };

  const firestore = {
    collection(name) {
      const query = (filters) => ({
        collectionName: name,
        filters,
        where: (field, _operator, value) => query([...filters, [field, value]])
      });
      return {
        doc: (id) => reference(name, id ?? `${name}-${++counter}`),
        where: (field, _operator, value) => query([[field, value]])
      };
    },
    runTransaction: async (callback) => {
      const pending = [];
      const transaction = {
        async get(target) {
          if (target.filters) {
            const docs = [...store.entries()]
              .filter(([path]) => path.startsWith(`${target.collectionName}/`))
              .filter(([, data]) => target.filters.every(([field, value]) => data[field] === value))
              .map(([path]) => snapshotOf(reference(target.collectionName, path.split("/")[1])));
            return { docs, size: docs.length };
          }
          return snapshotOf(target);
        },
        update(ref, data) { pending.push({ kind: "update", ref, data }); },
        set(ref, data) { pending.push({ kind: "set", ref, data }); },
        create(ref, data) { pending.push({ kind: "create", ref, data }); }
      };
      const result = await callback(transaction);
      pending.forEach((write) => {
        writes.push(write);
        const current = store.get(write.ref.path);
        store.set(write.ref.path, write.kind === "update" ? { ...current, ...write.data } : write.data);
      });
      return result;
    }
  };

  const requester = createArrangementReRequester({ firestore, serverTimestamp: () => NOW });
  const apply = (overrides = {}) => requester.apply({ eventId: "event-1", userId: "coord-1", changeId: "h1", ...overrides });
  const updatesAt = (prefix) => writes.filter(({ kind, ref }) => kind === "update" && ref.path.startsWith(prefix));
  const notices = () => writes.filter(({ ref }) => ref.collectionName === "notifications").map(({ data }) => data);
  const setCapacity = (overrides = {}) => requester.setRegistrationCapacity({
    eventId: "event-1", userId: "coord-1", capacity: 80, ...overrides
  });
  return { store, writes, firestore, apply, setCapacity, updatesAt, notices };
};

// ---- AC1 the affected arrangements are marked and the event goes back to Planning -------------

test("I3-TC27 AC1 a significant change on a Confirmed event moves it back to Planning", async () => {
  const { apply, updatesAt, store } = fixture();
  const result = await apply();

  assert.equal(result.applied, true);
  assert.equal(result.status, "PLANNING");
  const [eventUpdate] = updatesAt("events/");
  assert.equal(eventUpdate.ref.path, "events/event-1");
  assert.equal(eventUpdate.data.status, "PLANNING");
  assert.deepEqual(eventUpdate.data.updated_at, NOW);
  assert.equal(store.get("events/event-1").status, "PLANNING");
});

test("I3-TC28 AC1 the move is recorded in the event's history, with the change it answers", async () => {
  const { apply, writes } = fixture();
  await apply();

  const row = writes.find(({ data }) => data.action_type === "ARRANGEMENTS_REREQUESTED");
  assert.ok(row, "an ARRANGEMENTS_REREQUESTED history row is written");
  assert.equal(row.ref.collectionName, "event_history");
  assert.equal(row.data.history_id, row.ref.id);
  assert.equal(row.data.event_id, "event-1");
  assert.equal(row.data.actor_id, "coord-1");
  assert.equal(row.data.old_value, "CONFIRMED");
  assert.equal(row.data.new_value, "PLANNING");
  assert.equal(row.data.rerequest_change_id, "h1");
  assert.deepEqual(row.data.created_at, NOW);
});

test("I3-TC29 AC1 only live venue bookings of this event are marked", async () => {
  const { apply, updatesAt } = fixture();
  const result = await apply();

  const marked = updatesAt("venue_bookings/").map(({ ref }) => ref.id).sort();
  assert.deepEqual(marked, ["b1", "b2", "b3"]);
  assert.equal(result.venueBookings, 3);
});

test("I3-TC30 AC1 only live equipment reservations, and the equipment request, are marked", async () => {
  const { apply, updatesAt } = fixture();
  const result = await apply();

  assert.deepEqual(updatesAt("equipment_reservations/").map(({ ref }) => ref.id), ["r1"]);
  assert.deepEqual(updatesAt("equipment_requests/").map(({ ref }) => ref.id), ["event-1"]);
  assert.equal(result.equipment, 2);
});

test("I3-TC31 AC1 each marked arrangement carries the flag, the change, the reason and the time", async () => {
  const { apply, updatesAt } = fixture();
  await apply();

  [...updatesAt("venue_bookings/"), ...updatesAt("equipment_reservations/"), ...updatesAt("equipment_requests/")].forEach(({ data }) => {
    assert.deepEqual(Object.keys(data).sort(), MARKER_KEYS);
    assert.equal(data.rerequest_required, true);
    assert.equal(data.rerequest_change_id, "h1");
    assert.match(data.rerequest_reason, /event date/i);
    assert.deepEqual(data.rerequest_flagged_at, NOW);
  });
});

test("I3-TC32 AC1 a change already in Planning still marks and tells, and leaves the status alone", async () => {
  const { apply, updatesAt, store } = fixture({ event: baseEvent({ status: "PLANNING" }) });
  const result = await apply();

  assert.equal(result.status, "PLANNING");
  assert.equal(updatesAt("venue_bookings/").length, 3);
  assert.equal("status" in (updatesAt("events/")[0]?.data ?? {}), false);
  assert.equal(store.get("events/event-1").status, "PLANNING");
});

test("I3-TC33 AC1 an Approved event keeps its status", async () => {
  const { apply, store } = fixture({ event: baseEvent({ status: "APPROVED" }) });
  await apply();
  assert.equal(store.get("events/event-1").status, "APPROVED");
});

// ---- AC3 nothing is cancelled, released or removed ------------------------------------------------

test("I3-TC34 AC3 no booking, reservation or request has its status changed, and nothing is deleted", async () => {
  const { apply, writes, store } = fixture();
  await apply();

  writes
    .filter(({ ref }) => ["venue_bookings", "equipment_reservations", "equipment_requests"].includes(ref.collectionName))
    .forEach(({ kind, data }) => {
      assert.equal(kind, "update");
      assert.equal("status" in data, false);
    });
  assert.equal(writes.some(({ kind }) => kind === "delete"), false);
  // The arrangements as they were are still there, flagged, with their statuses intact.
  assert.equal(store.get("venue_bookings/b1").status, "APPROVED");
  assert.equal(store.get("venue_bookings/b2").status, "HELD");
  assert.equal(store.get("venue_bookings/b3").status, "PENDING");
  assert.equal(store.get("equipment_reservations/r1").status, "RESERVED");
  assert.equal(store.get("equipment_requests/event-1").status, "PENDING");
});

test("I3-TC35 AC3 arrangements that had already ended, and other events' arrangements, are not touched", async () => {
  const { apply, writes } = fixture();
  await apply();

  const touched = writes.map(({ ref }) => ref.path);
  ["venue_bookings/b4", "venue_bookings/b5", "venue_bookings/other", "equipment_reservations/r2", "equipment_reservations/other"]
    .forEach((path) => assert.equal(touched.includes(path), false, `${path} was written`));
});

// ---- AC2 Venue Staff and Technical Support are told -----------------------------------------------

test("I3-TC36 AC2 the Venue Staff holding an affected booking are told, once each, and nobody else", async () => {
  const { apply, notices } = fixture();
  const result = await apply();

  const venueNotices = notices().filter((item) => ["vs-1", "vs-2", "vs-3", "vs-4"].includes(item.user_id));
  // v1 holds two live bookings but its staff member hears once; v3 (rejected) and v4 (released) hold nothing.
  assert.deepEqual(venueNotices.map((item) => item.user_id).sort(), ["vs-1", "vs-2"]);
  assert.equal(result.notified.venueStaff, 2);
});

test("I3-TC37 AC2 every active Technical Support member is told when equipment arrangements are affected", async () => {
  const { apply, notices } = fixture();
  const result = await apply();

  const support = notices().filter((item) => item.user_id.startsWith("tech-"));
  assert.deepEqual(support.map((item) => item.user_id).sort(), ["tech-1", "tech-2"]);
  assert.equal(result.notified.technicalSupport, 2);
});

test("I3-TC38 AC2 each notice is in the inbox's shape, names the event and the change, and says nothing was cancelled", async () => {
  const { apply, notices } = fixture();
  await apply();

  const arrangement = notices().filter((item) => item.type === "ARRANGEMENT_REREQUEST_REQUIRED");
  assert.equal(arrangement.length, 4);
  arrangement.forEach((item) => {
    assert.equal(item.event_id, "event-1");
    assert.equal(item.is_read, false);
    assert.equal(item.read_at, null);
    assert.deepEqual(item.created_at, NOW);
    assert.match(item.message, /^Partner Summit:/);
    assert.match(item.message, /Event date/);
    assert.match(item.message, /not (been )?cancelled/i);
  });
});

test("I3-TC39 AC2 every notice is created with its own id, equal to its document id", async () => {
  const { apply, writes } = fixture();
  await apply();

  const created = writes.filter(({ ref }) => ref.collectionName === "notifications");
  assert.ok(created.length >= 4);
  created.forEach(({ kind, ref, data }) => {
    assert.equal(kind, "create");
    assert.equal(data.notification_id, ref.id);
  });
  assert.equal(new Set(created.map(({ ref }) => ref.id)).size, created.length);
});

test("I3-TC40 AC2 an event with no equipment arrangements tells no Technical Support, and one with no venue booking tells no Venue Staff", async () => {
  const noEquipment = fixture({ equipmentRequest: null, reservations: {} });
  const resultA = await noEquipment.apply();
  assert.equal(resultA.notified.technicalSupport, 0);
  assert.equal(resultA.equipment, 0);
  assert.equal(noEquipment.notices().some((item) => item.user_id.startsWith("tech-")), false);

  const noVenue = fixture({ bookings: {} });
  const resultB = await noVenue.apply();
  assert.equal(resultB.notified.venueStaff, 0);
  assert.equal(resultB.venueBookings, 0);
});

// ---- applying once ------------------------------------------------------------------------------------

test("I3-TC41 asking again for the same change applies nothing and tells nobody twice", async () => {
  const { apply, writes } = fixture();
  await apply();
  const before = writes.length;

  const again = await apply();
  assert.equal(again.applied, false);
  assert.equal(writes.length, before);
});

test("I3-TC42 what was applied is remembered, with the equipment request as it stood", async () => {
  const { apply, store } = fixture();
  await apply();

  const state = store.get("arrangement_rerequests/event-1");
  assert.equal(state.event_id, "event-1");
  assert.equal(state.significant_change_id, "h1");
  assert.equal(state.equipment_signature, equipmentSignature({ lines: [AUDIO] }));
  assert.deepEqual(state.applied_at, NOW);
});

test("I3-TC43 a later significant change is applied again", async () => {
  const { apply, store } = fixture();
  await apply();
  store.set("event_history/h2", dateChange({ old_value: { start_time: "09:00" }, new_value: { start_time: "10:00" } }));
  store.set("events/event-1", { ...store.get("events/event-1"), status: "CONFIRMED", last_significant_change_id: "h2" });

  const second = await apply({ changeId: "h2" });
  assert.equal(second.applied, true);
  assert.equal(store.get("events/event-1").status, "PLANNING");
  assert.equal(store.get("venue_bookings/b1").rerequest_change_id, "h2");
  assert.match(store.get("venue_bookings/b1").rerequest_reason, /start time/i);
});

// ---- who may ask, and for what -------------------------------------------------------------------------

test("I3-TC44 only the event's own coordinator may ask", async () => {
  const { apply, writes } = fixture();
  await assert.rejects(apply({ userId: "coord-2" }), { statusCode: 403 });
  assert.equal(writes.length, 0);
});

test("I3-TC45 an unknown event, and a missing event id, are refused", async () => {
  const { apply } = fixture({ event: null });
  await assert.rejects(apply(), { statusCode: 404 });
  await assert.rejects(apply({ eventId: " " }), { statusCode: 400 });
});

test("I3-TC46 a change that is not the event's latest significant change is refused", async () => {
  const { apply, writes } = fixture();
  await assert.rejects(apply({ changeId: "h0" }), { statusCode: 409 });
  await assert.rejects(apply({ changeId: undefined }), { statusCode: 400 });
  assert.equal(writes.length, 0);
});

test("I3-TC47 a change id whose history row is not a significant change is refused", async () => {
  const { apply, writes } = fixture({ history: { h1: { event_id: "event-1", action_type: "EVENT_DETAILS_UPDATED" } } });
  await assert.rejects(apply(), { statusCode: 409 });
  assert.equal(writes.length, 0);
});

test("I3-TC48 a Completed, Cancelled or Rejected event is left alone", async () => {
  for (const status of ["COMPLETED", "CANCELLED", "REJECTED"]) {
    const { apply, writes } = fixture({ event: baseEvent({ status }) });
    const result = await apply();
    assert.equal(result.applied, false);
    assert.equal(writes.length, 0);
  }
});

// ---- an equipment requirement change ---------------------------------------------------------------------

const equipmentFixture = (overrides = {}) => {
  const baseline = { event_id: "event-1", significant_change_id: "h1", equipment_signature: equipmentSignature({ lines: [AUDIO] }) };
  return fixture({
    history: {},
    event: baseEvent({ last_significant_change_id: undefined }),
    state: baseline,
    equipmentRequest: { event_id: "event-1", status: "PENDING", lines: [{ ...AUDIO, quantity: 3 }] },
    ...overrides
  });
};

test("I3-TC49 AC1 a changed equipment request re-requests the equipment only, and moves the event back to Planning", async () => {
  const { apply, updatesAt, store, notices } = equipmentFixture();
  const result = await apply({ source: "EQUIPMENT", changeId: undefined });

  assert.equal(result.applied, true);
  assert.equal(result.status, "PLANNING");
  assert.equal(updatesAt("venue_bookings/").length, 0);
  assert.deepEqual(updatesAt("equipment_reservations/").map(({ ref }) => ref.id), ["r1"]);
  assert.match(store.get("equipment_reservations/r1").rerequest_reason, /equipment/i);
  assert.equal(notices().some((item) => ["vs-1", "vs-2"].includes(item.user_id)), false);
  assert.deepEqual(notices().filter((item) => item.type === "ARRANGEMENT_REREQUEST_REQUIRED").map((item) => item.user_id).sort(), ["tech-1", "tech-2"]);
});

test("I3-TC50 saving the equipment request again unchanged re-requests nothing", async () => {
  const { apply, writes } = equipmentFixture({
    equipmentRequest: { event_id: "event-1", status: "PENDING", lines: [AUDIO] }
  });
  const result = await apply({ source: "EQUIPMENT", changeId: undefined });

  assert.equal(result.applied, false);
  assert.equal(writes.length, 0);
});

test("I3-TC51 the same equipment change is applied once, and the next different one again", async () => {
  const { apply, store, writes } = equipmentFixture();
  await apply({ source: "EQUIPMENT", changeId: undefined });
  const before = writes.length;
  assert.equal((await apply({ source: "EQUIPMENT", changeId: undefined })).applied, false);
  assert.equal(writes.length, before);

  store.set("events/event-1", { ...store.get("events/event-1"), status: "CONFIRMED" });
  store.set("equipment_requests/event-1", { event_id: "event-1", status: "PENDING", lines: [{ ...AUDIO, quantity: 4 }] });
  const next = await apply({ source: "EQUIPMENT", changeId: undefined });
  assert.equal(next.applied, true);
  assert.equal(store.get("events/event-1").status, "PLANNING");
});

test("I3-TC52 a first equipment request, with no reservation yet to invalidate, re-requests nothing", async () => {
  const { apply, writes } = fixture({
    history: {},
    event: baseEvent({ last_significant_change_id: undefined }),
    reservations: {},
    state: null
  });
  const result = await apply({ source: "EQUIPMENT", changeId: undefined });

  assert.equal(result.applied, false);
  assert.equal(writes.length, 0);
});

test("I3-TC53 the equipment signature ignores whitespace around a requirement but not its type or quantity", () => {
  const base = equipmentSignature({ lines: [AUDIO] });
  assert.equal(equipmentSignature({ lines: [{ ...AUDIO, technical_requirements: "  Wireless " }] }), base);
  assert.notEqual(equipmentSignature({ lines: [{ ...AUDIO, quantity: 3 }] }), base);
  assert.notEqual(equipmentSignature({ lines: [{ ...AUDIO, equipment_type: "VISUAL" }] }), base);
  assert.equal(equipmentSignature(undefined), equipmentSignature({ lines: [] }));
});

// ---- AC5 the registration is re-checked, flagged for review and never edited ----------------------------

const registered = (overrides = {}) => baseEvent({
  registration_required: true,
  registration_capacity: 100,
  registration_open_date: "2026-10-01",
  registration_open_time: "09:00",
  registration_close_date: "2026-11-04",
  registration_close_time: "18:00",
  event_date: "2026-11-05",
  ...overrides
});
const REVIEW_KEYS = ["registration_needs_review", "registration_review_flagged_at", "registration_review_reasons"];

test("I3-TC54 AC5 a close time now after the new event start flags the registration and tells the organiser", async () => {
  const { apply, updatesAt, notices } = fixture({
    event: registered({ event_date: "2026-11-03" }),
    history: { h1: dateChange({ new_value: { event_date: "2026-11-03" } }) }
  });
  const result = await apply();

  assert.deepEqual(result.registrationReview, ["CLOSES_AFTER_START"]);
  const eventUpdate = updatesAt("events/")[0].data;
  assert.equal(eventUpdate.registration_needs_review, true);
  assert.deepEqual(eventUpdate.registration_review_reasons, ["CLOSES_AFTER_START"]);
  assert.deepEqual(eventUpdate.registration_review_flagged_at, NOW);
  const organiser = notices().filter((item) => item.type === "REGISTRATION_NEEDS_REVIEW");
  assert.equal(organiser.length, 1);
  assert.equal(organiser[0].user_id, "org-1");
  assert.match(organiser[0].message, /^Partner Summit:/);
  assert.match(organiser[0].message, /closes after/i);
});

test("I3-TC55 AC5 a registration capacity above the venue capacity of the approved bookings flags it", async () => {
  const { apply, updatesAt, notices } = fixture({
    event: registered({ registration_capacity: 150 }),
    history: { h1: dateChange({ old_value: { start_time: "10:00" }, new_value: { start_time: "09:00" } }) }
  });
  const result = await apply();

  // v1 is the only approved venue (120); the held and pending bookings do not count.
  assert.deepEqual(result.registrationReview, ["CAPACITY_ABOVE_VENUE"]);
  assert.deepEqual(updatesAt("events/")[0].data.registration_review_reasons, ["CAPACITY_ABOVE_VENUE"]);
  assert.equal(notices().filter((item) => item.type === "REGISTRATION_NEEDS_REVIEW").length, 1);
});

test("I3-TC56 AC5 the registration itself is never edited, closed or cancelled", async () => {
  const { apply, writes, store } = fixture({
    event: registered({ event_date: "2026-11-03", registration_capacity: 500 }),
    history: { h1: dateChange({ new_value: { event_date: "2026-11-03" } }) }
  });
  await apply();

  const eventUpdate = writes.find(({ ref }) => ref.path === "events/event-1").data;
  const registrationKeys = Object.keys(eventUpdate).filter((key) => key.startsWith("registration_"));
  assert.deepEqual(registrationKeys.sort(), [...REVIEW_KEYS].sort());
  const after = store.get("events/event-1");
  assert.equal(after.registration_capacity, 500);
  assert.equal(after.registration_close_date, "2026-11-04");
  assert.equal(after.registration_close_time, "18:00");
  assert.equal(after.registration_required, true);
  assert.equal(writes.some(({ ref }) => ref.collectionName === "registrations"), false);
});

test("I3-TC57 AC5 a window and capacity that still fit raise no flag and no notice", async () => {
  const { apply, updatesAt, notices } = fixture({ event: registered() });
  const result = await apply();

  assert.deepEqual(result.registrationReview, []);
  const eventUpdate = updatesAt("events/")[0].data;
  REVIEW_KEYS.forEach((key) => assert.equal(key in eventUpdate, false));
  assert.equal(notices().some((item) => item.type === "REGISTRATION_NEEDS_REVIEW"), false);
});

test("I3-TC58 AC5 a change to the end time alone does not re-check the registration", async () => {
  const { apply, updatesAt, notices } = fixture({
    event: registered({ event_date: "2026-11-03", registration_capacity: 500 }),
    history: { h1: dateChange({ old_value: { end_time: "16:00" }, new_value: { end_time: "17:00" } }) }
  });
  const result = await apply();

  assert.deepEqual(result.registrationReview, []);
  assert.equal("registration_needs_review" in updatesAt("events/")[0].data, false);
  assert.equal(notices().some((item) => item.type === "REGISTRATION_NEEDS_REVIEW"), false);
});

test("I3-TC59 AC5 an event without registration has nothing to flag", async () => {
  const { apply, notices } = fixture({
    event: registered({ registration_required: false, event_date: "2026-11-03", registration_capacity: 500 }),
    history: { h1: dateChange({ new_value: { event_date: "2026-11-03" } }) }
  });
  const result = await apply();

  assert.deepEqual(result.registrationReview, []);
  assert.equal(notices().some((item) => item.type === "REGISTRATION_NEEDS_REVIEW"), false);
});

test("I3-TC60 AC5 an event already in Planning is still re-checked, and asking again flags and tells once", async () => {
  const { apply, notices } = fixture({
    event: registered({ status: "PLANNING", event_date: "2026-11-03" }),
    history: { h1: dateChange({ new_value: { event_date: "2026-11-03" } }) }
  });
  const first = await apply();
  const second = await apply();

  assert.deepEqual(first.registrationReview, ["CLOSES_AFTER_START"]);
  assert.equal(second.applied, false);
  assert.equal(notices().filter((item) => item.type === "REGISTRATION_NEEDS_REVIEW").length, 1);
});


// ---- AC4 a lower registration capacity needs an explicit acknowledgement -----------------------------
//
// The Edit event form asks for the new capacity here. The browser checks the acknowledgement
// too, but this is where it is enforced: the registered count is read inside the same
// transaction as the write, so someone registering between the check and the save cannot slip past.

const attendees = (count, status = "REGISTERED") => Object.fromEntries(
  Array.from({ length: count }, (_, index) => [`${status}-${index}`, { event_id: "event-1", status }])
);
const capacityFixture = ({ registrations = attendees(60), event = registered({ registration_capacity: 100 }), ...rest } = {}) => fixture({
  event,
  registrations,
  bookings: { b1: { event_id: "event-1", venue_id: "v1", status: "APPROVED" } },
  ...rest
});

test("I3-TC61 AC4 a capacity lowered but still at or above the registered count is saved with no acknowledgement, and nothing else moves", async () => {
  const { setCapacity, updatesAt, store } = capacityFixture();
  const result = await setCapacity({ capacity: 80 });

  assert.deepEqual(result, { eventId: "event-1", changed: true, capacity: 80, previousCapacity: 100, registeredCount: 60 });
  const [update] = updatesAt("events/");
  assert.deepEqual(Object.keys(update.data).sort(), ["registration_capacity", "updated_at"]);
  assert.equal(store.get("events/event-1").registration_capacity, 80);
  // Not a trigger: the event's status and arrangements are untouched.
  assert.equal(store.get("events/event-1").status, "CONFIRMED");
  assert.equal(updatesAt("venue_bookings/").length, 0);
});

test("I3-TC62 AC4 a capacity lowered below the registered count is refused without the acknowledgement, and nothing is written", async () => {
  const { setCapacity, writes } = capacityFixture();
  await assert.rejects(setCapacity({ capacity: 40 }), (error) => {
    assert.equal(error.statusCode, 409);
    assert.match(error.message, /below the 60 people already registered/i);
    assert.match(error.message, /acknowledge/i);
    return true;
  });
  await assert.rejects(setCapacity({ capacity: 40, acknowledged: false }), { statusCode: 409 });
  await assert.rejects(setCapacity({ capacity: 40, acknowledged: "true" }), { statusCode: 409 });
  assert.equal(writes.length, 0);
});

test("I3-TC63 AC4 with the acknowledgement the lower capacity is saved, recorded, and nobody is unregistered", async () => {
  const { setCapacity, writes, store } = capacityFixture();
  const result = await setCapacity({ capacity: 40, acknowledged: true });

  assert.equal(result.capacity, 40);
  assert.equal(store.get("events/event-1").registration_capacity, 40);
  const row = writes.find(({ data }) => data.action_type === "REGISTRATION_CAPACITY_CHANGED");
  assert.ok(row, "a REGISTRATION_CAPACITY_CHANGED history row is written");
  assert.equal(row.data.history_id, row.ref.id);
  assert.equal(row.data.event_id, "event-1");
  assert.equal(row.data.actor_id, "coord-1");
  assert.equal(row.data.field_name, "registration_capacity");
  assert.equal(row.data.old_value, 100);
  assert.equal(row.data.new_value, 40);
  assert.equal(row.data.acknowledged_below_registered, true);
  assert.equal(row.data.registered_count, 60);
  assert.deepEqual(row.data.created_at, NOW);
  // Registrations stay exactly as they were: the capacity is a limit on new places only.
  assert.equal(writes.some(({ ref }) => ref.collectionName === "registrations"), false);
  assert.equal([...store.keys()].filter((path) => path.startsWith("registrations/")).length, 60);
});

test("I3-TC64 AC4 only attendees holding a place count: waitlisted, withdrawn and cancelled do not", async () => {
  const registrations = { ...attendees(40), ...attendees(30, "WAITLISTED"), ...attendees(5, "WITHDRAWN"), ...attendees(5, "CANCELLED") };
  const { setCapacity } = capacityFixture({ registrations });

  const result = await setCapacity({ capacity: 40 });
  assert.equal(result.registeredCount, 40);
  await assert.rejects(setCapacity({ capacity: 39 }), { statusCode: 409 });
});

test("I3-TC65 AC4 a capacity equal to the registered count, or with nobody registered, needs no acknowledgement", async () => {
  assert.equal((await capacityFixture().setCapacity({ capacity: 60 })).capacity, 60);
  assert.equal((await capacityFixture({ registrations: {} }).setCapacity({ capacity: 1 })).capacity, 1);
});

test("I3-TC66 AC4 a registered count that was already above the capacity is not a reduction needing acknowledgement when the capacity is raised or kept", async () => {
  const { setCapacity } = capacityFixture({ event: registered({ registration_capacity: 40 }) });
  assert.equal((await setCapacity({ capacity: 50 })).capacity, 50);
  assert.equal((await setCapacity({ capacity: 50 })).changed, false);
});

test("I3-TC67 the capacity must be a whole number greater than zero", async () => {
  const { setCapacity, writes } = capacityFixture();
  for (const capacity of [0, -3, 2.5, "abc", "", null, undefined]) {
    await assert.rejects(setCapacity({ capacity }), { statusCode: 400 });
  }
  assert.equal(writes.length, 0);
});

test("I3-TC68 the capacity cannot exceed the venue capacity of the approved bookings", async () => {
  const { setCapacity, writes } = capacityFixture();
  await assert.rejects(setCapacity({ capacity: 121 }), (error) => {
    assert.equal(error.statusCode, 400);
    assert.match(error.message, /cannot exceed the venue capacity of 120/i);
    return true;
  });
  assert.equal(writes.length, 0);
  assert.equal((await setCapacity({ capacity: 120 })).capacity, 120);
});

test("I3-TC69 an unchanged capacity writes nothing", async () => {
  const { setCapacity, writes } = capacityFixture();
  const result = await setCapacity({ capacity: 100 });
  assert.equal(result.changed, false);
  assert.equal(writes.length, 0);
});

test("I3-TC70 only the event's coordinator, on an event with registration, in a live status, with an approved booking", async () => {
  await assert.rejects(capacityFixture().setCapacity({ userId: "coord-2" }), { statusCode: 403 });
  await assert.rejects(capacityFixture({ event: null }).setCapacity(), { statusCode: 404 });
  await assert.rejects(capacityFixture({ event: registered({ registration_required: false }) }).setCapacity(), { statusCode: 409 });
  for (const status of ["COMPLETED", "CANCELLED", "REJECTED", "SAFETY_REVIEW"]) {
    await assert.rejects(capacityFixture({ event: registered({ status }) }).setCapacity(), { statusCode: 409 });
  }
  await assert.rejects(
    capacityFixture({ bookings: { b1: { event_id: "event-1", venue_id: "v1", status: "HELD" } } }).setCapacity(),
    (error) => error.statusCode === 409 && /venue booking has been approved/i.test(error.message)
  );
  await assert.rejects(capacityFixture().setCapacity({ eventId: " " }), { statusCode: 400 });
});

// ---- the routes ---------------------------------------------------------------------------------------

const withServer = async (setup, run) => {
  const { firestore, ...rest } = setup;
  const app = express();
  app.use(express.json());
  app.use("/api/events", createArrangementsService({
    firestore,
    verifyIdToken: async (token) => {
      if (token !== "valid-token") throw new Error("bad token");
      return { uid: "coord-1" };
    },
    serverTimestamp: () => NOW
  }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const call = (path, { body = {}, authorization = "Bearer valid-token", method = "POST" } = {}) => fetch(`http://127.0.0.1:${port}/api/events${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) },
      body: JSON.stringify(body)
    });
    return await run({ call, ...rest });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
};

test("I3-TC71 a request with no bearer token, or an invalid one, is refused before any profile or event is read", async () => {
  const setup = fixture();
  await withServer(setup, async ({ call, writes }) => {
    assert.equal((await call("/event-1/rerequest-arrangements", { authorization: null })).status, 401);
    assert.equal((await call("/event-1/rerequest-arrangements", { authorization: "Bearer other" })).status, 401);
    assert.equal((await call("/event-1/registration-capacity", { authorization: null })).status, 401);
    assert.equal(writes.length, 0);
  });
});

test("I3-TC72 only an Event Coordinator account may use either route", async () => {
  const setup = fixture({ users: { "coord-1": { role: "EVENT_ORGANISER", is_active: true } } });
  await withServer(setup, async ({ call, writes }) => {
    const first = await call("/event-1/rerequest-arrangements", { body: { source: "EVENT_EDIT", change_id: "h1" } });
    assert.equal(first.status, 403);
    assert.match((await first.json()).error, /event coordinator/i);
    assert.equal((await call("/event-1/registration-capacity", { body: { capacity: 80 } })).status, 403);
    assert.equal(writes.length, 0);
  });
});

test("I3-TC73 a coordinator's saved edit is applied through the route, and the answer says what was done", async () => {
  await withServer(fixture(), async ({ call, store }) => {
    const response = await call("/event-1/rerequest-arrangements", { body: { source: "EVENT_EDIT", change_id: "h1" } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.applied, true);
    assert.equal(body.status, "PLANNING");
    assert.equal(store.get("events/event-1").status, "PLANNING");
  });
});

test("I3-TC74 an equipment change is applied through the same route with source EQUIPMENT", async () => {
  const setup = fixture({
    history: {},
    event: baseEvent({ last_significant_change_id: undefined }),
    state: { event_id: "event-1", equipment_signature: equipmentSignature({ lines: [AUDIO] }) },
    equipmentRequest: { event_id: "event-1", status: "PENDING", lines: [{ ...AUDIO, quantity: 3 }] }
  });
  await withServer(setup, async ({ call }) => {
    const body = await (await call("/event-1/rerequest-arrangements", { body: { source: "EQUIPMENT" } })).json();
    assert.equal(body.applied, true);
  });
});

test("I3-TC75 a refusal from the service reaches the browser with its status and message", async () => {
  await withServer(fixture(), async ({ call }) => {
    const stale = await call("/event-1/rerequest-arrangements", { body: { source: "EVENT_EDIT", change_id: "h0" } });
    assert.equal(stale.status, 409);
    assert.ok((await stale.json()).error);
    const unknownSource = await call("/event-1/rerequest-arrangements", { body: { source: "SOMETHING_ELSE" } });
    assert.equal(unknownSource.status, 400);
  });
});

test("I3-TC76 the capacity route saves with the acknowledgement and refuses without it", async () => {
  await withServer(capacityFixture(), async ({ call, store }) => {
    const refused = await call("/event-1/registration-capacity", { body: { capacity: 40 } });
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /below the 60 people already registered/i);

    const saved = await call("/event-1/registration-capacity", { body: { capacity: 40, acknowledged: true } });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).capacity, 40);
    assert.equal(store.get("events/event-1").registration_capacity, 40);
  });
});
