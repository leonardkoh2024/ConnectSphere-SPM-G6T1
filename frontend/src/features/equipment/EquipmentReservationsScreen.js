import React, { useState } from "react";
import { RESERVATION_STATE_LABEL, reservationGroups } from "../../domain/equipmentCatalogue";
import useEquipmentCatalogue from "./useEquipmentCatalogue";

const STATE_TONE = { UPCOMING: "info", IN_USE: "positive", COMPLETED: "neutral", RELEASED: "neutral" };

const when = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : date.toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
};

function ReservationCard({ reservation, userId }) {
  const eventName = reservation.event_name || `Event ${reservation.event_id}`;
  const type = String(reservation.equipment_type || "").replaceAll("_", " ");
  return <article className="cs-record" aria-label={`${eventName} · ${reservation.equipment_type}`}>
    <div className="cs-record-title"><div>
      <h2>{eventName}</h2>
      <p>{when(reservation.start_datetime)} – {when(reservation.end_datetime)}</p>
    </div></div>
    <p className="cs-record-ref">{reservation.reference_no || "No reference"}</p>
    <div className="cs-record-status">
      <span className={`cs-pill cs-pill-${STATE_TONE[reservation.state]}`}>{RESERVATION_STATE_LABEL[reservation.state]}</span>
    </div>
    <div className="cs-record-modified"><p className="cs-record-saved">
      {reservation.reserved_by === userId ? "Reserved by you" : "Reserved by another Technical Support staff member"}
    </p></div>
    <div className="cs-record-details">
      <p>{type} · {reservation.quantity}</p>
      {reservation.state === "RELEASED" && <p>Release reason: {reservation.release_reason || "Not recorded"}</p>}
    </div>
  </article>;
}

function ReservationGroup({ title, items, empty, userId }) {
  const headingId = `cs-reservations-${title.toLowerCase().replaceAll(" ", "-")}`;
  return <section aria-labelledby={headingId}>
    <h2 className="cs-group-heading" id={headingId}>{title}</h2>
    {items.length
      ? <div className="cs-record-list">{items.map((item) => <ReservationCard key={item.id} reservation={item} userId={userId} />)}</div>
      : <div className="cs-empty"><p>{empty}</p></div>}
  </section>;
}

// `now` is fixed only by tests; the screen otherwise reads the clock.
export default function EquipmentReservationsScreen({ now }) {
  const { catalogue, error, loading } = useEquipmentCatalogue();
  const [onlyMine, setOnlyMine] = useState(false);

  if (loading) return <p className="cs-panel-note">Loading reservations…</p>;
  if (error) return <p className="cs-error" role="alert">{error}</p>;

  const groups = reservationGroups(catalogue.reservations, {
    now: now || new Date(),
    onlyReservedBy: onlyMine ? catalogue.userId : null
  });
  return <>
    <label className="cs-check">
      <input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} />
      Only reservations I made
    </label>
    <ReservationGroup title="Current reservations" items={groups.current} empty="No current reservations." userId={catalogue.userId} />
    <ReservationGroup title="Past reservations" items={groups.past} empty="No past reservations." userId={catalogue.userId} />
  </>;
}
