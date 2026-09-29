// Loads venue catalogue documents and the related collections this epic owns.
// Joins happen here so domain/venueSearch.js stays free of Firestore.

import { collection, getDocs } from "firebase/firestore";
import { db } from "../../lib/firebase";

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

const assemble = (venuesSnap, related) =>
  venuesSnap.docs.map((item) => {
    const data = item.data();
    const venueId = data.venue_id || item.id;
    return {
      venue_id: venueId,
      name: data.name,
      building: data.building,
      location: data.location,
      max_capacity: Number(data.max_capacity) || 0,
      facilities: (related.facilities[venueId] || []).map((row) => row.facility_id).filter(Boolean),
      layouts: (related.layouts[venueId] || []).map((row) => row.layout_id).filter(Boolean),
      accessibility: (related.access[venueId] || []).map((row) => row.accessibility_id).filter(Boolean),
      operating_hours: (related.hours[venueId] || []).map((row) => ({
        weekday: row.weekday,
        opens_at: row.opens_at,
        closes_at: row.closes_at
      }))
    };
  });

export const loadVenueCatalogue = async () => {
  const [venues, layouts, facilities, access, hours] = await Promise.all([
    getDocs(collection(db, "venues")),
    getDocs(collection(db, "venue_layouts")),
    getDocs(collection(db, "venue_facilities")),
    getDocs(collection(db, "venue_accessibility")),
    getDocs(collection(db, "venue_operating_hours"))
  ]);
  return assemble(venues, {
    layouts: grouped(layouts),
    facilities: grouped(facilities),
    access: grouped(access),
    hours: grouped(hours)
  });
};

export const loadVenueSearchContext = async () => {
  const [venues, bookingsSnap, unavailabilitySnap] = await Promise.all([
    loadVenueCatalogue(),
    getDocs(collection(db, "venue_bookings")),
    getDocs(collection(db, "venue_unavailability"))
  ]);
  const bookings = bookingsSnap.docs.map((item) => {
    const data = item.data();
    return {
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
