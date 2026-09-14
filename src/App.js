import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import "./App.css";
import LandingPage, { ROLES, ROLE_META } from "./LandingPage";
import EventRequestForm from "./EventRequestForm";
import { auth, db } from "./firebase";

const screenHash = (role, name) => `#/${role.toLowerCase()}/${encodeURIComponent(name.toLowerCase().replaceAll(" ", "-"))}`;

function EventList({ user, status, onEdit }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const snapshot = await getDocs(query(collection(db, "events"), where("organiser_id", "==", user.uid)));
        const records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        if (mounted) setEvents(status ? records.filter((event) => event.status === status) : records);
      } catch (loadError) {
        console.error("Could not load events:", loadError);
        if (mounted) setError("We could not load your events. Please refresh and try again.");
      } finally { if (mounted) setLoading(false); }
    };
    load();
    return () => { mounted = false; };
  }, [status, user.uid]);

  if (loading) return <p className="cs-panel-note">Loading your events…</p>;
  if (error) return <p className="cs-error">{error}</p>;
  if (!events.length) return <p className="cs-panel-note">{status === "DRAFT" ? "You have no saved drafts." : "You have not submitted any events yet."}</p>;
  return <div className="cs-record-list">{events.map((event) => <article className="cs-record" key={event.id}><div><span className="cs-pill">{event.status}</span><h2>{event.name || "Untitled event"}</h2><p>{event.event_date || "Date not set"} · {event.start_time || "Time not set"}–{event.end_time || ""}</p></div><div className="cs-record-actions"><span className="cs-record-ref">{event.reference_no}</span>{onEdit && <button type="button" className="cs-link-btn" onClick={() => onEdit(event)}>Continue draft</button>}</div></article>)}</div>;
}

function Workspace({ user, role }) {
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

function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => onAuthStateChanged(auth, async (currentUser) => {
    if (!currentUser) { setUser(null); setRole(null); setLoading(false); return; }
    try {
      const profile = await getDoc(doc(db, "users", currentUser.uid));
      const storedRole = profile.exists() ? profile.data().role : null;
      setRole(ROLE_META[storedRole] ? storedRole : ROLES.ATTENDEE);
      setUser(currentUser);
    } catch (error) { console.error("Could not load the user's role:", error); setUser(null); setRole(null); }
    finally { setLoading(false); }
  }), []);
  if (loading) return <p className="cs-splash">Loading ConnectSphere…</p>;
  return user ? <Workspace user={user} role={role} /> : <LandingPage />;
}

export default App;
