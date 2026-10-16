// D1 / SCRUM-111 — ordinary event information: the details a coordinator may
// correct during planning without disturbing any booking or reservation (AC1).
// No React and no Firebase here: reviewApi.saveEventEdit and the Edit event form both
// read these rules, and firestore.rules repeats the field list and statuses.

import { editableEventStatuses } from "./significantEventChanges";

// AC1 — exactly these fields. Contact details are the event's own contact, which
// starts as the organiser's profile and may be corrected on the event alone.
export const ORDINARY_FIELDS = [
  { field: "name", label: "Event name", required: true, maxLength: 200 },
  { field: "purpose", label: "Purpose", required: true, maxLength: 2000, multiline: true },
  { field: "description", label: "Description", required: true, maxLength: 5000, multiline: true },
  { field: "contact_name", label: "Contact name", maxLength: 200 },
  { field: "contact_email", label: "Contact email", maxLength: 254, type: "email" },
  { field: "contact_phone", label: "Contact phone", maxLength: 40, type: "tel" },
  { field: "internal_notes", label: "Internal notes", maxLength: 5000, multiline: true }
];

export const ORDINARY_FIELD_NAMES = ORDINARY_FIELDS.map((item) => item.field);

export const ORDINARY_CHANGE_ACTION = "EVENT_DETAILS_UPDATED";

// AC3 — the same planning statuses as a significant change: Approved, Planning,
// Confirmed. Terminal statuses (and anything before approval) are refused.
export const canEditOrdinaryDetails = (event, userId) => Boolean(event
  && userId
  && event.coordinator_id === userId
  && editableEventStatuses.includes(event.status));

// The values the editor starts from. An event with no contact of its own shows
// the organiser's profile, so the coordinator corrects what is actually shown.
export const ordinaryEventValues = (event = {}, organiser = null) => ({
  name: event.name || "",
  purpose: event.purpose || "",
  description: event.description || "",
  contact_name: event.contact_name ?? organiser?.name ?? "",
  contact_email: event.contact_email ?? organiser?.email ?? "",
  contact_phone: event.contact_phone ?? organiser?.phone ?? "",
  internal_notes: event.internal_notes || ""
});

export const cleanOrdinaryValues = (values = {}) => Object.fromEntries(
  ORDINARY_FIELD_NAMES.map((field) => [field, String(values[field] ?? "").trim()])
);

// AC2 — one entry per changed field, each carrying its old and new value.
export const ordinaryEventChanges = (before, after) => {
  const oldValues = cleanOrdinaryValues(before);
  const newValues = cleanOrdinaryValues(after);
  return ORDINARY_FIELD_NAMES
    .filter((field) => oldValues[field] !== newValues[field])
    .map((field) => ({ field, old_value: oldValues[field], new_value: newValues[field] }));
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateOrdinaryEventValues = (values) => {
  const cleaned = cleanOrdinaryValues(values);
  for (const { field, label, required, maxLength } of ORDINARY_FIELDS) {
    if (required && !cleaned[field]) return `${label} is required.`;
    if (cleaned[field].length > maxLength) return `${label} must be ${maxLength} characters or fewer.`;
  }
  if (cleaned.contact_email && !EMAIL.test(cleaned.contact_email)) return "Enter a valid contact email.";
  return "";
};

// --- The Activity tab ------------------------------------------------------
// Every event_history row, newest first, as display lines. Field labels come
// from the ordinary list above, then the significant set, then the raw name.

const SIGNIFICANT_LABELS = {
  expected_attendance: "Expected attendance",
  event_date: "Event date",
  start_time: "Start time",
  end_time: "End time",
  preferred_location: "Preferred location",
  required_layout: "Required layout",
  facilities_required: "Facilities required",
  facilities: "Facilities",
  accessibility_needed: "Accessibility needed",
  accessibility: "Accessibility features",
  accessibility_notes: "Accessibility notes",
  status: "Status",
  coordinator_id: "Coordinator",
  equipment: "Equipment"
};

const ACTION_LABELS = {
  [ORDINARY_CHANGE_ACTION]: "Updated event details",
  SIGNIFICANT_EVENT_DETAILS_CHANGED: "Changed significant details",
  REVIEW_STARTED: "Started review",
  CLARIFICATION_REQUESTED: "Requested clarification",
  CLARIFICATION_RESPONDED: "Responded to clarification",
  EVENT_APPROVED: "Approved the request",
  EVENT_REJECTED: "Rejected the request",
  COORDINATOR_ASSIGNED: "Assigned a coordinator",
  COORDINATOR_REASSIGNED: "Reassigned the coordinator",
  SAFETY_CHECK_REQUESTED: "Sent for safety check",
  SAFETY_CHECK_APPROVED: "Approved the safety check",
  SAFETY_CHECK_REJECTED: "Rejected the safety check",
  SAFETY_CHANGES_REQUESTED: "Requested safety changes",
  VENUE_BOOKING_APPROVED: "Approved a venue booking",
  // Technical Support's decisions, from domain/eventEquipment.equipmentActivity.
  EQUIPMENT_RESERVED: "Approved an equipment reservation",
  EQUIPMENT_RESERVATION_RELEASED: "Released an equipment reservation",
  EQUIPMENT_UNABLE_TO_FULFIL: "Marked equipment unable to fulfil",
  EQUIPMENT_LINE_AMENDED: "Amended an equipment request"
};

// A coordinator may not read Venue Staff or Technical Support profiles, so an
// entry whose actor has no readable name is credited to the role instead.
const ROLE_BY_ACTION = { VENUE_BOOKING_APPROVED: "Venue Staff" };

const ORDINARY_LABELS = Object.fromEntries(ORDINARY_FIELDS.map((item) => [item.field, item.label]));

export const fieldLabel = (field) => ORDINARY_LABELS[field] || SIGNIFICANT_LABELS[field]
  || String(field || "").replaceAll("_", " ");

export const actionLabel = (actionType) => ACTION_LABELS[actionType]
  || String(actionType || "Activity").toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export const shownValue = (value) => {
  if (value === null || value === undefined || value === "") return "(blank)";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(none)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

// A significant change stores every changed field in one row as objects keyed by
// field; split it so each field reads like an ordinary edit.
const changesOf = (entry) => {
  const oldValue = entry.old_value;
  const newValue = entry.new_value;
  const isMap = (value) => value && typeof value === "object" && !Array.isArray(value);
  if (isMap(oldValue) || isMap(newValue)) {
    const fields = [...new Set([...Object.keys(oldValue || {}), ...Object.keys(newValue || {})])];
    return fields.map((field) => ({
      field, label: fieldLabel(field), oldValue: shownValue(oldValue?.[field]), newValue: shownValue(newValue?.[field])
    }));
  }
  if (!entry.field_name && oldValue == null && newValue == null) return [];
  return [{ field: entry.field_name, label: fieldLabel(entry.field_name), oldValue: shownValue(oldValue), newValue: shownValue(newValue) }];
};

export const activityEntries = (history = [], names = {}) => [...history]
  .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
  .map((entry) => ({
    id: entry.id || entry.history_id,
    action: actionLabel(entry.action_type),
    actor: names[entry.actor_id] || entry.actor_role || ROLE_BY_ACTION[entry.action_type] || entry.actor_id || "Unknown user",
    at: entry.created_at || null,
    description: entry.description || null,
    reason: entry.reason || null,
    changes: changesOf(entry)
  }));
