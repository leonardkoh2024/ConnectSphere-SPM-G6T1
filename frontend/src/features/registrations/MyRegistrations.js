// H4 / SCRUM-142 — the attendee's own registrations and where each one stands. The
// registration service decides the status shown (a cancelled event reads Cancelled) and
// which event fields an attendee may see; this screen lays them out.
//
// H5 / SCRUM-143 — places still to come are listed under Upcoming, where a Registered one
// can be withdrawn after a confirmation. A withdrawn place moves out of Upcoming at once.

import React, { useCallback, useEffect, useState } from "react";
import RecordLead from "../../components/RecordLead";
import { REGISTRATION_STATUS_LABELS, registrationStatusTone } from "../../domain/myRegistrations";
import { venueLabel } from "../../domain/openRegistration";
import EventDetails from "./components/EventDetails";
import WithdrawDialog, { FINAL_WITHDRAW_REFUSALS, WITHDRAW_FAILED } from "./components/WithdrawDialog";
import { eventDay, singaporeDateTime, timeWindow } from "./format";
import { loadMyRegistrations, withdrawFromEvent } from "./registrationsApi";

const CANCELLED = "CANCELLED";

// The Show filter: every registration, or one status at a time.
const SHOW = [["all", "All registrations"], ...Object.entries(REGISTRATION_STATUS_LABELS)];

// Search reads the event's name and its venues, whatever the case.
const matchesSearch = (entry, query) => {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return true;
  return [entry.name, ...(entry.venue_names || [])].some((text) => String(text || "").toLowerCase().includes(wanted));
};

// A cancelled event's bookings are released (D4), so "to be confirmed" would mislead.
const venueText = (entry) =>
  entry.status === CANCELLED && !entry.venue_names?.length ? "No venue — event cancelled" : venueLabel(entry.venue_names);

const statusPill = (status) => (
  <span className={`cs-pill cs-pill-${registrationStatusTone(status)}`}>{REGISTRATION_STATUS_LABELS[status] || status}</span>
);

export default function MyRegistrations({ onNotice, onBackChange }) {
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  // The registration being withdrawn from: { entry, busy, error, final }.
  const [withdrawing, setWithdrawing] = useState(null);
  // Filters, kept while an event's details are open so coming back finds the same list.
  const [show, setShow] = useState("all");
  const [search, setSearch] = useState("");

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

  const replaceEntry = (registrationId, changes) =>
    setRegistrations((current) => current.map((entry) => (entry.registration_id === registrationId ? { ...entry, ...changes } : entry)));

  const confirmWithdraw = async () => {
    if (!withdrawing || withdrawing.busy) return;
    const { entry } = withdrawing;
    setWithdrawing({ entry, busy: true, error: "" });
    try {
      const result = await withdrawFromEvent(entry.event_id);
      replaceEntry(entry.registration_id, { ...result.registration, registration_id: entry.registration_id });
      setWithdrawing(null);
      onNotice?.(`You have withdrawn from ${entry.name || "this event"}.`);
    } catch (failure) {
      const final = FINAL_WITHDRAW_REFUSALS.includes(failure.reason);
      if (final) replaceEntry(entry.registration_id, { can_withdraw: false });
      setWithdrawing({ entry, busy: false, error: failure.message || WITHDRAW_FAILED, final });
    }
  };

  if (loading) return <p className="cs-panel-note">Loading your registrations…</p>;
  if (error) return <p className="cs-error" role="alert">{error}</p>;
  if (!registrations.length) return <p className="cs-panel-note">You have not registered for any events yet.</p>;

  const askToWithdraw = (entry) => setWithdrawing({ entry, busy: false, error: "" });
  const withdrawButton = (entry) => entry.can_withdraw && (
    <button type="button" className="cs-btn cs-btn-ghost cs-record-btn cs-record-danger" onClick={() => askToWithdraw(entry)}>Withdraw</button>
  );
  const dialog = withdrawing && (
    <WithdrawDialog state={{ ...withdrawing, name: withdrawing.entry.name }} onKeep={() => setWithdrawing(null)} onConfirm={confirmWithdraw} />
  );

  // AC2 — the event as an attendee may see it, and their own place on it. H5 — with
  // Withdraw while the place can still be given up.
  const open = registrations.find((entry) => entry.registration_id === openId);
  if (open) {
    return (
      <>
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
          actions={withdrawButton(open) || null}
          backLabel="my registrations"
          onClose={onBackChange ? null : closeDetails}
        />
        {dialog}
      </>
    );
  }

  const row = (entry) => (
    <article className="cs-record cs-registration-record" key={entry.registration_id}>
      <div className="cs-record-title">
        <RecordLead date={entry.event_date} />
        <div>
          <h3>{entry.name || "Untitled event"}</h3>
          <p>{eventDay(entry.event_date)} · {timeWindow(entry)}</p>
        </div>
      </div>
      <p className="cs-record-ref">{venueText(entry)}</p>
      <div className="cs-record-status">{statusPill(entry.status)}</div>
      <div className="cs-record-actions">
        <button type="button" className="cs-btn cs-btn-ghost cs-record-btn" onClick={() => setOpenId(entry.registration_id)}>View details</button>
        {withdrawButton(entry)}
      </div>
    </article>
  );

  const filtering = show !== "all" || search.trim() !== "";
  const shown = registrations.filter((entry) => (show === "all" || entry.status === show) && matchesSearch(entry, search));

  // H5 AC1, AC5 — what the attendee is still going to, apart from everything else.
  const upcoming = shown.filter((entry) => entry.active);
  const others = shown.filter((entry) => !entry.active);

  return (
    <>
      <div className="cs-registration-filters">
        <label className="cs-field">
          <span className="cs-field-name">Show</span>
          <select value={show} onChange={(event) => setShow(event.target.value)}>
            {SHOW.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="cs-field">
          <span className="cs-field-name">Search</span>
          <input type="search" value={search} placeholder="Event or venue" onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>
      {filtering && !shown.length ? <p className="cs-panel-note">No registrations match these filters.</p> : (
        <>
          <section className="cs-registration-group" aria-labelledby="cs-registrations-upcoming">
            <h2 id="cs-registrations-upcoming">Upcoming</h2>
            {upcoming.length
              ? <div className="cs-record-list">{upcoming.map(row)}</div>
              : <p className="cs-panel-note">{filtering ? "No upcoming registrations match these filters." : "You have no upcoming registrations."}</p>}
          </section>
          {others.length > 0 && (
            <section className="cs-registration-group" aria-labelledby="cs-registrations-others">
              <h2 id="cs-registrations-others">Past, withdrawn and cancelled</h2>
              <div className="cs-record-list">{others.map(row)}</div>
            </section>
          )}
        </>
      )}
      {dialog}
    </>
  );
}
