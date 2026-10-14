// The ConnectSphere roles and everything the app needs to know about each one.
//
// Core feature F1 originally fixed this list at five roles with no admin role;
// Week 7 customer changes add the Event Coordinator Lead and Safety Officer.
// The Lead assigns events; the Safety Officer receives a narrow read-only
// safety view. This module is the
// canonical definition; never re-declare a role as a string literal elsewhere.
// It holds no React and no Firebase, so it can move into `backend/` unchanged
// when the service layer is built.

export const ROLES = {
  ORGANISER: "EVENT_ORGANISER",
  COORDINATOR: "EVENT_COORDINATOR",
  COORDINATOR_LEAD: "EVENT_COORDINATOR_LEAD",
  VENUE_STAFF: "VENUE_STAFF",
  SAFETY_OFFICER: "SAFETY_OFFICER",
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
//
// The Event Coordinator Lead oversees every event rather than a single
// assignment (Week 7 change #5), so it has no scope field either — its screens
// read the whole collection, not just the events that carry its id.
export const EVENT_SCOPE_FIELD = {
  [ROLES.ORGANISER]: "organiser_id",
  [ROLES.COORDINATOR]: "coordinator_id",
  [ROLES.COORDINATOR_LEAD]: null,
  [ROLES.VENUE_STAFF]: "venue_staff_id",
  [ROLES.SAFETY_OFFICER]: null,
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
          "Your requests and drafts, and where each one stands."
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
          "Tell us what your event needs."
      },
      {
        name: "Change requests",
        icon: "change",
        blurb:
          "Request changes to a submitted event."
      },
      {
        name: "Registrations",
        icon: "people",
        blurb:
          "Who has registered for your events."
      },
      {
        name: "Notifications",
        icon: "bell",
        blurb:
          "Decisions and updates on your events."
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
          "Submitted requests waiting for your decision."
      },
      {
        name: "Assigned events",
        icon: "clipboard",
        blurb:
          "Events you coordinate."
      },
      {
        name: "Venue catalogue",
        icon: "search",
        blurb:
          "Browse and filter every venue."
      },
      {
        name: "Venue bookings",
        icon: "building",
        blurb:
          "Request venues and track the replies."
      },
      {
        name: "Equipment requests",
        icon: "equipment",
        blurb:
          "Request equipment for your events."
      },
      {
        name: "Registrations",
        icon: "people",
        blurb: "Registrations for your events."
      },
      {
        name: "Notifications",
        icon: "bell",
        blurb:
          "Submissions, changes and decisions."
      }
    ]
  },
  // Week 7 change #5. The Lead oversees the coordinators rather than running
  // events themselves, so it has only the two screens its role calls for:
  // nothing a coordinator uses to do the day-to-day work on an event.
  [ROLES.COORDINATOR_LEAD]: {
    label: "Event Coordinator Lead",
    portal: "corporate",
    summary:
      "Oversees every event and assigns coordinators to the ones that need one.",
    screens: [
      {
        name: "Unassigned queue",
        icon: "inbox",
        blurb:
          "Events with no coordinator yet — assign one from here."
      },
      {
        name: "Oversight",
        icon: "clipboard",
        blurb:
          "Every event, who is coordinating it, and how loaded each coordinator is — reassign from here."
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
          "Approve or reject venue requests."
      },
      {
        name: "Venue catalogue",
        icon: "building",
        blurb:
          "Keep your venues up to date."
      },
      {
        name: "Availability calendar",
        icon: "calendar",
        blurb:
          "Bookings and blocked dates by venue."
      },
      {
        name: "Notifications",
        icon: "bell",
        blurb: "New requests and booking changes."
      }
    ]
  },
  [ROLES.SAFETY_OFFICER]: {
    label: "Safety Officer",
    portal: "corporate",
    summary: "Reviews event and venue safety information.",
    screens: [
      {
        name: "Venue safety information",
        icon: "building",
        blurb: "Emergency access and known restrictions for every venue."
      },
      {
        name: "Notifications",
        icon: "bell",
        blurb: "Safety review and event updates."
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
          "Equipment requests to action."
      },
      {
        name: "Availability check",
        icon: "check",
        blurb:
          "Check what equipment is free."
      },
      {
        name: "Reservations",
        icon: "bookmark",
        blurb:
          "Reserve equipment for an event."
      },
      {
        name: "Notifications",
        icon: "bell",
        blurb: "New requests and reservation changes."
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
          "Events open for registration."
      },
      {
        name: "My registrations",
        icon: "ticket",
        blurb: "Your registrations."
      },
      {
        name: "Notifications",
        icon: "bell",
        blurb:
          "Updates on events you registered for."
      }
    ]
  }
};
