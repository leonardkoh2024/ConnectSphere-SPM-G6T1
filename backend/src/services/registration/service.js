import express from "express";

import { isOpenForRegistration, listOpenEvents } from "../../../../frontend/src/domain/openRegistration.mjs";
import { getApprovedEventBookings as readApprovedEventBookings, getApprovedEventVenueNames } from "../venue/approvedEventBookings.js";
import { createRegistrationList } from "./attendeeList.js";
import { createRegistrationSettings } from "./settings.js";

// The registration service owns `registrations` (and, with H6, the waiting list).
//
// H2 / SCRUM-140 — an attendee's browser has no read on `events` (A4/A5), and an
// event document carries far more than an attendee should see. So the open-events
// list is built here: the events taking registrations are read with the Admin SDK,
// filtered by the shared domain rules, and only their public fields are returned.
// Like `equipment`, this service reads `events` without owning it; venue names
// come through the venue service's read contract.
//
// H1 / SCRUM-139 — the Event Organiser's registration settings (capacity and window)
// are saved here too, in one transaction that also reads the approved venue bookings
// and the registered count. Each feature has its own role check; neither can reach
// the other's routes.
//
// H8 / SCRUM-146 — the organiser's list of who has registered (names, contact details, times,
// and the registered / waitlisted / withdrawn counts) is built here, for the organiser of the
// event only: an organiser has no browser read of registrations or attendee profiles.
export function createRegistrationService({
  firestore,
  verifyIdToken,
  now = () => new Date(),
  venueNamesFor = (eventId) => getApprovedEventVenueNames({ firestore, eventId }),
  serverTimestamp,
  getApprovedEventBookings = ({ transaction, eventId }) =>
    readApprovedEventBookings({ firestore, transaction, eventId })
}) {
  const router = express.Router();
  const settings = createRegistrationSettings({ firestore, serverTimestamp, getApprovedEventBookings, now });
  const attendeeList = createRegistrationList({ firestore });

  // Signs the caller in and checks their profile holds `role`; otherwise answers the
  // request itself (401 or 403 with `forbidden`) and returns null.
  const authenticate = async (request, response, { role, forbidden }) => {
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
    if (!profile.exists || profile.data().role !== role) {
      response.status(403).json({ error: forbidden });
      return null;
    }
    return user;
  };

  const authenticateAttendee = (request, response) =>
    authenticate(request, response, { role: "ATTENDEE", forbidden: "Only attendees can browse events open for registration." });

  const authenticateOrganiser = (request, response) =>
    authenticate(request, response, { role: "EVENT_ORGANISER", forbidden: "Only an Event Organiser can manage registration." });

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

  const answerOrganiser = (action) => async (request, response, next) => {
    let user;
    try {
      user = await authenticateOrganiser(request, response);
    } catch (error) {
      next(error);
      return;
    }
    if (!user) return;

    try {
      response.json(await action({ eventId: request.params.eventId, userId: user.uid, body: request.body }));
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message, ...(error.fields ? { fields: error.fields } : {}) });
      else next(error);
    }
  };

  router.get("/events/:eventId/settings", answerOrganiser(({ eventId, userId }) => settings.load({ eventId, userId })));
  router.put("/events/:eventId/settings", answerOrganiser(({ eventId, userId, body }) => settings.save({ eventId, userId, settings: body || {} })));

  router.get("/events/:eventId/attendees", answerOrganiser(({ eventId, userId }) => attendeeList.load({ eventId, userId })));

  return router;
}
