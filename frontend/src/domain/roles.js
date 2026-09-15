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
