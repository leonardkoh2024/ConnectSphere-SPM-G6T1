// The tile at the head of a record row, so a list scans by shape before it is read:
// an event shows its date as a small calendar leaf, anything else shows an icon.
// Shared by the events and venues lists.

import React from "react";
import Icon from "../app/Icon";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// `event_date` is stored as YYYY-MM-DD. Anything else (a draft with no date yet)
// falls back to the icon rather than guessing.
const dateParts = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? { month, day: Number(match[3]) } : null;
};

export default function RecordLead({ date, icon = "calendar" }) {
  const parts = date === undefined ? null : dateParts(date);
  if (parts) {
    return (
      <span className="cs-record-lead cs-record-lead-date" aria-hidden="true">
        <span className="cs-record-lead-month">{parts.month}</span>
        <span className="cs-record-lead-day">{parts.day}</span>
      </span>
    );
  }
  return <span className="cs-record-lead" aria-hidden="true"><Icon name={icon} /></span>;
}
