import express from "express";

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

  return router;
};
