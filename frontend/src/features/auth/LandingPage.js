// Public entry point for ConnectSphere. Visitors land here, pick the portal that
// matches who they are, and sign in. The portal plus the email address decide the
// role that is stored on the user's Firestore document, and the app shell uses that
// role to decide which screens the signed-in user is allowed to see.
//
// The role model, the portal list and the account rules live in `src/domain/`;
// the marketing sections below the fold live in `components/PlatformOverview`.

import React, { useState } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { ROLES, ROLE_META } from "../../domain/roles";
import { PORTALS } from "../../domain/portals";
import {
  isStrongPassword,
  isValidMobileNumber,
  passwordChecks
} from "../../domain/accounts";
import PlatformOverview from "./components/PlatformOverview";
import PasswordField from "./components/PasswordField";

function LandingPage() {
  const [portal, setPortal] = useState(PORTALS.individual.id);
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [preferredContactMethod, setPreferredContactMethod] = useState("EMAIL");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => {
    const message = sessionStorage.getItem("cs-login-error") || "";
    sessionStorage.removeItem("cs-login-error");
    return message;
  });

  const activePortal = PORTALS[portal];
  const isCorporate = portal === PORTALS.corporate.id;

  const switchPortal = (nextPortal) => {
    setPortal(nextPortal);
    setError("");
    setSuccess("");
  };

  // The header actions always mean "take me to sign in". This is deliberately
  // separate from switching tabs inside the form, where a visitor may be
  // comparing the two registration paths and should remain in that mode.
  const openLogin = (nextPortal) => {
    switchPortal(nextPortal);
    setMode("login");
    setPassword("");
    setConfirmPassword("");
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Enter your full name to create an account.");
      return;
    }

    if (isCorporate && !organisationName.trim()) {
      setError("Enter your organisation name to create an organiser account.");
      return;
    }

    if (!mobileNumber.trim() || !preferredContactMethod) {
      setError("Enter your mobile number and preferred contact method to create an account.");
      return;
    }

    if (!isValidMobileNumber(mobileNumber)) {
      setError("Enter a mobile number containing between 7 and 15 digits.");
      return;
    }

    if (!isStrongPassword(password)) {
      setError("Choose a password with at least 12 characters, including a number and special character.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Your passwords do not match.");
      return;
    }

    setBusy(true);

    try {
      const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
      );

        await setDoc(doc(db, "users", credential.user.uid), {
          user_id: credential.user.uid,
          name: name.trim(),
          email: credential.user.email,
          // Public registration deliberately grants no staff capability. Other
          // staff roles are provisioned by an administrator.
          role: isCorporate ? ROLES.ORGANISER : ROLES.ATTENDEE,
          organisation_name: isCorporate ? organisationName.trim() : null,
          mobile_number: mobileNumber.trim(),
          preferred_contact_method: preferredContactMethod,
          is_active: true,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp()
        });
        sessionStorage.setItem("cs-account-created", "Your account has been created successfully.");
        setSuccess("Your account has been created. You are now signed in.");
    } catch (authError) {
      // Authentication errors must not disclose whether a particular mailbox is
      // registered, nor the role attached to it.
      setError(
        authError.code === "auth/email-already-in-use"
          ? "We could not create an account with those details. Please check them and try again."
          : "We could not sign you in or create your account with those details. Please check them and try again."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const profile = await getDoc(doc(db, "users", credential.user.uid));
      const storedRole = profile.exists() ? profile.data().role : null;
      const storedPortal = ROLE_META[storedRole]?.portal;
      // A correct password used on the wrong portal is deliberately presented as
      // a generic sign-in failure, and its just-created Firebase session is ended.
      if (!storedPortal || storedPortal !== portal) {
        const loginError = "This account cannot be used in this portal. Please use the correct sign-in area.";
        sessionStorage.setItem("cs-login-error", loginError);
        await signOut(auth);
        setError(loginError);
      }
    } catch (authError) {
      setError("We could not sign you in with those details. Please check them and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cs-page">
      <header className="cs-nav">
        <a className="cs-brand" href="#top">
          <span className="cs-brand-mark" aria-hidden="true" />
          ConnectSphere
        </a>

        <div className="cs-nav-actions">
          <a
            className="cs-btn cs-btn-ghost"
            href="#sign-in"
            onClick={() => openLogin(PORTALS.individual.id)}
          >
            Attendee log in
          </a>
          <a
            className="cs-btn cs-btn-primary"
            href="#sign-in"
            onClick={() => openLogin(PORTALS.corporate.id)}
          >
            Staff log in
          </a>
        </div>
      </header>

      <main id="top">
        <section className="cs-hero">
          <div className="cs-hero-copy">
            <p className="cs-eyebrow">Corporate event management</p>
            <h1>Every event, from request to full house.</h1>
            <p className="cs-lede">
              Requests, venues, equipment and registrations in one place.
            </p>

            <ul className="cs-hero-points">
              <li>Venue availability checked as you plan</li>
              <li>Double bookings caught early</li>
              <li>Notified when anything changes</li>
            </ul>
          </div>

          <section className="cs-login" id="sign-in" aria-label="Log in">
            <h2 className="cs-login-title">Choose how you log in</h2>

            <div className="cs-tabs" role="tablist" aria-label="Account type">
              {Object.values(PORTALS).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="tab"
                  aria-selected={portal === option.id}
                  className={
                    portal === option.id ? "cs-tab cs-tab-active" : "cs-tab"
                  }
                  onClick={() => switchPortal(option.id)}
                >
                  <span className="cs-tab-name">{option.tab}</span>
                  <span className="cs-tab-audience">{option.audience}</span>
                </button>
              ))}
            </div>

            <p className="cs-login-blurb">{activePortal.blurb}</p>

            <form
              className="cs-form"
              onSubmit={mode === "login" ? handleLogin : handleRegister}
              aria-label={mode === "login" ? `${activePortal.title} sign-in` : `${activePortal.title} registration`}
            >
              {mode === "register" && (
                <>
                  <label className="cs-field" htmlFor="cs-name">
                    <span>Full name</span>
                    <input id="cs-name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                  {isCorporate && (
                    <label className="cs-field" htmlFor="cs-organisation">
                      <span>Organisation name</span>
                      <input id="cs-organisation" required value={organisationName} onChange={(e) => setOrganisationName(e.target.value)} />
                    </label>
                  )}
                  <label className="cs-field" htmlFor="cs-mobile">
                    <span>Mobile number</span>
                    <input id="cs-mobile" type="tel" autoComplete="tel" required inputMode="numeric" pattern="[0-9]{7,15}" minLength="7" maxLength="15" placeholder="7 to 15 digits" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, ""))} />
                  </label>
                  <label className="cs-field" htmlFor="cs-contact-method">
                    <span>Preferred contact method</span>
                    <select id="cs-contact-method" value={preferredContactMethod} onChange={(e) => setPreferredContactMethod(e.target.value)}>
                      <option value="EMAIL">Email</option><option value="MOBILE">Mobile</option>
                    </select>
                  </label>
                </>
              )}
              <label className="cs-field" htmlFor="cs-email">
                <span>Email</span>
                <input
                  id="cs-email"
                  type="email"
                  autoComplete={mode === "login" ? "username" : "email"}
                  required
                  placeholder={activePortal.example}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>

              {/* Registering, each password rule is ticked off live as it is met;
                  signing in, the rules are not shown — they are not being set. */}
              <PasswordField
                id="cs-password"
                label="Password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={mode === "register" ? 12 : 6}
                placeholder={mode === "register" ? "Create a password" : "Your password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                checks={mode === "register" ? passwordChecks(password) : undefined}
              />

              {mode === "register" && (
                <PasswordField
                  id="cs-confirm-password"
                  label="Confirm password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  checks={confirmPassword ? [{ id: "match", label: "Passwords match", met: confirmPassword === password }] : undefined}
                />
              )}

              {error && (
                <p className="cs-error" role="alert">
                  {error}
                </p>
              )}

              {success && <p className="cs-success" role="status">{success}</p>}

              <button className="cs-btn cs-btn-primary cs-btn-block" disabled={busy}>
                {busy
                  ? "Working…"
                  : mode === "login"
                  ? `Log in to ${activePortal.title.toLowerCase()}`
                  : isCorporate ? "Create event organiser account" : "Create attendee account"}
              </button>
            </form>

            <p className="cs-login-footnote">
              {mode === "login" ? "New to ConnectSphere?" : "Already registered?"}{" "}
              <button
                type="button"
                className="cs-link-btn"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setError("");
                  setSuccess("");
                  setPassword("");
                  setConfirmPassword("");
                }}
              >
                {mode === "login" ? "Create an account" : "Log in instead"}
              </button>
            </p>

            {/* A portal with nothing to add (Individuals) shows no hint line at all. */}
            {(() => {
              const hint = mode === "register" && isCorporate
                ? "Self-registration creates an Event Organiser account. Coordinator, venue and technical roles are provisioned separately."
                : activePortal.hint;
              return hint ? <p className="cs-login-hint">{hint}</p> : null;
            })()}
          </section>
        </section>

        <PlatformOverview />
      </main>

      <footer className="cs-footer">
        <span className="cs-brand">
          <span className="cs-brand-mark" aria-hidden="true" />
          ConnectSphere
        </span>
        <span>IS212 Software Project Management · Team G6T1</span>
      </footer>
    </div>
  );
}

export default LandingPage;
