// The two sign-in portals. The portal a visitor picks, combined with their email
// address, decides the role a new account is created with — see `accounts.js`.

export const PORTALS = {
  individual: {
    id: "individual",
    tab: "Individuals",
    title: "Individual account",
    audience: "For attendees",
    blurb:
      "Register for events and manage your places.",
    example: "priya.attendee@gmail.com"
  },
  corporate: {
    id: "corporate",
    tab: "Corporate",
    title: "Corporate account",
    audience: "For organisers and staff",
    blurb:
      "Your work email sets your role.",
    hint: "Staff accounts must use an approved ConnectSphere email domain.",
    example: "amir.coordinator@connectsphere.com"
  }
};
