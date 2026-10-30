import React, { useEffect, useMemo, useState } from "react";
import { ACCESSIBILITY_OPTIONS, FACILITIES, LAYOUTS, PREFERRED_LOCATIONS } from "../../domain/events";
import {
  activeFilters,
  applyFilters,
  emptyFilters,
  prefillFilters,
  prefillSearch,
  searchVenues
} from "../../domain/venueSearch";
import { ROLES } from "../../domain/roles";
import ToggleList from "../events/components/ToggleList";
import { VenueUnavailabilityManager } from "./VenueAvailability";
import VenueCalendar from "./VenueCalendar";
import { loadVenueSearchContext } from "./venuesApi";
import VenueDetail, { VenueRows } from "./VenueDetail";
import { existingBookingFor } from "../../domain/venueSuitability";
import { assessVenueSuitability } from "../../domain/venueSearch";

const chipLabel = (item) => {
  if (item.key === "location") return item.value.replaceAll("_", " ");
  if (item.key === "layout") return String(item.value).replaceAll("_", " ");
  if (item.key === "capacity_range") {
    const [min, max] = item.value;
    if (min != null && max != null) return `${min}–${max} pax`;
    if (min != null) return `${min}+ pax`;
    return `Up to ${max} pax`;
  }
  // activeFilters yields only these keys, so what is left is facilities or accessibility.
  return item.value.map((value) => value.replaceAll("_", " ")).join(", ");
};

export default function VenueSearch({ event, onBookVenue, role = ROLES.COORDINATOR, showCalendar = false, onCloseCalendar }) {
  const [catalogue, setCatalogue] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [unavailability, setUnavailability] = useState([]);
  // Opened from an event, the shortlist starts narrowed to what that event asked
  // for; opened from the sidebar, it starts as the whole catalogue.
  const [filters, setFilters] = useState(() => (event ? prefillFilters(event) : emptyFilters()));
  const [selected, setSelected] = useState(null);
  const [requirementsOpen, setRequirementsOpen] = useState(true);
  const [error, setError] = useState("");
  const [bookingNotice, setBookingNotice] = useState("");
  // E7 as a filter: the window the venue has to be open for. Prefilled from the
  // event when the search was opened from one.
  const [assessWindow, setAssessWindow] = useState(() => ({
    event_date: event?.event_date || "",
    start_time: event?.start_time || "",
    end_time: event?.end_time || ""
  }));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    loadVenueSearchContext()
      .then((data) => {
        if (!mounted) return;
        setCatalogue(data.venues);
        setBookings(data.bookings);
        setUnavailability(data.unavailability);
      })
      .catch((loadError) => { if (mounted) setError(loadError.message || "The venue catalogue could not be loaded."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const updateWindow = (field, value) => setAssessWindow((current) => ({ ...current, [field]: value }));
  // A date alone is enough to filter: it says which day the venue must open on.
  // Times narrow it further, to a window inside those opening hours.
  const hasDate = Boolean(assessWindow.event_date);
  const windowSet = Boolean(assessWindow.event_date || assessWindow.start_time || assessWindow.end_time);
  const clearAll = () => {
    setFilters(emptyFilters());
    setAssessWindow({ event_date: "", start_time: "", end_time: "" });
  };
  const hasTimes = Boolean(assessWindow.start_time && assessWindow.end_time);
  const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const parts = hasDate ? assessWindow.event_date.split("-").map(Number) : [];
  const weekday = parts.length === 3 ? WEEKDAYS[new Date(parts[0], parts[1] - 1, parts[2]).getDay()] : null;
  // Only asked of a venue that states hours (see unstated below).
  const opensOnDay = (venue) => venue.operating_hours
    .some((row) => String(row.weekday).toUpperCase() === weekday);

  const windowPrefill = event ? prefillSearch(event) : null;
  // Available means both open and not already taken, judged against the window on
  // screen rather than only the one the event arrived with — so changing the date
  // or time re-checks approved bookings and blocked periods as well as hours.
  const searchWindow = hasDate
    ? {
      ...assessWindow,
      expected_attendance: filters.min_capacity ?? windowPrefill?.expected_attendance ?? 0
    }
    : windowPrefill;
  const shortlist = useMemo(() => {
    if (!searchWindow) return { matches: catalogue, count: catalogue.length, excluded: null };
    return searchVenues({ venues: catalogue, window: searchWindow, bookings, unavailability });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue, bookings, unavailability,
    searchWindow?.event_date, searchWindow?.start_time, searchWindow?.end_time, searchWindow?.expected_attendance]);

  // The coordinator's only venue screen: the whole catalogue A–Z until an event
  // or a filter narrows it.
  const shown = applyFilters(shortlist.matches, filters)
    .filter((venue) => venue.venue_id !== event?.excluded_venue_id)
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" }));
  const chips = activeFilters(filters);

  const assessed = hasDate
    ? shown.map((venue) => ({
      venue,
      assessment: assessVenueSuitability({
        venue,
        event: {
          ...assessWindow,
          expected_attendance: filters.min_capacity,
          facilities: filters.facilities,
          accessibility: filters.accessibility,
          layout: filters.layout
        }
      })
    }))
    : [];
  // A criterion only rules a venue out when both sides of it are actually stated.
  // A requirement left blank is no constraint, the way a filter behaves; and a
  // venue that states no operating hours is treated as open at all hours rather
  // than closed, which is also the stance E4 AC8 takes on missing data.
  const unstated = (venue, criterion) =>
    (criterion.key === "capacity" && filters.min_capacity == null) ||
    (criterion.key === "operating-hours" && (
      // Hours not stated at all: treated as open at any time.
      (venue.operating_hours || []).length === 0 ||
      // Only a date given: the venue opening that day is all that can be asked.
      (!hasTimes && opensOnDay(venue))
    ));

  const disqualifying = ({ venue, assessment }) =>
    assessment.criteria.filter((criterion) => !criterion.passed && !unstated(venue, criterion));
  const listed = hasDate
    ? assessed.filter((row) => disqualifying(row).length === 0).map((row) => row.venue)
    : shown;

  const updateFilter = (field, value) => setFilters((current) => ({ ...current, [field]: value }));
  const toNumber = (value) => (value === "" ? null : Number(value));

  if (loading) return <p className="cs-panel-note">Loading venues…</p>;
  if (error) return <p className="cs-error">{error}</p>;

  // E4 — "View calendar" in the page header swaps the shortlist for the shared
  // availability calendar. Filters are held here, so Back returns to the same shortlist.
  if (showCalendar) {
    return <VenueCalendar venues={catalogue} bookings={bookings} unavailability={unavailability} role={role} onBack={onCloseCalendar} />;
  }

  return (
    <>
      {windowPrefill && (
        <p className="cs-panel-note">
          Pre-filled from the event: {windowPrefill.event_date} · {windowPrefill.start_time}–{windowPrefill.end_time} · {windowPrefill.expected_attendance} attending
        </p>
      )}
      {event?.excluded_venue_id && (
        <p className="cs-panel-note">The unavailable original venue is excluded from this replacement search.</p>
      )}
      {/* E6 and E7 in one card: the requirements are stated once, they narrow the
          shortlist, and the same values are what a named venue is assessed against. */}
      <section className="cs-form-section cs-collapsible-section" aria-label="Venue requirements">
        <div className="cs-collapsible-heading">
          <h2>Requirements</h2>
          <button
            type="button"
            className="cs-btn cs-btn-ghost cs-record-btn"
            aria-expanded={requirementsOpen}
            aria-controls="venue-requirements-fields"
            onClick={() => setRequirementsOpen((open) => !open)}
          >
            {requirementsOpen ? "Close requirements" : "Open requirements"}
          </button>
        </div>
        {requirementsOpen && <div id="venue-requirements-fields" className="cs-collapsible-content">
          <div className="cs-form-grid">
          <label className="cs-field">
            <span className="cs-field-name">Event date</span>
            <input type="date" value={assessWindow.event_date} onChange={(e) => updateWindow("event_date", e.target.value)} />
          </label>
          <label className="cs-field">
            <span className="cs-field-name">Start time</span>
            <input type="time" value={assessWindow.start_time} onChange={(e) => updateWindow("start_time", e.target.value)} />
          </label>
          <label className="cs-field">
            <span className="cs-field-name">End time</span>
            <input type="time" value={assessWindow.end_time} onChange={(e) => updateWindow("end_time", e.target.value)} />
          </label>
          <label className="cs-field">
            <span className="cs-field-name">Location</span>
            <select value={filters.location || ""} onChange={(e) => updateFilter("location", e.target.value || null)}>
              <option value="">Any location</option>
              {PREFERRED_LOCATIONS.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label className="cs-field">
            <span className="cs-field-name">Minimum capacity</span>
            <input type="number" min="1" step="1" value={filters.min_capacity ?? ""} onChange={(e) => updateFilter("min_capacity", toNumber(e.target.value))} />
          </label>
          <label className="cs-field">
            <span className="cs-field-name">Maximum capacity</span>
            <input type="number" min="1" step="1" value={filters.max_capacity ?? ""} onChange={(e) => updateFilter("max_capacity", toNumber(e.target.value))} />
          </label>
          <label className="cs-field">
            <span className="cs-field-name">Supported layout</span>
            <select value={filters.layout || ""} onChange={(e) => updateFilter("layout", e.target.value || null)}>
              <option value="">Any layout</option>
              {LAYOUTS.map((item) => <option value={item} key={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
          </label>
          </div>
          <ToggleList label="Required facilities" options={FACILITIES} values={filters.facilities} onChange={(value) => updateFilter("facilities", value)} />
          <ToggleList label="Accessibility features" options={ACCESSIBILITY_OPTIONS} values={filters.accessibility} onChange={(value) => updateFilter("accessibility", value)} />
          <div className="cs-filter-chips">
            {chips.map((item) => <span className="cs-chip" key={item.key}>{chipLabel(item)}</span>)}
            {(chips.length > 0 || windowSet) && <button type="button" className="cs-btn cs-btn-ghost" onClick={clearAll}>Clear filters</button>}
          </div>
        </div>}
      </section>
      <p className="cs-result-count" aria-live="polite">{listed.length} venue{listed.length === 1 ? "" : "s"}</p>
      {windowPrefill && shortlist.count === 0 && chips.length === 0 && (
        <div className="cs-panel-note" role="status">
          <p>Zero venues match this event.</p>
          <ul>
            <li>Occupied for the requested window: {shortlist.excluded.occupied} excluded</li>
            <li>Capacity below expected attendance: {shortlist.excluded.capacity_below} excluded</li>
          </ul>
        </div>
      )}
      {bookingNotice && <p className="cs-error" role="alert">{bookingNotice}</p>}
      <VenueRows
        venues={listed}
        selectedId={selected?.venue_id}
        onSelect={(venue) => setSelected((current) => current?.venue_id === venue.venue_id ? null : venue)}
        /* E8 — the shortlist only offers venues that already fit, so booking one
           from here carries both choices straight to the booking screen. The
           suitability gate still runs there; this route simply never trips it. */
        renderActions={event && onBookVenue
          ? (venue) => <button type="button" className="cs-btn cs-btn-primary cs-record-btn" onClick={() => {
            const raised = existingBookingFor(bookings, { eventId: event.id || event.event_id, venueId: venue.venue_id });
            if (raised) {
              setBookingNotice(`${venue.name} already has a ${String(raised.status).toLowerCase()} request for this event. Withdraw or wait for that one rather than raising a second.`);
              return;
            }
            setBookingNotice("");
            onBookVenue(event, venue);
          }}>Book venue</button>
          : undefined}
        renderSelected={(venue) => <>
          <VenueDetail venue={venue} />
          <VenueUnavailabilityManager venue={venue} periods={unavailability.filter((period) => period.venue_id === venue.venue_id)} />
        </>}
      />
    </>
  );
}
