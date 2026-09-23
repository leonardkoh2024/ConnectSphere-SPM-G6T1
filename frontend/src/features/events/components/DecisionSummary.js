import React, { useEffect, useMemo, useState } from "react";
import { chronologicalClarifications } from "../../../domain/eventReview";
import { reviewApi } from "../reviewApi";

const dateTime = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";

export default function DecisionSummary({ event, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setDetail(await reviewApi.detail(event.id)); }
    catch (loadError) { setError(loadError.message); }
  };
  useEffect(() => { load(); }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const exchange = useMemo(() => detail
    ? chronologicalClarifications(detail.clarifications, detail.responses)
    : [], [detail]);
  const open = detail?.clarifications.find((item) => item.id === detail.event.open_clarification_id);

  const respond = async (submitEvent) => {
    submitEvent.preventDefault();
    if (!answer.trim()) { setError("Response message is required."); return; }
    setBusy(true); setError("");
    try {
      await reviewApi.respond(event.id, open.id, answer);
      setAnswer("");
      await load();
      onChanged?.("Your clarification response was sent.");
    } catch (responseError) { setError(responseError.message); }
    finally { setBusy(false); }
  };

  if (!detail && !error) return <p className="cs-panel-note">Loading decision details…</p>;
  return <section className="cs-form-section cs-decision-summary" aria-label="Request decision">
    <h2>Review and decision</h2>
    {error && <p className="cs-error">{error}</p>}
    {detail && <>
      <dl className="cs-detail-grid">
        <div><dt>Assigned coordinator</dt><dd>{detail.coordinator?.name || "Assignment pending"}</dd></div>
        <div><dt>Decision</dt><dd>{detail.event.decision || detail.event.status}</dd></div>
        <div><dt>Decision time</dt><dd>{dateTime(detail.event.decided_at)}</dd></div>
        <div className="cs-detail-wide"><dt>Reason</dt><dd>{detail.event.decision_reason || "No decision reason recorded."}</dd></div>
      </dl>
      {exchange.length > 0 && <div className="cs-exchange"><h3>Clarification history</h3>{exchange.map((item) =>
        <article key={`${item.kind}-${item.id}`}><strong>{item.kind === "QUESTION" ? "Coordinator" : "Organiser"}</strong><time>{dateTime(item.created_at)}</time><p>{item.message}</p></article>
      )}</div>}
      {open && <form className="cs-inline-form" onSubmit={respond} noValidate>
        <label className="cs-field"><span className="cs-field-name">Your response<span className="cs-required" aria-hidden="true">*</span></span><textarea rows="3" required value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
        <button className="cs-btn cs-btn-primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Send response"}</button>
      </form>}
    </>}
  </section>;
}

