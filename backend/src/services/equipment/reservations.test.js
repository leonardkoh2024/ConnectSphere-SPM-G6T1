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

const fixture = ({ reservations = [], unavailable = [], withReservationRequest = false } = {}) => {
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
            : { status: "PENDING", lines: [{ equipment_type: "AUDIO", quantity: 2 }] })
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
  assert.equal(transaction.created.length, 2);
  assert.equal(transaction.created[1].data.action, "LINE_RESERVED");
  assert.equal(transaction.created[1].data.actor_id, "tech-1");
  assert.equal(transaction.updated[0].reference.path, "equipment_requests/event-1");
  assert.equal(transaction.updated[0].data.lines[0].fulfillment_status, "RESERVED");
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
