import React, { useState } from "react";
import {
  checkEquipmentAvailability,
  releaseEquipmentReservation,
  reserveEquipmentForEvent
} from "./equipmentApi";

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

const activeReservation = (request, equipmentType) => request.reservations?.find((reservation) =>
  reservation.equipment_type === equipmentType
  && ["RESERVED", "APPROVED"].includes(String(reservation.status || "").toUpperCase())
);

export default function EquipmentAvailabilityPanel({ requests }) {
  const [quantities, setQuantities] = useState({});
  const [results, setResults] = useState({});
  const [reservations, setReservations] = useState({});

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
        equipmentType: line.equipment_type,
        quantity
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
    } catch (error) {
      setReservations((current) => ({
        ...current,
        [key]: { loading: false, error: error.message, confirmation: "" }
      }));
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
      {request.lines.map((line, index) => {
        const key = lineKey(request, index);
        const availability = result?.lines?.[index];
        const localReservation = reservations[key];
        const reservation = reservations[key]?.released
          ? null
          : localReservation?.id ? localReservation : activeReservation(request, line.equipment_type);
        const reservationAction = reservations[key];
        return <div className="cs-request-line" key={key}>
          <label className="cs-field">
            <span className="cs-field-name">{line.equipment_type.replaceAll("_", " ")} quantity</span>
            <input type="number" min="1" step="1"
              value={quantities[key] ?? line.quantity}
              onChange={(event) => setQuantities((current) => ({ ...current, [key]: event.target.value }))} />
          </label>
          {availability && <p>
            <strong>{availability.equipmentType.replaceAll("_", " ")}</strong>: {availability.freeQuantity} free of {availability.heldQuantity}
            {" "}({availability.heldQuantity} held − {availability.reservedQuantity} reserved − {availability.unavailableQuantity} unavailable).
            {availability.available
              ? ` Requested ${availability.requestedQuantity}; no shortfall.`
              : ` Requested ${availability.requestedQuantity}; shortfall ${availability.shortfall}.`}
          </p>}
          {reservation
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
            : <button type="button" className="cs-btn cs-btn-primary"
              disabled={reservationAction?.loading}
              onClick={() => reserveLine(request, line, index)}>
              {reservationAction?.loading ? "Reserving…" : "Reserve equipment"}
            </button>}
          {reservationAction?.error && <p className="cs-error" role="alert">{reservationAction.error}</p>}
          {!reservation && reservationAction?.confirmation
            && <p className="cs-success" role="status">{reservationAction.confirmation}</p>}
        </div>;
      })}
    </section>;
  });
}
