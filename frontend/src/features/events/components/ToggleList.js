// A labelled group of multi-select checkboxes, used for facilities and
// accessibility needs on the event request form.
//
// Whether the group has to hold anything is decided by the Yes/No question above
// it, not here — see YesNo. This component only carries the red marker so the
// organiser can see the choice is compulsory once they have answered Yes.

import React from "react";

export default function ToggleList({ label, options, values, onChange, disabled = false, required = false }) {
  return (
    <fieldset className="cs-choice-group" disabled={disabled}>
      <legend>
        {label}
        {required && <span className="cs-required" aria-hidden="true">*</span>}
      </legend>
      <div className="cs-choice-list">
        {options.map((option) => (
          <label key={option} className="cs-check">
            <input
              type="checkbox"
              disabled={disabled}
              checked={values.includes(option)}
              onChange={(event) =>
                onChange(event.target.checked ? [...values, option] : values.filter((value) => value !== option))
              }
            />
            {option.replaceAll("_", " ")}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
