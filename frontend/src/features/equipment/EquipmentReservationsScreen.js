import React, { useState } from "react";
import { RESERVATION_STATE_LABEL, reservationGroups } from "../../domain/equipmentCatalogue";
import {
  amendEquipmentReservation,
  keepEquipmentReservation,
  recheckEquipmentReassessment,
  releaseEquipmentReservation
} from "./equipmentApi";
import useEquipmentCatalogue from "./useEquipmentCatalogue";

const STATE_TONE = { UPCOMING: "info", IN_USE: "positive", COMPLETED: "neutral", RELEASED: "neutral" };

// A missing date must not read as 1 January 1970, which is what new Date(null) gives.
const when = (value) => {
  const date = value == null || value === "" ? new Date(NaN) : new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : date.toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
};

const DEFAULT_RELEASE_REASON = "Released after the event changed";

// G6 / SCRUM-138 — what Technical Support can do with a reservation I3 flagged after a
// significant change. Nothing here runs until a button is pressed: the reservation stays
// reserved while it waits (AC2). Re-check measures the event's new window; Keep, Amend and
// Release each end with the list read again, so the card leaves "Needs reassessment".
function ReassessmentActions({ reservation, reload }) {
  const [checked, setChecked] = useState(null);
  const [note, setNote] = useState("");
  const [quantity, setQuantity] = useState(String(reservation.quantity));
  const [amendNote, setAmendNote] = useState("");
  const [releaseReason, setReleaseReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (action) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError.message);
      setBusy(false);
      return;
    }
    if (!(await reload())) setError("Saved, but the list could not be refreshed. Reload the page to see it.");
    setBusy(false);
  };

  const recheck = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await recheckEquipmentReassessment({ eventId: reservation.event_id });
      const line = result.lines.find((item) => item.reservationId === reservation.id);
      setChecked({ windowStart: result.windowStart, windowEnd: result.windowEnd, line });
    } catch (checkError) {
      setError(checkError.message);
    }
    setBusy(false);
  };

  const amend = () => {
    if (!amendNote.trim()) { setError("A note explaining the amendment is required."); return; }
    const wanted = Number(quantity);
    if (quantity === "" || !Number.isInteger(wanted) || wanted < 1) {
      setError("Quantity must be a whole number greater than zero.");
      return;
    }
    run(() => amendEquipmentReservation({ reservationId: reservation.id, quantity: wanted, note: amendNote.trim() }));
  };

  return <div className="cs-record-details cs-equipment-reassess">
    <p>Reason for reassessment: {reservation.rerequest_reason}</p>
    <button type="button" className="cs-btn cs-btn-secondary" disabled={busy} onClick={recheck}>
      {checked ? "Refresh availability" : "Re-check availability"}
    </button>
    {checked && <>
      <p>New window: {when(checked.windowStart)} – {when(checked.windowEnd)}</p>
      {checked.line && <p>{checked.line.available
        ? `${checked.line.freeQuantity} free in the new window; no shortfall.`
        : `${checked.line.freeQuantity} free in the new window; shortfall ${checked.line.shortfall}.`}</p>}
    </>}
    <label className="cs-field">
      <span className="cs-field-name">Note (optional)</span>
      <input type="text" value={note} onChange={(event) => setNote(event.target.value)} />
    </label>
    <button type="button" className="cs-btn cs-btn-primary" disabled={busy}
      onClick={() => run(() => keepEquipmentReservation({ reservationId: reservation.id, note: note.trim() }))}>
      Keep reservation
    </button>
    <label className="cs-field">
      <span className="cs-field-name">New quantity</span>
      <input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
    </label>
    <label className="cs-field">
      <span className="cs-field-name">Amendment note</span>
      <textarea rows="2" value={amendNote} onChange={(event) => setAmendNote(event.target.value)} />
    </label>
    <button type="button" className="cs-btn cs-btn-secondary" disabled={busy} onClick={amend}>
      Amend reservation
    </button>
    <label className="cs-field">
      <span className="cs-field-name">Release reason</span>
      <input type="text" value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} />
    </label>
    <button type="button" className="cs-btn cs-btn-ghost" disabled={busy}
      onClick={() => run(() => releaseEquipmentReservation({
        reservationId: reservation.id,
        reason: releaseReason.trim() || DEFAULT_RELEASE_REASON
      }))}>
      Release reservation
    </button>
    {error && <p className="cs-error" role="alert">{error}</p>}
  </div>;
}

function ReservationCard({ reservation, userId, children }) {
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
      {reservation.state === "RELEASED" && <>
        <p>Release reason: {reservation.release_reason || "Not recorded"}</p>
        <p>Release time: {when(reservation.released_at)}</p>
      </>}
    </div>
    {children}
  </article>;
}

function ReservationGroup({ title, items, empty, userId, actions }) {
  const headingId = `cs-reservations-${title.toLowerCase().replaceAll(" ", "-")}`;
  return <section aria-labelledby={headingId}>
    <h2 className="cs-group-heading" id={headingId}>{title}</h2>
    {items.length
      ? <div className="cs-record-list">{items.map((item) =>
        <ReservationCard key={item.id} reservation={item} userId={userId}>{actions?.(item)}</ReservationCard>)}</div>
      : <div className="cs-empty"><p>{empty}</p></div>}
  </section>;
}

// `now` is fixed only by tests; the screen otherwise reads the clock.
export default function EquipmentReservationsScreen({ now }) {
  const { catalogue, error, loading, reload } = useEquipmentCatalogue();
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
    {groups.reassess.length > 0 && <ReservationGroup title="Needs reassessment" items={groups.reassess}
      userId={catalogue.userId} actions={(item) => <ReassessmentActions reservation={item} reload={reload} />} />}
    <ReservationGroup title="Current reservations" items={groups.current} empty="No current reservations." userId={catalogue.userId} />
    <ReservationGroup title="Past reservations" items={groups.past} empty="No past reservations." userId={catalogue.userId} />
  </>;
}
