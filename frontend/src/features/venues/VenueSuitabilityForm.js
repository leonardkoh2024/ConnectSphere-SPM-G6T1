import React, { useEffect, useState } from "react";
import { ACCESSIBILITY_OPTIONS, FACILITIES, LAYOUTS } from "../../domain/events";
import { assessVenueSuitability } from "../../domain/venueSearch";
import ToggleList from "../events/components/ToggleList";

const initialForm = (event) => ({
  eventName: event?.name || event?.reference_no || "",
  eventDate: event?.event_date || "",
  startTime: event?.start_time || "",
  endTime: event?.end_time || "",
  attendance: event?.expected_attendance == null ? "" : String(event.expected_attendance),
  venueId: "",
  facilities: [],
  accessibility: [],
  layout: ""
});

const words = (value) => value.replaceAll("_", " ");

// `shared` lets the venue catalogue hand in the layout, facilities and
// accessibility the filters already collect, so the combined card asks for each
// requirement once. Rendered on its own it keeps its own controls.
export default function VenueSuitabilityForm({ venues, event, embedded = false, shared = null }) {
  const [form, setForm] = useState(() => initialForm(event));
  const [assessment, setAssessment] = useState(null);

  useEffect(() => {
    setForm(initialForm(event));
    setAssessment(null);
  }, [event]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setAssessment(null);
  };

  const submit = (submitEvent) => {
    submitEvent.preventDefault();
    const venue = venues.find((item) => item.venue_id === form.venueId);
    if (!venue) return;
    const required = shared || form;
    setAssessment({
      venueName: venue.name,
      ...assessVenueSuitability({
        venue,
        event: {
          name: shared ? "" : form.eventName,
          event_date: form.eventDate,
          start_time: form.startTime,
          end_time: form.endTime,
          expected_attendance: Number(shared ? shared.attendance : form.attendance),
          facilities: required.facilities,
          accessibility: required.accessibility,
          layout: required.layout
        }
      })
    });
  };

  return (
    <section
      className={embedded ? "cs-suitability-check" : "cs-form-section"}
      aria-labelledby={embedded ? undefined : "venue-suitability-heading"}
      aria-label={embedded ? "Check venue suitability" : undefined}
    >
      {!embedded && <>
        <h2 id="venue-suitability-heading">Check venue suitability</h2>
        <p className="cs-panel-note">Enter the event requirements and choose a venue to see each criterion checked against its catalogue record.</p>
      </>}
      <form className="cs-form" onSubmit={submit}>
        <div className="cs-form-grid">
          {!shared && (
            <label className="cs-field">
              <span className="cs-field-name">Event name</span>
              <input value={form.eventName} required onChange={(e) => update("eventName", e.target.value)} />
            </label>
          )}
          <label className="cs-field">
            <span className="cs-field-name">Venue</span>
            <select value={form.venueId} required onChange={(e) => update("venueId", e.target.value)}>
              <option value="">Select a venue</option>
              {venues.map((venue) => <option key={venue.venue_id} value={venue.venue_id}>{venue.name}</option>)}
            </select>
          </label>
          <label className="cs-field">
            <span className="cs-field-name">Event date</span>
            <input type="date" value={form.eventDate} required onChange={(e) => update("eventDate", e.target.value)} />
          </label>
          {!shared && (
            <label className="cs-field">
              <span className="cs-field-name">Expected attendance</span>
              <input type="number" min="1" step="1" value={form.attendance} required onChange={(e) => update("attendance", e.target.value)} />
            </label>
          )}
          <label className="cs-field">
            <span className="cs-field-name">Start time</span>
            <input type="time" value={form.startTime} required onChange={(e) => update("startTime", e.target.value)} />
          </label>
          <label className="cs-field">
            <span className="cs-field-name">End time</span>
            <input type="time" value={form.endTime} required onChange={(e) => update("endTime", e.target.value)} />
          </label>
          {!shared && (
            <label className="cs-field">
              <span className="cs-field-name">Required room layout <span className="cs-optional">Optional</span></span>
              <select value={form.layout} onChange={(e) => update("layout", e.target.value)}>
                <option value="">No specific layout</option>
                {LAYOUTS.map((layout) => <option value={layout} key={layout}>{words(layout)}</option>)}
              </select>
            </label>
          )}
        </div>
        {!shared && <ToggleList label="Required facilities" options={FACILITIES} values={form.facilities} onChange={(value) => update("facilities", value)} />}
        {!shared && <ToggleList label="Required accessibility features" options={ACCESSIBILITY_OPTIONS} values={form.accessibility} onChange={(value) => update("accessibility", value)} />}
        <div className="cs-form-actions">
          <button className="cs-btn cs-btn-primary" type="submit">Check suitability</button>
        </div>
      </form>
      {assessment && (
        <section className={`cs-suitability-result ${assessment.suitable ? "cs-suitability-result-suitable" : "cs-suitability-result-unsuitable"}`} aria-live="polite" aria-label="Suitability assessment">
          <h3>{assessment.suitable ? "Suitable" : "Not suitable"} for {assessment.venueName}</h3>
          <h4>Criteria evaluated</h4>
          <ul className="cs-suitability-criteria">
            {assessment.criteria.map((criterion) => (
              <li className={criterion.passed ? "cs-suitability-pass" : "cs-suitability-fail"} key={criterion.key}>
                <strong>{criterion.passed ? "Pass" : "Fail"}: {criterion.label}</strong>
                <span>{criterion.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
