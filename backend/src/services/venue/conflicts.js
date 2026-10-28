const asDate = (value) => value instanceof Date ? value : value?.toDate?.() || new Date(value);
const overlap = (a, b) => a.start < b.end && b.start < a.end;
const windowOf = (booking) => ({
  start: asDate(booking.occupied_start || booking.start_datetime),
  end: asDate(booking.occupied_end || booking.end_datetime)
});
const conflictId = (venueId, left, right) => `${encodeURIComponent(venueId)}--${[left, right].sort().map(encodeURIComponent).join("--")}`;

export function createRecheckVenueConflicts({ firestore, serverTimestamp }) {
  return async function recheckVenueConflicts({ venueId, userId, now = new Date() }) {
    return firestore.runTransaction(async (transaction) => {
      const venueRef = firestore.collection("venues").doc(venueId);
      const assignmentQuery = firestore.collection("venue_staff").where("venue_id", "==", venueId).where("user_id", "==", userId);
      const bookingQuery = firestore.collection("venue_bookings").where("venue_id", "==", venueId);
      const conflictQuery = firestore.collection("venue_booking_conflicts").where("venue_id", "==", venueId);
      const [venue, assignments, bookingsSnapshot, conflictsSnapshot] = await Promise.all([
        transaction.get(venueRef), transaction.get(assignmentQuery), transaction.get(bookingQuery), transaction.get(conflictQuery)
      ]);
      if (!venue.exists) throw new VenueNotFoundForConflictError();
      if (!assignments.docs.length) throw new VenueConflictAssignmentError();

      const bookings = bookingsSnapshot.docs.map((item) => ({ id: item.id, booking_id: item.id, ...item.data() }))
        .filter((booking) => booking.status === "APPROVED" && windowOf(booking).end > now);
      const eventIds = [...new Set(bookings.map((booking) => booking.event_id).filter(Boolean))];
      const events = new Map(await Promise.all(eventIds.map(async (eventId) => {
        const item = await transaction.get(firestore.collection("events").doc(eventId));
        return [eventId, item];
      })));
      const detected = [];
      for (let i = 0; i < bookings.length; i += 1) {
        for (let j = i + 1; j < bookings.length; j += 1) {
          const left = bookings[i]; const right = bookings[j];
          const a = windowOf(left); const b = windowOf(right);
          if (!overlap(a, b)) continue;
          detected.push({
            conflict_id: conflictId(venueId, left.id, right.id), venue_id: venueId,
            booking_a_id: left.id, booking_b_id: right.id,
            event_a_id: left.event_id, event_b_id: right.event_id,
            event_a_name: left.event_name || left.booking_label || left.event_id,
            event_b_name: right.event_name || right.booking_label || right.event_id,
            overlap_start: new Date(Math.max(a.start, b.start)), overlap_end: new Date(Math.min(a.end, b.end))
          });
        }
      }
      const existing = new Map(conflictsSnapshot.docs.map((item) => [item.id, item]));
      const liveIds = new Set(detected.map((item) => item.conflict_id));
      const stamp = serverTimestamp();
      for (const conflict of detected) {
        const previous = existing.get(conflict.conflict_id);
        transaction.set(firestore.collection("venue_booking_conflicts").doc(conflict.conflict_id), {
          ...conflict,
          status: "ACTIVE",
          detected_at: previous?.data().status === "ACTIVE" ? previous.data().detected_at : stamp,
          resolved_at: null
        });
        if (previous?.data().status === "ACTIVE") continue;
        for (const eventId of [conflict.event_a_id, conflict.event_b_id].filter(Boolean)) {
          const historyRef = firestore.collection("event_history").doc(`clash-detected-${conflict.conflict_id}-${encodeURIComponent(eventId)}`);
          transaction.set(historyRef, {
            history_id: historyRef.id, event_id: eventId, venue_id: venueId,
            actor_id: "SYSTEM", action_type: "VENUE_BOOKING_CLASH_DETECTED",
            description: `Clash - review required: ${conflict.event_a_name} and ${conflict.event_b_name} overlap.`,
            created_at: stamp
          });
        }
        const recipients = new Set([userId]);
        [conflict.event_a_id, conflict.event_b_id].forEach((eventId) => {
          const event = events.get(eventId);
          if (event?.exists && event.data().coordinator_id) recipients.add(event.data().coordinator_id);
        });
        for (const recipient of recipients) {
          const noticeRef = firestore.collection("notifications").doc();
          transaction.set(noticeRef, {
            notification_id: noticeRef.id, user_id: recipient, event_id: conflict.event_a_id,
            venue_id: venueId, conflict_id: conflict.conflict_id, type: "VENUE_BOOKING_CLASH",
            message: `Clash - review required: ${conflict.event_a_name} and ${conflict.event_b_name} overlap.`,
            is_read: false, created_at: stamp, read_at: null
          });
        }
      }
      conflictsSnapshot.docs.filter((item) => item.data().status === "ACTIVE" && !liveIds.has(item.id)).forEach((item) => {
        transaction.update(item.ref, { status: "RESOLVED", resolved_at: stamp });
        [item.data().event_a_id, item.data().event_b_id].filter(Boolean).forEach((eventId) => {
          const historyRef = firestore.collection("event_history").doc(`clash-resolved-${item.id}-${encodeURIComponent(eventId)}`);
          transaction.set(historyRef, {
            history_id: historyRef.id, event_id: eventId, venue_id: venueId,
            actor_id: "SYSTEM", action_type: "VENUE_BOOKING_CLASH_RESOLVED",
            description: `The venue booking clash between ${item.data().event_a_name} and ${item.data().event_b_name} was resolved.`,
            created_at: stamp
          });
        });
      });
      return { active_conflicts: detected.length };
    });
  };
}
export class VenueNotFoundForConflictError extends Error {
  constructor() { super("Venue not found."); this.name = "VenueNotFoundForConflictError"; }
}
export class VenueConflictAssignmentError extends Error {
  constructor() { super("You are not assigned to manage this venue."); this.name = "VenueConflictAssignmentError"; }
}

// One complete pass, used by the authenticated page-refresh endpoint. Keeping
// this separate from the timer makes the expensive catalogue-wide scan an
// explicit user action instead of a permanent once-per-minute background job.
export function createRecheckAllVenueConflicts({ firestore, serverTimestamp }) {
  const recheck = createRecheckVenueConflicts({ firestore, serverTimestamp });
  return async function recheckAllVenueConflicts() {
    const assignments = await firestore.collection("venue_staff").get();
    const owners = assignments.docs.filter((item) => item.id === item.data().venue_id);
    const outcomes = await Promise.all(owners.map((item) => recheck({
      venueId: item.data().venue_id,
      userId: item.data().user_id
    })));
    return {
      venues_checked: owners.length,
      active_conflicts: outcomes.reduce((total, outcome) => total + (outcome.active_conflicts || 0), 0)
    };
  };
}

// Deliberately no timer: the authenticated page-refresh route invokes this pass.
