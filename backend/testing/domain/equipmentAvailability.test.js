// G2 — frontend/src/domain/equipmentAvailability.mjs, the shared rule for whether enough equipment
// is free over an event's occupied window. Run by the backend's node --test.
import assert from "node:assert/strict";
import test from "node:test";

import { calculateEquipmentAvailability, equipmentWindowFromVenueBookings } from "../../../frontend/src/domain/equipmentAvailability.mjs";

const at = (time) => new Date(`2026-11-04T${time}:00Z`);
const check = (changes = {}) => calculateEquipmentAvailability({
  equipmentType: "AUDIO", windowStart: at("01:00"), windowEnd: at("09:00"), requestedQuantity: 2,
  inventory: { total_quantity: 5 }, ...changes
});
const record = (start, end, quantity, changes = {}) => ({ equipment_type: "audio", status: "RESERVED", start_datetime: start, end_datetime: end, quantity, ...changes });

test("TC-1053 [normal] F12 G2 the window spans every approved booking's occupied time, read from any date form", () => {
  const window = equipmentWindowFromVenueBookings([
    { status: "approved", occupied_start: at("02:00"), occupied_end: { toDate: () => at("05:00") } },
    { status: "APPROVED", start_datetime: "2026-11-04T01:00:00Z", end_datetime: Date.parse("2026-11-04T04:00:00Z") },
    { status: "HELD", occupied_start: at("00:00"), occupied_end: at("23:00") },
    { occupied_start: at("00:00"), occupied_end: at("23:00") }
  ]);
  assert.deepEqual(window, { windowStart: at("01:00"), windowEnd: at("05:00") });
});

test("TC-1202 [failure] G2 no approved booking, or one with an unreadable or backwards window, is refused", () => {
  assert.throws(() => equipmentWindowFromVenueBookings([{ status: "PENDING" }]), /approved venue booking is required/);
  for (const booking of [
    { occupied_start: "not a date", occupied_end: at("02:00") },
    { occupied_start: at("01:00"), occupied_end: {} },
    { occupied_start: at("03:00"), occupied_end: at("03:00") }
  ]) {
    assert.throws(() => equipmentWindowFromVenueBookings([{ status: "APPROVED", ...booking }]), /invalid occupied window/);
  }
});

test("TC-1203 [failure] G2 the type, window, quantity and held stock must all be valid", () => {
  assert.throws(() => check({ equipmentType: "" }), /Choose an equipment type/);
  assert.throws(() => check({ windowEnd: at("01:00") }), /valid availability window/);
  assert.throws(() => check({ windowStart: undefined }), /valid availability window/);
  assert.throws(() => check({ requestedQuantity: 0 }), /whole number greater than zero/);
  assert.throws(() => check({ requestedQuantity: "1.5" }), /whole number greater than zero/);
  assert.throws(() => check({ inventory: undefined }), /held quantity for AUDIO is missing or invalid/);
  assert.throws(() => check({ inventory: { total_quantity: -1 } }), /missing or invalid/);
});

test("TC-1204 [boundary] G2 with nothing else booked all held stock is free, and zero stock is a full shortfall", () => {
  assert.deepEqual(check(), {
    equipmentType: "AUDIO", heldQuantity: 5, reservedQuantity: 0, unavailableQuantity: 0,
    freeQuantity: 5, requestedQuantity: 2, shortfall: 0, available: true
  });
  const none = check({ inventory: { total_quantity: 0 } });
  assert.deepEqual([none.freeQuantity, none.shortfall, none.available], [0, 2, false]);
});

test("TC-1205 [conflict] G2 counts are real: the peak of overlapping reservations and unavailability decides", () => {
  const result = check({
    requestedQuantity: 3,
    reservations: [
      record(at("00:00"), at("03:00"), 2),
      record(at("02:00"), at("05:00"), 1, { status: "approved" }),
      record(at("08:00"), at("10:00"), 1)
    ],
    unavailability: [{ equipment_type: "AUDIO", start_datetime: at("02:30"), end_datetime: at("04:00"), quantity: 1 }]
  });
  // 02:30-03:00: 2 + 1 reserved and 1 out of use = 4 of 5 in use.
  assert.deepEqual([result.reservedQuantity, result.unavailableQuantity, result.freeQuantity, result.shortfall, result.available], [3, 1, 1, 2, false]);
});

test("TC-1206 [boundary] G2 records that touch the window, other types, released ones, returned stock and the event's own are ignored", () => {
  const result = check({
    eventId: "E1",
    reservations: [
      record(at("09:00"), at("10:00"), 5),
      record(at("00:00"), at("01:00"), 5),
      record(at("02:00"), at("03:00"), 5, { equipment_type: "VISUAL" }),
      record(at("02:00"), at("03:00"), 5, { status: "RELEASED" }),
      record(at("02:00"), at("03:00"), 5, { status: undefined }),
      record(at("02:00"), at("03:00"), 5, { event_id: "E1" }),
      record(at("02:00"), at("03:00"), 5, { equipment_type: undefined })
    ],
    unavailability: [
      { equipment_type: "AUDIO", status: "BACK_IN_USE", start_datetime: at("02:00"), end_datetime: at("03:00"), quantity: 5 },
      { equipment_type: "AUDIO", status: "unavailable", start_datetime: at("02:00"), end_datetime: at("03:00"), quantity: 1 }
    ]
  });
  assert.deepEqual([result.reservedQuantity, result.unavailableQuantity, result.freeQuantity], [0, 1, 4]);
});

test("TC-1207 [failure] G2 an active record with a broken window or quantity stops the check rather than guessing", () => {
  assert.throws(() => check({ reservations: [record(at("03:00"), at("02:00"), 1)] }), /invalid time window/);
  assert.throws(() => check({ reservations: [record(null, at("02:00"), 1)] }), /invalid time window/);
  assert.throws(() => check({ unavailability: [{ equipment_type: "AUDIO", start_datetime: at("02:00"), end_datetime: at("03:00"), quantity: 0 }] }), /invalid quantity/);
});
