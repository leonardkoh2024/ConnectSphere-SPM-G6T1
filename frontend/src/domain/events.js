// Catalogue values shared by events and venues. They can later be replaced with
// values loaded from Firestore without changing the event document shape.
//
// Firestore field names are snake_case; these are stored values, so they stay
// SCREAMING_SNAKE exactly as written here.

// B7 asks that a draft stay distinguishable from a submitted request. The word in
// the pill does that on its own, but only once you read it, so each status also
// carries a tone.
//
// The design system is explicit that the nine statuses map onto its five status
// tones rather than taking nine colours of their own, which is why APPROVED and
// CONFIRMED share one: the tone says how the event is doing, the word says exactly
// where it has got to. Accent violet is deliberately not used — the system warns
// against placing it next to info blue as though the two were a scale.
export const STATUS_TONE = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  UNDER_REVIEW: "warning",
  APPROVED: "positive",
  PLANNING: "info",
  CONFIRMED: "positive",
  COMPLETED: "neutral",
  CANCELLED: "danger",
  REJECTED: "danger"
};

export const statusTone = (status) => STATUS_TONE[String(status || "").toUpperCase()] || "neutral";

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
// Facilities describe features of the venue. Movable AV items (for example a
// projector, microphones, speakers and lighting) belong in equipment requests.
export const FACILITIES = ["AIR_CONDITIONING", "TABLES_AND_CHAIRS", "TOILETS", "WIFI", "POWER_POINTS", "PARKING", "LOADING_AREA", "REGISTRATION_AREA", "STAGE", "STORAGE_AREA", "CATERING_AREA", "KITCHEN_PANTRY"];
export const ACCESSIBILITY_OPTIONS = ["WHEELCHAIR_ACCESS", "ACCESSIBLE_TOILET", "HEARING_LOOP", "STEP_FREE_ACCESS", "LIFT", "ACCESSIBLE_PARKING", "NURSING_ROOM", "QUIET_SPACE"];
export const EQUIPMENT_TYPES = ["AUDIO", "VISUAL", "LIGHTING", "STAGING", "FURNITURE", "OTHERS"];
