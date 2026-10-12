import React, { useEffect, useState } from "react";
import { listPendingEquipmentRequests } from "./equipmentApi";

export default function EquipmentQueueScreen() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    listPendingEquipmentRequests()
      .then((items) => { if (mounted) setRequests(items); })
      .catch((loadError) => { if (mounted) setError(loadError.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  if (loading) return <p className="cs-panel-note">Loading equipment queue…</p>;
  if (error) return <p className="cs-error" role="alert">{error}</p>;
  if (!requests.length) return <div className="cs-empty"><p>No pending equipment requests.</p></div>;

  return <div className="cs-record-list">{requests.map((request) => (
    <article className="cs-record" key={request.id}>
      <div className="cs-record-title"><div><h2>{request.event_name || "Untitled event"}</h2><p>{request.event_date || "Date not set"} · {request.start_time || "Time not set"}–{request.end_time || "Time not set"}</p></div></div>
      <p className="cs-record-ref">{request.reference_no}</p>
      <div className="cs-record-status"><span className="cs-pill cs-pill-warning">Pending</span></div>
      <div className="cs-record-details">
        {request.lines.map((line, index) => <p key={`${request.id}-${index}`}>
          {line.equipment_type.replaceAll("_", " ")} · {line.quantity}
          {line.technical_requirements ? ` · ${line.technical_requirements}` : ""}
        </p>)}
        <p>Expected attendance: {request.expected_attendance ?? "Not recorded"}</p>
      </div>
    </article>
  ))}</div>;
}
