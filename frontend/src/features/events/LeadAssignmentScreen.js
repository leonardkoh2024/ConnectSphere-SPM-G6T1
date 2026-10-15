// A6 / Week 7 change #5 — the Event Coordinator Lead's two screens, in one
// component driven by `view`:
//   - "queue"     : events with no coordinator yet, each with an Assign control.
//   - "oversight" : every event with its coordinator, the per-coordinator
//                   workload, and a Reassign control on each live assigned event.
// Both screens share the same board (reviewApi.leadBoard) and the same picker, so
// they live together rather than in two near-identical files. The pure guards in
// domain/eventReview decide what the Lead may do; firestore.rules is the real
// server-side boundary (AC5).

import React, { useEffect, useMemo, useState } from "react";
import { statusTone } from "../../domain/events";
import { ROLES } from "../../domain/roles";
import { assignmentSummary, canAssignCoordinator, canLeadReassign, coordinatorChoiceLabel, coordinatorWorkload, isTerminal, unassignedQueue } from "../../domain/eventReview";
import { reviewApi } from "./reviewApi";
import RecordLead from "../../components/RecordLead";

const LEAD = ROLES.COORDINATOR_LEAD;

export default function LeadAssignmentScreen({ view = "queue", onNotice }) {
  const [events, setEvents] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  // The coordinator picked for each event, kept per row so several rows can have
  // a pending choice at once: { [eventId]: coordinatorId }.
  const [choice, setChoice] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  // Oversight is shown one lens at a time — by event or by coordinator — so the
  // screen stays a single clean list rather than everything stacked at once.
  const [lens, setLens] = useState("event");
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

  const pick = (eventId, coordinatorId) => setChoice((current) => ({ ...current, [eventId]: coordinatorId }));
  const toggle = (eventId) => setOpen((current) => ({ ...current, [eventId]: !current[eventId] }));

  const run = async (event, kind) => {
    const coordinatorId = choice[event.id] || "";
    if (!coordinatorId) { setError("Choose a coordinator first."); return; }
    setBusyId(event.id); setError("");
    try {
      if (kind === "assign") await reviewApi.assign(event.id, coordinatorId);
      else await reviewApi.leadReassign(event.id, coordinatorId);
      await load();
      setChoice((current) => { const next = { ...current }; delete next[event.id]; return next; });
      const name = coordinatorById.get(coordinatorId)?.name || "the coordinator";
      onNotice?.(kind === "assign" ? `Assigned to ${name}.` : `Reassigned to ${name}.`);
    } catch (e) { setError(e.message); }
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
    return <div className="cs-record-actions">
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
    </div>;
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

  if (loading) return <p className="cs-panel-note">Loading events…</p>;

  if (view === "queue") {
    if (!queue.length) {
      return <>{error && <p className="cs-error" role="alert">{error}</p>}<div className="cs-empty"><p>No events are waiting for a coordinator.</p></div></>;
    }
    return <>
      {error && <p className="cs-error" role="alert">{error}</p>}
      <div className="cs-record-list">{queue.map((event) => <article className="cs-record cs-review-record" key={event.id}>
        {eventHeader(event)}
        <p className="cs-record-ref">{event.reference_no}</p>
        <div className="cs-record-status"><span className={`cs-pill cs-pill-${statusTone(event.status)}`}>{event.status}</span></div>
        <div className="cs-record-modified"><p className="cs-record-saved">{event.expected_attendance != null ? `Expected ${event.expected_attendance}` : "Attendance not set"} · Submitted {sinceSubmission(event.submitted_at)}</p></div>
        {details(event)}
        {picker(event, "assign")}
      </article>)}</div>
    </>;
  }

  // view === "oversight" — two lenses on the same board, chosen with a toggle.
  // "By event" is the flat event-centric list; "By coordinator" groups each
  // coordinator's live events under their name, least-loaded first, with the
  // workload count folded into the group header so nothing is stacked twice.
  const liveFor = (coordinatorId) => events.filter((event) => event.coordinator_id === coordinatorId && !isTerminal(event));

  const eventRow = (event, withReassign) => <article className="cs-record cs-review-record" key={event.id}>
    {eventHeader(event)}
    <p className="cs-record-ref">{event.reference_no}</p>
    <div className="cs-record-status"><span className={`cs-pill cs-pill-${statusTone(event.status)}`}>{event.status}</span></div>
    {lens === "event" && <div className="cs-record-modified"><p className="cs-record-saved">{event.coordinator_id ? `Coordinator: ${event.coordinator_name || event.coordinator_id}` : "Unassigned"}</p></div>}
    {withReassign && event.coordinator_id && !isTerminal(event) ? picker(event, "reassign") : <div className="cs-record-actions" />}
  </article>;

  return <>
    {error && <p className="cs-error" role="alert">{error}</p>}
    <div className="cs-review-toolbar" role="group" aria-label="Group oversight by">
      <button type="button" aria-pressed={lens === "event"} className={lens === "event" ? "cs-btn cs-btn-secondary" : "cs-btn cs-btn-ghost"} onClick={() => setLens("event")}>By event</button>
      <button type="button" aria-pressed={lens === "coordinator"} className={lens === "coordinator" ? "cs-btn cs-btn-secondary" : "cs-btn cs-btn-ghost"} onClick={() => setLens("coordinator")}>By coordinator</button>
    </div>
    {lens === "event"
      ? (events.length
          ? <div className="cs-record-list">{events.map((event) => eventRow(event, true))}</div>
          : <div className="cs-empty"><p>No events yet.</p></div>)
      : (workload.length
          ? workload.map((coordinator) => {
              const theirs = liveFor(coordinator.id);
              return <section className="cs-request-section" key={coordinator.id}>
                <div className="cs-review-heading">
                  <div><h2>{coordinator.name}</h2></div>
                  <span className="cs-pill">{coordinator.activeEvents} active {coordinator.activeEvents === 1 ? "event" : "events"}</span>
                </div>
                {theirs.length
                  ? <div className="cs-record-list">{theirs.map((event) => eventRow(event, true))}</div>
                  : <p className="cs-panel-note">No active events.</p>}
              </section>;
            })
          : <p className="cs-panel-note">No active coordinators yet.</p>)}
  </>;
}
