// Auth gate. Resolves the signed-in user's role from their Firestore profile and
// hands off to the workspace shell, or shows the public landing page.

import React, { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import "./App.css";
import { auth, db } from "../lib/firebase";
import { ROLES, ROLE_META } from "../domain/roles";
import LandingPage from "../features/auth/LandingPage";
import Workspace from "./Workspace";

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
