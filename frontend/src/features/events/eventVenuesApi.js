// B10 / SCRUM-101 — the venues an organiser's event has secured. Organisers cannot read
// venue_bookings or venues (A4), so the event service answers with the approved venues'
// names only, from the same contract the attendee listing uses.

import { auth } from "../../lib/firebase";

export const loadEventVenueNames = async (eventId) => {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in again.");
  const token = await user.getIdToken();
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/venues`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error || "The event's venues could not be loaded.");
  return result.venue_names || [];
};
