import express from "express";

import { admin, db } from "../../lib/firebaseAdmin.js";
import { createEventCompletionService } from "./completion.js";
import { createEventVenueService } from "./venues.js";

export { createEventCompletionService } from "./completion.js";
export { createEventVenueService } from "./venues.js";

const dependencies = {
  firestore: db(),
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
};

const router = express.Router();
router.use(createEventCompletionService(dependencies));
router.use(createEventVenueService(dependencies));

export default router;
