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

  // An event document stores its title as `name`; `event_name` is what a booking
  // carries. Accept either so the gate works on a real event and a booking alike.
  const eventName = event.event_name || event.name || "Untitled event";
  const requirements = useMemo(() => bookingRequirements(event), [event]);
  const assessment = useMemo(() => assessVenue(venue, requirements), [venue, requirements]);

  const blocked = isBlocked(assessment);
  const duplicate = Boolean(existingBooking) && !sent;
  const ready = canSubmitBooking({ assessment, acknowledged });
  const blockReason = submissionBlockReason({ assessment, acknowledged });

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
        expected_attendance: requirements.expected_attendance,
        required_layout: requirements.layout,
        required_facilities: requirements.facilities,
        acknowledgement: acknowledgementRecord({
          assessment,
          acknowledged,
          userId: user?.uid,
          at: new Date().toISOString()
        })
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
