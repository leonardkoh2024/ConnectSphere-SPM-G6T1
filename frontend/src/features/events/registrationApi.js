// H1 / SCRUM-139 — the browser's side of the registration service. Registration settings are
// read and saved through the backend, never straight to Firestore: the venue capacity (AC3) and
// the registered count (AC5) live in records an organiser may not read (A4), so the service
// reads them in the same transaction as the write.
//
// The screen works in form strings (registrationCapacity, registrationOpenDate, …, the same
// names as the request form); the service speaks the stored snake_case fields. This adapter
// converts between them and carries the service's refusals — message plus per-field messages —
// to the screen.

import { auth } from "../../lib/firebase";

const SERVICE_UNREACHABLE =
  "The registration service is not responding. Check that the backend is running (npm start), then try again.";

const text = (value) => (value === null || value === undefined ? "" : String(value));

const toScreen = (result) => ({
  settings: {
    registrationCapacity: text(result.settings?.registration_capacity),
    registrationOpenDate: text(result.settings?.registration_open_date),
    registrationOpenTime: text(result.settings?.registration_open_time),
    registrationCloseDate: text(result.settings?.registration_close_date),
    registrationCloseTime: text(result.settings?.registration_close_time)
  },
  venueCapacity: result.venue_capacity ?? null,
  registeredCount: result.registered_count ?? 0,
  phase: result.phase,
  editable: result.editable,
  refusal: result.refusal ?? null
});

// A capacity that is not a whole number goes as typed, so the service answers with its own
// message rather than the browser quietly turning "abc" into NaN.
const toService = (form) => ({
  registration_capacity: /^\d+$/.test(text(form.registrationCapacity).trim()) ? Number(form.registrationCapacity) : form.registrationCapacity,
  registration_open_date: form.registrationOpenDate,
  registration_open_time: form.registrationOpenTime,
  registration_close_date: form.registrationCloseDate,
  registration_close_time: form.registrationCloseTime
});

const callService = async (eventId, method, body) => {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in again.");
  const token = await user.getIdToken();
  let response;
  let result;
  try {
    response = await fetch(`/api/registrations/events/${encodeURIComponent(eventId)}/settings`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: body ? JSON.stringify(body) : undefined
    });
    result = await response.json();
  } catch (_error) {
    throw new Error(SERVICE_UNREACHABLE);
  }
  if (!response.ok) {
    throw Object.assign(new Error(result?.error || "The registration settings could not be saved."), { fields: result?.fields });
  }
  return toScreen(result);
};

export const registrationApi = {
  load: (eventId) => callService(eventId, "GET"),
  save: (eventId, form) => callService(eventId, "PUT", toService(form))
};
