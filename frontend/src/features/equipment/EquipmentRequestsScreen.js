import React, { useEffect, useState } from "react";
import EquipmentRequestEditor from "./EquipmentRequestEditor";
import { listCoordinatorEquipmentEvents } from "./equipmentApi";
import { equipmentRequestStatus, equipmentTypeLabel, equipmentUpdateText } from "../../domain/eventEquipment";

const timeOf = (value) => value?.toDate?.()?.getTime?.() || new Date(value || 0).getTime();
const shownTime = (value) => value
  ? new Date(timeOf(value)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
  : "Time not recorded";

// Each line in the coordinator's words: Reserved, Unable to fulfil, or Requested.
const lineStatusOf = (line) => {
  if (line.fulfillment_status === "RESERVED") return { label: "Reserved", tone: "positive" };
  if (line.fulfillment_status === "RESOLVED") return { label: "Unable to fulfil", tone: "danger" };
  return { label: "Requested", tone: "warning" };
};

// J6 AC4 — `focusEventId`, from an equipment outcome notification, opens that
// event's Technical Support updates, scrolled into view. `onViewEvent` opens a
// request Technical Support has finished on the event's Arrangements tab.
export default function EquipmentRequestsScreen({ onNotice, focusEventId = null, onViewEvent }) {
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

  useEffect(() => {
    if (loading || !focusEventId) return;
    document.getElementById(`equipment-request-${focusEventId}`)?.scrollIntoView?.({ block: "start" });
  }, [loading, focusEventId]);

  // J5 / SCRUM-154 — `notified: false` means the request is saved but the equipment
  // service could not be asked to tell Technical Support; saving again retries.
  const submitted = async ({ notified = true } = {}) => {
    await loadEvents();
    setSelectedEventId(null);
    onNotice?.(notified
      ? "Equipment request submitted to Technical Support."
      : "Equipment request saved, but Technical Support could not be notified. Open it and submit again to retry.");
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
        const request = event.equipment_request;
        const status = equipmentRequestStatus(request);
        // Finished by Technical Support: every line reserved or refused.
        const done = request?.status === "ARRANGED";
        const locked = request?.has_support_decisions === true || done;
        const supportHistory = [...(request?.support_history || [])]
          .sort((left, right) => timeOf(right.created_at) - timeOf(left.created_at));
        const focused = event.id === focusEventId;
        const timeWindow = event.start_time && event.end_time ? ` · ${event.start_time}–${event.end_time}` : "";
        return <article className="cs-record cs-equipment-request" key={event.id} id={`equipment-request-${event.id}`}>
          <div className="cs-record-title"><div><h2>{event.name || "Untitled event"}</h2><p>{event.event_date || "Date not set"}{timeWindow}</p></div></div>
          <p className="cs-record-ref">{event.reference_no}</p>
          <div className="cs-record-status"><span className={`cs-pill cs-pill-${status.tone}`}>{status.label}</span></div>
          <div className="cs-record-actions">
            {done && onViewEvent
              ? <button type="button" className="cs-btn cs-btn-secondary cs-record-btn" onClick={() => onViewEvent(event.id)}>View details</button>
              : <button type="button" className="cs-btn cs-btn-secondary cs-record-btn"
                disabled={locked}
                onClick={() => setSelectedEventId(event.id)}>
                {locked
                  ? "Technical Support is handling this request"
                  : request ? "Edit equipment request" : "Create equipment request"}
              </button>}
          </div>
          {request && <div className="cs-record-details cs-equipment-coordinator-summary">
            <ul className="cs-equipment-line-list" aria-label="Requested equipment">
              {(request.lines || []).map((line, index) => {
                const lineStatus = lineStatusOf(line);
                return <li key={index}>
                  <span className="cs-equipment-line-name">{equipmentTypeLabel(line.equipment_type)} × {Number(line.quantity) || 1}</span>
                  <span className={`cs-pill cs-pill-${lineStatus.tone}`}>{lineStatus.label}</span>
                  {line.technical_requirements && <span className="cs-equipment-line-note">{line.technical_requirements}</span>}
                  {line.resolution_reason && <span className="cs-equipment-line-note">Reason: {line.resolution_reason}</span>}
                  {line.amendment_note && <span className="cs-equipment-line-note">Support note: {line.amendment_note}</span>}
                </li>;
              })}
            </ul>
            <details className="cs-equipment-disclosure" open={focused || undefined}>
              <summary>Technical Support updates{supportHistory.length ? ` (${supportHistory.length})` : ""}</summary>
              {supportHistory.length
                ? <ul className="cs-equipment-updates">
                  {supportHistory.map((item) => <li key={item.id}>
                    <span>{equipmentUpdateText(item)}</span>
                    <span className="cs-equipment-line-note">Technical Support · {shownTime(item.created_at)}</span>
                  </li>)}
                </ul>
                : <p>No updates from Technical Support yet.</p>}
            </details>
          </div>}
        </article>;
      })}</div>}
  </>;
}
