// D1 / SCRUM-111 and D2 / SCRUM-112 — the coordinator's one Edit event form.
//
// Ordinary details (D1) save freely: they disturb no booking or reservation.
// Date, size and venue details (D2) are significant: as soon as one changes, the
// form checks the existing arrangements, names every one that may be affected,
// and will not save until the coordinator acknowledges that warning. Both kinds
// go in one save, recorded on the Activity tab, with no limit on edits (D1 AC4).

import React, { useEffect, useMemo, useState } from "react";
import { ACCESSIBILITY_OPTIONS, FACILITIES, LAYOUTS, PREFERRED_LOCATIONS } from "../../../domain/events";
import {
  ORDINARY_FIELDS,
  ordinaryEventChanges,
  ordinaryEventValues,
  validateOrdinaryEventValues
} from "../../../domain/ordinaryEventChanges";
import {
  significantEventChanges,
  significantEventValues,
  validateSignificantEventValues
} from "../../../domain/significantEventChanges";
import { reviewApi } from "../reviewApi";
import ToggleList from "./ToggleList";

const toFormValues = (event, organiser) => {
  const significant = significantEventValues(event);
  return {
    ...ordinaryEventValues(event, organiser),
    ...significant,
    expected_attendance: String(significant.expected_attendance)
  };
};

const significantOf = (form) => ({ ...form, expected_attendance: Number(form.expected_attendance) });

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

export default function EventDetailsEditor({ event, organiser, significantLocked = false, onCancel, onSaved }) {
  const initialValues = useMemo(() => toFormValues(event, organiser), [event, organiser]);
  const [form, setForm] = useState(initialValues);
  const [impact, setImpact] = useState(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const ordinaryChanges = ordinaryEventChanges(initialValues, form);
  const significantChanges = significantEventChanges(event, significantOf(form));
  const hasOrdinary = ordinaryChanges.length > 0;
  const hasSignificant = Object.keys(significantChanges).length > 0;
  const validationError = (hasOrdinary && validateOrdinaryEventValues(form))
    || (hasSignificant && validateSignificantEventValues(significantOf(form))) || "";
  const needsAcknowledgement = hasSignificant && !acknowledged;

  // The arrangements are looked up only once a significant field has changed, so
  // opening the form to fix a typo never waits on bookings and reservations.
  useEffect(() => {
    if (!hasSignificant || impact || impactLoading) return undefined;
    let mounted = true;
    setImpactLoading(true);
    reviewApi.significantChangeImpact(event.id)
      .then((result) => { if (mounted) setImpact(result); })
      .catch((loadError) => { if (mounted) setError(loadError.message); })
      .finally(() => { if (mounted) setImpactLoading(false); });
    return () => { mounted = false; };
  }, [hasSignificant, event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (changes, significant = false) => {
    setForm((current) => ({ ...current, ...changes }));
    if (significant) setAcknowledged(false);
    setError("");
  };
  const update = (field, value) => set({ [field]: value });
  const updateSignificant = (field, value) => set({ [field]: value }, true);

  const save = async () => {
    if ((!hasOrdinary && !hasSignificant) || validationError || needsAcknowledgement) return;
    setBusy(true);
    setError("");
    try {
      await reviewApi.saveEventEdit({
        eventId: event.id,
        before: event,
        values: { ...form, expected_attendance: Number(form.expected_attendance) },
        organiser,
        impact: hasSignificant ? impact : null,
        acknowledged: hasSignificant && acknowledged
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
    <section className="cs-form-section cs-action-box" aria-label="Edit event">
      <h3>Edit event</h3>

      <section className="cs-request-section" aria-label="Event details">
        <h4>Event details</h4>
        <p className="cs-panel-note">These do not affect any venue booking or equipment reservation.</p>
        <div className="cs-detail-grid">
          {ORDINARY_FIELDS.map(({ field, label, required, maxLength, multiline, type }) => (
            <label className={multiline ? "cs-field cs-detail-wide" : "cs-field"} key={field}>
              <span className="cs-field-name">{label}{required && <span className="cs-required" aria-hidden="true">*</span>}</span>
              {multiline
                ? <textarea rows="3" maxLength={maxLength} required={required} value={form[field]} onChange={(e) => update(field, e.target.value)} />
                : <input type={type || "text"} maxLength={maxLength} required={required} value={form[field]} onChange={(e) => update(field, e.target.value)} />}
            </label>
          ))}
        </div>
      </section>

      <section className="cs-request-section" aria-label="Date, size and venue">
        <h4>Date, size and venue</h4>
        <p className="cs-panel-note">
          {significantLocked
            ? "Unavailable while a clarification is open."
            : "Changing these may affect existing arrangements. You will be shown which before saving."}
        </p>
        <fieldset className="cs-plain-fieldset" disabled={significantLocked}>
          <legend className="cs-visually-hidden">Date, size and venue</legend>
          <div className="cs-detail-grid">
            <label className="cs-field">
              <span className="cs-field-name">Expected attendance (pax)</span>
              <input type="number" min="1" step="1" value={form.expected_attendance}
                onChange={(e) => updateSignificant("expected_attendance", e.target.value)} />
            </label>
            <label className="cs-field">
              <span className="cs-field-name">Event date</span>
              <input type="date" value={form.event_date} onChange={(e) => updateSignificant("event_date", e.target.value)} />
            </label>
            <label className="cs-field">
              <span className="cs-field-name">Start time</span>
              <input type="time" value={form.start_time} onChange={(e) => updateSignificant("start_time", e.target.value)} />
            </label>
            <label className="cs-field">
              <span className="cs-field-name">End time</span>
              <input type="time" value={form.end_time} onChange={(e) => updateSignificant("end_time", e.target.value)} />
            </label>
            <label className="cs-field">
              <span className="cs-field-name">Preferred location</span>
              <select value={form.preferred_location} onChange={(e) => updateSignificant("preferred_location", e.target.value)}>
                <option value="">No preference</option>
                {PREFERRED_LOCATIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="cs-field">
              <span className="cs-field-name">Required layout</span>
              <select value={form.required_layout} onChange={(e) => updateSignificant("required_layout", e.target.value)}>
                <option value="">No preference</option>
                {LAYOUTS.map((item) => <option value={item} key={item}>{item.replaceAll("_", " ")}</option>)}
              </select>
            </label>
          </div>
          <label className="cs-check">
            <input type="checkbox" checked={form.facilities_required} onChange={(e) => set({
              facilities_required: e.target.checked,
              facilities: e.target.checked ? form.facilities : []
            }, true)} />
            Venue facilities are required
          </label>
          {form.facilities_required && <ToggleList
            label="Required facilities"
            options={FACILITIES}
            values={form.facilities}
            onChange={(value) => updateSignificant("facilities", value)}
          />}
          <label className="cs-check">
            <input type="checkbox" checked={form.accessibility_needed} onChange={(e) => set({
              accessibility_needed: e.target.checked,
              accessibility: e.target.checked ? form.accessibility : [],
              accessibility_notes: e.target.checked ? form.accessibility_notes : ""
            }, true)} />
            Accessibility requirements apply
          </label>
          {form.accessibility_needed && <>
            <ToggleList
              label="Required accessibility features"
              options={ACCESSIBILITY_OPTIONS}
              values={form.accessibility}
              onChange={(value) => updateSignificant("accessibility", value)}
            />
            <label className="cs-field">
              <span className="cs-field-name">Accessibility notes</span>
              <textarea rows="3" value={form.accessibility_notes}
                onChange={(e) => updateSignificant("accessibility_notes", e.target.value)} />
            </label>
          </>}
        </fieldset>
      </section>

      {hasSignificant && impactLoading && <p className="cs-panel-note">Checking existing arrangements…</p>}
      {hasSignificant && impact && <>
        {arrangementSummary(impact)}
        <label className="cs-check">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          I have reviewed and acknowledge the impact on these arrangements.
        </label>
      </>}
      {validationError && <p className="cs-error" role="alert">{validationError}</p>}
      {error && <p className="cs-error" role="alert">{error}</p>}
      <div className="cs-form-actions">
        <button type="button" className="cs-btn cs-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="cs-btn cs-btn-primary"
          disabled={(!hasOrdinary && !hasSignificant) || Boolean(validationError) || needsAcknowledgement
            || (hasSignificant && !impact) || busy}
          onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </section>
  );
}
