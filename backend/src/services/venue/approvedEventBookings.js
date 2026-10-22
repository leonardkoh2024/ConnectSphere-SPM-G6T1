// The venue service owns venue_bookings; other services request this read
// contract rather than constructing queries against that collection themselves.
export const getApprovedEventBookings = async ({ firestore, transaction, eventId }) => {
  const query = firestore.collection("venue_bookings")
    .where("event_id", "==", eventId)
    .where("status", "==", "APPROVED");
  const snapshot = await transaction.get(query);
  return snapshot.docs.map((item) => item.data());
};

// H2 — the names of the venues an event has approved bookings for, in the order
// first booked, for the registration service's attendee listing. Venue ids with
// no catalogue record fall back to the id rather than vanishing.
export const getApprovedEventVenueNames = async ({ firestore, eventId }) => {
  const snapshot = await firestore.collection("venue_bookings")
    .where("event_id", "==", eventId)
    .where("status", "==", "APPROVED")
    .get();
  const venueIds = [...new Set(snapshot.docs.map((item) => item.data().venue_id).filter(Boolean))];
  const venues = await Promise.all(venueIds.map((venueId) => firestore.collection("venues").doc(venueId).get()));
  return venues.map((venue, index) => (venue.exists && venue.data().name) || venueIds[index]);
};
