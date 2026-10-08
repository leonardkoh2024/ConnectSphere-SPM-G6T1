// C7 — the decision on a submitted request, shown to its organiser above the
// read-only form on the Event request tab. The clarification exchange lives on
// its own tab (OrganiserEventDetail), so this is only who decided what, and why.

import React from "react";

const dateTime = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";

export default function DecisionSummary({ detail }) {
  return <section className="cs-form-section cs-decision-summary" aria-label="Request decision">
    <h2>Review and decision</h2>
    <dl className="cs-detail-grid">
      <div><dt>Assigned coordinator</dt><dd>{detail.coordinator?.name || "Assignment pending"}</dd></div>
      <div><dt>Decision</dt><dd>{detail.event.decision || detail.event.status}</dd></div>
      <div><dt>Decision time</dt><dd>{dateTime(detail.event.decided_at)}</dd></div>
      <div className="cs-detail-wide"><dt>Reason</dt><dd>{detail.event.decision_reason || "No decision reason recorded."}</dd></div>
    </dl>
  </section>;
}
