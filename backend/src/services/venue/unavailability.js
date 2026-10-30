const asDate = (value) => {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const bookingLabel = (booking, id) =>
  booking.booking_id || booking.reference_no || booking.event_name || id;

export class VenueNotFoundError extends Error {
  constructor(venueId) {
    super(`Venue ${venueId} was not found.`);
    this.name = "VenueNotFoundError";
  }
}

export class VenueAssignmentError extends Error {
  constructor() {
    super("You are not assigned to manage this venue.");
    this.name = "VenueAssignmentError";
  }
}

export class ApprovedBookingConflictError extends Error {
  constructor(bookingName) {
    super(`This period overlaps approved booking ${bookingName}.`);
    this.name = "ApprovedBookingConflictError";
    this.bookingName = bookingName;
  }
}

export class ConfirmationRequiredError extends Error {
  constructor(affected) {
    super("Confirm the affected bookings before taking this venue out of use.");
    this.name = "ConfirmationRequiredError";
    this.affected = affected;
  }
}

export class UnavailabilityNotFoundError extends Error {
  constructor(periodId) {
    super(`Unavailability period ${periodId} was not found.`);
    this.name = "UnavailabilityNotFoundError";
  }
}

const REPLACEMENT_NEEDED = "Venue unavailable - replacement needed";

const overlaps = (start, end, booking) => {
  const bookingStart = asDate(booking.occupied_start || booking.start_datetime);
  const bookingEnd = asDate(booking.occupied_end || booking.end_datetime);
  return bookingStart && bookingEnd && start < bookingEnd && bookingStart < end;
};

export function createSaveVenueUnavailability({ firestore, serverTimestamp }) {
  return async function saveVenueUnavailability({ venueId, userId, keepPeriodIds, additions, confirmOverlaps = false }) {
    if (!Array.isArray(keepPeriodIds) || !keepPeriodIds.every((id) => typeof id === "string")) {
      throw new TypeError("Period IDs to keep must be a list of strings.");
    }
    if (!Array.isArray(additions)) throw new TypeError("New periods must be a list.");

    const preparedAdditions = additions.map(({ startDateTime, endDateTime, reason, note }) => {
      const start = asDate(startDateTime);
      const end = asDate(endDateTime);
      if (!start || !end || end <= start) throw new TypeError("End date and time must be after the start date and time.");
      if (!reason?.trim()) throw new TypeError("A reason is required.");
      return { start, end, reason: reason.trim(), note: String(note || "").trim() };
    });

    return firestore.runTransaction(async (transaction) => {
      const venueRef = firestore.collection("venues").doc(venueId);
      const assignmentQuery = firestore.collection("venue_staff")
        .where("venue_id", "==", venueId)
        .where("user_id", "==", userId);
      const venuePeriodsQuery = firestore.collection("venue_unavailability").where("venue_id", "==", venueId);
      const bookingsQuery = firestore.collection("venue_bookings").where("venue_id", "==", venueId);
      const [venue, assignments, periodsSnapshot, bookingSnapshot] = await Promise.all([
        transaction.get(venueRef),
        transaction.get(assignmentQuery),
        transaction.get(venuePeriodsQuery),
        transaction.get(bookingsQuery)
      ]);

      if (!venue.exists) throw new VenueNotFoundError(venueId);
      if (assignments.docs.length === 0) throw new VenueAssignmentError();

      const keptIds = new Set(keepPeriodIds);
      const existingIds = new Set(periodsSnapshot.docs.map((item) => item.id));
      const missingId = keepPeriodIds.find((id) => !existingIds.has(id));
      if (missingId) throw new UnavailabilityNotFoundError(missingId);

      const affectedDocs = [];
      preparedAdditions.forEach((addition) => {
        bookingSnapshot.docs.forEach((bookingDoc) => {
          const booking = bookingDoc.data();
          if (String(booking.status || "").toUpperCase() !== "APPROVED") return;
          if (!overlaps(addition.start, addition.end, booking)) return;
          if (!affectedDocs.some((item) => item.id === bookingDoc.id)) affectedDocs.push(bookingDoc);
        });
      });
      if (affectedDocs.length && !confirmOverlaps) {
        throw new ConfirmationRequiredError(affectedDocs.map((bookingDoc) => ({
          booking_id: bookingDoc.id,
          label: bookingLabel(bookingDoc.data(), bookingDoc.id),
          event_id: bookingDoc.data().event_id || null
        })));
      }

      // Firestore transactions require every read before the first write. Read
      // the current event now so replacement notices always go to the current
      // coordinator, including after reassignment.
      const affectedEventIds = [...new Set(affectedDocs.map((item) => item.data().event_id).filter(Boolean))];
      const affectedEvents = new Map(await Promise.all(affectedEventIds.map(async (eventId) => {
        const snapshot = await transaction.get(firestore.collection("events").doc(eventId));
        return [eventId, snapshot];
      })));

      const savedPeriods = periodsSnapshot.docs
        .filter((item) => keptIds.has(item.id))
        .map((item) => ({ id: item.id, ...item.data() }));
      periodsSnapshot.docs
        .filter((item) => !keptIds.has(item.id))
        .forEach((item) => transaction.delete(item.ref || firestore.collection("venue_unavailability").doc(item.id)));

      preparedAdditions.forEach((addition) => {
        const periodRef = firestore.collection("venue_unavailability").doc();
        const period = {
          venue_id: venueId,
          start_datetime: addition.start,
          end_datetime: addition.end,
          reason: addition.reason,
          ...(addition.note ? { note: addition.note } : {}),
          created_by: userId,
          created_at: serverTimestamp()
        };
        transaction.set(periodRef, period);
        savedPeriods.push({ id: periodRef.id, ...period });
      });

      for (const bookingDoc of affectedDocs) {
        const booking = bookingDoc.data();
        const changedAt = serverTimestamp();
        const addition = preparedAdditions.find((item) => overlaps(item.start, item.end, booking)) || preparedAdditions[0];
        transaction.update(bookingDoc.ref, {
          replacement_needed: true,
          replacement_status: REPLACEMENT_NEEDED,
          replacement_reason: addition.reason,
          replacement_requested_at: changedAt,
          safety_review_required: true
        });
        const eventId = booking.event_id;
        const eventSnap = affectedEvents.get(eventId) || { exists: false };
        const coordinatorId = eventSnap.exists ? eventSnap.data().coordinator_id : booking.requested_by;
        if (eventSnap.exists && String(eventSnap.data().status || "").toUpperCase() === "CONFIRMED") {
          transaction.update(eventSnap.ref || firestore.collection("events").doc(eventId), {
            status: "PLANNING",
            approved_venue_booking_id: null,
            last_safety_review_id: null,
            safety_review_required: true,
            updated_at: changedAt
          });
        }
        if (eventId) {
          const historyRef = firestore.collection("event_history").doc();
          transaction.set(historyRef, {
            history_id: historyRef.id,
            event_id: eventId,
            booking_id: bookingDoc.id,
            venue_id: venueId,
            actor_id: userId,
            action_type: "VENUE_REPLACEMENT_REQUESTED",
            field_name: "replacement_needed",
            old_value: false,
            new_value: true,
            description: `${bookingLabel(booking, bookingDoc.id)} needs a replacement: ${addition.reason}`,
            created_at: changedAt
          });
        }
        if (!coordinatorId) continue;
        const notificationRef = firestore.collection("notifications").doc();
        transaction.set(notificationRef, {
          notification_id: notificationRef.id,
          user_id: coordinatorId,
          event_id: eventId || null,
          venue_id: venueId,
          type: "VENUE_UNAVAILABLE",
          message: `${venue.data().name || venueId} is unavailable (${addition.reason}). A replacement venue is needed.`,
          start_datetime: addition.start,
          end_datetime: addition.end,
          reason: addition.reason,
          is_read: false,
          created_at: changedAt,
          read_at: null
        });
      }

      return { periods: savedPeriods };
    });
  };
}
