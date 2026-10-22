// H2 / SCRUM-140 — which events an attendee may find, and what each entry shows.
//
// The registration service runs these functions on the server (the browser of an
// attendee cannot read `events` at all), so they are written as an .mjs module the
// backend imports unchanged. No React and no Firebase.

// H1 AC1: registration can be open only once an event is Approved, and stays open
// while it is being planned and checked. Completed, Cancelled and Rejected events
// are never listed, nor is anything still in the organiser's or coordinator's hands.
// H3 AC1 speaks of "confirmed" events; that wording predates Week 7's Safety
// Review step, and H1 is the story that decides when registration may open.
export const REGISTRATION_OPEN_STATUSES = ["APPROVED", "PLANNING", "SAFETY_REVIEW", "CONFIRMED"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

// Event dates and times are stored as Singapore wall-clock strings, so they are
// read at +08:00 whatever zone the server runs in.
const singaporeTime = (date, time) => {
  if (!DATE.test(String(date || "")) || !TIME.test(String(time || ""))) return null;
  const parsed = new Date(`${date}T${time}:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const registrationWindow = (event = {}) => ({
  opensAt: singaporeTime(event.registration_open_date, event.registration_open_time),
  closesAt: singaporeTime(event.registration_close_date, event.registration_close_time)
});

const usableCapacity = (value) => Number.isInteger(value) && value > 0;

// Open from the opening minute up to, but not including, the closing minute: an
// event that "closes at 17:00" takes no registration at 17:00.
export const isOpenForRegistration = (event, now = new Date()) => {
  if (!event || event.registration_required !== true) return false;
  if (!REGISTRATION_OPEN_STATUSES.includes(String(event.status || "").toUpperCase())) return false;
  if (!usableCapacity(event.registration_capacity)) return false;
  const { opensAt, closesAt } = registrationWindow(event);
  if (!opensAt || !closesAt || opensAt >= closesAt) return false;
  return opensAt <= now && now < closesAt;
};

export const remainingPlaces = (capacity, registeredCount = 0) =>
  Math.max(0, (Number(capacity) || 0) - (Number(registeredCount) || 0));

export const placesLabel = (remaining) =>
  remaining <= 0 ? "Full" : `${remaining} ${remaining === 1 ? "place" : "places"} left`;

export const venueLabel = (venueNames) =>
  venueNames?.length ? venueNames.join(", ") : "Venue to be confirmed";

// Only what an attendee is meant to read. Anything not named here — organiser and
// coordinator ids, reference number, purpose, status — stays on the server.
export const openEventListing = (event, { venueNames = [], registeredCount = 0 } = {}) => ({
  id: event.id,
  name: event.name || "",
  description: event.description || "",
  event_date: event.event_date || null,
  start_time: event.start_time || null,
  end_time: event.end_time || null,
  venue_names: [...venueNames],
  capacity: event.registration_capacity,
  remaining_places: remainingPlaces(event.registration_capacity, registeredCount),
  registration_closes_at: registrationWindow(event).closesAt?.toISOString() || null
});

const startsAt = (entry) => `${entry.event_date || ""}T${entry.start_time || ""}`;

export const listOpenEvents = (events, { now = new Date(), venueNamesByEvent = {}, registeredCountByEvent = {} } = {}) =>
  events
    .filter((event) => isOpenForRegistration(event, now))
    .map((event) => openEventListing(event, {
      venueNames: venueNamesByEvent[event.id] || [],
      registeredCount: registeredCountByEvent[event.id] || 0
    }))
    .sort((left, right) => startsAt(left).localeCompare(startsAt(right)) || left.name.localeCompare(right.name));
