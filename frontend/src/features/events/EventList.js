// The organiser's single list of their own events, drafts included. Story A5
// ("see only events I am related to") is enforced by the organiser_id filter
// here *and* by firestore.rules — the rule is the real boundary.
//
// There is deliberately no separate drafts screen. B6 puts drafts in "the
// Organiser's own list, labelled Draft", and B7 asks only that they stay
// distinguishable *by status* — which the status pill does.

import React, { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";

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

export default function EventList({ user, onEdit }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const snapshot = await getDocs(query(collection(db, "events"), where("organiser_id", "==", user.uid)));
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
  }, [user.uid]);

  if (loading) return <p className="cs-panel-note">Loading your events…</p>;
  if (error) return <p className="cs-error">{error}</p>;
  if (!events.length) return <p className="cs-panel-note">You have not created any events yet. Start one from New event request.</p>;

  return <div className="cs-record-list">{events.map((event) => {
    const isDraft = event.status === "DRAFT";
    const saved = savedAt(event.updated_at);
    return <article className="cs-record" key={event.id}>
      <div>
        <span className="cs-pill">{event.status}</span>
        <h2>{event.name || "Untitled event"}</h2>
        <p>{event.event_date || "Date not set"} · {whenText(event)}</p>
        {isDraft && saved && <p className="cs-record-saved">Last saved {saved}</p>}
      </div>
      <div className="cs-record-actions">
        <span className="cs-record-ref">{event.reference_no}</span>
        {isDraft && onEdit && <button type="button" className="cs-btn cs-btn-ghost cs-record-btn" onClick={() => onEdit(event)}>Continue editing</button>}
      </div>
    </article>;
  })}</div>;
}
