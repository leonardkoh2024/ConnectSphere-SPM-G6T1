import express from "express";

import { isOpenForRegistration, listOpenEvents } from "../../../../frontend/src/domain/openRegistration.mjs";
import { waitlistPosition } from "../../../../frontend/src/domain/waitingList.mjs";
import { getApprovedEventBookings as readApprovedEventBookings, getApprovedEventVenueNames } from "../venue/approvedEventBookings.js";
import { createRegistrationList } from "./attendeeList.js";
import { createMyRegistrations } from "./myRegistrations.js";
import { createAttendeeRegistration } from "./register.js";
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
//
// H3 / SCRUM-141 — an attendee registers here, in one transaction that checks the window,
// the places left and any registration they already hold. No browser can create one.
//
// H4 / SCRUM-142 — an attendee's own registrations, with their status and each event's
// public details. Only the caller's records are queried.
//
// H6 / SCRUM-144 — an attendee joins the waiting list of a full event here. Their position is
// worked out from the event's waiting list each time either list is read, never stored.
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
  const attendeeRegistration = createAttendeeRegistration({ firestore, serverTimestamp, now });
  // H6 AC2 — where record `recordId` stands on the event's waiting list right now.
  const waitlistPositionFor = async (eventId, recordId) => {
    const snapshot = await firestore.collection("registrations").where("event_id", "==", eventId).where("status", "==", "WAITLISTED").get();
    return waitlistPosition(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })), recordId);
  };
  const myRegistrations = createMyRegistrations({ firestore, venueNamesFor, now, waitlistPositionFor });

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

  const authenticateAttendee = (request, response, forbidden = "Only attendees can browse events open for registration.") =>
    authenticate(request, response, { role: "ATTENDEE", forbidden });

  // H3 AC8 — the caller's own place on each event, so the list offers View details instead of
  // Register. Only a held place (Registered or Waitlisted) is reported, with the record holding it.
  const ownPlaces = async (attendeeId) => {
    const snapshot = await firestore.collection("registrations").where("attendee_id", "==", attendeeId).get();
    const places = {};
    snapshot.docs.forEach((item) => {
      const { event_id: eventId, status } = item.data();
      if (status === "REGISTERED" || (status === "WAITLISTED" && places[eventId]?.status !== "REGISTERED")) places[eventId] = { status, id: item.id };
    });
    return places;
  };

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
      const [mine] = await Promise.all([
        ownPlaces(user.uid),
        ...open.map(async (event) => {
          [venueNamesByEvent[event.id], registeredCountByEvent[event.id]] = await Promise.all([
            venueNamesFor(event.id),
            registeredCount(event.id)
          ]);
        })
      ]);

      // H6 AC2 — the caller's position on each waiting list they are on.
      const events = await Promise.all(listOpenEvents(open, { now: at, venueNamesByEvent, registeredCountByEvent })
        .map(async (entry) => {
          const place = mine[entry.id];
          const position = place?.status === "WAITLISTED" ? await waitlistPositionFor(entry.id, place.id) : null;
          return { ...entry, registration_status: place?.status || null, waitlist_position: position };
        }));
      response.json({ events });
    } catch (error) {
      next(error);
    }
  });

  // H3 — register the signed-in attendee for one event. A refusal (not open, closed, full,
  // already registered) is answered with its reason, so the screen can show the right state.
  router.post("/events/:eventId/register", async (request, response, next) => {
    let user;
    try {
      user = await authenticateAttendee(request, response, "Only attendees can register for events.");
    } catch (error) {
      next(error);
      return;
    }
    if (!user) return;

    try {
      const result = await attendeeRegistration.register({ eventId: request.params.eventId, attendeeId: user.uid });
      const venueNames = await venueNamesFor(request.params.eventId);
      response.status(201).json({ ...result, event: { ...result.event, venue_names: venueNames } });
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message, reason: error.reason });
      else next(error);
    }
  });

  // H5 — withdraw the signed-in attendee from one event. A refusal (not registered, the event
  // has started or ended) is answered with its reason.
  router.post("/events/:eventId/withdraw", async (request, response, next) => {
    let user;
    try {
      user = await authenticateAttendee(request, response, "Only attendees can withdraw from events.");
    } catch (error) {
      next(error);
      return;
    }
    if (!user) return;

    try {
      const result = await attendeeRegistration.withdraw({ eventId: request.params.eventId, attendeeId: user.uid });
      const venueNames = await venueNamesFor(request.params.eventId);
      response.json({ ...result, registration: { ...result.registration, venue_names: venueNames } });
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message, reason: error.reason });
      else next(error);
    }
  });

  // H6 — join the waiting list of a full event. A refusal (a place is free, already holding a
  // place, registration not open) is answered with its reason.
  router.post("/events/:eventId/waitlist", async (request, response, next) => {
    let user;
    try {
      user = await authenticateAttendee(request, response, "Only attendees can join a waiting list.");
    } catch (error) {
      next(error);
      return;
    }
    if (!user) return;

    try {
      const result = await attendeeRegistration.joinWaitlist({ eventId: request.params.eventId, attendeeId: user.uid });
      const venueNames = await venueNamesFor(request.params.eventId);
      response.status(201).json({ registration: { ...result.registration, venue_names: venueNames } });
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message, reason: error.reason });
      else next(error);
    }
  });

  router.get("/mine", async (request, response, next) => {
    try {
      const user = await authenticateAttendee(request, response, "Only attendees can see their registrations.");
      if (!user) return;
      response.json(await myRegistrations.load({ attendeeId: user.uid }));
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
