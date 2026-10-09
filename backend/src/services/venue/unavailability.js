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

export class UnavailabilityNotFoundError extends Error {
  constructor(periodId) {
    super(`Unavailability period ${periodId} was not found.`);
    this.name = "UnavailabilityNotFoundError";
  }
}

export function createSaveVenueUnavailability({ firestore, serverTimestamp }) {
  return async function saveVenueUnavailability({ venueId, userId, keepPeriodIds, additions }) {
    if (!Array.isArray(keepPeriodIds) || !keepPeriodIds.every((id) => typeof id === "string")) {
      throw new TypeError("Period IDs to keep must be a list of strings.");
    }
    if (!Array.isArray(additions)) throw new TypeError("New periods must be a list.");

    const preparedAdditions = additions.map(({ startDateTime, endDateTime, reason }) => {
      const start = asDate(startDateTime);
      const end = asDate(endDateTime);
      if (!start || !end || end <= start) throw new TypeError("End date and time must be after the start date and time.");
      if (!reason?.trim()) throw new TypeError("A reason is required.");
      return { start, end, reason: reason.trim() };
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

      for (const addition of preparedAdditions) {
        const conflict = bookingSnapshot.docs.find((bookingDoc) => {
          const booking = bookingDoc.data();
          if (String(booking.status || "").toUpperCase() !== "APPROVED") return false;
          const bookingStart = asDate(booking.occupied_start || booking.start_datetime);
          const bookingEnd = asDate(booking.occupied_end || booking.end_datetime);
          return bookingStart && bookingEnd && addition.start < bookingEnd && bookingStart < addition.end;
        });
        if (conflict) throw new ApprovedBookingConflictError(bookingLabel(conflict.data(), conflict.id));
      }

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
          created_by: userId,
          created_at: serverTimestamp()
        };
        transaction.set(periodRef, period);
        savedPeriods.push({ id: periodRef.id, ...period });
      });

      return { periods: savedPeriods };
    });
  };
}
