// A field that reads like a select but holds several choices: closed, it shows
// a summary ("All venues", "Hall A", "3 venues"); open, a list of checkboxes.
// Built for the availability calendar's venue filter (E4), where laying every
// venue out as a pill would fill the page as the catalogue grows.
//
// Nothing ticked means "all", which is why the first row is an "All …" box that
// is ticked exactly when nothing else is, and clears the rest when ticked.

import React, { useEffect, useId, useRef, useState } from "react";
import Icon from "../../../app/Icon";

export default function MultiSelectDropdown({ label, allLabel, pluralLabel, options, values, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const labelId = useId();
  const valueId = useId();
  const panelId = useId();

  // Closes on a click anywhere outside the field.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const onKeyDown = (event) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  const chosen = options.filter((option) => values.includes(option.value));
  const summary = chosen.length === 0 ? allLabel : chosen.length === 1 ? chosen[0].label : `${chosen.length} ${pluralLabel}`;
  const toggle = (value, on) => onChange(on ? [...values, value] : values.filter((item) => item !== value));

  return (
    <div className="cs-field cs-multiselect" ref={rootRef} onKeyDown={onKeyDown}>
      <span className="cs-field-name" id={labelId}>{label}</span>
      <button
        type="button"
        ref={buttonRef}
        className="cs-multiselect-toggle"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span id={valueId} className="cs-multiselect-value">{summary}</span>
        <Icon name="chevron-down" />
      </button>
      {open && (
        <div className="cs-multiselect-panel" id={panelId} role="group" aria-labelledby={labelId}>
          <label className="cs-multiselect-option">
            <input type="checkbox" checked={values.length === 0} onChange={() => onChange([])} />
            {allLabel}
          </label>
          {options.map((option) => (
            <label className="cs-multiselect-option" key={option.value}>
              <input type="checkbox" checked={values.includes(option.value)} onChange={(event) => toggle(option.value, event.target.checked)} />
              {option.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
