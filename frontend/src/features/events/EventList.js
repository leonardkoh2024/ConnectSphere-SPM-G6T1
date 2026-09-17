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
import deleteEventRequest from "./deleteEventRequest";

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

const VIEWABLE = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "PLANNING", "CONFIRMED", "COMPLETED", "REJECTED"];

export default function EventList({ user, role, onEdit, onView, onCreate, onDeleted }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // B8 AC2 — deletion takes an explicit confirmation, so one click arms it and a
  // second carries it out. Only one draft can be armed at a time.
  const [confirmingId, setConfirmingId] = useState("");
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

  const remove = async (event) => {
    setDeletingId(event.id);
    try {
      await deleteEventRequest(event.id);
      setEvents((current) => current.filter((item) => item.id !== event.id));
      setConfirmingId("");
      if (onDeleted) onDeleted(`Draft ${event.reference_no || ""} deleted.`.replace("  ", " "));
    } catch (deleteError) {
      console.error("Could not delete draft:", deleteError);
      setError("We could not delete that draft. Please try again.");
    } finally {
      setDeletingId("");
    }
  };

  const createButton = onCreate
    ? <button type="button" className="cs-btn cs-btn-primary" onClick={onCreate}>Create new event request</button>
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
    {role === ROLES.ORGANISER && createButton && <div className="cs-list-actions">{createButton}</div>}
    <div className="cs-record-list">{events.map((event) => {
      const status = String(event.status || "").toUpperCase();
      const isDraft = status === "DRAFT";
      const saved = savedAt(event.updated_at);
      const confirming = confirmingId === event.id;
      return <article className="cs-record" key={event.id}>
        <div className="cs-record-title">
          <h2>{event.name || "Untitled event"}</h2>
          <p>{event.event_date || "Date not set"} · {whenText(event)}</p>
        </div>
        <p className="cs-record-ref">{event.reference_no}</p>
        <div className="cs-record-status">
          <span className="cs-pill">{event.status}</span>
        </div>
        <div className="cs-record-modified">
          {saved
            ? <p className="cs-record-saved">{isDraft ? "Last saved" : "Last updated"} {saved}</p>
            : <p className="cs-record-saved">Not saved yet</p>}
        </div>
        <div className="cs-record-actions">
          {isDraft && onEdit && <button type="button" className="cs-btn cs-btn-ghost cs-record-btn" onClick={() => onEdit(event)}>Edit</button>}
          {!isDraft && VIEWABLE.includes(status) && onView && <button type="button" className="cs-btn cs-btn-ghost cs-record-btn" onClick={() => onView(event)}>View details</button>}
          {isDraft && !confirming && <button type="button" className="cs-btn cs-btn-ghost cs-record-btn cs-record-danger" onClick={() => setConfirmingId(event.id)}>Delete</button>}
          {isDraft && confirming && <>
            <span className="cs-record-confirm">Delete this draft?</span>
            <button type="button" className="cs-btn cs-btn-ghost cs-record-btn cs-record-danger" disabled={deletingId === event.id} onClick={() => remove(event)}>
              {deletingId === event.id ? "Deleting…" : "Yes, delete"}
            </button>
            <button type="button" className="cs-btn cs-btn-ghost cs-record-btn" onClick={() => setConfirmingId("")}>Keep</button>
          </>}
        </div>
      </article>;
    })}</div>
  </>;
}
