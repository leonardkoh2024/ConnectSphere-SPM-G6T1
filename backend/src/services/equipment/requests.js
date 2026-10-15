import {
  EquipmentConflictError,
  EquipmentNotFoundError,
  EquipmentValidationError,
  assertEquipmentType
} from "./availability.js";
import { arrangedMessage, eventNameOf, notifyCoordinator, unableMessage } from "./outcomeNotifications.js";

const isFulfilled = (line) => ["RESERVED", "RESOLVED"].includes(line.fulfillment_status);

export const createEquipmentRequestActions = ({ firestore, serverTimestamp }) => {
  const amendLine = async ({ eventId, lineIndex, equipmentType, quantity, note, userId }) => {
    if (typeof eventId !== "string" || !eventId.trim()) {
      throw new EquipmentValidationError("Choose an event before amending an equipment request.");
    }
    const index = Number(lineIndex);
    if (!Number.isInteger(index) || index < 0) {
      throw new EquipmentValidationError("Choose a valid equipment request line.");
    }
    assertEquipmentType(equipmentType);
    const requested = Number(quantity);
    if (!Number.isInteger(requested) || requested < 1) {
      throw new EquipmentValidationError("Quantity must be a whole number greater than zero.");
    }
    if (typeof note !== "string" || !note.trim()) {
      throw new EquipmentValidationError("A note explaining the amendment is required.");
    }
    const requestRef = firestore.collection("equipment_requests").doc(eventId);
    const historyRef = firestore.collection("equipment_request_history").doc();
    const reservationsQuery = firestore.collection("equipment_reservations")
      .where("event_id", "==", eventId);

    return firestore.runTransaction(async (transaction) => {
      const [requestSnapshot, reservationsSnapshot] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(reservationsQuery)
      ]);
      if (!requestSnapshot.exists) throw new EquipmentNotFoundError("Equipment request not found.");
      const request = requestSnapshot.data();
      if (request.status !== "PENDING") {
        throw new EquipmentConflictError("Only Pending equipment requests can be amended.");
      }
      const lines = request.lines || [];
      const previous = lines[index];
      if (!previous) throw new EquipmentNotFoundError("Equipment request line not found.");
      if (isFulfilled(previous)) {
        throw new EquipmentConflictError("A reserved or resolved line cannot be amended.");
      }
      const activeReservation = reservationsSnapshot.docs.some((item) => {
        const reservation = item.data();
        return reservation.equipment_type === previous.equipment_type
          && (reservation.line_index === index || reservation.line_index == null)
          && ["RESERVED", "APPROVED"].includes(String(reservation.status || "").toUpperCase());
      });
      if (activeReservation) throw new EquipmentConflictError("A line with an active reservation cannot be amended.");
      const now = serverTimestamp();
      const recordedAt = new Date();
      const amended = {
        ...previous,
        equipment_type: equipmentType,
        quantity: requested,
        amendment_note: note.trim(),
        amended_by: userId,
        amended_at: recordedAt
      };
      const updatedLines = lines.map((line, lineIndexValue) => lineIndexValue === index ? amended : line);
      transaction.update(requestRef, { lines: updatedLines, has_support_decisions: true, updated_at: now });
      transaction.create(historyRef, {
        event_id: eventId,
        request_id: eventId,
        line_index: index,
        action: "LINE_AMENDED",
        actor_id: userId,
        created_at: now,
        note: note.trim(),
        old_values: {
          equipment_type: previous.equipment_type,
          quantity: Number(previous.quantity)
        },
        new_values: {
          equipment_type: equipmentType,
          quantity: requested
        }
      });
      return { eventId, lineIndex: index, line: amended };
    });
  };

  const resolveLine = async ({ eventId, lineIndex, reason, userId }) => {
    if (typeof eventId !== "string" || !eventId.trim()) {
      throw new EquipmentValidationError("Choose an event before resolving an equipment line.");
    }
    const index = Number(lineIndex);
    if (!Number.isInteger(index) || index < 0) {
      throw new EquipmentValidationError("Choose a valid equipment request line.");
    }
    if (typeof reason !== "string" || !reason.trim()) {
      throw new EquipmentValidationError("A reason is required when marking a line unable to be fulfilled.");
    }
    const requestRef = firestore.collection("equipment_requests").doc(eventId);
    const historyRef = firestore.collection("equipment_request_history").doc();
    const eventRef = firestore.collection("events").doc(eventId);
    const reservationsQuery = firestore.collection("equipment_reservations")
      .where("event_id", "==", eventId);

    return firestore.runTransaction(async (transaction) => {
      const [requestSnapshot, reservationsSnapshot, eventSnapshot] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(reservationsQuery),
        transaction.get(eventRef)
      ]);
      if (!requestSnapshot.exists) throw new EquipmentNotFoundError("Equipment request not found.");
      const request = requestSnapshot.data();
      if (request.status !== "PENDING") {
        throw new EquipmentConflictError("Only Pending equipment requests can be resolved.");
      }
      const lines = request.lines || [];
      const previous = lines[index];
      if (!previous) throw new EquipmentNotFoundError("Equipment request line not found.");
      if (isFulfilled(previous)) {
        throw new EquipmentConflictError("This equipment request line has already been fulfilled or resolved.");
      }
      const activeReservation = reservationsSnapshot.docs.some((item) => {
        const reservation = item.data();
        return reservation.equipment_type === previous.equipment_type
          && (reservation.line_index === index || reservation.line_index == null)
          && ["RESERVED", "APPROVED"].includes(String(reservation.status || "").toUpperCase());
      });
      if (activeReservation) throw new EquipmentConflictError("This line has an active reservation and cannot be resolved.");
      const now = serverTimestamp();
      const recordedAt = new Date();
      const updatedLines = lines.map((line, lineIndexValue) => lineIndexValue === index ? {
        ...line,
        fulfillment_status: "RESOLVED",
        resolution: "UNABLE_TO_FULFILL",
        resolution_reason: reason.trim(),
        resolved_by: userId,
        resolved_at: recordedAt
      } : line);
      const status = updatedLines.every(isFulfilled) ? "ARRANGED" : "PENDING";
      transaction.update(requestRef, {
        lines: updatedLines,
        status,
        has_support_decisions: true,
        updated_at: now
      });
      transaction.create(historyRef, {
        event_id: eventId,
        request_id: eventId,
        line_index: index,
        action: "LINE_UNABLE_TO_FULFILL",
        actor_id: userId,
        created_at: now,
        reason: reason.trim(),
        equipment_type: previous.equipment_type,
        quantity: Number(previous.quantity)
      });
      // J6 AC3 — the line's refusal, and the request's arrival at Arranged if
      // this was the last open line, each reach the coordinator.
      const eventName = eventNameOf(eventSnapshot);
      notifyCoordinator({
        firestore, transaction, eventSnapshot, eventId, createdAt: now,
        type: "EQUIPMENT_UNABLE_TO_FULFIL",
        message: unableMessage({ eventName, line: previous, reason }),
        extra: { equipment_line_index: index }
      });
      if (status === "ARRANGED") {
        notifyCoordinator({
          firestore, transaction, eventSnapshot, eventId, createdAt: now,
          type: "EQUIPMENT_ARRANGED",
          message: arrangedMessage({ eventName, lines: updatedLines })
        });
      }
      return { eventId, lineIndex: index, line: updatedLines[index], status };
    });
  };

  return { amendLine, resolveLine };
};
