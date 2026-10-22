// D1 AC2 — the Activity tab on the coordinator's event page: every recorded
// change to the event, newest first, with who made it, when, and each field's
// old and new value.

import React from "react";
import { activityEntries } from "../../../domain/ordinaryEventChanges";

const shownTime = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";

export default function ActivityLog({ history = [], actorNames = {} }) {
  const entries = activityEntries(history, actorNames);
  if (!entries.length) return <p className="cs-panel-note">No activity has been recorded for this event yet.</p>;
  return <section className="cs-exchange cs-activity" aria-label="Event activity">
    <h3>Activity</h3>
    {entries.map((entry) => <article key={entry.id}>
      <strong>{entry.action}</strong>
      <time dateTime={entry.at || undefined}>{shownTime(entry.at)}</time>
      <p className="cs-activity-actor">by {entry.actor}</p>
      {entry.description && <p>{entry.description}</p>}
      {entry.reason && entry.reason !== entry.description && <p>{entry.reason}</p>}
      {entry.changes.length > 0 && <dl className="cs-activity-changes">
        {entry.changes.map((change) => <div key={change.field}>
          <dt>{change.label}</dt>
          <dd><span className="cs-activity-old">{change.oldValue}</span> → <span>{change.newValue}</span></dd>
        </div>)}
      </dl>}
    </article>)}
  </section>;
}
