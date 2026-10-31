// The coordinator's side of a venue booking: raising a request, tracking it,
// finding a replacement after a clash or venue loss, and giving a venue back.

import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { notificationRecord } from "../../domain/eventReviewRecords";
import { bookingDetailsErrors, clashingEventBooking } from "../../domain/venueBookingDetails";
import { activeHoldClash, isActiveHold, singaporeDateTime } from "../../domain/venueHolds";
import { bookingWindow, detectVenueBookingConflicts, windowsOverlap } from "../../domain/venueBookingWorkflows";
import { asDate, occupiedWindow, refreshVenueWorkflowsOnLoad, requiredUser } from "./venueApiSupport";
import { asIso } from "../../lib/apiSupport";

const eventDateTime = (date, time) => {
  const clock = String(time || "");
  return asDate(`${date}T${clock}${/^\d{2}:\d{2}$/.test(clock) ? ":00" : ""}+08:00`);
};

// The event's name as booking records and notices show it.
const eventNameOf = (event, eventId) => event.name || event.reference_no || eventId;

// F11 — a replacement must be for a booking of this event that is flagged as
// needing one, and must be a different venue from the one that was lost.
const checkReplacement = (replacementSnapshot, { eventId, venueId }) => {
  if (!replacementSnapshot?.exists()) throw new Error("The booking needing replacement was not found.");
  const replaced = replacementSnapshot.data();
  if (replaced.event_id !== eventId
    || (replaced.replacement_needed !== true
      && !(replaced.status === "REJECTED" && replaced.requires_re_request === true))) {
    throw new Error("This booking is not awaiting a replacement for this event.");
  }
  if (replaced.venue_id === venueId) throw new Error("Choose a different venue from the unavailable venue.");
};

// Only the event's current coordinator, for an Approved or Planning event and an
// active venue, may request it; a replacement must also be a valid one.
const checkRequestAllowed = ({ event, venue, userId, isReplacement, replacementSnapshot, eventId, venueId }) => {
  if (event.coordinator_id !== userId) throw new Error("Only the current event coordinator may request a venue.");
  if (!["APPROVED", "PLANNING"].includes(String(event.status || "").toUpperCase())) {
    throw new Error("Venue requests are available only for Approved or Planning events.");
  }
  if (venue.is_active === false) throw new Error("This venue is inactive and cannot be requested.");
  if (isReplacement) checkReplacement(replacementSnapshot, { eventId, venueId });
};

// F12 — the booking's label, attendance and time window. A caller that sends no
// label or attendance gets the event's; one that sends them has them validated.
// The occupied window adds the venue's setup and turnaround time (E9, F9).
const bookingDetailsFor = ({ event, venue, eventId, venueId, bookingLabel, expectedAttendance, layout }) => {
  const eventAttendance = Number(event.expected_attendance);
  if (!Number.isInteger(eventAttendance) || eventAttendance <= 0) throw new Error("Expected attendance must be a positive whole number.");
  const label = bookingLabel === undefined
    ? `${eventNameOf(event, eventId)} — ${venue.name || venueId}`
    : String(bookingLabel || "").trim();
  const errors = bookingDetailsErrors({
    label,
    expected_attendance: expectedAttendance === undefined ? eventAttendance : expectedAttendance,
    layout
  }, event);
  const firstError = errors.label || errors.expected_attendance;
  if (firstError) throw new Error(firstError);
  const attendance = expectedAttendance === undefined ? eventAttendance : Number(expectedAttendance);
  const start = eventDateTime(event.event_date, event.start_time);
  const end = eventDateTime(event.event_date, event.end_time);
  if (!start || !end || end <= start) throw new Error("The event must have a valid date and time window.");
  return { label, attendance, start, end, occupied: occupiedWindow(start, end, venue) };
};

// F12 AC4 — another venue for this event is fine; this venue again at an
// overlapping time is not. F15 AC3 — nor is a venue held, for any event, over it.
const checkVenueFree = ({ existing, holds, venue, eventId, venueId, occupied, now }) => {
  const clash = clashingEventBooking(
    existing.filter((item) => item.exists()).map((item) => item.data()),
    { eventId, venueId, start: occupied.start, end: occupied.end }
  );
  if (clash) {
    throw new Error(`This event already has an active booking for ${venue.name || venueId} at an overlapping time: ${clash.booking_label || clash.booking_id}.`);
  }
  const hold = activeHoldClash(holds, { venueId, start: occupied.start, end: occupied.end, now });
  if (hold) {
    throw new Error(`${venue.name || venueId} is held for ${hold.booking_label || hold.booking_id} until `
      + `${singaporeDateTime(hold.hold_expires_at)}, and cannot be requested for an overlapping time.`);
  }
};

// The new booking as Venue Staff will assess it: a snapshot of the event, the
// window it occupies, what was asked for, and what the coordinator acknowledged.
const pendingBookingRecord = ({
  bookingId, eventId, venueId, event, details, layout, facilities,
  replacementForBookingId, replacementSnapshot, acknowledgement, userId
}) => ({
  booking_id: bookingId,
  event_id: eventId,
  venue_id: venueId,
  event_name: eventNameOf(event, eventId),
  event_reference_no: event.reference_no || null,
  event_purpose: event.purpose || null,
  event_description: event.description || null,
  registration_required: Boolean(event.registration_required),
  assigned_staff_id: null,
  start_datetime: details.start,
  end_datetime: details.end,
  occupied_start: details.occupied.start,
  occupied_end: details.occupied.end,
  expected_attendance: details.attendance,
  status: "PENDING",
  decision_reason: null,
  requested_layout_id: layout,
  layout_snapshot: layout,
  required_facilities_snapshot: facilities,
  booking_label: details.label,
  submitted_at: serverTimestamp(),
  decided_at: null,
  decided_by: null,
  released_at: null,
  release_reason: null,
  requires_re_request: false,
  replacement_needed: false,
  replacement_for_booking_id: replacementForBookingId || null,
  replacement_original_venue_id: replacementSnapshot?.data()?.venue_id || null,
  replacement_original_label: replacementSnapshot?.data()?.booking_label || null,
  replacement_original_status: replacementSnapshot?.data()?.status || null,
  replacement_reason: replacementSnapshot?.data()?.status === "REJECTED"
    ? replacementSnapshot.data().decision_reason || null
    : replacementSnapshot?.data()?.replacement_reason || null,
  replaced_by_booking_id: null,
  replaced_at: null,
  safety_review_required: Boolean(event.safety_review_required),
  suitability_acknowledgement: acknowledgement || { acknowledged: false, criteria: [] },
  requested_by: userId
});

// The venue's assigned Venue Staff member, if it has one, is told a request arrived.
const notifyVenueStaff = (transaction, { venueStaffSnapshot, event, venue, eventId, venueId }) => {
  const changedAt = serverTimestamp();
  const recipient = venueStaffSnapshot.exists() ? venueStaffSnapshot.data().user_id : null;
  if (!recipient) return;
  const notificationRef = doc(collection(db, "notifications"));
  transaction.set(notificationRef, {
    ...notificationRecord({
      notificationId: notificationRef.id,
      userId: recipient,
      eventId,
      type: "VENUE_BOOKING_REQUESTED",
      message: `${eventNameOf(event, eventId)}: a venue booking request was raised for ${venue.name || venueId}.`,
      createdAt: changedAt,
      eventName: eventNameOf(event, eventId)
    }),
    venue_id: venueId
  });
};

// E8 — raise a booking request for a venue the suitability gate has cleared.
// The acknowledgement travels with the request so Venue Staff assess it knowing
// which shortfalls the coordinator accepted. firestore.rules re-checks capacity
// and the acknowledgement shape, so a crafted request cannot skip the gate.
//
// F12 — an event may hold several bookings, each with its own label, expected
// attendance and layout.
export const requestVenueBooking = async ({
  user,
  venue_id,
  event_id,
  booking_label,
  expected_attendance,
  required_layout,
  required_facilities,
  acknowledgement,
  now = new Date(),
  replacement_for_booking_id = null
}) => {
  const userId = requiredUser(user);
  if (!event_id || !venue_id) throw new Error("An event and venue are required.");
  const layoutSnapshot = String(required_layout || "").trim();
  if (!layoutSnapshot) throw new Error("A required layout must be recorded.");
  if (!Array.isArray(required_facilities)) throw new Error("Facility requirements must be recorded.");
  const facilitySnapshot = [...new Set(required_facilities.map((item) => String(item || "").trim()).filter(Boolean))];
  const eventRef = doc(db, "events", event_id);
  const venueRef = doc(db, "venues", venue_id);
  // venue_staff is keyed by venue id, and a coordinator may only get that one
  // document — a list query on the collection is refused by firestore.rules.
  const venueStaffRef = doc(db, "venue_staff", venue_id);
  const replacementRef = replacement_for_booking_id
    ? doc(db, "venue_bookings", replacement_for_booking_id)
    : null;
  // F15 AC3 — the venue's holds, whichever event they keep it for.
  const [existingSnapshot, venueBookingSnapshot] = await Promise.all([
    getDocs(query(collection(db, "venue_bookings"), where("event_id", "==", event_id))),
    getDocs(query(collection(db, "venue_bookings"), where("venue_id", "==", venue_id)))
  ]);
  const holdRefs = venueBookingSnapshot.docs.filter((item) => item.data().status === "HELD").map((item) => item.ref);
  return runTransaction(db, async (transaction) => {
    const [eventSnapshot, venueSnapshot, venueStaffSnapshot, ...rest] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(venueRef),
      transaction.get(venueStaffRef),
      ...existingSnapshot.docs.map((item) => transaction.get(item.ref)),
      ...holdRefs.map((reference) => transaction.get(reference)),
      ...(replacementRef ? [transaction.get(replacementRef)] : [])
    ]);
    const existing = rest.slice(0, existingSnapshot.docs.length);
    const holdSnapshots = rest.slice(existingSnapshot.docs.length, existingSnapshot.docs.length + holdRefs.length);
    const replacementSnapshot = replacementRef ? rest[existingSnapshot.docs.length + holdRefs.length] : null;
    const holds = holdSnapshots.filter((item) => item.exists())
      .map((item) => ({ booking_id: item.id, ...item.data() }));
    if (!eventSnapshot.exists()) throw new Error("Event not found.");
    if (!venueSnapshot.exists()) throw new Error("Venue not found.");
    const event = eventSnapshot.data();
    const venue = venueSnapshot.data();

    checkRequestAllowed({
      event, venue, userId, isReplacement: Boolean(replacementRef), replacementSnapshot,
      eventId: event_id, venueId: venue_id
    });
    const details = bookingDetailsFor({
      event, venue, eventId: event_id, venueId: venue_id,
      bookingLabel: booking_label, expectedAttendance: expected_attendance, layout: layoutSnapshot
    });
    checkVenueFree({ existing, holds, venue, eventId: event_id, venueId: venue_id, occupied: details.occupied, now });
    if (Number(venue.max_capacity) < details.attendance) throw new Error("The venue cannot hold the expected attendance.");

    const bookingRef = doc(collection(db, "venue_bookings"));
    transaction.set(bookingRef, pendingBookingRecord({
      bookingId: bookingRef.id, eventId: event_id, venueId: venue_id, event, details,
      layout: layoutSnapshot, facilities: facilitySnapshot,
      replacementForBookingId: replacement_for_booking_id, replacementSnapshot, acknowledgement, userId
    }));
    notifyVenueStaff(transaction, { venueStaffSnapshot, event, venue, eventId: event_id, venueId: venue_id });
    return { booking_id: bookingRef.id, status: "PENDING" };
  });
};

// Who manages each venue, by name. A coordinator may get venue_staff/{venueId}
// but not read Venue Staff profiles (TC-347), so the name is the staff_name
// copied onto the assignment. An assignment that is missing or cannot be read
// leaves the name blank rather than failing the list.
const venueStaffNames = async (venueIds) => new Map(await Promise.all(venueIds.map((venueId) =>
  getDoc(doc(db, "venue_staff", venueId))
    .then((snapshot) => [venueId, snapshot.exists() ? snapshot.data().staff_name || null : null])
    .catch(() => [venueId, null]))));

// E8 — the coordinator's own booking requests, newest first. Venue Staff see the
// same collection through their own queue; this view is scoped to the raiser.
export const loadVenueBookings = async ({ user }) => {
  if (!user?.uid) return [];
  await refreshVenueWorkflowsOnLoad({ user });
  const eventSnapshot = await getDocs(query(collection(db, "events"), where("coordinator_id", "==", user.uid)));
  const events = new Map(eventSnapshot.docs.map((item) => [item.id, item.data()]));
  const bookingSnapshots = await Promise.all(eventSnapshot.docs.map((event) =>
    getDocs(query(collection(db, "venue_bookings"), where("event_id", "==", event.id)))));
  const bookingDocs = bookingSnapshots.flatMap((snapshot) => snapshot.docs);
  const venueIds = [...new Set(bookingDocs.map((item) => item.data().venue_id).filter(Boolean))];
  // F10 resolution: compare this coordinator's approved bookings with every
  // approved booking at the same venues. The current rules already allow Event
  // Coordinators to read venue bookings; only clashes involving their own rows
  // are attached to the returned list.
  const [venueSnapshots, venueBookingSnapshots] = await Promise.all([
    Promise.all(venueIds.map((venueId) => getDoc(doc(db, "venues", venueId)))),
    Promise.all(venueIds.map((venueId) => getDocs(query(collection(db, "venue_bookings"), where("venue_id", "==", venueId)))))
  ]);
  const venueNames = new Map(venueSnapshots.filter((item) => item.exists()).map((item) => [item.id, item.data().name]));
  const staffNames = await venueStaffNames(venueIds);
  const venueBookingDocs = new Map();
  venueBookingSnapshots.flatMap((snapshot) => snapshot.docs).forEach((item) => venueBookingDocs.set(item.id, item));
  const conflictsByBooking = new Map();
  detectVenueBookingConflicts([...venueBookingDocs.values()].map((item) => ({
    booking_id: item.id,
    ...item.data()
  }))).forEach((conflict) => {
    [conflict.booking_a_id, conflict.booking_b_id].forEach((bookingId) => {
      conflictsByBooking.set(bookingId, [...(conflictsByBooking.get(bookingId) || []), {
        ...conflict,
        status: "ACTIVE",
        overlap_start: asIso(conflict.overlap_start),
        overlap_end: asIso(conflict.overlap_end)
      }]);
    });
  });
  return bookingDocs
    .map((data) => ({
      booking_id: data.id,
      ...data.data(),
      // F16 fallback: even before the background job persists EXPIRED, every
      // browser view treats a hold at/past its deadline as expired and free.
      status: data.data().status === "HELD" && !isActiveHold(data.data()) ? "EXPIRED" : data.data().status,
      event_name: events.get(data.data().event_id)?.name || events.get(data.data().event_id)?.reference_no || data.data().event_name || data.data().event_id,
      event_date: events.get(data.data().event_id)?.event_date || null,
      event_status: events.get(data.data().event_id)?.status || null,
      venue_name: venueNames.get(data.data().venue_id) || data.data().venue_id,
      venue_staff_name: staffNames.get(data.data().venue_id) || null,
      start_datetime: asIso(data.data().start_datetime),
      end_datetime: asIso(data.data().end_datetime),
      occupied_start: asIso(data.data().occupied_start),
      occupied_end: asIso(data.data().occupied_end),
      submitted_at: asIso(data.data().submitted_at),
      decided_at: asIso(data.data().decided_at),
      released_at: asIso(data.data().released_at),
      hold_expires_at: asIso(data.data().hold_expires_at),
      requested_at: asIso(data.data().submitted_at || data.data().requested_at),
      suitability_acknowledgement: data.data().suitability_acknowledgement || null,
      clashes: conflictsByBooking.get(data.id) || []
    }))
    .sort((left, right) => String(right.requested_at || "").localeCompare(String(left.requested_at || "")));
};

// F10 -> F11: the current coordinator chooses that their own approved booking
// will be replaced. Detection alone never changes either booking; this explicit
// action records the decision, then the existing replacement search and normal
// Venue Staff approval flow take over.
export const prepareClashReplacement = async ({ user, bookingId, clash }) => {
  const userId = requiredUser(user);
  if (!bookingId) throw new Error("That booking could not be identified.");
  const involved = [clash?.booking_a_id, clash?.booking_b_id];
  if (!clash || !involved.includes(bookingId)) throw new Error("Choose an active clash for this booking.");
  if (!String(clash.conflict_id || "").trim()) throw new Error("Choose an active clash for this booking.");
  const conflictingBookingId = clash.booking_a_id === bookingId ? clash.booking_b_id : clash.booking_a_id;
  if (!conflictingBookingId || conflictingBookingId === bookingId) throw new Error("Choose an active clash for this booking.");
  const bookingRef = doc(db, "venue_bookings", bookingId);
  const conflictingBookingRef = doc(db, "venue_bookings", conflictingBookingId);
  const initial = await getDoc(bookingRef);
  if (!initial.exists()) throw new Error("That booking could not be found.");
  const eventId = initial.data().event_id;
  const eventRef = doc(db, "events", eventId);
  return runTransaction(db, async (transaction) => {
    const [eventSnapshot, bookingSnapshot, conflictingBookingSnapshot] = await Promise.all([
      transaction.get(eventRef), transaction.get(bookingRef), transaction.get(conflictingBookingRef)
    ]);
    if (!eventSnapshot.exists()) throw new Error("Event not found.");
    if (!bookingSnapshot.exists() || String(bookingSnapshot.data().status || "").toUpperCase() !== "APPROVED") {
      throw new Error("Only an approved booking can be replaced to resolve a clash.");
    }
    const event = eventSnapshot.data();
    if (event.coordinator_id !== userId) {
      throw new Error("Only the current event coordinator may resolve this booking's clash.");
    }
    if (!["APPROVED", "PLANNING", "CONFIRMED"].includes(String(event.status || "").toUpperCase())) {
      throw new Error("This event is not in a state where its venue can be replaced.");
    }
    const booking = bookingSnapshot.data();
    const conflictingBooking = conflictingBookingSnapshot.exists() ? conflictingBookingSnapshot.data() : null;
    const currentWindow = bookingWindow(booking);
    const conflictingWindow = bookingWindow(conflictingBooking || {});
    if (!conflictingBooking
      || String(conflictingBooking.status || "").toUpperCase() !== "APPROVED"
      || conflictingBooking.venue_id !== booking.venue_id
      || !windowsOverlap(currentWindow.start, currentWindow.end, conflictingWindow.start, conflictingWindow.end)) {
      throw new Error("This booking clash is no longer active. Refresh the bookings list.");
    }
    const otherName = clash.booking_a_id === bookingId ? clash.event_b_name : clash.event_a_name;
    const reason = `Schedule clash with ${otherName || "another event"}.`;
    const stamp = serverTimestamp();
    const historyRef = doc(collection(db, "event_history"));
    transaction.update(bookingRef, {
      replacement_needed: true,
      replacement_status: "Schedule clash - replacement needed",
      replacement_reason: reason,
      replacement_requested_at: stamp,
      replacement_requested_by: userId,
      replacement_source: "CLASH",
      replacement_conflict_id: clash.conflict_id,
      replacement_conflicting_booking_id: conflictingBookingId,
      safety_review_required: true
    });
    const eventUpdate = {
      last_venue_replacement_id: historyRef.id,
      safety_review_required: true,
      updated_at: stamp
    };
    if (String(event.status).toUpperCase() === "CONFIRMED") {
      Object.assign(eventUpdate, {
        status: "PLANNING",
        approved_venue_booking_id: null,
        last_safety_review_id: null
      });
    }
    transaction.update(eventRef, eventUpdate);
    transaction.set(historyRef, {
      history_id: historyRef.id,
      event_id: eventId,
      booking_id: bookingId,
      venue_id: booking.venue_id,
      actor_id: userId,
      action_type: "VENUE_REPLACEMENT_REQUESTED",
      field_name: "replacement_needed",
      old_value: false,
      new_value: true,
      description: `${booking.booking_label || bookingId} needs a replacement: ${reason}`,
      created_at: stamp
    });
    return {
      booking_id: bookingId,
      event_id: eventId,
      replacement_needed: true,
      replacement_reason: reason,
      replacement_source: "CLASH"
    };
  });
};

export const releaseCancelledEventBookings = async ({ user, eventId, reason = "Event cancelled" }) => {
  const userId = requiredUser(user);
  if (!eventId) throw new Error("That event could not be identified.");
  const eventRef = doc(db, "events", eventId);
  const bookings = await getDocs(query(collection(db, "venue_bookings"), where("event_id", "==", eventId)));
  return runTransaction(db, async (transaction) => {
    const [eventSnapshot, ...bookingSnapshots] = await Promise.all([
      transaction.get(eventRef),
      ...bookings.docs.map((item) => transaction.get(item.ref))
    ]);
    if (!eventSnapshot.exists()) throw new Error("Event not found.");
    const event = eventSnapshot.data();
    if (event.coordinator_id !== userId) throw new Error("Only the current event coordinator may release its venue bookings.");
    if (String(event.status).toUpperCase() !== "CANCELLED") {
      throw new Error("Venue bookings can be released automatically only after the event is Cancelled.");
    }
    const changed = [];
    let approvedLinkReleased = false;
    bookingSnapshots.filter((item) => item.exists()).forEach((item) => {
      const booking = item.data();
      const status = booking.status === "APPROVED" ? "RELEASED" : ["PENDING", "HELD"].includes(booking.status) ? "WITHDRAWN" : null;
      if (!status) return;
      const now = serverTimestamp();
      transaction.update(item.ref, { status, released_at: now, release_reason: reason });
      if (item.id === event.approved_venue_booking_id && status === "RELEASED") approvedLinkReleased = true;
      const historyRef = doc(collection(db, "event_history"));
      transaction.set(historyRef, {
        history_id: historyRef.id,
        event_id: eventId,
        actor_id: userId,
        action_type: status === "RELEASED" ? "VENUE_BOOKING_RELEASED" : "VENUE_BOOKING_WITHDRAWN",
        field_name: "venue_booking_status",
        old_value: booking.status,
        new_value: status,
        description: `${booking.booking_label || booking.booking_id || item.id}: ${reason}`,
        created_at: now
      });
      changed.push({ booking_id: item.id, status });
    });
    if (approvedLinkReleased) {
      transaction.update(eventRef, { approved_venue_booking_id: null, updated_at: serverTimestamp() });
    }
    return changed;
  });
};

// F14: release one approved venue without disturbing the event's other venue
// bookings. A confirmed event returns to Planning because its venue and safety
// prerequisites must be checked again before it can be confirmed.
export const releaseVenueBooking = async ({ user, bookingId, reason }) => {
  const userId = requiredUser(user);
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) throw new Error("A release reason is required.");
  if (!bookingId) throw new Error("That booking could not be identified.");
  const bookingRef = doc(db, "venue_bookings", bookingId);
  const initial = await getDoc(bookingRef);
  if (!initial.exists()) throw new Error("That booking could not be found.");
  const eventId = initial.data().event_id;
  const eventRef = doc(db, "events", eventId);
  const eventBookings = await getDocs(query(collection(db, "venue_bookings"), where("event_id", "==", eventId)));
  return runTransaction(db, async (transaction) => {
    const [eventSnapshot, currentBooking, ...related] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(bookingRef),
      ...eventBookings.docs.filter((item) => item.id !== bookingId).map((item) => transaction.get(item.ref))
    ]);
    if (!eventSnapshot.exists()) throw new Error("Event not found.");
    if (!currentBooking.exists() || currentBooking.data().status !== "APPROVED") {
      throw new Error("Only an approved venue booking can be released.");
    }
    const event = eventSnapshot.data();
    if (event.coordinator_id !== userId) throw new Error("Only the current event coordinator may release this venue.");
    if (!["APPROVED", "PLANNING", "CONFIRMED", "SAFETY_REVIEW"].includes(String(event.status || "").toUpperCase())) {
      throw new Error("This event's venue can no longer be released.");
    }
    const stamp = serverTimestamp();
    transaction.update(bookingRef, {
      status: "RELEASED",
      released_at: stamp,
      release_reason: cleanReason,
      safety_review_required: true
    });
    const historyRef = doc(collection(db, "event_history"));
    const otherCount = eventBookings.docs.filter((item) => item.id !== bookingId).length;
    const otherBookings = related.slice(0, otherCount).filter((item) => item.exists()).map((item) => ({ id: item.id, ...item.data() }));
    const remainingApproved = otherBookings.find((item) => item.status === "APPROVED");
    const eventUpdate = {
      approved_venue_booking_id: event.approved_venue_booking_id === bookingId
        ? remainingApproved?.id || null
        : event.approved_venue_booking_id || remainingApproved?.id || null,
      last_venue_release_id: historyRef.id,
      updated_at: stamp
    };
    if (["CONFIRMED", "SAFETY_REVIEW"].includes(String(event.status).toUpperCase())) {
      Object.assign(eventUpdate, {
        status: "PLANNING",
        last_safety_review_id: null,
        safety_review_required: true
      });
    }
    transaction.update(eventRef, eventUpdate);
    transaction.set(historyRef, {
      history_id: historyRef.id,
      event_id: eventId,
      booking_id: bookingId,
      venue_id: currentBooking.data().venue_id,
      actor_id: userId,
      action_type: "VENUE_BOOKING_RELEASED",
      field_name: "venue_booking_status",
      old_value: "APPROVED",
      new_value: "RELEASED",
      description: `${currentBooking.data().booking_label || bookingId}: ${cleanReason}`,
      created_at: stamp
    });
    return { booking_id: bookingId, status: "RELEASED" };
  });
};

// E8 / F1 AC4 — withdrawing frees the event-and-venue pairing to be requested
// again. The record stays, so what was acknowledged at the time is not erased.
//
// K5 / SCRUM-186 AC2 — only the coordinator the event is assigned to now may withdraw.
// firestore.rules refuses the same write; checking here first gives a clear reason.
export const withdrawVenueBooking = async ({ user, bookingId }) => {
  const userId = requiredUser(user);
  if (!bookingId) throw new Error("That booking could not be identified.");
  const bookingSnapshot = await getDoc(doc(db, "venue_bookings", bookingId));
  if (!bookingSnapshot.exists()) throw new Error("That booking could not be found.");
  const eventSnapshot = await getDoc(doc(db, "events", bookingSnapshot.data().event_id));
  if (!eventSnapshot.exists() || eventSnapshot.data().coordinator_id !== userId) {
    throw new Error("Only the current event coordinator may withdraw this booking.");
  }
  await updateDoc(doc(db, "venue_bookings", bookingId), {
    status: "WITHDRAWN",
    withdrawn_at: serverTimestamp()
  });
  return { booking_id: bookingId, status: "WITHDRAWN" };
};
