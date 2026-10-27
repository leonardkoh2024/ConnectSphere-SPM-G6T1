// H8 / SCRUM-146 — who has registered for this event, on the organiser's Registration tab: the
// counts of registered, waitlisted and withdrawn attendees, and a table of the registered with
// their name, email, mobile number and registration time.
//
// The list comes from the registration service, which answers only the organiser of the event
// (the browser has no read of registrations or attendee profiles). Waitlisted and withdrawn
// people are counts and never rows. A load that fails — a refusal, the service down — is an
// alert naming the reason, never a quiet empty list. Refresh asks again and, if that fails,
// keeps the list already on screen. A slow answer for a previous event is ignored.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { registrationApi } from "./registrationApi";

const SINGAPORE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Singapore",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

const formatRegisteredAt = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? SINGAPORE_TIME.format(date) : "Time not recorded";
};

const COUNTS = [["registered", "Registered"], ["waitlisted", "Waitlisted"], ["withdrawn", "Withdrawn"]];

export default function RegistrationList({ eventId }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true); setError("");
    try {
      const loaded = await registrationApi.loadAttendees(eventId);
      if (mine === latest.current) setList(loaded);
    } catch (loadError) {
      if (mine === latest.current) setError(loadError.message);
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    setList(null);
    load();
    return () => { latest.current += 1; };
  }, [load]);

  return (
    <section className="cs-registration-list" aria-labelledby={`registration-list-${eventId}-title`}>
      <div className="cs-registration-list-head">
        <h3 id={`registration-list-${eventId}-title`}>Registered attendees</h3>
        <button className="cs-btn cs-btn-secondary" type="button" onClick={load} disabled={loading}>
          {loading && list ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="cs-error" role="alert">{error}</p>}
      {loading && !list && <p className="cs-panel-note">Loading the registration list…</p>}

      {list && <>
        <p className="cs-panel-note">Only you, as the organiser of this event, can see this list.</p>
        <ul className="cs-registration-counts" aria-label="Registration counts">
          {COUNTS.map(([key, label]) => (
            <li key={key}><span>{label}</span> <strong>{list.counts[key]}</strong></li>
          ))}
        </ul>
        {list.attendees.length === 0
          ? <p className="cs-panel-note">No one has registered yet.</p>
          : <div className="cs-registration-table-wrap">
            <table className="cs-registration-table" aria-label="Registered attendees">
              <thead>
                <tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Mobile number</th><th scope="col">Registered at</th></tr>
              </thead>
              <tbody>
                {list.attendees.map((attendee) => (
                  <tr key={attendee.id}>
                    <td>{attendee.name || "Name not available"}</td>
                    <td>{attendee.email || "Not available"}</td>
                    <td>{attendee.mobileNumber || "Not available"}</td>
                    <td>{formatRegisteredAt(attendee.registeredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </>}
    </section>
  );
}
