import assert from "node:assert/strict";
import test from "node:test";

import { createEquipmentReservations } from "./reservations.js";

const booking = {
  status: "APPROVED",
  occupied_start: new Date("2026-11-04T00:30:00.000Z"),
  occupied_end: new Date("2026-11-04T09:30:00.000Z")
};
const reservationRecord = (changes = {}) => ({
  equipment_type: "AUDIO",
  quantity: 2,
  status: "RESERVED",
  start_datetime: new Date("2026-11-04T00:30:00.000Z"),
  end_datetime: new Date("2026-11-04T09:30:00.000Z"),
  ...changes
});

const fixture = ({
  reservations = [],
  unavailable = [],
  withReservationRequest = false,
  lines = [{ equipment_type: "AUDIO", quantity: 2 }],
  event = { coordinator_id: "coord-1", name: "Q4 Partner Summit" }
} = {}) => {
  const transaction = {
    created: [],
    updated: [],
    create(reference, data) { this.created.push({ reference, data }); },
    update(reference, data) { this.updated.push({ reference, data }); },
    async get(reference) {
      if (reference.path === "equipment_requests/event-1") {
        return {
          exists: true,
          data: () => (withReservationRequest
            ? { status: "ARRANGED", lines: [{ reservation_id: "reservation-1", equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED" }] }
            : { status: "PENDING", lines })
        };
      }
      if (reference.path === "equipment_inventory/AUDIO" || reference.path === "equipment_inventory/VISUAL") {
        return { exists: true, data: () => ({ total_quantity: 8, availability_revision: 0 }) };
      }
      if (reference.path === "equipment_reservations/reservation-1") {
        return {
          exists: true,
          data: () => reservationRecord({
            event_id: "event-1",
            reservation_id: "reservation-1",
            line_index: 0
          })
        };
      }
      if (reference.collectionName === "equipment_reservations") {
        // G5 — like Firestore, return only the documents that match the query's filters.
        const matching = reservations.filter((data) =>
          (reference.filters || []).every(([field, value]) => data[field] === value));
        return { docs: matching.map((data, index) => {
          const id = data.reservation_id || `reservation-${index + 1}`;
          return {
            id,
            ref: { path: `equipment_reservations/${id}`, id },
            data: () => data
          };
        }) };
      }
      if (reference.collectionName === "equipment_unavailability") {
        return { docs: unavailable.map((data) => ({ data: () => data })) };
      }
      if (reference.path === "events/event-1") {
        return { exists: Boolean(event), data: () => event };
      }
      throw new Error(`Unexpected transaction read ${reference.path || reference.collectionName}`);
    }
  };
  const firestore = {
    collection(name) {
      return {
        doc(id = "generated-reservation") {
          return { id, path: `${name}/${id}`, collectionName: name };
        },
        where(field, _operator, value) {
          return {
            collectionName: name,
            filters: [[field, value]],
            where(nextField, _nextOperator, nextValue) {
              this.filters.push([nextField, nextValue]);
              return this;
            }
          };
        }
      };
    },
    async runTransaction(callback) {
      return callback(transaction);
    }
  };
  const serverTimestamp = () => ({ serverTimestamp: true });
  const service = createEquipmentReservations({
    firestore,
    serverTimestamp,
    getApprovedEventBookings: async () => [booking]
  });
  return { service, transaction };
};

test("TC-303 creates an event-linked reservation for its buffered approved venue window", async () => {
  const { service, transaction } = fixture();
  const result = await service.reserve({
    eventId: "event-1",
    equipmentType: "AUDIO",
    quantity: 3,
    userId: "tech-1"
  });

  assert.equal(result.status, "RESERVED");
  assert.equal(result.event_id, "event-1");
  assert.equal(result.equipment_type, "AUDIO");
  assert.equal(result.quantity, 3);
  assert.equal(result.start_datetime.toISOString(), "2026-11-04T00:30:00.000Z");
  assert.equal(result.end_datetime.toISOString(), "2026-11-04T09:30:00.000Z");
  assert.equal(result.reserved_by, "tech-1");
  // Reservation, history, and (J6, TC-346) the coordinator's notification.
  assert.equal(transaction.created.length, 3);
  assert.equal(transaction.created[1].data.action, "LINE_RESERVED");
  assert.equal(transaction.created[1].data.actor_id, "tech-1");
  assert.equal(transaction.updated[0].reference.path, "equipment_requests/event-1");
  assert.equal(transaction.updated[0].data.lines[0].fulfillment_status, "RESERVED");
  assert.ok(transaction.updated[0].data.lines[0].fulfilled_at instanceof Date);
  assert.equal(transaction.updated[0].data.lines[0].reservation_id, "generated-reservation");
  assert.equal(transaction.updated[1].data.availability_revision, 1);
  assert.equal(transaction.updated[0].data.status, "ARRANGED");
});

test("TC-300 rejects quantities below one without writing a reservation", async () => {
  const { service, transaction } = fixture();
  await assert.rejects(
    service.reserve({ eventId: "event-1", equipmentType: "AUDIO", quantity: 0, userId: "tech-1" }),
    /whole number greater than zero/
  );
  assert.equal(transaction.created.length, 0);
});

test("TC-301 refuses and explains a reservation that exceeds free stock for its full window", async () => {
  const { service, transaction } = fixture({
    reservations: [reservationRecord({ quantity: 7 })]
  });
  await assert.rejects(
    service.reserve({ eventId: "event-1", equipmentType: "AUDIO", quantity: 2, userId: "tech-1" }),
    /1 free, 1 more needed/
  );
  assert.equal(transaction.created.length, 0);
  assert.equal(transaction.updated.length, 0);
});

test("TC-305 release retains the reservation and advances the inventory revision", async () => {
  const { service, transaction } = fixture({ withReservationRequest: true });
  const result = await service.release({
    reservationId: "reservation-1",
    reason: "Event no longer needs it",
    userId: "tech-1"
  });

  assert.deepEqual(result, { reservationId: "reservation-1", status: "RELEASED" });
  assert.equal(transaction.created.length, 1);
  assert.equal(transaction.created[0].data.action, "LINE_RESERVATION_RELEASED");
  assert.equal(transaction.created[0].data.reason, "Event no longer needs it");
  assert.equal(transaction.updated.length, 3);
  assert.equal(transaction.updated[0].reference.path, "equipment_reservations/reservation-1");
  assert.equal(transaction.updated[0].data.status, "RELEASED");
  assert.equal(transaction.updated[0].data.released_by, "tech-1");
  assert.equal(transaction.updated[0].data.release_reason, "Event no longer needs it");
  assert.equal(transaction.updated[1].reference.path, "equipment_requests/event-1");
  assert.equal(transaction.updated[1].data.lines[0].fulfillment_status, "PENDING");
  assert.equal(transaction.updated[2].data.availability_revision, 1);
});

test("D4 cancellation releases every active reservation and advances inventory availability", async () => {
  const { service, transaction } = fixture({
    withReservationRequest: true,
    event: { coordinator_id: "coord-1", status: "CANCELLED", name: "Q4 Partner Summit" },
    reservations: [
      reservationRecord({
        reservation_id: "reservation-1", event_id: "event-1", line_index: 0, equipment_type: "AUDIO", quantity: 2
      })
    ]
  });

  await assert.deepEqual(
    await service.releaseCancelledEventReservations({
      eventId: "event-1", reason: "Speaker unavailable", userId: "coord-1"
    }),
    { released: 1 }
  );
  assert.equal(transaction.updated[0].reference.path, "equipment_reservations/reservation-1");
  assert.deepEqual(transaction.updated[0].data, {
    status: "RELEASED",
    released_at: { serverTimestamp: true },
    released_by: "coord-1",
    release_reason: "Speaker unavailable",
    updated_at: { serverTimestamp: true }
  });
  assert.equal(transaction.updated[1].reference.path, "equipment_requests/event-1");
  assert.equal(transaction.updated[1].data.status, "CANCELLED");
  assert.equal(transaction.updated[1].data.lines[0].fulfillment_status, "RELEASED");
  assert.equal(transaction.updated[2].reference.path, "equipment_inventory/AUDIO");
  assert.equal(transaction.updated[2].data.availability_revision, 1);
  assert.equal(transaction.created[0].data.actor_id, "coord-1");
  assert.equal(transaction.created[0].data.actor_role, "Event Coordinator");
  assert.equal(transaction.created[0].data.reason, "Speaker unavailable");
});

test("D4 equipment release rejects a non-cancelled event", async () => {
  const { service, transaction } = fixture({
    withReservationRequest: true,
    event: { coordinator_id: "coord-1", status: "PLANNING" }
  });
  await assert.rejects(
    service.releaseCancelledEventReservations({
      eventId: "event-1", reason: "No longer happening", userId: "coord-1"
    }),
    /only after the event is Cancelled/
  );
  assert.equal(transaction.updated.length, 0);
  assert.equal(transaction.created.length, 0);
});

// G5 / SCRUM-137 — release equipment when an event is cancelled. The D4 tests above pin one
// reservation; these pin "all", "only this event's", who may ask, and the history it leaves.
const cancelledEvent = { coordinator_id: "coord-1", status: "CANCELLED", name: "Q4 Partner Summit" };
const g5Reservations = () => [
  reservationRecord({ reservation_id: "res-audio", event_id: "event-1", line_index: 0, equipment_type: "AUDIO", quantity: 2 }),
  reservationRecord({ reservation_id: "res-visual", event_id: "event-1", line_index: 1, equipment_type: "VISUAL", quantity: 1 }),
  reservationRecord({
    reservation_id: "res-earlier", event_id: "event-1", line_index: 2, equipment_type: "AUDIO", quantity: 1,
    status: "RELEASED", release_reason: "Released earlier by Technical Support"
  }),
  reservationRecord({ reservation_id: "res-other-event", event_id: "event-2", line_index: 0, equipment_type: "AUDIO", quantity: 3 })
];
const reservationUpdates = (transaction) =>
  transaction.updated.filter((item) => item.reference.path.startsWith("equipment_reservations/"));

test("G5-TC1 AC1 cancelling releases every active reservation of the event, whatever the type, and no other", async () => {
  const { service, transaction } = fixture({ withReservationRequest: true, event: cancelledEvent, reservations: g5Reservations() });

  assert.deepEqual(
    await service.releaseCancelledEventReservations({ eventId: "event-1", reason: "Venue lost", userId: "coord-1" }),
    { released: 2 }
  );

  const released = reservationUpdates(transaction);
  assert.deepEqual(released.map((item) => item.reference.path).sort(), [
    "equipment_reservations/res-audio", "equipment_reservations/res-visual"
  ]);
  released.forEach((item) => assert.equal(item.data.status, "RELEASED"));
  // Each type's stock count moves once, so availability is recomputed for both.
  const inventory = transaction.updated.filter((item) => item.reference.path.startsWith("equipment_inventory/"));
  assert.deepEqual(inventory.map((item) => item.reference.path).sort(), ["equipment_inventory/AUDIO", "equipment_inventory/VISUAL"]);
  inventory.forEach((item) => assert.equal(item.data.availability_revision, 1));
});

test("G5-TC2 AC3 each released reservation is kept in the event's history with the reason, the time and who released it", async () => {
  const { service, transaction } = fixture({ withReservationRequest: true, event: cancelledEvent, reservations: g5Reservations() });
  await service.releaseCancelledEventReservations({ eventId: "event-1", reason: "Venue lost", userId: "coord-1" });

  // The reservation itself is updated, never deleted, and carries when and why.
  reservationUpdates(transaction).forEach((item) => {
    assert.equal(item.data.release_reason, "Venue lost");
    assert.deepEqual(item.data.released_at, { serverTimestamp: true });
    assert.equal(item.data.released_by, "coord-1");
  });
  assert.equal(transaction.deleted, undefined);
  // One history row per released reservation, none for the one released earlier or the other event's.
  const history = transaction.created.filter((item) => item.reference.collectionName === "equipment_request_history");
  assert.deepEqual(history.map((item) => item.data.reservation_id).sort(), ["res-audio", "res-visual"]);
  history.forEach((item) => {
    assert.equal(item.data.event_id, "event-1");
    assert.equal(item.data.action, "LINE_RESERVATION_RELEASED");
    assert.equal(item.data.reason, "Venue lost");
    assert.deepEqual(item.data.created_at, { serverTimestamp: true });
  });
});

test("G5-TC3 AC1 only the event's current coordinator can release its equipment, and nothing is written when refused", async () => {
  const { service, transaction } = fixture({
    withReservationRequest: true,
    event: { ...cancelledEvent, coordinator_id: "coord-2" },
    reservations: g5Reservations()
  });
  await assert.rejects(
    service.releaseCancelledEventReservations({ eventId: "event-1", reason: "Venue lost", userId: "coord-1" }),
    /current event coordinator/
  );
  assert.equal(transaction.updated.length, 0);
  assert.equal(transaction.created.length, 0);
});

// J6 / SCRUM-155 AC3 — TC-329, TC-330, TC-334, TC-346 in docs/test-cases.md.
test("TC-346 reserving the only open line arranges the request and tells the coordinator once", async () => {
  const { service, transaction } = fixture();
  await service.reserve({ eventId: "event-1", equipmentType: "AUDIO", quantity: 2, userId: "tech-1" });

  const created = transaction.created.filter((item) => item.reference.collectionName === "notifications");
  assert.equal(created.length, 1);
  assert.equal(created[0].reference.id, created[0].data.notification_id);
  assert.deepEqual(created[0].data, {
    notification_id: created[0].reference.id,
    user_id: "coord-1",
    event_id: "event-1",
    type: "EQUIPMENT_ARRANGED",
    message: "Q4 Partner Summit: your equipment is reserved. Reserved: 2 × audio.",
    is_read: false,
    created_at: { serverTimestamp: true },
    read_at: null
  });
});

const notices = (transaction) => transaction.created
  .filter((item) => item.reference.collectionName === "notifications")
  .map((item) => item.data);

test("TC-329 reserving one of several open lines leaves the request Pending and tells nobody", async () => {
  const { service, transaction } = fixture({
    lines: [{ equipment_type: "AUDIO", quantity: 2 }, { equipment_type: "VISUAL", quantity: 1 }]
  });
  await service.reserve({ eventId: "event-1", equipmentType: "AUDIO", quantity: 2, userId: "tech-1", lineIndex: 0 });

  assert.equal(transaction.updated[0].data.status, "PENDING");
  assert.equal(notices(transaction).length, 0);
});

test("TC-330 the last line reserved after another was refused: arranged, told once, to the current coordinator", async () => {
  const { service, transaction } = fixture({
    lines: [
      { equipment_type: "VISUAL", quantity: 1, fulfillment_status: "RESOLVED", resolution: "UNABLE_TO_FULFILL" },
      { equipment_type: "AUDIO", quantity: 2 }
    ],
    event: { coordinator_id: "coord-2", name: "Q4 Partner Summit" }
  });
  await service.reserve({ eventId: "event-1", equipmentType: "AUDIO", quantity: 2, userId: "tech-1", lineIndex: 1 });

  assert.equal(transaction.updated[0].data.status, "ARRANGED");
  assert.deepEqual(notices(transaction).map(({ user_id: userId, event_id: eventId, type, message }) => ({ userId, eventId, type, message })), [{
    userId: "coord-2",
    eventId: "event-1",
    type: "EQUIPMENT_ARRANGED",
    message: "Q4 Partner Summit: some of your equipment is reserved. Reserved: 2 × audio. 1 line was unable to be fulfilled."
  }]);
});

test("TC-334 an event with no coordinator still has its equipment reserved, with nobody notified", async () => {
  const { service, transaction } = fixture({ event: null });
  const result = await service.reserve({ eventId: "event-1", equipmentType: "AUDIO", quantity: 2, userId: "tech-1" });

  assert.equal(result.status, "RESERVED");
  assert.equal(transaction.updated[0].data.status, "ARRANGED");
  assert.equal(notices(transaction).length, 0);
});

// G6 / SCRUM-138 — reassess equipment after a significant change.
//
// AC1 (the request and its reservations are marked, Technical Support are told) and AC2 (nothing
// is released automatically) are I3's work and are pinned there: I3-TC30, TC31, TC34, TC37, TC38
// in arrangements/reRequest.test.js. These tests cover AC3: what Technical Support can do once an
// arrangement is flagged `rerequest_required` — re-check against the new window, then keep, amend
// or release the reservation.
//
// Decisions (Shi Han, 30 Oct 2026):
//   - the new window is the event's CURRENT date and times, with the setup and turnaround that the
//     event's approved booking carries (the booking itself stays as the old reference, I3 AC3);
//   - Keep checks the new window again, moves the reservation to it and clears the flag;
//   - Amend on a reserved line is one step: release the old reservation and reserve the new
//     quantity together, or neither;
//   - Release is the existing release; it also clears the request's flag once nothing else waits.
const G6_START = "2026-11-12T00:30:00.000Z";
const G6_END = "2026-11-12T10:00:00.000Z";
const g6Event = {
  coordinator_id: "coord-1", name: "Q4 Partner Summit", status: "PLANNING",
  event_date: "2026-11-12", start_time: "09:00", end_time: "17:00"
};
// The booking as it was approved for 4 November: 30 minutes of setup, 60 of turnaround.
const g6Booking = {
  status: "APPROVED",
  start_datetime: new Date("2026-11-04T01:00:00.000Z"),
  end_datetime: new Date("2026-11-04T09:00:00.000Z"),
  occupied_start: new Date("2026-11-04T00:30:00.000Z"),
  occupied_end: new Date("2026-11-04T10:00:00.000Z")
};
const g6Flag = { rerequest_required: true, rerequest_change_id: "chg-1", rerequest_reason: "Event date changed" };
const g6Request = (changes = {}) => ({
  status: "ARRANGED",
  ...g6Flag,
  lines: [
    { equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED", reservation_id: "res-audio" },
    { equipment_type: "VISUAL", quantity: 1, fulfillment_status: "RESERVED", reservation_id: "res-visual" }
  ],
  ...changes
});
const g6Reservations = () => [
  // The event's own reservations, still on the old window.
  reservationRecord({ reservation_id: "res-audio", event_id: "event-1", line_index: 0, equipment_type: "AUDIO", quantity: 2, ...g6Flag }),
  reservationRecord({ reservation_id: "res-visual", event_id: "event-1", line_index: 1, equipment_type: "VISUAL", quantity: 1, ...g6Flag }),
  // Another event holds 3 audio inside the NEW window, a third holds 4 inside the OLD one only.
  reservationRecord({
    reservation_id: "res-other-new", event_id: "event-2", line_index: 0, equipment_type: "AUDIO", quantity: 3,
    start_datetime: new Date("2026-11-12T01:00:00.000Z"), end_datetime: new Date("2026-11-12T08:00:00.000Z")
  }),
  reservationRecord({ reservation_id: "res-other-old", event_id: "event-3", line_index: 0, equipment_type: "AUDIO", quantity: 4 })
];
const withoutFlag = (reservations, id) => reservations.map((item) =>
  item.reservation_id === id ? { ...item, rerequest_required: false } : item);

// An in-memory Firestore that, like the real one, refuses a read that comes after a write.
const g6Fixture = ({ event = g6Event, request = g6Request(), reservations = g6Reservations(), total = 8, unavailable = [] } = {}) => {
  const transaction = {
    created: [],
    updated: [],
    wrote: false,
    create(reference, data) { this.wrote = true; this.created.push({ reference, data }); },
    update(reference, data) { this.wrote = true; this.updated.push({ reference, data }); },
    async get(reference) {
      assert.equal(this.wrote, false, "Firestore refuses a read that comes after a write in a transaction.");
      if (reference.path === "events/event-1") return { exists: Boolean(event), data: () => event };
      if (reference.path === "equipment_requests/event-1") return { exists: Boolean(request), data: () => request };
      if (reference.path?.startsWith("equipment_inventory/")) {
        return { exists: true, data: () => ({ total_quantity: total, availability_revision: 0 }) };
      }
      if (reference.path?.startsWith("equipment_reservations/")) {
        const found = reservations.find((item) => `equipment_reservations/${item.reservation_id}` === reference.path);
        return { exists: Boolean(found), data: () => found };
      }
      if (reference.collectionName === "equipment_reservations") {
        const matching = reservations.filter((data) => (reference.filters || []).every(([field, value]) => data[field] === value));
        return {
          docs: matching.map((data) => ({
            id: data.reservation_id,
            ref: { path: `equipment_reservations/${data.reservation_id}`, id: data.reservation_id },
            data: () => data
          }))
        };
      }
      if (reference.collectionName === "equipment_unavailability") {
        return { docs: unavailable.map((data) => ({ data: () => data })) };
      }
      throw new Error(`Unexpected transaction read ${reference.path || reference.collectionName}`);
    }
  };
  const firestore = {
    collection(name) {
      return {
        doc(id = "generated-reservation") { return { id, path: `${name}/${id}`, collectionName: name }; },
        where(field, _operator, value) {
          return {
            collectionName: name,
            filters: [[field, value]],
            where(nextField, _nextOperator, nextValue) { this.filters.push([nextField, nextValue]); return this; }
          };
        }
      };
    },
    async runTransaction(callback) { return callback(transaction); }
  };
  const service = createEquipmentReservations({
    firestore, serverTimestamp: () => ({ serverTimestamp: true }), getApprovedEventBookings: async () => [g6Booking]
  });
  return { service, transaction };
};
const updateTo = (transaction, path) => transaction.updated.find((item) => item.reference.path === path);
const createdIn = (transaction, collection) => transaction.created.filter((item) => item.reference.collectionName === collection);
const nothingWritten = (transaction) => {
  assert.equal(transaction.created.length, 0);
  assert.equal(transaction.updated.length, 0);
};

test("G6-TC1 AC3 re-checking measures the event's new window, keeping the venue's setup and turnaround, and writes nothing", async () => {
  const { service, transaction } = g6Fixture();
  const result = await service.recheckReassessment({ eventId: "event-1" });

  // 12 November 09:00–17:00 Singapore, less 30 minutes of setup, plus 60 of turnaround: not 4 November.
  assert.equal(result.windowStart.toISOString(), G6_START);
  assert.equal(result.windowEnd.toISOString(), G6_END);
  nothingWritten(transaction);
});

test("G6-TC2 AC3 free stock in the new window leaves out the event's own holds and holds that fall only in the old window", async () => {
  const { service } = g6Fixture();
  const { lines } = await service.recheckReassessment({ eventId: "event-1" });

  // 8 held − 3 held by another event in the new window = 5. The 4 held in the old window do not count.
  assert.deepEqual(lines.map(({ reservationId, lineIndex, equipmentType, quantity, freeQuantity, shortfall, available }) =>
    ({ reservationId, lineIndex, equipmentType, quantity, freeQuantity, shortfall, available })), [
    { reservationId: "res-audio", lineIndex: 0, equipmentType: "AUDIO", quantity: 2, freeQuantity: 5, shortfall: 0, available: true },
    { reservationId: "res-visual", lineIndex: 1, equipmentType: "VISUAL", quantity: 1, freeQuantity: 8, shortfall: 0, available: true }
  ]);
});

test("G6-TC3 AC3 a line that no longer fits states its shortfall as a number", async () => {
  const { service } = g6Fixture({ total: 4 });
  const { lines } = await service.recheckReassessment({ eventId: "event-1" });

  // 4 held − 3 held by the other event = 1 free for the 2 asked for.
  assert.deepEqual([lines[0].freeQuantity, lines[0].shortfall, lines[0].available], [1, 1, false]);
  assert.deepEqual([lines[1].freeQuantity, lines[1].shortfall, lines[1].available], [4, 0, true]);
});

test("G6-TC4 AC3 re-checking is refused, and writes nothing, without an event, a full date and time, or anything waiting", async () => {
  const cases = [
    [{ eventId: "" }, {}, /Choose an event/],
    [{ eventId: "event-1" }, { event: null }, /Event not found/],
    [{ eventId: "event-1" }, { event: { ...g6Event, start_time: null } }, /complete date and time/],
    [{ eventId: "event-1" }, { reservations: withoutFlag(withoutFlag(g6Reservations(), "res-audio"), "res-visual") }, /waiting for reassessment/]
  ];
  for (const [input, fixtureOptions, message] of cases) {
    const { service, transaction } = g6Fixture(fixtureOptions);
    await assert.rejects(service.recheckReassessment(input), message);
    nothingWritten(transaction);
  }
});

test("G6-TC5 AC3 keeping a reservation moves it to the new window and clears its flag, recording who and why, without releasing it", async () => {
  const { service, transaction } = g6Fixture();
  const result = await service.keepReservation({ reservationId: "res-audio", note: "Still fits the new date", userId: "tech-1" });

  assert.equal(result.reservationId, "res-audio");
  assert.equal(result.status, "RESERVED");
  const reservation = updateTo(transaction, "equipment_reservations/res-audio").data;
  assert.equal(reservation.start_datetime.toISOString(), G6_START);
  assert.equal(reservation.end_datetime.toISOString(), G6_END);
  assert.equal(reservation.rerequest_required, false);
  assert.equal(reservation.rerequest_resolution, "KEPT");
  assert.equal(reservation.rerequest_resolved_by, "tech-1");
  // AC2 — kept means still reserved: no status change, nothing released.
  ["status", "released_at", "released_by", "release_reason"].forEach((key) => assert.equal(key in reservation, false, key));

  const [history] = createdIn(transaction, "equipment_request_history");
  assert.equal(history.data.action, "RESERVATION_KEPT");
  assert.equal(history.data.actor_id, "tech-1");
  assert.equal(history.data.event_id, "event-1");
  assert.equal(history.data.reservation_id, "res-audio");
  assert.equal(history.data.equipment_type, "AUDIO");
  assert.equal(history.data.quantity, 2);
  assert.equal(history.data.note, "Still fits the new date");
  assert.deepEqual(history.data.created_at, { serverTimestamp: true });
  assert.equal(updateTo(transaction, "equipment_inventory/AUDIO").data.availability_revision, 1);

  // The VISUAL reservation still waits, so the request stays flagged.
  const request = updateTo(transaction, "equipment_requests/event-1");
  assert.ok(!request || request.data.rerequest_required !== false);
});

test("G6-TC6 AC3 keeping the last flagged reservation clears the request's flag and nothing else on it", async () => {
  const { service, transaction } = g6Fixture({ reservations: withoutFlag(g6Reservations(), "res-visual") });
  await service.keepReservation({ reservationId: "res-audio", userId: "tech-1" });

  const request = updateTo(transaction, "equipment_requests/event-1").data;
  assert.equal(request.rerequest_required, false);
  // The lines and the Arranged status are left exactly as they were.
  assert.equal("lines" in request, false);
  assert.equal("status" in request, false);
  // A note is optional.
  assert.equal(createdIn(transaction, "equipment_request_history")[0].data.note ?? null, null);
});

test("G6-TC7 AC3 a reservation that no longer fits the new window cannot be kept, and stays reserved and flagged", async () => {
  const { service, transaction } = g6Fixture({ total: 4 });
  await assert.rejects(
    service.keepReservation({ reservationId: "res-audio", userId: "tech-1" }),
    { statusCode: 409, message: /1 free, 1 more needed/ }
  );
  nothingWritten(transaction);
});

test("G6-TC8 AC3 only a flagged, active reservation can be kept: asking again, or for a released or unknown one, writes nothing", async () => {
  const cases = [
    [{ reservationId: "" }, {}, 400, /Choose an equipment reservation/],
    [{ reservationId: "res-missing" }, {}, 404, /not found/i],
    [{ reservationId: "res-audio" }, { reservations: withoutFlag(g6Reservations(), "res-audio") }, 409, /waiting for reassessment/],
    [{ reservationId: "res-audio" }, {
      reservations: g6Reservations().map((item) => item.reservation_id === "res-audio" ? { ...item, status: "RELEASED" } : item)
    }, 409, /no longer active/]
  ];
  for (const [input, fixtureOptions, statusCode, message] of cases) {
    const { service, transaction } = g6Fixture(fixtureOptions);
    await assert.rejects(service.keepReservation({ ...input, userId: "tech-1" }), { statusCode, message });
    nothingWritten(transaction);
  }
});

test("G6-TC9 AC3 amending a reserved line releases the old reservation and reserves the new quantity in one step", async () => {
  const { service, transaction } = g6Fixture();
  const result = await service.amendReservation({
    reservationId: "res-audio", quantity: 4, note: "Larger crowd expected", userId: "tech-1"
  });

  const released = updateTo(transaction, "equipment_reservations/res-audio").data;
  assert.equal(released.status, "RELEASED");
  assert.equal(released.released_by, "tech-1");
  assert.equal(released.release_reason, "Larger crowd expected");

  const [created] = createdIn(transaction, "equipment_reservations");
  assert.equal(created.data.event_id, "event-1");
  assert.equal(created.data.equipment_type, "AUDIO");
  assert.equal(created.data.quantity, 4);
  assert.equal(created.data.line_index, 0);
  assert.equal(created.data.status, "RESERVED");
  assert.equal(created.data.reserved_by, "tech-1");
  assert.equal(created.data.start_datetime.toISOString(), G6_START);
  assert.equal(created.data.end_datetime.toISOString(), G6_END);
  assert.notEqual(created.data.rerequest_required, true);
  assert.equal(result.reservation.quantity, 4);
  assert.equal(result.reservation.status, "RESERVED");

  // The request line now points at the new reservation and the request stays Arranged.
  const request = updateTo(transaction, "equipment_requests/event-1").data;
  assert.equal(request.lines[0].reservation_id, created.reference.id);
  assert.equal(request.lines[0].fulfillment_status, "RESERVED");
  assert.equal(request.lines[1].reservation_id, "res-visual");
  assert.equal(request.status, "ARRANGED");

  // Both halves are in the event's history, in order, with the note.
  const history = createdIn(transaction, "equipment_request_history").map((item) => item.data);
  assert.deepEqual(history.map((item) => item.action), ["LINE_RESERVATION_RELEASED", "LINE_RESERVED"]);
  assert.equal(history[0].reason, "Larger crowd expected");
  assert.equal(history[1].note, "Larger crowd expected");
  history.forEach((item) => assert.equal(item.actor_id, "tech-1"));
  assert.equal(updateTo(transaction, "equipment_inventory/AUDIO").data.availability_revision, 1);
});

test("G6-TC10 AC3 an amended quantity may use what the event itself held, up to the free stock and not one more, and a refusal leaves the old reservation alone", async () => {
  // The event kept its date, so its own reservation already sits in the window being checked.
  const ownInWindow = () => g6Reservations().map((item) => item.reservation_id === "res-audio"
    ? { ...item, start_datetime: new Date(G6_START), end_datetime: new Date(G6_END) }
    : item);

  // 8 held − 3 held by the other event = 5 free once its own 2 are not counted against it.
  const ok = g6Fixture({ reservations: ownInWindow() });
  const result = await ok.service.amendReservation({ reservationId: "res-audio", quantity: 5, note: "Full rig", userId: "tech-1" });
  assert.equal(result.reservation.quantity, 5);

  const over = g6Fixture({ reservations: ownInWindow() });
  await assert.rejects(
    over.service.amendReservation({ reservationId: "res-audio", quantity: 6, note: "Full rig", userId: "tech-1" }),
    { statusCode: 409, message: /Requested quantity unavailable for the required time period: 5 free, 1 more needed/ }
  );
  nothingWritten(over.transaction);
});

test("G6-TC11 AC3 an amendment needs a note and a whole quantity above zero, and only a flagged active reservation can be amended", async () => {
  const cases = [
    [{ quantity: 3, note: "  " }, {}, 400, /note explaining the amendment is required/],
    [{ quantity: 3 }, {}, 400, /note explaining the amendment is required/],
    [{ quantity: 0, note: "Fewer" }, {}, 400, /whole number greater than zero/],
    [{ quantity: 1.5, note: "Half" }, {}, 400, /whole number greater than zero/],
    [{ quantity: "many", note: "Lots" }, {}, 400, /whole number greater than zero/],
    [{ quantity: 3, note: "More" }, { reservations: withoutFlag(g6Reservations(), "res-audio") }, 409, /waiting for reassessment/],
    [{ quantity: 3, note: "More", reservationId: "res-missing" }, {}, 404, /not found/i]
  ];
  for (const [input, fixtureOptions, statusCode, message] of cases) {
    const { service, transaction } = g6Fixture(fixtureOptions);
    await assert.rejects(service.amendReservation({ reservationId: "res-audio", userId: "tech-1", ...input }), { statusCode, message });
    nothingWritten(transaction);
  }
});

test("G6-TC12 AC3 releasing a flagged reservation keeps it with its reason, and clears the request's flag only when nothing else waits", async () => {
  // Another reservation of the event is still flagged: the request stays flagged.
  const first = g6Fixture();
  await first.service.release({ reservationId: "res-audio", reason: "Not needed on the new date", userId: "tech-1" });
  const released = updateTo(first.transaction, "equipment_reservations/res-audio").data;
  assert.equal(released.status, "RELEASED");
  assert.equal(released.release_reason, "Not needed on the new date");
  assert.equal(released.released_by, "tech-1");
  assert.equal(first.transaction.deleted, undefined);
  assert.equal(createdIn(first.transaction, "equipment_request_history")[0].data.reason, "Not needed on the new date");
  assert.notEqual(updateTo(first.transaction, "equipment_requests/event-1").data.rerequest_required, false);

  // It was the last one flagged: the request no longer needs reassessment, and reopens for reserving.
  const last = g6Fixture({ reservations: withoutFlag(g6Reservations(), "res-visual") });
  await last.service.release({ reservationId: "res-audio", reason: "Not needed on the new date", userId: "tech-1" });
  const request = updateTo(last.transaction, "equipment_requests/event-1").data;
  assert.equal(request.rerequest_required, false);
  assert.equal(request.status, "PENDING");
  assert.equal(request.lines[0].fulfillment_status, "PENDING");
});
