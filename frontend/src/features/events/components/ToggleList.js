// A labelled group of multi-select checkboxes, used for facilities and
// accessibility needs on the event request form.

import React from "react";

export default function ToggleList({ label, options, values, onChange }) {
  return (
    <fieldset className="cs-choice-group">
      <legend>{label}</legend>
      <div className="cs-choice-list">
        {options.map((option) => (
          <label key={option} className="cs-check">
            <input
              type="checkbox"
              checked={values.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...values, option]
                    : values.filter((value) => value !== option)
                )
              }
            />
            {option.replaceAll("_", " ")}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
