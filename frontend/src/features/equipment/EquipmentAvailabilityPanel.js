import React, { useState } from "react";
import { EQUIPMENT_TYPES } from "../../domain/events";
import {
  amendEquipmentRequestLine,
  checkEquipmentAvailability,
  markEquipmentLineUnableToFulfill,
  releaseEquipmentReservation,
  reserveEquipmentForEvent
} from "./equipmentApi";
import EquipmentRequestLines from "./EquipmentRequestLines";

const eventWindow = (request) => {
  const date = request.event_date;
  const start = request.start_time;
  const end = request.end_time;
  if (!date || !start || !end) throw new Error("This request has no complete event date and time window.");
  return {
    windowStart: `${date}T${start}:00+08:00`,
    windowEnd: `${date}T${end}:00+08:00`
  };
};

const activeReservation = (request, equipmentType, lineIndex) => request.reservations?.find((reservation) =>
  reservation.equipment_type === equipmentType
  && (reservation.line_index === lineIndex || reservation.line_index == null)
  && ["RESERVED", "APPROVED"].includes(String(reservation.status || "").toUpperCase())
);

export default function EquipmentAvailabilityPanel({ requests, onUpdated }) {
  const [quantities, setQuantities] = useState({});
  const [results, setResults] = useState({});
  const [reservations, setReservations] = useState({});
  const [notes, setNotes] = useState({});
  const [decisions, setDecisions] = useState({});

  const lineKey = (request, index) => `${request.id}-${index}`;

  const checkRequest = async (request) => {
    setResults((current) => ({
      ...current,
      [request.id]: { loading: true, lines: [], error: "" }
    }));
    try {
      const window = eventWindow(request);
      const lines = await Promise.all(request.lines.map((line, index) =>
        checkEquipmentAvailability({
          equipmentType: line.equipment_type,
          requestedQuantity: quantities[lineKey(request, index)] ?? line.quantity,
          eventId: request.event_id,
          ...window
        })
      ));
      setResults((current) => ({ ...current, [request.id]: { loading: false, lines, error: "" } }));
    } catch (error) {
      setResults((current) => ({ ...current, [request.id]: { loading: false, lines: [], error: error.message } }));
    }
  };

  const reserveLine = async (request, line, index) => {
    const key = lineKey(request, index);
    setReservations((current) => ({
      ...current,
      [key]: { loading: true, error: "", confirmation: "" }
    }));
    try {
      eventWindow(request);
      const quantity = Number(quantities[key] ?? line.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error("Quantity must be a whole number greater than zero.");
      }
      const reservation = await reserveEquipmentForEvent({
        eventId: request.event_id,
        equipmentType: quantities[`${key}-type`] ?? line.equipment_type,
        quantity,
        lineIndex: index
      });
      setReservations((current) => ({
        ...current,
        [key]: {
          ...reservation,
          loading: false,
          error: "",
          confirmation: `${reservation.quantity} ${line.equipment_type.replaceAll("_", " ")} reserved for this event.`
        }
      }));
      onUpdated?.();
    } catch (error) {
      setReservations((current) => ({
        ...current,
        [key]: { loading: false, error: error.message, confirmation: "" }
      }));
    }
  };

  const releaseLine = async (request, reservation, index) => {
    const key = lineKey(request, index);
    setReservations((current) => ({
      ...current,
      [key]: { ...current[key], loading: true, error: "", confirmation: "" }
    }));
    try {
      await releaseEquipmentReservation({ reservationId: reservation.id || reservation.reservation_id });
      setReservations((current) => ({
        ...current,
        [key]: {
          loading: false,
          released: true,
          error: "",
          confirmation: "Reservation released; its quantity is available again."
        }
      }));
      onUpdated?.();
    } catch (error) {
      setReservations((current) => ({
        ...current,
        [key]: { loading: false, error: error.message, confirmation: "" }
      }));
    }
  };

  const amendLine = async (request, line, index) => {
    const key = lineKey(request, index);
    const quantity = Number(quantities[key] ?? line.quantity);
    const equipmentType = quantities[`${key}-type`] ?? line.equipment_type;
    const note = notes[key] || "";
    if (!Number.isInteger(quantity) || quantity < 1) {
      setDecisions((current) => ({ ...current, [key]: { error: "Quantity must be a whole number greater than zero." } }));
      return;
    }
    if (!note.trim()) {
      setDecisions((current) => ({ ...current, [key]: { error: "A note explaining the amendment is required." } }));
      return;
    }
    setDecisions((current) => ({ ...current, [key]: { loading: true, error: "", confirmation: "" } }));
    try {
      await amendEquipmentRequestLine({
        eventId: request.event_id,
        lineIndex: index,
        equipmentType,
        quantity,
        note
      });
      setDecisions((current) => ({
        ...current,
        [key]: { loading: false, error: "", confirmation: "Amendment saved and visible to the coordinator." }
      }));
      onUpdated?.();
    } catch (error) {
      setDecisions((current) => ({ ...current, [key]: { loading: false, error: error.message } }));
    }
  };

  const resolveLine = async (request, index) => {
    const key = lineKey(request, index);
    const reason = notes[`${key}-resolution`] || "";
    if (!reason.trim()) {
      setDecisions((current) => ({
        ...current,
        [key]: { error: "A reason is required when marking a line unable to be fulfilled." }
      }));
      return;
    }
    setDecisions((current) => ({ ...current, [key]: { loading: true, error: "", confirmation: "" } }));
    try {
      const result = await markEquipmentLineUnableToFulfill({
        eventId: request.event_id,
        lineIndex: index,
        reason
      });
      setDecisions((current) => ({
        ...current,
        [key]: {
          loading: false,
          error: "",
          confirmation: result.status === "ARRANGED"
            ? "Line resolved; every request line is now reserved or resolved."
            : "Line marked unable to be fulfilled with reason recorded."
        }
      }));
      onUpdated?.();
    } catch (error) {
      setDecisions((current) => ({ ...current, [key]: { loading: false, error: error.message } }));
    }
  };

  return requests.map((request) => {
    const result = results[request.id];
    return <section className="cs-request-section cs-equipment-availability" key={request.id}
      aria-label={`${request.event_name || "Event"} equipment availability`}>
      <button type="button" className="cs-btn cs-btn-secondary"
        disabled={result?.loading} onClick={() => checkRequest(request)}>
        {result?.loading ? "Checking availability…" : result ? "Refresh availability" : "Check availability"}
      </button>
      {result?.error && <p className="cs-error" role="alert">{result.error}</p>}
      <details className="cs-equipment-disclosure">
        <summary>Request details</summary>
        <EquipmentRequestLines lines={request.lines} getStatus={(line, index) => {
          const availability = result?.lines?.[index];
          if (!availability) return null;
          return <>
            {availability.freeQuantity} free of {availability.heldQuantity}
            {" "}({availability.heldQuantity} held − {availability.reservedQuantity} reserved − {availability.unavailableQuantity} unavailable).
            {availability.available
              ? ` Requested ${availability.requestedQuantity}; no shortfall.`
              : ` Requested ${availability.requestedQuantity}; shortfall ${availability.shortfall}.`}
          </>;
        }} />
      </details>
      {request.lines.map((line, index) => {
        const key = lineKey(request, index);
        const localReservation = reservations[key];
        const reservation = reservations[key]?.released
          ? null
          : localReservation?.id ? localReservation : activeReservation(request, line.equipment_type, index);
        const reservationAction = reservations[key];
        const decision = decisions[key];
        const fulfilled = ["RESERVED", "RESOLVED"].includes(line.fulfillment_status);
        return <div className="cs-request-line" key={key}>
          <div className="cs-equipment-line-fields">
            <label className="cs-field">
              <span className="cs-field-name">{line.equipment_type.replaceAll("_", " ")} quantity</span>
              <input type="number" min="1" step="1"
                value={quantities[key] ?? line.quantity}
                disabled={fulfilled}
                onChange={(event) => setQuantities((current) => ({ ...current, [key]: event.target.value }))} />
            </label>
            {!fulfilled && <label className="cs-field">
              <span className="cs-field-name">Equipment type</span>
              <select aria-label={`Substitute equipment type ${index + 1}`}
                value={quantities[`${key}-type`] ?? line.equipment_type}
                onChange={(event) => setQuantities((current) => ({ ...current, [`${key}-type`]: event.target.value }))}>
                {EQUIPMENT_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
              </select>
            </label>}
            {!fulfilled && <label className="cs-field">
              <span className="cs-field-name">Amendment note</span>
              <textarea rows="2" value={notes[key] || ""}
                onChange={(event) => setNotes((current) => ({ ...current, [key]: event.target.value }))} />
            </label>}
          </div>
          {fulfilled && line.fulfillment_status === "RESOLVED"
            ? <p className="cs-attention" role="status">
              Unable to fulfil: {line.resolution_reason} · {line.resolved_by}
            </p>
            : reservation
            ? <div>
              <p className="cs-success" role="status">
                {reservationAction?.confirmation
                  || `Reserved: ${reservation.quantity} ${line.equipment_type.replaceAll("_", " ")} for this event.`}
              </p>
              <button type="button" className="cs-btn cs-btn-secondary"
                disabled={reservationAction?.loading}
                onClick={() => releaseLine(request, reservation, index)}>
                {reservationAction?.loading ? "Releasing…" : "Release reservation"}
              </button>
            </div>
            : fulfilled
              ? <p className="cs-success" role="status">Reserved for this event.</p>
              : <div className="cs-equipment-line-actions">
                <button type="button" className="cs-btn cs-btn-secondary"
                  disabled={decision?.loading} onClick={() => amendLine(request, line, index)}>
                  {decision?.loading ? "Saving…" : "Save amendment"}
                </button>
                <button type="button" className="cs-btn cs-btn-primary"
                  disabled={reservationAction?.loading || decision?.loading}
                  onClick={() => reserveLine(request, line, index)}>
                  {reservationAction?.loading ? "Reserving…" : "Reserve equipment"}
                </button>
              </div>}
          {!fulfilled && <div className="cs-equipment-resolve">
            <label className="cs-field">
              <span className="cs-field-name">Reason unable to fulfil</span>
              <textarea rows="2" value={notes[`${key}-resolution`] || ""}
                onChange={(event) => setNotes((current) => ({ ...current, [`${key}-resolution`]: event.target.value }))} />
            </label>
            <button type="button" className="cs-btn cs-btn-ghost"
              disabled={decision?.loading} onClick={() => resolveLine(request, index)}>
              Mark unable to fulfil
            </button>
          </div>}
          {decision?.error && <p className="cs-error" role="alert">{decision.error}</p>}
          {decision?.confirmation && <p className="cs-success" role="status">{decision.confirmation}</p>}
          {reservationAction?.error && <p className="cs-error" role="alert">{reservationAction.error}</p>}
          {!reservation && reservationAction?.confirmation
            && <p className="cs-success" role="status">{reservationAction.confirmation}</p>}
        </div>;
      })}
    </section>;
  });
}
