// The attendee's side of the registration service. Attendees have no Firestore
// read on `events`, so everything here goes through the backend.

import { auth } from "../../lib/firebase";

const SERVICE_UNREACHABLE =
  "The registration service is not responding. Check that the backend is running (npm start), then try again.";

// When the backend is down, CRA's dev proxy replies with a plain-text "Proxy
// error" page, so a reply that is not JSON (or no reply at all) means the service
// could not be reached.
const callRegistrationService = async (path, fallbackError) => {
  const user = auth.currentUser;
  if (!user?.getIdToken) throw new Error("Sign in is required.");
  const token = await user.getIdToken();
  let response;
  let result;
  try {
    response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    result = await response.json();
  } catch (_error) {
    throw new Error(SERVICE_UNREACHABLE);
  }
  if (!response.ok) throw new Error(result?.error || fallbackError);
  return result;
};

// H2 — events open for registration right now, soonest first, each with only
// the fields an attendee is shown.
export const loadOpenEvents = async () => {
  const result = await callRegistrationService("/api/registrations/open-events", "Events open for registration could not be loaded.");
  return result.events || [];
};
