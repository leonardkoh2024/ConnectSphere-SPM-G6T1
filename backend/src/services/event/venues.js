import express from "express";

import { getApprovedEventVenueNames } from "../venue/approvedEventBookings.js";

// B10 / SCRUM-101 — the organiser sees which venues their event has secured. Organisers
// have no Firestore read on venue_bookings or venues, so the names come from here: the
// venue service's read contract gives the approved bookings' venue names, and nothing
// else about a booking (no holds, no rejection reasons) reaches the organiser. The
// attendee listing uses the same contract, so the two always name the same venues.
export function createEventVenueService({
  firestore,
  verifyIdToken,
  venueNamesFor = (eventId) => getApprovedEventVenueNames({ firestore, eventId })
}) {
  const router = express.Router();

  router.get("/:eventId/venues", async (request, response, next) => {
    const token = request.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      response.status(401).json({ error: "Sign in is required." });
      return;
    }

    let user;
    try {
      user = await verifyIdToken(token);
    } catch (_error) {
      response.status(401).json({ error: "Your sign-in session is invalid or expired." });
      return;
    }

    try {
      const profile = await firestore.collection("users").doc(user.uid).get();
      if (!profile.exists || profile.data().role !== "EVENT_ORGANISER") {
        response.status(403).json({ error: "Only the event's organiser can see its venues here." });
        return;
      }
      // B10 AC5 — another organiser's event, or none at all, is refused the same way.
      const event = await firestore.collection("events").doc(request.params.eventId).get();
      if (!event.exists || event.data().organiser_id !== user.uid) {
        response.status(403).json({ error: "You are not authorised to view this event." });
        return;
      }
      response.json({ venue_names: await venueNamesFor(request.params.eventId) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
