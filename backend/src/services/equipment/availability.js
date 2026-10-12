import {
  calculateEquipmentAvailability as calculateAvailability,
  equipmentWindowFromVenueBookings as getEquipmentWindow
} from "../../../../frontend/src/domain/equipmentAvailability.mjs";

const EQUIPMENT_TYPES = ["AUDIO", "VISUAL", "LIGHTING", "STAGING", "FURNITURE", "OTHERS"];

export class EquipmentValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "EquipmentValidationError";
    this.statusCode = 400;
  }
}

export class EquipmentNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "EquipmentNotFoundError";
    this.statusCode = 404;
  }
}

export class EquipmentConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "EquipmentConflictError";
    this.statusCode = 409;
  }
}

export const assertEquipmentType = (equipmentType) => {
  if (!EQUIPMENT_TYPES.includes(equipmentType)) {
    throw new EquipmentValidationError("Choose a supported equipment type.");
  }
};

export const equipmentWindowFromVenueBookings = (bookings) => {
  try {
    const { windowStart, windowEnd } = getEquipmentWindow(bookings);
    return { start: windowStart, end: windowEnd };
  } catch (error) {
    throw new EquipmentConflictError(error.message);
  }
};

export const calculateEquipmentAvailability = (input) => {
  try {
    return calculateAvailability({
      equipmentType: input.equipmentType,
      windowStart: input.start,
      windowEnd: input.end,
      requestedQuantity: input.requestedQuantity,
      eventId: input.eventId,
      inventory: input.inventory,
      reservations: input.reservations,
      unavailability: input.unavailability
    });
  } catch (error) {
    throw new EquipmentValidationError(error.message);
  }
};
