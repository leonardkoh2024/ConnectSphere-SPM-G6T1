// ConnectSphere backend entry point.
//
// One Express app that each service mounts itself into under its own path prefix.
// Keeping the services behind a single process for now means `npm start` at the
// repo root brings the whole system up; if the team later splits them into
// separate processes, each service module moves out unchanged because none of
// them reach across to another service's routes or collections.

import cors from "cors";
import express from "express";

import { listServices, registerServices } from "./services/index.js";
import { startVenueConflictScheduler, startVenueHoldExpiryScheduler } from "./services/venue/index.js";
import { admin, db } from "./lib/firebaseAdmin.js";

// BACKEND_PORT, not PORT: the repo shares one root .env and CRA reads PORT to
// pick the dev server port, so a shared PORT would move both onto the same one.
const PORT = Number(process.env.BACKEND_PORT) || 4000;
const ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";

const app = express();

app.use(cors({ origin: ORIGIN, credentials: true }));
app.use(express.json());

// Liveness check — also what the frontend's dev proxy hits to confirm the backend
// is actually up rather than silently falling through to the CRA dev server.
app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "connectsphere-backend",
    services: listServices(),
    time: new Date().toISOString()
  });
});

registerServices(app);

// F10/F16 must run without a page visit. Firebase Admin is intentionally used
// only for these trusted background jobs; user-triggered venue work remains in
// the browser SDK and is constrained by firestore.rules.
startVenueHoldExpiryScheduler({
  firestore: db(),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
});
startVenueConflictScheduler({
  firestore: db(),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
});

// Anything under /api that no service claimed is a mistake worth seeing loudly,
// rather than a 200 with an empty body.
app.use("/api", (request, response) => {
  response.status(404).json({ error: "No service handles this route", path: request.originalUrl });
});

app.use((error, _request, response, _next) => {
  console.error("Unhandled error:", error);
  response.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`ConnectSphere backend listening on http://localhost:${PORT}`);
});

export default app;
