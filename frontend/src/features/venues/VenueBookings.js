import React, { useCallback, useEffect, useState } from "react";
import { PREFERRED_LOCATIONS } from "../../domain/events";
import { assessVenue, bookingRequirements, existingBookingFor, isBlocked } from "../../domain/venueSuitability";
import { singaporeDateTime } from "../../domain/venueHolds";
import { replacementSearchEvent } from "../../domain/venueBookingWorkflows";
import { reviewApi } from "../events/reviewApi";
import VenueBookingRequest, { BookingAcknowledgementNotice } from "./VenueBookingRequest";
import Icon from "../../app/Icon";
import { loadVenueBookings, loadVenueCatalogue, prepareClashReplacement, releaseVenueBooking, withdrawVenueBooking } from "./venuesApi";

const word = (value) => String(value || "").replaceAll("_", " ");
const listOf = (items = []) => (items.length ? items.map(word).join(", ") : "None stated");
const locationLabel = (value) =>
  PREFERRED_LOCATIONS.find((item) => item.value === value)?.label || word(value) || "No preference";
const bookingDate = (booking) => booking.event_date
  || (booking.start_datetime ? new Date(booking.start_datetime).toLocaleDateString() : "Date not set");
const bookingWindow = (booking) => {
  if (booking.start_time && booking.end_time) return `${booking.start_time}–${booking.end_time}`;
  if (booking.start_datetime && booking.end_datetime) {
    const options = { hour: "2-digit", minute: "2-digit" };
    return `${new Date(booking.start_datetime).toLocaleTimeString([], options)}–${new Date(booking.end_datetime).toLocaleTimeString([], options)}`;
  }
  return "Not set";
};
const displayDateTime = (value) => value ? new Date(value).toLocaleString() : "Time not recorded";

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
  // One count for every requirement this venue does not meet, whatever kind it
  // is: capacity and opening hours both block, so neither can be described by a
  // label of its own without the other reading wrong.
  const unmet = assessment.blocking.length
    + assessment.warnings.reduce((total, warning) => total + warning.missing.length, 0);
  if (!unmet) return { tone: "met", label: "Meets all requirements" };
  return {
    tone: isBlocked(assessment) ? "blocked" : "short",
    label: `${unmet} requirement${unmet === 1 ? "" : "s"} not met`
  };
};

export default function VenueBookings({ user, event: initialEvent = null, venue: initialVenue = null, focusBookingId = null, onViewEvent, onFindReplacement, onClashCountChange, onBackChange, creating: creatingProp, onCreatingChange }) {
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
  // J6 AC2 — arriving from a booking's outcome notification opens that booking.
  const [openBooking, setOpenBooking] = useState(focusBookingId);
  const [confirmWithdraw, setConfirmWithdraw] = useState(null);
  const [releaseBooking, setReleaseBooking] = useState(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [resolvingBookingId, setResolvingBookingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingEvent, setLoadingEvent] = useState(false);
  const [error, setError] = useState("");
  const applyBookings = useCallback((rows) => {
    setBookings(rows);
    onClashCountChange?.(rows);
  }, [onClashCountChange]);

  useEffect(() => {
    let mounted = true;
    Promise.all([reviewApi.list(), loadVenueCatalogue(), loadVenueBookings({ user })])
      .then(([eventList, catalogue, raised]) => {
        if (!mounted) return;
        setEvents(eventList.events || []);
        setVenues(catalogue);
        applyBookings(raised);
      })
      .catch((loadError) => { if (mounted) setError(loadError.message || "Venue bookings could not be loaded."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [applyBookings, user]);

  useEffect(() => {
    if (loading || !focusBookingId) return;
    document.getElementById(`venue-booking-${focusBookingId}`)?.scrollIntoView?.({ block: "start" });
  }, [loading, focusBookingId]);

  // The list view carries no venue requirements — only the detail does — so the
  // chosen event is always re-read before it is judged against a venue.
  useEffect(() => {
    let mounted = true;
    if (!eventId) { setChosenEvent(null); return undefined; }
    setLoadingEvent(true);
    reviewApi.detail(eventId)
      .then((detail) => {
        if (!mounted) return;
        // A replacement search carries booking-specific requirements and the
        // original booking id. Re-reading the base event must not discard that
        // context, otherwise the new request becomes an unrelated normal one.
        const initialEventId = initialEvent?.id || initialEvent?.event_id;
        const replacementContext = initialEventId === eventId ? initialEvent : null;
        setChosenEvent({ ...detail.event, ...(replacementContext || {}), event_id: eventId });
      })
      .catch((loadError) => { if (mounted) setError(loadError.message || "That event could not be loaded."); })
      .finally(() => { if (mounted) setLoadingEvent(false); });
    return () => { mounted = false; };
  }, [eventId, initialEvent]);

  const startOver = useCallback(async () => {
    setCreating(false);
    setEventId("");
    setVenueId("");
    applyBookings(await loadVenueBookings({ user }));
  }, [applyBookings, setCreating, user]);

  // Withdrawing keeps the record and only moves it out of the live statuses, so
  // the event and venue can be requested again without losing what was accepted.
  const withdraw = useCallback(async (bookingId) => {
    setWithdrawing(true);
    setActionError("");
    try {
      await withdrawVenueBooking({ user, bookingId });
      applyBookings(await loadVenueBookings({ user }));
      setConfirmWithdraw(null);
    } catch (withdrawError) {
      setActionError(withdrawError.message || "That request could not be withdrawn.");
    } finally {
      setWithdrawing(false);
    }
  }, [applyBookings, user]);

  const release = useCallback(async () => {
    if (!releaseReason.trim()) { setActionError("A release reason is required."); return; }
    setWithdrawing(true);
    setActionError("");
    try {
      await releaseVenueBooking({ user, bookingId: releaseBooking.booking_id, reason: releaseReason });
      applyBookings(await loadVenueBookings({ user }));
      setReleaseBooking(null);
      setReleaseReason("");
    } catch (releaseError) {
      setActionError(releaseError.message || "That venue could not be released.");
    } finally { setWithdrawing(false); }
  }, [applyBookings, releaseBooking, releaseReason, user]);

  const findReplacement = useCallback(async (booking, clash = null) => {
    setActionError("");
    setResolvingBookingId(booking.booking_id);
    try {
      const prepared = clash && !booking.replacement_needed
        ? await prepareClashReplacement({ user, bookingId: booking.booking_id, clash })
        : null;
      const detail = await reviewApi.detail(booking.event_id);
      onFindReplacement?.(replacementSearchEvent(
        { ...detail.event, event_id: booking.event_id },
        prepared ? { ...booking, ...prepared } : booking
      ));
    } catch (loadError) {
      setActionError(loadError.message || "Replacement details could not be loaded.");
    } finally {
      setResolvingBookingId("");
    }
  }, [onFindReplacement, user]);

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
  const eligibleEvents = events.filter((item) =>
    ["APPROVED", "PLANNING"].includes(String(item.status || "").toUpperCase()));


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
              const activeClash = booking.clashes?.[0] || null;
              const releaseAllowed = ["APPROVED", "PLANNING", "CONFIRMED", "SAFETY_REVIEW"]
                .includes(String(booking.event_status || "").toUpperCase());
              return (
                <article className="cs-record" key={booking.booking_id} id={`venue-booking-${booking.booking_id}`}>
                  <div className="cs-record-title">
                    <h2>{bookingEventName(booking)}</h2>
                    {/* F12 — an event may hold several venues; the label tells them apart. */}
                    <p>{booking.booking_label ? `${booking.booking_label} · ${venueName(booking.venue_id)}` : venueName(booking.venue_id)}</p>
                  </div>
                  <p className="cs-record-ref">
                    {bookingDate(booking)}
                    {` · ${bookingWindow(booking)}`}
                  </p>
                  <div className="cs-record-modified">
                    <span className={`cs-pill cs-pill-${booking.status === "PENDING" ? "info" : "neutral"}`}>
                      {word(booking.status)}
                    </span>
                  </div>
                  {booking.clashes?.length > 0 && (
                    <div className="cs-record-alert" role="status">
                      <strong>Clash - coordinator action required</strong>
                      {booking.clashes.map((clash) => {
                        const other = clash.booking_a_id === booking.booking_id ? clash.event_b_name : clash.event_a_name;
                        return <p key={clash.conflict_id}>Overlaps {other}: {displayDateTime(clash.overlap_start)} to {displayDateTime(clash.overlap_end)}</p>;
                      })}
                    </div>
                  )}
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
                        <div><dt>Venue Staff</dt><dd>{booking.venue_staff_name || "Not recorded"}</dd></div>
                        <div><dt>Date</dt><dd>{bookingDate(booking)}</dd></div>
                        <div><dt>Time</dt><dd>{bookingWindow(booking)}</dd></div>
                        <div><dt>Expected attendance</dt><dd>{booking.expected_attendance ?? "Not set"}</dd></div>
                        <div><dt>Venue capacity</dt><dd>{venueRecord ? venueRecord.max_capacity : "Unknown"}</dd></div>
                        <div><dt>Status</dt><dd>{word(booking.status)}</dd></div>
                        <div><dt>Requested</dt><dd>{booking.requested_at ? new Date(booking.requested_at).toLocaleString() : "Not recorded"}</dd></div>
                        <div><dt>Decision time</dt><dd>{booking.decided_at ? new Date(booking.decided_at).toLocaleString() : "Not decided"}</dd></div>
                        {/* F15 — a hold keeps the venue only until this time. */}
                        {booking.hold_expires_at && <div><dt>Hold expires</dt><dd>{singaporeDateTime(booking.hold_expires_at)}</dd></div>}
                        {booking.decision_reason && <div className="cs-detail-wide"><dt>Decision reason</dt><dd>{booking.decision_reason}</dd></div>}
                        {booking.release_reason && <div className="cs-detail-wide"><dt>Release reason</dt><dd>{booking.release_reason}</dd></div>}
                        {booking.replaced_by_booking_id && <div><dt>Replacement booking</dt><dd>{booking.replaced_by_booking_id}</dd></div>}
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
                        {booking.replacement_needed && onFindReplacement && (
                          <button type="button" className="cs-btn cs-btn-primary" disabled={resolvingBookingId === booking.booking_id} onClick={() => findReplacement(booking)}>
                            Find replacement venue
                          </button>
                        )}
                        {activeClash && !booking.replacement_needed && String(booking.status || "").toUpperCase() === "APPROVED" && onFindReplacement && (
                          <button type="button" className="cs-btn cs-btn-primary" disabled={resolvingBookingId === booking.booking_id} onClick={() => findReplacement(booking, activeClash)}>
                            {resolvingBookingId === booking.booking_id ? "Preparing replacement..." : "Find alternative venue"}
                          </button>
                        )}
                        {String(booking.status || "").toUpperCase() === "APPROVED" && releaseAllowed && (
                          <button type="button" className="cs-btn cs-btn-ghost cs-record-danger" onClick={() => { setActionError(""); setReleaseReason(""); setReleaseBooking(booking); }}>
                            Release this venue
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
        {releaseBooking && <div className="cs-modal-backdrop" onMouseDown={(clickEvent) => { if (clickEvent.target === clickEvent.currentTarget && !withdrawing) setReleaseBooking(null); }}>
          <div className="cs-modal" role="dialog" aria-modal="true" aria-labelledby="cs-release-booking-title">
            <h2 id="cs-release-booking-title">Release this venue?</h2>
            <p>The other venue bookings for this event will stay unchanged.</p>
            <label className="cs-field">
              <span className="cs-field-name">Reason</span>
              <textarea value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} disabled={withdrawing} />
            </label>
            {!releaseReason.trim() && actionError && <p className="cs-error" role="alert">{actionError}</p>}
            <div className="cs-modal-actions">
              <button type="button" className="cs-btn cs-btn-ghost" disabled={withdrawing} onClick={() => setReleaseBooking(null)}>Keep venue</button>
              <button type="button" className="cs-btn cs-btn-ghost cs-record-danger" disabled={withdrawing} onClick={release}>{withdrawing ? "Releasing…" : "Release venue"}</button>
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
              {eligibleEvents.map((item) => (
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
          // Its label, attendance and layout start from this event and venue, so
          // choosing another of either starts the form afresh.
          key={`${eventId}-${venueId}`}
          venue={venue}
          event={chosenEvent}
          user={user}
          existingBooking={existingBookingFor(bookings, { eventId, venueId })}
          onSubmitted={() => loadVenueBookings({ user }).then(applyBookings)}
        />
      )}
    </div>
  );
}
