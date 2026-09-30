// The signed-in shell: role sidebar, screen dispatch and the "not authorised"
// guard for a hash that does not belong to the current role. The sidebar carries
// everything chrome-like — brand, screens, and the signed-in user at its foot —
// so there is no top bar and the main panel gets the full height.
//
// As each epic is picked up its screens should be rendered from its own feature
// folder and added to the dispatch below, rather than growing this file inline.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { ROLES, ROLE_META } from "../domain/roles";
import { screenHash } from "./routes";
import EventRequestForm from "../features/events/EventRequestForm";
import EventList from "../features/events/EventList";
import EventReviewScreen from "../features/events/EventReviewScreen";
import DecisionSummary from "../features/events/components/DecisionSummary";
import VenueCatalogue from "../features/venues/VenueCatalogue";
import VenueAvailabilityCalendar from "../features/venues/VenueAvailability";
import VenueSearch from "../features/venues/VenueSearch";
import Icon from "./Icon";
import Toasts from "./Toasts";

export default function Workspace({ user, role }) {
  const meta = ROLE_META[role];
  // Confirmations are toasts in the corner, not a line at the top of a panel the
   // organiser has scrolled away from. The account-created message arrives the same
   // way, having been left in sessionStorage by the landing page.
  const [toasts, setToasts] = useState(() => {
    const message = sessionStorage.getItem("cs-account-created") || "";
    sessionStorage.removeItem("cs-account-created");
    return message ? [{ id: "account-created", message }] : [];
  });

  const showToast = useCallback((message, tone = "success") => {
    setToasts((current) => [...current, { id: `${Date.now()}-${current.length}`, message, tone }]);
  }, []);

  const dismissToast = useCallback((id) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem("cs-nav-collapsed") === "1");
  const initialScreen = useMemo(() => meta.screens.find((item) => screenHash(role, item.name) === window.location.hash)?.name || meta.screens[0].name, [meta.screens, role]);
  const [activeScreen, setActiveScreen] = useState(initialScreen);
  const [currentHash, setCurrentHash] = useState(window.location.hash);
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [searchEvent, setSearchEvent] = useState(null);
  const requestedPath = currentHash;
  const pathLooksProtected = requestedPath.startsWith("#/") && requestedPath !== "#/sign-in";
  const requestedScreen = meta.screens.find((item) => screenHash(role, item.name) === requestedPath);
  const forbidden = pathLooksProtected && !requestedScreen;
  const screen = meta.screens.find((item) => item.name === activeScreen) || meta.screens[0];

  useEffect(() => {
    const syncFromHash = () => { setCurrentHash(window.location.hash); const found = meta.screens.find((item) => screenHash(role, item.name) === window.location.hash); if (found) setActiveScreen(found.name); };
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [meta.screens, role]);

  useEffect(() => { localStorage.setItem("cs-nav-collapsed", navCollapsed ? "1" : "0"); }, [navCollapsed]);

  // Every screen opens with the same header, which is what `.cs-panel-head`
  // sticks to the top of the scrolling panel.
  const head = (title, lede, action, back) => <header className="cs-panel-head">{back}<div className="cs-panel-head-row"><h1>{title}</h1>{action}</div>{lede ? <p className="cs-lede">{lede}</p> : null}</header>;

  const backToMyEvents = (
    <button type="button" className="cs-btn cs-btn-ghost cs-back" onClick={() => chooseScreen("My events")}>
      <Icon name="chevron-left" />Back to my events
    </button>
  );

  const chooseScreen = (name, extras = {}) => {
    setActiveScreen(name);
    setCurrentHash(screenHash(role, name));
    if (name !== "New event request") setSelectedDraft(null);
    setSearchEvent(name === "Venue search" ? extras.event || null : null);
    window.location.hash = screenHash(role, name);
  };
  let contents;
  if (forbidden) contents = <>{head("Not authorised")}<p className="cs-error">You are not authorised to access this function.</p></>;
  else if (role === ROLES.ORGANISER && screen.name === "New event request") contents = <>{head(selectedDraft ? "Event request" : screen.name, "Tell us what you need. Save an incomplete request as a draft, or submit it when the core details are ready.", null, backToMyEvents)}{selectedDraft && String(selectedDraft.status || "").toUpperCase() !== "DRAFT" && <DecisionSummary event={selectedDraft} onChanged={showToast} />}<EventRequestForm user={user} draft={selectedDraft} readOnly={Boolean(selectedDraft && selectedDraft.status && String(selectedDraft.status).toUpperCase() !== "DRAFT" && !(String(selectedDraft.status).toUpperCase() === "UNDER_REVIEW" && selectedDraft.open_clarification_id))} onSaved={(message, savedDraft) => { showToast(message); setSelectedDraft(savedDraft); if (!savedDraft) chooseScreen("My events"); }} /></>;
  else if (role === ROLES.ORGANISER && screen.name === "My events") contents = <>{head("My events", "Only events created by your account are shown here. A draft can be picked up again from this list.")}<EventList user={user} role={role} onCreate={() => { setSelectedDraft(null); chooseScreen("New event request"); }} onEdit={(draft) => { setSelectedDraft(draft); chooseScreen("New event request"); }} onView={(event) => { setSelectedDraft(event); chooseScreen("New event request"); }} onDeleted={(message) => showToast(message)} /></>;
  else if (role === ROLES.COORDINATOR && screen.name === "Review queue") contents = <>{head(screen.name, screen.blurb)}<EventReviewScreen queueOnly onNotice={showToast} onFindVenues={(event) => chooseScreen("Venue search", { event })} /></>;
  else if (role === ROLES.COORDINATOR && screen.name === "Assigned events") contents = <>{head(screen.name, screen.blurb)}<EventReviewScreen onNotice={showToast} onFindVenues={(event) => chooseScreen("Venue search", { event })} /></>;
  else if (role === ROLES.COORDINATOR && screen.name === "Venue search") contents = <>{head(screen.name, searchEvent ? `Shortlist for ${searchEvent.name || searchEvent.reference_no}.` : screen.blurb)}<VenueSearch event={searchEvent} /></>;
  else if (role === ROLES.COORDINATOR && screen.name === "Venue catalogue") contents = <>{head(screen.name, screen.blurb)}<VenueCatalogue user={user} role={role} /></>;
  else if (role === ROLES.VENUE_STAFF && screen.name === "Venue catalogue") contents = <>{head(screen.name, screen.blurb)}<VenueCatalogue user={user} role={role} /></>;
  else if (role === ROLES.VENUE_STAFF && screen.name === "Availability calendar") contents = <>{head(screen.name, screen.blurb)}<VenueAvailabilityCalendar user={user} role={role} /></>;
  else contents = <>{head(screen.name, screen.blurb)}<p className="cs-panel-note">This screen is ready to be connected to its workflow in a later increment.</p></>;

  return <div className={navCollapsed ? "cs-workspace cs-workspace-collapsed" : "cs-workspace"}><div className="cs-workspace-body"><nav className="cs-sidebar" aria-label="Your screens"><div className="cs-sidebar-head"><span className="cs-brand"><span className="cs-brand-mark" aria-hidden="true" /><span className="cs-sidebar-label">ConnectSphere</span></span><button type="button" className="cs-sidebar-toggle" aria-expanded={!navCollapsed} aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"} title={navCollapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => setNavCollapsed((value) => !value)}><Icon name={navCollapsed ? "chevron-right" : "chevron-left"} /></button></div><div className="cs-sidebar-screens">{meta.screens.filter((item) => !item.hidden).map((item) => <button key={item.name} type="button" title={item.name} className={item.name === screen.name && !forbidden ? "cs-sidebar-item cs-sidebar-item-active" : "cs-sidebar-item"} onClick={() => chooseScreen(item.name)}><Icon name={item.icon} /><span className="cs-sidebar-label">{item.name}</span></button>)}</div><div className="cs-sidebar-user"><div className="cs-sidebar-user-row"><span className="cs-sidebar-avatar" aria-hidden="true">{(user.email || "?").charAt(0).toUpperCase()}</span><div className="cs-sidebar-label cs-sidebar-user-detail"><span className="cs-pill">{meta.label}</span><span className="cs-user-email" title={user.email}>{user.email}</span></div></div><button className="cs-btn cs-btn-ghost cs-sidebar-logout" type="button" title="Log out" aria-label="Log out" onClick={() => { window.location.hash = "#/sign-in"; signOut(auth); }}><Icon name="log-out" /><span className="cs-sidebar-label">Log out</span></button></div></nav><main className="cs-panel-scroll"><div className="cs-panel">{contents}</div></main></div><Toasts toasts={toasts} onDismiss={dismissToast} /></div>;
}
