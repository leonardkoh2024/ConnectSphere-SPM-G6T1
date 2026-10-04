import React, { useEffect, useMemo, useState } from "react";
import { ACCESSIBILITY_OPTIONS, FACILITIES, LAYOUTS, PREFERRED_LOCATIONS } from "../../domain/events";
import {
  activeFilters,
  applyFilters,
  emptyFilters,
  prefillSearch,
  searchVenues
} from "../../domain/venueSearch";
import ToggleList from "../events/components/ToggleList";
import { loadVenueSearchContext } from "./venuesApi";
import VenueDetail, { VenueRows } from "./VenueDetail";
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

export default function VenueSearch({ event }) {
  const [catalogue, setCatalogue] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [unavailability, setUnavailability] = useState([]);
  const [filters, setFilters] = useState(emptyFilters());
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
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
      .catch((loadError) => { if (mounted) setError(loadError.message || "Venue search could not be loaded."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const windowPrefill = event ? prefillSearch(event) : null;
  const shortlist = useMemo(() => {
    if (!windowPrefill) return { matches: catalogue, count: catalogue.length, excluded: null };
    return searchVenues({ venues: catalogue, window: windowPrefill, bookings, unavailability });
  }, [catalogue, bookings, unavailability, windowPrefill]);

  const shown = applyFilters(shortlist.matches, filters);
  const chips = activeFilters(filters);

  const updateFilter = (field, value) => setFilters((current) => ({ ...current, [field]: value }));
  const toNumber = (value) => (value === "" ? null : Number(value));

  if (loading) return <p className="cs-panel-note">Loading venues…</p>;
  if (error) return <p className="cs-error">{error}</p>;

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
      <VenueRows
        venues={shown}
        selectedId={selected?.venue_id}
        onSelect={setSelected}
        renderSelected={(venue) => <VenueDetail venue={venue} />}
      />
    </>
  );
}
