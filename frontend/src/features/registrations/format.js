// How the attendee's screens write dates and times. Shared by Browse events (H2/H3) and
// My registrations (H4).

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;
const pad = (value) => String(value).padStart(2, "0");

// `event_date` is a YYYY-MM-DD calendar date, so it is read as one rather than
// through the browser's time zone.
export const eventDay = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return "Date not set";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return `${DAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

// Instants come back in UTC; attendees read them in Singapore time.
export const singaporeDateTime = (iso) => {
  const parsed = new Date(iso || "");
  if (!iso || Number.isNaN(parsed.getTime())) return null;
  const local = new Date(parsed.getTime() + SINGAPORE_OFFSET_MS);
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}, ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
};

export const timeWindow = (entry) =>
  entry.start_time && entry.end_time ? `${entry.start_time} – ${entry.end_time}` : "Time not set";
