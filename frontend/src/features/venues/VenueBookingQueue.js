import React, { useEffect, useMemo, useState } from "react";
import { isActiveHold, singaporeDateTime } from "../../domain/venueHolds";
import { approveVenueBooking, holdVenueBooking, loadVenueBookingQueue, rejectVenueBooking } from "./venuesApi";

const asTime = (value) => new Date(value).getTime();
const displayDateTime = (value) => value ? new Date(value).toLocaleString() : "Not recorded";
const words = (value) => String(value || "").replaceAll("_", " ").toLowerCase();
const elapsed = (value, now = Date.now()) => {
  const milliseconds = now - asTime(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "just now";
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const STATUS_TONE = { PENDING: "info", HELD: "warning", APPROVED: "positive", REJECTED: "danger" };
const statusLabel = (status) => {
  const text = words(status);
  return text ? text[0].toUpperCase() + text.slice(1) : "Unknown";
};
const isPending = (booking) => booking.status === "PENDING";
// F15 — a hold is still awaiting its decision until it is converted or lapses.
// One that has lapsed keeps nothing, whatever its stored status still says.
const isHeld = (booking) => isActiveHold(booking);
const isLapsedHold = (booking) => booking.status === "HELD" && !isActiveHold(booking);
// A lapsed hold is finished, so it is listed with the decided requests.
const isDecided = (booking) => !isPending(booking) && !isHeld(booking);
const SHOW = {
  all: { label: "All requests", keep: () => true, empty: "No booking requests for your venues." },
  pending: { label: "Pending", keep: isPending, empty: "No pending requests for your venues." },
  held: { label: "On hold", keep: isHeld, empty: "No requests on hold for your venues." },
  decided: { label: "Decided", keep: isDecided, empty: "No decided requests for your venues yet." }
};
// Pending first, then holds — both still waiting on this staff member — then decided.
const waitingRank = (booking) => (isPending(booking) ? 0 : isHeld(booking) ? 1 : 2);

export default function VenueBookingQueue({ user, onNotice }) {
  const [bookings, setBookings] = useState([]);
  const [show, setShow] = useState("all");
  const [sortBy, setSortBy] = useState("submitted_at");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [expandedBookingId, setExpandedBookingId] = useState("");
  const [rejectingBookingId, setRejectingBookingId] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  const reload = async () => setBookings(await loadVenueBookingQueue({ user }));
  useEffect(() => {
    let mounted = true;
    loadVenueBookingQueue({ user })
      .then((rows) => { if (mounted) setBookings(rows); })
      .catch((failure) => { if (mounted) setError(failure.message || "Booking requests could not be loaded."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [user]);

  // Requests still waiting on this staff member first, then each group by the
  // chosen field.
  const sorted = useMemo(() => bookings.filter(SHOW[show].keep).sort((left, right) => {
    if (waitingRank(left) !== waitingRank(right)) return waitingRank(left) - waitingRank(right);
    const field = sortBy === "requested_date" ? "start_datetime" : "submitted_at";
    return asTime(left[field]) - asTime(right[field]);
  }), [bookings, show, sortBy]);

  const decide = async (booking, action, notice, failureMessage) => {
    setWorking(booking.booking_id);
    setError("");
    try {
      const result = await action({ user, bookingId: booking.booking_id });
      await reload();
      setExpandedBookingId("");
      onNotice?.(notice(result));
    } catch (failure) {
      setError(failure.message || failureMessage);
    } finally {
      setWorking("");
    }
  };
  const approve = (booking) => decide(booking, approveVenueBooking,
    () => `${booking.venue_name} booking approved.`, "The booking could not be approved.");
  const hold = (booking) => decide(booking, holdVenueBooking,
    (result) => `${booking.venue_name} held for ${booking.event_name} until ${singaporeDateTime(result.hold_expires_at)}.`,
    "The venue could not be held.");
  const reject = async (booking) => {
    if (!rejectionReason.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    setWorking(booking.booking_id);
    setError("");
    try {
      await rejectVenueBooking({ user, bookingId: booking.booking_id, reason: rejectionReason });
      await reload();
      setExpandedBookingId("");
      setRejectingBookingId("");
      setRejectionReason("");
      onNotice?.(`${booking.venue_name} booking rejected.`);
    } catch (failure) {
      setError(failure.message || "The booking could not be rejected.");
    } finally {
      setWorking("");
    }
  };

  if (loading) return <p className="cs-panel-note">Loading booking requests…</p>;
  return (
    <section aria-label="Venue booking requests">
      {error && <p className="cs-error" role="alert">{error}</p>}
      <div className="cs-list-actions">
        <label className="cs-field">
          <span className="cs-field-name">Show</span>
          <select value={show} onChange={(event) => setShow(event.target.value)}>
            {Object.entries(SHOW).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
          </select>
        </label>
        <label className="cs-field">
          <span className="cs-field-name">Sort by</span>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="submitted_at">Submission time</option>
            <option value="requested_date">Requested date</option>
          </select>
        </label>
      </div>
      {!sorted.length ? <p className="cs-panel-note">{SHOW[show].empty}</p> : (
        <div className="cs-record-list">
          {sorted.map((booking) => {
            const expanded = expandedBookingId === booking.booking_id;
            const detailsId = `venue-booking-${booking.booking_id}-details`;
            const acknowledgement = booking.suitability_acknowledgement;
            return (
            <article className="cs-record" key={booking.booking_id}>
              <div className="cs-record-title"><h2>{booking.event_name}</h2><p>{booking.venue_name}</p></div>
              <p className="cs-record-ref">{displayDateTime(booking.start_datetime)}–{new Date(booking.end_datetime).toLocaleTimeString()}</p>
              <div className="cs-record-modified">
                {isLapsedHold(booking)
                  ? <span className="cs-pill cs-pill-neutral">Hold expired</span>
                  : <span className={`cs-pill cs-pill-${STATUS_TONE[booking.status] || "neutral"}`}>{statusLabel(booking.status)}</span>}
                <p className="cs-record-saved">{isHeld(booking)
                  ? `Held until ${singaporeDateTime(booking.hold_expires_at)}`
                  : !isPending(booking) && booking.decided_at
                    ? `Decided ${elapsed(booking.decided_at)}`
                    : `Submitted ${elapsed(booking.submitted_at)}`}</p>
              </div>
              <div className="cs-record-actions cs-record-actions-stacked">
                <button
                  type="button"
                  className="cs-btn cs-btn-ghost cs-record-btn"
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  onClick={() => setExpandedBookingId(expanded ? "" : booking.booking_id)}
                >
                  {expanded ? "Close" : "View request"}
                </button>
                {isPending(booking) && (
                  <button type="button" className="cs-btn cs-btn-secondary cs-record-btn" disabled={working === booking.booking_id} onClick={() => hold(booking)}>
                    Place hold
                  </button>
                )}
                {isPending(booking) && (
                  <button type="button" className="cs-btn cs-btn-primary cs-record-btn" disabled={working === booking.booking_id} onClick={() => approve(booking)}>
                    {working === booking.booking_id ? "Approving…" : "Approve"}
                  </button>
                )}
                {isHeld(booking) && (
                  <button type="button" className="cs-btn cs-btn-primary cs-record-btn" disabled={working === booking.booking_id} onClick={() => approve(booking)}>
                    {working === booking.booking_id ? "Converting…" : "Convert to booking"}
                  </button>
                )}
                {(isPending(booking) || isHeld(booking)) && (
                  <button type="button" className="cs-btn cs-btn-ghost cs-record-btn cs-record-danger" disabled={working === booking.booking_id}
                    onClick={() => {
                      setExpandedBookingId(booking.booking_id);
                      setRejectingBookingId(rejectingBookingId === booking.booking_id ? "" : booking.booking_id);
                      setRejectionReason("");
                      setError("");
                    }}>
                    Reject
                  </button>
                )}
              </div>
              {expanded && <div className="cs-record-expanded" id={detailsId}>
                <dl className="cs-detail-grid">
                  <div><dt>Event reference</dt><dd>{booking.event_reference_no || booking.event_id || "Not recorded"}</dd></div>
                  <div><dt>Purpose</dt><dd>{booking.event_purpose ? words(booking.event_purpose) : "Not recorded"}</dd></div>
                  <div><dt>Expected attendance</dt><dd>{booking.expected_attendance}</dd></div>
                  <div><dt>Requested layout</dt><dd>{booking.requested_layout_id || "Not stated"}</dd></div>
                  <div><dt>Registration required</dt><dd>{booking.registration_required ? "Yes" : "No"}</dd></div>
                  <div><dt>Safety review required</dt><dd>{booking.safety_review_required ? "Yes" : "No"}</dd></div>
                  <div><dt>Submitted</dt><dd>{displayDateTime(booking.submitted_at)}</dd></div>
                  {!isPending(booking) && booking.decided_at && <div><dt>Decided</dt><dd>{displayDateTime(booking.decided_at)}</dd></div>}
                  {booking.decision_reason && <div className="cs-detail-wide"><dt>Decision reason</dt><dd>{booking.decision_reason}</dd></div>}
                  {booking.status === "HELD" && booking.hold_expires_at && <div><dt>Hold expires</dt><dd>{singaporeDateTime(booking.hold_expires_at)}</dd></div>}
                  <div><dt>Occupied window</dt><dd>{displayDateTime(booking.occupied_start || booking.start_datetime)}–{displayDateTime(booking.occupied_end || booking.end_datetime)}</dd></div>
                  <div className="cs-detail-wide"><dt>Event description</dt><dd>{booking.event_description || "Not recorded"}</dd></div>
                  <div className="cs-detail-wide"><dt>Known suitability shortfalls</dt><dd>{acknowledgement?.acknowledged
                    ? (acknowledgement.criteria || []).map(words).join(", ") || "Acknowledged without listed criteria"
                    : "None acknowledged"}</dd></div>
                </dl>
                {rejectingBookingId === booking.booking_id && (
                  <form className="cs-inline-form" onSubmit={(event) => { event.preventDefault(); reject(booking); }} noValidate>
                    <label className="cs-field">
                      <span className="cs-field-name">Reason for rejection<span className="cs-required" aria-hidden="true">*</span></span>
                      <textarea rows="3" required value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} />
                    </label>
                    <button className="cs-btn cs-btn-ghost cs-record-danger" type="submit" disabled={working === booking.booking_id}>
                      {working === booking.booking_id ? "Rejecting…" : "Confirm rejection"}
                    </button>
                  </form>
                )}
              </div>}
            </article>
          );})}
        </div>
      )}
    </section>
  );
}

export { elapsed };
