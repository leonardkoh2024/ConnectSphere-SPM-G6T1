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
            ? { status: "ARRANGED", lines: [{ reservation_id: "reservation-1", fulfillment_status: "RESERVED" }] }
            : { status: "PENDING", lines })
        };
      }
      if (reference.path === "equipment_inventory/AUDIO") {
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
        return { docs: reservations.map((data) => ({ data: () => data })) };
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
