// The signed-in shell: role sidebar, screen dispatch and the "not authorised"
// guard for a hash that does not belong to the current role.
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

export default function Workspace({ user, role }) {
  const meta = ROLE_META[role];
  const [registrationNotice] = useState(() => {
    const message = sessionStorage.getItem("cs-account-created") || "";
    sessionStorage.removeItem("cs-account-created");
    return message;
  });
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

  const chooseScreen = (name) => { setActiveScreen(name); setCurrentHash(screenHash(role, name)); setNotice(""); if (name !== "New event request") setSelectedDraft(null); window.location.hash = screenHash(role, name); };
  let contents;
  if (forbidden) contents = <><h1>Not authorised</h1><p className="cs-error">You are not authorised to access this function.</p></>;
  else if (role === ROLES.ORGANISER && screen.name === "New event request") contents = <><h1>{screen.name}</h1><p className="cs-lede">Tell us what you need. Save an incomplete request as a draft, or submit it when the core details are ready.</p>{notice && <p className="cs-success" role="status">{notice}</p>}<EventRequestForm user={user} draft={selectedDraft} onSaved={(message, savedDraft) => { setNotice(message); setSelectedDraft(savedDraft); }} /></>;
  else if (role === ROLES.ORGANISER && screen.name === "My drafts") contents = <><h1>My drafts</h1><p className="cs-lede">Incomplete requests saved for later.</p><EventList user={user} status="DRAFT" onEdit={(draft) => { setSelectedDraft(draft); chooseScreen("New event request"); }} /></>;
  else if (role === ROLES.ORGANISER && screen.name === "My events") contents = <><h1>My events</h1><p className="cs-lede">Only events created by your account are shown here.</p><EventList user={user} /></>;
  else contents = <><h1>{screen.name}</h1><p className="cs-lede">{screen.blurb}</p><p className="cs-panel-note">This screen is ready to be connected to its workflow in a later increment.</p></>;

  return <div className="cs-workspace"><header className="cs-nav cs-nav-app"><span className="cs-brand"><span className="cs-brand-mark" aria-hidden="true" />ConnectSphere</span><div className="cs-nav-actions"><span className="cs-pill">{meta.label}</span><span className="cs-user-email">{user.email}</span><button className="cs-btn cs-btn-ghost" type="button" onClick={() => { window.location.hash = "#/sign-in"; signOut(auth); }}>Log out</button></div></header><div className="cs-workspace-body"><nav className="cs-sidebar" aria-label="Your screens">{meta.screens.map((item) => <button key={item.name} type="button" className={item.name === screen.name && !forbidden ? "cs-sidebar-item cs-sidebar-item-active" : "cs-sidebar-item"} onClick={() => chooseScreen(item.name)}>{item.name}</button>)}</nav><main className="cs-panel">{registrationNotice && <p className="cs-success" role="status">{registrationNotice}</p>}{contents}</main></div></div>;
}
