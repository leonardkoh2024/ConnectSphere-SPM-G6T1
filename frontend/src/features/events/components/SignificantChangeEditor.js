import React, { useEffect, useMemo, useState } from "react";
import { ACCESSIBILITY_OPTIONS, FACILITIES, LAYOUTS, PREFERRED_LOCATIONS } from "../../../domain/events";
import {
  significantEventChanges,
  significantEventValues,
  validateSignificantEventValues
} from "../../../domain/significantEventChanges";
import { reviewApi } from "../reviewApi";
import ToggleList from "./ToggleList";

const toFormValues = (event) => {
  const values = significantEventValues(event);
  return {
    ...values,
    expected_attendance: String(values.expected_attendance),
    facilitiesRequired: values.facilities_required,
    accessibilityNeeded: values.accessibility_needed,
    facilities_required: values.facilities_required,
    accessibility_needed: values.accessibility_needed
  };
};

const toSaveValues = (form) => ({
  ...form,
  expected_attendance: Number(form.expected_attendance),
  facilities_required: form.facilitiesRequired,
  accessibility_needed: form.accessibilityNeeded
});

const arrangementSummary = (impact) => {
  const bookings = impact.venueBookings;
  const reservations = impact.equipmentReservations;
  return (
    <aside className="cs-attention" aria-label="Significant change impact">
      <strong>This change may affect existing arrangements:</strong>
      <p>Venue bookings ({bookings.length})</p>
      {bookings.length
        ? <ul>{bookings.map((item) => <li key={item.id}>{item.label} — {item.status}</li>)}</ul>
        : <p>None</p>}
      <p>Equipment reservations ({reservations.length})</p>
      {reservations.length
        ? <ul>{reservations.map((item) => <li key={item.id}>{item.label} — {item.status}</li>)}</ul>
        : <p>None</p>}
      <p>Attendee registrations: {impact.registrationsCount}</p>
    </aside>
  );
};

export default function SignificantChangeEditor({ event, onCancel, onSaved }) {
  const initialValues = useMemo(() => toFormValues(event), [event]);
  const [form, setForm] = useState(initialValues);
  const [impact, setImpact] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const changes = significantEventChanges(toSaveValues(initialValues), toSaveValues(form));
  const hasChanges = Object.keys(changes).length > 0;
  const validationError = validateSignificantEventValues(toSaveValues(form));

  useEffect(() => {
    let mounted = true;
    reviewApi.significantChangeImpact(event.id)
      .then((result) => { if (mounted) setImpact(result); })
      .catch((loadError) => { if (mounted) setError(loadError.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [event.id]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setAcknowledged(false);
    setError("");
  };

  const save = async () => {
    if (!hasChanges) return;
    if (validationError) { setError(validationError); return; }
    if (!acknowledged) { setError("Acknowledge the impact warning before saving."); return; }
    setBusy(true);
    setError("");
    try {
      await reviewApi.saveSignificantChange({
        eventId: event.id,
        before: event,
        values: toSaveValues(form),
        impact,
        acknowledged
      });
      await onSaved();
    } catch (saveError) {
      if (saveError.message.startsWith("The existing arrangements changed")) {
        try {
          setImpact(await reviewApi.significantChangeImpact(event.id));
          setAcknowledged(false);
          setError("The arrangements changed during editing. Review the updated warning and acknowledge it again.");
        } catch (impactError) {
          setError(impactError.message);
        }
      } else setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cs-form-section cs-action-box" aria-label="Edit significant event details">
      <h3>Edit significant event details</h3>
      {loading && <p className="cs-panel-note">Checking existing arrangements…</p>}
      {!loading && error && !impact && <p className="cs-error" role="alert">{error}</p>}
      {impact && <>
        <div className="cs-detail-grid">
          <label className="cs-field">
            <span className="cs-field-name">Expected attendance (pax)</span>
            <input type="number" min="1" step="1" value={form.expected_attendance}
              onChange={(e) => update("expected_attendance", e.target.value)} />
          </label>
          <label className="cs-field">
            <span className="cs-field-name">Event date</span>
            <input type="date" value={form.event_date} onChange={(e) => update("event_date", e.target.value)} />
          </label>
          <label className="cs-field">
            <span className="cs-field-name">Start time</span>
            <input type="time" value={form.start_time} onChange={(e) => update("start_time", e.target.value)} />
          </label>
          <label className="cs-field">
            <span className="cs-field-name">End time</span>
            <input type="time" value={form.end_time} onChange={(e) => update("end_time", e.target.value)} />
          </label>
          <label className="cs-field">
            <span className="cs-field-name">Preferred location</span>
            <select value={form.preferred_location} onChange={(e) => update("preferred_location", e.target.value)}>
              <option value="">No preference</option>
              {PREFERRED_LOCATIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="cs-field">
            <span className="cs-field-name">Required layout</span>
            <select value={form.required_layout} onChange={(e) => update("required_layout", e.target.value)}>
              <option value="">No preference</option>
              {LAYOUTS.map((item) => <option value={item} key={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
          </label>
        </div>
        <label className="cs-check">
          <input type="checkbox" checked={form.facilitiesRequired} onChange={(e) => {
            setForm((current) => ({ ...current, facilitiesRequired: e.target.checked, facilities_required: e.target.checked, facilities: e.target.checked ? current.facilities : [] }));
            setAcknowledged(false);
            setError("");
          }} />
          Venue facilities are required
        </label>
        {form.facilitiesRequired && <ToggleList
          label="Required facilities"
          options={FACILITIES}
          values={form.facilities}
          onChange={(value) => update("facilities", value)}
        />}
        <label className="cs-check">
          <input type="checkbox" checked={form.accessibilityNeeded} onChange={(e) => {
            setForm((current) => ({
              ...current,
              accessibilityNeeded: e.target.checked,
              accessibility_needed: e.target.checked,
              accessibility: e.target.checked ? current.accessibility : [],
              accessibility_notes: e.target.checked ? current.accessibility_notes : ""
            }));
            setAcknowledged(false);
            setError("");
          }} />
          Accessibility requirements apply
        </label>
        {form.accessibilityNeeded && <>
          <ToggleList
            label="Required accessibility features"
            options={ACCESSIBILITY_OPTIONS}
            values={form.accessibility}
            onChange={(value) => update("accessibility", value)}
          />
          <label className="cs-field">
            <span className="cs-field-name">Accessibility notes</span>
            <textarea rows="3" value={form.accessibility_notes}
              onChange={(e) => update("accessibility_notes", e.target.value)} />
          </label>
        </>}
        {hasChanges && arrangementSummary(impact)}
        {hasChanges && <label className="cs-check">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          I have reviewed and acknowledge the impact on these arrangements.
        </label>}
      </>}
      {error && impact && <p className="cs-error" role="alert">{error}</p>}
      {hasChanges && validationError && <p className="cs-error" role="alert">{validationError}</p>}
      <div className="cs-form-actions">
        <button type="button" className="cs-btn cs-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="cs-btn cs-btn-primary"
          disabled={loading || !impact || !hasChanges || Boolean(validationError) || !acknowledged || busy}
          onClick={save}>{busy ? "Saving…" : "Save significant changes"}</button>
      </div>
    </section>
  );
}
