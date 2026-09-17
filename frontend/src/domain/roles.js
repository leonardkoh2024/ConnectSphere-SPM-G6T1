// The five ConnectSphere roles and everything the app needs to know about each one.
//
// Core feature F1 fixes this list at exactly five roles — there is no admin role.
// This module is the canonical definition; never re-declare a role as a string
// literal elsewhere. It holds no React and no Firebase, so it can move into
// `backend/` unchanged when the service layer is built.

export const ROLES = {
  ORGANISER: "EVENT_ORGANISER",
  COORDINATOR: "EVENT_COORDINATOR",
  VENUE_STAFF: "VENUE_STAFF",
  TECH_SUPPORT: "TECHNICAL_SUPPORT_STAFF",
  ATTENDEE: "ATTENDEE"
};

// Story A5 ("see only events I am related to"): the event field that relates each
// role to an event. One field per role keeps both the client query and the
// matching firestore.rules clause easy to read; the trade-off is that adding a
// role means adding a branch in both places. `coordinator_id` is written by C1,
// `venue_staff_id` by F2 and `tech_support_id` by G1, so an event created today
// carries only `organiser_id`.
//
// Attendees are related to an event through their own `registrations` document
// rather than a field on the event, so they have no scope field here.
export const EVENT_SCOPE_FIELD = {
  [ROLES.ORGANISER]: "organiser_id",
  [ROLES.COORDINATOR]: "coordinator_id",
  [ROLES.VENUE_STAFF]: "venue_staff_id",
  [ROLES.TECH_SUPPORT]: "tech_support_id",
  [ROLES.ATTENDEE]: null
};

export const eventScopeField = (role) => EVENT_SCOPE_FIELD[role] || null;

// Everything the rest of the app needs to know about a role: how to label it,
// which portal it belongs to, and which screens it may open. A screen's `icon`
// is the name of a glyph drawn by `app/Icon.js` — a plain string, so this file
// still holds no React.
export const ROLE_META = {
  [ROLES.ORGANISER]: {
    label: "Event Organiser",
    portal: "corporate",
    summary: "Creates, submits and manages event requests.",
    screens: [
      {
        name: "My events",
        icon: "calendar",
        blurb:
          "Every request you have created, drafts included. Follow each one through submitted, under review, approved, planning, confirmed, completed, cancelled or rejected."
      },
      {
        // Reached from the button on My events, not from the sidebar: it is a task
        // you start from your list, not a place you go. `hidden` keeps it out of
        // the navigation while leaving it a screen this role may open — which is
        // what A4 is about, so another role asking for it is still refused.
        name: "New event request",
        icon: "calendar-add",
        hidden: true,
        blurb:
          "Capture the event name, purpose, proposed date and time, expected attendance, venue and equipment requirements, accessibility needs and registration needs."
      },
      {
        name: "Change requests",
        icon: "change",
        blurb:
          "Ask for permitted changes after submission and see how the Event Coordinator processed them."
      },
      {
        name: "Registrations",
        icon: "people",
        blurb:
          "Review who has registered for the events you own, where registration is enabled."
      },
      {
        name: "Notifications",
        icon: "bell",
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
        icon: "inbox",
        blurb:
          "Work through submitted requests: ask the organiser for clarification or amendments, then approve or reject."
      },
      {
        name: "Assigned events",
        icon: "clipboard",
        blurb:
          "The events where you are the main internal point of contact, including any reassigned to you."
      },
      {
        name: "Venue search",
        icon: "search",
        blurb:
          "Filter the venue catalogue by date, time, expected attendance, location, capacity, accessibility, layout and required facilities, with suitability flagged for you."
      },
      {
        name: "Venue bookings",
        icon: "building",
        blurb:
          "Send booking requests to Venue Staff and track approvals, rejections and the reasons behind them."
      },
      {
        name: "Equipment requests",
        icon: "equipment",
        blurb:
          "Record equipment types, quantities and technical requirements for Technical Support Staff to action."
      },
      {
        name: "Registrations",
        icon: "people",
        blurb: "Registration information for the events you coordinate."
      },
      {
        name: "Notifications",
        icon: "bell",
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
        icon: "inbox",
        blurb:
          "Assess pending requests against the event timing and requirements, then approve or reject with a reason."
      },
      {
        name: "Venue catalogue",
        icon: "building",
        blurb:
          "Maintain location, capacity, facilities, accessibility, supported room layouts and operating information."
      },
      {
        name: "Availability calendar",
        icon: "calendar",
        blurb:
          "See confirmed bookings and recorded unavailability so overlapping bookings are caught before they are accepted."
      },
      {
        name: "Notifications",
        icon: "bell",
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
        icon: "equipment",
        blurb:
          "Review requested equipment and update the request as arrangements are made."
      },
      {
        name: "Availability check",
        icon: "check",
        blurb:
          "Confirm whether enough suitable equipment is free for the event date and time, excluding items already committed elsewhere."
      },
      {
        name: "Reservations",
        icon: "bookmark",
        blurb:
          "Reserve equipment against an event so the reserved quantity is no longer available to overlapping events."
      },
      {
        name: "Notifications",
        icon: "bell",
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
        icon: "search",
        blurb:
          "Event information published for attendees, for events where registration is enabled."
      },
      {
        name: "My registrations",
        icon: "ticket",
        blurb: "Check your registration status or withdraw a registration."
      },
      {
        name: "Notifications",
        icon: "bell",
        blurb:
          "Registration updates, confirmation, important changes and cancellations."
      }
    ]
  }
};
