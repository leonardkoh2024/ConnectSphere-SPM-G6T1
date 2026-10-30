// Helpers shared by the venue API modules: date handling, the signed-in user,
// which venues a staff member owns, the occupied-window arithmetic, and the
// once-per-page backend workflow refresh.

export const asDate = (value) => {
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const requiredUser = (user) => {
  if (!user?.uid) throw new Error("Sign in is required.");
  return user.uid;
};

// One request per signed-in user and browser page lifetime. Venue booking
// screens and the sidebar badge often mount together; sharing this promise
// prevents a refresh from launching the same backend scan several times.
const workflowRefreshes = new Map();

export const refreshVenueWorkflowsOnLoad = ({ user }) => {
  if (!user?.uid || typeof user.getIdToken !== "function") return Promise.resolve(null);
  if (workflowRefreshes.has(user.uid)) return workflowRefreshes.get(user.uid);
  const refresh = user.getIdToken()
    .then((token) => fetch("/api/venues/workflows/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    }))
    .then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Venue workflows could not be refreshed.");
      return result;
    })
    .catch((error) => {
      // The browser-side queue remains usable when the optional backend is not
      // running; do not retry repeatedly during the same page session.
      console.error("Could not refresh venue workflows:", error);
      return null;
    });
  workflowRefreshes.set(user.uid, refresh);
  return refresh;
};

export const occupiedWindow = (start, end, venue = {}) => ({
  start: new Date(start.getTime() - (Number(venue.setup_minutes) || 0) * 60000),
  end: new Date(end.getTime() + (Number(venue.turnaround_minutes) || 0) * 60000)
});

// One owner per venue: the assignment keyed by the venue id is the only one
// firestore.rules honours (assignedVenueStaff). Any other record naming the same
// venue — the seeded "-staff-2" rows — grants nothing, and reading that venue's
// bookings on its strength is refused, so it is ignored here.
export const ownedAssignments = (snapshot) => snapshot.docs.filter((item) => item.id === item.data().venue_id);
