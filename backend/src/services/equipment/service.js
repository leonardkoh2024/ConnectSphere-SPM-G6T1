import express from "express";

import { createEquipmentCatalogue } from "./catalogue.js";
import { createEquipmentRequestActions } from "./requests.js";
import { createEquipmentReservations } from "./reservations.js";

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

  const authenticateTechnicalSupport = async (request, response) => {
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
    if (!profile.exists || profile.data().role !== "TECHNICAL_SUPPORT_STAFF") {
      response.status(403).json({ error: "Only Technical Support Staff can manage equipment reservations." });
      return null;
    }
    return user;
  };

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
