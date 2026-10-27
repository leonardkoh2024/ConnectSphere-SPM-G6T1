// H5 / SCRUM-143 — the confirmation before an attendee gives up their place, used from a
// My registrations row and from an event's details on either attendee screen.
// `state` is { name, waitlisted, busy, error, final }; `final` means asking again cannot succeed.
// H6 — leaving the waiting list is asked about in its own words.

import React from "react";

export default function WithdrawDialog({ state, onKeep, onConfirm }) {
  return (
    <div className="cs-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !state.busy) onKeep(); }}>
      <div className="cs-modal" role="dialog" aria-modal="true" aria-labelledby="cs-withdraw-title">
        <h2 id="cs-withdraw-title">{state.waitlisted ? "Leave the waiting list for" : "Withdraw from"} {state.name || "this event"}?</h2>
        <p>
          {state.waitlisted
            ? "You will lose your place in the queue, and everyone behind you moves up. You can join again at the back while the event is full."
            : "Your place will be released for someone else. You can register again only while registration is open and a place is free."}
        </p>
        {state.error && <p className="cs-error" role="alert">{state.error}</p>}
        <div className="cs-modal-actions">
          {/* The safe choice takes focus, so Enter on an unread dialog keeps the place. */}
          <button type="button" autoFocus className="cs-btn cs-btn-ghost" disabled={state.busy} onClick={onKeep}>
            {state.final ? "Close" : "Keep my place"}
          </button>
          {!state.final && (
            <button type="button" className="cs-btn cs-btn-ghost cs-record-danger" disabled={state.busy} onClick={onConfirm}>
              {state.busy ? "Withdrawing…" : "Yes, withdraw"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Refusals after which asking again cannot succeed, so Withdraw is taken away.
export const FINAL_WITHDRAW_REFUSALS = ["not_registered", "event_started", "event_closed", "not_found"];
export const WITHDRAW_FAILED = "You could not be withdrawn. Try again.";
