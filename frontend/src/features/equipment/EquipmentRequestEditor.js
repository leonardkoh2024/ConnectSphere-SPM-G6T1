import React, { useEffect, useState } from "react";
import { EQUIPMENT_TYPES } from "../../domain/events";
import { onSiteSupportProblem, validateEquipmentRequestLines } from "../../domain/equipmentRequests";
import Icon from "../../app/Icon";
import { loadCoordinatorEquipmentEditor, submitEquipmentRequest } from "./equipmentApi";

const blankLine = () => ({ equipment_type: "", quantity: "1", technical_requirements: "" });

export default function EquipmentRequestEditor({ eventId, onCancel, onSubmitted }) {
  const [event, setEvent] = useState(null);
  const [request, setRequest] = useState(null);
  const [lines, setLines] = useState([]);
  // J5 / SCRUM-154 — on-site support is asked for on the request itself.
  const [onSiteSupport, setOnSiteSupport] = useState(false);
  const [onSiteSupportDetails, setOnSiteSupportDetails] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    loadCoordinatorEquipmentEditor(eventId)
      .then((result) => {
        if (!mounted) return;
        setEvent(result.event);
        setRequest(result.request);
        setOnSiteSupport(Boolean(result.request?.on_site_support));
        setOnSiteSupportDetails(String(result.request?.on_site_support_details || ""));
        setLines(result.lines.length ? result.lines : [blankLine()]);
      })
      .catch((loadError) => { if (mounted) setError(loadError.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [eventId]);

  const updateLine = (index, field, value) => {
    setLines((current) => current.map((line, lineIndex) =>
      lineIndex === index ? { ...line, [field]: value } : line
    ));
    setError("");
  };

  const submit = async () => {
    const validationError = validateEquipmentRequestLines(lines) || onSiteSupportProblem(onSiteSupport, onSiteSupportDetails);
    if (validationError) { setError(validationError); return; }
    setBusy(true);
    setError("");
    try {
      const result = await submitEquipmentRequest({
        eventId,
        lines,
        onSiteSupport,
        onSiteSupportDetails: onSiteSupport ? onSiteSupportDetails : ""
      });
      await onSubmitted({ notified: result?.notified !== false });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="cs-panel-note">Loading equipment request…</p>;
  if (error && !event) return <>
    <p className="cs-error" role="alert">{error}</p>
    <button type="button" className="cs-btn cs-btn-ghost" onClick={onCancel}>Back to equipment requests</button>
  </>;

  return (
    <section className="cs-form-section cs-action-box" aria-label="Equipment request editor">
      <h2>{event.name || "Untitled event"}</h2>
      <p className="cs-panel-note">{event.reference_no} · {event.event_date || "Date not set"} · {event.start_time || "Time not set"}–{event.end_time || "Time not set"}</p>
      {request && <p className="cs-attention">Current request status: Pending. Submitting updates will keep the request in the Technical Support queue.</p>}
      {!request && <p className="cs-panel-note">Organiser-provided equipment lines are prefilled where available. Review and amend them before submission.</p>}
      {lines.map((line, index) => (
        <div className="cs-equipment-line" key={`equipment-line-${index}`}>
          <div className="cs-form-grid">
            <label className="cs-field">
              <span className="cs-field-name">Equipment type</span>
              <select aria-label={`Equipment type ${index + 1}`} value={line.equipment_type}
                onChange={(e) => updateLine(index, "equipment_type", e.target.value)}>
                <option value="">Choose equipment type</option>
                {EQUIPMENT_TYPES.map((type) => <option value={type} key={type}>{type.replaceAll("_", " ")}</option>)}
              </select>
            </label>
            <label className="cs-field">
              <span className="cs-field-name">Quantity</span>
              <input aria-label={`Quantity ${index + 1}`} type="number" min="1" step="1"
                value={line.quantity} onChange={(e) => updateLine(index, "quantity", e.target.value)} />
            </label>
            <label className="cs-field cs-field-wide">
              <span className="cs-field-name">Technical requirements</span>
              <textarea aria-label={`Technical requirements ${index + 1}`} rows="2"
                value={line.technical_requirements}
                onChange={(e) => updateLine(index, "technical_requirements", e.target.value)} />
            </label>
          </div>
          <button type="button" className="cs-btn cs-btn-ghost" disabled={busy}
            onClick={() => { setLines((current) => current.filter((_, lineIndex) => lineIndex !== index)); setError(""); }}>
            Remove line
          </button>
        </div>
      ))}
      <button type="button" className="cs-btn cs-btn-secondary" disabled={busy}
        onClick={() => setLines((current) => [...current, blankLine()])}>
        <Icon name="plus" />Add equipment line
      </button>
      <label className="cs-check">
        <input type="checkbox" checked={onSiteSupport}
          onChange={(e) => { setOnSiteSupport(e.target.checked); setError(""); }} />
        On-site support needed
      </label>
      {onSiteSupport && <div className="cs-form-grid">
        <label className="cs-field cs-field-wide">
          <span className="cs-field-name">On-site support details</span>
          <textarea aria-label="On-site support details" rows="2" value={onSiteSupportDetails}
            onChange={(e) => { setOnSiteSupportDetails(e.target.value); setError(""); }} />
        </label>
      </div>}
      {error && <p className="cs-error" role="alert">{error}</p>}
      <div className="cs-form-actions">
        <button type="button" className="cs-btn cs-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="cs-btn cs-btn-primary" disabled={busy || loading}
          onClick={submit}>{busy ? "Submitting…" : request ? "Submit amended request" : "Submit equipment request"}</button>
      </div>
    </section>
  );
}
