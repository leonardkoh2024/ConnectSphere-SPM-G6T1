// The service registry.
//
// Each service owns one path prefix and its Firestore collections. Cross-service
// data is passed through explicit service contracts rather than raw collection
// access, preserving the boundary if services later move into separate processes.
//
// To add one: create `services/<name>/index.js` exporting an Express router,
// import it here, and add a row below. Nothing else needs to change.
//
//   import eventService from "./event/index.js";
//   { name: "event", prefix: "/api/events", router: eventService }
//
// Service boundaries, matching the epics in Jira:
//
//   auth                   /api/auth                     users                               epic A
//   event                  /api/events                   events, event_history, …            epics B–D
//   coordinatorAssignment  /api/coordinator-assignment   coordinators, assignment_cursor      epic C (C1 only — see backend/README.md)
//   venue                  /api/venues                   venue catalogue, bookings            epics E–F
//   equipment              /api/equipment                equipment counts, reservations       epic G
//   registration           /api/registrations            attendee registrations, waiting list
//   arrangements           /api/events                   arrangement_rerequests               I3 re-request after a significant change
//   notification           /api/notifications             inbox items

import arrangementsService from "./arrangements/index.js";
import coordinatorAssignmentService from "./coordinatorAssignment/index.js";
import equipmentService from "./equipment/index.js";
import registrationService from "./registration/index.js";
import venueService from "./venue/index.js";

const SERVICES = [
  { name: "coordinatorAssignment", prefix: "/api/coordinator-assignment", router: coordinatorAssignmentService },
  { name: "venue", prefix: "/api/venues", router: venueService },
  { name: "equipment", prefix: "/api/equipment", router: equipmentService },
  { name: "registration", prefix: "/api/registrations", router: registrationService },
  { name: "arrangements", prefix: "/api/events", router: arrangementsService }
];

/** Mount every registered service onto the app. Called once at startup. */
export function registerServices(app) {
  for (const service of SERVICES) {
    app.use(service.prefix, service.router);
  }
  return SERVICES.map((service) => service.name);
}

/** The services currently mounted, for the health endpoint. */
export function listServices() {
  return SERVICES.map(({ name, prefix }) => ({ name, prefix }));
}
