// A7 / SCRUM-170 — the Safety Officer's Operational Safety Check: the events
// awaiting it (AC2), the facts each review needs (AC3) and the outcome (AC4).
// What the Safety Officer may read and write is enforced by firestore.rules (AC6);
// this screen only shows what those rules hand it.

import React, { useEffect, useState } from "react";
import Icon from "../../app/Icon";
import { statusTone } from "../../domain/events";
import {
  NOT_RECORDED,
  SAFETY_OUTCOME,
  SAFETY_OUTCOME_LABEL,
  outcomeNeedsComment,
  shownOrNotRecorded,
  validateSafetyOutcome
} from "../../domain/safetyReview";
import { listSafetyQueue, recordSafetyOutcome, safetyReviewDetail } from "./safetyApi";

const shownTime = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : NOT_RECORDED;

// A titled block the tests and assistive technology can find by its heading.
const Section = ({ id, title, children }) => (
  <section className="cs-request-section" aria-labelledby={id}>
    <h3 id={id}>{title}</h3>
    {children}
  </section>
);

function BookingFacts({ booking }) {
  return (
    <article className="cs-record">
      <div className="cs-record-title"><div><h4>{booking.label}</h4><p>{booking.venue_name}</p></div></div>
      <p className="cs-record-ref">{shownTime(booking.start_datetime)}–{shownTime(booking.end_datetime)}</p>
      <div className="cs-record-status"><span className={`cs-pill cs-pill-${statusTone(booking.status)}`}>{booking.status}</span></div>
      {booking.exceeds && <p className="cs-attention cs-detail-wide">Exceeds venue capacity</p>}
      <dl className="cs-detail-grid cs-record-expanded">
        <div><dt>Expected attendance</dt><dd>{booking.attendance ?? NOT_RECORDED} of {booking.capacity ?? NOT_RECORDED}</dd></div>
        <div><dt>Layout</dt><dd>{shownOrNotRecorded(booking.layout)}</dd></div>
        <div className="cs-detail-wide"><dt>Emergency access</dt><dd>{shownOrNotRecorded(booking.emergency_access_notes)}</dd></div>
        <div className="cs-detail-wide"><dt>Known restrictions</dt><dd>{shownOrNotRecorded(booking.known_restrictions)}</dd></div>
      </dl>
    </article>
  );
}

function OutcomeForm({ eventId, onRecorded }) {
  const [outcome, setOutcome] = useState("");
  const [comment, setComment] = useState("");
  const [marked, setMarked] = useState({ venue: true, technical: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needsComment = outcomeNeedsComment(outcome);

  const submit = async (formEvent) => {
    formEvent.preventDefault();
    const invalid = validateSafetyOutcome({ outcome, comment });
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError("");
    try {
      await recordSafetyOutcome({
        eventId,
        outcome,
        comment,
        ...(outcome === SAFETY_OUTCOME.REQUEST_CHANGES ? {
          marked: Object.entries(marked).filter(([, on]) => on).map(([key]) => key)
        } : {})
      });
      onRecorded(outcome);
    } catch (failure) {
      setError(failure.message || "The outcome could not be recorded.");
      setBusy(false);
    }
  };

  return (
    <form className="cs-form-section cs-action-box" noValidate onSubmit={submit}>
      <fieldset className="cs-choice-group" disabled={busy}>
        <legend>Outcome<span className="cs-required" aria-hidden="true">*</span></legend>
        <div className="cs-choice-list">
          {Object.values(SAFETY_OUTCOME).map((value) => (
            <label key={value} className="cs-check">
              <input type="radio" name="safety-outcome" value={value} checked={outcome === value}
                onChange={() => { setOutcome(value); setError(""); }} />
              {SAFETY_OUTCOME_LABEL[value]}
            </label>
          ))}
        </div>
      </fieldset>
      {outcome === SAFETY_OUTCOME.REQUEST_CHANGES && (
        <fieldset className="cs-choice-group">
          <legend>Arrangements to review</legend>
          {["venue", "technical"].map((key) => (
            <label key={key} className="cs-check">
              <input type="checkbox" checked={marked[key]} onChange={() => setMarked((current) => ({ ...current, [key]: !current[key] }))} />
              {key === "venue" ? "Venue" : "Technical"}
            </label>
          ))}
        </fieldset>
      )}
      <label className="cs-field">
        <span className="cs-field-name">Comment{needsComment && <span className="cs-required" aria-hidden="true">*</span>}</span>
        <textarea rows="4" value={comment} required={needsComment} disabled={busy}
          aria-invalid={Boolean(error) && needsComment} aria-describedby={error ? "cs-safety-outcome-error" : undefined}
          onChange={(change) => { setComment(change.target.value); if (error) setError(""); }} />
      </label>
      {error && <p id="cs-safety-outcome-error" className="cs-error" role="alert">{error}</p>}
      <div className="cs-form-actions">
        <button type="submit" className="cs-btn cs-btn-primary" disabled={busy}>{busy ? "Recording…" : "Record outcome"}</button>
      </div>
    </form>
  );
}

export default function SafetyReviewScreen({ onNotice, onBackChange }) {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [review, setReview] = useState(null);
  const [opening, setOpening] = useState(false);

  const loadQueue = () => listSafetyQueue()
    .then((events) => { setQueue(events); setError(""); })
    .catch((failure) => setError(failure.message || "The safety review queue could not be loaded."))
    .finally(() => setLoading(false));

  useEffect(() => { loadQueue(); }, []);

  const closeReview = () => setReview(null);
  // Inside the workspace the back button lives in the page header, as on the
  // coordinator's review screen; standalone, the screen draws its own.
  useEffect(() => {
    if (!onBackChange) return undefined;
    onBackChange(review ? closeReview : null);
    return () => onBackChange(null);
  }, [review, onBackChange]);

  const open = async (eventId) => {
    setOpening(true); setError("");
    try { setReview(await safetyReviewDetail(eventId)); }
    catch (failure) { setError(failure.message || "The review could not be opened."); }
    finally { setOpening(false); }
  };

  const recorded = (outcome) => {
    onNotice?.(`Safety outcome recorded: ${SAFETY_OUTCOME_LABEL[outcome]}.`);
    setReview(null);
    setLoading(true);
    loadQueue();
  };

  if (loading) return <p className="cs-panel-note">Loading safety reviews…</p>;
  if (opening) return <p className="cs-panel-note">Opening safety review…</p>;

  if (review) {
    const { event, bookings, reservations, reviews } = review;
    return (
      <div className="cs-review-detail">
        {!onBackChange && <button type="button" className="cs-btn cs-btn-ghost cs-back" onClick={closeReview}><Icon name="chevron-left" />Back to safety reviews</button>}
        <div className="cs-review-heading">
          <div><h2>{event.name || "Untitled event"}</h2><p>{event.reference_no}</p></div>
          <span className={`cs-pill cs-pill-${statusTone(event.status)}`}>{event.status}</span>
        </div>
        <dl className="cs-detail-grid">
          <div><dt>Event date</dt><dd>{event.event_date || NOT_RECORDED}</dd></div>
          <div><dt>Time</dt><dd>{event.start_time}–{event.end_time}</dd></div>
          <div><dt>Expected attendance</dt><dd>{event.expected_attendance ?? NOT_RECORDED}</dd></div>
          <div><dt>Required layout</dt><dd>{shownOrNotRecorded(event.required_layout)}</dd></div>
        </dl>
        <Section id="safety-venue-bookings" title="Venue bookings">
          {bookings.length
            ? <div className="cs-record-list">{bookings.map((booking) => <BookingFacts key={booking.booking_id} booking={booking} />)}</div>
            : <p className="cs-panel-note">No active venue bookings.</p>}
        </Section>
        <Section id="safety-accessibility" title="Accessibility requirements">
          {event.accessibility.length
            ? <ul className="cs-tag-list">{event.accessibility.map((item) => <li key={item}>{item}</li>)}</ul>
            : <p className="cs-panel-note">No accessibility requirements stated.</p>}
          {event.accessibility_notes && <p>{event.accessibility_notes}</p>}
        </Section>
        <Section id="safety-equipment" title="Equipment">
          {event.equipment.length
            ? <ul className="cs-tag-list">{event.equipment.map((line, index) => <li key={index}>{line.equipment_type} × {line.quantity}{line.notes ? ` — ${line.notes}` : ""}</li>)}</ul>
            : <p className="cs-panel-note">No equipment requested.</p>}
          {reservations.length
            ? <ul className="cs-tag-list">{reservations.map((item) => <li key={item.reservation_id}>Reserved: {item.equipment_type} × {item.quantity}</li>)}</ul>
            : <p className="cs-panel-note">No equipment reserved.</p>}
        </Section>
        <Section id="safety-equipment-placement" title="Equipment placement">
          <p>{shownOrNotRecorded(event.equipment_placement)}</p>
        </Section>
        <Section id="safety-crowd-movement" title="Crowd movement">
          <p>{shownOrNotRecorded(event.crowd_movement)}</p>
        </Section>
        <Section id="safety-previous-checks" title="Previous safety checks">
          {reviews.length
            ? <ul className="cs-record-list">{reviews.map((item) => (
                <li key={item.review_id} className="cs-record">
                  <strong>{SAFETY_OUTCOME_LABEL[item.outcome] || item.outcome}</strong> · {shownTime(item.decided_at)}
                  {item.comment && <p>{item.comment}</p>}
                </li>
              ))}</ul>
            : <p className="cs-panel-note">No earlier safety checks.</p>}
        </Section>
        <Section id="safety-record-outcome" title="Record outcome">
          <OutcomeForm eventId={event.id} onRecorded={recorded} />
        </Section>
      </div>
    );
  }

  if (error && !queue.length) return <p className="cs-error" role="alert">{error}</p>;
  if (!queue.length) return <div className="cs-empty"><p>No events are awaiting a safety check.</p></div>;
  return (
    <>
      {error && <p className="cs-error" role="alert">{error}</p>}
      <div className="cs-record-list">{queue.map((event) => (
        <article className="cs-record cs-review-record" key={event.id}>
          <div className="cs-record-title"><div>
            <h2>{event.name || "Untitled event"}</h2>
            <p>{event.event_date || "Date not set"} · {event.start_time || "Time not set"}–{event.end_time || "Time not set"}</p>
          </div></div>
          <p className="cs-record-ref">{event.reference_no}</p>
          <div className="cs-record-modified">
            <p className="cs-record-saved">Venues: {event.venue_names?.length ? event.venue_names.join(", ") : "None booked"}</p>
            <p className="cs-record-saved">Expected attendance: {event.expected_attendance ?? NOT_RECORDED}</p>
          </div>
          <div className="cs-record-actions">
            <button type="button" className="cs-btn cs-btn-ghost cs-record-btn" onClick={() => open(event.id)}>Review safety</button>
          </div>
        </article>
      ))}</div>
    </>
  );
}
