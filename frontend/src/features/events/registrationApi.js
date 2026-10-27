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

// One signed request to the registration service. `path` is what follows the event id
// ("settings", "attendees"); `fallback` words the refusal when the service gives no message.
const callService = async (eventId, path, method, body, fallback) => {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in again.");
  const token = await user.getIdToken();
  let response;
  let result;
  try {
    response = await fetch(`/api/registrations/events/${encodeURIComponent(eventId)}/${path}`, {
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
    throw Object.assign(new Error(result?.error || fallback), { fields: result?.fields });
  }
  return result;
};

const SAVE_FAILED = "The registration settings could not be saved.";

// H8 / SCRUM-146 — the organiser's list: the people registered (name, contact details, time)
// and the registered / waitlisted / withdrawn counts. Waitlisted and withdrawn people are
// counts only; the service sends no one else.
const toList = (result) => ({
  counts: {
    registered: result.counts?.registered ?? 0,
    waitlisted: result.counts?.waitlisted ?? 0,
    withdrawn: result.counts?.withdrawn ?? 0
  },
  attendees: (result.attendees || []).map((item) => ({
    id: item.registration_id,
    attendeeId: item.attendee_id,
    name: item.name ?? null,
    email: item.email ?? null,
    mobileNumber: item.mobile_number ?? null,
    registeredAt: item.registered_at ?? null
  }))
});

export const registrationApi = {
  load: async (eventId) => toScreen(await callService(eventId, "settings", "GET", undefined, SAVE_FAILED)),
  save: async (eventId, form) => toScreen(await callService(eventId, "settings", "PUT", toService(form), SAVE_FAILED)),
  loadAttendees: async (eventId) => toList(await callService(eventId, "attendees", "GET", undefined, "The registration list could not be loaded."))
};
