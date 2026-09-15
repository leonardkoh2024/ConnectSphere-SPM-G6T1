// The two sign-in portals. The portal a visitor picks, combined with their email
// address, decides the role a new account is created with — see `accounts.js`.

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
