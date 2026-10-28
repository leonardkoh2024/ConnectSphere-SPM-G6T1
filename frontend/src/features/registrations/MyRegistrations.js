// H4 / SCRUM-142 — the attendee's own registrations and where each one stands. The
// registration service decides the status shown (a cancelled event reads Cancelled) and
// which event fields an attendee may see; this screen lays them out.
//
// H5 / SCRUM-143 — places still to come are listed under Upcoming, where a Registered one
// can be withdrawn after a confirmation. A withdrawn place moves out of Upcoming at once.
//
// H7 / SCRUM-145 — a place offered from the waiting list is accepted or declined here, while the
// offer stands; a lapsed offer is shown, with the attendee still on the list.

import React, { useCallback, useEffect, useState } from "react";
import RecordLead from "../../components/RecordLead";
import { REGISTRATION_STATUS_LABELS, registrationStatusTone } from "../../domain/myRegistrations";
import { venueLabel } from "../../domain/openRegistration";
import EventDetails from "./components/EventDetails";
import WithdrawDialog, { FINAL_WITHDRAW_REFUSALS, WITHDRAW_FAILED } from "./components/WithdrawDialog";
import { eventDay, singaporeDateTime, timeWindow } from "./format";
import { acceptInvitation, declineInvitation, loadMyRegistrations, withdrawFromEvent } from "./registrationsApi";

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
  // H7 — accepting an offered place, per registration: { busy, error }.
  const [accepting, setAccepting] = useState({});
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
    const { entry, declining } = withdrawing;
    setWithdrawing({ entry, declining, busy: true, error: "" });
    try {
      const result = await (declining ? declineInvitation : withdrawFromEvent)(entry.event_id);
      replaceEntry(entry.registration_id, { ...result.registration, registration_id: entry.registration_id });
      setWithdrawing(null);
      onNotice?.(declining
        ? `You have declined the place at ${entry.name || "this event"} and left the waiting list.`
        : entry.status === "WAITLISTED"
          ? `You have left the waiting list for ${entry.name || "this event"}.`
          : `You have withdrawn from ${entry.name || "this event"}.`);
    } catch (failure) {
      const final = FINAL_WITHDRAW_REFUSALS.includes(failure.reason);
      if (final) replaceEntry(entry.registration_id, { can_withdraw: false });
      setWithdrawing({ entry, declining, busy: false, error: failure.message || WITHDRAW_FAILED, final });
    }
  };

  // H7 AC2 — accept an offered place: the attendee is registered only when they ask.
  const accept = async (entry) => {
    if (accepting[entry.registration_id]?.busy) return;
    setAccepting((current) => ({ ...current, [entry.registration_id]: { busy: true, error: "" } }));
    try {
      const result = await acceptInvitation(entry.event_id);
      replaceEntry(entry.registration_id, { ...result.registration, registration_id: entry.registration_id });
      setAccepting((current) => ({ ...current, [entry.registration_id]: { busy: false, error: "" } }));
      onNotice?.(`You are registered for ${entry.name || "this event"}.`);
    } catch (failure) {
      // AC3, AC4 — an offer that ran out leaves them on the list, now without it.
      if (failure.reason === "invitation_expired") replaceEntry(entry.registration_id, { invitation_active: false, invitation_lapsed: true, can_accept: false });
      if (failure.reason === "not_invited") replaceEntry(entry.registration_id, { invitation_active: false, can_accept: false });
      setAccepting((current) => ({ ...current, [entry.registration_id]: { busy: false, error: failure.message || "The place could not be accepted. Try again." } }));
    }
  };

  if (loading) return <p className="cs-panel-note">Loading your registrations…</p>;
  if (error) return <p className="cs-error" role="alert">{error}</p>;
  if (!registrations.length) return <p className="cs-panel-note">You have not registered for any events yet.</p>;

  const askToWithdraw = (entry) => setWithdrawing({ entry, busy: false, error: "" });
  // H7 — while a place is offered, the choice is to accept or decline it, not to withdraw.
  const withdrawButton = (entry) => {
    if (entry.can_accept) {
      const busy = accepting[entry.registration_id]?.busy;
      return (
        <>
          <button type="button" className="cs-btn cs-btn-primary cs-record-btn" disabled={busy} onClick={() => accept(entry)}>{busy ? "Accepting…" : "Accept place"}</button>
          <button type="button" className="cs-btn cs-btn-ghost cs-record-btn cs-record-danger" onClick={() => setWithdrawing({ entry, declining: true, busy: false, error: "" })}>Decline</button>
        </>
      );
    }
    return entry.can_withdraw && (
      <button type="button" className="cs-btn cs-btn-ghost cs-record-btn cs-record-danger" onClick={() => askToWithdraw(entry)}>Withdraw</button>
    );
  };
  const offerNote = (entry) => {
    if (entry.invitation_active && entry.invitation_expires_at) return <p className="cs-record-saved">Place offered until {singaporeDateTime(entry.invitation_expires_at)}</p>;
    if (entry.invitation_lapsed && entry.status === "WAITLISTED") return <p className="cs-record-saved">Your invitation expired. You keep your place on the waiting list.</p>;
    return null;
  };
  const dialog = withdrawing && (
    <WithdrawDialog state={{ ...withdrawing, name: withdrawing.entry.name, waitlisted: withdrawing.entry.status === "WAITLISTED" }} onKeep={() => setWithdrawing(null)} onConfirm={confirmWithdraw} />
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
            open.status === "WITHDRAWN" && singaporeDateTime(open.withdrawn_at) && ["Withdrawn on", singaporeDateTime(open.withdrawn_at)],
          open.invitation_active && singaporeDateTime(open.invitation_expires_at) && ["Place offered until", singaporeDateTime(open.invitation_expires_at)]
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
      <div className="cs-record-status">
        {statusPill(entry.status)}
        {entry.status === "WAITLISTED" && entry.waitlist_position && <p className="cs-record-saved">Position {entry.waitlist_position} on the waiting list</p>}
        {offerNote(entry)}
        {accepting[entry.registration_id]?.error && <p className="cs-error" role="alert">{accepting[entry.registration_id].error}</p>}
      </div>
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
              ? <div className="cs-record-list cs-attendee-list">{upcoming.map(row)}</div>
              : <p className="cs-panel-note">{filtering ? "No upcoming registrations match these filters." : "You have no upcoming registrations."}</p>}
          </section>
          {others.length > 0 && (
            <section className="cs-registration-group" aria-labelledby="cs-registrations-others">
              <h2 id="cs-registrations-others">Past, withdrawn and cancelled</h2>
              <div className="cs-record-list cs-attendee-list">{others.map(row)}</div>
            </section>
          )}
        </>
      )}
      {dialog}
    </>
  );
}
