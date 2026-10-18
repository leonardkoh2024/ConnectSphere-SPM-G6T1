import React, { useEffect, useState } from "react";
import { BookingAcknowledgementNotice } from "./VenueBookingRequest";
import { loadVenueSearchContext } from "./venuesApi";
import Icon from "../../app/Icon";
import { UNAVAILABILITY_REASONS, affectedApprovedBookings, calendarSegments } from "../../domain/venueBooking";

const formatDateTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time not set" : date.toLocaleString();
};

export function VenueUnavailabilityManager({ venue, periods = [], bookings = [], canEdit = false, onSave }) {
  const [startDateTime, setStartDateTime] = useState("");
  const [endDateTime, setEndDateTime] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [stagedAdditions, setStagedAdditions] = useState([]);
  const [releasedIds, setReleasedIds] = useState([]);
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const persistedPeriodIds = periods.map((period) => period.id).join("|");

  useEffect(() => {
    setStagedAdditions([]);
    setReleasedIds([]);
    setError("");
  }, [venue.venue_id, persistedPeriodIds]);

  const submitPeriod = async (event) => {
    event.preventDefault();
    const start = new Date(startDateTime);
    const end = new Date(endDateTime);
    if (!startDateTime || !endDateTime || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setError("Choose an end date and time after the start.");
      return;
    }
    if (!UNAVAILABILITY_REASONS.includes(reason)) {
      setError("Choose a reason for blocking this venue.");
      return;
    }
    if (reason === "Other" && !note.trim()) {
      setError("Enter a note when the reason is Other.");
      return;
    }

    const draft = {
      start_datetime: start.toISOString(),
      end_datetime: end.toISOString(),
      reason,
      note: note.trim()
    };
    const affected = affectedApprovedBookings({
      venueId: venue.venue_id,
      start: draft.start_datetime,
      end: draft.end_datetime,
      bookings
    });
    if (affected.length) {
      setPendingConfirm({ draft, affected });
      setError("");
      return;
    }
    stageAddition(draft, false);
  };

  const stageAddition = (draft, confirmed) => {
    setError("");
    setPendingConfirm(null);
    setStagedAdditions((current) => [...current, {
      id: `draft-${Date.now()}-${current.length}`,
      ...draft,
      confirmed
    }]);
    setStartDateTime("");
    setEndDateTime("");
    setReason("");
    setNote("");
  };

  const toggleRelease = (periodId) => {
    setError("");
    if (periodId.startsWith("draft-")) {
      setStagedAdditions((current) => current.filter((period) => period.id !== periodId));
      return;
    }
    setReleasedIds((current) => current.includes(periodId)
      ? current.filter((id) => id !== periodId)
      : [...current, periodId]);
  };

  const saveChanges = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave({
        venueId: venue.venue_id,
        keepPeriodIds: periods.filter((period) => !releasedIds.includes(period.id)).map((period) => period.id),
        additions: stagedAdditions.map(({ start_datetime, end_datetime, reason: periodReason, note: periodNote }) => ({
          start_datetime,
          end_datetime,
          reason: periodReason,
          note: periodNote || ""
        })),
        confirmOverlaps: stagedAdditions.some((period) => period.confirmed)
      });
      setStagedAdditions([]);
      setReleasedIds([]);
    } catch (saveError) {
      setError(saveError.message || "Availability changes could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = stagedAdditions.length > 0 || releasedIds.length > 0;
  const displayedPeriods = [
    ...periods.map((period) => ({ ...period, pendingRelease: releasedIds.includes(period.id) })),
    ...stagedAdditions.map((period) => ({ ...period, pendingAddition: true }))
  ];

  return (
    <section className="cs-venue-periods" aria-label="Venue unavailability">
      <h3>Unavailability periods</h3>
      {error && <p className="cs-error" role="alert">{error}</p>}
      {displayedPeriods.length ? (
        <ul className="cs-availability-list">
          {displayedPeriods.map((period) => (
            <li className={`cs-availability-entry${period.pendingRelease ? " cs-availability-entry-pending-release" : ""}`} key={period.id}>
              <div><strong>{formatDateTime(period.start_datetime)} to {formatDateTime(period.end_datetime)}</strong><p>{period.reason}</p></div>
              <div className="cs-availability-actions">
                <span className="cs-availability-blocked">{period.pendingRelease ? "Pending release" : period.pendingAddition ? "Pending save" : "Blocked"}</span>
                {canEdit && <button type="button" className="cs-btn cs-btn-ghost cs-record-btn" onClick={() => toggleRelease(period.id)}>{period.pendingRelease ? "Undo release" : period.pendingAddition ? "Remove draft" : "Stage release"}</button>}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="cs-panel-note">No unavailability periods recorded.</p>}
      {canEdit && (
        <form className="cs-availability-form" aria-label="Record unavailability" noValidate onSubmit={submitPeriod}>
          <h4>Block this venue</h4>
          <div className="cs-form-grid">
            <label className="cs-field"><span className="cs-field-name">Starts</span><input required type="datetime-local" value={startDateTime} onChange={(event) => setStartDateTime(event.target.value)} /></label>
            <label className="cs-field"><span className="cs-field-name">Ends</span><input required type="datetime-local" value={endDateTime} onChange={(event) => setEndDateTime(event.target.value)} /></label>
            <label className="cs-field cs-field-wide"><span className="cs-field-name">Reason</span>
              <select required value={reason} onChange={(event) => setReason(event.target.value)}>
                <option value="">Choose a reason</option>
                {UNAVAILABILITY_REASONS.map((item) => <option value={item} key={item}>{item}</option>)}
              </select>
            </label>
            {reason === "Other" && (
              <label className="cs-field cs-field-wide"><span className="cs-field-name">Note</span>
                <textarea required rows="2" value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
            )}
          </div>
          <button type="submit" className="cs-btn cs-btn-secondary"><Icon name="plus" />Add period</button>
          {pendingConfirm && (
            <div className="cs-panel-note" role="alert">
              <p>This period overlaps approved bookings. Confirm to take the venue out of use. Bookings stay in place and are marked for replacement.</p>
              <ul>
                {pendingConfirm.affected.map((booking) => (
                  <li key={booking.booking_id || booking.reference_no}>{booking.event_name || booking.reference_no || booking.booking_id}</li>
                ))}
              </ul>
              <button type="button" className="cs-btn cs-btn-primary" onClick={() => stageAddition(pendingConfirm.draft, true)}>Confirm and add period</button>
            </div>
          )}
        </form>
      )}
      {canEdit && <div className="cs-form-actions cs-availability-save-actions">
        <button type="button" className="cs-btn cs-btn-ghost" disabled={!hasChanges || saving} onClick={() => { setStagedAdditions([]); setReleasedIds([]); setError(""); }}>Discard changes</button>
        <button type="button" className="cs-btn cs-btn-primary" disabled={!hasChanges || saving} onClick={saveChanges}>{saving ? "Saving…" : "Save changes"}</button>
      </div>}
    </section>
  );
}

export default function VenueAvailabilityCalendar({ user, role }) {
  const [context, setContext] = useState({ venues: [], bookings: [], unavailability: [] });
  const [venueId, setVenueId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    loadVenueSearchContext({ userId: user?.uid, role })
      .then((result) => {
        if (!mounted) return;
        setContext(result);
        setVenueId(result.venues[0]?.venue_id || "");
      })
      .catch((loadError) => { if (mounted) setError(loadError.message || "Availability could not be loaded."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [role, user?.uid]);

  if (loading) return <p className="cs-panel-note">Loading venue availability…</p>;
  if (error) return <p className="cs-error">{error}</p>;

  const venue = context.venues.find((item) => item.venue_id === venueId);
  const bookingEntries = context.bookings.filter((item) => item.venue_id === venueId).flatMap((item) => {
    const approved = String(item.status || "").toUpperCase() === "APPROVED";
    const label = item.event_name || item.reference_no || item.booking_id || "Venue booking";
    if (!approved) {
      return [{ ...item, kind: "pending", label }];
    }
    return calendarSegments(item, venue || {}).map((segment) => ({
      ...item,
      id: `${item.booking_id || item.id}-${segment.kind}`,
      kind: segment.kind === "event" ? "booked" : segment.kind,
      start_datetime: new Date(segment.start).toISOString(),
      end_datetime: new Date(segment.end).toISOString(),
      label: segment.kind === "setup" ? `Setup · ${label}` : segment.kind === "turnaround" ? `Turnaround · ${label}` : label
    }));
  });
  const entries = [
    ...context.unavailability.filter((item) => item.venue_id === venueId).map((item) => ({ ...item, kind: "blocked", label: item.reason })),
    ...bookingEntries
  ].sort((left, right) => new Date(left.start_datetime) - new Date(right.start_datetime));

  return (
    <section className="cs-availability-calendar" aria-label="Venue availability calendar">
      <label className="cs-field cs-calendar-venue"><span className="cs-field-name">Venue</span>
        <select value={venueId} onChange={(event) => setVenueId(event.target.value)}>
          {context.venues.map((item) => <option value={item.venue_id} key={item.venue_id}>{item.name}</option>)}
        </select>
      </label>
      {venue ? <>
        <h2>{venue.name}</h2>
        {entries.length ? <ol className="cs-availability-list">
          {entries.map((item) => (
            <li className="cs-availability-entry" key={`${item.kind}-${item.id || item.booking_id}`}>
              <div>
                <strong>{formatDateTime(item.start_datetime)} to {formatDateTime(item.end_datetime)}</strong><p>{item.label}</p>
                {/* E8 AC3 — the shortfalls the coordinator accepted, where Venue Staff assess the booking. */}
                <BookingAcknowledgementNotice acknowledgement={item.suitability_acknowledgement} />
              </div>
              <span className={`cs-availability-${item.kind}`}>{item.kind === "blocked" ? "Blocked" : item.kind === "booked" ? "Approved booking" : item.kind === "setup" ? "Setup" : item.kind === "turnaround" ? "Turnaround" : "Pending booking"}</span>
            </li>
          ))}
        </ol> : <p className="cs-panel-note">No availability data recorded for this venue.</p>}
      </> : <p className="cs-panel-note">No venues are available to display.</p>}
    </section>
  );
}