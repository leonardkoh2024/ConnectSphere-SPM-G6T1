import { admin, db } from "../../lib/firebaseAdmin.js";
import { getApprovedEventBookings } from "../venue/approvedEventBookings.js";
import { createRegistrationService } from "./service.js";

export { createRegistrationService } from "./service.js";

const router = createRegistrationService({
  firestore: db(),
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  // H1 / SCRUM-139 — organiser settings
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
  getApprovedEventBookings: ({ transaction, eventId }) =>
    getApprovedEventBookings({ firestore: db(), transaction, eventId })
});

export default router;
