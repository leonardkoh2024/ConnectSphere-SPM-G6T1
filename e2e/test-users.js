import { ROLES, ROLE_META } from "../frontend/src/domain/roles.js";

export const PROJECT_ID = "demo-connectsphere";

// Test-only password; these accounts exist only inside the local emulator.
const PASSWORD = "e2e-Password-123";

const user = (key, role, email) => ({
  uid: `e2e-${key}`,
  name: `E2E ${ROLE_META[role].label}`,
  email,
  password: PASSWORD,
  role,
  portal: ROLE_META[role].portal
});

export const USERS = {
  organiser: user("organiser", ROLES.ORGANISER, "organiser@e2e.test"),
  coordinator: user("coordinator", ROLES.COORDINATOR, "coordinator@connectsphere.com"),
  lead: user("lead", ROLES.COORDINATOR_LEAD, "lead@connectsphere.com"),
  venueStaff: user("venue-staff", ROLES.VENUE_STAFF, "venue@connectsphere.com"),
  techSupport: user("tech-support", ROLES.TECH_SUPPORT, "tech@connectsphere.com"),
  safetyOfficer: user("safety-officer", ROLES.SAFETY_OFFICER, "safety@connectsphere.com"),
  attendee: user("attendee", ROLES.ATTENDEE, "attendee@e2e.test")
};