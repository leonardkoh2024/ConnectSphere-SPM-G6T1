// The mock venue catalogue and equipment inventory the tests run against. Venues
// and inventory are reference data — there is no screen that creates them — so
// global-setup writes them into the emulator before every run.
import { LAYOUTS, FACILITIES, ACCESSIBILITY_OPTIONS } from "../frontend/src/domain/events.js";

const EVERY_DAY = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]
  .map((weekday) => ({ weekday, opens_at: "07:00", closes_at: "23:00" }));

const venue = (venue_id, fields) => ({
  venue_id,
  building: "E2E Building",
  special_space_availability: "",
  emergency_access_notes: "",
  known_restrictions: "",
  operating_hours: EVERY_DAY,
  is_active: true,
  ...fields
});

// `staff` is the key in test-users.js of the Venue Staff member who manages it.
export const VENUES = {
  hall: {
    staff: "venueStaff",
    doc: venue("e2e-venue-hall", {
      name: "E2E Grand Hall", location: "CENTRAL", max_capacity: 200, setup_minutes: 30, turnaround_minutes: 30,
      layouts: ["THEATRE", "CLASSROOM", "BANQUET", "BOARDROOM"],
      facilities: ["WIFI", "STAGE", "AIR_CONDITIONING", "TABLES_AND_CHAIRS"],
      accessibility: ["WHEELCHAIR_ACCESS", "LIFT", "ACCESSIBLE_TOILET"]
    })
  },
  studio: {
    staff: "venueStaff",
    doc: venue("e2e-venue-studio", {
      name: "E2E Small Studio", location: "CENTRAL", max_capacity: 30, setup_minutes: 15, turnaround_minutes: 15,
      layouts: ["THEATRE", "CLASSROOM", "BOARDROOM"],
      facilities: ["WIFI"],
      accessibility: []
    })
  },
  pavilion: {
    staff: "venueStaff",
    doc: venue("e2e-venue-pavilion", {
      name: "E2E Riverside Pavilion", location: "CENTRAL", max_capacity: 500, setup_minutes: 60, turnaround_minutes: 60,
      layouts: [...LAYOUTS], facilities: [...FACILITIES], accessibility: [...ACCESSIBILITY_OPTIONS]
    })
  },
  annex: {
    staff: "venueStaff2",
    doc: venue("e2e-venue-annex", {
      name: "E2E East Annex", location: "EAST", max_capacity: 120, setup_minutes: 30, turnaround_minutes: 30,
      layouts: ["THEATRE", "CLASSROOM"], facilities: ["WIFI", "AIR_CONDITIONING"], accessibility: ["LIFT"]
    })
  }
};

// Units held of each equipment type.
export const INVENTORY = { AUDIO: 20, VISUAL: 10, LIGHTING: 8, STAGING: 4, FURNITURE: 100, OTHERS: 10 };
