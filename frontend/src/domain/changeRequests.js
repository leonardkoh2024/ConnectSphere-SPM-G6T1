// I1 / SCRUM-147 — an organiser asks for a change to an event they have already
// submitted. The request only proposes: the event itself is not touched until a
// coordinator accepts it (I2). No React and no Firebase here, like the rest of
// domain/; changeRequestsApi writes what these rules build, and firestore.rules
// repeats the statuses, the field names and the reason check.

import { ACCESSIBILITY_OPTIONS, FACILITIES, LAYOUTS, PREFERRED_LOCATIONS } from "./events";
import { todayIso } from "./eventRequest";
import { editableEventStatuses } from "./significantEventChanges";

export const CHANGE_REQUEST_COLLECTION = "change_requests";

// AC4 — every request starts Pending. I2 decides it.
export const PENDING = "PENDING";

export const CHANGE_REQUEST_STATUS_LABELS = {
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  DECLINED: "Declined"
};

export const changeRequestStatusTone = (status) =>
  ({ PENDING: "warning", ACCEPTED: "positive", DECLINED: "danger" })[status] || "neutral";

// AC1 — from Submitted up to and including Confirmed. Draft has nothing to change
// yet (it is still edited directly), and Completed, Cancelled and Rejected are over.
export const CHANGE_REQUEST_EVENT_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "PLANNING", "SAFETY_REVIEW", "CONFIRMED"];

export const canRequestChange = (event, userId) => Boolean(event
  && userId
  && event.organiser_id === userId
  && CHANGE_REQUEST_EVENT_STATUSES.includes(event.status));

const humanise = (value) => String(value).replaceAll("_", " ");
const locationLabel = (value) => PREFERRED_LOCATIONS.find((item) => item.value === value)?.label || value;

// AC2 — the fields an organiser may propose a new value for, in the order the request
// form asks them. `kind` picks the input; lists hold catalogue values. Each name is the
// event's own field, so I2 can apply an accepted value without translating it.
export const CHANGEABLE_FIELDS = [
  { field: "name", label: "Event name", kind: "text", maxLength: 200 },
  { field: "purpose", label: "Purpose", kind: "text", maxLength: 2000 },
  { field: "description", label: "Description", kind: "multiline", maxLength: 5000 },
  { field: "expected_attendance", label: "Expected attendance", kind: "number" },
  { field: "event_date", label: "Date", kind: "date" },
  { field: "start_time", label: "Start time", kind: "time" },
  { field: "end_time", label: "End time", kind: "time" },
  { field: "preferred_location", label: "Preferred location", kind: "select", options: PREFERRED_LOCATIONS.map((item) => item.value), optionLabel: locationLabel },
  { field: "required_layout", label: "Room layout", kind: "select", options: LAYOUTS, optionLabel: humanise },
  { field: "facilities", label: "Facilities", kind: "list", options: FACILITIES, optionLabel: humanise },
  { field: "accessibility", label: "Accessibility needs", kind: "list", options: ACCESSIBILITY_OPTIONS, optionLabel: humanise },
  { field: "accessibility_notes", label: "Accessibility notes", kind: "multiline", maxLength: 2000 }
];

export const CHANGEABLE_FIELD_NAMES = CHANGEABLE_FIELDS.map((item) => item.field);

export const changeableField = (field) => CHANGEABLE_FIELDS.find((item) => item.field === field) || null;

// The event's current values, from the event and the records its request spans
// (venue requirements, facilities, accessibility), in the shapes the fields hold.
export const currentChangeValues = ({ event = {}, requirement = {}, facilities = [], accessibility = [] } = {}) => ({
  name: event.name || "",
  purpose: event.purpose || "",
  description: event.description || "",
  expected_attendance: event.expected_attendance ?? "",
  event_date: event.event_date || "",
  start_time: event.start_time || "",
  end_time: event.end_time || "",
  preferred_location: requirement.preferred_location || "",
  required_layout: requirement.required_layout || "",
  facilities: [...facilities].sort(),
  accessibility: [...accessibility].sort(),
  accessibility_notes: requirement.accessibility_notes || ""
});

// A proposed value as it is stored: trimmed text, a whole number, a sorted list.
const normalise = (field, value) => {
  const kind = changeableField(field)?.kind;
  if (kind === "list") return [...(value || [])].sort();
  if (kind === "number") return value === "" || value === null || value === undefined ? "" : Number(value);
  return String(value ?? "").trim();
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// AC2 — one entry per chosen field, each with the value now and the value proposed,
// the shape significantEventChanges uses, so I2 can show and apply them the same way.
export const proposedChanges = (current, proposed, fields) => Object.fromEntries(
  CHANGEABLE_FIELD_NAMES
    .filter((field) => fields.includes(field))
    .map((field) => [field, { old_value: normalise(field, current[field]), new_value: normalise(field, proposed[field]) }])
);

const validTime = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

// AC2 — what stops a request being sent, in words for the form. The date, times and
// attendance are checked as the event would stand with the change made.
export const changeRequestProblems = ({ current, proposed, fields, reason, today = todayIso() }) => {
  const problems = [];
  if (!fields.length) problems.push("Choose at least one detail to change.");
  fields.forEach((field) => {
    const definition = changeableField(field);
    if (!definition) return;
    const value = normalise(field, proposed[field]);
    if (same(value, normalise(field, current[field]))) problems.push(`${definition.label}: enter a value different from the current one.`);
    else if (definition.kind !== "list" && definition.field !== "accessibility_notes" && value === "") problems.push(`${definition.label} cannot be left blank.`);
    else if (definition.maxLength && String(value).length > definition.maxLength) problems.push(`${definition.label} must be ${definition.maxLength} characters or fewer.`);
  });
  const after = { ...current, ...Object.fromEntries(fields.map((field) => [field, normalise(field, proposed[field])])) };
  if (fields.includes("expected_attendance") && after.expected_attendance !== "" && (!Number.isInteger(after.expected_attendance) || after.expected_attendance < 1)) {
    problems.push("Expected attendance must be a whole number greater than zero.");
  }
  if (fields.includes("event_date") && after.event_date && after.event_date < today) problems.push("The new date cannot be in the past.");
  const timesChosen = fields.includes("start_time") || fields.includes("end_time");
  if (timesChosen && after.start_time && after.end_time) {
    if (!validTime(after.start_time) || !validTime(after.end_time)) problems.push("Enter valid start and end times.");
    else if (after.end_time <= after.start_time) problems.push("The end time must be later than the start time.");
  }
  if (!String(reason || "").trim()) problems.push("Give a reason for the change.");
  return [...new Set(problems)];
};

// A value as it reads on screen: a list joined, a catalogue value by its label, nothing as a dash.
export const changeValueText = (field, value) => {
  const definition = changeableField(field);
  if (Array.isArray(value)) return value.length ? value.map((item) => definition?.optionLabel?.(item) || item).join(", ") : "None";
  if (value === "" || value === null || value === undefined) return "—";
  return definition?.optionLabel ? definition.optionLabel(value) : String(value);
};

// I2 / SCRUM-148 — the coordinator's decision on a Pending request.
export const ACCEPTED = "ACCEPTED";
export const DECLINED = "DECLINED";
export const CHANGE_ACCEPTED = "CHANGE_REQUEST_ACCEPTED";
export const CHANGE_DECLINED = "CHANGE_REQUEST_DECLINED";

// AC3 — a change is applied through the coordinator's edit, which firestore.rules
// allows only while the event is Approved, Planning or Confirmed. Declining has no
// such limit.
export const canApplyChange = (status) => editableEventStatuses.includes(String(status || "").toUpperCase());

// AC2 — declining needs a reason; accepting may carry a note.
export const declineReasonProblem = (reason) => (String(reason || "").trim() ? null : "Give a reason for declining the change.");

// AC1 — which arrangements each field reaches. Venue and equipment follow I3's list of
// significant fields; registrations are counted whenever the size, day or place moves.
const VENUE_FIELDS = ["expected_attendance", "event_date", "start_time", "end_time", "preferred_location", "required_layout", "facilities", "accessibility", "accessibility_notes"];
const EQUIPMENT_FIELDS = ["expected_attendance", "event_date", "start_time", "end_time", "facilities"];
const REGISTRATION_FIELDS = ["expected_attendance", "event_date", "start_time", "end_time", "preferred_location"];

// One section per kind of arrangement the requested fields reach, each naming those
// fields and what is held today. Fields that touch none (name, purpose, description)
// give an empty list: nothing already arranged is affected.
export const affectedArrangements = (fields = [], impact = {}) => {
  const reaching = (list) => fields.filter((field) => list.includes(field));
  const labelsOf = (list) => list.map((field) => changeableField(field)?.label || field);
  const bookings = impact.venueBookings || [];
  const reservations = impact.equipmentReservations || [];
  const registrations = impact.registrationsCount || 0;
  return [
    { key: "venue", title: "Venue bookings", fields: labelsOf(reaching(VENUE_FIELDS)), items: bookings.map((item) => `${item.label} — ${item.status}`), none: "No venue booking is held." },
    { key: "equipment", title: "Equipment reservations", fields: labelsOf(reaching(EQUIPMENT_FIELDS)), items: reservations.map((item) => `${item.label} — ${item.status}`), none: "No equipment is reserved." },
    { key: "registrations", title: "Registrations", fields: labelsOf(reaching(REGISTRATION_FIELDS)), items: registrations ? [`${registrations} registration ${registrations === 1 ? "record" : "records"} on this event`] : [], none: "Nobody has registered." }
  ].filter((section) => section.fields.length);
};

// The edit form's values with the request's new values laid over them. The two switches
// follow the lists, as the form's own toggles do.
export const valuesWithChanges = (base, changes) => {
  const values = { ...base };
  Object.entries(changes).forEach(([field, change]) => { values[field] = change.new_value; });
  if (changes.facilities) values.facilities_required = values.facilities.length > 0;
  if (changes.accessibility || changes.accessibility_notes) values.accessibility_needed = values.accessibility.length > 0 || Boolean(values.accessibility_notes);
  return values;
};

// AC4 — what the organiser is told, naming the event and carrying the reason.
export const changeDecisionMessage = ({ eventName, accepted, reason }) => {
  const why = String(reason || "").trim();
  return `${eventName || "Your event"}: your change request was ${accepted ? "accepted and applied" : "declined"}${why ? ` — ${why}` : "."}`;
};

// AC4 — the notice the assigned coordinator receives, naming the event and the fields.
export const CHANGE_REQUESTED = "CHANGE_REQUESTED";

export const changeRequestedMessage = ({ eventName, fields = [] }) => {
  const labels = fields.map((field) => changeableField(field)?.label || field).map((label) => label.toLowerCase());
  const what = labels.length ? `: ${labels.join(", ")}` : "";
  return `${eventName || "An event"} has a change request waiting for your decision${what}.`;
};
