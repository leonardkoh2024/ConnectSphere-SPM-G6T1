// H2 / SCRUM-140 — the attendee's list of events open for registration. What is
// open, and which fields an attendee may see, is decided by the registration
// service; this screen only lays the entries out.

import React, { useEffect, useState } from "react";
import RecordLead from "../../components/RecordLead";
import { placesLabel, venueLabel } from "../../domain/openRegistration";
import { loadOpenEvents } from "./registrationsApi";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;
const pad = (value) => String(value).padStart(2, "0");

// `event_date` is a YYYY-MM-DD calendar date, so it is read as one rather than
// through the browser's time zone.
const eventDay = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return "Date not set";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return `${DAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

// The closing instant comes back in UTC; attendees read it in Singapore time.
const singaporeDateTime = (iso) => {
  const parsed = new Date(iso || "");
  if (Number.isNaN(parsed.getTime())) return null;
  const local = new Date(parsed.getTime() + SINGAPORE_OFFSET_MS);
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}, ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
};

const timeWindow = (entry) =>
  entry.start_time && entry.end_time ? `${entry.start_time} – ${entry.end_time}` : "Time not set";

const placesTone = (remaining) => (remaining <= 0 ? "danger" : remaining <= 10 ? "warning" : "positive");

export default function BrowseEvents() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    loadOpenEvents()
      .then((rows) => { if (mounted) setEvents(rows); })
      .catch((failure) => { if (mounted) setError(failure.message || "Events open for registration could not be loaded."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  if (loading) return <p className="cs-panel-note">Loading events…</p>;
  if (error) return <p className="cs-error" role="alert">{error}</p>;
  if (!events.length) return <p className="cs-panel-note">No events are open for registration right now.</p>;

  return (
    <div className="cs-record-list" aria-label="Events open for registration">
      {events.map((entry) => {
        const closes = singaporeDateTime(entry.registration_closes_at);
        return (
          <article className="cs-record" key={entry.id}>
            <div className="cs-record-title">
              <RecordLead date={entry.event_date} />
              <div>
                <h2>{entry.name || "Untitled event"}</h2>
                <p>{eventDay(entry.event_date)} · {timeWindow(entry)}</p>
                {entry.description && <p className="cs-browse-description">{entry.description}</p>}
              </div>
            </div>
            <p className="cs-record-ref">{venueLabel(entry.venue_names)}</p>
            <div className="cs-record-status">
              <span className={`cs-pill cs-pill-${placesTone(entry.remaining_places)}`}>{placesLabel(entry.remaining_places)}</span>
            </div>
            <div className="cs-record-modified">
              {closes && <p className="cs-record-saved">Registration closes {closes}</p>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
