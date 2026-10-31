// G2 / G3 / G5 — Technical Support's equipment catalogue and reservation list,
// as plain functions.

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

test("TC-1217 a reservation is upcoming, in use, completed or released", () => {
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
  // An active reservation with a missing or unreadable window is not treated as
  // over (new Date(null) is 1970): it stays current, where staff will see it.
  expect(reservationState(reservation({ start_datetime: null, end_datetime: null }), NOW)).toBe(RESERVATION_STATE.UPCOMING);
  expect(reservationState(reservation({ start_datetime: "", end_datetime: "not a date" }), NOW)).toBe(RESERVATION_STATE.UPCOMING);
  expect(catalogueRows({
    inventory: [{ equipment_type: "AUDIO", total_quantity: 5 }],
    reservations: [reservation({ start_datetime: null, end_datetime: null })],
    now: NOW
  })[0]).toMatchObject({ reservedNow: 0, freeNow: 5, upcoming: 0 });
  expect(RESERVATION_STATE_LABEL).toEqual({ UPCOMING: "Upcoming", IN_USE: "In use", COMPLETED: "Completed", RELEASED: "Released" });
});

test("TC-1218 the catalogue shows, per type, what is held, reserved and unavailable now, what is free, and what is coming up", () => {
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

  // Windows are half-open: stock whose reservation or unavailability ends now is
  // free now; one starting now is not.
  const edges = catalogueRows({
    inventory: [{ equipment_type: "AUDIO", total_quantity: 10 }],
    reservations: [
      reservation({ id: "ends-now", quantity: 3, end_datetime: NOW.toISOString() }),
      reservation({ id: "starts-now", quantity: 1, start_datetime: NOW.toISOString() })
    ],
    unavailability: [{ equipment_type: "AUDIO", quantity: 2, start_datetime: "2026-11-04T00:00:00.000Z", end_datetime: NOW.toISOString() }],
    now: NOW
  })[0];
  expect(edges).toMatchObject({ reservedNow: 1, unavailableNow: 0, freeNow: 9 });
});

test("TC-1219 reservations split into current (soonest first) and past (latest first), optionally only the caller's", () => {
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

  // G6 added the `reassess` group (reservations flagged by I3), so an empty list now has three.
  expect(reservationGroups(undefined, { now: NOW })).toEqual({ reassess: [], current: [], past: [] });
});

// G6 / SCRUM-138 — reservations I3 flagged come out of Current into their own group.
describe("G6 reservations that wait for reassessment", () => {
  const flagged = (overrides) => reservation({ rerequest_required: true, rerequest_reason: "Event date changed", ...overrides });

  test("G6-TC14 AC1 a flagged live reservation is listed to reassess, soonest first, and not again under Current", () => {
    const all = [
      reservation({ id: "plain-later", start_datetime: "2026-11-12T01:00:00.000Z", end_datetime: "2026-11-12T09:00:00.000Z" }),
      flagged({ id: "flag-later", start_datetime: "2026-11-11T01:00:00.000Z", end_datetime: "2026-11-11T09:00:00.000Z" }),
      flagged({ id: "flag-now" }),
      reservation({ id: "plain-now" })
    ];
    const groups = reservationGroups(all, { now: NOW });

    expect(groups.reassess.map((item) => item.id)).toEqual(["flag-now", "flag-later"]);
    expect(groups.current.map((item) => item.id)).toEqual(["plain-now", "plain-later"]);
    expect(groups.past).toEqual([]);
    // It is still the same reservation: its state is that of any other.
    expect(groups.reassess[0].state).toBe("IN_USE");
  });

  test("G6-TC15 AC2 a flagged reservation is still active, so it keeps counting against free stock", () => {
    const rows = catalogueRows({
      inventory: [{ equipment_type: "AUDIO", total_quantity: 10 }],
      reservations: [flagged({ id: "flag-now", quantity: 4 })],
      now: NOW
    });
    const audio = rows.find((row) => row.equipmentType === "AUDIO");
    expect([audio.reservedNow, audio.freeNow]).toEqual([4, 6]);
  });

  test("G6-TC16 AC3 only a live reservation can be reassessed: released and finished ones stay in Past, whatever their flag", () => {
    const groups = reservationGroups([
      flagged({ id: "released", status: "RELEASED" }),
      flagged({ id: "finished", start_datetime: "2026-11-01T01:00:00.000Z", end_datetime: "2026-11-01T09:00:00.000Z" }),
      flagged({ id: "unflagged-false", rerequest_required: false }),
      flagged({ id: "flag-as-text", rerequest_required: "true" })
    ], { now: NOW });

    expect(groups.reassess).toEqual([]);
    expect(groups.past.map((item) => item.id).sort()).toEqual(["finished", "released"]);
    expect(groups.current.map((item) => item.id).sort()).toEqual(["flag-as-text", "unflagged-false"]);
  });

  test("G6-TC17 the 'only mine' filter applies to reservations to reassess too", () => {
    const groups = reservationGroups([
      flagged({ id: "mine", reserved_by: "tech-1" }),
      flagged({ id: "theirs", reserved_by: "tech-2" })
    ], { now: NOW, onlyReservedBy: "tech-1" });
    expect(groups.reassess.map((item) => item.id)).toEqual(["mine"]);
  });
});

describe("G2 / G5 catalogue edges", () => {
  test("TC-1220 [boundary] with nothing recorded every standard type reads not recorded, and nothing is reserved", () => {
    const rows = catalogueRows({});
    expect(rows.map((row) => row.equipmentType)).toEqual(EQUIPMENT_TYPES);
    rows.forEach((row) => expect(row).toMatchObject({ held: null, freeNow: null, reservedNow: 0, unavailableNow: 0, upcoming: 0 }));
    expect(reservationGroups()).toEqual({ reassess: [], current: [], past: [] });
    expect(reservationGroups(null)).toEqual({ reassess: [], current: [], past: [] });
  });

  test("TC-1221 [boundary] an unreadable quantity holds nothing, a record without a type matches none, and invalid stock reads not recorded", () => {
    const rows = catalogueRows({
      inventory: [{ equipment_type: "AUDIO", total_quantity: 5 }, { equipment_type: "VISUAL", total_quantity: -1 }, { total_quantity: 3 }],
      reservations: [reservation({ quantity: "lots" }), reservation({ quantity: 1.5 }), reservation({ equipment_type: undefined })],
      unavailability: [{ equipment_type: "AUDIO", quantity: 1, start_datetime: "2026-11-04T01:00:00.000Z", end_datetime: "2026-11-04T09:00:00.000Z" }],
      now: NOW
    });
    expect(rows.find((row) => row.equipmentType === "AUDIO")).toMatchObject({ held: 5, reservedNow: 0, unavailableNow: 1, freeNow: 4 });
    expect(rows.find((row) => row.equipmentType === "VISUAL")).toMatchObject({ held: null, freeNow: null });
    // A stock row with no type is listed under an empty name after the standard types.
    expect(rows[rows.length - 1]).toMatchObject({ equipmentType: "", held: 3 });
  });

  test("TC-1222 [boundary] state is judged against the current time when none is given; an undated reservation sorts as earliest", () => {
    expect(reservationState(reservation({ start_datetime: "2999-01-01T00:00:00.000Z", end_datetime: "2999-01-02T00:00:00.000Z" })))
      .toBe(RESERVATION_STATE.UPCOMING);
    const groups = reservationGroups([
      reservation({ id: "dated", start_datetime: "2026-11-05T01:00:00.000Z", end_datetime: "2026-11-05T09:00:00.000Z" }),
      reservation({ id: "undated", start_datetime: null, end_datetime: null }),
      reservation({ id: "undated-2", start_datetime: "", end_datetime: "" })
    ], { now: NOW });
    expect(groups.current.map((item) => item.id)).toEqual(["undated", "undated-2", "dated"]);
    expect(reservationGroups([reservation({ start_datetime: "2020-01-01T00:00:00.000Z", end_datetime: "2020-01-02T00:00:00.000Z" })])).toMatchObject({ past: [expect.objectContaining({ state: RESERVATION_STATE.COMPLETED })] });
  });
});

describe("G2 / G5 catalogue edges", () => {
  test("TC-1220 [boundary] with nothing recorded every standard type reads not recorded, and nothing is reserved", () => {
    const rows = catalogueRows({});
    expect(rows.map((row) => row.equipmentType)).toEqual(EQUIPMENT_TYPES);
    rows.forEach((row) => expect(row).toMatchObject({ held: null, freeNow: null, reservedNow: 0, unavailableNow: 0, upcoming: 0 }));
    expect(reservationGroups()).toEqual({ current: [], past: [] });
    expect(reservationGroups(null)).toEqual({ current: [], past: [] });
  });

  test("TC-1221 [boundary] an unreadable quantity holds nothing, a record without a type matches none, and invalid stock reads not recorded", () => {
    const rows = catalogueRows({
      inventory: [{ equipment_type: "AUDIO", total_quantity: 5 }, { equipment_type: "VISUAL", total_quantity: -1 }, { total_quantity: 3 }],
      reservations: [reservation({ quantity: "lots" }), reservation({ quantity: 1.5 }), reservation({ equipment_type: undefined })],
      unavailability: [{ equipment_type: "AUDIO", quantity: 1, start_datetime: "2026-11-04T01:00:00.000Z", end_datetime: "2026-11-04T09:00:00.000Z" }],
      now: NOW
    });
    expect(rows.find((row) => row.equipmentType === "AUDIO")).toMatchObject({ held: 5, reservedNow: 0, unavailableNow: 1, freeNow: 4 });
    expect(rows.find((row) => row.equipmentType === "VISUAL")).toMatchObject({ held: null, freeNow: null });
    // A stock row with no type is listed under an empty name after the standard types.
    expect(rows[rows.length - 1]).toMatchObject({ equipmentType: "", held: 3 });
  });

  test("TC-1222 [boundary] state is judged against the current time when none is given; an undated reservation sorts as earliest", () => {
    expect(reservationState(reservation({ start_datetime: "2999-01-01T00:00:00.000Z", end_datetime: "2999-01-02T00:00:00.000Z" })))
      .toBe(RESERVATION_STATE.UPCOMING);
    const groups = reservationGroups([
      reservation({ id: "dated", start_datetime: "2026-11-05T01:00:00.000Z", end_datetime: "2026-11-05T09:00:00.000Z" }),
      reservation({ id: "undated", start_datetime: null, end_datetime: null }),
      reservation({ id: "undated-2", start_datetime: "", end_datetime: "" })
    ], { now: NOW });
    expect(groups.current.map((item) => item.id)).toEqual(["undated", "undated-2", "dated"]);
    expect(reservationGroups([reservation({ start_datetime: "2020-01-01T00:00:00.000Z", end_datetime: "2020-01-02T00:00:00.000Z" })])).toMatchObject({ past: [expect.objectContaining({ state: RESERVATION_STATE.COMPLETED })] });
  });
});
