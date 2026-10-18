// F15 — a tentative hold on a venue. Venue Staff put a pending booking request
// on hold while its coordinator finalises the event; the hold keeps the venue
// for exactly three working days and then lapses unless converted (AC7).
// No React, no Firebase: venuesApi, the calendar and the screens call these.
//
// Three working days is a fixed rule (decided 19 Oct 2026): Monday to Friday,
// in Singapore time, ending at the same clock time the hold was placed. Public
// holidays are not counted out — the customer never named them, so that is a
// Session 3 question. firestore.rules repeats this count (holdExpiryIsThreeWorkingDays).

export const HOLD_WORKING_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
// Singapore keeps UTC+8 all year, so its wall clock is a fixed shift from UTC.
const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const asDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const singaporeClock = (date) => new Date(date.getTime() + SINGAPORE_OFFSET_MS);
const isWeekend = (clock) => clock.getUTCDay() === 0 || clock.getUTCDay() === 6;

// AC1 — when a hold placed at `placedAt` lapses.
export const holdExpiry = (placedAt) => {
  const placed = asDate(placedAt);
  let days = 0;
  let counted = 0;
  while (counted < HOLD_WORKING_DAYS) {
    days += 1;
    if (!isWeekend(singaporeClock(new Date(placed.getTime() + days * DAY_MS)))) counted += 1;
  }
  return new Date(placed.getTime() + days * DAY_MS);
};

// "Thu 22 Oct 2026, 10:00", in Singapore time whatever the viewer's own zone,
// so a hold's expiry reads the same to Venue Staff and the coordinator.
export const singaporeDateTime = (value) => {
  const date = asDate(value);
  if (!date) return "";
  const clock = singaporeClock(date);
  const pad = (number) => String(number).padStart(2, "0");
  return `${WEEKDAY_NAMES[clock.getUTCDay()]} ${clock.getUTCDate()} ${MONTH_NAMES[clock.getUTCMonth()]} ${clock.getUTCFullYear()}, `
    + `${pad(clock.getUTCHours())}:${pad(clock.getUTCMinutes())}`;
};

const occupiedStart = (booking) => asDate(booking.occupied_start || booking.start_datetime);
const occupiedEnd = (booking) => asDate(booking.occupied_end || booking.end_datetime);

// AC2 — why the request cannot be held now, or null. The expiry is always in
// the future; it must also end strictly before the venue is first needed, so a
// hold never runs into the event it is keeping the venue for.
export const holdRefusal = ({ booking, now = new Date() }) => {
  if (String(booking?.status || "").toUpperCase() !== "PENDING") return "Only a pending booking request can be put on hold.";
  const expiry = holdExpiry(now);
  const needed = occupiedStart(booking);
  if (needed && expiry >= needed) {
    return `A hold placed now would last until ${singaporeDateTime(expiry)}, but the venue is needed from ${singaporeDateTime(needed)}. `
      + "Approve or reject this request instead.";
  }
  return null;
};

// A hold keeps the venue until its expiry. Converted, it is an approved booking
// and no longer expires (AC7); expired, it keeps nothing (F16).
export const isActiveHold = (booking, now = new Date()) => {
  if (String(booking?.status || "").toUpperCase() !== "HELD") return false;
  const expiry = asDate(booking.hold_expires_at);
  return Boolean(expiry) && asDate(now) < expiry;
};

// AC3 — the active hold on this venue that overlaps the window asked for, or
// null. Windows that only touch do not overlap.
export const activeHoldClash = (bookings = [], { venueId, start, end, now = new Date(), excludeBookingId = null }) => {
  const from = asDate(start);
  const to = asDate(end);
  if (!from || !to) return null;
  return bookings.find((booking) => {
    if (booking.venue_id !== venueId || !isActiveHold(booking, now)) return false;
    if (excludeBookingId && (booking.booking_id || booking.id) === excludeBookingId) return false;
    const heldFrom = occupiedStart(booking);
    const heldTo = occupiedEnd(booking);
    return heldFrom && heldTo && from < heldTo && heldFrom < to;
  }) || null;
};
