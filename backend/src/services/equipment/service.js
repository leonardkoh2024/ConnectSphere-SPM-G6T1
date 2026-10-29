import express from "express";

import { createEquipmentCatalogue } from "./catalogue.js";
import { createEquipmentRequestActions } from "./requests.js";
import { createEquipmentReservations } from "./reservations.js";
import { createSupportNotifier } from "./supportNotifications.js";

export const createEquipmentService = ({
  firestore,
  verifyIdToken,
  serverTimestamp,
  getApprovedEventBookings
}) => {
  const router = express.Router();
  const reservations = createEquipmentReservations({
    firestore,
    serverTimestamp,
    getApprovedEventBookings
  });
  const requestActions = createEquipmentRequestActions({ firestore, serverTimestamp });
  const catalogue = createEquipmentCatalogue({ firestore });
  const supportNotifier = createSupportNotifier({ firestore, serverTimestamp });

  // Signs the caller in and checks their profile holds `role`; otherwise answers the
  // request itself (401 or 403) and returns null.
  const authenticate = async (request, response, role, refusal) => {
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
      response.status(403).json({ error: refusal });
      return null;
    }
    return user;
  };

  const authenticateTechnicalSupport = (request, response) => authenticate(
    request, response, "TECHNICAL_SUPPORT_STAFF", "Only Technical Support Staff can manage equipment reservations."
  );

  // J5 / SCRUM-154 — the coordinator who has just saved an equipment request asks for
  // Technical Support to be told. The service itself checks they coordinate the event.
  const authenticateCoordinator = (request, response) => authenticate(
    request, response, "EVENT_COORDINATOR", "Only an Event Coordinator can notify Technical Support."
  );

  router.post("/requests/:eventId/notify-technical-support", async (request, response, next) => {
    let user;
    try {
      user = await authenticateCoordinator(request, response);
    } catch (error) {
      next(error);
      return;
    }
    if (!user) return;

    try {
      response.json(await supportNotifier.notifyTechnicalSupport({
        eventId: request.params.eventId,
        userId: user.uid
      }));
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message });
      else next(error);
    }
  });

  router.post("/requests/:eventId/notify-confirmed", async (request, response, next) => {
    let user;
    try {
      user = await authenticate(
        request, response, "SAFETY_OFFICER", "Only a Safety Officer can announce a confirmation."
      );
    } catch (error) {
      next(error);
      return;
    }
    if (!user) return;

    try {
      response.json(await supportNotifier.notifyConfirmed({ eventId: request.params.eventId }));
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message });
      else next(error);
    }
  });

  router.get("/catalogue", async (request, response, next) => {
    try {
      const user = await authenticateTechnicalSupport(request, response);
      if (!user) return;
      response.json(await catalogue.load());
    } catch (error) {
      next(error);
    }
  });

  router.post("/reservations", async (request, response, next) => {
    let user;
    try {
      user = await authenticateTechnicalSupport(request, response);
    } catch (error) {
      next(error);
      return;
    }
    if (!user) return;

    try {
      const reservation = await reservations.reserve({
        eventId: request.body?.event_id,
        equipmentType: request.body?.equipment_type,
        quantity: request.body?.quantity,
        lineIndex: request.body?.line_index,
        userId: user.uid
      });
      response.status(201).json({ reservation });
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message });
      else next(error);
    }
  });

  router.post("/reservations/:reservationId/release", async (request, response, next) => {
    let user;
    try {
      user = await authenticateTechnicalSupport(request, response);
    } catch (error) {
      next(error);
      return;
    }
    if (!user) return;

    try {
      const result = await reservations.release({
        reservationId: request.params.reservationId,
        reason: request.body?.reason,
        userId: user.uid
      });
      response.json(result);
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message });
      else next(error);
    }
  });

  router.post("/events/:eventId/cancel-reservations", async (request, response, next) => {
    let user;
    try {
      user = await authenticateCoordinator(request, response);
    } catch (error) {
      next(error);
      return;
    }
    if (!user) return;

    try {
      response.json(await reservations.releaseCancelledEventReservations({
        eventId: request.params.eventId,
        reason: request.body?.reason,
        userId: user.uid
      }));
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message });
      else next(error);
    }
  });

  router.patch("/requests/:eventId/lines/:lineIndex", async (request, response, next) => {
    let user;
    try {
      user = await authenticateTechnicalSupport(request, response);
    } catch (error) {
      next(error);
      return;
    }
    if (!user) return;

    try {
      const result = await requestActions.amendLine({
        eventId: request.params.eventId,
        lineIndex: request.params.lineIndex,
        equipmentType: request.body?.equipment_type,
        quantity: request.body?.quantity,
        note: request.body?.note,
        userId: user.uid
      });
      response.json(result);
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message });
      else next(error);
    }
  });

  router.post("/requests/:eventId/lines/:lineIndex/unable-to-fulfill", async (request, response, next) => {
    let user;
    try {
      user = await authenticateTechnicalSupport(request, response);
    } catch (error) {
      next(error);
      return;
    }
    if (!user) return;

    try {
      const result = await requestActions.resolveLine({
        eventId: request.params.eventId,
        lineIndex: request.params.lineIndex,
        reason: request.body?.reason,
        userId: user.uid
      });
      response.json(result);
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message });
      else next(error);
    }
  });

  return router;
};
