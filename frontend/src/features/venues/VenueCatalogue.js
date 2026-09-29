import React, { useEffect, useState } from "react";
import { listCatalogue } from "../../domain/venueSearch";
import { loadVenueCatalogue } from "./venuesApi";
import VenueDetail, { VenueRows } from "./VenueDetail";

export default function VenueCatalogue() {
  const [venues, setVenues] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    loadVenueCatalogue()
      .then((rows) => { if (mounted) setVenues(rows); })
      .catch((loadError) => { if (mounted) setError(loadError.message || "The venue catalogue could not be loaded."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  if (loading) return <p className="cs-panel-note">Loading venue catalogue…</p>;
  if (error) return <p className="cs-error">{error}</p>;

  const listed = listCatalogue(venues).map((row) => {
    const full = venues.find((item) => item.venue_id === row.venue_id);
    return { ...full, ...row, facilities: row.headline_facilities };
  });

  return (
    <>
      <p className="cs-result-count" aria-live="polite">{listed.length} venue{listed.length === 1 ? "" : "s"}</p>
      <VenueRows venues={listed} selectedId={selected?.venue_id} onSelect={setSelected} />
      {selected && <VenueDetail venue={selected} />}
    </>
  );
}
