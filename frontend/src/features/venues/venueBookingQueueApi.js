// Venue Staff's side of a venue booking: the queue of requests for their venues,
// and the approve, hold and reject decisions on each.

import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { notificationRecord } from "../../domain/eventReviewRecords";
import { venueBookingOutcomeMessage, venueHoldPlacedMessage } from "../../domain/notifications";
import { activeHoldClash, holdExpiry, holdRefusal, isActiveHold, singaporeDateTime } from "../../domain/venueHolds";
import { detectVenueBookingConflicts } from "../../domain/venueBookingWorkflows";
import { asDate, occupiedWindow, ownedAssignments, refreshVenueWorkflowsOnLoad, requiredUser } from "./venueApiSupport";
import { asIso } from "../../lib/apiSupport";

const overlaps = (leftStart, leftEnd, rightStart, rightEnd) =>
  leftStart < rightEnd && rightStart < leftEnd;

export const loadVenueBookingQueue = async ({ user }) => {
  await refreshVenueWorkflowsOnLoad({ user });
  const userId = requiredUser(user);
  const assignments = await getDocs(query(collection(db, "venue_staff"), where("user_id", "==", userId)));
  const venueIds = ownedAssignments(assignments).map((item) => item.data().venue_id);
  // Persisted conflicts enrich the browser-derived clash information with its
  // audit identity. Older deployed rule sets do not contain permission for this
  // newer collection, so that optional read must not make the booking queue
  // unusable. Actual clashes are still calculated below from the permitted
  // venue_bookings reads.
  const loadPersistedConflicts = (venueId) => getDocs(
    query(collection(db, "venue_booking_conflicts"), where("venue_id", "==", venueId))
  ).catch((error) => {
    if (error?.code === "permission-denied") return { docs: [] };
    throw error;
  });
  const [bookingSnapshots, venueSnapshots, conflictSnapshots] = await Promise.all([
    Promise.all(venueIds.map((venueId) => getDocs(query(collection(db, "venue_bookings"), where("venue_id", "==", venueId))))),
    Promise.all(venueIds.map((venueId) => getDoc(doc(db, "venues", venueId)))),
    Promise.all(venueIds.map(loadPersistedConflicts))
  ]);
  const venueNames = new Map(venueSnapshots.filter((item) => item.exists()).map((item) => [item.id, item.data().name]));
  const allBookingDocs = bookingSnapshots.flatMap((snapshot) => snapshot.docs);
  const activeBookingIds = new Set(allBookingDocs.filter((item) => item.data().status === "APPROVED").map((item) => item.id));
  // Persisted rows support notifications/audit, while this browser calculation
  // keeps the queue correct when the optional local backend is not available.
  const conflicts = new Map(detectVenueBookingConflicts(allBookingDocs.map((item) => ({
    booking_id: item.id,
    ...item.data()
  }))).map((item) => [item.conflict_id, { ...item, status: "ACTIVE" }]));
  conflictSnapshots.flatMap((snapshot) => snapshot.docs).forEach((item) => {
    if (item.data().status === "ACTIVE" && conflicts.has(item.id)) {
      conflicts.set(item.id, { conflict_id: item.id, ...item.data() });
    }
  });
  const conflictsByBooking = new Map();
  conflicts.forEach((item) => {
    const conflict = { ...item, overlap_start: asIso(item.overlap_start), overlap_end: asIso(item.overlap_end) };
    if (conflict.status !== "ACTIVE" || !activeBookingIds.has(conflict.booking_a_id) || !activeBookingIds.has(conflict.booking_b_id)) return;
    [conflict.booking_a_id, conflict.booking_b_id].forEach((id) => conflictsByBooking.set(id, [...(conflictsByBooking.get(id) || []), conflict]));
  });
  // Every booking for the staff member's venues, decided ones included, so an
  // approved request stays on the screen; the screen filters by status.
  return allBookingDocs
    .map((item) => {
      const booking = item.data();
      return {
        booking_id: item.id,
        ...booking,
        event_name: booking.event_name || booking.booking_label || booking.event_id,
        event_date: asIso(booking.start_datetime)?.slice?.(0, 10) || null,
        venue_name: venueNames.get(booking.venue_id) || booking.venue_id,
        start_datetime: asIso(booking.start_datetime),
        end_datetime: asIso(booking.end_datetime),
        occupied_start: asIso(booking.occupied_start),
        occupied_end: asIso(booking.occupied_end),
        submitted_at: asIso(booking.submitted_at),
        decided_at: asIso(booking.decided_at),
        held_at: asIso(booking.held_at),
        hold_expires_at: asIso(booking.hold_expires_at),
        clashes: conflictsByBooking.get(item.id) || []
      };
    })
    .sort((left, right) => String(left.submitted_at || "").localeCompare(String(right.submitted_at || "")));
};

// F4 and F15 — what Venue Staff must be able to say before they approve or hold
// a request: the venue is theirs, nothing approved, held or blocked overlaps it,
// and no earlier request for the same time is still waiting. Read once outside
// the transaction to find the documents, and again inside it to decide on them.
const loadVenueDecision = async ({ user, bookingId }) => {
  const userId = requiredUser(user);
  if (!bookingId) throw new Error("That booking could not be identified.");
  const bookingRef = doc(db, "venue_bookings", bookingId);
  const initial = await getDoc(bookingRef);
  if (!initial.exists()) throw new Error("Booking request not found.");
  const venueId = initial.data().venue_id;
  const [assignments, bookings, unavailable] = await Promise.all([
    getDocs(query(collection(db, "venue_staff"), where("venue_id", "==", venueId), where("user_id", "==", userId))),
    getDocs(query(collection(db, "venue_bookings"), where("venue_id", "==", venueId))),
    getDocs(query(collection(db, "venue_unavailability"), where("venue_id", "==", venueId)))
  ]);
  const [owned] = ownedAssignments(assignments);
  if (!owned) throw new Error("You are not assigned to manage this venue.");
  return {
    userId,
    bookingId,
    bookingRef,
    venueId,
    assignmentRef: owned.ref,
    otherBookingRefs: bookings.docs.filter((item) => item.id !== bookingId).map((item) => item.ref),
    blockRefs: unavailable.docs.map((item) => item.ref),
    replacementRef: initial.data().replacement_for_booking_id
      ? doc(db, "venue_bookings", initial.data().replacement_for_booking_id)
      : null
  };
};

const decideInTransaction = async (transaction, decision, { now, checkStatus }) => {
  const { userId, bookingRef, venueId, assignmentRef, otherBookingRefs, blockRefs, bookingId } = decision;
  const [bookingSnapshot, venueSnapshot, assignment, ...related] = await Promise.all([
    transaction.get(bookingRef),
    transaction.get(doc(db, "venues", venueId)),
    transaction.get(assignmentRef),
    ...otherBookingRefs.map((reference) => transaction.get(reference)),
    ...blockRefs.map((reference) => transaction.get(reference))
  ]);
  if (!bookingSnapshot.exists()) throw new Error("Booking request not found.");
  const booking = bookingSnapshot.data();
  if (!venueSnapshot.exists()) throw new Error("Venue not found.");
  if (!assignment.exists() || assignment.data().user_id !== userId) throw new Error("You are not assigned to manage this venue.");
  const venue = venueSnapshot.data();
  const start = asDate(booking.start_datetime);
  const end = asDate(booking.end_datetime);
  if (!start || !end || end <= start) throw new Error("The booking has an invalid date and time window.");
  const occupied = occupiedWindow(start, end, venue);
  checkStatus({ ...booking, occupied_start: occupied.start, occupied_end: occupied.end });
  const competing = related.slice(0, otherBookingRefs.length).filter((item) => item.exists());
  const blocks = related.slice(otherBookingRefs.length, otherBookingRefs.length + blockRefs.length)
    .filter((item) => item.exists());
  const windowFor = (item) => {
    const otherStart = asDate(item.data().start_datetime);
    const otherEnd = asDate(item.data().end_datetime);
    return otherStart && otherEnd ? occupiedWindow(otherStart, otherEnd, venue) : null;
  };
  const approvedConflict = competing.find((item) => {
    const window = windowFor(item);
    return item.data().status === "APPROVED" && window && overlaps(occupied.start, occupied.end, window.start, window.end);
  });
  if (approvedConflict) throw new Error(`This period clashes with approved booking ${approvedConflict.data().booking_label || approvedConflict.id}.`);
  const block = blocks.find((item) => overlaps(occupied.start, occupied.end,
    asDate(item.data().start_datetime), asDate(item.data().end_datetime)));
  if (block) throw new Error(`The venue is unavailable during this period${block.data().reason ? `: ${block.data().reason}` : "."}`);
  // F15 AC3 — while another event's hold is active, the venue is kept for it.
  const hold = activeHoldClash(competing.map((item) => ({ booking_id: item.id, ...item.data() })), {
    venueId, start: occupied.start, end: occupied.end, now, excludeBookingId: bookingId
  });
  if (hold) throw new Error(`This period is held for ${hold.booking_label || hold.booking_id} until ${singaporeDateTime(hold.hold_expires_at)}.`);
  const submitted = asDate(booking.submitted_at) || new Date(0);
  const earlier = competing.find((item) => {
    const window = windowFor(item);
    return item.data().status === "PENDING" && window
      && overlaps(occupied.start, occupied.end, window.start, window.end)
      && (asDate(item.data().submitted_at) || new Date(0)) < submitted;
  });
  if (earlier) throw new Error("An earlier submitted request for this venue and time must be decided first.");
  return { booking, venue, occupied };
};

// F4 — approve a pending request. F15 AC7 — or convert an active hold into an
// approved booking, which no longer expires. An expired hold cannot be.
export const approveVenueBooking = async ({ user, bookingId, now = new Date() }) => {
  const decision = await loadVenueDecision({ user, bookingId });
  const { userId, bookingRef, venueId } = decision;
  return runTransaction(db, async (transaction) => {
    const { booking, venue, occupied } = await decideInTransaction(transaction, decision, {
      now,
      checkStatus: (current) => {
        if (current.status === "HELD" && !isActiveHold(current, now)) {
          throw new Error(`This hold expired on ${singaporeDateTime(current.hold_expires_at)} and can no longer be converted.`);
        }
        if (!["PENDING", "HELD"].includes(current.status)) throw new Error("Only Pending booking requests can be approved.");
      }
    });
    const decidedAt = serverTimestamp();
    transaction.update(bookingRef, {
      status: "APPROVED",
      assigned_staff_id: userId,
      decided_by: userId,
      decided_at: decidedAt,
      occupied_start: occupied.start,
      occupied_end: occupied.end
    });
    if (decision.replacementRef) {
      transaction.update(decision.replacementRef, {
        status: "REPLACED",
        replacement_needed: false,
        replaced_by_booking_id: bookingId,
        replaced_at: decidedAt,
        released_at: decidedAt,
        release_reason: booking.replacement_reason || "Replacement venue approved"
      });
      const replacementHistoryRef = doc(collection(db, "event_history"));
      transaction.set(replacementHistoryRef, {
        history_id: replacementHistoryRef.id,
        event_id: booking.event_id,
        booking_id: decision.replacementRef.id,
        new_booking_id: bookingId,
        venue_id: booking.replacement_original_venue_id,
        actor_id: userId,
        action_type: "VENUE_REPLACED",
        field_name: "venue_booking_status",
        old_value: "APPROVED",
        new_value: "REPLACED",
        description: `${booking.replacement_original_label || decision.replacementRef.id} replaced by ${booking.booking_label || bookingId}.`,
        created_at: decidedAt
      });
    }
    // F7 AC3 — keep a verifiable link on the event. The rules validate this
    // against the booking written in the same transaction before Confirmed is
    // ever allowed; existing event readers safely ignore the additional field.
    transaction.update(doc(db, "events", booking.event_id), {
      approved_venue_booking_id: bookingId,
      updated_at: decidedAt
    });
    const historyRef = doc(collection(db, "event_history"));
    transaction.set(historyRef, {
      history_id: historyRef.id,
      event_id: booking.event_id,
      booking_id: bookingId,
      venue_id: venueId,
      actor_id: userId,
      action_type: "VENUE_BOOKING_APPROVED",
      field_name: "venue_booking_status",
      old_value: booking.status,
      new_value: "APPROVED",
      description: `Venue booking ${booking.booking_label || bookingId} approved.`,
      created_at: decidedAt
    });
    // J6 AC1/AC2 — tell the coordinator who raised it, in the same transaction,
    // carrying the booking so View opens that booking rather than the event.
    if (booking.requested_by) {
      const notificationRef = doc(collection(db, "notifications"));
      transaction.set(notificationRef, {
        ...notificationRecord({
          notificationId: notificationRef.id,
          userId: booking.requested_by,
          eventId: booking.event_id,
          type: "VENUE_BOOKING_APPROVED",
          message: venueBookingOutcomeMessage({
            eventName: booking.event_name,
            venueName: venue.name,
            approved: true
          }),
          createdAt: decidedAt
        }),
        booking_id: bookingId,
        venue_id: venueId
      });
    }
    return { booking_id: bookingId, status: "APPROVED" };
  });
};

// Retained for browser-SDK callers; the public queue action below uses the
// backend endpoint added on main so its server-side F5 tests remain intact.
export const rejectVenueBookingInFirestore = async ({ user, bookingId, reason }) => {
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) throw new Error("A rejection reason is required.");
  const decision = await loadVenueDecision({ user, bookingId });
  const { userId, bookingRef, venueId, assignmentRef } = decision;
  return runTransaction(db, async (transaction) => {
    const [bookingSnapshot, venueSnapshot, assignment] = await Promise.all([
      transaction.get(bookingRef), transaction.get(doc(db, "venues", venueId)), transaction.get(assignmentRef)
    ]);
    if (!bookingSnapshot.exists()) throw new Error("Booking request not found.");
    if (!assignment.exists() || assignment.data().user_id !== userId) throw new Error("You are not assigned to manage this venue.");
    const booking = bookingSnapshot.data();
    if (!["PENDING", "HELD"].includes(booking.status)) throw new Error("Only a pending or held booking request can be rejected.");
    const stamp = serverTimestamp();
    transaction.update(bookingRef, {
      status: "REJECTED", decision_reason: cleanReason, decided_by: userId,
      decided_at: stamp, assigned_staff_id: userId, requires_re_request: true
    });
    const historyRef = doc(collection(db, "event_history"));
    transaction.set(historyRef, {
      history_id: historyRef.id, event_id: booking.event_id, booking_id: bookingId,
      venue_id: venueId, actor_id: userId, action_type: "VENUE_BOOKING_REJECTED",
      field_name: "venue_booking_status", old_value: booking.status, new_value: "REJECTED",
      description: cleanReason, created_at: stamp
    });
    if (booking.requested_by) {
      const notificationRef = doc(collection(db, "notifications"));
      transaction.set(notificationRef, {
        ...notificationRecord({
          notificationId: notificationRef.id, userId: booking.requested_by,
          eventId: booking.event_id, type: "VENUE_BOOKING_REJECTED",
          message: venueBookingOutcomeMessage({ eventName: booking.event_name, venueName: venueSnapshot.data()?.name || venueId, approved: false, reason: cleanReason }),
          createdAt: stamp
        }),
        booking_id: bookingId, venue_id: venueId
      });
    }
    return { booking_id: bookingId, status: "REJECTED" };
  });
};

// F15 — Venue Staff hold a pending request for three working days while its
// coordinator finalises the event (AC1, AC2). The hold meets the same clashes
// an approval does, and the coordinator who raised it is told the expiry (AC6).
// firestore.rules repeats the expiry count, so a crafted write cannot stretch it.
export const holdVenueBooking = async ({ user, bookingId, now = new Date() }) => {
  const decision = await loadVenueDecision({ user, bookingId });
  const { userId, bookingRef, venueId } = decision;
  return runTransaction(db, async (transaction) => {
    const { booking, venue, occupied } = await decideInTransaction(transaction, decision, {
      now,
      checkStatus: (current) => {
        const refusal = holdRefusal({ booking: current, now });
        if (refusal) throw new Error(refusal);
      }
    });
    const expiresAt = holdExpiry(now);
    const heldAt = serverTimestamp();
    transaction.update(bookingRef, {
      status: "HELD",
      assigned_staff_id: userId,
      held_by: userId,
      held_at: heldAt,
      hold_expires_at: expiresAt,
      occupied_start: occupied.start,
      occupied_end: occupied.end
    });
    const historyRef = doc(collection(db, "event_history"));
    transaction.set(historyRef, {
      history_id: historyRef.id,
      event_id: booking.event_id,
      booking_id: bookingId,
      venue_id: venueId,
      actor_id: userId,
      action_type: "VENUE_BOOKING_HELD",
      field_name: "venue_booking_status",
      old_value: "PENDING",
      new_value: "HELD",
      description: `Venue booking ${booking.booking_label || bookingId} held until ${singaporeDateTime(expiresAt)}.`,
      created_at: heldAt
    });
    if (booking.requested_by) {
      const notificationRef = doc(collection(db, "notifications"));
      transaction.set(notificationRef, {
        ...notificationRecord({
          notificationId: notificationRef.id,
          userId: booking.requested_by,
          eventId: booking.event_id,
          type: "VENUE_BOOKING_HELD",
          message: venueHoldPlacedMessage({ eventName: booking.event_name, venueName: venue.name, expiresAt }),
          createdAt: heldAt,
          eventName: booking.event_name
        }),
        booking_id: bookingId,
        venue_id: venueId,
        hold_expires_at: expiresAt
      });
    }
    return { booking_id: bookingId, status: "HELD", hold_expires_at: expiresAt.toISOString() };
  });
};

export const rejectVenueBooking = async ({ user, bookingId, reason }) => {
  const decisionReason = typeof reason === "string" ? reason.trim() : "";
  if (!decisionReason) throw new Error("A rejection reason is required.");
  if (!user?.getIdToken) throw new Error("Sign in is required to reject a venue booking.");

  const token = await user.getIdToken();
  const response = await fetch(`/api/venues/bookings/${encodeURIComponent(bookingId)}/reject`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ reason: decisionReason })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The booking could not be rejected.");
  return result;
};
