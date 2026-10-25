import express from "express";

import { canCompleteEvent } from "../../../../frontend/src/domain/eventCompletion.mjs";

class CompletionError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function createEventCompletionService({
  firestore,
  verifyIdToken,
  now = () => new Date(),
  serverTimestamp
}) {
  const router = express.Router();

  router.post("/:eventId/complete", async (request, response, next) => {
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
      if (!profile.exists || profile.data().role !== "EVENT_COORDINATOR") {
        response.status(403).json({ error: "Only an Event Coordinator can complete an event." });
        return;
      }

      const eventId = request.params.eventId;
      await firestore.runTransaction(async (transaction) => {
        const eventRef = firestore.collection("events").doc(eventId);
        const eventSnapshot = await transaction.get(eventRef);
        if (!eventSnapshot.exists) throw new CompletionError("Event not found.", 404);
        const event = eventSnapshot.data();
        if (event.coordinator_id !== user.uid) {
          throw new CompletionError("Only the assigned coordinator can complete this event.", 403);
        }
        if (event.status !== "CONFIRMED") {
          throw new CompletionError("Only a confirmed event can be completed.", 409);
        }
        if (!canCompleteEvent(event, user.uid, now())) {
          throw new CompletionError("The event end date and time have not passed yet.", 409);
        }

        const changedAt = serverTimestamp();
        const historyRef = firestore.collection("event_history").doc();
        transaction.update(eventRef, {
          status: "COMPLETED",
          completed_at: changedAt,
          updated_at: changedAt
        });
        transaction.set(historyRef, {
          history_id: historyRef.id,
          event_id: eventId,
          actor_id: user.uid,
          action_type: "EVENT_COMPLETED",
          field_name: "status",
          old_value: "CONFIRMED",
          new_value: "COMPLETED",
          description: "Coordinator marked the event completed after its scheduled end.",
          created_at: changedAt
        });
      });

      response.json({ ok: true });
    } catch (error) {
      if (error.statusCode) response.status(error.statusCode).json({ error: error.message });
      else next(error);
    }
  });

  return router;
}
