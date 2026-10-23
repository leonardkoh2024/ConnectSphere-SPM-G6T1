import {
  calculateEquipmentAvailability,
  EquipmentConflictError,
  EquipmentNotFoundError,
  EquipmentValidationError,
  equipmentWindowFromVenueBookings,
  assertEquipmentType
} from "./availability.js";
import { arrangedMessage, eventNameOf, notifyCoordinator } from "./outcomeNotifications.js";

const revisionOf = (inventory) => {
  const revision = inventory.availability_revision == null ? 0 : Number(inventory.availability_revision);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new EquipmentValidationError("The equipment inventory revision is invalid.");
  }
  return revision;
};

export const createEquipmentReservations = ({ firestore, serverTimestamp, getApprovedEventBookings }) => {
  const reserve = async ({ eventId, equipmentType, quantity, userId, lineIndex }) => {
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
    const eventRef = firestore.collection("events").doc(eventId);
    return firestore.runTransaction(async (transaction) => {
      const [requestSnapshot, inventorySnapshot, reservationSnapshot, unavailableSnapshot, bookings, eventSnapshot] =
        await Promise.all([
          transaction.get(requestRef),
          transaction.get(inventoryRef),
          transaction.get(reservationQuery),
          transaction.get(unavailableQuery),
          getApprovedEventBookings({ firestore, transaction, eventId }),
          transaction.get(eventRef)
        ]);
      if (!requestSnapshot.exists || requestSnapshot.data().status !== "PENDING") {
        throw new EquipmentConflictError("This event no longer has a Pending equipment request.");
      }
      const requestLines = requestSnapshot.data().lines || [];
      const selectedIndex = Number.isInteger(Number(lineIndex))
        ? Number(lineIndex)
        : requestLines.findIndex((line) =>
          line.equipment_type === equipmentType && !["RESERVED", "RESOLVED"].includes(line.fulfillment_status)
        );
      const requestLine = requestLines[selectedIndex];
      if (!requestLine) throw new EquipmentConflictError("This equipment type is not in the event's request.");
      if (requestLine.equipment_type !== equipmentType
        || ["RESERVED", "RESOLVED"].includes(requestLine.fulfillment_status)) {
        throw new EquipmentConflictError("This equipment request line has already been resolved.");
      }
      if (!inventorySnapshot.exists) {
        throw new EquipmentNotFoundError(`No held inventory is recorded for ${equipmentType.replaceAll("_", " ")}.`);
      }
      const inventory = inventorySnapshot.data();
      const revision = revisionOf(inventory);
      const reservations = reservationSnapshot.docs.map((item) => item.data());
      const existingReservation = reservations.find((reservation) =>
        reservation.event_id === eventId
        && ["RESERVED", "APPROVED"].includes(String(reservation.status || "").toUpperCase())
        && (reservation.line_index === selectedIndex
          || (reservation.line_index == null && reservation.equipment_type === equipmentType))
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
        eventId: null,
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
      const recordedAt = new Date();
      const reservation = {
        reservation_id: reservationRef.id,
        event_id: eventId,
        equipment_type: equipmentType,
        quantity: requested,
        line_index: selectedIndex,
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
      const historyRef = firestore.collection("equipment_request_history").doc();
      transaction.create(reservationRef, reservation);
      transaction.create(historyRef, {
        event_id: eventId,
        request_id: eventId,
        line_index: selectedIndex,
        action: "LINE_RESERVED",
        actor_id: userId,
        created_at: now,
        equipment_type: equipmentType,
        quantity: requested,
        reservation_id: reservationRef.id
      });
      const updatedLines = requestLines.map((line, index) => index === selectedIndex
        ? {
          ...line,
          fulfillment_status: "RESERVED",
          reservation_id: reservationRef.id,
          fulfilled_at: recordedAt,
          fulfilled_by: userId
        }
        : line);
      const requestStatus = updatedLines.every((line) => ["RESERVED", "RESOLVED"].includes(line.fulfillment_status))
        ? "ARRANGED"
        : "PENDING";
      transaction.update(requestRef, {
        lines: updatedLines,
        status: requestStatus,
        has_support_decisions: true,
        updated_at: now
      });
      // J6 AC3 — reserving the last open line arranges the request.
      if (requestStatus === "ARRANGED") {
        notifyCoordinator({
          firestore, transaction, eventSnapshot, eventId, createdAt: now,
          type: "EQUIPMENT_ARRANGED",
          message: arrangedMessage({ eventName: eventNameOf(eventSnapshot), lines: updatedLines })
        });
      }
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
      const requestRef = firestore.collection("equipment_requests").doc(reservation.event_id);
      const [inventorySnapshot, requestSnapshot] = await Promise.all([
        transaction.get(inventoryRef),
        transaction.get(requestRef)
      ]);
      if (!inventorySnapshot.exists) {
        throw new EquipmentNotFoundError("The reservation's inventory record could not be found.");
      }
      const revision = revisionOf(inventorySnapshot.data());
      const now = serverTimestamp();
      const historyRef = firestore.collection("equipment_request_history").doc();
      transaction.update(reservationRef, {
        status: "RELEASED",
        released_at: now,
        released_by: userId,
        release_reason: String(reason || "").trim() || "No longer required",
        updated_at: now
      });
      transaction.create(historyRef, {
        event_id: reservation.event_id,
        request_id: reservation.event_id,
        line_index: reservation.line_index ?? null,
        action: "LINE_RESERVATION_RELEASED",
        actor_id: userId,
        created_at: now,
        equipment_type: reservation.equipment_type,
        quantity: reservation.quantity,
        reservation_id: reservationId,
        reason: String(reason || "").trim() || "No longer required"
      });
      if (requestSnapshot.exists) {
        const lines = requestSnapshot.data().lines || [];
        const lineIndex = Number.isInteger(Number(reservation.line_index))
          ? Number(reservation.line_index)
          : lines.findIndex((line) => line.reservation_id === reservationId);
        if (lineIndex >= 0 && lines[lineIndex]?.reservation_id === reservationId) {
          const updatedLines = lines.map((line, index) => index === lineIndex ? {
            ...line,
            fulfillment_status: "PENDING",
            reservation_id: null,
            fulfilled_at: null,
            fulfilled_by: null
          } : line);
          transaction.update(requestRef, {
            lines: updatedLines,
            status: "PENDING",
            has_support_decisions: true,
            updated_at: now
          });
        }
      }
      transaction.update(inventoryRef, {
        availability_revision: revision + 1,
        updated_at: now
      });
      return { reservationId, status: "RELEASED" };
    });
  };

  const releaseCancelledEventReservations = async ({ eventId, reason, userId }) => {
    if (typeof eventId !== "string" || !eventId.trim()) {
      throw new EquipmentValidationError("Choose an event before releasing its equipment.");
    }
    const eventRef = firestore.collection("events").doc(eventId);
    const requestRef = firestore.collection("equipment_requests").doc(eventId);
    const reservationQuery = firestore.collection("equipment_reservations")
      .where("event_id", "==", eventId);

    return firestore.runTransaction(async (transaction) => {
      const [eventSnapshot, requestSnapshot, reservationSnapshot] = await Promise.all([
        transaction.get(eventRef),
        transaction.get(requestRef),
        transaction.get(reservationQuery)
      ]);
      if (!eventSnapshot.exists || eventSnapshot.data().coordinator_id !== userId) {
        throw new EquipmentConflictError("Only the current event coordinator may release its equipment.");
      }
      if (eventSnapshot.data().status !== "CANCELLED") {
        throw new EquipmentConflictError("Equipment can be released automatically only after the event is Cancelled.");
      }

      const activeReservations = reservationSnapshot.docs.filter((item) =>
        ["RESERVED", "APPROVED"].includes(String(item.data().status || "").toUpperCase())
      );
      const inventoryTypes = [...new Set(activeReservations.map((item) => item.data().equipment_type))];
      const inventorySnapshots = await Promise.all(inventoryTypes.map((type) =>
        transaction.get(firestore.collection("equipment_inventory").doc(type))
      ));
      const inventoryByType = new Map(inventoryTypes.map((type, index) => [type, inventorySnapshots[index]]));
      const now = serverTimestamp();
      const releaseReason = String(reason || "").trim() || "Event cancelled";
      const lines = requestSnapshot.exists ? requestSnapshot.data().lines || [] : [];

      activeReservations.forEach((item) => {
        const reservation = item.data();
        const inventorySnapshot = inventoryByType.get(reservation.equipment_type);
        if (!inventorySnapshot?.exists) {
          throw new EquipmentNotFoundError(`The inventory record for ${reservation.equipment_type} could not be found.`);
        }
        transaction.update(item.ref, {
          status: "RELEASED",
          released_at: now,
          released_by: userId,
          release_reason: releaseReason,
          updated_at: now
        });
        const historyRef = firestore.collection("equipment_request_history").doc();
        transaction.create(historyRef, {
          event_id: eventId,
          request_id: eventId,
          line_index: reservation.line_index ?? null,
          action: "LINE_RESERVATION_RELEASED",
          actor_id: userId,
          actor_role: "Event Coordinator",
          created_at: now,
          equipment_type: reservation.equipment_type,
          quantity: reservation.quantity,
          reservation_id: reservation.reservation_id || item.id,
          reason: releaseReason
        });
      });

      if (requestSnapshot.exists) {
        const releasedIds = new Set(activeReservations.map((item) => item.data().reservation_id || item.id));
        const updatedLines = lines.map((line) => releasedIds.has(line.reservation_id)
          ? { ...line, fulfillment_status: "RELEASED" }
          : line);
        transaction.update(requestRef, {
          lines: updatedLines,
          status: "CANCELLED",
          updated_at: now
        });
      }

      inventoryTypes.forEach((type) => {
        const inventory = inventoryByType.get(type).data();
        transaction.update(firestore.collection("equipment_inventory").doc(type), {
          availability_revision: revisionOf(inventory) + 1,
          updated_at: now
        });
      });

      return { released: activeReservations.length };
    });
  };

  return { reserve, release, releaseCancelledEventReservations };
};
