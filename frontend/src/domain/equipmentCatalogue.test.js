// G2 / G3 / G5 — Technical Support's equipment catalogue and reservation list,
// as plain functions. TC-393 to TC-395 in docs/test-cases.md.

import {
  RESERVATION_STATE,
  RESERVATION_STATE_LABEL,
  catalogueRows,
  reservationGroups,
  reservationState
} from "./equipmentCatalogue";
import { EQUIPMENT_TYPES } from "./events";

const NOW = new Date("2026-11-04T03:00:00.000Z");
const reservation = (overrides) => ({
  id: "r", event_id: "event-1", equipment_type: "AUDIO", quantity: 2, status: "RESERVED",
  start_datetime: "2026-11-04T01:00:00.000Z", end_datetime: "2026-11-04T09:00:00.000Z",
  ...overrides
});

test("TC-393 a reservation is upcoming, in use, completed or released", () => {
  expect(reservationState(reservation({ start_datetime: "2026-11-05T01:00:00.000Z", end_datetime: "2026-11-05T09:00:00.000Z" }), NOW))
    .toBe(RESERVATION_STATE.UPCOMING);
  expect(reservationState(reservation({}), NOW)).toBe(RESERVATION_STATE.IN_USE);
  // Windows are half-open: a reservation ending now is over, one starting now is in use.
  expect(reservationState(reservation({ end_datetime: NOW.toISOString() }), NOW)).toBe(RESERVATION_STATE.COMPLETED);
  expect(reservationState(reservation({ start_datetime: NOW.toISOString() }), NOW)).toBe(RESERVATION_STATE.IN_USE);
  // Released wins over the window, whatever the time.
  expect(reservationState(reservation({ status: "RELEASED" }), NOW)).toBe(RESERVATION_STATE.RELEASED);
  expect(reservationState(reservation({ status: "released", start_datetime: "2026-12-01T00:00:00.000Z", end_datetime: "2026-12-02T00:00:00.000Z" }), NOW))
    .toBe(RESERVATION_STATE.RELEASED);
  // An older reservation recorded as APPROVED is still active.
  expect(reservationState(reservation({ status: "APPROVED" }), NOW)).toBe(RESERVATION_STATE.IN_USE);
  expect(RESERVATION_STATE_LABEL).toEqual({ UPCOMING: "Upcoming", IN_USE: "In use", COMPLETED: "Completed", RELEASED: "Released" });
});

test("TC-394 the catalogue shows, per type, what is held, reserved and unavailable now, what is free, and what is coming up", () => {
  const rows = catalogueRows({
    inventory: [
      { equipment_type: "AUDIO", total_quantity: 10 },
      { equipment_type: "VISUAL", total_quantity: 4 },
      { equipment_type: "LIGHTING", total_quantity: 3 }
    ],
    reservations: [
      reservation({ id: "in-use", quantity: 3 }),
      reservation({ id: "in-use-2", quantity: 1, event_id: "event-2" }),
      reservation({ id: "later", quantity: 4, start_datetime: "2026-11-06T01:00:00.000Z", end_datetime: "2026-11-06T09:00:00.000Z" }),
      reservation({ id: "released", quantity: 5, status: "RELEASED" }),
      reservation({ id: "done", quantity: 5, start_datetime: "2026-11-01T01:00:00.000Z", end_datetime: "2026-11-01T09:00:00.000Z" }),
      // More reserved than held is shown as it is, but free never goes below zero.
      reservation({ id: "lighting", equipment_type: "LIGHTING", quantity: 4 })
    ],
    unavailability: [
      { equipment_type: "AUDIO", quantity: 2, start_datetime: "2026-11-04T00:00:00.000Z", end_datetime: "2026-11-05T00:00:00.000Z" },
      { equipment_type: "AUDIO", quantity: 9, status: "AVAILABLE", start_datetime: "2026-11-04T00:00:00.000Z", end_datetime: "2026-11-05T00:00:00.000Z" },
      { equipment_type: "VISUAL", quantity: 1, start_datetime: "2026-11-10T00:00:00.000Z", end_datetime: "2026-11-11T00:00:00.000Z" }
    ],
    now: NOW
  });

  // Every equipment type is listed, in the catalogue's order, even with no stock recorded.
  expect(rows.map((row) => row.equipmentType)).toEqual(EQUIPMENT_TYPES);
  expect(rows.find((row) => row.equipmentType === "AUDIO")).toEqual({
    equipmentType: "AUDIO", held: 10, reservedNow: 4, unavailableNow: 2, freeNow: 4, upcoming: 1
  });
  expect(rows.find((row) => row.equipmentType === "VISUAL")).toEqual({
    equipmentType: "VISUAL", held: 4, reservedNow: 0, unavailableNow: 0, freeNow: 4, upcoming: 0
  });
  expect(rows.find((row) => row.equipmentType === "LIGHTING")).toMatchObject({ held: 3, reservedNow: 4, freeNow: 0 });
  // No inventory record: held and free are unknown, not zero.
  expect(rows.find((row) => row.equipmentType === "STAGING")).toEqual({
    equipmentType: "STAGING", held: null, reservedNow: 0, unavailableNow: 0, freeNow: null, upcoming: 0
  });

  // A type held but not in the standard list is still shown, after the standard ones.
  const extra = catalogueRows({ inventory: [{ equipment_type: "PROJECTOR_SCREEN", total_quantity: 2 }], reservations: [], unavailability: [], now: NOW });
  expect(extra.map((row) => row.equipmentType)).toEqual([...EQUIPMENT_TYPES, "PROJECTOR_SCREEN"]);
  expect(catalogueRows({ now: NOW })).toHaveLength(EQUIPMENT_TYPES.length);
});

test("TC-395 reservations split into current (soonest first) and past (latest first), optionally only the caller's", () => {
  const all = [
    reservation({ id: "in-use", reserved_by: "tech-1" }),
    reservation({ id: "next-week", reserved_by: "tech-2", start_datetime: "2026-11-11T01:00:00.000Z", end_datetime: "2026-11-11T09:00:00.000Z" }),
    reservation({ id: "tomorrow", reserved_by: "tech-1", start_datetime: "2026-11-05T01:00:00.000Z", end_datetime: "2026-11-05T09:00:00.000Z" }),
    reservation({ id: "last-month", reserved_by: "tech-1", start_datetime: "2026-10-01T01:00:00.000Z", end_datetime: "2026-10-01T09:00:00.000Z" }),
    reservation({ id: "released", reserved_by: "tech-2", status: "RELEASED", start_datetime: "2026-11-20T01:00:00.000Z", end_datetime: "2026-11-20T09:00:00.000Z" }),
    reservation({ id: "yesterday", reserved_by: "tech-2", start_datetime: "2026-11-03T01:00:00.000Z", end_datetime: "2026-11-03T09:00:00.000Z" })
  ];

  const groups = reservationGroups(all, { now: NOW });
  expect(groups.current.map((item) => [item.id, item.state])).toEqual([
    ["in-use", "IN_USE"], ["tomorrow", "UPCOMING"], ["next-week", "UPCOMING"]
  ]);
  expect(groups.past.map((item) => [item.id, item.state])).toEqual([
    ["released", "RELEASED"], ["yesterday", "COMPLETED"], ["last-month", "COMPLETED"]
  ]);

  const mine = reservationGroups(all, { now: NOW, onlyReservedBy: "tech-1" });
  expect(mine.current.map((item) => item.id)).toEqual(["in-use", "tomorrow"]);
  expect(mine.past.map((item) => item.id)).toEqual(["last-month"]);

  expect(reservationGroups(undefined, { now: NOW })).toEqual({ current: [], past: [] });
});
