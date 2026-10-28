// One event as an attendee sees it: what, when and where, then whatever the screen
// adds about their own place (`facts`, as [label, value] pairs). Used after registering
// on Browse events (H3 AC4) and from My registrations (H4 AC2).

import React from "react";
import Icon from "../../../app/Icon";
import RecordLead from "../../../components/RecordLead";
import { venueLabel } from "../../../domain/openRegistration";
import { eventDay, timeWindow } from "../format";

// `venue` overrides the usual venue wording when the screen knows better; `actions` are the
// screen's own buttons for this event, such as Withdraw (H5).
export default function EventDetails({ entry, venue, notice = null, facts = [], actions = null, backLabel, onClose }) {
  const name = entry.name || "Untitled event";
  return (
    <section className="cs-browse-details" aria-label={name}>
      {onClose && <button type="button" className="cs-btn cs-btn-ghost cs-back" onClick={onClose}><Icon name="chevron-left" />Back to {backLabel}</button>}
      {notice}
      {/* The screen's own actions sit at the top right, beside the event's name. */}
      <div className="cs-browse-details-head">
        <div className="cs-record-title">
          <RecordLead date={entry.event_date} />
          <div>
            <h2>{name}</h2>
            {entry.description && <p>{entry.description}</p>}
          </div>
        </div>
        {actions && <div className="cs-browse-details-actions">{actions}</div>}
      </div>
      <dl className="cs-detail-grid">
        <div><dt>Date</dt><dd>{eventDay(entry.event_date)}</dd></div>
        <div><dt>Time</dt><dd>{timeWindow(entry)}</dd></div>
        <div className="cs-detail-wide"><dt>Venue</dt><dd>{venue ?? venueLabel(entry.venue_names)}</dd></div>
        {facts.filter(Boolean).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </section>
  );
}
