// C1 / SCRUM-102 — Have submitted events assigned to a coordinator automatically.
// See docs/adr/0001-coordinator-auto-assignment.md.
//
// Owns the `coordinators` and `assignment_cursor` collections outright. It also
// writes exactly two fields — coordinator_id and assigned_at — on `events`
// documents owned by the epic B–D `event` service. That is a deliberate,
// narrow exception to "a service owns its own collections" (see
// backend/README.md): C1 has no service of its own in the epic table, and the
// alternative — building a stub `event` service just to host this one write —
// was rejected as more surface than the story needs. Nothing here reads or
// writes any other `events` field.
//
// Trigger: the frontend calls this endpoint itself, right after its own
// client-side Firestore write sets an event to SUBMITTED — there is no
// Firestore-triggered Cloud Function in this repo (CLAUDE.md rules out any
// deployment target beyond running locally). See
// frontend/src/features/events/EventRequestForm.js.

import express from "express";

import { db, admin } from "../../lib/firebaseAdmin.js";
import { createAssignCoordinator, EventNotFoundError } from "./assignCoordinator.js";

const router = express.Router();

const assignCoordinator = createAssignCoordinator({
  firestore: db(),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
});

router.post("/assign", async (request, response) => {
  const { eventId } = request.body || {};
  if (!eventId) {
    response.status(400).json({ error: "eventId is required" });
    return;
  }

  try {
    const result = await assignCoordinator(eventId);
    response.json(result);
  } catch (error) {
    if (error instanceof EventNotFoundError) {
      response.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
});

export default router;
