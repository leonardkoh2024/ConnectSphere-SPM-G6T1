import React, { useEffect, useMemo, useState } from "react";
import { approveVenueBooking, loadVenueBookingQueue } from "./venuesApi";

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

export default function VenueBookingQueue({ user, onNotice }) {
  const [bookings, setBookings] = useState([]);
  const [sortBy, setSortBy] = useState("submitted_at");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [expandedBookingId, setExpandedBookingId] = useState("");

  const reload = async () => setBookings(await loadVenueBookingQueue({ user }));
  useEffect(() => {
    let mounted = true;
    loadVenueBookingQueue({ user })
      .then((rows) => { if (mounted) setBookings(rows); })
      .catch((failure) => { if (mounted) setError(failure.message || "Booking requests could not be loaded."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [user]);

  const sorted = useMemo(() => [...bookings].sort((left, right) => {
    const field = sortBy === "requested_date" ? "start_datetime" : "submitted_at";
    return asTime(left[field]) - asTime(right[field]);
  }), [bookings, sortBy]);

  const approve = async (booking) => {
    setWorking(booking.booking_id);
    setError("");
    try {
      await approveVenueBooking({ user, bookingId: booking.booking_id });
      await reload();
      setExpandedBookingId("");
      onNotice?.(`${booking.venue_name} booking approved.`);
    } catch (failure) {
      setError(failure.message || "The booking could not be approved.");
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
          <span className="cs-field-name">Sort by</span>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="submitted_at">Submission time</option>
            <option value="requested_date">Requested date</option>
          </select>
        </label>
      </div>
      {!sorted.length ? <p className="cs-panel-note">No pending requests for your venues.</p> : (
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
                <span className="cs-pill cs-pill-info">Pending</span>
                <p className="cs-record-saved">Submitted {elapsed(booking.submitted_at)}</p>
              </div>
              <div className="cs-record-actions">
                <button
                  type="button"
                  className="cs-btn cs-btn-ghost cs-record-btn"
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  onClick={() => setExpandedBookingId(expanded ? "" : booking.booking_id)}
                >
                  {expanded ? "Close" : "View request"}
                </button>
                <button type="button" className="cs-btn cs-btn-primary cs-record-btn" disabled={working === booking.booking_id} onClick={() => approve(booking)}>
                  {working === booking.booking_id ? "Approving…" : "Approve"}
                </button>
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
                  <div><dt>Occupied window</dt><dd>{displayDateTime(booking.occupied_start || booking.start_datetime)}–{displayDateTime(booking.occupied_end || booking.end_datetime)}</dd></div>
                  <div className="cs-detail-wide"><dt>Event description</dt><dd>{booking.event_description || "Not recorded"}</dd></div>
                  <div className="cs-detail-wide"><dt>Known suitability shortfalls</dt><dd>{acknowledgement?.acknowledged
                    ? (acknowledgement.criteria || []).map(words).join(", ") || "Acknowledged without listed criteria"
                    : "None acknowledged"}</dd></div>
                </dl>
              </div>}
            </article>
          );})}
        </div>
      )}
    </section>
  );
}

export { elapsed };
