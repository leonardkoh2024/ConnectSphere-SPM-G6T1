// A6 / Week 7 change #5 — the Event Coordinator Lead's two screens, in one
// component driven by `view`:
//   - "queue"     : events with no coordinator yet, each with an Assign control.
//   - "oversight" : K4 / SCRUM-185 — every active event with its coordinator,
//                   status, proposed date and time since last activity; filters by
//                   coordinator and status; a per-coordinator summary; and a Reassign
//                   control on each assigned event. It never edits an event (AC4).
// Both screens share the same board (reviewApi.leadBoard) and the same picker, so
// they live together rather than in two near-identical files. The pure guards in
// domain/eventReview decide what the Lead may do; firestore.rules is the real
// server-side boundary (AC5).

import React, { useEffect, useMemo, useState } from "react";
import { statusTone } from "../../domain/events";
import { ROLES } from "../../domain/roles";
import { assignmentSummary, canAssignCoordinator, canLeadReassign, coordinatorChoiceLabel, coordinatorWorkload, EVENT_STATUS, formatSinceActivity, oversightCoordinators, oversightRows, oversightSummary, unassignedQueue } from "../../domain/eventReview";
import { reviewApi } from "./reviewApi";
import RecordLead from "../../components/RecordLead";

const LEAD = ROLES.COORDINATOR_LEAD;

// K4 / SCRUM-185 AC2 — the statuses an active event can be in, in workflow order.
// Draft never reaches the Lead (K1) and Completed, Cancelled and Rejected are not on
// this view, so none of them is offered.
const OVERSIGHT_STATUSES = [
  EVENT_STATUS.SUBMITTED, EVENT_STATUS.UNDER_REVIEW, EVENT_STATUS.APPROVED,
  EVENT_STATUS.PLANNING, EVENT_STATUS.SAFETY_REVIEW, EVENT_STATUS.CONFIRMED
];
const statusLabel = (status) => status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");

export default function LeadAssignmentScreen({ view = "queue", onNotice }) {
  const [events, setEvents] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  // The coordinator picked for each event, kept per row so several rows can have
  // a pending choice at once: { [eventId]: coordinatorId }.
  const [choice, setChoice] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  // K3 / SCRUM-184 — which row the error belongs to, so a refused assign/reassign is
  // shown beside the button that was pressed, not off-screen at the top of a long list.
  const [errorFor, setErrorFor] = useState("");
  // K4 / SCRUM-185 AC2 — the two oversight filters. An empty value means "all". They
  // belong to the view, so they survive a reload after a reassignment.
  const [filterCoordinator, setFilterCoordinator] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  // K2 / SCRUM-183 AC1 — which queued events have their read-only summary open.
  const [open, setOpen] = useState({});

  const load = async () => {
    const data = await reviewApi.leadBoard();
    setEvents(data.events || []);
    setCoordinators(data.coordinators || []);
    return data;
  };
  useEffect(() => { load().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const coordinatorById = useMemo(() => new Map(coordinators.map((item) => [item.id, item])), [coordinators]);
  const workload = useMemo(() => coordinatorWorkload(events, coordinators), [events, coordinators]);
  // K2 / SCRUM-183 AC2 — active-event count per coordinator, for the option labels.
  const workloadById = useMemo(() => new Map(workload.map((item) => [item.id, item.activeEvents])), [workload]);
  // K1 / SCRUM-182 — waiting events, oldest submission first (AC3), leaving the
  // moment they are assigned (AC4). The ordering/filtering is the pure helper.
  const queue = useMemo(() => unassignedQueue(events), [events]);
  // K4 / SCRUM-185 — the oversight view. The summary and the coordinator filter use
  // the whole board (so a filter never hides who is overloaded) and include a
  // coordinator who is no longer active but still holds an active event (AC3). The
  // rows are the filtered, longest-untouched-first list (AC1/AC2); each is looked up
  // by id so the reassign picker still gets the full event.
  const eventById = useMemo(() => new Map(events.map((item) => [item.id, item])), [events]);
  const filterChoices = useMemo(() => oversightCoordinators(events, coordinators), [events, coordinators]);
  const summary = useMemo(() => oversightSummary(events, filterChoices), [events, filterChoices]);
  const rows = useMemo(
    () => oversightRows(events, { coordinatorId: filterCoordinator, status: filterStatus }, Date.now()),
    [events, filterCoordinator, filterStatus]
  );

  const pick = (eventId, coordinatorId) => setChoice((current) => ({ ...current, [eventId]: coordinatorId }));
  const toggle = (eventId) => setOpen((current) => ({ ...current, [eventId]: !current[eventId] }));

  const run = async (event, kind) => {
    const coordinatorId = choice[event.id];
    /* istanbul ignore if -- unreachable from the UI: with no coordinator chosen the guard keeps the button disabled. */
    if (!coordinatorId) { setError("Choose a coordinator first."); setErrorFor(event.id); return; }
    setBusyId(event.id); setError(""); setErrorFor("");
    try {
      if (kind === "assign") await reviewApi.assign(event.id, coordinatorId);
      else await reviewApi.leadReassign(event.id, coordinatorId);
      await load();
      setChoice((current) => { const next = { ...current }; delete next[event.id]; return next; });
      const name = coordinatorById.get(coordinatorId)?.name || "the coordinator";
      onNotice?.(kind === "assign" ? `Assigned to ${name}.` : `Reassigned to ${name}.`);
    } catch (e) { setError(e.message); setErrorFor(event.id); }
    finally { setBusyId(""); }
  };

  // The assign/reassign control shared by both screens. For reassign the current
  // coordinator is left out of the list, and the button follows the same guard the
  // adapter and firestore.rules enforce, so a disallowed move is never offered.
  const picker = (event, kind) => {
    const chosen = choice[event.id] || "";
    const target = coordinatorById.get(chosen) || null;
    const options = coordinators.filter((item) => kind === "assign" || item.id !== event.coordinator_id);
    const allowed = kind === "assign"
      ? canAssignCoordinator(event, LEAD, target)
      : canLeadReassign(event, LEAD, target);
    return <>
      <div className="cs-record-actions">
      <label className="cs-field cs-inline-field">
        <span className="cs-field-name">{kind === "assign" ? "Assign to" : "Reassign to"}</span>
        <select value={chosen} disabled={busyId === event.id} onChange={(e) => pick(event.id, e.target.value)}>
          <option value="">Choose a coordinator</option>
          {options.map((item) => <option value={item.id} key={item.id}>{coordinatorChoiceLabel({ name: item.name, activeEvents: workloadById.get(item.id) || 0 })}</option>)}
        </select>
      </label>
      <button type="button" className="cs-btn cs-btn-primary cs-record-btn" disabled={!allowed || busyId === event.id} onClick={() => run(event, kind)}>
        {busyId === event.id ? "Saving…" : kind === "assign" ? "Assign" : "Reassign"}
      </button>
      </div>
      {error && errorFor === event.id && <p className="cs-error" role="alert">{error}</p>}
    </>;
  };

  const eventHeader = (event) => <div className="cs-record-title">
    <RecordLead date={event.event_date} />
    <div>
      <h2>{event.name || "Untitled event"}</h2>
      <p>{event.event_date || "Date not set"}{event.organiser_name ? ` · ${event.organiser_name}` : ""}</p>
    </div>
  </div>;

  // K1 / SCRUM-182 AC3 — "time since submission" as a plain relative label.
  const sinceSubmission = (iso) => {
    if (!iso) return "just now";
    const ms = Date.now() - new Date(iso).getTime();
    if (!(ms > 0)) return "just now";
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins || 1} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  };

  // K2 / SCRUM-183 AC1 — a read-only event summary opened per queued event, so the
  // Lead can check the basics (purpose, time, attendance, organiser) before
  // choosing a coordinator. assignmentSummary is the pure shape it renders.
  const details = (event) => {
    const summary = assignmentSummary(event, { name: event.organiser_name, email: event.organiser_email });
    return <>
      <button type="button" className="cs-btn cs-btn-ghost cs-record-btn" aria-expanded={Boolean(open[event.id])} onClick={() => toggle(event.id)}>
        {open[event.id] ? "Hide details" : "View details"}
      </button>
      {open[event.id] && <dl className="cs-record-summary">
        <div><dt>Purpose</dt><dd>{summary.purpose || "—"}</dd></div>
        <div><dt>Time</dt><dd>{(summary.startTime || "—") + " – " + (summary.endTime || "—")}</dd></div>
        <div><dt>Expected attendance</dt><dd>{summary.expectedAttendance != null ? summary.expectedAttendance : "—"}</dd></div>
        <div><dt>Organiser</dt><dd>{summary.organiser?.name || "—"}</dd></div>
      </dl>}
    </>;
  };

  const topError = error && !errorFor ? <p className="cs-error" role="alert">{error}</p> : null;

  if (loading) return <p className="cs-panel-note">Loading events…</p>;

  if (view === "queue") {
    if (!queue.length) {
      return <>{topError}<div className="cs-empty"><p>No events are waiting for a coordinator.</p></div></>;
    }
    return <>
      {topError}
      <div className="cs-record-list">{queue.map((event) => <article className="cs-record cs-review-record cs-lead-record" key={event.id}>
        {eventHeader(event)}
        <p className="cs-record-ref">{event.reference_no}</p>
        <div className="cs-record-status"><span className={`cs-pill cs-pill-${statusTone(event.status)}`}>{event.status}</span></div>
        <div className="cs-record-modified"><p className="cs-record-saved">{event.expected_attendance != null ? `Expected ${event.expected_attendance}` : "Attendance not set"} · Submitted {sinceSubmission(event.submitted_at)}</p></div>
        {details(event)}
        {picker(event, "assign")}
      </article>)}</div>
    </>;
  }

  // view === "oversight" — K4 / SCRUM-185. Read-only apart from the permitted Reassign
  // (reviewApi.leadReassign): no field of an event can be edited from here (AC4).
  const filtered = Boolean(filterCoordinator || filterStatus);

  return <>
    {topError}
    <section className="cs-request-section cs-lead-summary" aria-label="Active events per coordinator">
      <div className="cs-review-heading"><div><h2>Active events per coordinator</h2></div></div>
      {summary.length
        ? <ul className="cs-record-list">{summary.map((item) => <li key={item.id}>
            <span>{item.name}</span>{" "}
            <span className="cs-pill">{item.activeEvents} active {item.activeEvents === 1 ? "event" : "events"}</span>
          </li>)}</ul>
        : <p className="cs-panel-note">No active coordinators yet.</p>}
    </section>
    <div className="cs-review-toolbar" role="group" aria-label="Filter oversight">
      <label className="cs-field cs-inline-field">
        <span className="cs-field-name">Filter by coordinator</span>
        <select value={filterCoordinator} onChange={(e) => setFilterCoordinator(e.target.value)}>
          <option value="">All coordinators</option>
          {filterChoices.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="cs-field cs-inline-field">
        <span className="cs-field-name">Filter by status</span>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {OVERSIGHT_STATUSES.map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}
        </select>
      </label>
    </div>
    {rows.length
      ? <div className="cs-record-list">{rows.map((row) => {
          const event = eventById.get(row.id);
          return <article className="cs-record cs-review-record cs-lead-record" key={row.id}>
            {eventHeader(event)}
            <p className="cs-record-ref">{row.reference}</p>
            <div className="cs-record-status"><span className={`cs-pill cs-pill-${statusTone(row.status)}`}>{row.status}</span></div>
            <div className="cs-record-modified">
              <p className="cs-record-saved">{row.coordinatorId ? `Coordinator: ${row.coordinatorName}` : "Unassigned"}</p>
              <p className="cs-record-saved"><span>Last activity </span><span>{formatSinceActivity(row.sinceLastActivityMs)}</span></p>
            </div>
            {row.coordinatorId ? picker(event, "reassign") : <div className="cs-record-actions" />}
          </article>;
        })}</div>
      : <div className="cs-empty"><p>{filtered ? "No events match these filters." : "No active events."}</p></div>}
  </>;
}
