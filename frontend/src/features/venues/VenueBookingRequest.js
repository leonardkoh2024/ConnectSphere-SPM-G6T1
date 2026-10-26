import React, { useMemo, useState } from "react";
import {
  CRITERION_LABEL,
  acknowledgementRecord,
  assessVenue,
  bookingRequirements,
  canSubmitBooking,
  groupedRequirementLines,
  isBlocked,
  submissionBlockReason
} from "../../domain/venueSuitability";
import { bookingDetailsDefaults, bookingDetailsErrors } from "../../domain/venueBookingDetails";
import { LAYOUTS } from "../../domain/events";
import { requestVenueBooking } from "./venuesApi";

const word = (value) => String(value || "").replaceAll("_", " ");
const itemList = (items = []) => items.map(word).join(", ");

export function BookingAcknowledgementNotice({ acknowledgement }) {
  if (!acknowledgement?.acknowledged) return null;
  return (
    <div className="cs-acknowledgement-notice" role="note">
      <p className="cs-acknowledgement-title">Requested despite known shortfalls</p>
      <ul>
        {acknowledgement.criteria.map((criterion) => (
          <li key={criterion}>
            {CRITERION_LABEL[criterion]}: {itemList(acknowledgement.missing?.[criterion])}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function VenueBookingRequest({ venue, event, user, onSubmitted, existingBooking = null }) {
  const [acknowledged, setAcknowledged] = useState([]);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [saving, setSaving] = useState(false);
  // F12 — this booking's own label, attendance and layout. The venue is judged
  // on these, so a breakout room is not refused for the whole event's pax.
  const [details, setDetails] = useState(() => bookingDetailsDefaults(event, venue));
  const setDetail = (field) => (changeEvent) => setDetails((current) => ({ ...current, [field]: changeEvent.target.value }));

  // An event document stores its title as `name`; `event_name` is what a booking
  // carries. Accept either so the gate works on a real event and a booking alike.
  const eventName = event.event_name || event.name || "Untitled event";
  const detailErrors = useMemo(() => bookingDetailsErrors(details, event), [details, event]);
  const detailsValid = Object.keys(detailErrors).length === 0;
  const requirements = useMemo(() => bookingRequirements(event, {
    expected_attendance: detailErrors.expected_attendance ? event.expected_attendance : details.expected_attendance,
    layout: details.layout
  }), [event, details, detailErrors]);
  const assessment = useMemo(() => assessVenue(venue, requirements), [venue, requirements]);

  const blocked = isBlocked(assessment);
  const duplicate = Boolean(existingBooking) && !sent;
  const ready = detailsValid && canSubmitBooking({ assessment, acknowledged });
  const blockReason = submissionBlockReason({ assessment, acknowledged });
  const layoutOptions = [...new Set([...(details.layout ? [details.layout] : []), ...LAYOUTS])];

  const toggle = (criterion) => setAcknowledged((current) =>
    current.includes(criterion)
      ? current.filter((item) => item !== criterion)
      : [...current, criterion]);

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await requestVenueBooking({
        user,
        venue_id: venue.venue_id,
        event_id: event.event_id,
        event_name: eventName,
        event_date: event.event_date,
        start_time: event.start_time,
        end_time: event.end_time,
        booking_label: details.label.trim(),
        expected_attendance: Number(details.expected_attendance),
        required_layout: details.layout,
        required_facilities: requirements.facilities,
        acknowledgement: acknowledgementRecord({
          assessment,
          acknowledged,
          userId: user?.uid,
          at: new Date().toISOString()
        }),
        replacement_for_booking_id: event.replacement_for_booking_id || null
      });
      setSent(true);
      if (onSubmitted) onSubmitted(result);
    } catch (saveError) {
      setError(saveError.message || "Venue booking could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="cs-booking-request" aria-label="Request this venue">
      {event.replacement_for_booking_id && (
        <p className="cs-panel-note" role="status">This request will replace booking {event.replacement_for_booking_id} if Venue Staff approve it.</p>
      )}
      <div className="cs-form-grid">
        <label className="cs-field">
          <span className="cs-field-name">Booking label</span>
          <input
            type="text"
            value={details.label}
            onChange={setDetail("label")}
            aria-invalid={Boolean(detailErrors.label)}
            aria-describedby={detailErrors.label ? "cs-booking-label-error" : undefined}
            disabled={sent}
          />
          {detailErrors.label && <span className="cs-error" id="cs-booking-label-error">{detailErrors.label}</span>}
        </label>
        <label className="cs-field">
          <span className="cs-field-name">Expected attendance for this venue</span>
          <input
            type="number"
            min="1"
            step="1"
            value={details.expected_attendance}
            onChange={setDetail("expected_attendance")}
            aria-invalid={Boolean(detailErrors.expected_attendance)}
            aria-describedby={detailErrors.expected_attendance ? "cs-booking-attendance-error" : undefined}
            disabled={sent}
          />
          {detailErrors.expected_attendance && <span className="cs-error" id="cs-booking-attendance-error">{detailErrors.expected_attendance}</span>}
        </label>
        <label className="cs-field">
          <span className="cs-field-name">Layout for this venue</span>
          <select
            value={details.layout}
            onChange={setDetail("layout")}
            aria-invalid={Boolean(detailErrors.layout)}
            aria-describedby={detailErrors.layout ? "cs-booking-layout-error" : undefined}
            disabled={sent}
          >
            <option value="">Choose a layout</option>
            {layoutOptions.map((layout) => <option value={layout} key={layout}>{word(layout)}</option>)}
          </select>
          {detailErrors.layout && <span className="cs-error" id="cs-booking-layout-error">{detailErrors.layout}</span>}
        </label>
      </div>

      <h3>Suitability for {eventName}</h3>

      <dl className="cs-suitability-criteria">
        {groupedRequirementLines(venue, requirements).map((group) => (
          <React.Fragment key={group.criterion}>
            <dt>{CRITERION_LABEL[group.criterion]}</dt>
            <dd>
              {group.lines.map((line) => (
                <span className={`cs-requirement-line cs-requirement-${line.met ? "met" : "unmet"}`} key={line.label}>
                  <span className="cs-requirement-label">{word(line.label)}</span>
                  <span className="cs-requirement-outcome">{line.met ? "Met" : "Not met"}</span>
                </span>
              ))}
            </dd>
          </React.Fragment>
        ))}
      </dl>

      {duplicate && (
        <p className="cs-error" role="alert">
          {`${eventName} already has a ${String(existingBooking.status || "").toLowerCase()} request for ${venue.name}. Withdraw or wait for that one rather than raising a second.`}
        </p>
      )}

      {!duplicate && blocked && <p className="cs-error" role="alert">{blockReason}</p>}

      {!duplicate && !blocked && assessment.warnings.length > 0 && (
        <div className="cs-suitability-warnings">
          <p className="cs-suitability-warnings-lead">
            This venue does not meet everything the event asked for. Acknowledge each shortfall to request it anyway.
          </p>
          {assessment.warnings.map((warning) => (
            <label className="cs-acknowledge-field" key={warning.criterion}>
              <input
                type="checkbox"
                checked={acknowledged.includes(warning.criterion)}
                onChange={() => toggle(warning.criterion)}
              />
              <span>
                {CRITERION_LABEL[warning.criterion]}: this venue lacks {itemList(warning.missing)}. Request it anyway.
              </span>
            </label>
          ))}
        </div>
      )}

      {error && <p className="cs-error">{error}</p>}
      {sent && <p className="cs-booking-sent" role="status">Booking request sent to Venue Staff.</p>}

      {!sent && !duplicate && (
        <div className="cs-form-actions">
          <button
            type="button"
            className="cs-btn cs-btn-primary"
            disabled={!ready || saving}
            onClick={submit}
          >
            {saving ? "Requesting…" : "Request this venue"}
          </button>
        </div>
      )}
    </section>
  );
}
