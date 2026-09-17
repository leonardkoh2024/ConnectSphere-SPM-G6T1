// The Yes/No question each optional section of the event request opens with.
//
// Two radios rather than a single checkbox, because a checkbox has no unanswered
// state: an untouched box and a deliberate "no" look identical, and B9 AC2 needs
// them told apart. Nothing is pre-selected unless the caller asks for it.

import React from "react";
import { YES, NO } from "../../../domain/eventRequest";

export default function YesNo({ question, name, value, onChange, disabled = false, required = true }) {
  return (
    <fieldset className="cs-yesno" disabled={disabled}>
      <legend>
        {question}
        {required && <span className="cs-required" aria-hidden="true">*</span>}
      </legend>
      <div className="cs-yesno-options">
        {[[YES, "Yes"], [NO, "No"]].map(([option, label]) => (
          <label key={option} className="cs-check">
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              disabled={disabled}
              onChange={() => onChange(option)}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
