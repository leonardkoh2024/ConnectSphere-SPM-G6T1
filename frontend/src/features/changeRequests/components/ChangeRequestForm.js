// I1 / SCRUM-147 — raising a change request. The organiser picks one of their events
// (AC1), ticks the details that should change, gives each its new value next to the
// current one, and says why (AC2). What counts as a valid request lives in
// domain/changeRequests.js; this form only collects it.

import React, { useEffect, useState } from "react";
import {
  CHANGEABLE_FIELDS, changeRequestProblems, changeValueText
} from "../../../domain/changeRequests";
import { todayIso } from "../../../domain/eventRequest";
import ToggleList from "../../events/components/ToggleList";
import { loadCurrentValues, submitChangeRequest } from "../changeRequestsApi";

const Required = () => <span className="cs-required" aria-hidden="true">*</span>;

const eventOption = (event) => `${event.name || "Untitled event"}${event.reference_no ? ` (${event.reference_no})` : ""}`;

// The input for one proposed value, by the field's kind.
function NewValue({ definition, value, onChange }) {
  const label = `New ${definition.label.toLowerCase()}`;
  if (definition.kind === "list") {
    return <ToggleList label={label} options={definition.options} values={value || []} onChange={onChange} />;
  }
  let control;
  if (definition.kind === "multiline") control = <textarea rows="3" value={value} onChange={(e) => onChange(e.target.value)} />;
  else if (definition.kind === "select") {
    control = (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {definition.options.map((option) => <option key={option} value={option}>{definition.optionLabel(option)}</option>)}
      </select>
    );
  } else {
    const type = { number: "number", date: "date", time: "time" }[definition.kind] || "text";
    control = (
      <input
        type={type}
        value={value}
        {...(type === "number" ? { min: "1", step: "1" } : {})}
        {...(type === "date" ? { min: todayIso() } : {})}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return <label className="cs-field"><span className="cs-field-name">{label}</span>{control}</label>;
}

export default function ChangeRequestForm({ userId, events, initialEventId = null, onSubmitted, onCancel }) {
  const [eventId, setEventId] = useState(initialEventId && events.some((item) => item.id === initialEventId) ? initialEventId : "");
  const [current, setCurrent] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [fields, setFields] = useState([]);
  const [proposed, setProposed] = useState({});
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const event = events.find((item) => item.id === eventId) || null;

  // A different event starts the request afresh from that event's own values.
  useEffect(() => {
    setCurrent(null);
    setFields([]);
    setProposed({});
    setLoadError("");
    setTried(false);
    if (!event) return undefined;
    let mounted = true;
    loadCurrentValues(event)
      .then((values) => { if (mounted) setCurrent(values); })
      .catch(() => { if (mounted) setLoadError("This event's details could not be loaded. Try again."); });
    return () => { mounted = false; };
  }, [event]);

  // Ticking a detail starts its new value from the current one, so a list is edited
  // rather than rebuilt and a long text only needs the part that changes.
  const toggleField = (field, checked) => {
    setFields((list) => (checked ? [...list, field] : list.filter((item) => item !== field)));
    if (checked && current) setProposed((values) => ({ ...values, [field]: values[field] ?? current[field] }));
  };

  const problems = current ? changeRequestProblems({ current, proposed, fields, reason }) : [];

  const submit = async (formEvent) => {
    formEvent.preventDefault();
    if (!event || !current || busy) return;
    setTried(true);
    if (problems.length) return;
    setBusy(true);
    setError("");
    try {
      const saved = await submitChangeRequest({ userId, event, current, proposed, fields, reason });
      onSubmitted(saved);
    } catch (failure) {
      console.error("Could not submit the change request:", failure);
      setError("Your change request could not be sent. Try again.");
      setBusy(false);
    }
  };

  return (
    <form className="cs-event-form" noValidate onSubmit={submit} aria-label="New change request">
      <section className="cs-form-section">
        <h2>Event</h2>
        <label className="cs-field">
          <span className="cs-field-name">Event to change<Required /></span>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">Choose an event</option>
            {events.map((item) => <option key={item.id} value={item.id}>{eventOption(item)}</option>)}
          </select>
        </label>
        {loadError && <p className="cs-error" role="alert">{loadError}</p>}
        {event && !current && !loadError && <p className="cs-panel-note">Loading this event's details…</p>}
      </section>

      {current && (
        <>
          <section className="cs-form-section">
            <h2>What should change<span>Tick each detail, then give its new value.</span></h2>
            <fieldset className="cs-choice-group">
              <legend>Details to change<Required /></legend>
              <div className="cs-choice-list">
                {CHANGEABLE_FIELDS.map((definition) => (
                  <label key={definition.field} className="cs-check">
                    <input type="checkbox" checked={fields.includes(definition.field)} onChange={(e) => toggleField(definition.field, e.target.checked)} />
                    {definition.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {CHANGEABLE_FIELDS.filter((definition) => fields.includes(definition.field)).map((definition) => (
              <div key={definition.field} className="cs-change-field">
                <dl className="cs-detail-grid">
                  <div><dt>Current {definition.label.toLowerCase()}</dt><dd>{changeValueText(definition.field, current[definition.field])}</dd></div>
                </dl>
                <NewValue
                  definition={definition}
                  value={proposed[definition.field] ?? ""}
                  onChange={(value) => setProposed((values) => ({ ...values, [definition.field]: value }))}
                />
              </div>
            ))}
          </section>

          <section className="cs-form-section">
            <h2>Why</h2>
            <label className="cs-field cs-field-wide">
              <span className="cs-field-name">Reason for the change<Required /></span>
              <textarea rows="3" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            {!event.coordinator_id && (
              <p className="cs-panel-note">No coordinator is assigned to this event yet. The request waits as Pending and the coordinator sees it once the event is assigned.</p>
            )}
          </section>
        </>
      )}

      {tried && problems.length > 0 && (
        <div className="cs-error" role="alert">
          <p className="cs-error-lead">
            {problems.length === 1
              ? "One detail needs your attention before this request can be sent:"
              : `${problems.length} details need your attention before this request can be sent:`}
          </p>
          <ul className="cs-error-list">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        </div>
      )}
      {error && <p className="cs-error" role="alert">{error}</p>}

      <div className="cs-form-actions">
        <button type="button" className="cs-btn cs-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="cs-btn cs-btn-primary" disabled={busy || !current}>{busy ? "Sending…" : "Send change request"}</button>
      </div>
    </form>
  );
}
