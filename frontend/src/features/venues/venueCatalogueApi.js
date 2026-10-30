// The venue catalogue (epic E): loading venues with the related collections this
// epic owns, searching them, and Venue Staff editing planning details and
// unavailability. Joins happen here so domain/venueSearch.js stays free of Firestore.

import { collection, doc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { notificationRecord } from "../../domain/eventReviewRecords";
import { ROLES } from "../../domain/roles";
import { asDate, occupiedWindow, ownedAssignments, requiredUser } from "./venueApiSupport";
import { asIso } from "../../lib/apiSupport";

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
