import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import "./App.css";
import LandingPage, { ROLES, ROLE_META } from "./LandingPage";
import { auth, db } from "./firebase";

// Signed-in shell. The role loaded from Firestore decides which screens appear in
// the sidebar, so an attendee never sees coordinator or venue screens.
function Workspace({ user, role }) {
  const meta = ROLE_META[role];
  const [activeScreen, setActiveScreen] = useState(meta.screens[0].name);
  const screen =
    meta.screens.find((item) => item.name === activeScreen) || meta.screens[0];

  return (
    <div className="cs-workspace">
      <header className="cs-nav cs-nav-app">
        <span className="cs-brand">
          <span className="cs-brand-mark" aria-hidden="true" />
          ConnectSphere
        </span>

        <div className="cs-nav-actions">
          <span className="cs-pill">{meta.label}</span>
          <span className="cs-user-email">{user.email}</span>
          <button
            className="cs-btn cs-btn-ghost"
            type="button"
            onClick={() => signOut(auth)}
          >
            Log out
          </button>
        </div>
      </header>

      <div className="cs-workspace-body">
        <nav className="cs-sidebar" aria-label="Your screens">
          {meta.screens.map((item) => (
            <button
              key={item.name}
              type="button"
              className={
                item.name === screen.name
                  ? "cs-sidebar-item cs-sidebar-item-active"
                  : "cs-sidebar-item"
              }
              onClick={() => setActiveScreen(item.name)}
            >
              {item.name}
            </button>
          ))}
        </nav>

        <main className="cs-panel">
          <h1>{screen.name}</h1>
          <p className="cs-lede">{screen.blurb}</p>
          <p className="cs-panel-note">
            This screen is on the product backlog and is not part of the landing
            page increment.
          </p>
        </main>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setUser(null);
        setRole(null);
        setLoading(false);
        return;
      }

      let storedRole = null;

      try {
        const profile = await getDoc(doc(db, "users", currentUser.uid));
        storedRole = profile.exists() ? profile.data().role : null;
      } catch (error) {
        console.error("Could not load the user's role:", error);
      }

      // Fall back to the least privileged role rather than guessing upwards.
      setUser(currentUser);
      setRole(ROLE_META[storedRole] ? storedRole : ROLES.ATTENDEE);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <p className="cs-splash">Loading ConnectSphere…</p>;
  }

  if (!user) {
    return <LandingPage />;
  }

  return <Workspace user={user} role={role} />;
}

export default App;
