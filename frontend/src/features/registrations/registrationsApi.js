// The attendee's side of the registration service. Attendees have no Firestore
// read on `events`, so everything here goes through the backend.

import { auth } from "../../lib/firebase";

const SERVICE_UNREACHABLE =
  "The registration service is not responding. Check that the backend is running (npm start), then try again.";

// When the backend is down, CRA's dev proxy replies with a plain-text "Proxy
// error" page, so a reply that is not JSON (or no reply at all) means the service
// could not be reached.
// A refusal keeps the service's `reason` (for example "full") so the screen can act on it.
const callRegistrationService = async (path, fallbackError, method) => {
  const user = auth.currentUser;
  if (!user?.getIdToken) throw new Error("Sign in is required.");
  const token = await user.getIdToken();
  let response;
  let result;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    response = await fetch(path, method ? { method, headers } : { headers });
    result = await response.json();
  } catch (_error) {
    throw new Error(SERVICE_UNREACHABLE);
  }
  if (!response.ok) throw Object.assign(new Error(result?.error || fallbackError), { reason: result?.reason || null });
  return result;
};

// H2 — events open for registration right now, soonest first, each with only
// the fields an attendee is shown.
export const loadOpenEvents = async () => {
  const result = await callRegistrationService("/api/registrations/open-events", "Events open for registration could not be loaded.");
  return result.events || [];
};

// H3 — register the signed-in attendee for one event. Resolves with the registration and
// the event's details; rejects with the service's message and `reason` when refused.
export const registerForEvent = (eventId) =>
  callRegistrationService(`/api/registrations/events/${encodeURIComponent(eventId)}/register`, "You could not be registered. Try again.", "POST");

// H4 — the signed-in attendee's own registrations, soonest event first, each with the
// status shown and the event fields an attendee may see.
export const loadMyRegistrations = async () => {
  const result = await callRegistrationService("/api/registrations/mine", "Your registrations could not be loaded.");
  return result.registrations || [];
};
