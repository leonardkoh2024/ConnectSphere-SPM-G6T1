// H1 / SCRUM-139 — the registration service's routes. Same front door as the equipment
// service: a bearer token that verifies, then a profile holding the right role, before any
// transaction starts. Only an Event Organiser reaches the settings, and settings.js checks they
// own the event.

import express from "express";

import { createRegistrationSettings } from "./settings.js";

export const createRegistrationService = ({ firestore, verifyIdToken, serverTimestamp, getApprovedEventBookings, now }) => {
  const router = express.Router();
  const settings = createRegistrationSettings({ firestore, serverTimestamp, getApprovedEventBookings, now });

  // Signs the caller in and checks their profile holds the Organiser role; otherwise answers the
  // request itself (401 or 403) and returns null.
  const authenticateOrganiser = async (request, response) => {
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
    if (!profile.exists || profile.data().role !== "EVENT_ORGANISER") {
      response.status(403).json({ error: "Only an Event Organiser can manage registration." });
      return null;
    }
    return user;
  };

  const answer = (action) => async (request, response, next) => {
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

  router.get("/events/:eventId/settings", answer(({ eventId, userId }) => settings.load({ eventId, userId })));
  router.put("/events/:eventId/settings", answer(({ eventId, userId, body }) => settings.save({ eventId, userId, settings: body || {} })));

  return router;
};
