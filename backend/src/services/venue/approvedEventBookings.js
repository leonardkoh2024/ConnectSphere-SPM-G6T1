// The venue service owns venue_bookings; other services request this read
// contract rather than constructing queries against that collection themselves.
export const getApprovedEventBookings = async ({ firestore, transaction, eventId }) => {
  const query = firestore.collection("venue_bookings")
    .where("event_id", "==", eventId)
    .where("status", "==", "APPROVED");
  const snapshot = await transaction.get(query);
  return snapshot.docs.map((item) => item.data());
};
