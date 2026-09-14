// src/LandingPage.js
//
// Public entry point for ConnectSphere. Visitors land here, pick the portal that
// matches who they are, and sign in. The portal plus the email address decide the
// role that is stored on the user's Firestore document, and App.js uses that role
// to decide which screens the signed-in user is allowed to see.

import React, { useMemo, useState } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";

// ==========================================
// ROLES
// ==========================================

export const ROLES = {
  ORGANISER: "EVENT_ORGANISER",
  COORDINATOR: "EVENT_COORDINATOR",
  VENUE_STAFF: "VENUE_STAFF",
  TECH_SUPPORT: "TECHNICAL_SUPPORT_STAFF",
  ATTENDEE: "ATTENDEE"
};

// Everything the rest of the app needs to know about a role: how to label it,
// which portal it belongs to, and which screens it may open.
export const ROLE_META = {
  [ROLES.ORGANISER]: {
    label: "Event Organiser",
    portal: "corporate",
    summary: "Creates, submits and manages event requests.",
    screens: [
      {
        name: "New event request",
        blurb:
          "Capture the event name, purpose, proposed date and time, expected attendance, venue and equipment requirements, accessibility needs and registration needs."
      },
      {
        name: "My drafts",
        blurb:
          "Save an incomplete request, come back later and keep editing. Drafts stay clearly separate from requests already sent for review."
      },
      {
        name: "My events",
        blurb:
          "Follow each event through submitted, under review, approved, planning, confirmed, completed, cancelled or rejected."
      },
      {
        name: "Change requests",
        blurb:
          "Ask for permitted changes after submission and see how the Event Coordinator processed them."
      },
      {
        name: "Registrations",
        blurb:
          "Review who has registered for the events you own, where registration is enabled."
      },
      {
        name: "Notifications",
        blurb:
          "Clarification requests, approval and rejection decisions, coordinator assignment and booking outcomes."
      }
    ]
  },
  [ROLES.COORDINATOR]: {
    label: "Event Coordinator",
    portal: "corporate",
    summary: "Reviews, approves and coordinates the events assigned to them.",
    screens: [
      {
        name: "Review queue",
        blurb:
          "Work through submitted requests: ask the organiser for clarification or amendments, then approve or reject."
      },
      {
        name: "Assigned events",
        blurb:
          "The events where you are the main internal point of contact, including any reassigned to you."
      },
      {
        name: "Venue search",
        blurb:
          "Filter the venue catalogue by date, time, expected attendance, location, capacity, accessibility, layout and required facilities, with suitability flagged for you."
      },
      {
        name: "Venue bookings",
        blurb:
          "Send booking requests to Venue Staff and track approvals, rejections and the reasons behind them."
      },
      {
        name: "Equipment requests",
        blurb:
          "Record equipment types, quantities and technical requirements for Technical Support Staff to action."
      },
      {
        name: "Registrations",
        blurb: "Registration information for the events you coordinate."
      },
      {
        name: "Notifications",
        blurb:
          "New submissions, important event changes and venue or equipment decisions."
      }
    ]
  },
  [ROLES.VENUE_STAFF]: {
    label: "Venue Staff",
    portal: "corporate",
    summary: "Manages venues and responds to venue booking requests.",
    screens: [
      {
        name: "Booking requests",
        blurb:
          "Assess pending requests against the event timing and requirements, then approve or reject with a reason."
      },
      {
        name: "Venue catalogue",
        blurb:
          "Maintain location, capacity, facilities, accessibility, supported room layouts and operating information."
      },
      {
        name: "Availability calendar",
        blurb:
          "See confirmed bookings and recorded unavailability so overlapping bookings are caught before they are accepted."
      },
      {
        name: "Notifications",
        blurb: "Incoming requests and changes that affect a confirmed booking."
      }
    ]
  },
  [ROLES.TECH_SUPPORT]: {
    label: "Technical Support Staff",
    portal: "corporate",
    summary: "Manages equipment availability and reservations.",
    screens: [
      {
        name: "Equipment queue",
        blurb:
          "Review requested equipment and update the request as arrangements are made."
      },
      {
        name: "Availability check",
        blurb:
          "Confirm whether enough suitable equipment is free for the event date and time, excluding items already committed elsewhere."
      },
      {
        name: "Reservations",
        blurb:
          "Reserve equipment against an event so the reserved quantity is no longer available to overlapping events."
      },
      {
        name: "Notifications",
        blurb: "New equipment requests and event changes that affect a reservation."
      }
    ]
  },
  [ROLES.ATTENDEE]: {
    label: "Attendee",
    portal: "individual",
    summary: "Registers for events and manages their own registrations.",
    screens: [
      {
        name: "Browse events",
        blurb:
          "Event information published for attendees, for events where registration is enabled."
      },
      {
        name: "My registrations",
        blurb: "Check your registration status or withdraw a registration."
      },
      {
        name: "Notifications",
        blurb:
          "Registration updates, confirmation, important changes and cancellations."
      }
    ]
  }
};

// ==========================================
// PORTALS
// ==========================================

export const PORTALS = {
  individual: {
    id: "individual",
    tab: "Individuals",
    title: "Individual account",
    audience: "For attendees",
    blurb:
      "Register for ConnectSphere events, track your registration status and withdraw if your plans change.",
    hint: "Any personal or work email address can be used.",
    example: "priya.attendee@gmail.com"
  },
  corporate: {
    id: "corporate",
    tab: "Corporate",
    title: "Corporate account",
    audience: "For organisers, coordinators, venue and technical support staff",
    blurb:
      "Your role is pre-set from your ConnectSphere work email, so you land straight on the screens you are responsible for.",
    hint: "Staff accounts must use an approved ConnectSphere email domain.",
    example: "amir.coordinator@connectsphere.com"
  }
};

// Domains allowed to hold a corporate (staff) account. Kept configurable so the
// customer can add domains without a code change.
const STAFF_DOMAINS = (
  process.env.REACT_APP_STAFF_EMAIL_DOMAINS || "connectsphere.com"
)
  .split(",")
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);

// Read in order: the first pattern that matches the email wins.
const STAFF_ROLE_PATTERNS = [
  [/coordinator|coord/, ROLES.COORDINATOR],
  [/venue|facilit/, ROLES.VENUE_STAFF],
  [/tech|itsupport|helpdesk|equipment/, ROLES.TECH_SUPPORT],
  [/organiser|organizer|event/, ROLES.ORGANISER]
];

// Only the mailbox name and any sub-domains are matched, so a company domain such
// as "eventco.com" cannot accidentally set somebody's role.
function roleScope(email) {
  const [mailbox = "", domain = ""] = String(email).toLowerCase().trim().split("@");
  const labels = domain.split(".");
  const subDomains = labels.slice(0, Math.max(labels.length - 2, 0));
  return [mailbox, ...subDomains].join(".");
}

export function emailDomain(email) {
  return String(email).toLowerCase().trim().split("@")[1] || "";
}

export function isStaffEmail(email) {
  return STAFF_DOMAINS.includes(emailDomain(email));
}

// The role a brand new account is created with. Individuals are always attendees;
// staff roles come from the mailbox name, defaulting to the least privileged staff
// role when nothing matches.
export function resolveRole(email, portal) {
  if (portal !== PORTALS.corporate.id) {
    return ROLES.ATTENDEE;
  }

  const scope = roleScope(email);
  const match = STAFF_ROLE_PATTERNS.find(([pattern]) => pattern.test(scope));

  return match ? match[1] : ROLES.ORGANISER;
}

// Firebase's minimum is lower, so enforce ConnectSphere's stronger rule in the
// client before an account is ever sent to Firebase Authentication.
export function isStrongPassword(password) {
  return String(password).length >= 12 && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

export function isValidMobileNumber(number) {
  return /^\d{8,}$/.test(String(number));
}

// ==========================================
// LANDING PAGE
// ==========================================

const FEATURES = [
  {
    title: "Requests and drafts",
    body:
      "Organisers submit complete event requests, or park an incomplete one as a draft and finish it later."
  },
  {
    title: "Review, approval and assignment",
    body:
      "Coordinators request clarification, approve or reject, and pick up the events assigned to them."
  },
  {
    title: "Venue catalogue and availability",
    body:
      "Capacity, facilities, accessibility and supported layouts, alongside a calendar of what is already booked."
  },
  {
    title: "Booking approval and conflict detection",
    body:
      "Venue Staff decide on each request, and overlapping bookings are caught before a venue is double-booked."
  },
  {
    title: "Equipment and reservations",
    body:
      "Technical Support Staff check what is genuinely free and reserve it against a specific event."
  },
  {
    title: "Registration and notifications",
    body:
      "Attendees register and withdraw, while everyone involved is told when something meaningful changes."
  }
];

const WORKFLOW = [
  {
    step: "01",
    title: "Request",
    body: "An Event Organiser submits the event, or saves a draft to finish later."
  },
  {
    step: "02",
    title: "Review",
    body:
      "An Event Coordinator is assigned, asks for anything missing, then approves or rejects."
  },
  {
    step: "03",
    title: "Venue",
    body:
      "Suitable venues are shortlisted, requested, and approved or rejected by Venue Staff."
  },
  {
    step: "04",
    title: "Equipment",
    body:
      "Technical Support Staff confirm availability and reserve equipment for the event date and time."
  },
  {
    step: "05",
    title: "Attend",
    body:
      "Registration opens, the event is confirmed, and later changes flow back through the same workflow."
  }
];

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

  // Live preview of the role the email would be given, shown on the corporate tab
  // so staff can see what they are about to sign in as.
  const previewRole = useMemo(() => {
    if (!email.includes("@")) {
      return null;
    }
    return resolveRole(email, portal);
  }, [email, portal]);

  const switchPortal = (nextPortal) => {
    setPortal(nextPortal);
    setError("");
    setSuccess("");
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
      setError("Enter a mobile number containing at least 8 digits.");
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
            onClick={() => switchPortal(PORTALS.individual.id)}
          >
            Attendee log in
          </a>
          <a
            className="cs-btn cs-btn-primary"
            href="#sign-in"
            onClick={() => switchPortal(PORTALS.corporate.id)}
          >
            Staff log in
          </a>
        </div>
      </header>

      <main id="top">
        <section className="cs-hero">
          <div className="cs-hero-copy">
            <p className="cs-eyebrow">Corporate event management</p>
            <h1>
              Every ConnectSphere event, from first request to full house, in one
              place.
            </h1>
            <p className="cs-lede">
              Organisers raise requests, coordinators secure venues and equipment,
              and attendees register — and each person only ever sees the screens
              their role is responsible for.
            </p>

            <ul className="cs-hero-points">
              <li>Venue availability and suitability checked as you plan</li>
              <li>Overlapping bookings flagged before they are confirmed</li>
              <li>Notifications whenever a decision or change lands</li>
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
                    <input id="cs-mobile" type="tel" autoComplete="tel" required inputMode="numeric" pattern="[0-9]{8,}" minLength="8" placeholder="At least 8 digits" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, ""))} />
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

              <label className="cs-field" htmlFor="cs-password">
                <span>Password</span>
                <input
                  id="cs-password"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                  minLength={mode === "register" ? 12 : 6}
                  placeholder={mode === "register" ? "12+ characters, number and special character" : "Your password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>

              {mode === "register" && (
                <>
                  <p className="cs-login-hint cs-password-hint">
                    Use at least 12 characters, including one number and one special character.
                  </p>
                  <label className="cs-field" htmlFor="cs-confirm-password">
                    <span>Confirm password</span>
                    <input
                      id="cs-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </label>
                </>
              )}

              {isCorporate && previewRole && mode === "login" && (
                <p className="cs-role-preview">
                  Detected role: <strong>{ROLE_META[previewRole].label}</strong>
                </p>
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

            <p className="cs-login-hint">
              {mode === "register" && isCorporate
                ? "Self-registration creates an Event Organiser account. Coordinator, venue and technical roles are provisioned separately."
                : activePortal.hint}
            </p>
          </section>
        </section>

        <section className="cs-section" id="platform">
          <h2>Everything the event workflow needs</h2>
          <p className="cs-section-lede">
            One connected workflow rather than a pile of spreadsheets and email
            threads.
          </p>

          <div className="cs-grid">
            {FEATURES.map((feature) => (
              <article className="cs-card" key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="cs-section cs-section-alt" id="roles">
          <h2>Signed in as you, not as everyone</h2>
          <p className="cs-section-lede">
            Your portal and work email set your role, and your role sets your
            screens.
          </p>

          <div className="cs-grid cs-grid-roles">
            {Object.entries(ROLE_META).map(([roleId, meta]) => (
              <article className="cs-card cs-card-role" key={roleId}>
                <span className="cs-pill">{PORTALS[meta.portal].tab}</span>
                <h3>{meta.label}</h3>
                <p>{meta.summary}</p>
                <ul className="cs-screen-list">
                  {meta.screens.map((screen) => (
                    <li key={screen.name}>{screen.name}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="cs-section" id="workflow">
          <h2>How an event comes together</h2>

          <ol className="cs-steps">
            {WORKFLOW.map((item) => (
              <li key={item.step}>
                <span className="cs-step-number">{item.step}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="cs-cta">
          <h2>Ready when your next event is</h2>
          <p>
            Pick your portal, log in, and pick up exactly where your role leaves
            off.
          </p>
          <a className="cs-btn cs-btn-light" href="#sign-in">
            Go to log in
          </a>
        </section>
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
