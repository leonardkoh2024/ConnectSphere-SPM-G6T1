import React from "react";
import { PREFERRED_LOCATIONS } from "../../domain/events";
import { facilitiesLabel, venueRecord } from "../../domain/venueSearch";

const locationLabel = (value) =>
  PREFERRED_LOCATIONS.find((item) => item.value === value)?.label || value || "Location not set";

const word = (value) => String(value || "").replaceAll("_", " ");

export default function VenueDetail({ venue }) {
  const record = venueRecord(venue);
  return (
    <section className="cs-venue-detail" aria-label="Venue record">
      <h2>{record.name}</h2>
      <dl className="cs-detail-grid">
        <div><dt>Building</dt><dd>{venue.building || "Not set"}</dd></div>
        <div><dt>Location</dt><dd>{locationLabel(record.location)}</dd></div>
        <div><dt>Capacity</dt><dd>{record.max_capacity}</dd></div>
        <div className="cs-detail-wide"><dt>Headline facilities</dt><dd>{facilitiesLabel(record.headline_facilities)}</dd></div>
        <div className="cs-detail-wide"><dt>Layouts</dt><dd>{record.layouts.length ? record.layouts.map(word).join(", ") : "None listed"}</dd></div>
        <div className="cs-detail-wide"><dt>Accessibility</dt><dd>{record.accessibility.length ? record.accessibility.map(word).join(", ") : "None listed"}</dd></div>
        {/* A venue can open on most days, so each one gets its own line rather
            than a semicolon-separated run that wraps unreadably. */}
        <div className="cs-detail-wide"><dt>Operating hours</dt><dd>{record.operating_hours.length
          ? <span className="cs-detail-lines">{record.operating_hours.map((row) => (
            <span key={`${row.weekday}-${row.opens_at}`}>{word(row.weekday)} {row.opens_at}–{row.closes_at}</span>
          ))}</span>
          : "None listed"}</dd></div>
        <div className="cs-detail-wide"><dt>Space availability for special requirements</dt><dd>{venue.special_space_availability || "None listed"}</dd></div>
      </dl>
    </section>
  );
}

export function VenueRows({ venues, selectedId, onSelect, onUpdate = onSelect, canEdit = () => false, renderSelected, renderActions }) {
  const rows = venues;
  if (!rows.length) return <p className="cs-panel-note">No venues match the current criteria.</p>;
  return (
    <div className="cs-record-list">
      {rows.map((venue) => (
        <article className="cs-record" key={venue.venue_id}>
          <div className="cs-record-title">
            <div>
              <h2>{venue.name}</h2>
              <p>{locationLabel(venue.location)}</p>
            </div>
          </div>
          <p className="cs-record-ref">Capacity {venue.max_capacity}</p>
          <div className="cs-record-modified">
            <p className="cs-record-saved">{facilitiesLabel(venue.facilities)}</p>
          </div>
          <div className="cs-record-actions">
            <button
              type="button"
              className={`cs-btn ${canEdit(venue) ? "cs-btn-update" : "cs-btn-ghost"} cs-record-btn`}
              aria-pressed={selectedId === venue.venue_id}
              onClick={() => canEdit(venue) ? onUpdate(venue) : onSelect(venue)}
            >
              {canEdit(venue) ? "Update venue" : "View venue"}
            </button>
            {renderActions && renderActions(venue)}
          </div>
          {selectedId === venue.venue_id && renderSelected && <div className="cs-record-expanded">{renderSelected(venue)}</div>}
        </article>
      ))}
    </div>
  );
}
