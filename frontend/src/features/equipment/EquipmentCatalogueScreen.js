import React from "react";
import { catalogueRows } from "../../domain/equipmentCatalogue";
import useEquipmentCatalogue from "./useEquipmentCatalogue";

const typeName = (type) => type.replaceAll("_", " ");

const freePill = (row) => {
  if (row.freeNow === null) return <span className="cs-pill cs-pill-neutral">Stock not recorded</span>;
  if (row.freeNow === 0) return <span className="cs-pill cs-pill-warning">None free now</span>;
  return <span className="cs-pill cs-pill-positive">{row.freeNow} free now</span>;
};

// `now` is fixed only by tests; the screen otherwise reads the clock.
export default function EquipmentCatalogueScreen({ now }) {
  const { catalogue, error, loading } = useEquipmentCatalogue();

  if (loading) return <p className="cs-panel-note">Loading the equipment catalogue…</p>;
  if (error) return <p className="cs-error" role="alert">{error}</p>;

  const rows = catalogueRows({ ...catalogue, now: now || new Date() });
  return <div className="cs-record-list">{rows.map((row) => (
    <article className="cs-record" key={row.equipmentType} aria-label={row.equipmentType}>
      <div className="cs-record-title"><div><h2>{typeName(row.equipmentType)}</h2></div></div>
      <p className="cs-record-ref">Held: {row.held === null ? "Not recorded" : row.held}</p>
      <div className="cs-record-status">{freePill(row)}</div>
      <div className="cs-record-details">
        <p>Reserved now: {row.reservedNow} · Unavailable now: {row.unavailableNow} · Upcoming reservations: {row.upcoming}</p>
      </div>
    </article>
  ))}</div>;
}
