// Loads venue catalogue documents and the related collections this epic owns.
// Joins happen here so domain/venueSearch.js stays free of Firestore.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { notificationRecord } from "../../domain/eventReviewRecords";
import { bookingDetailsErrors, clashingEventBooking } from "../../domain/venueBookingDetails";
import { venueBookingOutcomeMessage, venueHoldPlacedMessage } from "../../domain/notifications";
import { activeHoldClash, holdExpiry, holdRefusal, isActiveHold, singaporeDateTime } from "../../domain/venueHolds";
import { bookingWindow, detectVenueBookingConflicts, windowsOverlap } from "../../domain/venueBookingWorkflows";
import { ROLES } from "../../domain/roles";

const asIso = (value) => value?.toDate?.().toISOString?.() || value || null;
const asDate = (value) => {
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const requiredUser = (user) => {
  if (!user?.uid) throw new Error("Sign in is required.");
  return user.uid;
};
const overlaps = (leftStart, leftEnd, rightStart, rightEnd) =>
  leftStart < rightEnd && rightStart < leftEnd;
const eventDateTime = (date, time) => {
  const clock = String(time || "");
  return asDate(`${date}T${clock}${/^\d{2}:\d{2}$/.test(clock) ? ":00" : ""}+08:00`);
};
const occupiedWindow = (start, end, venue = {}) => ({
  start: new Date(start.getTime() - (Number(venue.setup_minutes) || 0) * 60000),
  end: new Date(end.getTime() + (Number(venue.turnaround_minutes) || 0) * 60000)
});

const grouped = (snapshot, field = "venue_id") => {
  const map = {};
  snapshot.docs.forEach((item) => {
    const data = { id: item.id, ...item.data() };
    const key = data[field];
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key].push(data);
  });
  return map;
};

const assemble = (venuesSnap, related, assignedVenueIds) =>
  venuesSnap.docs.map((item) => {
    const data = item.data();
    const venueId = data.venue_id || item.id;
    return {
      venue_id: venueId,
      name: data.name,
      building: data.building,
      location: data.location,
      is_assigned_to_user: assignedVenueIds.has(venueId),
      special_space_availability: data.special_space_availability || "",
      max_capacity: Number(data.max_capacity) || 0,
      setup_minutes: Number(data.setup_minutes) || 0,
      turnaround_minutes: Number(data.turnaround_minutes) || 0,
      emergency_access_notes: data.emergency_access_notes || "",
      known_restrictions: data.known_restrictions || "",
      facilities: data.facilities || (related.facilities[venueId] || []).map((row) => row.facility_id).filter(Boolean),
      layouts: data.layouts || (related.layouts[venueId] || []).map((row) => row.layout_id).filter(Boolean),
      accessibility: data.accessibility || (related.access[venueId] || []).map((row) => row.accessibility_id).filter(Boolean),
      operating_hours: data.operating_hours || (related.hours[venueId] || []).map((row) => ({
        weekday: row.weekday,
        opens_at: row.opens_at,
        closes_at: row.closes_at
      }))
    };
  });

// One owner per venue: the assignment keyed by the venue id is the only one
// firestore.rules honours (assignedVenueStaff). Any other record naming the same
// venue — the seeded "-staff-2" rows — grants nothing, and reading that venue's
// bookings on its strength is refused, so it is ignored here.
const ownedAssignments = (snapshot) => snapshot.docs.filter((item) => item.id === item.data().venue_id);

export const loadVenueCatalogue = async ({ userId, role } = {}) => {
  const assignmentsRequest = role === ROLES.VENUE_STAFF && userId
    ? getDocs(query(collection(db, "venue_staff"), where("user_id", "==", userId)))
    : Promise.resolve({ docs: [] });
  const [venues, layouts, facilities, access, hours, assignments] = await Promise.all([
    getDocs(collection(db, "venues")),
    getDocs(collection(db, "venue_layouts")),
    getDocs(collection(db, "venue_facilities")),
    getDocs(collection(db, "venue_accessibility")),
    getDocs(collection(db, "venue_operating_hours")),
    assignmentsRequest
  ]);
  const assignedVenueIds = new Set(ownedAssignments(assignments).map((item) => item.data().venue_id));
  return assemble(venues, {
    layouts: grouped(layouts),
    facilities: grouped(facilities),
    access: grouped(access),
    hours: grouped(hours)
  }, assignedVenueIds);
};

// E10 is intentionally a narrower read than the planning catalogue. Safety
// Officers may read venue safety fields, but do not need facilities, operating
// hours or staff assignments and have no permission to edit any venue record.
export const loadVenueSafetyCatalogue = async () => {
  const venues = await getDocs(collection(db, "venues"));
  return venues.docs.map((item) => {
    const data = item.data();
    return {
      venue_id: data.venue_id || item.id,
      name: data.name || item.id,
      building: data.building || "",
      location: data.location || "",
      max_capacity: Number(data.max_capacity) || 0,
      emergency_access_notes: data.emergency_access_notes || "",
      known_restrictions: data.known_restrictions || ""
    };
  }).sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
};

export const saveVenueCatalogue = (venue) => updateDoc(doc(db, "venues", venue.venue_id), {
    name: venue.name.trim(),
    building: venue.building.trim(),
    location: venue.location.trim(),
    max_capacity: venue.max_capacity,
    special_space_availability: venue.special_space_availability.trim(),
    layouts: venue.layouts,
    facilities: venue.facilities,
    accessibility: venue.accessibility,
    operating_hours: venue.operating_hours
  });

export const saveVenuePlanningDetails = async ({ user, venueId, changes = {} }) => {
  const userId = requiredUser(user);
  if (!venueId) throw new Error("That venue could not be identified.");
  const update = {};
  for (const field of ["setup_minutes", "turnaround_minutes"]) {
    if (!(field in changes)) continue;
    const value = Number(changes[field]);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${field === "setup_minutes" ? "Setup" : "Turnaround"} time must be a whole number of minutes at least zero.`);
    }
    update[field] = value;
  }
  for (const field of ["emergency_access_notes", "known_restrictions"]) {
    if (field in changes) update[field] = String(changes[field] || "").trim();
  }

  const venueRef = doc(db, "venues", venueId);
  const [assignmentSnapshot, bookingSnapshot] = await Promise.all([
    getDocs(query(collection(db, "venue_staff"), where("venue_id", "==", venueId), where("user_id", "==", userId))),
    getDocs(query(collection(db, "venue_bookings"), where("venue_id", "==", venueId)))
  ]);
  const [owned] = ownedAssignments(assignmentSnapshot);
  if (!owned) throw new Error("You are not assigned to manage this venue.");

  const saved = await runTransaction(db, async (transaction) => {
    const [venueSnapshot, assignment, ...bookings] = await Promise.all([
      transaction.get(venueRef),
      transaction.get(owned.ref),
      ...bookingSnapshot.docs.map((item) => transaction.get(item.ref))
    ]);
    if (!venueSnapshot.exists()) throw new Error("Venue not found.");
    if (!assignment.exists() || assignment.data().user_id !== userId || assignment.data().venue_id !== venueId) {
      throw new Error("You are not assigned to manage this venue.");
    }
    const current = venueSnapshot.data();
    const changed = Object.entries(update).filter(([field, value]) =>
      (current[field] ?? (field.endsWith("_minutes") ? 0 : "")) !== value);
    if (!changed.length) return { venue_id: venueId, ...current, ...update };

    transaction.update(venueRef, update);
    if (changed.some(([field]) => field.endsWith("_minutes"))) {
      const revisedVenue = { ...current, ...update };
      bookings.filter((item) => item.exists() && item.data().status === "APPROVED").forEach((item) => {
        const start = asDate(item.data().start_datetime);
        const end = asDate(item.data().end_datetime);
        if (!start || !end) return;
        const occupied = occupiedWindow(start, end, revisedVenue);
        transaction.update(item.ref, { occupied_start: occupied.start, occupied_end: occupied.end });
      });
    }
    changed.forEach(([field, value]) => {
      const historyRef = doc(collection(db, "venue_change_history"));
      transaction.set(historyRef, {
        history_id: historyRef.id,
        venue_id: venueId,
        actor_id: userId,
        field_name: field,
        old_value: current[field] ?? (field.endsWith("_minutes") ? 0 : ""),
        new_value: value,
        created_at: serverTimestamp()
      });
    });
    const relatedEvents = [...new Set(
      bookingSnapshot.docs
        .filter((item) => item.data().status && ["PENDING", "APPROVED"].includes(String(item.data().status || "").toUpperCase()))
        .map((item) => item.data().event_id)
        .filter(Boolean)
    )];
    // The venue's one owner is the caller — listing venue_staff by venue is
    // refused to Venue Staff, so it is not queried.
    const venueStaffUsers = [userId];
    const changedAt = serverTimestamp();
    relatedEvents.forEach((eventId) => {
      venueStaffUsers.forEach((recipient) => {
        const notificationRef = doc(collection(db, "notifications"));
        transaction.set(notificationRef, {
          ...notificationRecord({
            notificationId: notificationRef.id,
            userId: recipient,
            eventId,
            type: "VENUE_DETAILS_UPDATED",
            message: `${current.name || venueId}: venue details changed for a related event.`,
            createdAt: changedAt
          }),
          venue_id: venueId
        });
      });
    });
    return { venue_id: venueId, ...current, ...update };
  });
  // F10 AC1/AC4: notification recipients must be the current coordinators, and
  // the recheck must remain available without granting Venue Staff broad event
  // reads. This is one of the deliberately trusted server operations.
  if (("setup_minutes" in update || "turnaround_minutes" in update) && user?.getIdToken) {
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/venues/${encodeURIComponent(venueId)}/recheck-conflicts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Venue clash notifications could not be refreshed.");
      }
    } catch (error) {
      // The saved occupied windows are enough for the browser queue to derive
      // live clashes. Only cross-user notifications/audit wait for the trusted
      // service, so an unavailable backend must not report that the venue save
      // itself failed.
      console.warn("Venue details were saved, but server-side clash notifications were not refreshed.", error);
    }
  }
  return saved;
};

// Venue Staff may read bookings only for the venues assigned to them
// (assignedVenueStaff in firestore.rules), and Firestore refuses any list query
// it cannot prove stays inside that — so theirs are read one venue at a time.
// Everyone else reads the whole collection, as before.
const loadSearchBookings = async (venues, role) => {
  if (role !== ROLES.VENUE_STAFF) return (await getDocs(collection(db, "venue_bookings"))).docs;
  const assigned = venues.filter((venue) => venue.is_assigned_to_user).map((venue) => venue.venue_id);
  const perVenue = await Promise.all(assigned.map((venueId) =>
    getDocs(query(collection(db, "venue_bookings"), where("venue_id", "==", venueId)))));
  return perVenue.flatMap((snapshot) => snapshot.docs);
};

export const loadVenueSearchContext = async ({ userId, role } = {}) => {
  const [venues, unavailabilitySnap] = await Promise.all([
    loadVenueCatalogue({ userId, role }),
    getDocs(collection(db, "venue_unavailability"))
  ]);
  const bookingDocs = await loadSearchBookings(venues, role);
  const bookings = bookingDocs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      booking_id: data.booking_id || item.id,
      reference_no: data.reference_no || "",
      event_id: data.event_id || "",
      event_name: data.event_name || "",
      venue_id: data.venue_id,
      status: data.status,
      start_datetime: asIso(data.occupied_start || data.start_datetime),
      end_datetime: asIso(data.occupied_end || data.end_datetime),
      hold_expires_at: asIso(data.hold_expires_at),
      start_time: data.start_time || null,
      end_time: data.end_time || null,
      suitability_acknowledgement: data.suitability_acknowledgement || null
    };
  });
  const unavailability = unavailabilitySnap.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      venue_id: data.venue_id,
      reason: data.reason,
      start_datetime: asIso(data.start_datetime),
      end_datetime: asIso(data.end_datetime),
      start_time: data.start_time || null,
      end_time: data.end_time || null
    };
  });
  return { venues, bookings, unavailability };
};

export const saveVenueUnavailability = async ({ user, venueId, keepPeriodIds, additions }) => {
  if (!user?.getIdToken) throw new Error("Sign in is required to save venue availability changes.");
  const token = await user.getIdToken();
  const response = await fetch("/api/venues/unavailability", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      venue_id: venueId,
      keep_period_ids: keepPeriodIds,
      additions
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Availability changes could not be saved.");
  return result;
};

// E8 — raise a booking request for a venue the suitability gate has cleared.
// The acknowledgement travels with the request so Venue Staff assess it knowing
// which shortfalls the coordinator accepted. firestore.rules re-checks capacity
// and the acknowledgement shape, so a crafted request cannot skip the gate.
//
// F12 — an event may hold several bookings, each with its own label, expected
// attendance and layout. A caller that sends no label or attendance gets the
// event's, as before F12; one that sends them has them validated.
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
    if (event.coordinator_id !== userId) throw new Error("Only the current event coordinator may request a venue.");
    if (!["APPROVED", "PLANNING"].includes(String(event.status || "").toUpperCase())) {
      throw new Error("Venue requests are available only for Approved or Planning events.");
    }
    if (venue.is_active === false) throw new Error("This venue is inactive and cannot be requested.");
    if (replacementRef) {
      if (!replacementSnapshot?.exists()) throw new Error("The booking needing replacement was not found.");
      const replaced = replacementSnapshot.data();
      if (replaced.event_id !== event_id || replaced.replacement_needed !== true) {
        throw new Error("This booking is not awaiting a replacement for this event.");
      }
      if (replaced.venue_id === venue_id) throw new Error("Choose a different venue from the unavailable venue.");
    }
    const eventAttendance = Number(event.expected_attendance);
    if (!Number.isInteger(eventAttendance) || eventAttendance <= 0) throw new Error("Expected attendance must be a positive whole number.");
    const label = booking_label === undefined
      ? `${event.name || event.reference_no || event_id} — ${venue.name || venue_id}`
      : String(booking_label || "").trim();
    const errors = bookingDetailsErrors({
      label,
      expected_attendance: expected_attendance === undefined ? eventAttendance : expected_attendance,
      layout: layoutSnapshot
    }, event);
    const firstError = errors.label || errors.expected_attendance;
    if (firstError) throw new Error(firstError);
    const attendance = expected_attendance === undefined ? eventAttendance : Number(expected_attendance);
    const start = eventDateTime(event.event_date, event.start_time);
    const end = eventDateTime(event.event_date, event.end_time);
    if (!start || !end || end <= start) throw new Error("The event must have a valid date and time window.");
    const occupied = occupiedWindow(start, end, venue);
    // F12 AC4 — another venue for this event is fine; this venue again at an
    // overlapping time is not.
    const clash = clashingEventBooking(
      existing.filter((item) => item.exists()).map((item) => item.data()),
      { eventId: event_id, venueId: venue_id, start: occupied.start, end: occupied.end }
    );
    if (clash) {
      throw new Error(`This event already has an active booking for ${venue.name || venue_id} at an overlapping time: ${clash.booking_label || clash.booking_id}.`);
    }
    const hold = activeHoldClash(holds, { venueId: venue_id, start: occupied.start, end: occupied.end, now });
    if (hold) {
      throw new Error(`${venue.name || venue_id} is held for ${hold.booking_label || hold.booking_id} until `
        + `${singaporeDateTime(hold.hold_expires_at)}, and cannot be requested for an overlapping time.`);
    }
    if (Number(venue.max_capacity) < attendance) throw new Error("The venue cannot hold the expected attendance.");
    const bookingRef = doc(collection(db, "venue_bookings"));
    transaction.set(bookingRef, {
      booking_id: bookingRef.id,
      event_id,
      venue_id,
      event_name: event.name || event.reference_no || event_id,
      event_reference_no: event.reference_no || null,
      event_purpose: event.purpose || null,
      event_description: event.description || null,
      registration_required: Boolean(event.registration_required),
      assigned_staff_id: null,
      start_datetime: start,
      end_datetime: end,
      occupied_start: occupied.start,
      occupied_end: occupied.end,
      expected_attendance: attendance,
      status: "PENDING",
      decision_reason: null,
      requested_layout_id: layoutSnapshot,
      layout_snapshot: layoutSnapshot,
      required_facilities_snapshot: facilitySnapshot,
      booking_label: label,
      submitted_at: serverTimestamp(),
      decided_at: null,
      decided_by: null,
      released_at: null,
      release_reason: null,
      requires_re_request: false,
      replacement_needed: false,
      replacement_for_booking_id: replacement_for_booking_id || null,
      replacement_original_venue_id: replacementSnapshot?.data()?.venue_id || null,
      replacement_original_label: replacementSnapshot?.data()?.booking_label || null,
      replacement_reason: replacementSnapshot?.data()?.replacement_reason || null,
      replaced_by_booking_id: null,
      replaced_at: null,
      safety_review_required: Boolean(event.safety_review_required),
      suitability_acknowledgement: acknowledgement || { acknowledged: false, criteria: [] },
      requested_by: userId
    });
    const changedAt = serverTimestamp();
    const recipient = venueStaffSnapshot.exists() ? venueStaffSnapshot.data().user_id : null;
    if (recipient) {
      const notificationRef = doc(collection(db, "notifications"));
      transaction.set(notificationRef, {
        ...notificationRecord({
          notificationId: notificationRef.id,
          userId: recipient,
          eventId: event_id,
          type: "VENUE_BOOKING_REQUESTED",
          message: `${event.name || event.reference_no || event_id}: a venue booking request was raised for ${venue.name || venue_id}.`,
          createdAt: changedAt,
          eventName: event.name || event.reference_no || event_id
        }),
        venue_id: venue_id
      });
    }
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
    if (String(event.status || "").toUpperCase() === "CONFIRMED") {
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

export const loadVenueBookingQueue = async ({ user }) => {
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

export const rejectVenueBooking = async ({ user, bookingId, reason }) => {
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
    if (["CONFIRMED", "SAFETY_REVIEW"].includes(String(event.status || "").toUpperCase())) {
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
