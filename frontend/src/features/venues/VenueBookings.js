import React, { useCallback, useEffect, useState } from "react";
import { PREFERRED_LOCATIONS } from "../../domain/events";
import { assessVenue, bookingRequirements, existingBookingFor, isBlocked } from "../../domain/venueSuitability";
import { reviewApi } from "../events/reviewApi";
import VenueBookingRequest, { BookingAcknowledgementNotice } from "./VenueBookingRequest";
import Icon from "../../app/Icon";
import { loadVenueBookings, loadVenueCatalogue, withdrawVenueBooking } from "./venuesApi";

const word = (value) => String(value || "").replaceAll("_", " ");
const listOf = (items = []) => (items.length ? items.map(word).join(", ") : "None stated");
const locationLabel = (value) =>
  PREFERRED_LOCATIONS.find((item) => item.value === value)?.label || word(value) || "No preference";

// Judge every venue in the list, so the coordinator can tell a usable venue from
// an unusable one before choosing it. Nothing is hidden or reordered: an
// unsuitable venue stays selectable, and the gate still refuses it afterwards.
const venueFeatures = (venue) => [
  { label: "Capacity", items: [`${venue.max_capacity} pax`] },
  { label: "Facilities", items: venue.facilities || [] },
  { label: "Accessibility", items: venue.accessibility || [] },
  { label: "Layouts", items: venue.layouts || [] }
];

const venueVerdict = (venue, requirements) => {
  const assessment = assessVenue(venue, requirements);
  if (isBlocked(assessment)) return { tone: "blocked", label: `Too small for ${requirements.expected_attendance}` };
  if (assessment.warnings.length) {
    const short = assessment.warnings.reduce((total, warning) => total + warning.missing.length, 0);
    return { tone: "short", label: `${short} requirement${short === 1 ? "" : "s"} not met` };
  }
  return { tone: "met", label: "Meets all requirements" };
};

export default function VenueBookings({ user, event: initialEvent = null, venue: initialVenue = null, onViewEvent, onBackChange, creating: creatingProp, onCreatingChange }) {
  const [events, setEvents] = useState([]);
  const [venues, setVenues] = useState([]);
  const [eventId, setEventId] = useState(initialEvent?.id || initialEvent?.event_id || "");
  const [venueId, setVenueId] = useState(initialVenue?.venue_id || "");
  const [chosenEvent, setChosenEvent] = useState(null);
  const [bookings, setBookings] = useState([]);
  // Controlled by the workspace when it hosts the New booking request action in
  // the page header; self-contained otherwise, so the screen still works alone.
  const headerHosted = typeof onCreatingChange === "function";
  const [ownCreating, setOwnCreating] = useState(Boolean(initialEvent || initialVenue));
  const creating = headerHosted ? Boolean(creatingProp) : ownCreating;
  const setCreating = headerHosted ? onCreatingChange : setOwnCreating;
  const [openBooking, setOpenBooking] = useState(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(null);
  const [actionError, setActionError] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingEvent, setLoadingEvent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    Promise.all([reviewApi.list(), loadVenueCatalogue(), loadVenueBookings({ userId: user?.uid })])
      .then(([eventList, catalogue, raised]) => {
        if (!mounted) return;
        setEvents(eventList.events || []);
        setVenues(catalogue);
        setBookings(raised);
      })
      .catch((loadError) => { if (mounted) setError(loadError.message || "Venue bookings could not be loaded."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [user?.uid]);

  // The list view carries no venue requirements — only the detail does — so the
  // chosen event is always re-read before it is judged against a venue.
  useEffect(() => {
    let mounted = true;
    if (!eventId) { setChosenEvent(null); return undefined; }
    setLoadingEvent(true);
    reviewApi.detail(eventId)
      .then((detail) => { if (mounted) setChosenEvent({ ...detail.event, event_id: eventId }); })
      .catch((loadError) => { if (mounted) setError(loadError.message || "That event could not be loaded."); })
      .finally(() => { if (mounted) setLoadingEvent(false); });
    return () => { mounted = false; };
  }, [eventId]);

  const startOver = useCallback(async () => {
    setCreating(false);
    setEventId("");
    setVenueId("");
    setBookings(await loadVenueBookings({ userId: user?.uid }));
  }, [setCreating, user?.uid]);

  // Withdrawing keeps the record and only moves it out of the live statuses, so
  // the event and venue can be requested again without losing what was accepted.
  const withdraw = useCallback(async (bookingId) => {
    setWithdrawing(true);
    setActionError("");
    try {
      await withdrawVenueBooking({ bookingId });
      setBookings(await loadVenueBookings({ userId: user?.uid }));
      setConfirmWithdraw(null);
    } catch (withdrawError) {
      setActionError(withdrawError.message || "That request could not be withdrawn.");
    } finally {
      setWithdrawing(false);
    }
  }, [user?.uid]);

  // Inside the workspace the back button lives in the page header; the form only
  // says it is open and how to leave it.
  useEffect(() => {
    if (!onBackChange) return undefined;
    onBackChange(creating ? startOver : null);
    return () => onBackChange(null);
  }, [creating, onBackChange, startOver]);

  if (loading) return <p className="cs-panel-note">Loading venue bookings…</p>;
  if (error) return <p className="cs-error">{error}</p>;

  const venue = venues.find((item) => item.venue_id === venueId) || null;
  const requirements = chosenEvent ? bookingRequirements(chosenEvent) : null;
  const venueName = (id) => venues.find((item) => item.venue_id === id)?.name || "Venue not in the catalogue";
  // Bookings raised before the title was carried across fall back to the event.
  const bookingEventName = (booking) =>
    booking.event_name || events.find((item) => item.id === booking.event_id)?.name || "Untitled event";


  // The requests this coordinator has raised, with a way to raise another —
  // the same shape as the organiser's event list.
  if (!creating) {
    return (
      <div className="cs-venue-bookings">
        {!headerHosted && (
          <div className="cs-list-actions">
            <button type="button" className="cs-btn cs-btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" />New booking request
            </button>
          </div>
        )}
        {actionError && <p className="cs-error" role="alert">{actionError}</p>}
        {bookings.length ? (
          <div className="cs-record-list">
            {bookings.map((booking) => {
              const expanded = openBooking === booking.booking_id;
              const venueRecord = venues.find((item) => item.venue_id === booking.venue_id);
              return (
                <article className="cs-record" key={booking.booking_id}>
                  <div className="cs-record-title">
                    <h2>{bookingEventName(booking)}</h2>
                    <p>{venueName(booking.venue_id)}</p>
                  </div>
                  <p className="cs-record-ref">
                    {booking.event_date || "Date not set"}
                    {booking.start_time && booking.end_time ? ` · ${booking.start_time}–${booking.end_time}` : ""}
                  </p>
                  <div className="cs-record-modified">
                    <span className={`cs-pill cs-pill-${booking.status === "PENDING" ? "info" : "neutral"}`}>
                      {word(booking.status)}
                    </span>
                  </div>
                  <div className="cs-record-actions">
                    <button
                      type="button"
                      className="cs-btn cs-btn-ghost cs-record-btn"
                      aria-expanded={expanded}
                      onClick={() => setOpenBooking(expanded ? null : booking.booking_id)}
                    >
                      {expanded ? "Hide details" : "View details"}
                    </button>
                  </div>
                  {expanded && (
                    <div className="cs-record-expanded">
                      <dl className="cs-detail-grid">
                        <div><dt>Event</dt><dd>{bookingEventName(booking)}</dd></div>
                        <div><dt>Venue</dt><dd>{venueName(booking.venue_id)}</dd></div>
                        <div><dt>Date</dt><dd>{booking.event_date || "Not set"}</dd></div>
                        <div><dt>Time</dt><dd>{booking.start_time && booking.end_time ? `${booking.start_time}–${booking.end_time}` : "Not set"}</dd></div>
                        <div><dt>Expected attendance</dt><dd>{booking.expected_attendance ?? "Not set"}</dd></div>
                        <div><dt>Venue capacity</dt><dd>{venueRecord ? venueRecord.max_capacity : "Unknown"}</dd></div>
                        <div><dt>Status</dt><dd>{word(booking.status)}</dd></div>
                        <div><dt>Requested</dt><dd>{booking.requested_at ? new Date(booking.requested_at).toLocaleString() : "Not recorded"}</dd></div>
                      </dl>
                      <BookingAcknowledgementNotice acknowledgement={booking.suitability_acknowledgement} />
                      <div className="cs-form-actions">
                        {onViewEvent && (
                          <button type="button" className="cs-btn cs-btn-secondary" onClick={() => onViewEvent(booking.event_id)}>
                            View event request
                          </button>
                        )}
                        {String(booking.status || "").toUpperCase() === "PENDING" && (
                          <button type="button" className="cs-btn cs-btn-ghost cs-record-danger" onClick={() => { setActionError(""); setConfirmWithdraw(booking); }}>
                            Withdraw request
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="cs-panel-note">No booking requests raised yet. Start one with New booking request.</p>
        )}

        {confirmWithdraw && <div className="cs-modal-backdrop" onMouseDown={(clickEvent) => { if (clickEvent.target === clickEvent.currentTarget && !withdrawing) setConfirmWithdraw(null); }}>
          <div className="cs-modal" role="dialog" aria-modal="true" aria-labelledby="cs-withdraw-booking-title">
            <h2 id="cs-withdraw-booking-title">Withdraw this request?</h2>
            <p>
              <strong>{bookingEventName(confirmWithdraw)}</strong> at <strong>{venueName(confirmWithdraw.venue_id)}</strong> will
              no longer be with Venue Staff. The venue becomes available to request again for this event.
            </p>
            <div className="cs-modal-actions">
              {/* The safe choice takes focus, so Enter on an unread dialog keeps the request. */}
              <button type="button" autoFocus className="cs-btn cs-btn-ghost" disabled={withdrawing} onClick={() => setConfirmWithdraw(null)}>Keep request</button>
              <button type="button" className="cs-btn cs-btn-ghost cs-record-danger" disabled={withdrawing} onClick={() => withdraw(confirmWithdraw.booking_id)}>
                {withdrawing ? "Withdrawing…" : "Yes, withdraw"}
              </button>
            </div>
          </div>
        </div>}
      </div>
    );
  }

  return (
    <div className="cs-venue-bookings">
      {!onBackChange && <button type="button" className="cs-btn cs-btn-ghost cs-back" onClick={startOver}><Icon name="chevron-left" />Back to bookings</button>}
      <section className="cs-form-section" aria-label="Event details">
        <h2>Event details</h2>
        <div className="cs-form-grid">
          <label className="cs-field">
            <span className="cs-field-name">Event</span>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">Choose an event</option>
              {events.map((item) => (
                <option value={item.id} key={item.id}>{item.name || item.reference_no || item.id}</option>
              ))}
            </select>
          </label>
        </div>

        {!loadingEvent && chosenEvent && (
          <dl className="cs-detail-grid">
            <div><dt>Date</dt><dd>{chosenEvent.event_date || "Not set"}</dd></div>
            <div><dt>Time</dt><dd>{chosenEvent.start_time && chosenEvent.end_time ? `${chosenEvent.start_time}–${chosenEvent.end_time}` : "Not set"}</dd></div>
            <div><dt>Expected attendance</dt><dd>{chosenEvent.expected_attendance ?? "Not set"}</dd></div>
            <div><dt>Preferred location</dt><dd>{locationLabel(chosenEvent.preferred_location)}</dd></div>
            <div><dt>Required layout</dt><dd>{word(chosenEvent.required_layout) || "None stated"}</dd></div>
            <div className="cs-detail-wide"><dt>Required facilities</dt><dd>{listOf(chosenEvent.facilities)}</dd></div>
            <div className="cs-detail-wide"><dt>Accessibility needs</dt><dd>{listOf(chosenEvent.accessibility)}</dd></div>
          </dl>
        )}
      </section>

      <section className="cs-form-section" aria-label="Choose a venue">
        <h2>Venue</h2>
        {!requirements && <p className="cs-panel-note">Choose an event first to see how each venue measures up.</p>}
        <ul className="cs-venue-picker">
          {venues.map((item) => {
            const verdict = requirements ? venueVerdict(item, requirements) : null;
            return (
              <li key={item.venue_id}>
                <label
                  className={`cs-venue-card${venueId === item.venue_id ? " cs-venue-card-chosen" : ""}${verdict ? ` cs-venue-card-${verdict.tone}` : ""}`}
                  htmlFor={`venue-${item.venue_id}`}
                  aria-label={item.name}
                >
                  <div className="cs-venue-card-head">
                    <input
                      type="radio"
                      className="cs-venue-radio"
                      id={`venue-${item.venue_id}`}
                      name="venue"
                      value={item.venue_id}
                      checked={venueId === item.venue_id}
                      onChange={() => setVenueId(item.venue_id)}
                    />
                    <div className="cs-venue-card-title">
                      <h3>{item.name}</h3>
                      <p className="cs-venue-card-sub">Holds {item.max_capacity}{item.location ? ` · ${locationLabel(item.location)}` : ""}</p>
                    </div>
                    {verdict && <span className={`cs-venue-verdict cs-venue-verdict-${verdict.tone}`}>{verdict.label}</span>}
                  </div>

                  <dl className="cs-venue-card-lines">
                    {venueFeatures(item).map((group) => (
                      <React.Fragment key={group.label}>
                        <dt>{group.label}</dt>
                        <dd>
                          {group.items.length
                            ? group.items.map((entry) => (
                              <span className="cs-feature-line" key={entry}>{word(entry)}</span>
                            ))
                            : <span className="cs-feature-line cs-feature-none">None listed</span>}
                        </dd>
                      </React.Fragment>
                    ))}
                  </dl>

                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {loadingEvent && <p className="cs-panel-note">Loading the event's requirements…</p>}


      {!loadingEvent && chosenEvent && venue && (
        <VenueBookingRequest
          venue={venue}
          event={chosenEvent}
          user={user}
          existingBooking={existingBookingFor(bookings, { eventId, venueId })}
          onSubmitted={() => loadVenueBookings({ userId: user?.uid }).then(setBookings)}
        />
      )}
    </div>
  );
}
