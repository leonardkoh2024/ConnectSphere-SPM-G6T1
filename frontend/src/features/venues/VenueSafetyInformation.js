import React, { useEffect, useState } from "react";
import { loadVenueSafetyCatalogue } from "./venuesApi";

export default function VenueSafetyInformation() {
  const [venues, setVenues] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    loadVenueSafetyCatalogue()
      .then((rows) => { if (mounted) setVenues(rows); })
      .catch((failure) => { if (mounted) setError(failure.message || "Venue safety information could not be loaded."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  if (loading) return <p className="cs-panel-note">Loading venue safety information…</p>;
  if (error) return <p className="cs-error" role="alert">{error}</p>;
  if (!venues.length) return <p className="cs-panel-note">No venue safety information is available.</p>;

  return (
    <div className="cs-record-list" aria-label="Venue safety information">
      {venues.map((venue) => {
        const expanded = selectedId === venue.venue_id;
        const detailsId = `venue-safety-${venue.venue_id}`;
        return (
          <article className="cs-record" key={venue.venue_id}>
            <div className="cs-record-title"><h2>{venue.name}</h2><p>{venue.building || "Building not recorded"}</p></div>
            <p className="cs-record-ref">{venue.location || "Location not recorded"}</p>
            <div className="cs-record-actions">
              <button
                type="button"
                className="cs-btn cs-btn-ghost cs-record-btn"
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => setSelectedId(expanded ? "" : venue.venue_id)}
              >
                {expanded ? "Close" : "View safety information"}
              </button>
            </div>
            {expanded && (
              <dl className="cs-detail-grid cs-record-expanded" id={detailsId}>
                <div><dt>Maximum capacity</dt><dd>{venue.max_capacity || "Not recorded"}</dd></div>
                <div className="cs-detail-wide"><dt>Emergency access notes</dt><dd>{venue.emergency_access_notes || "None recorded"}</dd></div>
                <div className="cs-detail-wide"><dt>Known restrictions</dt><dd>{venue.known_restrictions || "None recorded"}</dd></div>
              </dl>
            )}
          </article>
        );
      })}
    </div>
  );
}
