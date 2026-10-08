// The organiser's page for one event request. A new request or a draft is just
// the form. Once submitted, the page splits into two tabs: the request (its
// decision and the form, read-only except while a clarification is open — C5)
// and the clarification exchange, where the organiser answers an open question.
// It opens on Clarifications when an answer is owed.

import React, { useEffect, useState } from "react";
import { EVENT_TABS, clarificationSummary, initialEventTab } from "../../domain/eventReview";
import { reviewApi } from "./reviewApi";
import EventRequestForm from "./EventRequestForm";
import DecisionSummary from "./components/DecisionSummary";
import ClarificationThread from "./components/ClarificationThread";
import EventDetailTabs from "./components/EventDetailTabs";

const isDraft = (event) => !event || !event.status || String(event.status).toUpperCase() === "DRAFT";

export default function OrganiserEventDetail({ user, event, onSaved, onNotice }) {
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState(EVENT_TABS.REQUEST);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitted = !isDraft(event);

  const load = async () => {
    try {
      const data = await reviewApi.detail(event.id);
      setDetail(data);
      return data;
    } catch (loadError) { setError(loadError.message); return null; }
  };

  useEffect(() => {
    if (!submitted) return;
    setDetail(null); setError("");
    load().then((data) => { if (data) setTab(initialEventTab(data, { organiser: true })); });
  }, [event?.id, submitted]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!submitted) return <EventRequestForm user={user} draft={event} onSaved={onSaved} />;

  // Editable only in C5's window: Under Review with a clarification still open.
  // Read from the freshly loaded event, so answering closes the window at once.
  const current = detail?.event || event;
  const amending = String(current.status || "").toUpperCase() === "UNDER_REVIEW" && Boolean(current.open_clarification_id);
  const summary = clarificationSummary(detail);
  const open = detail?.clarifications.find((item) => item.id === detail.event.open_clarification_id);

  const respond = async (submitEvent) => {
    submitEvent.preventDefault();
    if (!answer.trim()) { setError("Response message is required."); return; }
    setBusy(true); setError("");
    try {
      await reviewApi.respond(event.id, open.id, answer);
      setAnswer("");
      await load();
      onNotice?.("Your clarification response was sent.");
    } catch (responseError) { setError(responseError.message); }
    finally { setBusy(false); }
  };

  if (!detail && !error) return <p className="cs-panel-note">Loading event request…</p>;

  const requestTab = <>
    {detail && <DecisionSummary detail={detail} />}
    <EventRequestForm user={user} draft={event} readOnly={!amending} onSaved={onSaved} />
  </>;

  const clarificationsTab = <>
    {detail && <ClarificationThread clarifications={detail.clarifications} responses={detail.responses} />}
    {open && <form className="cs-inline-form" onSubmit={respond} noValidate>
      <label className="cs-field"><span className="cs-field-name">Your response<span className="cs-required" aria-hidden="true">*</span></span><textarea rows="3" required value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
      <button className="cs-btn cs-btn-primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Send response"}</button>
    </form>}
  </>;

  return <>
    {error && <p className="cs-error">{error}</p>}
    <EventDetailTabs
      label="Event request sections"
      idPrefix={`organiser-${event.id}`}
      active={tab}
      onChange={setTab}
      tabs={[
        { id: EVENT_TABS.REQUEST, label: "Event request", content: requestTab },
        { id: EVENT_TABS.CLARIFICATIONS, label: "Clarifications", count: summary.requests, attention: summary.awaitingOrganiser, content: clarificationsTab }
      ]}
    />
  </>;
}
