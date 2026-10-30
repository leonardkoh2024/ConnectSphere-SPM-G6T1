// I1 / SCRUM-147 — the organiser's Change requests screen: every change they have asked
// for on a submitted event, where each one stands, and the form to ask for another.
// There is no limit on how many, and no cut-off before the event (AC3). Starting a new
// one is the page header's action (`creating`), as on Venue bookings.

import React, { useEffect, useState } from "react";
import RecordLead from "../../components/RecordLead";
import {
  ACCEPTED, CHANGE_REQUEST_STATUS_LABELS, DECLINED, changeRequestStatusTone, changeValueText, changeableField
} from "../../domain/changeRequests";
import ChangeRequestForm from "./components/ChangeRequestForm";
import { loadChangeableEvents, loadMyChangeRequests } from "./changeRequestsApi";

const shownTime = (value) => (value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Just now");

export function ChangeRequestRecord({ request, children = null }) {
  const changes = Object.entries(request.changes || {});
  const decided = request.status === ACCEPTED || request.status === DECLINED;
  return (
    <article className="cs-record cs-change-record">
      <div className="cs-record-title">
        <RecordLead icon="change" />
        <div>
          <h2>{request.event_name || "Untitled event"}</h2>
          <p>{request.reference_no ? `${request.reference_no} · ` : ""}Requested {shownTime(request.created_at)}</p>
        </div>
      </div>
      <div className="cs-record-status">
        <span className={`cs-pill cs-pill-${changeRequestStatusTone(request.status)}`}>{CHANGE_REQUEST_STATUS_LABELS[request.status] || request.status}</span>
      </div>
      <dl className="cs-detail-grid cs-change-details">
        {changes.map(([field, change]) => (
          <div key={field} className="cs-detail-wide">
            <dt>{changeableField(field)?.label || field}</dt>
            <dd>{changeValueText(field, change.old_value)} → <strong>{changeValueText(field, change.new_value)}</strong></dd>
          </div>
        ))}
        <div className="cs-detail-wide"><dt>Reason</dt><dd>{request.reason}</dd></div>
        {decided && <div className="cs-detail-wide"><dt>Decided</dt><dd>{shownTime(request.decided_at)}</dd></div>}
        {decided && request.decision_reason && <div className="cs-detail-wide"><dt>Decision reason</dt><dd>{request.decision_reason}</dd></div>}
      </dl>
      {children}
    </article>
  );
}

export default function ChangeRequestsScreen({ user, creating, onCreatingChange, initialEventId = null, onNotice }) {
  const [requests, setRequests] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    Promise.all([loadMyChangeRequests(user.uid), loadChangeableEvents(user.uid)])
      .then(([mine, changeable]) => { if (mounted) { setRequests(mine); setEvents(changeable); } })
      .catch((failure) => {
        console.error("Could not load change requests:", failure);
        if (mounted) setError("Your change requests could not be loaded. Try again.");
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [user.uid]);

  if (loading) return <p className="cs-panel-note">Loading your change requests…</p>;
  if (error) return <p className="cs-error" role="alert">{error}</p>;

  if (creating) {
    if (!events.length) {
      return (
        <div className="cs-empty">
          <p>None of your events can take a change request right now. A change can be requested once an event is submitted, up to when it is confirmed.</p>
          <button type="button" className="cs-btn cs-btn-ghost" onClick={() => onCreatingChange(false)}>Back to change requests</button>
        </div>
      );
    }
    return (
      <ChangeRequestForm
        userId={user.uid}
        events={events}
        initialEventId={initialEventId}
        onCancel={() => onCreatingChange(false)}
        onSubmitted={(saved) => {
          setRequests((list) => [saved, ...list]);
          onCreatingChange(false);
          onNotice?.(saved.notified
            ? `Change request sent. ${saved.event_name || "The event"}'s coordinator has been told.`
            : "Change request saved as Pending. The coordinator will see it once the event is assigned.");
        }}
      />
    );
  }

  if (!requests.length) {
    return (
      <div className="cs-empty">
        <p>You have not requested any changes yet.</p>
        {events.length > 0 && <button type="button" className="cs-btn cs-btn-primary" onClick={() => onCreatingChange(true)}>New change request</button>}
      </div>
    );
  }

  return (
    <div className="cs-record-list" aria-label="Your change requests">
      {requests.map((request) => <ChangeRequestRecord key={request.id} request={request} />)}
    </div>
  );
}
