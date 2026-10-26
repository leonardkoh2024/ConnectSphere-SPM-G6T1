const DAY_MS = 24 * 60 * 60 * 1000;

const asDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const bookingName = (booking, id) => booking.booking_label || booking.event_name || booking.booking_id || id;

// F16: process each active hold independently. Deterministic history and notice
// IDs plus the status/warning marker make retries safe after a process restart.
export function createProcessVenueHolds({ firestore, serverTimestamp }) {
  return async function processVenueHolds({ now = new Date() } = {}) {
    const instant = asDate(now);
    const held = await firestore.collection("venue_bookings").where("status", "==", "HELD").get();
    const outcomes = [];

    for (const candidate of held.docs) {
      const outcome = await firestore.runTransaction(async (transaction) => {
        const bookingDoc = await transaction.get(candidate.ref);
        if (!bookingDoc.exists || String(bookingDoc.data().status).toUpperCase() !== "HELD") return null;
        const booking = bookingDoc.data();
        const expires = asDate(booking.hold_expires_at);
        const heldAt = asDate(booking.held_at || booking.submitted_at);
        if (!expires) return null;
        const eventRef = booking.event_id ? firestore.collection("events").doc(booking.event_id) : null;
        const eventDoc = eventRef ? await transaction.get(eventRef) : null;
        const coordinatorId = eventDoc?.exists ? eventDoc.data().coordinator_id : booking.requested_by;
        const stamp = serverTimestamp();

        if (instant >= expires) {
          transaction.update(candidate.ref, {
            status: "EXPIRED",
            expired_at: stamp,
            released_at: stamp,
            release_reason: "Venue hold expired after three working days"
          });
          const historyRef = firestore.collection("event_history").doc(`hold-expired-${candidate.id}`);
          transaction.set(historyRef, {
            history_id: historyRef.id,
            event_id: booking.event_id,
            booking_id: candidate.id,
            venue_id: booking.venue_id,
            actor_id: "SYSTEM",
            action_type: "HOLD_EXPIRED",
            field_name: "venue_booking_status",
            old_value: "HELD",
            new_value: "EXPIRED",
            description: `${bookingName(booking, candidate.id)} expired after three working days.`,
            created_at: stamp
          });
          if (coordinatorId) {
            const noticeRef = firestore.collection("notifications").doc(`hold-expired-${candidate.id}`);
            transaction.set(noticeRef, {
              notification_id: noticeRef.id,
              user_id: coordinatorId,
              event_id: booking.event_id,
              booking_id: candidate.id,
              venue_id: booking.venue_id,
              type: "VENUE_HOLD_EXPIRED",
              message: `${bookingName(booking, candidate.id)}: the venue hold expired and the venue is available again.`,
              is_read: false,
              created_at: stamp,
              read_at: null
            });
          }
          return { booking_id: candidate.id, action: "EXPIRED" };
        }

        const warningAt = new Date(expires.getTime() - DAY_MS);
        const existedLongEnough = heldAt && expires.getTime() - heldAt.getTime() > DAY_MS;
        if (existedLongEnough && instant >= warningAt && !booking.hold_warning_sent_at) {
          transaction.update(candidate.ref, { hold_warning_sent_at: stamp });
          const historyRef = firestore.collection("event_history").doc(`hold-warning-${candidate.id}`);
          transaction.set(historyRef, {
            history_id: historyRef.id,
            event_id: booking.event_id,
            booking_id: candidate.id,
            venue_id: booking.venue_id,
            actor_id: "SYSTEM",
            action_type: "HOLD_WARNING",
            description: `${bookingName(booking, candidate.id)} will expire in about 24 hours.`,
            created_at: stamp
          });
          if (coordinatorId) {
            const noticeRef = firestore.collection("notifications").doc(`hold-warning-${candidate.id}`);
            transaction.set(noticeRef, {
              notification_id: noticeRef.id,
              user_id: coordinatorId,
              event_id: booking.event_id,
              booking_id: candidate.id,
              venue_id: booking.venue_id,
              type: "VENUE_HOLD_EXPIRING",
              message: `${bookingName(booking, candidate.id)}: the venue hold expires in about 24 hours.`,
              is_read: false,
              created_at: stamp,
              read_at: null
            });
          }
          return { booking_id: candidate.id, action: "WARNED" };
        }
        return null;
      });
      if (outcome) outcomes.push(outcome);
    }
    return outcomes;
  };
}

export function startVenueHoldExpiryScheduler({ firestore, serverTimestamp, intervalMs = 60000, onError = console.error }) {
  const process = createProcessVenueHolds({ firestore, serverTimestamp });
  const run = () => process().catch((error) => onError("Venue hold expiry job failed:", error));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
