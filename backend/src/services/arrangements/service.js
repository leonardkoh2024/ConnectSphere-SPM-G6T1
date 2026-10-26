// I3 / SCRUM-149 — the routes the coordinator's browser calls after saving an event edit or
// an equipment request. Mounted at /api/events (see index.js).
import express from "express";

import { createArrangementReRequester } from "./reRequest.js";

export const createArrangementsService = ({ firestore, verifyIdToken, serverTimestamp }) => {
  const router = express.Router();
  const requester = createArrangementReRequester({ firestore, serverTimestamp });

  // Signs the caller in and checks they are an Event Coordinator; otherwise answers the
  // request itself (401 or 403) and returns null. The service then checks they coordinate
  // this particular event.
  const authenticateCoordinator = async (request, response) => {
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
    if (!profile.exists || profile.data().role !== "EVENT_COORDINATOR") {
      response.status(403).json({ error: "Only an Event Coordinator can do this." });
      return null;
    }
    return user;
  };

  const handle = (run) => async (request, response, next) => {
    let user;
    try {
      user = await authenticateCoordinator(request, response);
    } catch (error) {
      next(error);
      return;
    }
    if (!user) return;
    try {
      response.json(await run({ request, userId: user.uid }));
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message });
      else next(error);
    }
  };

  router.post("/:eventId/rerequest-arrangements", handle(({ request, userId }) => requester.apply({
    eventId: request.params.eventId,
    userId,
    changeId: request.body?.change_id,
    source: request.body?.source ?? "EVENT_EDIT"
  })));

  router.post("/:eventId/registration-capacity", handle(({ request, userId }) => requester.setRegistrationCapacity({
    eventId: request.params.eventId,
    userId,
    capacity: request.body?.capacity,
    acknowledged: request.body?.acknowledged
  })));

  return router;
};
