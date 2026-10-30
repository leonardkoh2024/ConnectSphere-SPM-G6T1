// What the event review API modules share: the signed-in user, and the one
// refusal every unopenable event gets.

import { auth } from "../../lib/firebase";

// K5 / SCRUM-186 AC3 — one response for every event the caller may not open (someone
// else's, one they held before it was reassigned, an unassigned one, or an id that does
// not exist), so the answer never says which of those it was and never carries details.
export const NOT_AUTHORISED = "You are not authorised to view this event.";

export const requireUser = () => {
  if (!auth.currentUser) throw new Error("Please sign in again.");
  return auth.currentUser;
};
