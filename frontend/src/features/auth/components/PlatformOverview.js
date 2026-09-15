// The marketing half of the landing page: what the platform does, who each role
// is, and how an event moves through the workflow. Presentational only — it holds
// no state and performs no Firebase calls, so it renders from the role model alone.

import React from "react";
import { ROLE_META } from "../../../domain/roles";
import { PORTALS } from "../../../domain/portals";

const FEATURES = [
  {
    title: "Requests and drafts",
    body:
      "Organisers submit complete event requests, or park an incomplete one as a draft and finish it later."
  },
  {
    title: "Review, approval and assignment",
    body:
      "Coordinators request clarification, approve or reject, and pick up the events assigned to them."
  },
  {
    title: "Venue catalogue and availability",
    body:
      "Capacity, facilities, accessibility and supported layouts, alongside a calendar of what is already booked."
  },
  {
    title: "Booking approval and conflict detection",
    body:
      "Venue Staff decide on each request, and overlapping bookings are caught before a venue is double-booked."
  },
  {
    title: "Equipment and reservations",
    body:
      "Technical Support Staff check what is genuinely free and reserve it against a specific event."
  },
  {
    title: "Registration and notifications",
    body:
      "Attendees register and withdraw, while everyone involved is told when something meaningful changes."
  }
];

const WORKFLOW = [
  {
    step: "01",
    title: "Request",
    body: "An Event Organiser submits the event, or saves a draft to finish later."
  },
  {
    step: "02",
    title: "Review",
    body:
      "An Event Coordinator is assigned, asks for anything missing, then approves or rejects."
  },
  {
    step: "03",
    title: "Venue",
    body:
      "Suitable venues are shortlisted, requested, and approved or rejected by Venue Staff."
  },
  {
    step: "04",
    title: "Equipment",
    body:
      "Technical Support Staff confirm availability and reserve equipment for the event date and time."
  },
  {
    step: "05",
    title: "Attend",
    body:
      "Registration opens, the event is confirmed, and later changes flow back through the same workflow."
  }
];

function PlatformOverview() {
  return (
    <>
      <section className="cs-section" id="platform">
        <h2>Everything the event workflow needs</h2>
        <p className="cs-section-lede">
          One connected workflow rather than a pile of spreadsheets and email
          threads.
        </p>

        <div className="cs-grid">
          {FEATURES.map((feature) => (
            <article className="cs-card" key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="cs-section cs-section-alt" id="roles">
        <h2>Signed in as you, not as everyone</h2>
        <p className="cs-section-lede">
          Your portal and work email set your role, and your role sets your
          screens.
        </p>

        <div className="cs-grid cs-grid-roles">
          {Object.entries(ROLE_META).map(([roleId, meta]) => (
            <article className="cs-card cs-card-role" key={roleId}>
              <span className="cs-pill">{PORTALS[meta.portal].tab}</span>
              <h3>{meta.label}</h3>
              <p>{meta.summary}</p>
              <ul className="cs-screen-list">
                {meta.screens.map((screen) => (
                  <li key={screen.name}>{screen.name}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="cs-section" id="workflow">
        <h2>How an event comes together</h2>

        <ol className="cs-steps">
          {WORKFLOW.map((item) => (
            <li key={item.step}>
              <span className="cs-step-number">{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="cs-cta">
        <h2>Ready when your next event is</h2>
        <p>
          Pick your portal, log in, and pick up exactly where your role leaves
          off.
        </p>
        <a className="cs-btn cs-btn-light" href="#sign-in">
          Go to log in
        </a>
      </section>
    </>
  );
}

export default PlatformOverview;
