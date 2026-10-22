import { admin, db } from "../../lib/firebaseAdmin.js";
import { createRegistrationService } from "./service.js";

export { createRegistrationService } from "./service.js";

const router = createRegistrationService({
  firestore: db(),
  verifyIdToken: (token) => admin.auth().verifyIdToken(token)
});

export default router;
