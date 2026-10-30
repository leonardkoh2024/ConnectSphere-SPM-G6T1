// L1 / SCRUM-187, L2 / SCRUM-188, L3 / SCRUM-189, L4 / SCRUM-190,
// J7 / SCRUM-156, J8 / SCRUM-191, J9 / SCRUM-192.
// Plain functions: no React, no Firebase. test.js calls these.

const PLANNING = "PLANNING";
const APPROVED = "APPROVED";
const SAFETY_REVIEW = "SAFETY_REVIEW";
const CONFIRMED = "CONFIRMED";
const CANCELLED = "CANCELLED";
const SUBMITTED = "SUBMITTED";
const REVIEW_REQUIRED = "Review required";
const NOT_RECORDED = "Not recorded";
const SERVER_TIMESTAMP = "SERVER_TIMESTAMP";

const SAFETY_OFFICER = "SAFETY_OFFICER";
const COORDINATOR_LEAD = "EVENT_COORDINATOR_LEAD";
const VENUE_STAFF = "VENUE_STAFF";
const TECH_SUPPORT = "TECHNICAL_SUPPORT_STAFF";

const OUTCOMES = ["APPROVE", "REJECT", "REQUEST_CHANGES"];
const INACTIVE_BOOKING = new Set(["RELEASED", "REPLACED", "CANCELLED", "EXPIRED", "WITHDRAWN"]);
const SENDABLE = new Set([PLANNING, APPROVED]);

const text = (value) => {
  const trimmed = String(value ?? "").trim();
  return trimmed || NOT_RECORDED;
};

const activePeople = (people, role) =>
  people.filter((person) => person.role === role && person.active !== false && person.user_id);

const activeBookings = (bookings) =>
  bookings.filter((booking) => {
    const status = String(booking.status || "").toUpperCase();
    if (status === "REJECTED") {
      return booking.requires_re_request === true || booking.replacement_needed === true;
    }
    return !INACTIVE_BOOKING.has(status);
  });

const requestedTechnical = (arrangements) =>
  arrangements.filter((item) => item.requested !== false);

const arrangementLabel = (item, fallback) => item.label || item.booking_label || item.venue_name
  || item.arrangement_id || item.booking_id || item.venue_id || fallback;

function outstandingForSafetyCheck({ bookings = [], technicalArrangements = [] } = {}) {
  const outstanding = [];
  const activeVenueBookings = activeBookings(bookings);
  if (!activeVenueBookings.length) outstanding.push("an approved venue booking");
  activeVenueBookings.forEach((booking) => {
    const label = arrangementLabel(booking, "venue booking");
    if (String(booking.status || "").toUpperCase() !== "APPROVED") outstanding.push(label);
    else if (booking.replacement_needed === true) outstanding.push(`${label} needs a replacement`);
    if (booking.review_status === REVIEW_REQUIRED) outstanding.push(`${label} still needs review`);
  });
  requestedTechnical(technicalArrangements).forEach((item) => {
    const label = arrangementLabel(item, "technical arrangement");
    if (String(item.status || "").toUpperCase() !== "CONFIRMED") outstanding.push(label);
    if (item.review_status === REVIEW_REQUIRED) outstanding.push(`${label} still needs review`);
  });
  return outstanding;
}

function safetyOfficerNotices({ event, officers, previousReviews = [], type, message, link }) {
  const checkedBefore = Boolean(event.returned_to_planning_at) || previousReviews.length > 0;
  const body = checkedBefore && type === "SAFETY_REVIEW_WAITING"
    ? `${message} It has been checked before.`
    : message;
  return activePeople(officers, SAFETY_OFFICER).map((officer) => ({
    user_id: officer.user_id,
    event_id: event.event_id,
    type,
    message: body,
    is_read: false,
    link,
    checked_before: checkedBefore && type === "SAFETY_REVIEW_WAITING"
  }));
}

function sendForSafetyCheck({
  event,
  bookings = [],
  technicalArrangements = [],
  safetyOfficers = [],
  previousReviews = [],
  now = SERVER_TIMESTAMP
} = {}) {
  if (!event) return { ok: false, reason: "required" };
  if (!SENDABLE.has(event.status)) return { ok: false, reason: "status", event };
  const outstanding = outstandingForSafetyCheck({ bookings, technicalArrangements });
  if (outstanding.length) return { ok: false, reason: "outstanding", outstanding, event };
  const venues = [...new Set(activeBookings(bookings).map((booking) => booking.venue_name || booking.venue_id).filter(Boolean))];
  const message = `${event.name || "An event"} on ${event.event_date || "a date not recorded"} at ${venues.join(", ") || "no venue"} for ${event.expected_attendance ?? "an unrecorded number"} is waiting for its safety check.`;
  return {
    ok: true,
    outstanding: [],
    event: { ...event, status: SAFETY_REVIEW, safety_review_requested_at: now },
    notifications: safetyOfficerNotices({
      event,
      officers: safetyOfficers,
      previousReviews,
      type: "SAFETY_REVIEW_WAITING",
      message,
      link: { screen: "Safety review", event_id: event.event_id }
    })
  };
}

function passedSafetyCheckAfterPlanning(event, reviews = []) {
  const since = event?.returned_to_planning_at || "";
  return reviews.some((review) => review.event_id === event?.event_id
    && review.outcome === "APPROVE"
    && String(review.decided_at || "") > String(since));
}

function confirmEvent({ event, reviews = [] } = {}) {
  if (!event) return { ok: false, reason: "required" };
  if (!passedSafetyCheckAfterPlanning(event, reviews)) {
    return { ok: false, reason: "safety_check_required", event };
  }
  return { ok: true, event: { ...event, status: CONFIRMED } };
}

const waitingSince = (event) => String(event.safety_review_requested_at || event.updated_at || "");

function safetyReviewQueue(events = []) {
  return events
    .filter((event) => event.status === SAFETY_REVIEW)
    .sort((left, right) => waitingSince(left).localeCompare(waitingSince(right)))
    .map((event) => ({
      event_id: event.event_id,
      name: event.name || "Untitled event",
      date: event.event_date || null,
      venues: event.venues || [],
      expected_attendance: event.expected_attendance ?? null
    }));
}

function safetyReviewFacts({ event, bookings = [], venues = [], equipment = [], reviews = [] } = {}) {
  const venueById = new Map(venues.map((venue) => [venue.venue_id, venue]));
  return {
    bookings: activeBookings(bookings).filter((booking) => booking.event_id === event.event_id).map((booking) => {
      const venue = venueById.get(booking.venue_id) || {};
      const attendance = Number(event.expected_attendance) > 0 ? Number(event.expected_attendance) : null;
      const capacity = Number(venue.max_capacity) > 0 ? Number(venue.max_capacity) : null;
      return {
        booking_id: booking.booking_id,
        attendance,
        capacity,
        required_layout: text(booking.required_layout),
        emergency_access: text(venue.emergency_access),
        restrictions: text(venue.restrictions)
      };
    }),
    accessibility: text(event.accessibility_requirements),
    reserved_equipment: equipment
      .filter((item) => item.event_id === event.event_id && String(item.status || "").toUpperCase() === "RESERVED")
      .map((item) => ({ equipment_id: item.equipment_id, label: item.label || item.equipment_id })),
    equipment_placement: text(event.equipment_placement),
    crowd_movement: text(event.crowd_movement),
    previous_outcomes: reviews
      .filter((review) => review.event_id === event.event_id)
      .map((review) => ({ outcome: review.outcome, comment: review.comment || "", decided_at: review.decided_at || null }))
  };
}

function flaggedScope(outcome, marked) {
  if (outcome === "REJECT") return new Set(["venue", "technical"]);
  const chosen = new Set(marked);
  if (chosen.has("both")) return new Set(["venue", "technical"]);
  return new Set([...chosen].filter((item) => item === "venue" || item === "technical"));
}

function flagArrangements({ bookings, technicalArrangements, scope }) {
  const bookingsNext = bookings.map((booking) => (
    scope.has("venue") && !INACTIVE_BOOKING.has(String(booking.status || "").toUpperCase())
      ? { ...booking, review_status: REVIEW_REQUIRED }
      : { ...booking }
  ));
  const technicalNext = technicalArrangements.map((item) => (
    scope.has("technical") && item.requested !== false
      ? { ...item, review_status: REVIEW_REQUIRED }
      : { ...item }
  ));
  return { bookings: bookingsNext, technicalArrangements: technicalNext };
}

function staffNotices({ event, bookings, technicalArrangements, comment }) {
  const notices = [];
  bookings.filter((booking) => booking.review_status === REVIEW_REQUIRED && booking.assigned_staff_id).forEach((booking) => {
    notices.push({
      user_id: booking.assigned_staff_id,
      role: VENUE_STAFF,
      event_id: event.event_id,
      type: "ARRANGEMENT_REVIEW_REQUIRED",
      message: `${event.name || "An event"}: ${arrangementLabel(booking, "venue booking")} is marked ${REVIEW_REQUIRED}. ${comment}`,
      is_read: false
    });
  });
  technicalArrangements.filter((item) => item.review_status === REVIEW_REQUIRED && item.assigned_staff_id).forEach((item) => {
    notices.push({
      user_id: item.assigned_staff_id,
      role: TECH_SUPPORT,
      event_id: event.event_id,
      type: "ARRANGEMENT_REVIEW_REQUIRED",
      message: `${event.name || "An event"}: ${arrangementLabel(item, "technical arrangement")} is marked ${REVIEW_REQUIRED}. ${comment}`,
      is_read: false
    });
  });
  return notices;
}

function recordSafetyOutcome({
  event,
  outcome,
  comment = "",
  marked = [],
  officerId,
  bookings = [],
  technicalArrangements = [],
  now = SERVER_TIMESTAMP
} = {}) {
  if (!event) return { ok: false, reason: "required" };
  if (event.status !== SAFETY_REVIEW) return { ok: false, reason: "not_in_review", event };
  if (!OUTCOMES.includes(outcome)) return { ok: false, reason: "outcome" };
  const note = String(comment || "").trim();
  if ((outcome === "REJECT" || outcome === "REQUEST_CHANGES") && !note) {
    return { ok: false, reason: "comment_required", event };
  }
  const review = {
    event_id: event.event_id,
    outcome,
    comment: note,
    safety_officer_id: officerId,
    decided_at: now
  };
  const history = { ...review, record: "event_history" };
  if (outcome === "APPROVE") {
    const recipients = [event.coordinator_id, event.organiser_id].filter(Boolean);
    return {
      ok: true,
      review,
      history,
      bookings,
      technicalArrangements,
      event: { ...event, status: CONFIRMED, last_safety_review_id: review.decided_at },
      notifications: recipients.map((userId) => ({
        user_id: userId,
        event_id: event.event_id,
        type: "SAFETY_CHECK_APPROVED",
        message: `${event.name || "Your event"} passed its safety check and is now Confirmed.`,
        is_read: false
      }))
    };
  }
  const scope = flaggedScope(outcome, marked);
  const flagged = flagArrangements({ bookings, technicalArrangements, scope });
  const recipients = event.coordinator_id ? [event.coordinator_id] : [];
  return {
    ok: true,
    review,
    history,
    ...flagged,
    event: { ...event, status: PLANNING, returned_to_planning_at: now, last_safety_review_id: review.decided_at },
    notifications: [
      ...recipients.map((userId) => ({
        user_id: userId,
        event_id: event.event_id,
        type: outcome === "REJECT" ? "SAFETY_CHECK_REJECTED" : "SAFETY_CHANGES_REQUESTED",
        message: `${event.name || "Your event"} is back in Planning. Comment: ${note}`,
        is_read: false
      })),
      ...staffNotices({ event, ...flagged, comment: note })
    ]
  };
}

function attendeeChangeNotices({ event, attendees = [], change } = {}) {
  const name = event?.name || "An event";
  const kind = change?.kind;
  const detail = String(change?.detail || "").trim();
  const messages = {
    REGISTRATION_CONFIRMED: `${name}: your registration is confirmed.`,
    CANCELLED: `${name} was cancelled.`,
    DATE: `${name}: the date changed to ${detail}.`,
    TIME: `${name}: the time changed to ${detail}.`,
    VENUE: `${name}: the venue changed to ${detail}.`,
    PLACE_OPENED: `${name}: a place has opened and you are invited to apply.`
  };
  const audience = kind === "PLACE_OPENED" ? "WAITLISTED" : "REGISTERED";
  if (!messages[kind]) return [];
  return attendees
    .filter((person) => person.status === audience)
    .map((person) => ({
      user_id: person.user_id,
      event_id: event.event_id,
      type: kind,
      message: messages[kind],
      is_read: false
    }));
}

const unreadCount = (notifications = []) => notifications.filter((item) => item.is_read !== true).length;

function markNotificationRead(notifications = [], notificationId) {
  const next = notifications.map((item) => (
    item.notification_id === notificationId ? { ...item, is_read: true } : item
  ));
  const unread = unreadCount(next);
  return { notifications: next, unread, badge: unread > 0 ? String(unread) : null };
}

function unassignedQueue(events = []) {
  return events.filter((event) => event.status === SUBMITTED && !event.coordinator_id);
}

function leadQueueNotices({ event, leads, type, message }) {
  return activePeople(leads, COORDINATOR_LEAD).map((lead) => ({
    user_id: lead.user_id,
    event_id: event.event_id,
    type,
    message,
    is_read: false,
    link: { screen: "Unassigned queue", event_id: event.event_id, read_only: true }
  }));
}

function eventEnteredUnassignedQueue({ event, leads = [] } = {}) {
  if (!event || event.status !== SUBMITTED || event.coordinator_id) return { ok: false, reason: "not_unassigned", notifications: [] };
  const message = `${event.name} submitted by ${event.organiser_name} for ${event.event_date} at ${event.submitted_at} is waiting for a coordinator.`;
  return {
    ok: true,
    notifications: leadQueueNotices({ event, leads, type: "UNASSIGNED_EVENT", message })
  };
}

function openLeadAssignmentNotice({ event } = {}) {
  if (event?.coordinator_id) {
    return { current_coordinator_id: event.coordinator_id, offer_assignment: false };
  }
  return { current_coordinator_id: null, offer_assignment: true };
}

function cancelUnassignedEvent({ event, leads = [] } = {}) {
  if (!event || event.coordinator_id || event.status !== SUBMITTED) {
    return { ok: false, reason: "not_unassigned", event };
  }
  const cancelled = { ...event, status: CANCELLED };
  return {
    ok: true,
    event: cancelled,
    queue: unassignedQueue([cancelled]),
    notifications: leadQueueNotices({
      event,
      leads,
      type: "UNASSIGNED_EVENT_CANCELLED",
      message: `${event.name} was cancelled and has left the unassigned queue.`
    })
  };
}

function cancelSafetyReview({ event, safetyOfficers = [] } = {}) {
  if (!event || event.status !== SAFETY_REVIEW) return { ok: false, reason: "not_in_review", event };
  const cancelled = { ...event, status: CANCELLED };
  return {
    ok: true,
    event: cancelled,
    queue: safetyReviewQueue([cancelled]),
    notifications: safetyOfficerNotices({
      event,
      officers: safetyOfficers,
      type: "SAFETY_REVIEW_CANCELLED",
      message: `${event.name || "An event"} was cancelled and has left the safety review queue.`,
      link: { screen: "Safety review", event_id: event.event_id }
    })
  };
}

function openSafetyReviewNotice({ event } = {}) {
  if (event?.status !== SAFETY_REVIEW) {
    return {
      left_queue: true,
      message: `${event?.name || "This event"} has left the safety review queue.`,
      details: null,
      offer_outcome: false
    };
  }
  return {
    left_queue: false,
    message: null,
    details: {
      name: event.name,
      date: event.event_date,
      venues: event.venues || [],
      expected_attendance: event.expected_attendance ?? null
    },
    offer_outcome: true
  };
}

module.exports = {
  REVIEW_REQUIRED,
  NOT_RECORDED,
  outstandingForSafetyCheck,
  sendForSafetyCheck,
  passedSafetyCheckAfterPlanning,
  confirmEvent,
  safetyReviewQueue,
  safetyReviewFacts,
  recordSafetyOutcome,
  attendeeChangeNotices,
  unreadCount,
  markNotificationRead,
  unassignedQueue,
  eventEnteredUnassignedQueue,
  openLeadAssignmentNotice,
  cancelUnassignedEvent,
  cancelSafetyReview,
  openSafetyReviewNotice
};
