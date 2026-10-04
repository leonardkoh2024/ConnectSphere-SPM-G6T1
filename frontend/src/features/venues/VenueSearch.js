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
import VenueSuitabilityForm from "./VenueSuitabilityForm";

const chipLabel = (item) => {
  if (item.key === "location") return item.value.replaceAll("_", " ");
  if (item.key === "layout") return String(item.value).replaceAll("_", " ");
  if (item.key === "capacity_range") {
    const [min, max] = item.value;
    if (min != null && max != null) return `${min}–${max} pax`;
    if (min != null) return `${min}+ pax`;
    return `Up to ${max} pax`;
  }
  if (item.key === "facilities") return item.value.map((value) => value.replaceAll("_", " ")).join(", ");
  if (item.key === "accessibility") return item.value.map((value) => value.replaceAll("_", " ")).join(", ");
  return String(item.value);
};

export default function VenueSearch({ event, onBookVenue, role = ROLES.COORDINATOR, showCalendar = false, onCloseCalendar }) {
  const [catalogue, setCatalogue] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [unavailability, setUnavailability] = useState([]);
  // Opened from an event, the shortlist starts narrowed to what that event asked
  // for; opened from the sidebar, it starts as the whole catalogue.
  const [filters, setFilters] = useState(() => (event ? prefillFilters(event) : emptyFilters()));
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [bookingNotice, setBookingNotice] = useState("");
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

  const windowPrefill = event ? prefillSearch(event) : null;
  const shortlist = useMemo(() => {
    if (!windowPrefill) return { matches: catalogue, count: catalogue.length, excluded: null };
    return searchVenues({ venues: catalogue, window: windowPrefill, bookings, unavailability });
  }, [catalogue, bookings, unavailability, windowPrefill]);

  // The coordinator's only venue screen: the whole catalogue A–Z until an event
  // or a filter narrows it.
  const shown = applyFilters(shortlist.matches, filters)
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" }));
  const chips = activeFilters(filters);

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
      <VenueSuitabilityForm venues={catalogue} event={event} />
      <section className="cs-form-section" aria-label="Narrow the shortlist">
        <h2>Filters</h2>
        <div className="cs-form-grid">
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
          {chips.length > 0 && <button type="button" className="cs-btn cs-btn-ghost" onClick={() => setFilters(emptyFilters())}>Clear filters</button>}
        </div>
      </section>
      <p className="cs-result-count" aria-live="polite">{shown.length} venue{shown.length === 1 ? "" : "s"}</p>
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
        venues={shown}
        selectedId={selected?.venue_id}
        onSelect={setSelected}
        /* E8 — the shortlist only offers venues that already fit, so booking one
           from here carries both choices straight to the booking screen. The
           suitability gate still runs there; this route simply never trips it. */
        renderActions={event && onBookVenue
          ? (venue) => <button type="button" className="cs-btn cs-btn-primary cs-record-btn" onClick={() => {
            const raised = existingBookingFor(bookings, { eventId: event.id || event.event_id, venueId: venue.venue_id });
            if (raised) {
              setBookingNotice(`${venue.name} already has a ${String(raised.status || "").toLowerCase()} request for this event. Withdraw or wait for that one rather than raising a second.`);
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
