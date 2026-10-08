// The marketing half of the landing page: what the platform does, who each role
// is, and how an event moves through the workflow. Presentational only — it holds
// no state and performs no Firebase calls, so it renders from the role model alone.

import React from "react";
import { ROLE_META } from "../../../domain/roles";
import { PORTALS } from "../../../domain/portals";
import Icon from "../../../app/Icon";

const FEATURES = [
  {
    icon: "draft",
    title: "Requests and drafts",
    body:
      "Submit a request, or save a draft for later."
  },
  {
    icon: "clipboard",
    title: "Review, approval and assignment",
    body:
      "Coordinators clarify, approve or reject."
  },
  {
    icon: "building",
    title: "Venue catalogue and availability",
    body:
      "Capacity, facilities and layouts at a glance."
  },
  {
    icon: "check",
    title: "Booking approval and conflict detection",
    body:
      "No venue is ever double-booked."
  },
  {
    icon: "equipment",
    title: "Equipment and reservations",
    body:
      "Reserve only what is genuinely free."
  },
  {
    icon: "bell",
    title: "Registration and notifications",
    body:
      "Attendees sign up; everyone stays informed."
  }
];

const WORKFLOW = [
  {
    step: "01",
    title: "Request",
    body: "An organiser submits the event."
  },
  {
    step: "02",
    title: "Review",
    body:
      "A coordinator approves or rejects it."
  },
  {
    step: "03",
    title: "Venue",
    body:
      "Venue Staff confirm a venue."
  },
  {
    step: "04",
    title: "Equipment",
    body:
      "Technical Support reserve equipment."
  },
  {
    step: "05",
    title: "Attend",
    body:
      "Registration opens and the event runs."
  }
];

function PlatformOverview() {
  return (
    <>
      <section className="cs-section" id="platform">
        <h2>Everything an event needs</h2>

        <div className="cs-grid">
          {FEATURES.map((feature) => (
            <article className="cs-card cs-card-feature" key={feature.title}>
              <span className="cs-feature-icon" aria-hidden="true"><Icon name={feature.icon} /></span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="cs-section cs-section-alt" id="roles">
        <h2>One login, the right screens</h2>

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
        <a className="cs-btn cs-btn-light" href="#sign-in">
          Go to log in
        </a>
      </section>
    </>
  );
}

export default PlatformOverview;
