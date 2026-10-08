import express from "express";

import { admin, db } from "../../lib/firebaseAdmin.js";
import {
  ApprovedBookingConflictError,
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
      response.status(403).json({ error: "Only Venue Staff can manage venue unavailability." });
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
        additions: additions.map(({ start_datetime, end_datetime, reason }) => ({
          startDateTime: start_datetime,
          endDateTime: end_datetime,
          reason
        }))
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
      else if (error instanceof ApprovedBookingConflictError) response.status(409).json({ error: error.message });
      else if (error instanceof TypeError) response.status(400).json({ error: error.message });
      else if (error instanceof UnavailabilityNotFoundError) response.status(409).json({ error: error.message });
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