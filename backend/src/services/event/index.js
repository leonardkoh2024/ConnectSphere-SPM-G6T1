import { admin, db } from "../../lib/firebaseAdmin.js";
import { createEventCompletionService } from "./completion.js";

export { createEventCompletionService } from "./completion.js";

const router = createEventCompletionService({
  firestore: db(),
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
});

export default router;
