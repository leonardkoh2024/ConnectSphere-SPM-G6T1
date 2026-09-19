// The service registry.
//
// Each service owns one path prefix and one set of Firestore collections, and no
// service reads or writes another's collections — that separation is the whole
// point of the split, and it is what would let a service move into its own
// process later without the others noticing.
//
// To add one: create `services/<name>/index.js` exporting an Express router,
// import it here, and add a row below. Nothing else needs to change.
//
//   import eventService from "./event/index.js";
//   { name: "event", prefix: "/api/events", router: eventService }
//
// Planned services, matching the epics in Jira:
//
//   auth                   /api/auth                     users                               epic A
//   event                  /api/events                   events, event_history, …            epics B–D
//   coordinatorAssignment  /api/coordinator-assignment   coordinators, assignment_cursor      epic C (C1 only — see backend/README.md)
//   venue                  /api/venues                   venue catalogue, bookings            epics E–F
//   equipment              /api/equipment                equipment counts, reservations       epic G
//   registration           /api/registrations            attendee registrations, waiting list
//   notification           /api/notifications             inbox items

import coordinatorAssignmentService from "./coordinatorAssignment/index.js";

const SERVICES = [{ name: "coordinatorAssignment", prefix: "/api/coordinator-assignment", router: coordinatorAssignmentService }];

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
