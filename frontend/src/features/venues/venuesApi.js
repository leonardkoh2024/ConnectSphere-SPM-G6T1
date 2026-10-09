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
  const assignedVenueIds = new Set(assignments.docs.map((item) => item.data().venue_id).filter(Boolean));
  return assemble(venues, {
    layouts: grouped(layouts),
    facilities: grouped(facilities),
    access: grouped(access),
    hours: grouped(hours)
  }, assignedVenueIds);
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
  if (!assignmentSnapshot.docs.length) throw new Error("You are not assigned to manage this venue.");

  return runTransaction(db, async (transaction) => {
    const [venueSnapshot, assignment, ...bookings] = await Promise.all([
      transaction.get(venueRef),
      transaction.get(assignmentSnapshot.docs[0].ref),
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
    return { venue_id: venueId, ...current, ...update };
  });
};

export const loadVenueSearchContext = async ({ userId, role } = {}) => {
  const [venues, bookingsSnap, unavailabilitySnap] = await Promise.all([
    loadVenueCatalogue({ userId, role }),
    getDocs(collection(db, "venue_bookings")),
    getDocs(collection(db, "venue_unavailability"))
  ]);
  const bookings = bookingsSnap.docs.map((item) => {
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
export const requestVenueBooking = async ({
  user,
  venue_id,
  event_id,
  required_layout,
  acknowledgement
}) => {
  const userId = requiredUser(user);
  if (!event_id || !venue_id) throw new Error("An event and venue are required.");
  const eventRef = doc(db, "events", event_id);
  const venueRef = doc(db, "venues", venue_id);
  const existingSnapshot = await getDocs(query(collection(db, "venue_bookings"), where("event_id", "==", event_id)));
  return runTransaction(db, async (transaction) => {
    const [eventSnapshot, venueSnapshot, ...existing] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(venueRef),
      ...existingSnapshot.docs.map((item) => transaction.get(item.ref))
    ]);
    if (!eventSnapshot.exists()) throw new Error("Event not found.");
    if (!venueSnapshot.exists()) throw new Error("Venue not found.");
    const event = eventSnapshot.data();
    const venue = venueSnapshot.data();
    if (event.coordinator_id !== userId) throw new Error("Only the current event coordinator may request a venue.");
    if (!["APPROVED", "PLANNING"].includes(String(event.status || "").toUpperCase())) {
      throw new Error("Venue requests are available only for Approved or Planning events.");
    }
    if (venue.is_active === false) throw new Error("This venue is inactive and cannot be requested.");
    if (existing.some((item) => item.exists()
      && item.data().venue_id === venue_id
      && ["PENDING", "APPROVED"].includes(String(item.data().status || "").toUpperCase()))) {
      throw new Error("This event already has an active request for that venue.");
    }
    const start = eventDateTime(event.event_date, event.start_time);
    const end = eventDateTime(event.event_date, event.end_time);
    if (!start || !end || end <= start) throw new Error("The event must have a valid date and time window.");
    const attendance = Number(event.expected_attendance);
    if (!Number.isInteger(attendance) || attendance <= 0) throw new Error("Expected attendance must be a positive whole number.");
    if (Number(venue.max_capacity) < attendance) throw new Error("The venue cannot hold the expected attendance.");
    const occupied = occupiedWindow(start, end, venue);
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
      requested_layout_id: required_layout || event.required_layout || null,
      layout_snapshot: required_layout || event.required_layout || null,
      booking_label: `${event.name || event.reference_no || event_id} — ${venue.name || venue_id}`,
      submitted_at: serverTimestamp(),
      decided_at: null,
      decided_by: null,
      released_at: null,
      release_reason: null,
      requires_re_request: false,
      replacement_needed: false,
      replaced_by_booking_id: null,
      replaced_at: null,
      safety_review_required: Boolean(event.safety_review_required),
      suitability_acknowledgement: acknowledgement || { acknowledged: false, criteria: [] },
      requested_by: userId
    });
    return { booking_id: bookingRef.id, status: "PENDING" };
  });
};

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
  const venueSnapshots = await Promise.all(venueIds.map((venueId) => getDoc(doc(db, "venues", venueId))));
  const venueNames = new Map(venueSnapshots.filter((item) => item.exists()).map((item) => [item.id, item.data().name]));
  return bookingDocs
    .map((data) => ({
      booking_id: data.id,
      ...data.data(),
      event_name: events.get(data.data().event_id)?.name || events.get(data.data().event_id)?.reference_no || data.data().event_name || data.data().event_id,
      event_date: events.get(data.data().event_id)?.event_date || null,
      venue_name: venueNames.get(data.data().venue_id) || data.data().venue_id,
      start_datetime: asIso(data.data().start_datetime),
      end_datetime: asIso(data.data().end_datetime),
      occupied_start: asIso(data.data().occupied_start),
      occupied_end: asIso(data.data().occupied_end),
      submitted_at: asIso(data.data().submitted_at),
      decided_at: asIso(data.data().decided_at),
      released_at: asIso(data.data().released_at),
      requested_at: asIso(data.data().submitted_at || data.data().requested_at),
      suitability_acknowledgement: data.data().suitability_acknowledgement || null
    }))
    .sort((left, right) => String(right.requested_at || "").localeCompare(String(left.requested_at || "")));
};

export const loadVenueBookingQueue = async ({ user }) => {
  const userId = requiredUser(user);
  const assignments = await getDocs(query(collection(db, "venue_staff"), where("user_id", "==", userId)));
  const venueIds = [...new Set(assignments.docs.map((item) => item.data().venue_id).filter(Boolean))];
  const [bookingSnapshots, venueSnapshots] = await Promise.all([
    Promise.all(venueIds.map((venueId) => getDocs(query(collection(db, "venue_bookings"), where("venue_id", "==", venueId))))),
    Promise.all(venueIds.map((venueId) => getDoc(doc(db, "venues", venueId))))
  ]);
  const venueNames = new Map(venueSnapshots.filter((item) => item.exists()).map((item) => [item.id, item.data().name]));
  return bookingSnapshots.flatMap((snapshot) => snapshot.docs)
    .filter((item) => item.data().status === "PENDING")
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
        submitted_at: asIso(booking.submitted_at)
      };
    })
    .sort((left, right) => String(left.submitted_at || "").localeCompare(String(right.submitted_at || "")));
};

export const approveVenueBooking = async ({ user, bookingId }) => {
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
  if (!assignments.docs.length) throw new Error("You are not assigned to manage this venue.");
  return runTransaction(db, async (transaction) => {
    const [bookingSnapshot, venueSnapshot, assignment, ...related] = await Promise.all([
      transaction.get(bookingRef),
      transaction.get(doc(db, "venues", venueId)),
      transaction.get(assignments.docs[0].ref),
      ...bookings.docs.filter((item) => item.id !== bookingId).map((item) => transaction.get(item.ref)),
      ...unavailable.docs.map((item) => transaction.get(item.ref))
    ]);
    if (!bookingSnapshot.exists()) throw new Error("Booking request not found.");
    const booking = bookingSnapshot.data();
    if (booking.status !== "PENDING") throw new Error("Only Pending booking requests can be approved.");
    if (!venueSnapshot.exists()) throw new Error("Venue not found.");
    if (!assignment.exists() || assignment.data().user_id !== userId) throw new Error("You are not assigned to manage this venue.");
    const venue = venueSnapshot.data();
    const start = asDate(booking.start_datetime);
    const end = asDate(booking.end_datetime);
    if (!start || !end || end <= start) throw new Error("The booking has an invalid date and time window.");
    const occupied = occupiedWindow(start, end, venue);
    const competing = related.slice(0, Math.max(0, bookings.docs.length - 1)).filter((item) => item.exists());
    const blocks = related.slice(Math.max(0, bookings.docs.length - 1)).filter((item) => item.exists());
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
    const submitted = asDate(booking.submitted_at) || new Date(0);
    const earlier = competing.find((item) => {
      const window = windowFor(item);
      return item.data().status === "PENDING" && window
        && overlaps(occupied.start, occupied.end, window.start, window.end)
        && (asDate(item.data().submitted_at) || new Date(0)) < submitted;
    });
    if (earlier) throw new Error("An earlier submitted request for this venue and time must be decided first.");
    const decidedAt = serverTimestamp();
    transaction.update(bookingRef, {
      status: "APPROVED",
      assigned_staff_id: userId,
      decided_by: userId,
      decided_at: decidedAt,
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
      action_type: "VENUE_BOOKING_APPROVED",
      field_name: "venue_booking_status",
      old_value: "PENDING",
      new_value: "APPROVED",
      description: `Venue booking ${booking.booking_label || bookingId} approved.`,
      created_at: decidedAt
    });
    return { booking_id: bookingId, status: "APPROVED" };
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
    bookingSnapshots.filter((item) => item.exists()).forEach((item) => {
      const booking = item.data();
      const status = booking.status === "APPROVED" ? "RELEASED" : booking.status === "PENDING" ? "WITHDRAWN" : null;
      if (!status) return;
      const now = serverTimestamp();
      transaction.update(item.ref, { status, released_at: now, release_reason: reason });
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
    return changed;
  });
};

// E8 / F1 AC4 — withdrawing frees the event-and-venue pairing to be requested
// again. The record stays, so what was acknowledged at the time is not erased.
export const withdrawVenueBooking = async ({ bookingId }) => {
  if (!bookingId) throw new Error("That booking could not be identified.");
  await updateDoc(doc(db, "venue_bookings", bookingId), {
    status: "WITHDRAWN",
    withdrawn_at: serverTimestamp()
  });
  return { booking_id: bookingId, status: "WITHDRAWN" };
};
