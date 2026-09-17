// Confirmations, shown in the top-right corner rather than at the top of the
// panel. The event request form is long enough to scroll, and a message that only
// exists above the fold is a message the organiser has to go looking for.
//
// The list is one live region that stays in the DOM whether or not it holds
// anything, so a screen reader announces a toast arriving instead of having to
// notice a new region appear.

import React, { useEffect } from "react";
import Icon from "./Icon";

// Long enough to read a reference number off it without hurrying.
export const DISMISS_AFTER_MS = 8000;

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className={`cs-toast cs-toast-${toast.tone || "success"}`}>
      <Icon name={toast.tone === "error" ? "bell" : "check"} />
      <p>{toast.message}</p>
      <button type="button" className="cs-toast-close" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
        <Icon name="close" />
      </button>
    </div>
  );
}

export default function Toasts({ toasts, onDismiss }) {
  return (
    <div className="cs-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />)}
    </div>
  );
}
