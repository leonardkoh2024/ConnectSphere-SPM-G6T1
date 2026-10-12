import React, { useEffect, useState } from "react";
import EquipmentRequestEditor from "./EquipmentRequestEditor";
import EquipmentRequestLines from "./EquipmentRequestLines";
import { listCoordinatorEquipmentEvents } from "./equipmentApi";

export default function EquipmentRequestsScreen({ onNotice }) {
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadEvents = async () => {
    const results = await listCoordinatorEquipmentEvents();
    setEvents(results);
  };

  useEffect(() => {
    loadEvents().catch((loadError) => setError(loadError.message)).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submitted = async () => {
    await loadEvents();
    setSelectedEventId(null);
    onNotice?.("Equipment request submitted to Technical Support.");
  };

  if (loading) return <p className="cs-panel-note">Loading assigned events…</p>;
  if (selectedEventId) return <EquipmentRequestEditor
    eventId={selectedEventId}
    onCancel={() => setSelectedEventId(null)}
    onSubmitted={submitted}
  />;

  return <>
    {error && <p className="cs-error" role="alert">{error}</p>}
    {!events.length
      ? <div className="cs-empty"><p>No active events are assigned to you.</p></div>
      : <div className="cs-record-list">{events.map((event) => {
        const status = event.equipment_request?.status || "Not submitted";
        const locked = event.equipment_request?.has_support_decisions === true || status === "ARRANGED";
        const supportHistory = [...(event.equipment_request?.support_history || [])]
          .sort((left, right) => {
            const leftTime = left.created_at?.toDate?.()?.getTime?.() || new Date(left.created_at || 0).getTime();
            const rightTime = right.created_at?.toDate?.()?.getTime?.() || new Date(right.created_at || 0).getTime();
            return rightTime - leftTime;
          });
        return <article className="cs-record" key={event.id}>
          <div className="cs-record-title"><div><h2>{event.name || "Untitled event"}</h2><p>{event.event_date || "Date not set"}</p></div></div>
          <p className="cs-record-ref">{event.reference_no}</p>
          <div className="cs-record-status"><span className="cs-pill cs-pill-info">{status === "PENDING" ? "Pending" : status}</span></div>
          {event.equipment_request && <div className="cs-record-details cs-equipment-coordinator-summary">
            <details className="cs-equipment-disclosure">
              <summary>Equipment request details</summary>
              <EquipmentRequestLines lines={event.equipment_request.lines} />
            </details>
            {(event.equipment_request.has_support_decisions || supportHistory.length > 0)
              && <details className="cs-equipment-disclosure">
                <summary>Technical Support updates</summary>
                <EquipmentRequestLines lines={event.equipment_request.lines} getStatus={(line) => <>
                  {line.fulfillment_status === "RESERVED"
                    ? "Reserved"
                    : line.fulfillment_status === "RESOLVED"
                      ? `Unable to fulfil: ${line.resolution_reason}`
                      : "Requested"}
                  {line.amendment_note && <><br />Support note: {line.amendment_note}</>}
                </>} />
                {supportHistory.map((item) => <p key={item.id}>
                  {item.action === "LINE_AMENDED"
                    ? `Amended line ${Number(item.line_index) + 1}: ${item.old_values?.equipment_type} ${item.old_values?.quantity} → ${item.new_values?.equipment_type} ${item.new_values?.quantity}. ${item.note}`
                    : item.action === "LINE_UNABLE_TO_FULFILL"
                      ? `Line ${Number(item.line_index) + 1} unable to fulfil: ${item.reason}`
                      : item.action === "LINE_RESERVED"
                        ? `Reserved line ${Number(item.line_index) + 1}: ${item.quantity} ${item.equipment_type.replaceAll("_", " ")}.`
                        : `Reservation released for line ${Number(item.line_index) + 1}: ${item.reason}`}
                  {" "}· {item.actor_id} · {item.created_at?.toDate?.()?.toLocaleString?.() || (item.created_at ? new Date(item.created_at).toLocaleString() : "Time not recorded")}
                </p>)}
              </details>}
            {!event.equipment_request.has_support_decisions && supportHistory.length === 0
              && <details className="cs-equipment-disclosure">
                <summary>Technical Support updates</summary>
                <p>No updates from Technical Support yet.</p>
              </details>}
          </div>}
          <div className="cs-record-actions">
            <button type="button" className="cs-btn cs-btn-secondary cs-record-btn"
              disabled={locked}
              onClick={() => setSelectedEventId(event.id)}>
              {locked
                ? "Technical Support is handling this request"
                : event.equipment_request ? "Edit equipment request" : "Create equipment request"}
            </button>
          </div>
        </article>;
      })}</div>}
  </>;
}
