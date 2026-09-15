// Lists the events belonging to the signed-in organiser, optionally filtered to a
// single status. Story A5 ("see only events I am related to") is enforced by the
// organiser_id filter here *and* by firestore.rules — the rule is the real boundary.

import React, { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";

export default function EventList({ user, status, onEdit }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const snapshot = await getDocs(query(collection(db, "events"), where("organiser_id", "==", user.uid)));
        const records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        if (mounted) setEvents(status ? records.filter((event) => event.status === status) : records);
      } catch (loadError) {
        console.error("Could not load events:", loadError);
        if (mounted) setError("We could not load your events. Please refresh and try again.");
      } finally { if (mounted) setLoading(false); }
    };
    load();
    return () => { mounted = false; };
  }, [status, user.uid]);

  if (loading) return <p className="cs-panel-note">Loading your events…</p>;
  if (error) return <p className="cs-error">{error}</p>;
  if (!events.length) return <p className="cs-panel-note">{status === "DRAFT" ? "You have no saved drafts." : "You have not submitted any events yet."}</p>;
  return <div className="cs-record-list">{events.map((event) => <article className="cs-record" key={event.id}><div><span className="cs-pill">{event.status}</span><h2>{event.name || "Untitled event"}</h2><p>{event.event_date || "Date not set"} · {event.start_time || "Time not set"}–{event.end_time || ""}</p></div><div className="cs-record-actions"><span className="cs-record-ref">{event.reference_no}</span>{onEdit && <button type="button" className="cs-link-btn" onClick={() => onEdit(event)}>Continue draft</button>}</div></article>)}</div>;
}
