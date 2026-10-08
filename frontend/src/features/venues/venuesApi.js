// Loads venue catalogue documents and the related collections this epic owns.
// Joins happen here so domain/venueSearch.js stays free of Firestore.

import { addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { ROLES } from "../../domain/roles";

const asIso = (value) => value?.toDate?.().toISOString?.() || value || null;

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
      start_datetime: asIso(data.start_datetime),
      end_datetime: asIso(data.end_datetime),
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
const combine = (date, time) => {
  if (!date || !time) return null;
  const value = new Date(`${date}T${time}`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
};

export const requestVenueBooking = async ({
  user,
  venue_id,
  event_id,
  event_name,
  event_date,
  start_time,
  end_time,
  expected_attendance,
  required_layout,
  required_facilities,
  acknowledgement
}) => {
  if (!user?.uid) throw new Error("Sign in is required to request a venue.");
  const created = await addDoc(collection(db, "venue_bookings"), {
    venue_id,
    event_id,
    event_name: event_name || "",
    event_date,
    start_time,
    end_time,
    start_datetime: combine(event_date, start_time),
    end_datetime: combine(event_date, end_time),
    expected_attendance,
    required_layout: required_layout || null,
    required_facilities: required_facilities || [],
    status: "PENDING",
    requested_by: user.uid,
    requested_at: serverTimestamp(),
    suitability_acknowledgement: acknowledgement
  });
  return { booking_id: created.id };
};

// E8 — the coordinator's own booking requests, newest first. Venue Staff see the
// same collection through their own queue; this view is scoped to the raiser.
export const loadVenueBookings = async ({ userId }) => {
  if (!userId) return [];
  const snapshot = await getDocs(query(collection(db, "venue_bookings"), where("requested_by", "==", userId)));
  return snapshot.docs
    .map((item) => {
      const data = item.data();
      return {
        booking_id: item.id,
        venue_id: data.venue_id,
        event_id: data.event_id,
        event_name: data.event_name || "",
        event_date: data.event_date || "",
        start_time: data.start_time || "",
        end_time: data.end_time || "",
        expected_attendance: data.expected_attendance ?? null,
        status: data.status || "PENDING",
        requested_at: asIso(data.requested_at),
        suitability_acknowledgement: data.suitability_acknowledgement || null
      };
    })
    .sort((left, right) => String(right.requested_at || "").localeCompare(String(left.requested_at || "")));
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
