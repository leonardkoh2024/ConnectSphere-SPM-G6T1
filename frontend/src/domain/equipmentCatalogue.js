// G2 / G3 / G5 — what Technical Support holds, what is reserved and when.
// Plain functions over the catalogue the equipment service returns; no React,
// no Firebase.

import { EQUIPMENT_TYPES } from "./events";

export const RESERVATION_STATE = {
  UPCOMING: "UPCOMING",
  IN_USE: "IN_USE",
  COMPLETED: "COMPLETED",
  RELEASED: "RELEASED"
};

export const RESERVATION_STATE_LABEL = {
  UPCOMING: "Upcoming",
  IN_USE: "In use",
  COMPLETED: "Completed",
  RELEASED: "Released"
};

const time = (value) => {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const upper = (value) => String(value || "").toUpperCase();

// RESERVED is what G3 writes; APPROVED is what older records carry. Both hold stock.
const isActiveReservation = (record) => ["RESERVED", "APPROVED"].includes(upper(record.status));
const isActiveUnavailability = (record) => upper(record.status || "UNAVAILABLE") === "UNAVAILABLE";

// Windows are half-open, as for venue bookings: a window ending now is over.
const coversNow = (record, now) => {
  const start = time(record.start_datetime);
  const end = time(record.end_datetime);
  return start !== null && end !== null && start <= now && now < end;
};

export const reservationState = (reservation, now = new Date()) => {
  if (!isActiveReservation(reservation)) return RESERVATION_STATE.RELEASED;
  const at = time(now);
  if (time(reservation.end_datetime) <= at) return RESERVATION_STATE.COMPLETED;
  if (time(reservation.start_datetime) <= at) return RESERVATION_STATE.IN_USE;
  return RESERVATION_STATE.UPCOMING;
};

const quantityOf = (record) => {
  const quantity = Number(record.quantity);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
};

// One row per equipment type: the standard types in their usual order, then any
// other type that has stock recorded. Held and free are null when no stock is
// recorded, so the screen can say so instead of showing a zero.
export const catalogueRows = ({ inventory = [], reservations = [], unavailability = [], now = new Date() }) => {
  const at = time(now);
  const held = new Map(inventory.map((item) => [upper(item.equipment_type), item.total_quantity]));
  const types = [...EQUIPMENT_TYPES, ...[...held.keys()].filter((type) => !EQUIPMENT_TYPES.includes(type))];
  return types.map((equipmentType) => {
    const ofType = (record) => upper(record.equipment_type) === equipmentType;
    const activeReservations = reservations.filter((record) => ofType(record) && isActiveReservation(record));
    const reservedNow = activeReservations.filter((record) => coversNow(record, at))
      .reduce((total, record) => total + quantityOf(record), 0);
    const unavailableNow = unavailability
      .filter((record) => ofType(record) && isActiveUnavailability(record) && coversNow(record, at))
      .reduce((total, record) => total + quantityOf(record), 0);
    const heldQuantity = Number(held.get(equipmentType));
    const recorded = held.has(equipmentType) && Number.isInteger(heldQuantity) && heldQuantity >= 0;
    return {
      equipmentType,
      held: recorded ? heldQuantity : null,
      reservedNow,
      unavailableNow,
      freeNow: recorded ? Math.max(0, heldQuantity - reservedNow - unavailableNow) : null,
      upcoming: activeReservations.filter((record) => time(record.start_datetime) > at).length
    };
  });
};

// Current (upcoming or in use) soonest first; past (completed or released)
// latest first. `onlyReservedBy` keeps just one staff member's reservations.
export const reservationGroups = (reservations = [], { now = new Date(), onlyReservedBy = null } = {}) => {
  const items = (reservations || [])
    .filter((item) => !onlyReservedBy || item.reserved_by === onlyReservedBy)
    .map((item) => ({ ...item, state: reservationState(item, now) }));
  const byStart = (left, right) => (time(left.start_datetime) ?? 0) - (time(right.start_datetime) ?? 0);
  const isCurrent = (item) => [RESERVATION_STATE.UPCOMING, RESERVATION_STATE.IN_USE].includes(item.state);
  return {
    current: items.filter(isCurrent).sort(byStart),
    past: items.filter((item) => !isCurrent(item)).sort((left, right) => byStart(right, left))
  };
};
