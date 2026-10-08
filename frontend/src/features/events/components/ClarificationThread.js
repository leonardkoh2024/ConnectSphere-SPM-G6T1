// The clarification exchange on an event's Clarifications tab, oldest first
// (C4 AC3, C5). Shared by the organiser's and the coordinator's event pages.

import React from "react";
import { chronologicalClarifications } from "../../../domain/eventReview";

const shownTime = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";

export default function ClarificationThread({ clarifications = [], responses = [] }) {
  const exchange = chronologicalClarifications(clarifications, responses);
  if (!exchange.length) return <p className="cs-panel-note">No clarification has been requested for this event.</p>;
  return <section className="cs-exchange">
    <h3>Clarification history</h3>
    {exchange.map((item) => <article key={`${item.kind}-${item.id}`}>
      <strong>{item.kind === "QUESTION" ? "Coordinator" : "Organiser"}</strong>
      <time>{shownTime(item.created_at)}</time>
      <p>{item.message}</p>
    </article>)}
  </section>;
}
