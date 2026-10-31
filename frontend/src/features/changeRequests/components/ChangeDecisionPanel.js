// I2 / SCRUM-148 — one request being weighed: the current and proposed values side by
// side (AC1), what each change would touch (AC1), and the decision (AC2). Accept and
// Decline do their work in changeDecisionApi; this only collects the reason and reports.

import React, { useState } from "react";
import {
  affectedArrangements, canApplyChange, changeValueText, changeableField, declineReasonProblem
} from "../../../domain/changeRequests";

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function ChangeDecisionPanel({ request, review, busy, error, onAccept, onDecline, onClose }) {
  const [reason, setReason] = useState("");
  const [declineProblem, setDeclineProblem] = useState("");
  const { event, current, impact } = review;
  const fields = Object.keys(request.changes || {});
  const sections = affectedArrangements(fields, impact);
  const applicable = canApplyChange(event.status);

  const decline = () => {
    const problem = declineReasonProblem(reason);
    setDeclineProblem(problem || "");
    if (!problem) onDecline(reason.trim());
  };

  return (
    <section className="cs-form-section cs-action-box" aria-label={`Decide change request for ${request.event_name}`}>
      <h3>Current and proposed values</h3>
      <table className="cs-compare">
        <thead><tr><th scope="col">Detail</th><th scope="col">Current</th><th scope="col">Proposed</th></tr></thead>
        <tbody>
          {fields.map((field) => {
            const change = request.changes[field];
            const moved = !sameValue(current[field], change.old_value);
            return (
              <tr key={field}>
                <th scope="row">{changeableField(field)?.label || field}</th>
                <td>
                  {changeValueText(field, current[field])}
                  {moved && <span className="cs-compare-drift">Changed since the request was made (was {changeValueText(field, change.old_value)}).</span>}
                </td>
                <td className="cs-compare-new">{changeValueText(field, change.new_value)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <dl className="cs-detail-grid">
        <div className="cs-detail-wide"><dt>Organiser's reason</dt><dd>{request.reason}</dd></div>
      </dl>

      <h3>Arrangements affected</h3>
      {sections.length === 0
        ? <p className="cs-panel-note">These details change the event record only. No venue booking, equipment reservation or registration is affected.</p>
        : (
          <ul className="cs-affected" aria-label="Arrangements affected">
            {sections.map((section) => (
              <li key={section.key}>
                <h4>{section.title}</h4>
                <p className="cs-field-hint">Reached by: {section.fields.join(", ")}</p>
                {section.items.length ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{section.none}</p>}
              </li>
            ))}
          </ul>
        )}
      {sections.length > 0 && applicable && (
        <p className="cs-panel-note">Accepting re-requests the affected venue bookings and equipment, tells their staff, and returns a Confirmed event to Planning. Nothing is cancelled.</p>
      )}
      {!applicable && (
        <p className="cs-panel-note">This event is {String(event.status).replaceAll("_", " ").toLowerCase()}. A change can be accepted once it is Approved, Planning or Confirmed; it can be declined now.</p>
      )}

      <label className="cs-field cs-field-wide">
        <span className="cs-field-name">Reason (required to decline)</span>
        <textarea rows="3" value={reason} onChange={(e) => { setReason(e.target.value); setDeclineProblem(""); }} />
      </label>
      {declineProblem && <p className="cs-error" role="alert">{declineProblem}</p>}
      {error && <p className="cs-error" role="alert">{error}</p>}
      <div className="cs-review-actions">
        <button type="button" className="cs-btn cs-btn-primary" disabled={busy || !applicable} onClick={() => onAccept(reason.trim())}>Accept change</button>
        <button type="button" className="cs-btn cs-btn-secondary" disabled={busy} onClick={decline}>Decline change</button>
        <button type="button" className="cs-btn cs-btn-ghost" disabled={busy} onClick={onClose}>Close</button>
      </div>
    </section>
  );
}
