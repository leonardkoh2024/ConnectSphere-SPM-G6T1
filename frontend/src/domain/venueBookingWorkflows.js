// F10/F11/F13/F14/F16 venue-booking workflow rules kept independent from
// React and Firestore so boundary cases are deterministic and unit-testable.

const asDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const bookingWindow = (booking = {}) => ({
  start: asDate(booking.occupied_start || booking.start_datetime),
  end: asDate(booking.occupied_end || booking.end_datetime)
});

export const windowsOverlap = (leftStart, leftEnd, rightStart, rightEnd) =>
  Boolean(leftStart && leftEnd && rightStart && rightEnd
    && leftStart < rightEnd && rightStart < leftEnd);

export const conflictId = (venueId, firstId, secondId) => {
  const [left, right] = [String(firstId), String(secondId)].sort();
  return `${encodeURIComponent(venueId)}--${encodeURIComponent(left)}--${encodeURIComponent(right)}`;
};

// F10: only approved bookings whose occupied window has not ended are checked.
// Strict overlap deliberately treats touching boundaries as available.
export const detectVenueBookingConflicts = (bookings = [], now = new Date()) => {
  const instant = asDate(now);
  const candidates = bookings.filter((booking) => {
    const window = bookingWindow(booking);
    return String(booking.status || "").toUpperCase() === "APPROVED"
      && window.start && window.end && window.end > instant;
  });
  const conflicts = [];
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      if (left.venue_id !== right.venue_id) continue;
      const leftWindow = bookingWindow(left);
      const rightWindow = bookingWindow(right);
      if (!windowsOverlap(leftWindow.start, leftWindow.end, rightWindow.start, rightWindow.end)) continue;
      conflicts.push({
        conflict_id: conflictId(left.venue_id, left.booking_id || left.id, right.booking_id || right.id),
        venue_id: left.venue_id,
        booking_a_id: left.booking_id || left.id,
        booking_b_id: right.booking_id || right.id,
        event_a_id: left.event_id,
        event_b_id: right.event_id,
        event_a_name: left.event_name || left.booking_label || left.event_id,
        event_b_name: right.event_name || right.booking_label || right.event_id,
        // Browser-facing clash records use ISO text consistently. Firestore's
        // persisted conflict records remain native timestamps and are converted
        // to the same ISO shape by the API adapters when read.
        overlap_start: new Date(Math.max(leftWindow.start.getTime(), rightWindow.start.getTime())).toISOString(),
        overlap_end: new Date(Math.min(leftWindow.end.getTime(), rightWindow.end.getTime())).toISOString()
      });
    }
  }
  return conflicts;
};

// A conflict is attached to both affected booking rows. Count its stable id
// once so the sidebar reports clashes, not the number of duplicated row flags.
export const venueBookingClashCount = (bookings = []) => new Set(
  bookings.flatMap((booking) => booking.clashes || [])
    .filter((clash) => clash.status !== "RESOLVED")
    .map((clash) => clash.conflict_id)
    .filter(Boolean)
).size;

const INACTIVE = new Set(["RELEASED", "REPLACED", "WITHDRAWN", "CANCELLED", "EXPIRED", "REJECTED"]);
export const activeVenueBookings = (bookings = []) =>
  bookings.filter((booking) => {
    const status = String(booking.status || "").toUpperCase();
    return status === "REJECTED"
      ? booking.requires_re_request === true || booking.replacement_needed === true
      : !INACTIVE.has(status);
  });

export const venueBookingNeedsAction = (booking = {}) => {
  const status = String(booking.status || "").toUpperCase();
  return status !== "APPROVED" || booking.replacement_needed === true;
};

// A rejected request still represents an unresolved venue requirement until it
// is withdrawn/replaced, so it intentionally blocks readiness.
export const venueReadyForSafety = (bookings = []) => {
  const active = activeVenueBookings(bookings);
  return active.length > 0 && active.every((booking) => !venueBookingNeedsAction(booking));
};

export const replacementSearchEvent = (event, booking) => ({
  ...event,
  event_id: event.event_id || event.id || booking.event_id,
  expected_attendance: booking.expected_attendance ?? event.expected_attendance,
  required_layout: booking.requested_layout_id || booking.layout_snapshot || event.required_layout,
  facilities: booking.required_facilities_snapshot || event.facilities || [],
  replacement_for_booking_id: booking.booking_id || booking.id,
  excluded_venue_id: booking.venue_id
});

// F14: after a venue is deliberately released, the coordinator may still add
// another independent room. Carry the released room's requirements into the
// search for convenience, but do not link the new request as a replacement.
export const additionalVenueSearchEvent = (event, booking) => ({
  ...event,
  event_id: event.event_id || event.id || booking.event_id,
  expected_attendance: booking.expected_attendance ?? event.expected_attendance,
  required_layout: booking.requested_layout_id || booking.layout_snapshot || event.required_layout,
  facilities: booking.required_facilities_snapshot || event.facilities || [],
  excluded_venue_id: booking.venue_id
});
