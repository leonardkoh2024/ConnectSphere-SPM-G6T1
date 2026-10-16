import React, { useEffect, useMemo, useState } from "react";
import { statusTone } from "../../domain/events";
import { EVENT_TABS, buildRequestView, canFindVenues, clarificationSummary } from "../../domain/eventReview";
import { ALL_STATUSES, buildAssignedView, statusOptions } from "../../domain/assignedEvents";
import { reviewApi } from "./reviewApi";
import RecordLead from "../../components/RecordLead";
import Icon from "../../app/Icon";
import EventDetailTabs from "./components/EventDetailTabs";
import ClarificationThread from "./components/ClarificationThread";
import SignificantChangeEditor from "./components/SignificantChangeEditor";
import { editableEventStatuses } from "../../domain/significantEventChanges";
import SafetyPlanningNotes from "../safety/SafetyPlanningNotes";

const shownTime = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";

export default function EventReviewScreen({ queueOnly = false, onNotice, onFindVenues, initialEventId = null, onBackChange }) {
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [mode, setMode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(EVENT_TABS.REQUEST);
  // C2 / SCRUM-103 — AC3 controls for the "Assigned events" list.
  const [statusFilter, setStatusFilter] = useState(ALL_STATUSES);
  const [sortDir, setSortDir] = useState("asc");

  const loadList = async () => {
    const data = await reviewApi.list();
    setEvents(data.events || []);
    return data.events || [];
  };
  useEffect(() => { loadList().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from a venue booking: show that request without starting a review on
  // it, so arriving here to read never moves a Submitted event to Under Review.
  useEffect(() => {
    if (initialEventId) loadDetail(initialEventId, false);
  }, [initialEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Inside the workspace the back button lives in the page header; this screen
  // only says when it has a detail view open and how to close it.
  const closeDetail = () => { setDetail(null); setSelected(null); };
  const detailOpen = Boolean(detail);
  useEffect(() => {
    if (!onBackChange) return undefined;
    onBackChange(detailOpen ? closeDetail : null);
    return () => onBackChange(null);
  }, [detailOpen, onBackChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => queueOnly
    ? events.filter((event) => ["SUBMITTED", "UNDER_REVIEW"].includes(event.status) && event.editable)
    : events, [events, queueOnly]);

  // C2 / SCRUM-103 — the assigned list as display rows: name, organiser, proposed
  // date, status and time since last activity (AC2), filtered by status and sorted
  // by proposed date (AC3). Events arrive already scoped to this coordinator by
  // reviewApi.list + firestore.rules (AC1), so no coordinatorId is passed here.
  const assignedOptions = useMemo(() => statusOptions(events), [events]);
  const assignedRows = useMemo(
    () => buildAssignedView(events, { status: statusFilter, sort: sortDir }),
    [events, statusFilter, sortDir]
  );

  const loadDetail = async (eventId, open = true) => {
    setError(""); setBusy(true);
    try {
      let current = events.find((item) => item.id === eventId);
      if (open && current?.status === "SUBMITTED" && current.editable) {
        await reviewApi.openReview(eventId);
        await loadList();
      }
      const data = await reviewApi.detail(eventId);
      if (eventId !== selected) setTab(EVENT_TABS.REQUEST);
      setSelected(eventId); setDetail(data); setMode(""); setMessage("");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const act = async (action, success) => {
    if (!message.trim()) { setError(`${mode === "reject" ? "Rejection reason" : "Clarification message"} is required.`); return; }
    setBusy(true); setError("");
    try {
      if (action === "clarify") await reviewApi.clarify(selected, message);
      if (action === "reject") await reviewApi.reject(selected, message);
      await loadList(); await loadDetail(selected, false); onNotice?.(success); setMode(""); setMessage("");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  // C6 / SCRUM-107 — approve moves an Under Review request to Approved. It needs no
  // text from the coordinator, so it runs straight from the button (not via `act`).
  // A failure keeps the event where it was and shows the reason above the actions.
  const approve = async () => {
    setBusy(true); setError("");
    try {
      await reviewApi.approve(selected);
      await loadList(); await loadDetail(selected, false); onNotice?.("Event request approved.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <p className="cs-panel-note">Loading assigned events…</p>;
  if (detail) {
    const event = detail.event;
    const hasOpen = Boolean(event.open_clarification_id);
    const canDecide = event.editable && event.status === "UNDER_REVIEW" && !hasOpen;
    // C6 — same gate as the domain rule (assigned coordinator, Under Review, no open
    // clarification); the transaction in reviewApi.approve re-checks it server-side.
    const canApprove = canDecide;
    // K3 / SCRUM-184 — reassigning is the Event Coordinator Lead's alone (it replaces
    // C9 criterion 5), so a coordinator, even the one in charge, is offered no Reassign.
    const canEditSignificant = event.editable && editableEventStatuses.includes(event.status) && !hasOpen;
    const showFindVenues = typeof onFindVenues === "function";
    const canRequestVenue = showFindVenues && event.editable && canFindVenues(event);
    const summary = clarificationSummary(detail);
    // C3 — the full submitted request, shaped for display (AC1, AC2).
    const request = buildRequestView(detail);
    const startMode = (next) => { setMode(next); setMessage(""); setError(""); };
    // One form at a time, shown on the tab its action belongs to: Request
    // clarification on Clarifications, Reject on the request.
    const actionBox = mode && mode !== "significant" && <section className="cs-form-section cs-action-box">
      <h3>{mode === "clarify" ? "Request clarification" : "Reject request"}</h3>
      <label className="cs-field"><span className="cs-field-name">{mode === "reject" ? "Reason" : "Message"}<span className="cs-required" aria-hidden="true">*</span></span><textarea rows="4" required value={message} aria-invalid={Boolean(error)} aria-describedby={error ? "cs-review-action-error" : undefined} onChange={(e) => { setMessage(e.target.value); if (error) setError(""); }} /></label>
      {error && <p id="cs-review-action-error" className="cs-error" role="alert">{error}</p>}
      <div className="cs-form-actions"><button type="button" className="cs-btn cs-btn-ghost" onClick={() => { setMode(""); setError(""); }}>Cancel</button><button type="button" className={mode === "reject" ? "cs-btn cs-btn-ghost cs-record-danger" : "cs-btn cs-btn-primary"} disabled={busy} onClick={() => act(mode, mode === "clarify" ? "Clarification request sent." : "Event request rejected.")}>{busy ? "Saving…" : mode === "clarify" ? "Send request" : "Reject event"}</button></div>
    </section>;

    const requestTab = <>
      <dl className="cs-detail-grid">
        <div><dt>Submitted</dt><dd>{shownTime(event.submitted_at)}</dd></div><div><dt>Event date</dt><dd>{event.event_date}</dd></div>
        <div><dt>Time</dt><dd>{event.start_time}–{event.end_time}</dd></div><div><dt>Expected attendance</dt><dd>{event.expected_attendance}</dd></div>
        <div><dt>Assigned coordinator</dt><dd>{detail.coordinator?.name}</dd></div>
        <div className="cs-detail-wide"><dt>Organiser</dt><dd className="cs-contact">
          <span>{request.contact.name}</span>
          {request.contact.email && <span>{request.contact.email}</span>}
          {request.contact.phone && <span>{request.contact.phone}</span>}
        </dd></div>
        <div className="cs-detail-wide"><dt>Purpose</dt><dd>{event.purpose}</dd></div><div className="cs-detail-wide"><dt>Description</dt><dd>{event.description}</dd></div>
        {event.decision_reason && <div className="cs-detail-wide"><dt>Decision reason</dt><dd>{event.decision_reason} · {shownTime(event.decided_at)}</dd></div>}
      </dl>
      <section className="cs-request-section">
        <h3>Venue requirements</h3>
        <dl className="cs-detail-grid">
          <div><dt>Preferred location</dt><dd>{request.venue.preferredLocation || "No preference"}</dd></div>
          <div><dt>Layout</dt><dd>{request.venue.layout || "No preference"}</dd></div>
        </dl>
        {request.venue.facilities.length > 0
          ? <ul className="cs-tag-list">{request.venue.facilities.map((item) => <li key={item}>{item}</li>)}</ul>
          : <p className="cs-panel-note">No specific facilities requested.</p>}
      </section>
      <section className="cs-request-section" aria-label="Venue booking status">
        <h3>Venue bookings</h3>
        {(detail.venueBookings || []).length ? (
          <div className="cs-record-list">
            {detail.venueBookings.map((booking) => (
              <article className="cs-record" key={booking.booking_id}>
                <div className="cs-record-title"><h4>{booking.venue_name}</h4></div>
                <p className="cs-record-ref">{shownTime(booking.start_datetime)}–{shownTime(booking.end_datetime)}</p>
                <div className="cs-record-modified">
                  <span className={`cs-pill cs-pill-${statusTone(booking.status)}`}>{booking.status}</span>
                </div>
                <dl className="cs-detail-grid cs-record-expanded">
                  <div><dt>Decision time</dt><dd>{booking.decided_at ? shownTime(booking.decided_at) : "Not decided"}</dd></div>
                  {booking.decision_reason && <div className="cs-detail-wide"><dt>Decision reason</dt><dd>{booking.decision_reason}</dd></div>}
                  {booking.release_reason && <div className="cs-detail-wide"><dt>Release reason</dt><dd>{booking.release_reason}</dd></div>}
                </dl>
              </article>
            ))}
          </div>
        ) : <p className="cs-panel-note">No venue booking requests have been raised for this event.</p>}
      </section>
      <section className="cs-request-section">
        <h3>Accessibility</h3>
        {request.accessibility.items.length > 0
          ? <ul className="cs-tag-list">{request.accessibility.items.map((item) => <li key={item}>{item}</li>)}</ul>
          : <p className="cs-panel-note">No accessibility needs stated.</p>}
        {request.accessibility.notes && <p>{request.accessibility.notes}</p>}
      </section>
      <section className="cs-request-section">
        <h3>Equipment</h3>
        {request.equipment.length > 0
          ? <ul className="cs-tag-list">{request.equipment.map((item, index) => <li key={index}>{item.label}{item.notes ? ` — ${item.notes}` : ""}</li>)}</ul>
          : <p className="cs-panel-note">No equipment requested.</p>}
      </section>
      {/* A7 AC3 — keyed on the last update so a save reloads it with what was stored. */}
      <SafetyPlanningNotes
        key={`${event.id}-${event.updated_at || ""}`}
        event={event}
        onSaved={async () => {
          await loadList();
          await loadDetail(selected, false);
          onNotice?.("Safety planning notes saved.");
        }}
      />
      {request.registration && <section className="cs-request-section">
        <h3>Registration</h3>
        <dl className="cs-detail-grid">
          <div><dt>Capacity</dt><dd>{request.registration.capacity ?? "Not set"}</dd></div>
          <div><dt>Opens</dt><dd>{request.registration.opens || "Not set"}</dd></div>
          <div><dt>Closes</dt><dd>{request.registration.closes || "Not set"}</dd></div>
        </dl>
      </section>}
      {mode !== "significant" && (canDecide || showFindVenues || canEditSignificant) && <div className="cs-review-actions">
        {showFindVenues && <button
          className="cs-btn cs-btn-secondary cs-find-venues"
          type="button"
          disabled={!canRequestVenue}
          aria-describedby={!canRequestVenue ? "cs-find-venues-reason" : undefined}
          onClick={() => { if (canRequestVenue) onFindVenues(event); }}
        >Find venues</button>}
        {canApprove && <button className="cs-btn cs-btn-primary" type="button" disabled={busy} onClick={approve}>{busy && !mode ? "Approving…" : "Approve"}</button>}
        {canDecide && <button className="cs-btn cs-btn-ghost cs-record-danger" type="button" disabled={busy} onClick={() => startMode("reject")}>Reject request</button>}
        {canEditSignificant && <button className="cs-btn cs-btn-secondary" type="button" onClick={() => startMode("significant")}>Edit significant details</button>}
      </div>}
      {mode !== "significant" && showFindVenues && !canRequestVenue && (
        <p id="cs-find-venues-reason" className="cs-panel-note">
          Venue requests are available only for events with Approved or Planning status.
        </p>
      )}
      {mode !== "clarify" && actionBox}
      {mode === "significant" && <SignificantChangeEditor
        event={event}
        onCancel={() => { setMode(""); setError(""); }}
        onSaved={async () => {
          await loadList();
          await loadDetail(selected, false);
          onNotice?.("Significant event changes saved.");
        }}
      />}
    </>;

    const clarificationsTab = <>
      <ClarificationThread clarifications={detail.clarifications} responses={detail.responses} />
      {canDecide && mode !== "clarify" && <div className="cs-review-actions"><button className="cs-btn cs-btn-secondary" type="button" onClick={() => startMode("clarify")}>Request clarification</button></div>}
      {mode === "clarify" && actionBox}
    </>;

    // Switching tab drops a half-open form: it belongs to the tab it was opened on.
    const changeTab = (next) => { setTab(next); setMode(""); setError(""); };

    return <div className="cs-review-detail">
      {!onBackChange && <button type="button" className="cs-btn cs-btn-ghost cs-back" onClick={closeDetail}><Icon name="chevron-left" />Back to events</button>}
      {error && !mode && <p className="cs-error" role="alert">{error}</p>}
      {!event.editable && <p className="cs-panel-note">This event was reassigned. You can view the assignment record, but only the current coordinator can make changes.</p>}
      <div className="cs-review-heading"><div><h2>{event.name}</h2><p>{event.reference_no}</p></div><span className={`cs-pill cs-pill-${statusTone(event.status)}`}>{event.status}</span></div>
      {hasOpen && <p className="cs-attention">Awaiting the organiser. Approve, Clarify and Reject are unavailable until they respond.</p>}
      <EventDetailTabs
        label="Event request sections"
        idPrefix={`review-${event.id}`}
        active={tab}
        onChange={changeTab}
        tabs={[
          { id: EVENT_TABS.REQUEST, label: "Event request", content: requestTab },
          { id: EVENT_TABS.CLARIFICATIONS, label: "Clarifications", count: summary.requests, content: clarificationsTab }
        ]}
      />
    </div>;
  }

  // The Review queue (queueOnly) is unchanged: it lists only the requests waiting
  // for action and keeps its original card (now with the shared RecordLead tile).
  if (queueOnly) {
    if (!visible.length) return <div className="cs-empty"><p>{error || "No requests are waiting for review."}</p></div>;
    return <>{error && <p className="cs-error">{error}</p>}<div className="cs-record-list">{visible.map((event) => <article className="cs-record cs-review-record" key={event.id}><div className="cs-record-title"><RecordLead date={event.event_date} /><div><h2>{event.name || "Untitled event"}</h2><p>{event.event_date || "Date not set"}</p></div></div><p className="cs-record-ref">{event.reference_no}</p><div className="cs-record-status"><span className={`cs-pill cs-pill-${statusTone(event.status)}`}>{event.status}</span></div><div className="cs-record-modified"><p className="cs-record-saved">{event.editable ? "Current assignment" : "Previous assignment · read only"}</p></div><div className="cs-record-actions"><button className="cs-btn cs-btn-ghost cs-record-btn" type="button" disabled={busy} onClick={() => loadDetail(event.id)}>View request</button></div></article>)}</div></>;
  }

  // C2 / SCRUM-103 — the coordinator's "Assigned events" list: everything they are
  // accountable for, with the five columns the story asks for plus the status
  // filter and proposed-date sort.
  if (!events.length) return <div className="cs-empty"><p>{error || "No events are assigned to you."}</p></div>;
  return <>
    {error && <p className="cs-error">{error}</p>}
    <div className="cs-review-toolbar">
      <label className="cs-field cs-inline-field">
        <span className="cs-field-name">Status</span>
        <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {assignedOptions.map((status) => <option key={status} value={status}>{status === ALL_STATUSES ? "All statuses" : status}</option>)}
        </select>
      </label>
      <button type="button" className="cs-btn cs-btn-ghost cs-sort-btn" aria-label="Sort by proposed date" onClick={() => setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))}>
        Proposed date {sortDir === "asc" ? "↑" : "↓"}
      </button>
    </div>
    {assignedRows.length
      ? <div className="cs-record-list">{assignedRows.map((row) => <article className="cs-record cs-review-record" key={row.id}>
          <div className="cs-record-title"><RecordLead date={row.proposedDate} /><div><h2>{row.name}</h2><p>{row.proposedDate || "Date not set"}</p></div></div>
          <p className="cs-record-ref">{row.organiser}</p>
          <div className="cs-record-status"><span className={`cs-pill cs-pill-${statusTone(row.status)}`}>{row.status}</span></div>
          <div className="cs-record-modified"><p className="cs-record-saved">Last activity: {row.lastActivityLabel}</p></div>
          <div className="cs-record-actions"><button className="cs-btn cs-btn-ghost cs-record-btn" type="button" disabled={busy} onClick={() => loadDetail(row.id)}>View request</button></div>
        </article>)}</div>
      : <div className="cs-empty"><p>No events match this filter.</p></div>}
  </>;
}
