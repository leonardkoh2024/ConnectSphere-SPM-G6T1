import { ROLES, ROLE_META } from "../frontend/src/domain/roles.js";

export const PROJECT_ID = "demo-connectsphere";

// Test-only password; these accounts exist only inside the local emulator.
const PASSWORD = "e2e-Password-123";

const user = (key, role, email, name = `E2E ${ROLE_META[role].label}`) => ({
  uid: `e2e-${key}`,
  name,
  email,
  password: PASSWORD,
  role,
  portal: ROLE_META[role].portal
});

export const USERS = {
  organiser: user("organiser", ROLES.ORGANISER, "organiser@e2e.test"),
  // A second client, so A5 can show one organiser never sees another's events.
  otherOrganiser: user("other-organiser", ROLES.ORGANISER, "other.organiser@e2e.test"),
  coordinator: user("coordinator", ROLES.COORDINATOR, "coordinator@connectsphere.com"),
  // A second coordinator, for reassignment (C9, K3) and "not my event" (K5).
  coordinator2: user("coordinator-2", ROLES.COORDINATOR, "coordinator2@connectsphere.com", "E2E Second Coordinator"),
  lead: user("lead", ROLES.COORDINATOR_LEAD, "lead@connectsphere.com"),
  venueStaff: user("venue-staff", ROLES.VENUE_STAFF, "venue@connectsphere.com"),
  // Manages a different venue, so F3 can show staff see only their own venues' requests.
  venueStaff2: user("venue-staff-2", ROLES.VENUE_STAFF, "venue2@connectsphere.com", "E2E Second Venue Staff"),
  techSupport: user("tech-support", ROLES.TECH_SUPPORT, "tech@connectsphere.com"),
  safetyOfficer: user("safety-officer", ROLES.SAFETY_OFFICER, "safety@connectsphere.com"),
  attendee: user("attendee", ROLES.ATTENDEE, "attendee@e2e.test"),
  // More attendees, to fill an event and queue on its waiting list (H3, H6, H7).
  attendee2: user("attendee-2", ROLES.ATTENDEE, "attendee2@e2e.test", "E2E Second Attendee"),
  attendee3: user("attendee-3", ROLES.ATTENDEE, "attendee3@e2e.test", "E2E Third Attendee")
};