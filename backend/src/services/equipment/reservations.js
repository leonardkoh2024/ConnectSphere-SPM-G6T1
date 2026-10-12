import {
  calculateEquipmentAvailability,
  EquipmentConflictError,
  EquipmentNotFoundError,
  EquipmentValidationError,
  equipmentWindowFromVenueBookings,
  assertEquipmentType
} from "./availability.js";

const revisionOf = (inventory) => {
  const revision = inventory.availability_revision == null ? 0 : Number(inventory.availability_revision);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new EquipmentValidationError("The equipment inventory revision is invalid.");
  }
  return revision;
};

export const createEquipmentReservations = ({ firestore, serverTimestamp, getApprovedEventBookings }) => {
  const reserve = async ({ eventId, equipmentType, quantity, userId }) => {
    if (typeof eventId !== "string" || !eventId.trim()) {
      throw new EquipmentValidationError("Choose an event before reserving equipment.");
    }
    assertEquipmentType(equipmentType);
    const requested = Number(quantity);
    if (!Number.isInteger(requested) || requested < 1) {
      throw new EquipmentValidationError("Quantity must be a whole number greater than zero.");
    }

    const requestRef = firestore.collection("equipment_requests").doc(eventId);
    const inventoryRef = firestore.collection("equipment_inventory").doc(equipmentType);
    const reservationQuery = firestore.collection("equipment_reservations")
      .where("equipment_type", "==", equipmentType);
    const unavailableQuery = firestore.collection("equipment_unavailability")
      .where("equipment_type", "==", equipmentType);
    return firestore.runTransaction(async (transaction) => {
      const [requestSnapshot, inventorySnapshot, reservationSnapshot, unavailableSnapshot, bookings] =
        await Promise.all([
          transaction.get(requestRef),
          transaction.get(inventoryRef),
          transaction.get(reservationQuery),
          transaction.get(unavailableQuery),
          getApprovedEventBookings({ firestore, transaction, eventId })
        ]);
      if (!requestSnapshot.exists || requestSnapshot.data().status !== "PENDING") {
        throw new EquipmentConflictError("This event no longer has a Pending equipment request.");
      }
      const requestLine = requestSnapshot.data().lines?.find((line) => line.equipment_type === equipmentType);
      if (!requestLine) throw new EquipmentConflictError("This equipment type is not in the event's request.");
      if (!inventorySnapshot.exists) {
        throw new EquipmentNotFoundError(`No held inventory is recorded for ${equipmentType.replaceAll("_", " ")}.`);
      }
      const inventory = inventorySnapshot.data();
      const revision = revisionOf(inventory);
      const reservations = reservationSnapshot.docs.map((item) => item.data());
      const existingReservation = reservations.find((reservation) =>
        reservation.event_id === eventId
        && ["RESERVED", "APPROVED"].includes(String(reservation.status || "").toUpperCase())
      );
      if (existingReservation) {
        throw new EquipmentConflictError(
          "This equipment is already reserved for the event. Release the existing reservation first."
        );
      }

      const window = equipmentWindowFromVenueBookings(bookings);
      const result = calculateEquipmentAvailability({
        equipmentType,
        start: window.start,
        end: window.end,
        requestedQuantity: requested,
        eventId,
        inventory,
        reservations,
        unavailability: unavailableSnapshot.docs.map((item) => item.data())
      });
      if (!result.available) {
        throw new EquipmentConflictError(
          `Requested quantity unavailable for the required time period: ${result.freeQuantity} free, `
          + `${result.shortfall} more needed.`
        );
      }

      const reservationRef = firestore.collection("equipment_reservations").doc();
      const now = serverTimestamp();
      const reservation = {
        reservation_id: reservationRef.id,
        event_id: eventId,
        equipment_type: equipmentType,
        quantity: requested,
        start_datetime: window.start,
        end_datetime: window.end,
        status: "RESERVED",
        reserved_by: userId,
        created_at: now,
        updated_at: now,
        released_at: null,
        released_by: null,
        release_reason: null
      };
      transaction.create(reservationRef, reservation);
      transaction.update(inventoryRef, {
        availability_revision: revision + 1,
        updated_at: now
      });
      return { id: reservationRef.id, ...reservation };
    });
  };

  const release = async ({ reservationId, reason, userId }) => {
    if (typeof reservationId !== "string" || !reservationId.trim()) {
      throw new EquipmentValidationError("Choose an equipment reservation to release.");
    }
    const reservationRef = firestore.collection("equipment_reservations").doc(reservationId);

    return firestore.runTransaction(async (transaction) => {
      const reservationSnapshot = await transaction.get(reservationRef);
      if (!reservationSnapshot.exists) throw new EquipmentNotFoundError("Equipment reservation not found.");
      const reservation = reservationSnapshot.data();
      if (reservation.status !== "RESERVED") {
        throw new EquipmentConflictError("This equipment reservation is no longer active.");
      }
      const inventoryRef = firestore.collection("equipment_inventory").doc(reservation.equipment_type);
      const inventorySnapshot = await transaction.get(inventoryRef);
      if (!inventorySnapshot.exists) {
        throw new EquipmentNotFoundError("The reservation's inventory record could not be found.");
      }
      const revision = revisionOf(inventorySnapshot.data());
      const now = serverTimestamp();
      transaction.update(reservationRef, {
        status: "RELEASED",
        released_at: now,
        released_by: userId,
        release_reason: String(reason || "").trim() || "No longer required",
        updated_at: now
      });
      transaction.update(inventoryRef, {
        availability_revision: revision + 1,
        updated_at: now
      });
      return { reservationId, status: "RELEASED" };
    });
  };

  return { reserve, release };
};
