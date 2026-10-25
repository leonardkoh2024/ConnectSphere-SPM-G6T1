import { admin, db } from "../../lib/firebaseAdmin.js";
import { createArrangementsService } from "./service.js";

export { createArrangementsService } from "./service.js";

const router = createArrangementsService({
  firestore: db(),
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
});

export default router;
