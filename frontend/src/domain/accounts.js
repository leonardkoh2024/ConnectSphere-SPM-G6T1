// Account rules: which email addresses may hold a staff account, which role a new
// account is created with, and what counts as a valid password and mobile number.
//
// Pure functions, no React and no Firebase — these are the rules themselves, so
// they are cheap to unit test and can move into `backend/` unchanged.

import { ROLES } from "./roles";
import { PORTALS } from "./portals";

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
//
// One list, read twice: the registration form ticks each rule off live as the
// password is typed, and isStrongPassword requires all of them on submit — so the
// checklist can never promise something the submit check then refuses.
export const PASSWORD_RULES = [
  { id: "length", label: "At least 12 characters", test: (password) => password.length >= 12 },
  { id: "number", label: "One number", test: (password) => /\d/.test(password) },
  { id: "special", label: "One special character", test: (password) => /[^A-Za-z0-9]/.test(password) }
];

export function passwordChecks(password) {
  const value = String(password ?? "");
  return PASSWORD_RULES.map(({ id, label, test }) => ({ id, label, met: test(value) }));
}

export function isStrongPassword(password) {
  return passwordChecks(password).every((check) => check.met);
}

export function isValidMobileNumber(number) {
  return /^\d{7,15}$/.test(String(number));
}
