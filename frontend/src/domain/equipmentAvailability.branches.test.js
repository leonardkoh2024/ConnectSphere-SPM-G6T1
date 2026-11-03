// G2 pooled equipment availability — the input shapes and fallbacks the main suite leaves out:
// Firestore timestamps and epoch numbers as times, records with missing fields, and omitted arguments.

import {
  calculateEquipmentAvailability,
  equipmentWindowFromVenueBookings
} from "./equipmentAvailability.mjs";

const START = "2026-11-04T09:00:00Z";
const END = "2026-11-04T17:00:00Z";
const base = {
  equipmentType: "PROJECTOR",
  windowStart: START,
  windowEnd: END,
  requestedQuantity: 1,
  inventory: { total_quantity: 3 }
};
const record = (overrides = {}) => ({
  equipment_type: "PROJECTOR",
  start_datetime: "2026-11-04T10:00:00Z",
  end_datetime: "2026-11-04T12:00:00Z",
  quantity: 1,
  ...overrides
});

describe("G2 equipment availability inputs", () => {
  test("TC-2701 a Date, a Firestore timestamp and an epoch number all work as window times", () => {
    const result = calculateEquipmentAvailability({
      ...base,
      windowStart: new Date(START),
      windowEnd: { toDate: () => new Date(END) }
    });
    expect(result.freeQuantity).toBe(3);
    expect(calculateEquipmentAvailability({ ...base, windowStart: Date.parse(START) }).available).toBe(true);
  });

  test("TC-2702 a window time that is not a date is rejected, whatever its type", () => {
    const message = /valid availability window/i;
    expect(() => calculateEquipmentAvailability({ ...base, windowStart: "not a date" })).toThrow(message);
    expect(() => calculateEquipmentAvailability({ ...base, windowStart: null })).toThrow(message);
    expect(() => calculateEquipmentAvailability({ ...base, windowEnd: {} })).toThrow(message);
  });

  test("TC-2703 an equipment type is required", () => {
    expect(() => calculateEquipmentAvailability({ ...base, equipmentType: "" })).toThrow(/choose an equipment type/i);
  });

  test("TC-2704 omitting inventory is reported as a missing held quantity", () => {
    const { inventory, ...withoutInventory } = base;
    expect(inventory.total_quantity).toBe(3);
    expect(() => calculateEquipmentAvailability(withoutInventory)).toThrow(/held quantity/i);
  });

  test("TC-2705 reservations and unavailability may be left out altogether", () => {
    const result = calculateEquipmentAvailability(base);
    expect(result).toMatchObject({ reservedQuantity: 0, unavailableQuantity: 0, freeQuantity: 3 });
  });

  test("TC-2706 records with no equipment type, or a reservation with no status, are not counted", () => {
    const result = calculateEquipmentAvailability({
      ...base,
      reservations: [record({ equipment_type: undefined, status: "RESERVED" }), record()],
      unavailability: [record({ equipment_type: undefined })]
    });
    expect(result).toMatchObject({ reservedQuantity: 0, unavailableQuantity: 0 });
  });

  test("TC-2707 an unavailability record with no status counts as unavailable", () => {
    const result = calculateEquipmentAvailability({ ...base, unavailability: [record({ quantity: 2 })] });
    expect(result).toMatchObject({ unavailableQuantity: 2, freeQuantity: 1 });
  });

  test("TC-2708 an active reservation with an invalid quantity is rejected", () => {
    expect(() => calculateEquipmentAvailability({
      ...base,
      reservations: [record({ status: "RESERVED", quantity: 0 })]
    })).toThrow(/invalid quantity/i);
  });
});

describe("G2 equipment window from venue bookings", () => {
  test("TC-2709 a booking with no status is not an approved booking", () => {
    expect(() => equipmentWindowFromVenueBookings([{ start_datetime: START, end_datetime: END }]))
      .toThrow(/approved venue booking is required/i);
  });

  test("TC-2710 an approved booking falls back to its start and end when it has no occupied window", () => {
    const { windowStart, windowEnd } = equipmentWindowFromVenueBookings([
      { status: "APPROVED", start_datetime: START, end_datetime: END }
    ]);
    expect(windowStart.toISOString()).toBe("2026-11-04T09:00:00.000Z");
    expect(windowEnd.toISOString()).toBe("2026-11-04T17:00:00.000Z");
  });

  test("TC-2711 an approved booking whose window ends before it starts is rejected", () => {
    expect(() => equipmentWindowFromVenueBookings([
      { status: "APPROVED", occupied_start: END, occupied_end: START }
    ])).toThrow(/invalid occupied window/i);
  });
});
