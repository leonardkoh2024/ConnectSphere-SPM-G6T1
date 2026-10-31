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

const ACTIVE_STATUSES = ["RESERVED", "APPROVED"];
const isActiveReservation = (record) => ACTIVE_STATUSES.includes(record.status);

const toDate = (value) => new Date(typeof value.toDate === "function" ? value.toDate() : value);

// G6 / SCRUM-138 — the window to measure against after a significant change: the event's
// CURRENT date and times (Singapore), widened by the setup and turnaround its approved
// booking carries. The booking itself stays as I3 left it, a reference to the old window.
const reassessmentWindow = (event, bookings) => {
  const { event_date: date, start_time: startTime, end_time: endTime } = event;
  const start = new Date(`${date}T${startTime}:00+08:00`);
  const end = new Date(`${date}T${endTime}:00+08:00`);
  if (!(start < end)) {
    throw new EquipmentConflictError("This event has no complete date and time to re-check against.");
  }
  // `bookings` are the event's APPROVED venue bookings; each carries its setup and turnaround.
  const buffers = bookings.map((booking) => ({
    setup: toDate(booking.start_datetime) - toDate(booking.occupied_start),
    turnaround: toDate(booking.occupied_end) - toDate(booking.end_datetime)
  }));
  const setup = Math.max(0, ...buffers.map((item) => item.setup));
  const turnaround = Math.max(0, ...buffers.map((item) => item.turnaround));
  return {
    start: new Date(start.getTime() - setup),
    end: new Date(end.getTime() + turnaround)
  };
};

const unavailableMessage = (result) =>
  `Requested quantity unavailable for the required time period: ${result.freeQuantity} free, `
  + `${result.shortfall} more needed.`;

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
      const [inventorySnapshot, requestSnapshot, eventReservations] = await Promise.all([
        transaction.get(inventoryRef),
        transaction.get(requestRef),
        transaction.get(firestore.collection("equipment_reservations").where("event_id", "==", reservation.event_id))
      ]);
      // G6 — releasing the last reservation I3 flagged leaves nothing waiting for reassessment.
      const stillFlagged = eventReservations.docs.some((item) =>
        item.id !== reservationId && isActiveReservation(item.data()) && item.data().rerequest_required === true);
      const clearsFlag = reservation.rerequest_required === true && !stillFlagged;
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
            ...(clearsFlag ? { rerequest_required: false } : {}),
            updated_at: now
          });
        } else if (clearsFlag) {
          transaction.update(requestRef, { rerequest_required: false, updated_at: now });
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


  // ---- G6 / SCRUM-138 — reassess equipment after a significant change ----------------------
  // I3 flags the event's request and reservations (`rerequest_required`) and tells Technical
  // Support; it never releases anything. These three let Technical Support act on a flag:
  // re-check against the new window, then keep, amend or release (release is `release` above).

  const requireText = (value, message) => {
    if (typeof value !== "string" || !value.trim()) throw new EquipmentValidationError(message);
    return value.trim();
  };

  // Every read, in one place, before any write: the event, its request, its reservations,
  // and the stock records of the types being measured.
  const loadReassessment = async (transaction, eventId, equipmentTypes) => {
    const [eventSnapshot, requestSnapshot, eventReservations, bookings] = await Promise.all([
      transaction.get(firestore.collection("events").doc(eventId)),
      transaction.get(firestore.collection("equipment_requests").doc(eventId)),
      transaction.get(firestore.collection("equipment_reservations").where("event_id", "==", eventId)),
      getApprovedEventBookings({ firestore, transaction, eventId })
    ]);
    if (!eventSnapshot.exists) throw new EquipmentNotFoundError("Event not found.");
    const window = reassessmentWindow(eventSnapshot.data(), bookings);
    const stock = new Map(await Promise.all([...new Set(equipmentTypes)].map(async (type) => {
      const [inventory, reservations, unavailability] = await Promise.all([
        transaction.get(firestore.collection("equipment_inventory").doc(type)),
        transaction.get(firestore.collection("equipment_reservations").where("equipment_type", "==", type)),
        transaction.get(firestore.collection("equipment_unavailability").where("equipment_type", "==", type))
      ]);
      if (!inventory.exists) {
        throw new EquipmentNotFoundError(`No held inventory is recorded for ${type.replaceAll("_", " ")}.`);
      }
      return [type, { inventorySnapshot: inventory, reservations, unavailability }];
    })));
    return {
      request: requestSnapshot.exists ? requestSnapshot.data() : null,
      eventReservations: eventReservations.docs,
      window,
      stock
    };
  };

  // Free stock for one reservation in the new window. The event's own holds are left out:
  // it is replacing them, not competing with them.
  const measure = ({ context, eventId, equipmentType, quantity }) => {
    const { inventorySnapshot, reservations, unavailability } = context.stock.get(equipmentType);
    return calculateEquipmentAvailability({
      equipmentType,
      start: context.window.start,
      end: context.window.end,
      requestedQuantity: quantity,
      eventId,
      inventory: inventorySnapshot.data(),
      reservations: reservations.docs.map((item) => item.data()),
      unavailability: unavailability.docs.map((item) => item.data())
    });
  };

  const flaggedOf = (docs) => docs.filter((item) =>
    isActiveReservation(item.data()) && item.data().rerequest_required === true);

  const NOTHING_WAITING = "Nothing for this event is waiting for reassessment.";

  const recheckReassessment = async ({ eventId: rawEventId }) => {
    const eventId = requireText(rawEventId, "Choose an event to re-check.");
    return firestore.runTransaction(async (transaction) => {
      const eventReservations = await transaction.get(
        firestore.collection("equipment_reservations").where("event_id", "==", eventId)
      );
      const flagged = flaggedOf(eventReservations.docs);
      const context = await loadReassessment(transaction, eventId, flagged.map((item) => item.data().equipment_type));
      if (!flagged.length) throw new EquipmentConflictError(NOTHING_WAITING);
      const lines = flagged
        .map((item) => {
          const reservation = item.data();
          const result = measure({ context, eventId, equipmentType: reservation.equipment_type, quantity: reservation.quantity });
          return {
            reservationId: item.id,
            lineIndex: reservation.line_index,
            equipmentType: reservation.equipment_type,
            quantity: reservation.quantity,
            heldQuantity: result.heldQuantity,
            reservedQuantity: result.reservedQuantity,
            unavailableQuantity: result.unavailableQuantity,
            freeQuantity: result.freeQuantity,
            shortfall: result.shortfall,
            available: result.available
          };
        })
        .sort((left, right) => left.lineIndex - right.lineIndex);
      return { eventId, windowStart: context.window.start, windowEnd: context.window.end, lines };
    });
  };

  // Reads the reservation Technical Support is acting on and checks it can be acted on.
  const loadFlaggedReservation = async (transaction, reservationRef) => {
    const snapshot = await transaction.get(reservationRef);
    if (!snapshot.exists) throw new EquipmentNotFoundError("Equipment reservation not found.");
    const reservation = snapshot.data();
    if (!isActiveReservation(reservation)) {
      throw new EquipmentConflictError("This equipment reservation is no longer active.");
    }
    if (reservation.rerequest_required !== true) {
      throw new EquipmentConflictError("This equipment reservation is not waiting for reassessment.");
    }
    return reservation;
  };

  const keepReservation = async ({ reservationId: rawId, note, userId }) => {
    const reservationId = requireText(rawId, "Choose an equipment reservation to keep.");
    const keptNote = typeof note === "string" && note.trim() ? note.trim() : null;
    const reservationRef = firestore.collection("equipment_reservations").doc(reservationId);

    return firestore.runTransaction(async (transaction) => {
      const reservation = await loadFlaggedReservation(transaction, reservationRef);
      const eventId = reservation.event_id;
      const context = await loadReassessment(transaction, eventId, [reservation.equipment_type]);
      const result = measure({ context, eventId, equipmentType: reservation.equipment_type, quantity: reservation.quantity });
      if (!result.available) throw new EquipmentConflictError(unavailableMessage(result));

      const inventoryRef = firestore.collection("equipment_inventory").doc(reservation.equipment_type);
      const revision = revisionOf(context.stock.get(reservation.equipment_type).inventorySnapshot.data());
      const lastFlagged = !flaggedOf(context.eventReservations).some((item) => item.id !== reservationId);
      const now = serverTimestamp();
      const historyRef = firestore.collection("equipment_request_history").doc();

      transaction.update(reservationRef, {
        start_datetime: context.window.start,
        end_datetime: context.window.end,
        rerequest_required: false,
        rerequest_resolution: "KEPT",
        rerequest_resolved_by: userId,
        rerequest_resolved_at: now,
        updated_at: now
      });
      transaction.create(historyRef, {
        event_id: eventId,
        request_id: eventId,
        line_index: reservation.line_index,
        action: "RESERVATION_KEPT",
        actor_id: userId,
        created_at: now,
        equipment_type: reservation.equipment_type,
        quantity: reservation.quantity,
        reservation_id: reservationId,
        note: keptNote
      });
      if (lastFlagged && context.request) {
        transaction.update(firestore.collection("equipment_requests").doc(eventId), {
          rerequest_required: false,
          rerequest_resolution: "REASSESSED",
          rerequest_resolved_by: userId,
          rerequest_resolved_at: now
        });
      }
      transaction.update(inventoryRef, { availability_revision: revision + 1, updated_at: now });
      return { reservationId, status: "RESERVED" };
    });
  };

  const amendReservation = async ({ reservationId: rawId, quantity, note, userId }) => {
    const reservationId = requireText(rawId, "Choose an equipment reservation to amend.");
    const amendNote = requireText(note, "A note explaining the amendment is required.");
    const requested = Number(quantity);
    if (typeof quantity === "boolean" || quantity === "" || !Number.isInteger(requested) || requested < 1) {
      throw new EquipmentValidationError("Quantity must be a whole number greater than zero.");
    }
    const reservationRef = firestore.collection("equipment_reservations").doc(reservationId);

    return firestore.runTransaction(async (transaction) => {
      const old = await loadFlaggedReservation(transaction, reservationRef);
      const eventId = old.event_id;
      const context = await loadReassessment(transaction, eventId, [old.equipment_type]);
      const result = measure({ context, eventId, equipmentType: old.equipment_type, quantity: requested });
      if (!result.available) throw new EquipmentConflictError(unavailableMessage(result));

      const inventoryRef = firestore.collection("equipment_inventory").doc(old.equipment_type);
      const revision = revisionOf(context.stock.get(old.equipment_type).inventorySnapshot.data());
      const lastFlagged = !flaggedOf(context.eventReservations).some((item) => item.id !== reservationId);
      const now = serverTimestamp();
      const recordedAt = new Date();
      const newRef = firestore.collection("equipment_reservations").doc();
      const reservation = {
        reservation_id: newRef.id,
        event_id: eventId,
        equipment_type: old.equipment_type,
        quantity: requested,
        line_index: old.line_index,
        start_datetime: context.window.start,
        end_datetime: context.window.end,
        status: "RESERVED",
        reserved_by: userId,
        replaces_reservation_id: reservationId,
        created_at: now,
        updated_at: now,
        released_at: null,
        released_by: null,
        release_reason: null
      };

      // The old reservation is kept, released, with the note as its reason (never deleted).
      transaction.update(reservationRef, {
        status: "RELEASED",
        released_at: now,
        released_by: userId,
        release_reason: amendNote,
        rerequest_resolution: "AMENDED",
        rerequest_resolved_by: userId,
        rerequest_resolved_at: now,
        updated_at: now
      });
      transaction.create(newRef, reservation);
      const releasedHistory = firestore.collection("equipment_request_history").doc();
      const reservedHistory = firestore.collection("equipment_request_history").doc();
      const historyBase = {
        event_id: eventId,
        request_id: eventId,
        line_index: old.line_index,
        actor_id: userId,
        created_at: now,
        equipment_type: old.equipment_type
      };
      transaction.create(releasedHistory, {
        ...historyBase, action: "LINE_RESERVATION_RELEASED", quantity: old.quantity, reservation_id: reservationId, reason: amendNote
      });
      transaction.create(reservedHistory, {
        ...historyBase, action: "LINE_RESERVED", quantity: requested, reservation_id: newRef.id, note: amendNote
      });

      if (context.request) {
        transaction.update(firestore.collection("equipment_requests").doc(eventId), {
          lines: context.request.lines.map((line, position) => position === old.line_index ? {
            ...line,
            quantity: requested,
            reservation_id: newRef.id,
            fulfillment_status: "RESERVED",
            fulfilled_at: recordedAt,
            fulfilled_by: userId,
            amendment_note: amendNote,
            amended_by: userId,
            amended_at: recordedAt
          } : line),
          status: context.request.status,
          has_support_decisions: true,
          ...(lastFlagged ? {
            rerequest_required: false,
            rerequest_resolution: "REASSESSED",
            rerequest_resolved_by: userId,
            rerequest_resolved_at: now
          } : {}),
          updated_at: now
        });
      }
      transaction.update(inventoryRef, { availability_revision: revision + 1, updated_at: now });
      return { reservation: { id: newRef.id, ...reservation } };
    });
  };

  return {
    reserve,
    release,
    releaseCancelledEventReservations,
    recheckReassessment,
    keepReservation,
    amendReservation
  };
};
