import { useCallback, useEffect, useState } from "react";
import { ROLES } from "../../domain/roles";
import { venueBookingClashCount } from "../../domain/venueBookingWorkflows";
import { loadVenueBookingQueue, loadVenueBookings } from "./venuesApi";

const loaderFor = (role) => {
  if (role === ROLES.COORDINATOR) return loadVenueBookings;
  if (role === ROLES.VENUE_STAFF) return loadVenueBookingQueue;
  return null;
};

// Refresh when the browser regains focus; the booking screens also call
// setFromBookings after their own actions for an immediate update. Deliberately
// avoid polling: each refresh spans several event/venue queries and would waste
// the project's Firestore read quota while the tab is idle.
export default function useVenueClashCount(user, role) {
  const [count, setCount] = useState(0);
  const load = loaderFor(role);
  const userId = user?.uid;

  const setFromBookings = useCallback((bookings) => {
    setCount(venueBookingClashCount(bookings));
  }, []);

  const refresh = useCallback(async () => {
    if (!userId || !load) { setCount(0); return; }
    try {
      setFromBookings(await load({ user: { uid: userId } }));
    } catch (error) {
      // A badge must never prevent the workspace from loading. The destination
      // screen still displays its normal actionable error if the read fails.
      console.error("Could not refresh venue clash count:", error);
    }
  }, [load, setFromBookings, userId]);

  useEffect(() => {
    refresh();
    if (!load) return undefined;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load, refresh]);

  return { count, refresh, setFromBookings };
}
