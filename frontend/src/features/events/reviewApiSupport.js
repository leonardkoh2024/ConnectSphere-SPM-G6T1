// Shared by the event review API modules.

// K5 / SCRUM-186 AC3 — one response for every event the caller may not open (someone
// else's, one they held before it was reassigned, an unassigned one, or an id that does
// not exist), so the answer never says which of those it was and never carries details.
export const NOT_AUTHORISED = "You are not authorised to view this event.";
