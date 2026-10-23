// Pure workflow rules for C4, C7 and C9. The UI and browser Firestore adapter
// share these checks; firestore.rules remains the authoritative boundary.

import { ROLES } from "./roles";

export const EVENT_STATUS = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  PLANNING: "PLANNING",
  // L1 / A7 — between Planning and Confirmed, while the Safety Officer checks it.
  SAFETY_REVIEW: "SAFETY_REVIEW",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED"
};

export const cleanRequiredText = (value) => String(value || "").trim();

export const isCurrentCoordinator = (event, userId) =>
  Boolean(event && userId && event.coordinator_id === userId);

export const canOpenReview = (event, userId) =>
  isCurrentCoordinator(event, userId) && event.status === EVENT_STATUS.SUBMITTED;

export const canRequestClarification = (event, userId) =>
  isCurrentCoordinator(event, userId) &&
  event.status === EVENT_STATUS.UNDER_REVIEW &&
  !event.open_clarification_id;

export const canRejectEvent = canRequestClarification;

// C6 / SCRUM-107 — approve is offered only to the assigned coordinator (AC3),
// only while the event is Under Review (AC1), and not while a clarification is
// open (AC4). Same boundary as reject/clarify.
export const canApproveEvent = canRequestClarification;

const TERMINAL = new Set([EVENT_STATUS.COMPLETED, EVENT_STATUS.CANCELLED, EVENT_STATUS.REJECTED]);

// F1: venue requests begin only after approval and remain available in Planning.
const VENUE_REQUESTABLE = new Set([EVENT_STATUS.APPROVED, EVENT_STATUS.PLANNING]);
export const canFindVenues = (event) => Boolean(event)
  && VENUE_REQUESTABLE.has(String(event.status || "").toUpperCase());

// Shared "this event is finished" check, so screens filter on the same terminal
// set the guards use rather than keeping their own copy of the statuses.
export const isTerminal = (event) => TERMINAL.has(event?.status);

// A6 / Week 7 change #5 — the Event Coordinator Lead. The Lead oversees every
// event (AC3) and is the only role that assigns a coordinator to a new event or
// reassigns an existing one (AC2). K3 / SCRUM-184 removed the old coordinator-side
// canReassignEvent (C9 criterion 5): a coordinator can no longer hand on their own
// event. These are pure guards; firestore.rules remains the authoritative
// server-side boundary (AC5).
export const isLead = (role) => role === ROLES.COORDINATOR_LEAD;

// AC3 — only the Lead sees the whole event collection rather than a single
// assignment; every other role stays scoped to the events that carry its id.
export const supervisesAllEvents = (role) => isLead(role);

// AC2 (assign) — the Lead gives an unassigned, non-terminal event to an active
// coordinator. An event that already has a coordinator is a reassignment, not an
// assignment, so it is refused here and handled by canLeadReassign instead.
export const canAssignCoordinator = (event, role, targetCoordinator) =>
  isLead(role) &&
  Boolean(event) &&
  !event.coordinator_id &&
  !TERMINAL.has(event.status) &&
  targetCoordinator?.active !== false &&
  Boolean(targetCoordinator?.id);

// AC2 (reassign) — the Lead moves an already-assigned, non-terminal event to a
// different active coordinator. It is keyed on the Lead role, not on holding the
// event, and it refuses handing the event back to the coordinator who already has it.
export const canLeadReassign = (event, role, targetCoordinator) =>
  isLead(role) &&
  Boolean(event?.coordinator_id) &&
  !TERMINAL.has(event.status) &&
  targetCoordinator?.active !== false &&
  Boolean(targetCoordinator?.id) &&
  targetCoordinator.id !== event.coordinator_id;

// K2 / SCRUM-183 — assigning an unassigned event to a coordinator. Three pure
// helpers back the Lead's assignment screen and the Firestore adapter.
// AC1 — the read-only summary the Lead sees before assigning: the event basics
// plus the organiser, and nothing the screen does not already show read-only.
export const assignmentSummary = (event, organiser) => ({
  name: event?.name,
  purpose: event?.purpose,
  eventDate: event?.event_date,
  startTime: event?.start_time,
  endTime: event?.end_time,
  expectedAttendance: event?.expected_attendance,
  organiser: organiser || null
});

// AC2 — each coordinator option carries its current active-event count so the
// Lead can balance load while choosing; the count comes from coordinatorWorkload.
export const coordinatorChoiceLabel = (coordinator) =>
  `${coordinator?.name} (${coordinator?.activeEvents || 0} active)`;

// AC3/AC4/AC5 — the single assignment outcome. It reuses canAssignCoordinator so
// an already-assigned, terminal, inactive-target or no-coordinator-chosen case is
// refused in exactly one place (AC5); records the coordinator, the acting Lead and
// the time (AC3); and names the two people to notify — the new coordinator and the
// organiser (AC4). Pure: the adapter turns `event`, `history` and `notifications`
// into Firestore writes, and firestore.rules stays the authoritative boundary.
export const assignEvent = ({ event, role, leadId, target, now }) => {
  if (!canAssignCoordinator(event, role, target)) return { ok: false };
  return {
    ok: true,
    event: { ...event, coordinator_id: target.id, assigned_at: now },
    history: {
      actionType: "COORDINATOR_ASSIGNED",
      fieldName: "coordinator_id",
      oldValue: null,
      newValue: target.id,
      actorId: leadId,
      createdAt: now
    },
    notifications: [
      { userId: target.id, type: "COORDINATOR_ASSIGNED" },
      { userId: event.organiser_id, type: "COORDINATOR_ASSIGNED" }
    ]
  };
};

// K3 / SCRUM-184 — the single reassignment outcome, mirroring assignEvent. It reuses
// canLeadReassign, so a non-Lead, unassigned, terminal, inactive-target or
// same-coordinator move (AC1/AC2) is refused in exactly one place. On success it
// gives: the event with exactly one coordinator (AC3); the outgoing assignment kept
// with its original time, the reassignment time and the Lead (AC3); the history entry
// (AC3); and the three people to tell (AC5). Because coordinator actions are all keyed
// on event.coordinator_id, the outgoing coordinator loses every one the moment the
// event is saved (AC4). Pure: the adapter turns this into Firestore writes, and
// firestore.rules stays the authoritative boundary.
export const reassignEvent = ({ event, role, leadId, target, now }) => {
  if (!canLeadReassign(event, role, target)) return { ok: false };
  const previousId = event.coordinator_id;
  const previousAssignedAt = event.assigned_at ?? null;
  return {
    ok: true,
    event: { ...event, coordinator_id: target.id, assigned_at: now },
    previousAssignment: { coordinatorId: previousId, assignedAt: previousAssignedAt, endedAt: now, reassignedBy: leadId },
    history: {
      actionType: "COORDINATOR_REASSIGNED",
      fieldName: "coordinator_id",
      oldValue: previousId,
      newValue: target.id,
      actorId: leadId,
      previousAssignedAt,
      createdAt: now
    },
    notifications: [
      { userId: previousId, type: "COORDINATOR_REASSIGNED", audience: "outgoing" },
      { userId: target.id, type: "COORDINATOR_REASSIGNED", audience: "incoming" },
      { userId: event.organiser_id, type: "COORDINATOR_REASSIGNED", audience: "organiser" }
    ].filter((item) => item.userId)
  };
};

// AC3 — the oversight view's workload column: how many live events each
// coordinator is carrying, least-loaded first so the Lead can see at a glance who
// has room before (re)assigning. Terminal and unassigned events are not a current
// load, so they do not count.
export const coordinatorWorkload = (events = [], coordinators = []) =>
  (coordinators || [])
    .map((coordinator) => ({
      id: coordinator.id,
      name: coordinator.name,
      activeEvents: (events || []).filter(
        (item) => item.coordinator_id === coordinator.id && !TERMINAL.has(item.status)
      ).length
    }))
    .sort((a, b) => a.activeEvents - b.activeEvents);

// K1 / SCRUM-182 — events the Lead's board may show at all: everything the
// organiser has submitted, and nothing still in DRAFT. A draft is the organiser's
// unsubmitted work, so it never reaches the Lead in any view (queue or oversight).
// The adapter runs leadBoard's events through this before handing them to the UI.
export const leadVisibleEvents = (events = []) =>
  (events || []).filter((event) => event?.status !== EVENT_STATUS.DRAFT);

// K1 / SCRUM-182 — the Lead's unassigned queue: submitted events still waiting for
// a coordinator, oldest submission first (AC3). An event leaves the moment it has a
// coordinator (AC4). Only a SUBMITTED, still-unassigned event is waiting — a draft
// is not yet submitted, and an under-review/approved/terminal event is not waiting.
export const unassignedQueue = (events = []) =>
  (events || [])
    .filter((event) => event?.status === EVENT_STATUS.SUBMITTED && !event.coordinator_id)
    .sort((a, b) => String(a.submitted_at || "").localeCompare(String(b.submitted_at || "")));

// K4 / SCRUM-185 — the Lead's oversight view: every active event and who is handling
// it, so overloaded coordinators and stalled events stand out. Pure helpers only; the
// view cannot change an event (AC4), assignment and reassignment stay with
// assignEvent / reassignEvent.

// AC1 — an active event is any event not Completed, Cancelled or Rejected.
export const isActiveEvent = (event) => Boolean(event) && !TERMINAL.has(event.status);

// AC1 — when an event was last touched: its last update, else its submission, else
// its creation. null when nothing was ever recorded.
export const lastActivityAt = (event) => event?.updated_at || event?.submitted_at || event?.created_at || null;

// AC1 — milliseconds since that moment, never negative (a clock a little ahead of
// ours reads as "just now", not as a time in the future). null when unknown.
export const timeSinceLastActivity = (event, now = Date.now()) => {
  const at = lastActivityAt(event);
  if (!at) return null;
  const then = new Date(at).getTime();
  const current = new Date(now).getTime();
  if (Number.isNaN(then) || Number.isNaN(current)) return null;
  return Math.max(0, current - then);
};

// AC1 — "time since last activity" as plain words.
export const formatSinceActivity = (ms) => {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "No activity yet";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

// AC1/AC2 — the rows of the list: every active event, optionally narrowed by
// coordinator and/or status (an empty filter means no filter), each a fixed read-only
// summary rather than the event document (AC4). Longest-untouched first so a stalled
// event is at the top; events with no recorded activity go last.
export const oversightRows = (events = [], filters = {}, now = Date.now()) => {
  const { coordinatorId = "", status = "" } = filters || {};
  return (events || [])
    .filter(isActiveEvent)
    .filter((event) => !coordinatorId || event.coordinator_id === coordinatorId)
    .filter((event) => !status || event.status === status)
    .map((event) => ({
      id: event.id,
      name: event.name,
      reference: event.reference_no ?? null,
      coordinatorId: event.coordinator_id || null,
      coordinatorName: event.coordinator_id ? (event.coordinator_name || event.coordinator_id) : null,
      status: event.status,
      proposedDate: event.event_date ?? null,
      sinceLastActivityMs: timeSinceLastActivity(event, now)
    }))
    .sort((a, b) => {
      if (a.sinceLastActivityMs === null && b.sinceLastActivityMs === null) return 0;
      if (a.sinceLastActivityMs === null) return 1;
      if (b.sinceLastActivityMs === null) return -1;
      return b.sinceLastActivityMs - a.sinceLastActivityMs;
    });
};

// AC3 — the coordinators the summary and the coordinator filter are built from: the
// active ones, plus anyone who is no longer active but still holds an active event.
// Without them that coordinator's load would vanish from the very view meant to
// expose it. They are for display only; they are never offered as a reassign target.
export const oversightCoordinators = (events = [], coordinators = []) => {
  const known = new Set((coordinators || []).map((item) => item.id));
  const extra = new Map();
  (events || []).filter(isActiveEvent).forEach((event) => {
    if (event.coordinator_id && !known.has(event.coordinator_id) && !extra.has(event.coordinator_id)) {
      extra.set(event.coordinator_id, { id: event.coordinator_id, name: event.coordinator_name || event.coordinator_id, active: false });
    }
  });
  return [...(coordinators || []), ...extra.values()];
};

// AC3 — active events per coordinator, busiest first (ties by name) so overload is at
// the top. coordinatorWorkload keeps its own fewest-first order for assigning; this
// only re-sorts a copy.
export const oversightSummary = (events = [], coordinators = []) =>
  coordinatorWorkload(events, coordinators)
    .sort((a, b) => b.activeEvents - a.activeEvents || String(a.name).localeCompare(String(b.name)));

export const chronologicalClarifications = (clarifications = [], responses = []) =>
  [
    ...clarifications.map((item) => ({ ...item, kind: "QUESTION" })),
    ...responses.map((item) => ({ ...item, kind: "RESPONSE" }))
  ].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

// The event detail page is split into two tabs, the request and its
// clarifications. The Clarifications tab counts the questions asked, and is
// flagged when the organiser owes an answer — the one case where the viewer has
// something to do there. The organiser lands on it in that case; everyone else
// starts on the request.
export const EVENT_TABS = { REQUEST: "request", ARRANGEMENTS: "arrangements", CLARIFICATIONS: "clarifications", ACTIVITY: "activity", REGISTRATION: "registration" };

export const clarificationSummary = (detail) => ({
  requests: (detail?.clarifications || []).length,
  awaitingOrganiser: Boolean(detail?.event?.open_clarification_id)
});

export const initialEventTab = (detail, { organiser = false } = {}) =>
  organiser && clarificationSummary(detail).awaitingOrganiser ? EVENT_TABS.CLARIFICATIONS : EVENT_TABS.REQUEST;

const SERVER_TIMESTAMP = "SERVER_TIMESTAMP";

export const canAmendDuringClarification = (event) =>
  Boolean(event && event.status === EVENT_STATUS.UNDER_REVIEW && event.open_clarification_id);

// C6 / SCRUM-107 — pure approval transition. Returns the new event state (status
// Approved, AC2) and the history entry to persist (AC5); the deciding coordinator
// and timestamp live on that history record, mirroring reject's EVENT_REJECTED.
// The Firestore write is in features/events/reviewApi.js. Returns ok:false when
// the guard fails, so re-approving an already-approved event is a no-op (AC1).
export const approveEvent = ({ event, userId, now = SERVER_TIMESTAMP }) => {
  if (!canApproveEvent(event, userId)) {
    return { ok: false, event };
  }
  return {
    ok: true,
    event: {
      ...event,
      status: EVENT_STATUS.APPROVED,
      updated_at: now
    },
    history: {
      actionType: "EVENT_APPROVED",
      fieldName: "status",
      oldValue: EVENT_STATUS.UNDER_REVIEW,
      newValue: EVENT_STATUS.APPROVED,
      actorId: userId,
      createdAt: now
    }
  };
};

export const canRespondToClarification = (event, clarification, userId) => {
  if (!event || !clarification || !userId) return false;
  if (clarification.status !== "OPEN") return false;
  const clarificationId = clarification.clarification_id || clarification.id;
  if (event.open_clarification_id !== clarificationId) return false;
  if (event.organiser_id !== userId) return false;
  return true;
};

export const submitClarificationResponse = ({
  event,
  clarification,
  responses = [],
  userId,
  message,
  fieldEdits = {},
  now = SERVER_TIMESTAMP
}) => {
  if (!canRespondToClarification(event, clarification, userId)) {
    return { ok: false, event, clarification, responses };
  }
  if (!cleanRequiredText(message)) {
    return { ok: false, reason: "empty", event, clarification, responses };
  }

  const response = {
    clarification_id: clarification.clarification_id || clarification.id,
    responder_id: userId,
    message: cleanRequiredText(message),
    created_at: now
  };

  return {
    ok: true,
    event: {
      ...event,
      ...fieldEdits,
      open_clarification_id: null,
      status: EVENT_STATUS.UNDER_REVIEW
    },
    clarification: {
      ...clarification,
      status: "ANSWERED",
      responded_at: now
    },
    responses: [...responses, response]
  };
};

// C3 — the coordinator sees everything the organiser submitted in one place.
// These pure helpers shape a reviewApi.detail() payload for the review view:
// organiser contact with fallbacks (AC2), the registration gate/window and the
// equipment lines (AC1), and buildRequestView that assembles the whole model so
// the screen stays a thin render. The Firestore reads live in reviewApi.detail.
// D1 — a contact corrected on the event (contact_name/email/phone) wins over the
// organiser's profile, field by field.
export const contactDetails = (organiser = {}, event = {}) => {
  const source = organiser || {};
  const own = event || {};
  const email = own.contact_email || source.email || null;
  return {
    name: own.contact_name || source.name || email || "Unknown organiser",
    email,
    phone: own.contact_phone || source.phone || source.contact_number || null
  };
};

const joinDateTime = (date, time) => (date ? (time ? `${date} ${time}` : date) : null);

export const registrationSummary = (event = {}) => {
  if (!event || event.registration_required !== "YES") return null;
  return {
    capacity: event.registration_capacity ?? null,
    opens: joinDateTime(event.registration_open_date, event.registration_open_time),
    closes: joinDateTime(event.registration_close_date, event.registration_close_time)
  };
};

export const equipmentList = (event = {}) =>
  ((event && event.equipment) || []).map((line) => ({
    label: `${line.equipment_type} × ${line.quantity || 1}`,
    notes: line.notes || null
  }));

export const buildRequestView = (detail = {}) => {
  const event = (detail && detail.event) || {};
  return {
    reference: event.reference_no || null,
    submittedAt: event.submitted_at || null,
    contact: contactDetails(detail && detail.organiser, event),
    venue: {
      preferredLocation: event.preferred_location || null,
      layout: event.required_layout || null,
      facilities: event.facilities || []
    },
    accessibility: {
      items: event.accessibility || [],
      notes: event.accessibility_notes || null
    },
    equipment: equipmentList(event),
    registration: registrationSummary(event)
  };
};
