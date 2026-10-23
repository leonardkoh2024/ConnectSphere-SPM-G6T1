// H1 / SCRUM-139 — the Registration tab on the organiser's event page: where an organiser sets
// the registration capacity and the open/close date and time once their event is approved.
//
// The form is always shown for an event that uses registration, so the organiser can see where
// they stand. Where setup is not possible (not approved yet, or the window has closed) it is
// read-only with the reason in words and no Save button. The venue limit (AC3) and the number
// already registered (AC5) are stated beside the capacity field before the organiser types,
// set as its max and min, and read out as its description. Errors appear on their own field and
// in an alert above Save; typed values survive a refused save.
//
// The rules are the domain's (registrationWindow.mjs) — the same ones the service enforces — so
// a mistake is caught on the field before a request goes out, and the service still has the last
// word if something changed since the page loaded.

import React, { useEffect, useRef, useState } from "react";
import { validateRegistrationSettings } from "../../domain/registrationWindow";
import { registrationApi } from "./registrationApi";

const EMPTY_FORM = {
  registrationCapacity: "",
  registrationOpenDate: "",
  registrationOpenTime: "",
  registrationCloseDate: "",
  registrationCloseTime: ""
};

const PHASES = {
  NOT_SET: { label: "Not set up", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  OPEN: { label: "Open", tone: "positive" },
  CLOSED: { label: "Closed", tone: "neutral" }
};

const NO_VENUE_HINT = "Capacity can be set once a venue booking has been approved.";

const FieldName = ({ children }) => (
  <span className="cs-field-name">{children}<span className="cs-required" aria-hidden="true">*</span></span>
);

export default function RegistrationPanel({ eventId, event = {}, onNotice, now = () => new Date() }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [summary, setSummary] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const fields = useRef({});

  useEffect(() => {
    let mounted = true;
    setState(null); setLoadError("");
    registrationApi.load(eventId)
      .then((loaded) => { if (mounted) { setState(loaded); setForm({ ...EMPTY_FORM, ...loaded.settings }); } })
      .catch((error) => { if (mounted) setLoadError(error.message); });
    return () => { mounted = false; };
  }, [eventId]);

  if (loadError) return <p className="cs-error" role="alert">{loadError}</p>;
  if (!state) return <p className="cs-panel-note">Loading registration settings…</p>;

  const { venueCapacity, registeredCount, phase, editable, refusal } = state;
  const hasVenue = venueCapacity !== null && venueCapacity !== undefined;
  const pill = PHASES[phase] || PHASES.NOT_SET;
  const capacityLocked = !editable || !hasVenue;

  const change = (field) => (changeEvent) => {
    setForm((current) => ({ ...current, [field]: changeEvent.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined, ...(field === "registrationCapacity" ? {} : { registrationWindow: undefined }) }));
  };

  // The first problem, in reading order, gets the focus.
  const focusFirst = (problems) => {
    const order = ["registrationCapacity", "registrationWindow", "registrationCloseDate"];
    const first = order.find((key) => problems[key]);
    const target = first === "registrationWindow"
      ? ["registrationOpenDate", "registrationOpenTime", "registrationCloseDate", "registrationCloseTime"].find((key) => !String(form[key] || "").trim())
      : first;
    fields.current[target]?.focus();
  };

  const submit = async (submitEvent) => {
    submitEvent.preventDefault();
    if (saving || !editable) return;
    setSummary("");
    const checked = validateRegistrationSettings(form, {
      event: { ...event, registration_capacity: state.settings.registrationCapacity },
      ceiling: hasVenue ? venueCapacity : null,
      registeredCount,
      now: now()
    });
    if (!checked.ok) { setErrors(checked.errors); focusFirst(checked.errors); return; }

    setErrors({}); setSaving(true);
    try {
      const saved = await registrationApi.save(eventId, form);
      setState(saved); setForm({ ...EMPTY_FORM, ...saved.settings });
      onNotice?.("Registration settings saved.");
    } catch (saveError) {
      setSummary(saveError.message);
      if (saveError.fields) { setErrors(saveError.fields); focusFirst(saveError.fields); }
    } finally { setSaving(false); }
  };

  const id = (name) => `registration-${eventId}-${name}`;
  const describedBy = (name, hints) => [...hints, errors[name] ? id(`${name}-error`) : null].filter(Boolean).join(" ") || undefined;
  const fieldError = (name) => errors[name] && <span className="cs-field-error" id={id(`${name}-error`)}>{errors[name]}</span>;

  const capacityHints = [
    hasVenue ? id("venue-hint") : null,
    registeredCount > 0 ? id("registered-hint") : null,
    !hasVenue && editable ? id("no-venue-hint") : null
  ].filter(Boolean);

  const windowField = (name, label, type) => (
    <div className="cs-field">
      <label htmlFor={id(name)}><FieldName>{label}</FieldName></label>
      <input
        id={id(name)}
        ref={(node) => { fields.current[name] = node; }}
        type={type}
        value={form[name]}
        disabled={!editable}
        aria-invalid={errors[name] ? "true" : undefined}
        aria-describedby={describedBy(name, [])}
        onChange={change(name)}
      />
      {fieldError(name)}
    </div>
  );

  return (
    <form className="cs-registration" onSubmit={submit} noValidate>
      <div className="cs-registration-head">
        <h2>Registration</h2>
        <span className={`cs-pill cs-pill-${pill.tone}`} data-testid="registration-phase">{pill.label}</span>
      </div>

      {!editable && refusal && <p className="cs-panel-note">{refusal.message}</p>}

      <div className="cs-field">
        <label htmlFor={id("registrationCapacity")}><FieldName>Registration capacity</FieldName></label>
        <input
          id={id("registrationCapacity")}
          ref={(node) => { fields.current.registrationCapacity = node; }}
          type="number"
          step="1"
          min={Math.max(1, registeredCount)}
          max={hasVenue ? venueCapacity : undefined}
          value={form.registrationCapacity}
          disabled={capacityLocked}
          aria-invalid={errors.registrationCapacity ? "true" : undefined}
          aria-describedby={describedBy("registrationCapacity", capacityHints)}
          onChange={change("registrationCapacity")}
        />
        {hasVenue && <span className="cs-field-hint" id={id("venue-hint")}>Venue capacity: {venueCapacity}</span>}
        {registeredCount > 0 && <span className="cs-field-hint" id={id("registered-hint")}>Currently registered: {registeredCount}</span>}
        {!hasVenue && editable && <span className="cs-field-hint" id={id("no-venue-hint")}>{NO_VENUE_HINT}</span>}
        {fieldError("registrationCapacity")}
      </div>

      <fieldset className="cs-registration-window">
        <legend>Registration window</legend>
        <p className="cs-field-hint">All times are Singapore time (SGT).</p>
        <div className="cs-form-grid">
          {windowField("registrationOpenDate", "Registration open date", "date")}
          {windowField("registrationOpenTime", "Registration open time", "time")}
          {windowField("registrationCloseDate", "Registration close date", "date")}
          {windowField("registrationCloseTime", "Registration close time", "time")}
        </div>
        {errors.registrationWindow && <span className="cs-field-error" id={id("window-error")}>{errors.registrationWindow}</span>}
      </fieldset>

      {summary && <p className="cs-error" role="alert">{summary}</p>}
      {editable && (
        <button className="cs-btn cs-btn-primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save registration settings"}
        </button>
      )}
    </form>
  );
}
