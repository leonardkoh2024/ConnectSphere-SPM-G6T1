import express from "express";

import { isOpenForRegistration, listOpenEvents } from "../../../../frontend/src/domain/openRegistration.mjs";
import { getApprovedEventVenueNames } from "../venue/approvedEventBookings.js";

// The registration service owns `registrations` (and, with H6, the waiting list).
//
// H2 / SCRUM-140 — an attendee's browser has no read on `events` (A4/A5), and an
// event document carries far more than an attendee should see. So the open-events
// list is built here: the events taking registrations are read with the Admin SDK,
// filtered by the shared domain rules, and only their public fields are returned.
// Like `equipment`, this service reads `events` without owning it; venue names
// come through the venue service's read contract.
export function createRegistrationService({
  firestore,
  verifyIdToken,
  now = () => new Date(),
  venueNamesFor = (eventId) => getApprovedEventVenueNames({ firestore, eventId })
}) {
  const router = express.Router();

  const authenticateAttendee = async (request, response) => {
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
    if (!profile.exists || profile.data().role !== "ATTENDEE") {
      response.status(403).json({ error: "Only attendees can browse events open for registration." });
      return null;
    }
    return user;
  };

  const registeredCount = async (eventId) => {
    const snapshot = await firestore.collection("registrations")
      .where("event_id", "==", eventId)
      .where("status", "==", "REGISTERED")
      .count()
      .get();
    return snapshot.data().count;
  };

  router.get("/open-events", async (request, response, next) => {
    try {
      const user = await authenticateAttendee(request, response);
      if (!user) return;

      const at = now();
      const snapshot = await firestore.collection("events").where("registration_required", "==", true).get();
      const open = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((event) => isOpenForRegistration(event, at));

      const venueNamesByEvent = {};
      const registeredCountByEvent = {};
      await Promise.all(open.map(async (event) => {
        [venueNamesByEvent[event.id], registeredCountByEvent[event.id]] = await Promise.all([
          venueNamesFor(event.id),
          registeredCount(event.id)
        ]);
      }));

      response.json({ events: listOpenEvents(open, { now: at, venueNamesByEvent, registeredCountByEvent }) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
