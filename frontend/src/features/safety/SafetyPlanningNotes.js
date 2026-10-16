// A7 / SCRUM-170 AC3 — equipment placement and crowd movement, recorded by the
// event's coordinator while it is Approved or in Planning, for the Safety
// Officer to read during the safety check. Read only for anyone else, or once
// the event has moved on. Shown on the coordinator's event view.

import React, { useState } from "react";
import { cleanPlanningNotes, planningNotesOpen, shownOrNotRecorded } from "../../domain/safetyReview";
import { savePlanningNotes } from "./safetyApi";

const FIELDS = [
  ["equipment_placement", "Equipment placement"],
  ["crowd_movement", "Crowd movement"]
];

export default function SafetyPlanningNotes({ event, onSaved }) {
  const editable = Boolean(event.editable) && planningNotesOpen(event.status);
  const [values, setValues] = useState(() => cleanPlanningNotes(event));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setError("");
    try {
      await savePlanningNotes({ eventId: event.id, values });
      await onSaved?.();
    } catch (failure) {
      setError(failure.message || "The safety planning notes could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cs-request-section" aria-labelledby={`safety-notes-${event.id}`}>
      <h3 id={`safety-notes-${event.id}`}>Safety planning notes</h3>
      {editable ? <>
        <p className="cs-panel-note">The Safety Officer reads these during the event's safety check.</p>
        {FIELDS.map(([field, label]) => (
          <label className="cs-field" key={field}>
            <span className="cs-field-name">{label}</span>
            <textarea rows="3" value={values[field]} disabled={busy}
              onChange={(change) => { setValues((current) => ({ ...current, [field]: change.target.value })); if (error) setError(""); }} />
          </label>
        ))}
        {error && <p className="cs-error" role="alert">{error}</p>}
        <div className="cs-form-actions">
          <button type="button" className="cs-btn cs-btn-secondary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save safety notes"}</button>
        </div>
      </> : (
        <dl className="cs-detail-grid">
          {FIELDS.map(([field, label]) => (
            <div className="cs-detail-wide" key={field}><dt>{label}</dt><dd>{shownOrNotRecorded(event[field])}</dd></div>
          ))}
        </dl>
      )}
    </section>
  );
}
