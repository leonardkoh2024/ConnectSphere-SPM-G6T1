// A7 / SCRUM-170 — the Safety Officer's reads and outcome, and the coordinator's
// safety planning notes. Browser Firebase SDK, like the rest of the frontend:
// firestore.rules lets the Safety Officer read an event and its facts only while
// it is in Safety Review, and write only the outcome of its check (AC6).

import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { EVENT_STATUS } from "../../domain/eventReview";
import { eventHistoryRecord, notificationRecord } from "../../domain/eventReviewRecords";
import {
  SAFETY_OUTCOME,
  activeBookings,
  canEditPlanningNotes,
  canRecordSafetyOutcome,
  capacityFact,
  cleanPlanningNotes,
  safetyApprovalBlocker,
  safetyNotificationType,
  safetyOutcomeMessage,
  safetyOutcomeStatus,
  safetyQueue,
  validatePlanningNotes,
  validateSafetyOutcome
} from "../../domain/safetyReview";
import { REVIEW_REQUIRED, recordSafetyOutcome as planSafetyReturn, sendForSafetyCheck } from "../../domain/safetyAndNotices";
import { callEquipmentService } from "../equipment/equipmentApi";
import { asIso, requireUser } from "../../lib/apiSupport";

const byEvent = (name, eventId) => getDocs(query(collection(db, name), where("event_id", "==", eventId)));

// A refused read says which collection it was, so a rule gap shows on screen.
const reading = (name, promise) => promise.catch((failure) => {
  throw new Error(`${failure.message} (Reading ${name}.)`);
});

const venuesById = async (venueIds) => {
  const snapshots = await Promise.all([...new Set(venueIds.filter(Boolean))].map((venueId) => getDoc(doc(db, "venues", venueId))));
  return new Map(snapshots.filter((item) => item.exists()).map((item) => [item.id, item.data()]));
};

// AC2 — the events awaiting their check. The query must filter on status: the
// events rule lets the Safety Officer list nothing else.
export const listSafetyQueue = async () => {
  requireUser();
  const events = await getDocs(query(collection(db, "events"), where("status", "==", EVENT_STATUS.SAFETY_REVIEW)));
  const withBookings = await Promise.all(events.docs.map(async (item) => ({
    event: { id: item.id, ...item.data(), updated_at: asIso(item.data().updated_at), safety_review_requested_at: asIso(item.data().safety_review_requested_at) },
    bookings: activeBookings((await byEvent("venue_bookings", item.id)).docs.map((booking) => booking.data()))
  })));
  const venues = await venuesById(withBookings.flatMap(({ bookings }) => bookings.map((booking) => booking.venue_id)));
  return safetyQueue(withBookings.map(({ event, bookings }) => ({
    ...event,
    venue_names: bookings.map((booking) => venues.get(booking.venue_id)?.name || booking.venue_id)
  })));
};

// AC3 — every fact the review needs, for one event in Safety Review.
export const safetyReviewDetail = async (eventId) => {
  requireUser();
  const eventSnapshot = await reading("events", getDoc(doc(db, "events", eventId)));
  if (!eventSnapshot.exists()) throw new Error("Event not found.");
  const event = { id: eventSnapshot.id, ...eventSnapshot.data() };
  if (event.status !== EVENT_STATUS.SAFETY_REVIEW) throw new Error("This event is not awaiting a safety check.");

  // Every read is a query on event_id. The requirements are one document per
  // event, but a direct read of one that was never written is refused (its rule
  // reads resource.data.event_id); the query just comes back empty.
  const [requirement, accessibility, equipment, reservations, bookingRows, reviews] = await Promise.all(
    ["event_venue_requirements", "event_accessibility", "event_equipment", "equipment_reservations", "venue_bookings", "safety_reviews"]
      .map((name) => reading(name, byEvent(name, eventId)))
  );
  const requirements = requirement.docs[0]?.data() || {};
  const bookings = activeBookings(bookingRows.docs.map((item) => ({ booking_id: item.id, ...item.data() })));
  const venues = await reading("venues", venuesById(bookings.map((booking) => booking.venue_id)));

  return {
    event: {
      ...event,
      required_layout: requirements.required_layout || null,
      accessibility: accessibility.docs.map((item) => item.data().accessibility_id).filter(Boolean),
      accessibility_notes: requirements.accessibility_notes || "",
      equipment: equipment.docs.map((item) => ({
        equipment_type: item.data().equipment_type,
        quantity: item.data().quantity || 1,
        notes: item.data().technical_note || item.data().notes || null
      })),
      equipment_placement: event.equipment_placement || "",
      crowd_movement: event.crowd_movement || ""
    },
    bookings: bookings.map((booking) => {
      const venue = venues.get(booking.venue_id) || {};
      return {
        booking_id: booking.booking_id,
        venue_id: booking.venue_id,
        venue_name: venue.name || booking.venue_id,
        label: booking.booking_label || venue.name || booking.venue_id,
        status: booking.status,
        start_datetime: asIso(booking.start_datetime),
        end_datetime: asIso(booking.end_datetime),
        ...capacityFact({ attendance: booking.expected_attendance ?? event.expected_attendance, capacity: venue.max_capacity }),
        layout: booking.layout_snapshot || booking.requested_layout_id || requirements.required_layout || null,
        emergency_access_notes: venue.emergency_access_notes || "",
        known_restrictions: venue.known_restrictions || ""
      };
    }),
    // Only what is actually reserved: released stock will not be in the room.
    reservations: reservations.docs
      .filter((item) => item.data().status === "RESERVED")
      .map((item) => ({ reservation_id: item.id, equipment_type: item.data().equipment_type, quantity: item.data().quantity })),
    // L2 AC4 — earlier checks, in the order they were made.
    reviews: reviews.docs
      .map((item) => ({ review_id: item.id, ...item.data(), decided_at: asIso(item.data().decided_at) }))
      .sort((a, b) => String(a.decided_at || "").localeCompare(String(b.decided_at || "")))
  };
};

// AC4 — one commit: the write-once safety_reviews record, the event moved to
// the status it names, the history entry, and the coordinator and organiser
// told. firestore.rules (safetyOutcomeUpdate) refuses the event move unless the
// record written alongside it matches.
export const recordSafetyOutcome = async ({ eventId, outcome, comment, marked }) => {
  const user = requireUser();
  const invalid = validateSafetyOutcome({ outcome, comment });
  if (invalid) throw new Error(invalid);
  const note = String(comment || "").trim() || null;
  const status = safetyOutcomeStatus(outcome);
  const type = safetyNotificationType(outcome);

  // F12 — Approve needs every active booking approved. L4 also reads them so a
  // concern can flag the ones the Safety Officer named. A query cannot run
  // inside a transaction, so the bookings are read just before it.
  const bookingRows = await byEvent("venue_bookings", eventId);
  const bookings = bookingRows.docs.map((item) => ({
    booking_id: item.id,
    venue_name: item.data().venue_name || item.data().booking_label,
    ...item.data()
  }));
  const loadedRequest = outcome === SAFETY_OUTCOME.APPROVE ? null : await getDoc(doc(db, "equipment_requests", eventId));
  const requestSnapshot = loadedRequest || null;
  const technicalArrangements = technicalArrangementsFrom(requestSnapshot?.exists?.() ? requestSnapshot.data() : null);
  const eventRef = doc(db, "events", eventId);
  const actorRef = doc(db, "users", user.uid);
  const reviewRef = doc(collection(db, "safety_reviews"));
  const historyRef = doc(collection(db, "event_history"));
  await runTransaction(db, async (tx) => {
    const [eventSnapshot, actorSnapshot] = await Promise.all([tx.get(eventRef), tx.get(actorRef)]);
    if (!eventSnapshot.exists()) throw new Error("Event not found.");
    const event = eventSnapshot.data();
    const role = actorSnapshot.exists() ? actorSnapshot.data().role : null;
    if (!canRecordSafetyOutcome(event, role)) throw new Error("Outcomes can be recorded only by the Safety Officer, on an event in Safety Review.");
    if (outcome === SAFETY_OUTCOME.APPROVE) {
      const blocker = safetyApprovalBlocker(event, bookings);
      if (blocker) throw new Error(blocker);
    }

    const decidedAt = serverTimestamp();
    const planned = outcome === SAFETY_OUTCOME.APPROVE ? null : planSafetyReturn({
      event: { event_id: eventId, ...event },
      outcome,
      comment: note,
      marked: marked || ["both"],
      officerId: user.uid,
      bookings,
      technicalArrangements
    });
    if (planned && !planned.ok) throw new Error("The safety outcome could not be recorded.");
    const eventUpdate = { status, last_safety_review_id: reviewRef.id, updated_at: decidedAt };
    if (status === EVENT_STATUS.PLANNING) eventUpdate.returned_to_planning_at = decidedAt;
    // D3 AC4 — the moment of confirmation, a server time shown in SGT.
    if (status === EVENT_STATUS.CONFIRMED) eventUpdate.confirmed_at = decidedAt;
    if (planned?.technicalArrangements.some((item) => item.review_status === REVIEW_REQUIRED)) {
      eventUpdate.technical_review_status = REVIEW_REQUIRED;
    }
    tx.set(reviewRef, { review_id: reviewRef.id, event_id: eventId, reviewer_id: user.uid, outcome, comment: note, decided_at: decidedAt });
    tx.update(eventRef, eventUpdate);
    (planned?.bookings || []).filter((booking) => booking.review_status === REVIEW_REQUIRED).forEach((booking) => {
      tx.update(doc(db, "venue_bookings", booking.booking_id), { review_status: REVIEW_REQUIRED });
    });
    tx.set(historyRef, eventHistoryRecord({
      historyId: historyRef.id, eventId, actorId: user.uid, actionType: type,
      fieldName: "status", oldValue: EVENT_STATUS.SAFETY_REVIEW, newValue: status,
      description: note || "Safety Officer approved the event's safety check.", createdAt: decidedAt
    }));
    const message = safetyOutcomeMessage({ eventName: event.name || event.reference_no, outcome, comment: note });
    [...new Set([event.coordinator_id, event.organiser_id].filter(Boolean))].forEach((recipient) => {
      const notificationRef = doc(collection(db, "notifications"));
      tx.set(notificationRef, notificationRecord({ notificationId: notificationRef.id, userId: recipient, eventId, type, message, createdAt: decidedAt }));
    });
    (planned?.notifications || []).filter((notice) => notice.type === "ARRANGEMENT_REVIEW_REQUIRED").forEach((notice) => {
      const notificationRef = doc(collection(db, "notifications"));
      tx.set(notificationRef, notificationRecord({
        notificationId: notificationRef.id, userId: notice.user_id, eventId, type: notice.type, message: notice.message, createdAt: decidedAt
      }));
    });
  });
  // D3 AC5 — the organiser and coordinator are told in the commit above; Technical
  // Support cannot be listed from a browser, so the equipment service tells them.
  // A failure leaves the confirmation standing and is only logged.
  if (outcome === SAFETY_OUTCOME.APPROVE) {
    try {
      await callEquipmentService(
        user,
        `/api/equipment/requests/${encodeURIComponent(eventId)}/notify-confirmed`,
        "POST",
        {},
        "Technical Support could not be told the event is confirmed."
      );
    } catch (notifyError) {
      console.error("Technical Support could not be told the event is confirmed.", notifyError);
    }
  }
  return { ok: true, reviewId: reviewRef.id, status };
};

const technicalArrangementsFrom = (request) => (request?.lines || []).map((line, index) => ({
  arrangement_id: line.line_id || line.equipment_type || `line-${index}`,
  label: line.label || line.equipment_type || `Technical arrangement ${index + 1}`,
  requested: true,
  status: ["RESERVED", "CONFIRMED"].includes(String(line.status || "").toUpperCase()) ? "CONFIRMED" : "PENDING",
  review_status: line.review_status,
  assigned_staff_id: line.assigned_staff_id || request.assigned_staff_id || null
}));

// L1 / SCRUM-187 — the assigned coordinator sends the event once every active
// booking is approved and every requested technical arrangement is confirmed.
export const sendEventForSafetyCheck = async (eventId) => {
  const user = requireUser();
  const eventRef = doc(db, "events", eventId);
  const eventSnapshot = await getDoc(eventRef);
  if (!eventSnapshot.exists()) throw new Error("Event not found.");
  const event = { event_id: eventId, ...eventSnapshot.data() };
  if (event.coordinator_id !== user.uid) throw new Error("Only the assigned coordinator can send this event for its safety check.");

  const [bookingRows, requestSnapshot, reviewRows, officerRows] = await Promise.all([
    byEvent("venue_bookings", eventId),
    getDoc(doc(db, "equipment_requests", eventId)).catch(() => null),
    byEvent("safety_reviews", eventId),
    getDocs(query(collection(db, "users"), where("role", "==", "SAFETY_OFFICER"), where("is_active", "==", true)))
  ]);
  const decision = sendForSafetyCheck({
    event,
    bookings: bookingRows.docs.map((item) => ({ booking_id: item.id, venue_name: item.data().venue_name || item.data().booking_label, ...item.data() })),
    technicalArrangements: [
      ...technicalArrangementsFrom(requestSnapshot?.exists?.() ? requestSnapshot.data() : null),
      ...(event.technical_review_status === REVIEW_REQUIRED ? [{
        arrangement_id: "technical",
        label: "Technical arrangements",
        requested: true,
        status: "CONFIRMED",
        review_status: REVIEW_REQUIRED
      }] : [])
    ],
    safetyOfficers: officerRows.docs.map((item) => ({ user_id: item.id, role: item.data().role, active: item.data().is_active !== false })),
    previousReviews: reviewRows.docs.map((item) => item.data())
  });
  if (!decision.ok) {
    if (decision.reason === "outstanding") {
      throw new Error(`Send for safety check is unavailable. Outstanding: ${decision.outstanding.join(", ")}.`);
    }
    throw new Error("Send for safety check is not available for this event.");
  }

  const sentAt = serverTimestamp();
  await runTransaction(db, async (tx) => {
    const current = await tx.get(eventRef);
    if (!current.exists() || current.data().coordinator_id !== user.uid) {
      throw new Error("Only the assigned coordinator can send this event for its safety check.");
    }
    tx.update(eventRef, { status: EVENT_STATUS.SAFETY_REVIEW, safety_review_requested_at: sentAt, updated_at: sentAt });
    decision.notifications.forEach((notice) => {
      const notificationRef = doc(collection(db, "notifications"));
      tx.set(notificationRef, {
        ...notificationRecord({
          notificationId: notificationRef.id,
          userId: notice.user_id,
          eventId,
          type: notice.type,
          message: notice.message,
          createdAt: sentAt
        }),
        link_screen: notice.link?.screen || "Safety review",
        checked_before: notice.checked_before === true
      });
    });
  });
  return { ok: true, status: EVENT_STATUS.SAFETY_REVIEW };
};

// AC3 — the coordinator's equipment placement and crowd movement notes, kept in
// the event history like any other edit. coordinatorSafetyNotesUpdate in
// firestore.rules allows exactly these fields, in the same statuses.
export const savePlanningNotes = async ({ eventId, values }) => {
  const user = requireUser();
  const notes = cleanPlanningNotes(values);
  const invalid = validatePlanningNotes(notes);
  if (invalid) throw new Error(invalid);

  const eventRef = doc(db, "events", eventId);
  const historyRef = doc(collection(db, "event_history"));
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(eventRef);
    if (!snapshot.exists() || !canEditPlanningNotes(snapshot.data(), user.uid)) {
      throw new Error("Only the event's coordinator can record safety planning notes, while the event is Approved or in Planning.");
    }
    const before = cleanPlanningNotes(snapshot.data());
    if (JSON.stringify(before) === JSON.stringify(notes)) throw new Error("There are no changes to save.");

    const changedAt = serverTimestamp();
    tx.update(eventRef, { ...notes, updated_at: changedAt });
    tx.set(historyRef, eventHistoryRecord({
      historyId: historyRef.id, eventId, actorId: user.uid, actionType: "SAFETY_PLANNING_NOTES_UPDATED",
      fieldName: "safety_planning_notes", oldValue: before, newValue: notes,
      description: "Coordinator updated the equipment placement and crowd movement notes.", createdAt: changedAt
    }));
  });
  return { ok: true };
};
