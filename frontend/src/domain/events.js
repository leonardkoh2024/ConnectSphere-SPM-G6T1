// Catalogue values shared by events and venues. They can later be replaced with
// values loaded from Firestore without changing the event document shape.
//
// Firestore field names are snake_case; these are stored values, so they stay
// SCREAMING_SNAKE exactly as written here.

// Values are stable identifiers written to `preferred_location`; labels give
// organisers useful Singapore examples without making the saved data ambiguous.
export const PREFERRED_LOCATIONS = [
  { value: "CENTRAL", label: "Central — City Hall, Bugis, Orchard, Marina Bay" },
  { value: "EAST", label: "East — Tampines, Pasir Ris, Bedok, Changi" },
  { value: "WEST", label: "West — Jurong East, Jurong West, Clementi, Buona Vista" },
  { value: "NORTH", label: "North — Woodlands, Yishun, Sembawang, Admiralty" },
  { value: "NORTH_EAST", label: "North-East — Hougang, Punggol, Sengkang, Serangoon" },
  { value: "SOUTH", label: "South — HarbourFront, Sentosa, Telok Blangah" },
  { value: "NEAR_MRT", label: "Near an MRT station" },
  { value: "SINGAPORE_EXPO", label: "Singapore EXPO area" },
  { value: "SUNTEC_CITY", label: "Suntec City area" },
  { value: "MARINA_BAY_SANDS", label: "Marina Bay Sands area" },
  { value: "NATIONAL_STADIUM", label: "National Stadium area" },
  { value: "FORT_CANNING", label: "Fort Canning area" }
];

export const LAYOUTS = ["THEATRE", "CLASSROOM", "BOARDROOM", "U_SHAPE", "BANQUET", "CABARET", "CLUSTER_TABLES", "EXHIBITION_BOOTHS", "OPEN_SPACE", "STAGE_AUDIENCE", "STANDING_COCKTAIL"];
export const FACILITIES = ["TABLES", "CHAIRS", "AIR_CONDITIONING", "POWER_POINTS", "WIFI", "TOILETS", "PROJECTOR", "PROJECTOR_SCREEN", "LED_DISPLAY", "MICROPHONE", "PA_SYSTEM", "STAGE", "LIGHTING", "REGISTRATION_AREA", "STORAGE_AREA", "PARKING", "CATERING_AREA", "KITCHEN_PANTRY"];
export const ACCESSIBILITY_OPTIONS = ["WHEELCHAIR_ACCESS", "ACCESSIBLE_TOILET", "HEARING_LOOP", "STEP_FREE_ACCESS", "LIFT", "ACCESSIBLE_PARKING", "NURSING_ROOM", "QUIET_SPACE"];
