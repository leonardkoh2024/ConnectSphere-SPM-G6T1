// Catalogue values shared by events and venues. They can later be replaced with
// values loaded from the facilities/layouts catalogues without changing the event
// document shape.
//
// Firestore field names are snake_case; these are stored values, so they stay
// SCREAMING_SNAKE exactly as written here.

export const LAYOUTS = ["THEATRE", "CLASSROOM", "BOARDROOM", "U_SHAPE", "CABARET"];
export const FACILITIES = ["PROJECTOR", "MICROPHONE", "VIDEO_CONFERENCING", "WHITEBOARD", "CATERING"];
export const ACCESSIBILITY_OPTIONS = ["WHEELCHAIR_ACCESS", "HEARING_LOOP", "STEP_FREE_ACCESS", "ACCESSIBLE_TOILET", "QUIET_SPACE"];
