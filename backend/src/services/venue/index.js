import express from "express";

import { admin, db } from "../../lib/firebaseAdmin.js";
import {
  ApprovedBookingConflictError,
  ConfirmationRequiredError,
  createSaveVenueUnavailability,
  VenueAssignmentError,
  VenueNotFoundError,
  UnavailabilityNotFoundError
} from "./unavailability.js";

export function createVenueService({ firestore, verifyIdToken, serverTimestamp }) {
  const router = express.Router();
  const saveUnavailability = createSaveVenueUnavailability({ firestore, serverTimestamp });

  const authenticateVenueStaff = async (request, response) => {
    const token = request.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      response.status(401).json({ error: "Sign in is required." });
      return null;
    }
    let user;
    try {
      user = await verifyIdToken(token);
    } catch (_error) {
      response.status(401).json({ error: "Your sign-in session is invalid or expired." });
      return null;
    }
    const profile = await firestore.collection("users").doc(user.uid).get();
    if (!profile.exists || profile.data().role !== "VENUE_STAFF") {
      response.status(403).json({ error: "Only Venue Staff can manage venue operations." });
      return null;
    }
    return user;
  };

  router.put("/unavailability", async (request, response, next) => {
    let user;
    try {
      user = await authenticateVenueStaff(request, response);
    } catch (error) {
      next(error);
      return;
    }
    if (!user) {
      return;
    }

    const { venue_id: venueId, keep_period_ids: keepPeriodIds, additions } = request.body || {};
    if (typeof venueId !== "string" || !venueId.trim()) {
      response.status(400).json({ error: "venue_id is required." });
      return;
    }
    if (!Array.isArray(keepPeriodIds) || !Array.isArray(additions)) {
      response.status(400).json({ error: "keep_period_ids and additions must be lists." });
      return;
    }

    try {
      const result = await saveUnavailability({
        venueId: venueId.trim(),
        userId: user.uid,
        keepPeriodIds,
        additions: additions.map(({ start_datetime, end_datetime, reason, note }) => ({
          startDateTime: start_datetime,
          endDateTime: end_datetime,
          reason,
          note
        })),
        confirmOverlaps: request.body?.confirm_overlaps === true
      });
      response.json({ periods: result.periods.map((period) => ({
        id: period.id,
        venue_id: period.venue_id,
        start_datetime: period.start_datetime?.toDate?.().toISOString?.() || period.start_datetime?.toISOString?.() || period.start_datetime,
        end_datetime: period.end_datetime?.toDate?.().toISOString?.() || period.end_datetime?.toISOString?.() || period.end_datetime,
        reason: period.reason
      })) });
    } catch (error) {
      if (error instanceof VenueNotFoundError) response.status(404).json({ error: error.message });
      else if (error instanceof VenueAssignmentError) response.status(403).json({ error: error.message });
      else if (error instanceof ConfirmationRequiredError) response.status(409).json({ error: error.message, confirmation_required: true, affected: error.affected });
      else if (error instanceof ApprovedBookingConflictError) response.status(409).json({ error: error.message });
      else if (error instanceof TypeError) response.status(400).json({ error: error.message });
      else if (error instanceof UnavailabilityNotFoundError) response.status(409).json({ error: error.message });
      else next(error);
    }
  });

  router.post("/bookings/:bookingId/reject", async (request, response, next) => {
    let user;
    try {
      user = await authenticateVenueStaff(request, response);
    } catch (error) {
      next(error);
      return;
    }
    if (!user) return;

    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
    if (!reason) {
      response.status(400).json({ error: "A rejection reason is required." });
      return;
    }

    try {
      const bookingRef = firestore.collection("venue_bookings").doc(request.params.bookingId);
      const historyRef = firestore.collection("event_history").doc();
      const notificationRef = firestore.collection("notifications").doc();
      await firestore.runTransaction(async (transaction) => {
        const bookingSnapshot = await transaction.get(bookingRef);
        if (!bookingSnapshot.exists) {
          const error = new Error("Booking request not found.");
          error.statusCode = 404;
          throw error;
        }

        const booking = bookingSnapshot.data();
        const assignmentRef = firestore.collection("venue_staff").doc(booking.venue_id);
        const assignmentSnapshot = await transaction.get(assignmentRef);
        if (!assignmentSnapshot.exists || assignmentSnapshot.data().user_id !== user.uid
          || assignmentSnapshot.data().venue_id !== booking.venue_id) {
          const error = new Error("You are not assigned to manage this venue.");
          error.statusCode = 403;
          throw error;
        }
        if (!["PENDING", "HELD"].includes(booking.status)) {
          const error = new Error("Only a Pending or Held booking request can be rejected.");
          error.statusCode = 409;
          throw error;
        }

        const venueSnapshot = booking.requested_by
          ? await transaction.get(firestore.collection("venues").doc(booking.venue_id))
          : null;
        const decidedAt = serverTimestamp();
        transaction.update(bookingRef, {
          status: "REJECTED",
          decision_reason: reason,
          assigned_staff_id: user.uid,
          decided_by: user.uid,
          decided_at: decidedAt
        });
        transaction.set(historyRef, {
          history_id: historyRef.id,
          event_id: booking.event_id,
          booking_id: request.params.bookingId,
          venue_id: booking.venue_id,
          actor_id: user.uid,
          action_type: "VENUE_BOOKING_REJECTED",
          field_name: "venue_booking_status",
          old_value: booking.status,
          new_value: "REJECTED",
          description: reason,
          created_at: decidedAt
        });
        if (booking.requested_by) {
          const venueName = venueSnapshot?.exists ? venueSnapshot.data().name : booking.venue_id;
          transaction.set(notificationRef, {
            notification_id: notificationRef.id,
            user_id: booking.requested_by,
            event_id: booking.event_id,
            event_name: booking.event_name || "",
            type: "VENUE_BOOKING_REJECTED",
            message: `${booking.event_name || "Your event"}: the booking for ${venueName || booking.venue_id} was rejected. Reason: ${reason}`,
            decision_reason: reason,
            booking_id: request.params.bookingId,
            venue_id: booking.venue_id,
            is_read: false,
            created_at: decidedAt,
            read_at: null
          });
        }
      });
      response.json({ booking_id: request.params.bookingId, status: "REJECTED", decision_reason: reason });
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message });
      else next(error);
    }
  });

  return router;
}

const router = createVenueService({
  firestore: db(),
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
});

export default router;
