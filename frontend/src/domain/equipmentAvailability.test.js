import {
  calculateEquipmentAvailability,
  equipmentWindowFromVenueBookings
} from "./equipmentAvailability";

const start = "2026-11-04T09:00:00+08:00";
const end = "2026-11-04T17:00:00+08:00";

describe("G2 pooled equipment availability", () => {
  const input = (changes = {}) => ({
    equipmentType: "AUDIO",
    windowStart: start,
    windowEnd: end,
    requestedQuantity: 4,
    inventory: { total_quantity: 12 },
    reservations: [],
    unavailability: [],
    ...changes
  });

  test("TC-290 held stock less overlapping reservations and unavailable quantity gives free stock", () => {
    const result = calculateEquipmentAvailability(input({
      reservations: [
        { equipment_type: "AUDIO", quantity: 3, status: "RESERVED", start_datetime: "2026-11-04T10:00:00+08:00", end_datetime: "2026-11-04T16:00:00+08:00" },
        { equipment_type: "AUDIO", quantity: 50, status: "RELEASED", start_datetime: start, end_datetime: end },
        { equipment_type: "VISUAL", quantity: 50, status: "RESERVED", start_datetime: start, end_datetime: end }
      ],
      unavailability: [
        { equipment_type: "AUDIO", quantity: 2, start_datetime: "2026-11-04T15:00:00+08:00", end_datetime: "2026-11-04T18:00:00+08:00" }
      ]
    }));

    expect(result).toEqual({
      equipmentType: "AUDIO",
      heldQuantity: 12,
      reservedQuantity: 3,
      unavailableQuantity: 2,
      freeQuantity: 7,
      requestedQuantity: 4,
      shortfall: 0,
      available: true
    });
  });

  test("TC-291 reports the shortfall as a numeric quantity", () => {
    const result = calculateEquipmentAvailability(input({
      requestedQuantity: 8,
      reservations: [{ equipment_type: "AUDIO", quantity: 5, status: "APPROVED", start_datetime: start, end_datetime: end }]
    }));
    expect(result.freeQuantity).toBe(7);
    expect(result.shortfall).toBe(1);
    expect(result.available).toBe(false);
  });

  test("TC-292 excludes windows that touch but do not overlap", () => {
    const result = calculateEquipmentAvailability(input({
      reservations: [{ equipment_type: "AUDIO", quantity: 12, status: "RESERVED", start_datetime: "2026-11-04T01:00:00+08:00", end_datetime: start }],
      unavailability: [{ equipment_type: "AUDIO", quantity: 12, start_datetime: end, end_datetime: "2026-11-04T18:00:00+08:00" }]
    }));
    expect(result.freeQuantity).toBe(12);
  });

  test("TC-293 excludes the event's existing reservation from its own availability check", () => {
    const result = calculateEquipmentAvailability(input({
      eventId: "evt-1",
      reservations: [{ event_id: "evt-1", equipment_type: "AUDIO", quantity: 4, status: "RESERVED", start_datetime: start, end_datetime: end }]
    }));
    expect(result.reservedQuantity).toBe(0);
    expect(result.freeQuantity).toBe(12);
  });

  test("TC-294 rejects invalid quantity and window inputs instead of returning a success-shaped result", () => {
    expect(() => calculateEquipmentAvailability(input({ requestedQuantity: 1.5 }))).toThrow(/whole number greater than zero/i);
    expect(() => calculateEquipmentAvailability(input({ windowEnd: start }))).toThrow(/valid availability window/i);
    expect(() => calculateEquipmentAvailability(input({ inventory: {} }))).toThrow(/held quantity.*missing or invalid/i);
    expect(() => calculateEquipmentAvailability(input({
      reservations: [{ equipment_type: "AUDIO", quantity: 4, status: "RESERVED" }]
    }))).toThrow(/active AUDIO availability record has an invalid time window/i);
  });

  test("TC-299 takes setup and teardown from all approved venue occupied windows", () => {
    const window = equipmentWindowFromVenueBookings([
      {
        status: "APPROVED",
        occupied_start: "2026-11-04T08:30:00+08:00",
        occupied_end: "2026-11-04T17:15:00+08:00"
      },
      {
        status: "APPROVED",
        occupied_start: "2026-11-04T08:45:00+08:00",
        occupied_end: "2026-11-04T17:30:00+08:00"
      }
    ]);
    expect(window.windowStart.toISOString()).toBe("2026-11-04T00:30:00.000Z");
    expect(window.windowEnd.toISOString()).toBe("2026-11-04T09:30:00.000Z");
  });

  test("TC-302 equipment is available for a future event when the prior use ends first", () => {
    const result = calculateEquipmentAvailability(input({
      windowStart: "2026-11-04T13:00:00+08:00",
      windowEnd: "2026-11-04T17:00:00+08:00",
      reservations: [{
        equipment_type: "AUDIO",
        quantity: 12,
        status: "RESERVED",
        start_datetime: "2026-11-04T09:00:00+08:00",
        end_datetime: "2026-11-04T13:00:00+08:00"
      }]
    }));
    expect(result.freeQuantity).toBe(12);
    expect(result.available).toBe(true);
  });

  test("TC-306 only concurrent commitments reduce quantity throughout the full window", () => {
    const result = calculateEquipmentAvailability(input({
      requestedQuantity: 3,
      inventory: { total_quantity: 10 },
      reservations: [
        {
          equipment_type: "AUDIO",
          quantity: 7,
          status: "RESERVED",
          start_datetime: start,
          end_datetime: "2026-11-04T12:00:00+08:00"
        },
        {
          equipment_type: "AUDIO",
          quantity: 7,
          status: "RESERVED",
          start_datetime: "2026-11-04T12:00:00+08:00",
          end_datetime: end
        }
      ]
    }));
    expect(result.reservedQuantity).toBe(7);
    expect(result.freeQuantity).toBe(3);
    expect(result.available).toBe(true);
  });

  test("an approved venue booking is required to calculate a buffered equipment window", () => {
    expect(() => equipmentWindowFromVenueBookings([])).toThrow(/approved venue booking is required/i);
    expect(() => equipmentWindowFromVenueBookings([{
      status: "APPROVED",
      occupied_start: "not a date",
      occupied_end: "2026-11-04T17:00:00+08:00"
    }])).toThrow(/invalid occupied window/i);
  });
});
