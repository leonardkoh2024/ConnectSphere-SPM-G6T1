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

test("TC-1247 creates an event-linked reservation for its buffered approved venue window", async () => {
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
  // Reservation, history, and (J6, the coordinator's notification.
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

test("TC-1248 rejects quantities below one without writing a reservation", async () => {
  const { service, transaction } = fixture();
  await assert.rejects(
    service.reserve({ eventId: "event-1", equipmentType: "AUDIO", quantity: 0, userId: "tech-1" }),
    /whole number greater than zero/
  );
  assert.equal(transaction.created.length, 0);
});

test("TC-1249 refuses and explains a reservation that exceeds free stock for its full window", async () => {
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

test("TC-1250 release retains the reservation and advances the inventory revision", async () => {
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

test("TC-0512 D4 cancellation releases every active reservation and advances inventory availability", async () => {
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

test("TC-0513 D4 equipment release rejects a non-cancelled event", async () => {
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

test("TC-1312 G5 AC1 cancelling releases every active reservation of the event, whatever the type, and no other", async () => {
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

test("TC-1313 G5 AC3 each released reservation is kept in the event's history with the reason, the time and who released it", async () => {
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

test("TC-1314 G5 AC1 only the event's current coordinator can release its equipment, and nothing is written when refused", async () => {
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

// J6 / SCRUM-155 AC3.
test("TC-2213 reserving the only open line arranges the request and tells the coordinator once", async () => {
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

test("TC-2214 reserving one of several open lines leaves the request Pending and tells nobody", async () => {
  const { service, transaction } = fixture({
    lines: [{ equipment_type: "AUDIO", quantity: 2 }, { equipment_type: "VISUAL", quantity: 1 }]
  });
  await service.reserve({ eventId: "event-1", equipmentType: "AUDIO", quantity: 2, userId: "tech-1", lineIndex: 0 });

  assert.equal(transaction.updated[0].data.status, "PENDING");
  assert.equal(notices(transaction).length, 0);
});

test("TC-2215 the last line reserved after another was refused: arranged, told once, to the current coordinator", async () => {
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

test("TC-2216 an event with no coordinator still has its equipment reserved, with nobody notified", async () => {
  const { service, transaction } = fixture({ event: null });
  const result = await service.reserve({ eventId: "event-1", equipmentType: "AUDIO", quantity: 2, userId: "tech-1" });

  assert.equal(result.status, "RESERVED");
  assert.equal(transaction.updated[0].data.status, "ARRANGED");
  assert.equal(notices(transaction).length, 0);
});
