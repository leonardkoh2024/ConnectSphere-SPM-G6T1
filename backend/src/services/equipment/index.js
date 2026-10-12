import { admin, db } from "../../lib/firebaseAdmin.js";
import { getApprovedEventBookings } from "../venue/approvedEventBookings.js";
import { createEquipmentService } from "./service.js";

export { createEquipmentService } from "./service.js";

const router = createEquipmentService({
  firestore: db(),
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
  getApprovedEventBookings: ({ transaction, eventId }) =>
    getApprovedEventBookings({ firestore: db(), transaction, eventId })
});

export default router;
