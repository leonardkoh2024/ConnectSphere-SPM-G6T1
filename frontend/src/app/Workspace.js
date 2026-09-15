// The signed-in shell: role sidebar, screen dispatch and the "not authorised"
// guard for a hash that does not belong to the current role. The sidebar carries
// everything chrome-like — brand, screens, and the signed-in user at its foot —
// so there is no top bar and the main panel gets the full height.
//
// As each epic is picked up its screens should be rendered from its own feature
// folder and added to the dispatch below, rather than growing this file inline.

import React, { useEffect, useMemo, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { ROLES, ROLE_META } from "../domain/roles";
import { screenHash } from "./routes";
import EventRequestForm from "../features/events/EventRequestForm";
import EventList from "../features/events/EventList";
import Icon from "./Icon";

export default function Workspace({ user, role }) {
  const meta = ROLE_META[role];
  const [registrationNotice] = useState(() => {
    const message = sessionStorage.getItem("cs-account-created") || "";
    sessionStorage.removeItem("cs-account-created");
    return message;
  });
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem("cs-nav-collapsed") === "1");
  const initialScreen = useMemo(() => meta.screens.find((item) => screenHash(role, item.name) === window.location.hash)?.name || meta.screens[0].name, [meta.screens, role]);
  const [activeScreen, setActiveScreen] = useState(initialScreen);
  const [currentHash, setCurrentHash] = useState(window.location.hash);
  const [notice, setNotice] = useState("");
  const [selectedDraft, setSelectedDraft] = useState(null);
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

  const chooseScreen = (name) => { setActiveScreen(name); setCurrentHash(screenHash(role, name)); setNotice(""); if (name !== "New event request") setSelectedDraft(null); window.location.hash = screenHash(role, name); };
  let contents;
  if (forbidden) contents = <><h1>Not authorised</h1><p className="cs-error">You are not authorised to access this function.</p></>;
  else if (role === ROLES.ORGANISER && screen.name === "New event request") contents = <><h1>{screen.name}</h1><p className="cs-lede">Tell us what you need. Save an incomplete request as a draft, or submit it when the core details are ready.</p>{notice && <p className="cs-success" role="status">{notice}</p>}<EventRequestForm user={user} draft={selectedDraft} onSaved={(message, savedDraft) => { setNotice(message); setSelectedDraft(savedDraft); }} /></>;
  else if (role === ROLES.ORGANISER && screen.name === "My drafts") contents = <><h1>My drafts</h1><p className="cs-lede">Incomplete requests saved for later.</p><EventList user={user} status="DRAFT" onEdit={(draft) => { setSelectedDraft(draft); chooseScreen("New event request"); }} /></>;
  else if (role === ROLES.ORGANISER && screen.name === "My events") contents = <><h1>My events</h1><p className="cs-lede">Only events created by your account are shown here.</p><EventList user={user} /></>;
  else contents = <><h1>{screen.name}</h1><p className="cs-lede">{screen.blurb}</p><p className="cs-panel-note">This screen is ready to be connected to its workflow in a later increment.</p></>;

  return <div className={navCollapsed ? "cs-workspace cs-workspace-collapsed" : "cs-workspace"}><div className="cs-workspace-body"><nav className="cs-sidebar" aria-label="Your screens"><div className="cs-sidebar-head"><span className="cs-brand"><span className="cs-brand-mark" aria-hidden="true" /><span className="cs-sidebar-label">ConnectSphere</span></span><button type="button" className="cs-sidebar-toggle" aria-expanded={!navCollapsed} aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"} title={navCollapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => setNavCollapsed((value) => !value)}><Icon name={navCollapsed ? "chevron-right" : "chevron-left"} /></button></div><div className="cs-sidebar-screens">{meta.screens.map((item) => <button key={item.name} type="button" title={item.name} className={item.name === screen.name && !forbidden ? "cs-sidebar-item cs-sidebar-item-active" : "cs-sidebar-item"} onClick={() => chooseScreen(item.name)}><Icon name={item.icon} /><span className="cs-sidebar-label">{item.name}</span></button>)}</div><div className="cs-sidebar-user"><div className="cs-sidebar-user-row"><span className="cs-sidebar-avatar" aria-hidden="true">{(user.email || "?").charAt(0).toUpperCase()}</span><div className="cs-sidebar-label cs-sidebar-user-detail"><span className="cs-pill">{meta.label}</span><span className="cs-user-email" title={user.email}>{user.email}</span></div></div><button className="cs-btn cs-btn-ghost cs-sidebar-logout" type="button" title="Log out" onClick={() => { window.location.hash = "#/sign-in"; signOut(auth); }}><Icon name="log-out" /><span className="cs-sidebar-label">Log out</span></button></div></nav><main className="cs-panel-scroll"><div className="cs-panel">{registrationNotice && <p className="cs-success" role="status">{registrationNotice}</p>}{contents}</div></main></div></div>;
}
