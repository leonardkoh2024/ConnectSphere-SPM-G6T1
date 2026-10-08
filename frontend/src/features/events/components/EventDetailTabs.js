// The tab bar at the top of an event's detail page: the request on one tab, its
// clarification exchange on the other. Used by the organiser's request page and
// the coordinator's review detail, so the two read the same way.
//
// Every panel stays mounted and inactive ones are only hidden, so switching tab
// never throws away an organiser's unsaved amendment. Arrow keys, Home and End
// move between tabs, as the WAI-ARIA tabs pattern expects.

import React, { useRef } from "react";

export default function EventDetailTabs({ label = "Event sections", idPrefix = "event", tabs, active, onChange }) {
  const buttons = useRef({});

  const onKeyDown = (keyEvent) => {
    const index = tabs.findIndex((tab) => tab.id === active);
    const last = tabs.length - 1;
    const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[keyEvent.key];
    if (next === undefined) return;
    keyEvent.preventDefault();
    onChange(tabs[next].id);
    buttons.current[tabs[next].id]?.focus();
  };

  return <>
    <div className="cs-detail-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return <button
          key={tab.id}
          ref={(node) => { buttons.current[tab.id] = node; }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${tab.id}`}
          aria-selected={selected}
          aria-controls={`${idPrefix}-panel-${tab.id}`}
          tabIndex={selected ? 0 : -1}
          className={selected ? "cs-detail-tab cs-detail-tab-active" : "cs-detail-tab"}
          onClick={() => onChange(tab.id)}
          onKeyDown={onKeyDown}
        >
          {tab.label}
          {tab.count > 0 && <span className={tab.attention ? "cs-detail-tab-count cs-detail-tab-count-attention" : "cs-detail-tab-count"}>{tab.count}</span>}
          {tab.attention && <span className="cs-visually-hidden">, reply needed</span>}
        </button>;
      })}
    </div>
    {tabs.map((tab) => <div
      key={tab.id}
      role="tabpanel"
      id={`${idPrefix}-panel-${tab.id}`}
      aria-labelledby={`${idPrefix}-tab-${tab.id}`}
      className="cs-detail-tabpanel"
      hidden={tab.id !== active}
    >{tab.content}</div>)}
  </>;
}
