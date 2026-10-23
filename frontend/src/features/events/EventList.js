// A list of the events the signed-in user is related to, drafts included. Story A5
// ("see only events I am related to") is enforced by the per-role scope filter
// here *and* by firestore.rules — the rule is the real boundary.
//
// For an organiser this is where they land and where a new request starts, so the
// screen carries the Create action rather than the sidebar.
//
// There is deliberately no separate drafts screen. B6 puts drafts in "the
// Organiser's own list, labelled Draft", and B7 asks only that they stay
// distinguishable *by status* — which the status pill does.

import React, { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { ROLES, eventScopeField } from "../../domain/roles";
import { statusTone } from "../../domain/events";
import deleteEventRequest from "./deleteEventRequest";
import RecordLead from "../../components/RecordLead";
import Icon from "../../app/Icon";

// Firestore hands back a Timestamp; a document written moments ago can still
// have null here while the server value is pending.
const savedAt = (value) => {
  const date = value?.toDate?.();
  if (!date) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

// A draft can be saved with no times at all, so neither half is guaranteed and
// the en dash only earns its place when there is something on both sides.
const whenText = (event) => {
  const from = event.start_time || "";
  const to = event.end_time || "";
  if (from && to) return `${from}–${to}`;
  return from || to || "Time not set";
};

const sortKey = (event) => event.updated_at?.toMillis?.() ?? event.created_at?.toMillis?.() ?? 0;

const VIEWABLE = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "PLANNING", "CONFIRMED", "COMPLETED", "CANCELLED", "REJECTED"];

export default function EventList({ user, role, onEdit, onView, onCreate, onDeleted, headerHosted = false }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // B8 AC2 — deletion takes an explicit confirmation, which is asked for in a modal
  // rather than inside the card: the card's four columns stay put, and a
  // destructive question gets the reader's whole attention instead of competing
  // with the rest of the list. Holding the event itself (not just its id) lets the
  // dialog name what is about to go.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState("");
  const scopeField = eventScopeField(role);

  useEffect(() => {
    let mounted = true;
    // No scope field means this role does not reach events through the event
    // document at all, so there is no query to run.
    if (!scopeField) {
      setEvents([]);
      setLoading(false);
      return undefined;
    }
    const load = async () => {
      try {
        const snapshot = await getDocs(query(collection(db, "events"), where(scopeField, "==", user.uid)));
        const records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        records.sort((a, b) => sortKey(b) - sortKey(a));
        if (mounted) setEvents(records);
      } catch (loadError) {
        console.error("Could not load events:", loadError);
        if (mounted) setError("We could not load your events. Please refresh and try again.");
      } finally { if (mounted) setLoading(false); }
    };
    load();
    return () => { mounted = false; };
  }, [user.uid, scopeField]);

  // Escape closes the dialog, the same as Keep. It is not wired while a delete is
  // in flight, so the dialog cannot be dismissed out from under a request.
  useEffect(() => {
    if (!pendingDelete || deletingId) return undefined;
    const onKeyDown = (keyEvent) => { if (keyEvent.key === "Escape") setPendingDelete(null); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingDelete, deletingId]);

  const remove = async (event) => {
    setDeletingId(event.id);
    try {
      await deleteEventRequest(event.id);
      setEvents((current) => current.filter((item) => item.id !== event.id));
      setPendingDelete(null);
      if (onDeleted) onDeleted(`Draft ${event.reference_no || ""} deleted.`.replace("  ", " "));
    } catch (deleteError) {
      console.error("Could not delete draft:", deleteError);
      // Close the dialog so the message is read against the list it refers to,
      // rather than leaving the organiser holding a dialog that failed.
      setPendingDelete(null);
      setError("We could not delete that draft. Please try again.");
    } finally {
      setDeletingId("");
    }
  };

  const createButton = onCreate
    ? <button type="button" className="cs-btn cs-btn-primary" onClick={onCreate}><Icon name="plus" />Create new event request</button>
    : null;

  if (!scopeField) return <p className="cs-panel-note">Your role reaches events through your own registrations rather than this list.</p>;
  if (loading) return <p className="cs-panel-note">Loading your events…</p>;

  if (!events.length) {
    return <div className="cs-empty">
      {error && <p className="cs-error">{error}</p>}
      <p>{role === ROLES.ORGANISER ? "You don’t have any events yet." : "No events are related to your account yet."}</p>
      {role === ROLES.ORGANISER && createButton}
    </div>;
  }

  return <>
    {error && <p className="cs-error">{error}</p>}
    {!headerHosted && role === ROLES.ORGANISER && createButton && <div className="cs-list-actions">{createButton}</div>}
    <div className="cs-record-list">{events.map((event) => {
      const status = String(event.status || "").toUpperCase();
      const isDraft = status === "DRAFT";
      const saved = savedAt(event.updated_at);
      return <article className="cs-record" key={event.id}>
        <div className="cs-record-title">
          <RecordLead date={event.event_date} />
          <div>
            <h2>{event.name || "Untitled event"}</h2>
            <p>{event.event_date || "Date not set"} · {whenText(event)}</p>
          </div>
        </div>
        <p className="cs-record-ref">{event.reference_no}</p>
        <div className="cs-record-status">
          <span className={`cs-pill cs-pill-${statusTone(status)}`}>{event.status}</span>
        </div>
        <div className="cs-record-modified">
          {saved
            ? <p className="cs-record-saved">{isDraft ? "Last saved" : "Last updated"} {saved}</p>
            : <p className="cs-record-saved">Not saved yet</p>}
        </div>
        <div className="cs-record-actions">
          {isDraft && onEdit && <button type="button" className="cs-btn cs-btn-ghost cs-record-btn" onClick={() => onEdit(event)}>Edit</button>}
          {!isDraft && VIEWABLE.includes(status) && onView && <button type="button" className="cs-btn cs-btn-ghost cs-record-btn" onClick={() => onView(event)}>View details</button>}
          {isDraft && <button type="button" className="cs-btn cs-btn-ghost cs-record-btn cs-record-danger" onClick={() => setPendingDelete(event)}>Delete</button>}
        </div>
      </article>;
    })}</div>
    {pendingDelete && <div className="cs-modal-backdrop" onMouseDown={(clickEvent) => { if (clickEvent.target === clickEvent.currentTarget && !deletingId) setPendingDelete(null); }}>
      <div className="cs-modal" role="dialog" aria-modal="true" aria-labelledby="cs-delete-draft-title">
        <h2 id="cs-delete-draft-title">Delete this draft?</h2>
        <p>
          <strong>{pendingDelete.name || "Untitled event"}</strong>
          {pendingDelete.reference_no ? ` (${pendingDelete.reference_no})` : ""} will be deleted along with
          everything saved with it. This cannot be undone.
        </p>
        <div className="cs-modal-actions">
          {/* The safe choice takes focus, so Enter on an unread dialog keeps the draft. */}
          <button type="button" autoFocus className="cs-btn cs-btn-ghost" disabled={Boolean(deletingId)} onClick={() => setPendingDelete(null)}>Keep draft</button>
          <button type="button" className="cs-btn cs-btn-ghost cs-record-danger" disabled={Boolean(deletingId)} onClick={() => remove(pendingDelete)}>
            {deletingId ? "Deleting…" : "Yes, delete"}
          </button>
        </div>
      </div>
    </div>}
  </>;
}
