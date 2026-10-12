import React, { useEffect, useState } from "react";
import EquipmentRequestEditor from "./EquipmentRequestEditor";
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
        return <article className="cs-record" key={event.id}>
          <div className="cs-record-title"><div><h2>{event.name || "Untitled event"}</h2><p>{event.event_date || "Date not set"}</p></div></div>
          <p className="cs-record-ref">{event.reference_no}</p>
          <div className="cs-record-status"><span className="cs-pill cs-pill-info">{status === "PENDING" ? "Pending" : status}</span></div>
          <div className="cs-record-actions">
            <button type="button" className="cs-btn cs-btn-secondary cs-record-btn"
              onClick={() => setSelectedEventId(event.id)}>
              {event.equipment_request ? "Edit equipment request" : "Create equipment request"}
            </button>
          </div>
        </article>;
      })}</div>}
  </>;
}
