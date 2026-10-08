// A password input with an eye button that shows or hides what has been typed,
// and — when given `checks` — a live list of the password rules underneath it.
// Each rule is grey until the first character is typed, then red with a cross
// while unmet and green with a tick once met — an empty field is not yet wrong.
//
// The toggle is a real button outside the input's label, so it is reachable by
// keyboard, announces its state through aria-pressed, and never submits the form.

import React, { useState } from "react";
import Icon from "../../../app/Icon";

const checkState = (check, started) => {
  if (check.met) return { className: "cs-password-check cs-password-check-met", icon: "check", spoken: " — met" };
  if (started) return { className: "cs-password-check cs-password-check-unmet", icon: "circle-x", spoken: " — not met" };
  return { className: "cs-password-check", icon: "circle", spoken: "" };
};

export function PasswordChecklist({ id, checks, started = true }) {
  return (
    <ul className="cs-password-checks" id={id} aria-live="polite">
      {checks.map((check) => {
        const state = checkState(check, started);
        return (
          <li key={check.id} className={state.className}>
            <Icon name={state.icon} />
            <span>{check.label}</span>
            {state.spoken && <span className="cs-visually-hidden">{state.spoken}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export default function PasswordField({ id, label, value, onChange, checks, ...inputProps }) {
  const [visible, setVisible] = useState(false);
  const checksId = checks ? `${id}-checks` : undefined;

  return (
    <div className="cs-field">
      <label htmlFor={id}>{label}</label>
      <div className="cs-password-input">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          aria-describedby={checksId}
          {...inputProps}
        />
        <button
          type="button"
          className="cs-password-toggle"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((current) => !current)}
        >
          <Icon name={visible ? "eye-off" : "eye"} />
        </button>
      </div>
      {checks && <PasswordChecklist id={checksId} checks={checks} started={String(value || "").length > 0} />}
    </div>
  );
}
