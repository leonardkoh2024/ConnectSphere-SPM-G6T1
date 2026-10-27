// H4 / SCRUM-142 — the attendee's own registrations and where each one stands. The
// registration service decides the status shown (a cancelled event reads Cancelled) and
// which event fields an attendee may see; this screen lays them out.

import React, { useCallback, useEffect, useState } from "react";
import RecordLead from "../../components/RecordLead";
import { REGISTRATION_STATUS_LABELS, registrationStatusTone } from "../../domain/myRegistrations";
import { venueLabel } from "../../domain/openRegistration";
import EventDetails from "./components/EventDetails";
import { eventDay, singaporeDateTime, timeWindow } from "./format";
import { loadMyRegistrations } from "./registrationsApi";

const CANCELLED = "CANCELLED";

// A cancelled event's bookings are released (D4), so "to be confirmed" would mislead.
const venueText = (entry) =>
  entry.status === CANCELLED && !entry.venue_names?.length ? "No venue — event cancelled" : venueLabel(entry.venue_names);

const statusPill = (status) => (
  <span className={`cs-pill cs-pill-${registrationStatusTone(status)}`}>{REGISTRATION_STATUS_LABELS[status] || status}</span>
);

export default function MyRegistrations({ onBackChange }) {
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let mounted = true;
    loadMyRegistrations()
      .then((rows) => { if (mounted) setRegistrations(rows); })
      .catch((failure) => { if (mounted) setError(failure.message || "Your registrations could not be loaded."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const closeDetails = useCallback(() => setOpenId(null), []);

  // The shell's "Back to …" closes the details view, as it does on other screens.
  useEffect(() => {
    if (!onBackChange) return undefined;
    onBackChange(openId ? closeDetails : null);
    return () => onBackChange(null);
  }, [openId, onBackChange, closeDetails]);

  if (loading) return <p className="cs-panel-note">Loading your registrations…</p>;
  if (error) return <p className="cs-error" role="alert">{error}</p>;
  if (!registrations.length) return <p className="cs-panel-note">You have not registered for any events yet.</p>;

  // AC2 — the event as an attendee may see it, and their own place on it.
  const open = registrations.find((entry) => entry.registration_id === openId);
  if (open) {
    return (
      <EventDetails
        entry={open}
        venue={venueText(open)}
        notice={open.status === CANCELLED ? <p className="cs-error">This event has been cancelled.</p> : null}
        facts={[
          ["Your registration", REGISTRATION_STATUS_LABELS[open.status] || open.status],
          open.status === "WAITLISTED" && open.waitlist_position !== null && ["Place on the waiting list", String(open.waitlist_position)],
          singaporeDateTime(open.registered_at) && ["Registered on", singaporeDateTime(open.registered_at)],
          open.status === "WITHDRAWN" && singaporeDateTime(open.withdrawn_at) && ["Withdrawn on", singaporeDateTime(open.withdrawn_at)]
        ]}
        backLabel="my registrations"
        onClose={onBackChange ? null : closeDetails}
      />
    );
  }

  return (
    <div className="cs-record-list" aria-label="Your registrations">
      {registrations.map((entry) => (
        <article className="cs-record" key={entry.registration_id}>
          <div className="cs-record-title">
            <RecordLead date={entry.event_date} />
            <div>
              <h2>{entry.name || "Untitled event"}</h2>
              <p>{eventDay(entry.event_date)} · {timeWindow(entry)}</p>
            </div>
          </div>
          <p className="cs-record-ref">{venueText(entry)}</p>
          <div className="cs-record-status">{statusPill(entry.status)}</div>
          <div className="cs-record-modified" />
          <div className="cs-record-actions">
            <button type="button" className="cs-btn cs-btn-ghost cs-record-btn" onClick={() => setOpenId(entry.registration_id)}>View details</button>
          </div>
        </article>
      ))}
    </div>
  );
}
