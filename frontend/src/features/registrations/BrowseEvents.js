// H2 / SCRUM-140 — the attendee's list of events open for registration. What is
// open, and which fields an attendee may see, is decided by the registration
// service; this screen only lays the entries out.
//
// H3 / SCRUM-141 — each open event can be registered for from its row. Whether a
// place is free, the window still open and the attendee not already registered is
// decided by the service in one transaction; this screen shows its answer.
//
// H6 / SCRUM-144 — a full event offers Join waiting list instead, and an event the attendee
// is waiting for shows their place in the queue.

import React, { useCallback, useEffect, useState } from "react";
import RecordLead from "../../components/RecordLead";
import { placesLabel, venueLabel } from "../../domain/openRegistration";
import EventDetails from "./components/EventDetails";
import WithdrawDialog, { FINAL_WITHDRAW_REFUSALS, WITHDRAW_FAILED } from "./components/WithdrawDialog";
import { eventDay, singaporeDateTime, timeWindow } from "./format";
import { joinWaitlist, loadOpenEvents, registerForEvent, withdrawFromEvent } from "./registrationsApi";

const placesTone = (remaining) => (remaining <= 0 ? "danger" : remaining <= 10 ? "warning" : "positive");

const REGISTERED = "REGISTERED";
const WAITLISTED = "WAITLISTED";
const REGISTER_FAILED = "You could not be registered. Try again.";
const JOIN_FAILED = "You could not join the waiting list. Try again.";
// Refusals after which pressing Register again cannot succeed, so it is withdrawn.
const FINAL_REFUSALS = ["closed", "not_open_yet", "status", "not_enabled", "no_capacity", "not_found"];

const positionText = (position) => (position ? `Position ${position} on the waiting list` : null);

export default function BrowseEvents({ onNotice, onBackChange }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Per event: { busy, error, final } while or after registering from its row.
  const [rowState, setRowState] = useState({});
  // The event whose details are open, and what the registration reply said.
  const [details, setDetails] = useState(null);
  // H5 — withdrawing from the open event: { busy, error, final }.
  const [withdrawing, setWithdrawing] = useState(null);

  useEffect(() => {
    let mounted = true;
    loadOpenEvents()
      .then((rows) => { if (mounted) setEvents(rows); })
      .catch((failure) => { if (mounted) setError(failure.message || "Events open for registration could not be loaded."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  // Fetches the list again when it is known to be out of date; a failure keeps what is shown.
  const reload = () => loadOpenEvents().then(setEvents).catch(() => {});

  const closeDetails = useCallback(() => setDetails(null), []);

  // The shell's "Back to …" closes the details view, as it does on other screens.
  useEffect(() => {
    if (!onBackChange) return undefined;
    onBackChange(details ? closeDetails : null);
    return () => onBackChange(null);
  }, [details, onBackChange, closeDetails]);

  const updateEntry = (id, changes) =>
    setEvents((current) => current.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)));
  const updateRow = (id, changes) => setRowState((current) => ({ ...current, [id]: { ...current[id], ...changes } }));

  const register = async (entry) => {
    if (rowState[entry.id]?.busy) return;
    updateRow(entry.id, { busy: true, error: "" });
    try {
      const result = await registerForEvent(entry.id);
      const registered = { ...entry, ...result.event, registration_status: REGISTERED };
      updateEntry(entry.id, registered);
      updateRow(entry.id, { busy: false, error: "" });
      setDetails({ id: entry.id, registeredAt: result.registration?.registered_at || null, justRegistered: true });
      onNotice?.(`You are registered for ${entry.name || "this event"}.`);
    } catch (failure) {
      const reason = failure.reason || null;
      if (reason === "full") updateEntry(entry.id, { remaining_places: 0 });
      if (reason === "already_registered") updateEntry(entry.id, { registration_status: REGISTERED });
      if (reason === "waitlisted") updateEntry(entry.id, { registration_status: WAITLISTED });
      updateRow(entry.id, { busy: false, error: failure.message || REGISTER_FAILED, final: FINAL_REFUSALS.includes(reason) });
    }
  };

  // H6 AC1 — join the waiting list of a full event; the row shows Waitlisted and the position.
  const join = async (entry) => {
    if (rowState[entry.id]?.busy) return;
    updateRow(entry.id, { busy: true, error: "" });
    try {
      const result = await joinWaitlist(entry.id);
      const position = result.registration?.waitlist_position ?? null;
      updateEntry(entry.id, { registration_status: WAITLISTED, waitlist_position: position });
      updateRow(entry.id, { busy: false, error: "" });
      onNotice?.(`You are on the waiting list for ${entry.name || "this event"}${position ? `, at position ${position}` : ""}.`);
    } catch (failure) {
      const reason = failure.reason || null;
      if (reason === "already_registered") updateEntry(entry.id, { registration_status: REGISTERED });
      if (reason === "already_waitlisted") updateEntry(entry.id, { registration_status: WAITLISTED });
      updateRow(entry.id, { busy: false, error: failure.message || JOIN_FAILED, final: FINAL_REFUSALS.includes(reason) });
      // A place came free since the list was loaded: reload it so the row offers Register.
      if (reason === "places_available") reload();
    }
  };

  // H5 — withdrawing from an event registered for, from its details. Back on the list the
  // event offers Register again, with the place given back. H6 — leaving its waiting list
  // the same way frees no place, so the event stays Full and offers Join again.
  const confirmWithdraw = async () => {
    if (!withdrawing || withdrawing.busy || !details) return;
    const entry = events.find((item) => item.id === details.id);
    setWithdrawing({ busy: true, error: "" });
    try {
      const result = await withdrawFromEvent(entry.id);
      const wasWaiting = entry.registration_status === WAITLISTED;
      updateEntry(entry.id, {
        registration_status: null,
        waitlist_position: null,
        remaining_places: result.remaining_places ?? (wasWaiting ? entry.remaining_places : entry.remaining_places + 1)
      });
      setWithdrawing(null);
      setDetails(null);
      onNotice?.(wasWaiting
        ? `You have left the waiting list for ${entry.name || "this event"}.`
        : `You have withdrawn from ${entry.name || "this event"}.`);
    } catch (failure) {
      const final = FINAL_WITHDRAW_REFUSALS.includes(failure.reason);
      if (final) setDetails((current) => ({ ...current, cannotWithdraw: true }));
      setWithdrawing({ busy: false, error: failure.message || WITHDRAW_FAILED, final });
    }
  };

  if (loading) return <p className="cs-panel-note">Loading events…</p>;
  if (error) return <p className="cs-error" role="alert">{error}</p>;
  if (!events.length) return <p className="cs-panel-note">No events are open for registration right now.</p>;

  const open = details && events.find((entry) => entry.id === details.id);
  if (open) {
    // AC4 — the event registered for, with the confirmation when it has just happened.
    const closes = singaporeDateTime(open.registration_closes_at);
    const registeredOn = singaporeDateTime(details.registeredAt);
    const waiting = open.registration_status === WAITLISTED;
    const canWithdraw = (open.registration_status === REGISTERED || waiting) && !details.cannotWithdraw;
    return (
      <>
        <EventDetails
          entry={open}
          notice={details.justRegistered ? <p className="cs-success" role="status">You are registered for this event.</p> : null}
          facts={[
            ["Places", placesLabel(open.remaining_places)],
            closes && ["Registration closes", closes],
            ["Your registration", waiting ? "Waitlisted" : "Registered"],
            waiting && open.waitlist_position && ["Place on the waiting list", String(open.waitlist_position)],
            registeredOn && ["Registered on", registeredOn]
          ]}
          actions={canWithdraw ? (
            <button type="button" className="cs-btn cs-btn-ghost cs-record-btn cs-record-danger" onClick={() => setWithdrawing({ busy: false, error: "" })}>Withdraw</button>
          ) : null}
          backLabel="browse events"
          onClose={onBackChange ? null : closeDetails}
        />
        {withdrawing && <WithdrawDialog state={{ ...withdrawing, name: open.name, waitlisted: waiting }} onKeep={() => setWithdrawing(null)} onConfirm={confirmWithdraw} />}
      </>
    );
  }

  return (
    <div className="cs-record-list" aria-label="Events open for registration">
      {events.map((entry) => {
        const closes = singaporeDateTime(entry.registration_closes_at);
        const row = rowState[entry.id] || {};
        const registered = entry.registration_status === REGISTERED;
        const waiting = entry.registration_status === WAITLISTED;
        const full = entry.remaining_places <= 0;
        return (
          <article className="cs-record cs-browse-record" key={entry.id}>
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
            <div className="cs-record-actions cs-record-actions-stacked">
              {registered || waiting ? (
                <>
                  <span className={`cs-pill cs-pill-${registered ? "positive" : "warning"}`}>{registered ? "Registered" : "Waitlisted"}</span>
                  {waiting && entry.waitlist_position && <p className="cs-record-saved">{positionText(entry.waitlist_position)}</p>}
                  {waiting && entry.invitation_active && <p className="cs-record-saved">A place is offered to you. Accept it in My registrations.</p>}
                  <button type="button" className="cs-btn cs-btn-ghost cs-record-btn" onClick={() => setDetails({ id: entry.id, registeredAt: null, justRegistered: false })}>View details</button>
                </>
              ) : full ? (
                <>
                  {!row.error && <p className="cs-record-saved">This event is full.</p>}
                  {!row.final && (
                    <button type="button" className="cs-btn cs-btn-ghost cs-record-btn" disabled={row.busy} onClick={() => join(entry)}>
                      {row.busy ? "Joining…" : "Join waiting list"}
                    </button>
                  )}
                </>
              ) : !row.final && (
                <button type="button" className="cs-btn cs-btn-primary cs-record-btn" disabled={row.busy} onClick={() => register(entry)}>
                  {row.busy ? "Registering…" : "Register"}
                </button>
              )}
              {row.error && <p className="cs-error" role="alert">{row.error}</p>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
