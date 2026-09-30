import React, { useEffect, useMemo, useState } from "react";
import { statusTone } from "../../domain/events";
import { chronologicalClarifications } from "../../domain/eventReview";
import { reviewApi } from "./reviewApi";

const shownTime = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";

export default function EventReviewScreen({ queueOnly = false, onNotice, onFindVenues }) {
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [mode, setMode] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadList = async () => {
    const data = await reviewApi.list();
    setEvents(data.events || []);
    return data.events || [];
  };
  useEffect(() => { loadList().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => queueOnly
    ? events.filter((event) => ["SUBMITTED", "UNDER_REVIEW"].includes(event.status) && event.editable)
    : events, [events, queueOnly]);

  const loadDetail = async (eventId, open = true) => {
    setError(""); setBusy(true);
    try {
      let current = events.find((item) => item.id === eventId);
      if (open && current?.status === "SUBMITTED" && current.editable) {
        await reviewApi.openReview(eventId);
        await loadList();
      }
      const data = await reviewApi.detail(eventId);
      setSelected(eventId); setDetail(data); setMode(""); setMessage(""); setTarget("");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const act = async (action, success) => {
    if (!message.trim() && action !== "reassign") { setError(`${mode === "reject" ? "Rejection reason" : "Clarification message"} is required.`); return; }
    if (action === "reassign" && !target) { setError("Choose a new coordinator."); return; }
    setBusy(true); setError("");
    try {
      if (action === "clarify") await reviewApi.clarify(selected, message);
      if (action === "reject") await reviewApi.reject(selected, message);
      if (action === "reassign") await reviewApi.reassign(selected, target);
      await loadList(); await loadDetail(selected, false); onNotice?.(success); setMode(""); setMessage("");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <p className="cs-panel-note">Loading assigned events…</p>;
  if (detail) {
    const event = detail.event;
    const hasOpen = Boolean(event.open_clarification_id);
    const canDecide = event.editable && event.status === "UNDER_REVIEW" && !hasOpen;
    const canReassign = event.editable && !["COMPLETED", "CANCELLED", "REJECTED"].includes(event.status);
    const exchange = chronologicalClarifications(detail.clarifications, detail.responses);
    return <div className="cs-review-detail">
      <button type="button" className="cs-btn cs-btn-ghost cs-back" onClick={() => { setDetail(null); setSelected(null); }}>Back to events</button>
      {error && !mode && <p className="cs-error" role="alert">{error}</p>}
      {!event.editable && <p className="cs-panel-note">This event was reassigned. You can view the assignment record, but only the current coordinator can make changes.</p>}
      <div className="cs-review-heading"><div><h2>{event.name}</h2><p>{event.reference_no}</p></div><span className={`cs-pill cs-pill-${statusTone(event.status)}`}>{event.status}</span></div>
      <dl className="cs-detail-grid">
        <div><dt>Event date</dt><dd>{event.event_date}</dd></div><div><dt>Time</dt><dd>{event.start_time}–{event.end_time}</dd></div>
        <div><dt>Expected attendance</dt><dd>{event.expected_attendance}</dd></div><div><dt>Assigned coordinator</dt><dd>{detail.coordinator?.name}</dd></div>
        <div className="cs-detail-wide"><dt>Purpose</dt><dd>{event.purpose}</dd></div><div className="cs-detail-wide"><dt>Description</dt><dd>{event.description}</dd></div>
        {event.decision_reason && <div className="cs-detail-wide"><dt>Decision reason</dt><dd>{event.decision_reason} · {shownTime(event.decided_at)}</dd></div>}
      </dl>
      {exchange.length > 0 && <section className="cs-exchange"><h3>Clarification history</h3>{exchange.map((item) => <article key={`${item.kind}-${item.id}`}><strong>{item.kind === "QUESTION" ? "Coordinator" : "Organiser"}</strong><time>{shownTime(item.created_at)}</time><p>{item.message}</p></article>)}</section>}
      {hasOpen && <p className="cs-attention">Awaiting the organiser. Clarify and Reject are unavailable until they respond.</p>}
      {(canDecide || canReassign || typeof onFindVenues === "function") && <div className="cs-review-actions">
        {typeof onFindVenues === "function" && <button className="cs-btn cs-btn-secondary" type="button" onClick={() => onFindVenues(event)}>Find venues</button>}
        {canDecide && <><button className="cs-btn cs-btn-secondary" type="button" onClick={() => { setMode("clarify"); setMessage(""); setError(""); }}>Request clarification</button><button className="cs-btn cs-btn-ghost cs-record-danger" type="button" onClick={() => { setMode("reject"); setMessage(""); setError(""); }}>Reject request</button></>}
        {canReassign && <button className="cs-btn cs-btn-secondary" type="button" onClick={() => { setMode("reassign"); setError(""); }}>Reassign event</button>}
      </div>}
      {mode && <section className="cs-form-section cs-action-box">
        <h3>{mode === "clarify" ? "Request clarification" : mode === "reject" ? "Reject request" : "Reassign event"}</h3>
        {mode === "reassign" ? <label className="cs-field"><span className="cs-field-name">New active coordinator</span><select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose a coordinator</option>{detail.coordinators.filter((item) => item.id !== event.coordinator_id).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          : <label className="cs-field"><span className="cs-field-name">{mode === "reject" ? "Reason" : "Message"}<span className="cs-required" aria-hidden="true">*</span></span><textarea rows="4" required value={message} aria-invalid={Boolean(error)} aria-describedby={error ? "cs-review-action-error" : undefined} onChange={(e) => { setMessage(e.target.value); if (error) setError(""); }} /></label>}
        {error && <p id="cs-review-action-error" className="cs-error" role="alert">{error}</p>}
        <div className="cs-form-actions"><button type="button" className="cs-btn cs-btn-ghost" onClick={() => { setMode(""); setError(""); }}>Cancel</button><button type="button" className={mode === "reject" ? "cs-btn cs-btn-ghost cs-record-danger" : "cs-btn cs-btn-primary"} disabled={busy} onClick={() => act(mode, mode === "clarify" ? "Clarification request sent." : mode === "reject" ? "Event request rejected." : "Event reassigned.")}>{busy ? "Saving…" : mode === "clarify" ? "Send request" : mode === "reject" ? "Reject event" : "Reassign"}</button></div>
      </section>}
    </div>;
  }

  if (!visible.length) return <div className="cs-empty"><p>{error || (queueOnly ? "No requests are waiting for review." : "No events are assigned to you.")}</p></div>;
  return <>{error && <p className="cs-error">{error}</p>}<div className="cs-record-list">{visible.map((event) => <article className="cs-record cs-review-record" key={event.id}><div className="cs-record-title"><h2>{event.name || "Untitled event"}</h2><p>{event.event_date || "Date not set"}</p></div><p className="cs-record-ref">{event.reference_no}</p><div className="cs-record-status"><span className={`cs-pill cs-pill-${statusTone(event.status)}`}>{event.status}</span></div><div className="cs-record-modified"><p className="cs-record-saved">{event.editable ? "Current assignment" : "Previous assignment · read only"}</p></div><div className="cs-record-actions"><button className="cs-btn cs-btn-ghost cs-record-btn" type="button" disabled={busy} onClick={() => loadDetail(event.id)}>View request</button></div></article>)}</div></>;
}
