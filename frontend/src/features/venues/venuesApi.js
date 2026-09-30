// Loads venue catalogue documents and the related collections this epic owns.
// Joins happen here so domain/venueSearch.js stays free of Firestore.

import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
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
      event_name: data.event_name || "",
      venue_id: data.venue_id,
      status: data.status,
      start_datetime: asIso(data.start_datetime),
      end_datetime: asIso(data.end_datetime),
      start_time: data.start_time || null,
      end_time: data.end_time || null
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
